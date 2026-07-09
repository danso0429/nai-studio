import extractChunks from 'png-chunks-extract';
import { Buffer } from 'buffer';
import { v4 } from 'uuid';
import { backend, imageService, workFlowService, zipService } from '.';
import { FileEntry } from '../backend';
import defaultassets from '../defaultassets';
import { dataUriToBase64 } from './ImageService';
import { ResourceSyncService, MAX_FOLDER_DEPTH } from './ResourceSyncService';
import {
  GenericScene,
  InpaintScene,
  Session,
  ISession,
} from './types';
import * as PngChunk from 'png-chunk-text';
import { Sampling } from '../backends/imageGen';
import encodeChunks from 'png-chunks-encode';
import * as legacy from './legacy';

const SESSION_SERVICE_INTERVAL = 5000;

export class SessionService extends ResourceSyncService<Session> {
  favorites: Set<string> = new Set();
  // 폴더 색상/순서 — folder_meta.json(서버 파일)에 영속화 (favorites 패턴 → 다기기 동기화).
  folderColors: Record<string, string> = {};
  folderOrder: string[] = [];
  // 진행 중인 프로젝트 영구 삭제 추적. 같은 프로젝트의 중복 enqueue 방지용.
  deletingProjects: Set<string> = new Set();
  // 진행 중인 폴더 삭제 추적. 백그라운드 삭제 중 재클릭 방지용 (App.tsx done/error에서 해제).
  deletingFolders: Set<string> = new Set();

  constructor() {
    super('projects', SESSION_SERVICE_INTERVAL);
  }

  async loadFavorites() {
    try {
      const str = await backend.readFile('favorites.json');
      const arr = JSON.parse(str);
      this.favorites = new Set(arr);
    } catch (e) {
      // 기존 projects/favorites.json에서 마이그레이션 시도
      try {
        const oldStr = await backend.readFile('projects/favorites.json');
        const arr = JSON.parse(oldStr);
        this.favorites = new Set(arr);
        await this.saveFavorites();
        await backend.renameFile('projects/favorites.json', 'projects/favorites.json.migrated');
      } catch (e2) {
        this.favorites = new Set();
      }
    }
  }

  async saveFavorites() {
    await backend.writeFile('favorites.json', JSON.stringify([...this.favorites]));
  }

  async toggleFavorite(name: string) {
    if (this.favorites.has(name)) {
      this.favorites.delete(name);
    } else {
      this.favorites.add(name);
    }
    await this.saveFavorites();
    await this.update();
  }

  isFavorite(name: string): boolean {
    return this.favorites.has(name);
  }

  // ===== 폴더 색상 / 순서 (folder_meta.json 서버 파일 영속화) =====
  async loadFolderMeta() {
    try {
      const str = await backend.readFile('folder_meta.json');
      const json = JSON.parse(str);
      this.folderColors = (json && json.colors) || {};
      this.folderOrder = (json && Array.isArray(json.order)) ? json.order : [];
    } catch (e) {
      this.folderColors = {};
      this.folderOrder = [];
    }
  }
  async saveFolderMeta() {
    await backend.writeFile(
      'folder_meta.json',
      JSON.stringify({ colors: this.folderColors, order: this.folderOrder }),
    );
  }
  getFolderColor(folder: string): string | null {
    return this.folderColors[folder] ?? null;
  }
  async setFolderColor(folder: string, color: string | null): Promise<void> {
    if (color) this.folderColors[folder] = color; else delete this.folderColors[folder];
    await this.saveFolderMeta();
    this.dispatchEvent(new CustomEvent('listupdated'));
  }
  // 저장된 순서 우선, 누락분은 자연 정렬로 뒤에 붙임.
  getOrderedFolders(): string[] {
    const order = this.folderOrder;
    const all = this.folderList;
    const inOrder = order.filter((f) => all.includes(f));
    const rest = all
      .filter((f) => !inOrder.includes(f))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
    return [...inOrder, ...rest];
  }
  async setFolderOrder(order: string[]): Promise<void> {
    this.folderOrder = order;
    await this.saveFolderMeta();
    this.dispatchEvent(new CustomEvent('listupdated'));
  }

  // 프로젝트 복제 (이미지 포함/미포함). 이미지 디렉토리는 이름 기준(outs/<이름> 등)이라
  // 이름만 바꿔 통째 복사. 설정(JSON)은 toJSON → name 교체 → createFrom.
  async duplicateSessionDeep(session: Session, newName: string, withImages: boolean): Promise<void> {
    if (this.resourceList.includes(newName)) {
      throw new Error('이미 존재하는 프로젝트 이름입니다.');
    }
    if (withImages) {
      // references 포함 (진단 Med-5): 누락 시 복제본에서 캐릭터 레퍼런스 이미지 fetch 실패
      // → 레퍼런스 없이 생성되던 silent 결손.
      const imageDirs = ['outs', 'inpaints', 'vibes', 'inpaint_masks', 'inpaint_orgs', 'references'];
      for (const dir of imageDirs) {
        try {
          await backend.copyDir(dir + '/' + session.name, dir + '/' + newName);
        } catch (e) {
          console.warn('[duplicate] copyDir failed:', dir, e);
        }
      }
    }
    const json = session.toJSON();
    json.name = newName;
    await this.createFrom(newName, json);
  }

  // 북마크 기능
  private bookmarkData: {
    scenes: Record<string, { name: string; type: string }>;
    images: Record<string, string>;
  } = { scenes: {}, images: {} };

  async loadBookmarks() {
    try {
      const str = await backend.readFile('bookmarks.json');
      const data = JSON.parse(str);
      this.bookmarkData = {
        scenes: data.scenes || {},
        images: data.images || {},
      };
    } catch (e) {
      this.bookmarkData = { scenes: {}, images: {} };
    }
  }

  async saveBookmarks() {
    await backend.writeFile('bookmarks.json', JSON.stringify(this.bookmarkData));
    this.dispatchEvent(new CustomEvent('bookmark-updated'));
  }

  getSceneBookmark(projectName: string): { name: string; type: string } | undefined {
    return this.bookmarkData.scenes[projectName];
  }

  isSceneBookmarked(projectName: string, sceneName: string): boolean {
    return this.bookmarkData.scenes[projectName]?.name === sceneName;
  }

