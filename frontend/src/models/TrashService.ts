import type { Backend } from '../backend';
import { GenericScene, IInpaintScene, IScene, Session, genericSceneFromJSON } from './types';

// --- Type definitions ---

interface TrashImageMeta {
  [filename: string]: number; // filename -> deletedAt timestamp
}

interface TrashSceneEntry {
  sceneData: IScene | IInpaintScene;
  deletedAt: number;
}

interface TrashData {
  scenes: { [compositeKey: string]: TrashSceneEntry };
}

// --- Constants ---

const TRASH_FILE = 'trash.json';
const IMAGE_TRASH_DIR = '.trash';
const TRASH_META_FILE = '.trash_meta.json';

const SCENE_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;   // 14 days

// --- Service class ---

export class TrashService extends EventTarget {
  private data: TrashData = { scenes: {} };
  private loaded: boolean = false;

  constructor(private readonly backend: Backend) {
    super();
  }

  // ===== Core persistence =====

  async loadTrash(): Promise<void> {
    try {
      const str = await this.backend.readFile(TRASH_FILE);
      const parsed = JSON.parse(str);
      // legacy: 이전 버전의 trash.json에 projects 필드가 남아있을 수 있음 — 무시.
      this.data = {
        scenes: parsed.scenes || {},
      };
    } catch (e) {
      this.data = { scenes: {} };
    }
    this.loaded = true;
  }

  async reloadExternal(): Promise<void> {
    await this.loadTrash();
    this.dispatchEvent(new CustomEvent('trash-updated'));
  }

  async saveTrash(): Promise<void> {
    await this.backend.writeFile(TRASH_FILE, JSON.stringify(this.data));
    this.dispatchEvent(new CustomEvent('trash-updated'));
  }

  async renameProjectKeys(oldName: string, newName: string): Promise<void> {
    if (!this.loaded) {
      console.warn('[TrashService] rename skipped because trash.json is not loaded:', oldName);
      return;
    }
    const prefix = oldName + ':';
    let changed = false;
    for (const key of Object.keys(this.data.scenes)) {
      if (!key.startsWith(prefix)) continue;
      const newKey = newName + ':' + key.slice(prefix.length);
      this.data.scenes[newKey] = this.data.scenes[key];
      delete this.data.scenes[key];
      changed = true;
    }
    if (changed) await this.saveTrash();
  }

  private ensureLoaded() {
    if (!this.loaded) throw new Error('TrashService not loaded');
  }

  // ===== Image trash =====

  // scene output dir 표기 (outs/{session}/{scene} 또는 inpaints/...). 두 곳에서 동일하게 쓰여서 묶음.
  private getSceneOutputDir(session: Session, scene: GenericScene): string {
    return (scene.type === 'scene' ? 'outs/' : 'inpaints/') + session.name + '/' + scene.name;
  }

  private getImageTrashDir(session: Session, scene: GenericScene): string {
    return this.getSceneOutputDir(session, scene) + '/' + IMAGE_TRASH_DIR;
  }

  private getImageTrashMetaPath(session: Session, scene: GenericScene): string {
    return this.getImageTrashDir(session, scene) + '/' + TRASH_META_FILE;
  }

  private async loadImageTrashMeta(session: Session, scene: GenericScene): Promise<TrashImageMeta> {
    try {
      const str = await this.backend.readFile(this.getImageTrashMetaPath(session, scene));
      return JSON.parse(str);
    } catch (e) {
      return {};
    }
  }

  private async saveImageTrashMeta(session: Session, scene: GenericScene, meta: TrashImageMeta): Promise<void> {
    // writeFile auto-creates parent directories
    await this.backend.writeFile(this.getImageTrashMetaPath(session, scene), JSON.stringify(meta));
  }

  async moveImagesToTrash(session: Session, scene: GenericScene, fullPaths: string[]): Promise<void> {
    const outputDir = this.getSceneOutputDir(session, scene);
    const filenames = fullPaths.map((fullPath) => fullPath.split('/').pop()!);
    await this.backend.trashImages(outputDir, filenames);
    this.dispatchEvent(new CustomEvent('trash-updated'));
  }

