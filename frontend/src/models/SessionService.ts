import extractChunks from 'png-chunks-extract';
import { Buffer } from 'buffer';
import { v4 } from 'uuid';
import { backend, imageService, workFlowService, zipService } from '.';
import { FileEntry } from '../backend';
import defaultassets from '../defaultassets';
import { dataUriToBase64 } from './ImageService';
import { defaultUC } from './PromptService';
import { ResourceSyncService } from './ResourceSyncService';
import {
  PromptPieceSlot,
  GenericScene,
  InpaintScene,
  Scene,
  Session,
  ISession,
} from './types';
import { extractPromptDataFromBase64 } from './util';
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
    // 북마크 정리
    delete this.bookmarkData.scenes[name];
    const keysToDelete = Object.keys(this.bookmarkData.images).filter(k => k.startsWith(name + ':'));
    keysToDelete.forEach(k => delete this.bookmarkData.images[k]);
    if (keysToDelete.length > 0 || this.bookmarkData.scenes[name]) {
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
    // 정책: 폴더는 영구 삭제. 안의 프로젝트들은 휴지통 경유 (개별 복원 가능).
    // 주의: super.delete()는 같은 디렉토리에 .deleted suffix를 남김. 만약 폴더 안에서
    // delete 후 폴더를 삭제하면 .deleted 파일도 같이 사라져 복원 불가능. 그래서 먼저
    // 각 프로젝트의 .json을 루트로 옮긴 후 delete를 호출.
    const projectsInFolder = this.resourceList.filter(n => this.folderMap[n] === folderName);
    for (const projName of projectsInFolder) {
      const srcPath = this.projectFilePath(projName, folderName);
      const destPath = this.projectFilePath(projName, null);
      await backend.renameFile(srcPath, destPath);
      this.folderMap[projName] = null;
    }
    // 이제 각 프로젝트를 휴지통으로 (.deleted suffix가 루트에 생김 → 복원 시 루트로)
    for (const projName of projectsInFolder) {
      await this.delete(projName);
    }
    // 폴더 디렉토리 자체 삭제 (잔류 .keep 등 청소)
    try {
      await backend.deleteDir(this.folderPath(folderName));
    } catch {}
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
    entries.push({ path: projFile, name: 'project.json' });
    if (zipService.isZipping) {
      throw new Error('Already zipping');
    }
    await zipService.zipFiles(entries, outPath);
  }

  async importSessionShallow(session: ISession, name: string) {
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

    // 5개 renameDir를 직렬에서 병렬로 (디렉토리들이 서로 독립적이라 안전).
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
    seesion: Session,
    inpaint: InpaintScene,
    image: string,
    mask: string,
  ) {
    await backend.writeDataFile(
      this.getInpaintOrgPath(seesion, inpaint),
      image,
    );
    await backend.writeDataFile(
      this.getInpaintMaskPath(seesion, inpaint),
      mask,
    );
    await imageService.invalidateCache(
      this.getInpaintOrgPath(seesion, inpaint),
    );
    await imageService.invalidateCache(
      this.getInpaintMaskPath(seesion, inpaint),
    );
  }

  styleEdit(preset: any, container: any) {
    this.dispatchEvent(
      new CustomEvent('style-edit', { detail: { preset, container } }),
    );
  }

  configChanged(): void {
    this.dispatchEvent(new CustomEvent('config-changed', {}));
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