  async toggleSceneBookmark(projectName: string, sceneName: string, sceneType: string) {
    const current = this.bookmarkData.scenes[projectName];
    if (current?.name === sceneName) {
      delete this.bookmarkData.scenes[projectName];
    } else {
      this.bookmarkData.scenes[projectName] = { name: sceneName, type: sceneType };
    }
    await this.saveBookmarks();
  }

  getImageBookmark(projectName: string, sceneName: string): string | undefined {
    return this.bookmarkData.images[projectName + ':' + sceneName];
  }

  isImageBookmarked(projectName: string, sceneName: string, imageFilename: string): boolean {
    return this.bookmarkData.images[projectName + ':' + sceneName] === imageFilename;
  }

  async toggleImageBookmark(projectName: string, sceneName: string, imageFilename: string) {
    const key = projectName + ':' + sceneName;
    if (this.bookmarkData.images[key] === imageFilename) {
      delete this.bookmarkData.images[key];
    } else {
      this.bookmarkData.images[key] = imageFilename;
    }
    await this.saveBookmarks();
  }

  // 씬 rename 시 씬이름 키 북마크 이전 — 씬 북마크(프로젝트당 1개)와 이미지 북마크
  // (`프로젝트:씬이름` 키) 모두 프로젝트 스코프라 이동이 정답. (진단 F2-14)
  async onSceneRenamed(
    projectName: string,
    oldName: string,
    newName: string,
    type: 'scene' | 'inpaint',
  ) {
    let changed = false;
    const sb = this.bookmarkData.scenes[projectName];
    if (sb && sb.name === oldName && sb.type === type) {
      sb.name = newName;
      changed = true;
    }
    const oldKey = projectName + ':' + oldName;
    if (this.bookmarkData.images[oldKey] !== undefined) {
      // 새 키에 잔재가 있어도 rename 대상의 북마크가 씬을 따라가는 게 맞음 — 덮어씀.
      // (같은 이름으로의 rename은 merge 경로로 빠지므로 실사용 충돌은 없음.)
      this.bookmarkData.images[projectName + ':' + newName] =
        this.bookmarkData.images[oldKey];
      delete this.bookmarkData.images[oldKey];
      changed = true;
    }
    if (changed) await this.saveBookmarks();
  }

  async run() {
    // 사전 로드(즐겨찾기/북마크/폴더메타/휴지통)가 어떤 이유로 실패해도 super.run()
    // (주기 자동 저장 루프)에는 반드시 도달해야 한다 — 여기서 죽으면 앱은 멀쩡해 보여도
    // 이후 편집이 디스크에 저장되지 않아 통째로 유실된다(SDStudio 4.13.5 8ea25a4 결).
    try {
      await this.loadFavorites();
      await this.loadBookmarks();
      await this.loadFolderMeta();
      const { trashService } = await import('.');
      // trash.json은 legacy data (씬 휴지통이 아직 사용 중) — 로드 유지
      await trashService.loadTrash();
      // autoCleanup은 앱 시작을 블로킹하지 않도록 지연 실행
      setTimeout(() => {
        trashService.autoCleanup().catch((e) => {
          console.error('휴지통 자동 정리 실패:', e);
        });
      }, 10000);
    } catch (e) {
      console.error('세션 사전 로드 실패(자동 저장 루프는 계속 시작):', e);
    }
    await super.run();
  }

  async delete(name: string) {
    this.favorites.delete(name);
    await this.saveFavorites();
    // 북마크 정리 — 삭제 전 존재 여부 캡처 (delete 후 검사는 항상 falsy)
    const hadSceneBookmark = name in this.bookmarkData.scenes;
    delete this.bookmarkData.scenes[name];
    const keysToDelete = Object.keys(this.bookmarkData.images).filter(k => k.startsWith(name + ':'));
    keysToDelete.forEach(k => delete this.bookmarkData.images[k]);
    if (keysToDelete.length > 0 || hadSceneBookmark) {
      await this.saveBookmarks();
    }
    // 메모리 캐시 정리
    if (name in this.resources) {
      delete this.resources[name];
      this.disposes[name]();
      delete this.disposes[name];
    }
    // 로컬 파일 + Drive까지 즉시 영구 삭제 (휴지통 거치지 않음)
    await backend.deleteProjectNow(name);
    await this.update();
  }

  async rename(oldName: string, newName: string) {
    if (this.favorites.has(oldName)) {
      this.favorites.delete(oldName);
      this.favorites.add(newName);
      await this.saveFavorites();
    }
    // 북마크 마이그레이션
    let bmChanged = false;
    if (this.bookmarkData.scenes[oldName]) {
      this.bookmarkData.scenes[newName] = this.bookmarkData.scenes[oldName];
      delete this.bookmarkData.scenes[oldName];
      bmChanged = true;
    }
    const imageKeys = Object.keys(this.bookmarkData.images).filter(k => k.startsWith(oldName + ':'));
    imageKeys.forEach(k => {
      const sceneName = k.substring(oldName.length + 1);
      this.bookmarkData.images[newName + ':' + sceneName] = this.bookmarkData.images[k];
      delete this.bookmarkData.images[k];
      bmChanged = true;
    });
    if (bmChanged) await this.saveBookmarks();
    await super.rename(oldName, newName);
  }

  // ===== Folder API =====
  // 정책: basename은 전역 unique. 폴더는 단순 그룹핑. outs/inpaints/vibes는 평면 유지 (basename만 사용).
  // 빈 폴더는 디렉토리 자체로 표현 (마커 파일 없음 — listFilesRecursive가 빈 dirs도 반환).

  private folderPath(folderName: string): string {
    return 'projects/' + folderName;
  }
  private projectFilePath(name: string, folder: string | null): string {
    return folder ? 'projects/' + folder + '/' + name + '.json' : 'projects/' + name + '.json';
  }