  async getTrashImages(session: Session, scene: GenericScene): Promise<{filename: string, deletedAt: number}[]> {
    const meta = await this.loadImageTrashMeta(session, scene);
    const trashDir = this.getImageTrashDir(session, scene);
    let files: string[];
    try {
      files = await this.backend.listFiles(trashDir);
    } catch (e) {
      return [];
    }
    files = files.filter((f: string) => f.endsWith('.png'));
    return files.map((f: string) => ({
      filename: f,
      deletedAt: meta[f] || 0,
    }));
  }

  getTrashImagePath(session: Session, scene: GenericScene, filename: string): string {
    return this.getImageTrashDir(session, scene) + '/' + filename;
  }

  async restoreImages(session: Session, scene: GenericScene, filenames: string[]): Promise<void> {
    const trashDir = this.getImageTrashDir(session, scene);
    const outputDir = this.getSceneOutputDir(session, scene);
    const meta = await this.loadImageTrashMeta(session, scene);

    for (const filename of filenames) {
      try {
        await this.backend.renameFile(trashDir + '/' + filename, outputDir + '/' + filename);
        delete meta[filename];
      } catch (e) {
        console.error('이미지 복원 실패:', filename, e);
      }
    }

    await this.saveImageTrashMeta(session, scene, meta);
    this.dispatchEvent(new CustomEvent('trash-updated'));
  }

  async permanentlyDeleteImages(session: Session, scene: GenericScene, filenames: string[]): Promise<void> {
    const trashDir = this.getImageTrashDir(session, scene);
    const meta = await this.loadImageTrashMeta(session, scene);

    for (const filename of filenames) {
      try {
        await this.backend.deleteFile(trashDir + '/' + filename);
      } catch (e) {
        console.error('이미지 영구 삭제 실패:', filename, e);
      }
      delete meta[filename];
    }

    await this.saveImageTrashMeta(session, scene, meta);
    this.dispatchEvent(new CustomEvent('trash-updated'));
  }

  async emptyImageTrash(session: Session, scene: GenericScene): Promise<void> {
    const items = await this.getTrashImages(session, scene);
    if (items.length > 0) {
      await this.permanentlyDeleteImages(session, scene, items.map(i => i.filename));
    }
  }

  // ===== Project-wide image trash (all active scenes) =====

  /**
   * 현재 프로젝트(세션)의 모든 활성 씬에 대해 이미지 휴지통 집계
   * 휴지통에 들어간 씬의 이미지는 포함하지 않음 (activeScenes만 순회)
   */
  async countProjectImageTrash(
    session: Session,
  ): Promise<{ totalImages: number; scenesWithTrash: number }> {
    // 본인 페인 (E1, P12 #7): 영구 삭제 다이얼로그 띄우기 전 trash count 동기 계산
    // 으로 60+ 씬에 직렬 listFiles → 모바일 ~3-6초 hang. 청크 8 병렬로 throughput
    // ~8배 (NAI API throttle과 무관, fs listFiles는 서버 측 cheap operation).
    const allScenes: GenericScene[] = [
      ...session.getScenes('scene'),
      ...session.getScenes('inpaint'),
    ];
    const CHUNK = 8;
    let totalImages = 0;
    let scenesWithTrash = 0;
    for (let i = 0; i < allScenes.length; i += CHUNK) {
      const chunk = allScenes.slice(i, i + CHUNK);
      const counts = await Promise.all(
        chunk.map((scene) => this.getTrashImages(session, scene).then((items) => items.length)),
      );
      for (const n of counts) {
        if (n > 0) {
          totalImages += n;
          scenesWithTrash += 1;
        }
      }
    }
    return { totalImages, scenesWithTrash };
  }

  /**
   * 현재 프로젝트(세션)의 모든 활성 씬에 대해 이미지 휴지통을 영구 비움
   * 반환값: 영구삭제된 이미지 총개수
   */
  async emptyProjectImageTrash(session: Session): Promise<number> {
    let total = 0;
    const allScenes: GenericScene[] = [
      ...session.getScenes('scene'),
      ...session.getScenes('inpaint'),
    ];
    for (const scene of allScenes) {
      const items = await this.getTrashImages(session, scene);
      if (items.length > 0) {
        await this.permanentlyDeleteImages(
          session,
          scene,
          items.map((i) => i.filename),
        );
        total += items.length;
      }
    }
    return total;
  }

