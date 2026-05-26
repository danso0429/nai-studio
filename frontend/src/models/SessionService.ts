import extractChunks from 'png-chunks-extract';
import { Buffer } from 'buffer';
import { v4 } from 'uuid';
import { backend, imageService, workFlowService, zipService } from '.';
import { FileEntry } from '../backend';
import defaultassets from '../defaultassets';
import { dataUriToBase64 } from './ImageService';
import { ResourceSyncService } from './ResourceSyncService';
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
  // 진행 중인 프로젝트 영구 삭제 추적. 같은 프로젝트의 중복 enqueue 방지용.
  deletingProjects: Set<string> = new Set();

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

  async run() {
    await this.loadFavorites();
    await this.loadBookmarks();
    const { trashService } = await import('.');
    // trash.json은 legacy data (씬 휴지통이 아직 사용 중) — 로드 유지
    await trashService.loadTrash();
    await trashService.autoCleanup();
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

  async createFolder(folderName: string): Promise<void> {
    if (!folderName || folderName.includes('/')) {
      throw new Error('폴더 이름이 올바르지 않습니다.');
    }
    if (this.folderList.includes(folderName)) {
      throw new Error('이미 존재하는 폴더입니다.');
    }
    // 빈 디렉토리 생성: fs/write는 dirname auto-mkdir이므로 .keep 마커 후 즉시 삭제로 빈 디렉토리만 남김.
    const keepPath = this.folderPath(folderName) + '/.keep';
    await backend.writeFile(keepPath, '');
    try { await backend.deleteFile(keepPath); } catch {}
    await this.update();
  }

  async renameFolder(oldName: string, newName: string): Promise<void> {
    if (!newName || newName.includes('/')) {
      throw new Error('폴더 이름이 올바르지 않습니다.');
    }
    if (oldName === newName) return;
    if (this.folderList.includes(newName)) {
      throw new Error('이미 존재하는 폴더입니다.');
    }
    await backend.renameDir(this.folderPath(oldName), this.folderPath(newName));
    // folderMap에 추적되던 프로젝트들의 folder 갱신은 update() 한 번이면 충분.
    await this.update();
  }

  async deleteFolder(folderName: string): Promise<void> {
    // 폴더 안 N 프로젝트 영구 삭제 + 폴더 dir + Drive까지 서버 한 호출로. 옛 N round-trip
    // (rename → delete-now × N → deleteDir) 흐름은 모바일 느린 네트워크에서 중간에 abort
    // 되면 일부만 처리되고 나머지가 루트로 잔류하던 페인 (2026-05-20).
    const projectsInFolder = this.resourceList.filter(n => this.folderMap[n] === folderName);
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
    // 서버 batch — 로컬 파일/Drive 모두 영구 삭제 + 폴더 dir 자체 삭제.
    await backend.deleteFolderNow(folderName);
    await this.update();
  }

  async moveToFolder(name: string, targetFolder: string | null): Promise<void> {
    const currentFolder = this.folderMap[name] ?? null;
    if (currentFolder === targetFolder) return;
    if (targetFolder && targetFolder.includes('/')) {
      throw new Error('폴더 이름이 올바르지 않습니다.');
    }
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

    const projFile = 'projects/' + session.name + '.json';
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
    await zipService.zipFiles(entries, outPath);
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
      await zipService.zipFiles(entries, outPath);
    } finally {
      try {
        await backend.deleteFile(markerPath);
      } catch {}
    }
    onProgress?.('완료', total + 1, total + 1);
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

export const renameScene = async (
  session: Session,
  oldName: string,
  newName: string,
) => {
  newName = newName.trimEnd();
  await imageService.onRenameScene(session, oldName, newName);
  const scene = session.scenes.get(oldName)!;
  scene.name = newName;
  session.scenes.delete(oldName);
  session.scenes.set(newName, scene);
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