  // 폴더 생성. 중첩: folderPath에 '/'가 있으면 하위 폴더('f1/f2'). 각 세그먼트 비어있지 않아야.
  async createFolder(folderPath: string): Promise<void> {
    const segs = (folderPath || '').split('/');
    if (!folderPath || segs.some((s) => s.trim() === '')) {
      throw new Error('폴더 이름이 올바르지 않습니다.');
    }
    // 서버 sanitizeFolderPath와 정렬 (진단 F2-7): '.' 시작 세그먼트('.keep', '..' 포함)
    // 차단 — createFolder는 fs/write 경유라 서버측 폴더 검증을 우회했음. DATA_DIR 밖은
    // resolvePath가 막지만 'projects/../vibes' 같은 자기 데이터 오염은 여기서 막아야 함.
    if (segs.some((s) => s.trim().startsWith('.'))) {
      throw new Error("폴더 이름은 '.'으로 시작할 수 없어요.");
    }
    if (segs.length > MAX_FOLDER_DEPTH) {
      throw new Error(`폴더는 최대 ${MAX_FOLDER_DEPTH}단계까지 중첩할 수 있어요.`);
    }
    if (this.folderList.includes(folderPath)) {
      throw new Error('이미 존재하는 폴더입니다.');
    }
    // 빈 디렉토리 생성: fs/write는 dirname auto-mkdir(중첩 path 자동 생성)이므로 .keep 마커
    // 후 즉시 삭제로 빈 (중첩) 디렉토리만 남김.
    const keepPath = this.folderPath(folderPath) + '/.keep';
    await backend.writeFile(keepPath, '');
    try { await backend.deleteFile(keepPath); } catch {}
    await this.update();
  }

  // 폴더 이름 변경. oldPath는 (중첩) 전체 경로, newLeaf는 *마지막 단계 이름*(슬래시 없음).
  // 부모 경로는 보존하고 leaf만 바꾼다 ('f1/f2' rename → 'f1/newLeaf').
  async renameFolder(oldPath: string, newLeaf: string): Promise<void> {
    if (!newLeaf || newLeaf.includes('/') || newLeaf.trim() === '') {
      throw new Error('폴더 이름이 올바르지 않습니다.');
    }
    const lastSlash = oldPath.lastIndexOf('/');
    const parent = lastSlash >= 0 ? oldPath.substring(0, lastSlash) : '';
    const newPath = parent ? parent + '/' + newLeaf : newLeaf;
    if (oldPath === newPath) return;
    if (this.folderList.includes(newPath)) {
      throw new Error('이미 존재하는 폴더입니다.');
    }
    await backend.renameDir(this.folderPath(oldPath), this.folderPath(newPath));
    // 색상·순서 메타는 폴더 자신 + 하위까지 path 키 마이그레이션(누락 시 색상·순서 유실).
    this.migrateFolderMeta(oldPath, newPath);
    await this.saveFolderMeta();
    // folderMap에 추적되던 프로젝트들의 folder 갱신은 update() 한 번이면 충분.
    await this.update();
  }

  // 폴더(하위 폴더·프로젝트 통째)를 다른 폴더 *안*으로 이동. newParent=null이면 최상위로.
  async moveFolder(folderPath: string, newParent: string | null): Promise<void> {
    const lastSlash = folderPath.lastIndexOf('/');
    const leaf = lastSlash >= 0 ? folderPath.substring(lastSlash + 1) : folderPath;
    const curParent = lastSlash >= 0 ? folderPath.substring(0, lastSlash) : '';
    const targetParent = newParent ?? '';
    if (curParent === targetParent) return; // 이미 그 부모 아래
    // 자기 자신 또는 하위로 이동 금지(순환).
    if (newParent && (newParent === folderPath || newParent.startsWith(folderPath + '/'))) {
      throw new Error('폴더를 자기 자신 또는 하위 폴더로 옮길 수 없어요.');
    }
    if (newParent && !this.folderList.includes(newParent)) {
      throw new Error('대상 폴더가 존재하지 않습니다.');
    }
    const newPath = targetParent ? targetParent + '/' + leaf : leaf;
    if (this.folderList.includes(newPath)) {
      throw new Error('대상 위치에 같은 이름의 폴더가 이미 있어요.');
    }
    // 가장 깊은 하위 폴더가 이동 후 MAX 깊이를 넘지 않는지 검사.
    const subtree = this.folderList.filter((k) => k === folderPath || k.startsWith(folderPath + '/'));
    const maxSubSegs = Math.max(...subtree.map((k) => k.split('/').length));
    const newDeepest = maxSubSegs - folderPath.split('/').length + newPath.split('/').length;
    if (newDeepest > MAX_FOLDER_DEPTH) {
      throw new Error(`폴더는 최대 ${MAX_FOLDER_DEPTH}단계까지 중첩할 수 있어요.`);
    }
    await backend.renameDir(this.folderPath(folderPath), this.folderPath(newPath));
    this.migrateFolderMeta(folderPath, newPath);
    await this.saveFolderMeta();
    await this.update();
  }

  // 폴더 경로 변경(rename/move) 시 색상·순서 메타 키를 폴더 자신 + 모든 하위 폴더까지 prefix
  // 치환한다. oldPath='f1', newPath='x/f1'이면 'f1'→'x/f1', 'f1/sub'→'x/f1/sub'. 디스크는
  // renameDir이 subtree 통째 이동하지만 색상/순서는 path 키라 따로 옮겨야 유실 안 됨.
  private migrateFolderMeta(oldPath: string, newPath: string): void {
    const matches = (k: string) => k === oldPath || k.startsWith(oldPath + '/');
    const remap = (k: string) => newPath + k.slice(oldPath.length);
    const newColors: Record<string, string> = {};
    for (const [k, v] of Object.entries(this.folderColors)) {
      newColors[matches(k) ? remap(k) : k] = v;
    }
    this.folderColors = newColors;
    this.folderOrder = this.folderOrder.map((k) => (matches(k) ? remap(k) : k));
  }