  // ===== Scene trash =====

  private sceneKey(projectName: string, sceneName: string): string {
    return projectName + ':' + sceneName;
  }

  // defer=true면 saveTrash 호출 안 함. 대량 삭제 시 호출자가 마지막에 한 번 save —
  // parallel write race 회피.
  async moveSceneToTrash(
    session: Session,
    scene: GenericScene,
    options?: { defer?: boolean },
  ): Promise<void> {
    this.ensureLoaded();
    const key = this.sceneKey(session.name, scene.name);
    const now = Date.now();

    // Store scene data in trash.json
    this.data.scenes[key] = {
      sceneData: scene.toJSON() as IScene | IInpaintScene,
      deletedAt: now,
    };

    // Move scene output directory to .trash/
    const imgDir = scene.type === 'scene' ? 'outs' : 'inpaints';
    const srcDir = imgDir + '/' + session.name + '/' + scene.name;
    const dstDir = imgDir + '/' + session.name + '/' + IMAGE_TRASH_DIR + '/' + scene.name;

    // Ensure .trash directory exists by writing a placeholder
    try {
      await this.backend.writeFile(imgDir + '/' + session.name + '/' + IMAGE_TRASH_DIR + '/.gitkeep', '');
    } catch (e) {}

    try {
      await this.backend.renameDir(srcDir, dstDir);
    } catch (e) {
      console.error('씬 디렉토리 휴지통 이동 실패:', e);
    }

    // For inpaint scenes, also move mask and org files
    if (scene.type === 'inpaint') {
      for (const dir of ['inpaint_masks', 'inpaint_orgs']) {
        const maskSrc = dir + '/' + session.name + '/' + scene.name + '.png';
        const maskDst = dir + '/' + session.name + '/' + IMAGE_TRASH_DIR + '/' + scene.name + '.png';
        try {
          await this.backend.writeFile(dir + '/' + session.name + '/' + IMAGE_TRASH_DIR + '/.gitkeep', '');
        } catch (e) {}
        try {
          await this.backend.renameFile(maskSrc, maskDst);
        } catch (e) {}
      }
    }

    // Remove scene from session
    session.removeScene(scene.type, scene.name);

    if (!options?.defer) {
      await this.saveTrash();
    }
  }

  getDeletedScenes(projectName: string): {name: string, type: 'scene' | 'inpaint', deletedAt: number}[] {
    this.ensureLoaded();
    const prefix = projectName + ':';
    const result: {name: string, type: 'scene' | 'inpaint', deletedAt: number}[] = [];
    for (const [key, entry] of Object.entries(this.data.scenes)) {
      if (key.startsWith(prefix)) {
        const sceneName = key.substring(prefix.length);
        result.push({
          name: sceneName,
          type: entry.sceneData.type === 'inpaint' ? 'inpaint' : 'scene',
          deletedAt: entry.deletedAt,
        });
      }
    }
    return result;
  }

  async restoreScene(session: Session, sceneName: string): Promise<void> {
    this.ensureLoaded();
    const key = this.sceneKey(session.name, sceneName);
    const entry = this.data.scenes[key];
    if (!entry) throw new Error('씬을 휴지통에서 찾을 수 없습니다');

    const sceneType = entry.sceneData.type === 'inpaint' ? 'inpaint' : 'scene';

    // Check name conflict
    if (session.hasScene(sceneType, sceneName)) {
      throw new Error('같은 이름의 씬이 이미 존재합니다');
    }

    // Move directory back
    const imgDir = sceneType === 'scene' ? 'outs' : 'inpaints';
    const srcDir = imgDir + '/' + session.name + '/' + IMAGE_TRASH_DIR + '/' + sceneName;
    const dstDir = imgDir + '/' + session.name + '/' + sceneName;
    try {
      await this.backend.renameDir(srcDir, dstDir);
    } catch (e) {
      console.error('씬 디렉토리 복원 실패:', e);
    }

    // For inpaint scenes, restore mask and org
    if (sceneType === 'inpaint') {
      for (const dir of ['inpaint_masks', 'inpaint_orgs']) {
        const maskSrc = dir + '/' + session.name + '/' + IMAGE_TRASH_DIR + '/' + sceneName + '.png';
        const maskDst = dir + '/' + session.name + '/' + sceneName + '.png';
        try {
          await this.backend.renameFile(maskSrc, maskDst);
        } catch (e) {}
      }
    }

    // Re-add scene to session
    const restoredScene = genericSceneFromJSON(entry.sceneData);
    session.addScene(restoredScene);

    // Remove from trash
    delete this.data.scenes[key];
    await this.saveTrash();
  }