  async deleteFolder(folderName: string): Promise<void> {
    // 폴더 안 N 프로젝트 영구 삭제 + 폴더 dir + Drive. rclone Drive purge 다수로 수 분
    // 걸려(7개 ~2.5분) 서버 fire-and-forget + WS 진행도 방식 (App.tsx 글로벌 구독이
    // 진행/완료 처리). 옛 동기 응답은 사용자가 응답을 못 기다리고 재클릭 → 동시 호출
    // race로 readdir 스냅샷이 chunk(3)씩만 줄어 "3개만 삭제 + 폴더 잔류"하던 페인 (2026-06-02).
    if (this.deletingFolders.has(folderName)) {
      throw new Error(`"${folderName}" 폴더 삭제가 이미 진행 중이에요.`);
    }
    // 폴더 자신 + 모든 하위 폴더 프로젝트(중첩). 서버는 projects/<folder> 트리를 통째 삭제하므로
    // 하위 프로젝트의 클라 메모리 캐시/북마크/즐겨찾기도 같이 정리해야 잔재(stale)가 안 남는다.
    const projectsInFolder = this.resourceList.filter(
      (n) => this.folderMap[n] === folderName || (this.folderMap[n] || '').startsWith(folderName + '/'),
    );
    // 메모리 캐시 + 북마크 + 즐겨찾기 정리는 클라가 책임 — 서버가 모르는 정보.
    let bmChanged = false;
    let favChanged = false;
    for (const projName of projectsInFolder) {
      if (this.favorites.has(projName)) {
        this.favorites.delete(projName);
        favChanged = true;
      }
      if (projName in this.bookmarkData.scenes) {
        delete this.bookmarkData.scenes[projName];
        bmChanged = true;
      }
      const imageKeys = Object.keys(this.bookmarkData.images).filter(k => k.startsWith(projName + ':'));
      for (const k of imageKeys) {
        delete this.bookmarkData.images[k];
        bmChanged = true;
      }
      if (projName in this.resources) {
        delete this.resources[projName];
        this.disposes[projName]();
        delete this.disposes[projName];
      }
    }
    if (favChanged) await this.saveFavorites();
    if (bmChanged) await this.saveBookmarks();
    // 서버 백그라운드 삭제 시작 (즉시 jobId 반환). 진행도/완료는 App.tsx 글로벌 구독이
    // pinnedProgress + update()로 처리. deletingFolders는 그 done/error에서 해제.
    this.deletingFolders.add(folderName);
    let start;
    try {
      start = await backend.deleteFolderNow(folderName);
    } catch (e) {
      this.deletingFolders.delete(folderName);
      throw e;
    }
    if (start.alreadyRunning) {
      // 다른 경로(다른 탭/기기)로 이미 진행 중 — 기존 job의 진행/완료를 글로벌 구독이
      // cover. 이 클라가 추가로 잡은 guard는 그 done 때 함께 해제됨. 낙관적 UI 갱신만.
      await this.update();
    }
  }

  async moveToFolder(name: string, targetFolder: string | null): Promise<void> {
    const currentFolder = this.folderMap[name] ?? null;
    if (currentFolder === targetFolder) return;
    // targetFolder는 (중첩) 폴더 path. 존재만 검증(중첩 path는 folderList에 그대로 들어있음).
    if (targetFolder && !this.folderList.includes(targetFolder)) {
      throw new Error('대상 폴더가 존재하지 않습니다.');
    }
    const srcPath = this.projectFilePath(name, currentFolder);
    const destPath = this.projectFilePath(name, targetFolder);
    await backend.renameFile(srcPath, destPath);
    this.folderMap[name] = targetFolder;
    await this.update();
  }

  async getHook(rc: Session, name: string) {
    rc.name = name;
  }

  async migrate(rc: any) {
    if (!rc.version) {
      await backend.writeFile(
        'projects/' + rc.name + '.json.bak',
        JSON.stringify(rc),
      );
      rc = await legacy.migrateSession(rc);
    }
    if (Array.isArray(rc.presets)) {
      await legacy.recoverSession(rc);
    }
    await this.migrateSession(rc);
    console.log('migrated', rc);
    return rc;
  }

  // dummy = prototype access만 필요한 빈 인스턴스. importDefaultPresets 호출 X
  // (P12 #8 인터넷 느린 환경 cascade 회피). add()는 createDefault로 계속 갈래.
  createDummy(): Session {
    return new Session();
  }

  async createDefault(name: string) {
    const newSession = Session.fromJSON({
      name: name,
      version: 1,
      presets: {},
      inpaints: {},
      scenes: Object.fromEntries([
        [
          'default',
          {
            type: 'scene',
            name: 'default',
            resolution: 'portrait',
            slots: [[{ prompt: '', characterPrompts: [], id: v4() }]],
            game: undefined,
            round: undefined,
            meta: {},
            imageMap: [],
            mains: [],
          },
        ],
      ]),
      library: {},
      presetShareds: {},
    });
    await importDefaultPresets(newSession);
    return newSession;
  }

  getInpaintOrgPath(session: Session, inpaint: InpaintScene) {
    return 'inpaint_orgs/' + session.name + '/' + inpaint.name + '.png';
  }

  getInpaintMaskPath(session: Session, inpaint: InpaintScene) {
    return 'inpaint_masks/' + session.name + '/' + inpaint.name + '.png';
  }

  async exportSessionShallow(session: Session) {
    const sess: ISession = session.toJSON();
    if (sess.presetShareds.SDImageGenEasy) {
      sess.presetShareds.SDImageGenEasy.vibes = [];
    }
    if (sess.presetShareds.SDImageGen) {
      sess.presetShareds.SDImageGen.vibes = [];
    }
    for (const scene of Object.values(sess.scenes)) {
      scene.game = undefined;
      scene.round = undefined;
      scene.imageMap = [];
      scene.mains = [];
    }
    sess.inpaints = {};

    for (const presetSet of Object.values(sess.presets)) {
      for (const preset of presetSet) {
        if (preset.profile) {
          try {
            const data = (await imageService.fetchVibeImage(
              session,
              preset.profile,
            ))!;
            const base64 = dataUriToBase64(data);
            preset.profile = base64;
          } catch (e) {}
        }
      }
    }
    return sess;
  }