  async permanentlyDeleteScene(projectName: string, sceneName: string, sceneType: 'scene' | 'inpaint'): Promise<void> {
    this.ensureLoaded();
    const key = this.sceneKey(projectName, sceneName);

    // Delete directory
    const imgDir = sceneType === 'scene' ? 'outs' : 'inpaints';
    const dir = imgDir + '/' + projectName + '/' + IMAGE_TRASH_DIR + '/' + sceneName;
    try {
      await this.backend.deleteDir(dir);
    } catch (e) {}

    // Delete mask/org for inpaint
    if (sceneType === 'inpaint') {
      for (const maskDir of ['inpaint_masks', 'inpaint_orgs']) {
        try {
          await this.backend.deleteFile(maskDir + '/' + projectName + '/' + IMAGE_TRASH_DIR + '/' + sceneName + '.png');
        } catch (e) {}
      }
    }

    delete this.data.scenes[key];
    await this.saveTrash();
  }

  // ===== Auto-cleanup =====

  async autoCleanup(): Promise<void> {
    this.ensureLoaded();
    const now = Date.now();

    // 0 + 3. Delegate orphan .deleted cleanup and image trash cleanup to server
    // (eliminates hundreds of sequential HTTP round-trips)
    try {
      const apiBase = import.meta.env.BASE_URL.replace(/\/$/, '');
      const res = await fetch(
        `${apiBase}/api/trash/auto-cleanup`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' } },
      );
      if (res.ok) {
        const result = await res.json();
        if (result.cleanedOrphans > 0 || result.cleanedImages > 0) {
          console.log(`서버 자동 정리: orphan ${result.cleanedOrphans}개, 이미지 ${result.cleanedImages}개 삭제`);
        }
      }
    } catch (e) {
      console.warn('서버 자동 정리 실패, 로컬 폴백 생략:', e);
    }

    // 2. Cleanup expired scenes (14 days) — needs frontend state.
    // 만료 항목만 추출 → CHUNK=4 병렬 영구 삭제. 보통 0~몇 개라 효과 작지만
    // 폴더 다수 만료 시 직렬 N× RTT 회피.
    type ExpiredScene = { projectName: string; sceneName: string; sceneType: 'scene' | 'inpaint'; key: string };
    const expired: ExpiredScene[] = [];
    for (const key of Object.keys(this.data.scenes)) {
      const entry = this.data.scenes[key];
      if (!entry) continue;
      if (now - entry.deletedAt < SCENE_RETENTION_MS) continue;
      const colonIdx = key.indexOf(':');
      expired.push({
        projectName: key.substring(0, colonIdx),
        sceneName: key.substring(colonIdx + 1),
        sceneType: entry.sceneData.type === 'inpaint' ? 'inpaint' : 'scene',
        key,
      });
    }
    const CHUNK = 4;
    for (let i = 0; i < expired.length; i += CHUNK) {
      const chunk = expired.slice(i, i + CHUNK);
      await Promise.all(
        chunk.map(async (e) => {
          try {
            console.log('자동 정리: 씬 ' + e.key + ' 영구 삭제');
            await this.permanentlyDeleteScene(e.projectName, e.sceneName, e.sceneType);
          } catch (err) {
            console.warn('자동 정리 실패:', e.key, err);
          }
        }),
      );
    }
  }
}