  async exportSessionDeep(session: Session, outPath: string) {
    const ignoreError = async (f: Promise<any>) => {
      try {
        return await f;
      } catch (e) {
        return [];
      }
    };

    // 폴더 안 프로젝트는 projects/<폴더>/<이름>.json — getPath(folderMap 기반)가 정본.
    // 옛 루트 고정 경로는 폴더 프로젝트에서 project.json이 tar에 silent 누락되는 버그(진단 H2).
    const projFile = this.getPath(session.name);
    const entries: FileEntry[] = [];
    for (const scene of session.scenes.values()) {
      const images = await ignoreError(
        backend.listFiles('outs/' + session.name + '/' + scene.name),
      );
      for (const image of images) {
        if (!image.endsWith('.png')) continue;
        entries.push({
          path: 'outs/' + session.name + '/' + scene.name + '/' + image,
          name: 'outs/' + scene.name + '/' + image,
        });
      }
    }
    const inpaintOrgs = await ignoreError(
      backend.listFiles('inpaint_orgs/' + session.name),
    );
    const inpaintMasks = await ignoreError(
      backend.listFiles('inpaint_masks/' + session.name),
    );
    for (const image of inpaintOrgs) {
      if (!image.endsWith('.png')) continue;
      entries.push({
        path: 'inpaint_orgs/' + session.name + '/' + image,
        name: 'inpaint_orgs/' + image,
      });
    }
    for (const image of inpaintMasks) {
      if (!image.endsWith('.png')) continue;
      entries.push({
        path: 'inpaint_masks/' + session.name + '/' + image,
        name: 'inpaint_masks/' + image,
      });
    }
    for (const inpaint of session.inpaints.values()) {
      const inpaints = await ignoreError(
        backend.listFiles('inpaints/' + session.name + '/' + inpaint.name),
      );
      for (const image of inpaints) {
        if (!image.endsWith('.png')) continue;
        entries.push({
          path: 'inpaints/' + session.name + '/' + inpaint.name + '/' + image,
          name: 'inpaints/' + inpaint.name + '/' + image,
        });
      }
    }
    const vibes = await ignoreError(backend.listFiles('vibes/' + session.name));
    for (const vibe of vibes) {
      if (!vibe.endsWith('.png')) continue;
      entries.push({
        path: 'vibes/' + session.name + '/' + vibe,
        name: 'vibes/' + vibe,
      });
    }
    const references = await ignoreError(backend.listFiles('references/' + session.name));
    for (const ref of references) {
      if (!ref.endsWith('.png')) continue;
      entries.push({
        path: 'references/' + session.name + '/' + ref,
        name: 'references/' + ref,
      });
    }
    entries.push({ path: projFile, name: 'project.json' });
    // zipFiles 자체가 outPath 중복을 throw로 막음 — 외부 사전 체크 제거 (서로 다른 outPath는 병렬 OK).
    // 서버 zip은 없는 파일을 silent skip(skipped[])하므로 호출부가 경고할 수 있게 반환 (진단 H2b).
    return await zipService.zipFiles(entries, outPath);
  }

  // 폴더 전체 백업. 안의 N개 프로젝트를 1개 tar로 묶음. tar 내부 layout은
  // {projectName}/project.json + {projectName}/outs|inpaints|inpaint_orgs|
  // inpaint_masks|vibes/... 로 namespace. root에 folder-backup.json 마커.
  //
  // 성능: 프로젝트 1개 내부 5개 디렉토리는 listFilesRecursive로 한 번씩(병렬) 조회 →
  // 씬/inpaint별 N round-trip 제거. 프로젝트들은 CHUNK=4 동시 처리 (exportFolder와 동일 패턴).
  // session 객체 로드 불필요 — 디스크 파일만 있으면 충분 (in-memory에서 삭제된 orphan도 포함되니
  // 백업이 더 robust).
  async exportFolderDeep(
    folderName: string,
    projectNames: string[],
    outPath: string,
    onProgress?: (text: string, done: number, total: number) => void,
    includeImages: boolean = true,
  ) {
    const emptyResult = { files: [] as string[], dirs: [] as string[] };
    const ignoreError = async (
      f: Promise<{ files: string[]; dirs: string[] }>,
    ): Promise<{ files: string[]; dirs: string[] }> => {
      try {
        return await f;
      } catch (e) {
        return emptyResult;
      }
    };

    // 한 프로젝트의 모든 미디어 파일을 6번 병렬 listFilesRecursive로 수집.
    // outs/inpaints는 nested (depth=1), inpaint_orgs/inpaint_masks/vibes/references는 flat (depth=0).
    // includeImages=true → tar 안 layout {name}/project.json + {name}/outs|inpaints|... (nested).
    // includeImages=false → tar 안 layout {name}.json (flat, 폴더 감싸지 않음).
    const collectProjectEntries = async (name: string): Promise<FileEntry[]> => {
      const items: FileEntry[] = [];
      if (includeImages) {
        const [outs, inpaints, inpaintOrgs, inpaintMasks, vibes, references] = await Promise.all([
          ignoreError(backend.listFilesRecursive('outs/' + name, 1)),
          ignoreError(backend.listFilesRecursive('inpaints/' + name, 1)),
          ignoreError(backend.listFilesRecursive('inpaint_orgs/' + name, 0)),
          ignoreError(backend.listFilesRecursive('inpaint_masks/' + name, 0)),
          ignoreError(backend.listFilesRecursive('vibes/' + name, 0)),
          ignoreError(backend.listFilesRecursive('references/' + name, 0)),
        ]);
        const pushSrc = (
          srcRoot: string,
          tarRoot: string,
          relList: string[],
        ) => {
          for (const rel of relList) {
            if (!rel.endsWith('.png')) continue;
            items.push({
              path: srcRoot + '/' + rel,
              name: tarRoot + '/' + rel,
            });
          }
        };
        pushSrc('outs/' + name, name + '/outs', outs.files);
        pushSrc('inpaints/' + name, name + '/inpaints', inpaints.files);
        pushSrc('inpaint_orgs/' + name, name + '/inpaint_orgs', inpaintOrgs.files);
        pushSrc('inpaint_masks/' + name, name + '/inpaint_masks', inpaintMasks.files);
        pushSrc('vibes/' + name, name + '/vibes', vibes.files);
        pushSrc('references/' + name, name + '/references', references.files);
        items.push({ path: this.getPath(name), name: name + '/project.json' });
      } else {
        // light 백업: media 디렉터리 list skip + project.json을 폴더 없이 {name}.json로.
        items.push({ path: this.getPath(name), name: name + '.json' });
      }
      return items;
    };

    const entries: FileEntry[] = [];
    const total = projectNames.length;
    const CHUNK = 4;
    let done = 0;
    for (let i = 0; i < projectNames.length; i += CHUNK) {
      const chunk = projectNames.slice(i, i + CHUNK);
      const results = await Promise.all(chunk.map(collectProjectEntries));
      for (const items of results) entries.push(...items);
      done += chunk.length;
      onProgress?.(`경로 수집 ${done}/${total}`, done, total + 1);
    }

    // 마커: import 시 folder-backup 식별 + 프로젝트 목록 + 원본 폴더명 복원.
    // format: 'nested' (옛 default, 이미지 포함) / 'flat' (light, {name}.json만).
    const markerPath = 'tmp/folder-backup-marker-' + v4() + '.json';
    const marker = {
      type: 'folder-backup',
      folder: folderName,
      projects: projectNames,
      version: 1,
      format: includeImages ? 'nested' : 'flat',
      exportedAt: Date.now(),
    };
    await backend.writeFile(markerPath, JSON.stringify(marker));
    entries.push({ path: markerPath, name: 'folder-backup.json' });

    // zipFiles가 outPath 단위 중복을 throw로 막음 — 외부 사전 체크 제거 (서로 다른 폴더는 병렬 OK).
    onProgress?.('아카이브 압축 중...', total, total + 1);
    try {
      // 서버 zip의 silent skip(skipped[])을 호출부 경고용으로 반환 (진단 H2b).
      const zipResult = await zipService.zipFiles(entries, outPath);
      onProgress?.('완료', total + 1, total + 1);
      return zipResult;
    } finally {
      try {
        await backend.deleteFile(markerPath);
      } catch {}
    }
  }

  // 폴더 전체 백업 import. tar 안 folder-backup.json 마커로 검증 + 프로젝트 목록 추출.
  // 이름 충돌 시 auto-suffix (_2, _3, ...). 대상 폴더 없으면 자동 생성, 있으면 머지.
  async importFolderDeep(
    tarpath: string,
    requestedFolder: string,
    onProgress?: (text: string, done: number, total: number) => void,
  ): Promise<{
    imported: string[];
    renamed: { from: string; to: string }[];
    skipped: { name: string; reason: string }[];
    folder: string;
  }> {
    const tmpDir = 'tmp/' + v4();
    const PHASE_TOTAL = 4;
    onProgress?.('아카이브 풀기...', 0, PHASE_TOTAL);
    await backend.unzipFiles(tarpath, tmpDir);

    onProgress?.('백업 검증 중...', 1, PHASE_TOTAL);
    let marker: any;
    try {
      const raw = await backend.readFile(tmpDir + '/folder-backup.json');
      marker = JSON.parse(raw);
    } catch (e) {
      throw new Error(
        '폴더 백업 파일이 아닙니다 (folder-backup.json 누락). 단일 프로젝트 백업은 "프로젝트 백업 (.tar)" 메뉴로 불러주세요.',
      );
    }
    if (marker?.type !== 'folder-backup' || !Array.isArray(marker.projects)) {
      throw new Error('폴더 백업 형식이 올바르지 않습니다.');
    }
    const projectsInBackup: string[] = marker.projects.filter(
      (x: any) => typeof x === 'string',
    );
    // format 누락 = v1 옛 백업 (항상 nested layout).
    const isFlat = marker.format === 'flat';

    if (!this.folderList.includes(requestedFolder)) {
      await this.createFolder(requestedFolder);
    }

    // 충돌 회피 — 같은 이름이 활성 목록에 있으면 _2, _3 ... suffix.
    // base가 이미 _N suffix를 가진 경우(예: "세인 pen_2"), 원본 base("세인 pen")가
    // existing에 있으면 suffix를 떼고 다음 번호로 ("세인 pen_3"). _2_2 방지.
    const existing = new Set(this.resourceList);
    const allocateName = (base: string): string => {
      if (!existing.has(base)) return base;
      const m = base.match(/^(.+)_(\d+)$/);
      const root = m && existing.has(m[1]) ? m[1] : base;
      let i = 2;
      while (existing.has(root + '_' + i)) i++;
      return root + '_' + i;
    };

    const imported: string[] = [];
    const renamed: { from: string; to: string }[] = [];
    const skipped: { name: string; reason: string }[] = [];

    const total = projectsInBackup.length;
    for (let i = 0; i < projectsInBackup.length; i++) {
      const origName = projectsInBackup[i];
      const finalName = allocateName(origName);
      onProgress?.(
        `프로젝트 등록 ${i + 1}/${total} (${finalName})`,
        2,
        PHASE_TOTAL,
      );
      const projDir = tmpDir + '/' + origName;
      // flat 백업은 {name}.json 단독, nested 백업은 {name}/project.json + 미디어 dir들.
      const projJsonPath = isFlat
        ? tmpDir + '/' + origName + '.json'
        : projDir + '/project.json';

      let sessionData: ISession;
      try {
        sessionData = JSON.parse(await backend.readFile(projJsonPath));
      } catch (e: any) {
        skipped.push({
          name: origName,
          reason: isFlat
            ? `${origName}.json 누락 또는 파싱 실패`
            : 'project.json 누락 또는 파싱 실패',
        });
        continue;
      }
      sessionData.name = finalName;
      existing.add(finalName);
      if (finalName !== origName) renamed.push({ from: origName, to: finalName });

      if (!isFlat) {
        const renameSafe = async (src: string, dst: string) => {
          try {
            await backend.renameDir(src, dst);
          } catch (e) {
            // 빈/없는 디렉토리 — 정상 케이스
          }
        };
        await Promise.all([
          renameSafe(projDir + '/outs', 'outs/' + finalName),
          renameSafe(projDir + '/inpaints', 'inpaints/' + finalName),
          renameSafe(projDir + '/inpaint_orgs', 'inpaint_orgs/' + finalName),
          renameSafe(projDir + '/inpaint_masks', 'inpaint_masks/' + finalName),
          renameSafe(projDir + '/vibes', 'vibes/' + finalName),
          renameSafe(projDir + '/references', 'references/' + finalName),
        ]);
      }

      try {
        await this.createFrom(finalName, sessionData);
        await this.moveToFolder(finalName, requestedFolder);
        imported.push(finalName);
      } catch (e: any) {
        skipped.push({ name: origName, reason: e?.message ?? String(e) });
      }
    }

    onProgress?.('완료', PHASE_TOTAL, PHASE_TOTAL);
    return { imported, renamed, skipped, folder: requestedFolder };
  }

  // folder 인자: import 직후 그 폴더로 이동. null = 루트 (기존 default).
  // 옛 import는 항상 루트 — curSession이 폴더에 있어도 새 프로젝트는 폴더없음으로 가던 페인 (P18).
  async importSessionShallow(session: ISession, name: string, folder?: string | null) {
    if (name in this.resources) {
      throw new Error('Resource already exists');
    }
    session.name = name;

    // Phase 7A: preset profile (vibe reference base64) 업로드 병렬화
    // 기존: for-await 직렬 처리로 N x 라운드트립
    // 신규: Promise.all로 1 x 라운드트립
    const profileUploadTasks: Promise<void>[] = [];
    const enqueueProfileUpload = (preset: any) => {
      if (!preset?.profile) return;
      const path = 'vibes/' + name + '/' + v4() + '.png';
      const profileData = preset.profile;
      profileUploadTasks.push(
        backend
          .writeDataFile(path, profileData)
          .then(() => {
            preset.profile = path.split('/').pop()!;
          })
          .catch((e) => {
            console.warn('[importSessionShallow] profile upload failed:', e);
          }),
      );
    };

    if (Array.isArray(session.presets)) {
      for (const preset of session.presets) {
        if (preset.type === 'style') enqueueProfileUpload(preset);
      }
    } else if (session.presets) {
      for (const presetSet of Object.values(session.presets)) {
        for (const preset of presetSet) enqueueProfileUpload(preset);
      }
    }

    if (profileUploadTasks.length > 0) {
      await Promise.all(profileUploadTasks);
    }

    await this.createFrom(name, session);
    if (folder) {
      try {
        await this.moveToFolder(name, folder);
      } catch (e) {
        // 폴더가 사라진 edge case — silent skip, 루트에 잔류 (사용자가 메뉴로 이동 가능).
        console.warn('[importSessionShallow] moveToFolder skipped:', e);
      }
    }
  }

  async importSessionDeep(
    tarpath: string,
    name: string,
    onProgress?: (text: string, done: number, total: number) => void,
  ) {
    if (name in this.resources) {
      throw new Error('Resource already exists');
    }
    const path = 'tmp/' + v4();

    // 3단계: unzip → media 이동 (5개 동시) → session 생성
    onProgress?.('아카이브 풀기...', 0, 3);
    await backend.unzipFiles(tarpath, path);

    onProgress?.('미디어 파일 이동...', 1, 3);
    const session: Session = JSON.parse(
      await backend.readFile(path + '/project.json'),
    );
    session.name = name;

    // 6개 renameDir를 직렬에서 병렬로 (디렉토리들이 서로 독립적이라 안전).
    // 폴더가 비어있거나 없을 수도 있어서 각자 catch.
    const renameSafe = async (src: string, dst: string) => {
      try {
        await backend.renameDir(src, dst);
      } catch (e) {
        // 빈/없는 디렉토리 — 정상 케이스 (백업에 outs 등이 없을 수 있음)
      }
    };
    await Promise.all([
      renameSafe(path + '/outs', 'outs/' + session.name),
      renameSafe(path + '/inpaints', 'inpaints/' + session.name),
      renameSafe(path + '/inpaint_orgs', 'inpaint_orgs/' + session.name),
      renameSafe(path + '/inpaint_masks', 'inpaint_masks/' + session.name),
      renameSafe(path + '/vibes', 'vibes/' + session.name),
      renameSafe(path + '/references', 'references/' + session.name),
    ]);

    onProgress?.('프로젝트 등록...', 2, 3);
    await this.createFrom(name, session);
    onProgress?.('완료', 3, 3);
  }

  async migrateSession(session: ISession) {
    const types = ['SDImageGen', 'SDImageGenEasy'];
    for (const type of types) {
      if (session.presetShareds[type]) {
        for (const vibe of session.presetShareds[type].vibes) {
          if (vibe.path) vibe.path = vibe.path.split('/').pop()!;
        }
      }
    }
  }

  async saveInpaintImages(
    session: Session,
    inpaint: InpaintScene,
    image: string,
    mask: string,
  ) {
    // 2-phase commit: 둘 다 .tmp로 먼저 쓰고, 둘 다 성공 시 rename. write 중
    // crash/실패가 가장 흔하므로 그 케이스에서 옛 org/mask 페어 보존 (한쪽만
    // 갱신되는 inconsistent state 회피).
    const orgPath = this.getInpaintOrgPath(session, inpaint);
    const maskPath = this.getInpaintMaskPath(session, inpaint);
    const orgTmp = orgPath + '.tmp';
    const maskTmp = maskPath + '.tmp';
    try {
      await backend.writeDataFile(orgTmp, image);
      await backend.writeDataFile(maskTmp, mask);
    } catch (e) {
      try { await backend.deleteFile(orgTmp); } catch {}
      try { await backend.deleteFile(maskTmp); } catch {}
      throw e;
    }
    await backend.renameFile(orgTmp, orgPath);
    await backend.renameFile(maskTmp, maskPath);
    await imageService.invalidateCache(orgPath);
    await imageService.invalidateCache(maskPath);
  }

  styleEdit(preset: any, container: any) {
    this.dispatchEvent(
      new CustomEvent('style-edit', { detail: { preset, container } }),
    );
  }

  configChanged(): void {
    this.dispatchEvent(new CustomEvent('config-changed'));
  }

  async reloadPieceLibraryDB(session: Session) {
    const res: string[] = [];
    const localKeys = new Set<string>();
    for (const [k, v] of session.library.entries()) {
      for (const piece of v.pieces) {
        const key = k + '.' + piece.name;
        res.push(key);
        localKeys.add(key);
      }
    }
    // 전역 조각 추가 (로컬과 동명인 경우 스킵)
    try {
      const { globalPieceService } = await import('.');
      for (const [k, v] of globalPieceService.library.entries()) {
        for (const piece of v.pieces) {
          const key = k + '.' + piece.name;
          if (!localKeys.has(key)) {
            res.push(key);
          }
        }
      }
    } catch (e) {}
    await backend.loadPiecesDB(res);
  }
}

export async function importDefaultPresets(session: Session) {
  // 글로벌 프리셋 서비스에서 "기본" 플래그 지정된 것들을 먼저 시도
  // 순환 임포트 방지를 위해 동적 import 사용
  let hadGlobalDefaults = false;
  try {
    const mod = await import('.');
    const globalPresetService = (mod as any).globalPresetService;
    if (globalPresetService) {
      if (!globalPresetService.loaded) {
        await globalPresetService.load();
      }
      const easyDefaults = globalPresetService.getDefaults('SDImageGenEasy');
      const genDefaults = globalPresetService.getDefaults('SDImageGen');
      for (const entry of [...easyDefaults, ...genDefaults]) {
        try {
          await globalPresetService.instantiateIntoSession(session, entry.id);
          hadGlobalDefaults = true;
        } catch (e) {
          console.warn(
            'Failed to instantiate global default preset:',
            entry?.name,
            e,
          );
        }
      }
    }
  } catch (e) {
    console.warn('GlobalPresetService unavailable during session init:', e);
  }

  // Fallback: SDImageGenEasy 프리셋이 비어있으면 기존 defaultassets 시드
  // (신규 설치 첫 실행 UX 보존)
  const hasEasyPresets =
    session.presets.has('SDImageGenEasy') &&
    session.presets.get('SDImageGenEasy')!.length > 0;
  if (!hasEasyPresets) {
    if (!session.presets.has('SDImageGenEasy')) {
      session.presets.set('SDImageGenEasy', []);
    }
    const images = await Promise.all(
      defaultassets.map((x) => fetch(x).then((res) => res.blob())),
    );
    for (const image of images) {
      const datauri = await blobToDataUri(image);
      await importPreset(session, dataUriToBase64(datauri));
    }
  }
}
function blobToDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = (e) => reject(e);
    reader.readAsDataURL(blob);
  });
}

export function embedJSONInPNG(inputBase64: string, jsonData: any) {
  const inputBuffer = Buffer.from(inputBase64, 'base64');
  const chunks = extractChunks(inputBuffer);

  const jsonTextChunk = PngChunk.encode(
    'tEXt',
    'json:' + Buffer.from(JSON.stringify(jsonData)).toString('base64'),
  );
  chunks.splice(1, 0, jsonTextChunk);
  const outputBuffer = Buffer.from(encodeChunks(chunks));
  const outputBase64 = outputBuffer.toString('base64');
  return outputBase64;
}

export function readJSONFromPNG(base64PNG: string) {
  try {
    const buffer = Buffer.from(base64PNG, 'base64');
    const chunks = extractChunks(buffer);
    const jsonChunk = chunks.find((chunk) => chunk.name === 'tEXt');
    if (jsonChunk) {
      let base64JsonData = Buffer.from(jsonChunk.data).toString();
      const startIndex = base64JsonData.indexOf('json:') + 5;
      base64JsonData = base64JsonData.slice(startIndex);
      const jsonData = JSON.parse(
        Buffer.from(base64JsonData, 'base64').toString(),
      );
      return jsonData;
    } else {
      return undefined;
    }
  } catch (e) {
    return undefined;
  }
}

/**
 * 레거시 프리셋 JSON을 현재 스키마로 정규화.
 * - type === 'style' 이면 SDImageGenEasy로 변환
 * - 다른 타입이면 그대로 반환
 */
export function normalizePresetJson(json: any): any {
  if (!json || !json.type) return json;
  if (json.type === 'style') {
    const newJson: any = {};
    newJson.type = 'SDImageGenEasy';
    newJson.name = json.name;
    newJson.profile = json.profile;
    newJson.sampling = json.sampling ?? Sampling.KEulerAncestral;
    newJson.noiseSchedule = json.noiseSchedule ?? 'karras';
    newJson.promptGuidance = json.promptGuidance ?? 5;
    newJson.cfgRescale = json.cfgRescale ?? 0;
    newJson.frontPrompt = json.frontPrompt;
    newJson.backPrompt = json.backPrompt;
    newJson.uc = json.uc;
    newJson.steps = json.steps ?? 28;
    return newJson;
  }
  return json;
}

export async function importPreset(session: Session, base64: string) {
  let json = readJSONFromPNG(base64);
  if (!json || !json.type || !json.name) {
    return undefined;
  }
  json = normalizePresetJson(json);
  const path = await imageService.storeVibeImage(session, base64);
  json.profile = path;
  const preset = workFlowService.presetFromJSON(json);
  session.addPreset(preset);
  return preset;
}

export const getResultDirectory = (session: Session, scene: GenericScene) => {
  if (scene.type === 'scene') {
    return imageService.getImageDir(session, scene);
  }
  return imageService.getInPaintDir(session, scene);
};

// type으로 scenes/inpaints Map을 구분 (진단 H3a — 옛 코드는 scenes 전용이라 인페인트
// 씬 rename 시 이미지 dir만 이동 후 TypeError로 파일/씬 연결이 끊어졌음).
// 가드는 dir 이동 *앞* — Map에 없으면 아무것도 옮기기 전에 throw (고아 dir 방지).
export const renameScene = async (
  session: Session,
  oldName: string,
  newName: string,
  type: 'scene' | 'inpaint' = 'scene',
) => {
  newName = newName.trimEnd();
  const map = (
    type === 'inpaint' ? session.inpaints : session.scenes
  ) as Map<string, GenericScene>;
  const scene = map.get(oldName);
  if (!scene) {
    throw new Error(`씬 "${oldName}"을(를) 찾을 수 없어요 (${type})`);
  }
  await imageService.onRenameScene(session, oldName, newName);
  scene.name = newName;
  map.delete(oldName);
  map.set(newName, scene);
  // 씬이름 키 부가 데이터 이전 — 북마크(이동)·토글그룹 정의(복사, 일반 씬 전용 UI).
  const { sessionService, toggleGroupService } = await import('.');
  await sessionService.onSceneRenamed(session.name, oldName, newName, type);
  if (type === 'scene') {
    toggleGroupService.copyGroupsOnSceneRename(oldName, newName);
  }
};

// 씬 병합: sourceName 씬을 기존 targetName 씬으로 합친다. (SDStudio 4.13 97a6aca 이식)
// - 이미지: source → target 폴더로 이동(파일명 충돌 시 재지정, 손실 없음)
// - 프롬프트/설정: 기존(target) 씬 것을 유지하고 source 씬은 제거한다.
// type 으로 scenes/inpaints 를 구분(우리 renameScene 은 scenes 전용이지만,
// 병합은 일반 씬·인페인트 씬 모두 안전하게 처리한다).
export const mergeScene = async (
  session: Session,
  sourceName: string,
  targetName: string,
  type: 'scene' | 'inpaint',
) => {
  if (sourceName === targetName) return;
  const map = type === 'inpaint' ? session.inpaints : session.scenes;
  const target = map.get(targetName);
  if (!target) return;
  await imageService.mergeSceneImages(session, sourceName, targetName);
  map.delete(sourceName);
  // 합쳐진 이미지가 target 씬에 즉시 반영되도록 갱신
  await imageService.refresh(session, target);
};

export function createImageWithText(
  width: number,
  height: number,
  text: string,
  fontSize: number = 30,
  fontFamily: string = 'Arial',
  textColor: string = 'black',
  backgroundColor: string = 'white',
) {
  const canvas: HTMLCanvasElement = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx: CanvasRenderingContext2D | null = canvas.getContext('2d');

  if (!ctx) {
    throw new Error('Unable to get 2D context from canvas');
  }

  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = textColor;
  ctx.font = `${fontSize}px ${fontFamily}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.fillText(text, width / 2, height / 2);

  return dataUriToBase64(canvas.toDataURL('image/png'));
}
