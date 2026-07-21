import { backend, isMobile, gameService, imageService, getInitialThumbSize } from '.';
import { GenericScene, InpaintScene, Scene, Session } from './types';
import { assert } from './util';
import { v4 } from 'uuid';

export const supportedImageSizes = [200, 400, 500];
const imageDirList = ['outs', 'inpaints'];
const maskDirList = ['inpaint_masks', 'inpaint_orgs'];

// audit L713 (P18 sub-14): LRU value가 data URI string (1.3MB image × UTF-16 2× ≈
// 2.6MB JS heap per entry). 옛 desktop 256 × 2.6MB ≈ 666MB, mobile 64 × 2.6MB ≈ 166MB
// 누적이 long session 메모리 압박 + 모바일 Safari tab budget. cap 60% 감소로 메모리
// ~70% 절감. cache miss 증가는 사용자 페인 발생 시 fetchImageBlobURL 점진 마이그레이션으로
// escalation (옛 LRU constant는 git blame으로 history 확인 가능).
const IMAGE_CACHE_SIZE = 96;
const ENCODED_VIBE_CACHE_SIZE = 64;

const naturalSort = (a: string, b: string) => {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
};

class LRUCache<K, V> {
  limit: number;
  cache: Map<K, V>;

  constructor(limit: number) {
    this.limit = limit;
    this.cache = new Map<K, V>();
  }

  get(key: K): V | null {
    if (!this.cache.has(key)) {
      return null;
    }
    const value = this.cache.get(key)!;
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.limit) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, value);
  }

  delete(key: K): void {
    this.cache.delete(key);
  }
}

export class ImageService extends EventTarget {
  setImageMain(
    session: Session,
    scene: GenericScene,
    filename: string,
    value: boolean,
    notify: boolean = true,
  ): void {
    const index = scene.mains.indexOf(filename);
    if (value && index < 0) scene.mains.push(filename);
    if (!value && index >= 0) scene.mains.splice(index, 1);
    if (!notify) return;
    void backend.notifySessionImageMain({
      projectName: session.name,
      sceneType: scene.type,
      sceneName: scene.name,
      filename,
      value,
    }).catch((error) => {
      console.warn('[session-image-main] relay failed:', error);
    });
  }

  toggleImageMain(session: Session, scene: GenericScene, filename: string): boolean {
    const value = !scene.mains.includes(filename);
    this.setImageMain(session, scene, filename, value);
    return value;
  }

  images: { [key: string]: { [key: string]: string[] } };
  inpaints: { [key: string]: { [key: string]: string[] } };
  cache: LRUCache<string, string>;
  mutexes: { [key: string]: Promise<void> };
  // 인코딩된 바이브 이미지 존재 여부 캐시 (성능 최적화)
  encodedVibeExistsCache: LRUCache<string, boolean>;

  constructor() {
    super();
    this.images = {};
    this.inpaints = {};
    this.cache = new LRUCache(isMobile ? 24 : IMAGE_CACHE_SIZE);
    this.mutexes = {};
    this.encodedVibeExistsCache = new LRUCache(isMobile ? 16 : ENCODED_VIBE_CACHE_SIZE);
  }

  // FIFO chain — 같은 path에 동시 acquire가 들어와도 set 순서대로 await 사슬이 이어져
  // 정확히 한 caller만 critical section. 옛 acquireMutex는 while loop + 새 Promise를
  // 통째로 mutexes[path]에 덮어써서, A와 B가 같은 microtask cycle에 진입하면 둘 다
  // mutexes[path]==undefined 통과 → 둘 다 새 promise set → 마지막 set한 게 살아남고
  // 직전 A의 resolve는 영원히 호출 안 됨 + 두 caller가 critical section 동시 진입.
  // 새 패턴은 sync로 tail 갱신 후 prev await — race 차단.
  private async acquireMutex(path: string): Promise<() => void> {
    const prev = this.mutexes[path];
    let resolve!: () => void;
    const slot = new Promise<void>((r) => { resolve = r; });
    this.mutexes[path] = slot;
    if (prev) await prev;
    return () => {
      resolve();
      // 자기가 마지막 tail이면 map entry 청소 — 새 acquire가 끼어들었으면 그 tail
      // (다른 promise)이 들어있으니 그대로 둠 (대기자 chain이 그걸 보고 await).
      if (this.mutexes[path] === slot) {
        delete this.mutexes[path];
      }
    };
  }

  async renameImage(oldPath: string, newPath: string) {
    const releaseOld = await this.acquireMutex(oldPath);
    const releaseNew = await this.acquireMutex(newPath);
    try {
      await backend.renameFile(oldPath, newPath);
      await this.onRenameFile(oldPath, newPath);
    } finally {
      releaseNew();
      releaseOld();
    }
  }

  async onRenameFile(oldPath: string, newPath: string) {
    const oldPathParts = oldPath.split('/');
    const newPathParts = newPath.split('/');
    const oldDir = oldPathParts[oldPathParts.length - 2];
    const newDir = newPathParts[newPathParts.length - 2];
    assert(oldDir !== 'fastcache' && newDir !== 'fastcache');
    const oldPaths = [];
    const newPaths = [];
    for (const imageSize of supportedImageSizes) {
      oldPaths.push(this.getSmallImagePath(oldPath, imageSize));
      newPaths.push(this.getSmallImagePath(newPath, imageSize));
    }
    const oldReleases: Array<() => void> = [];
    const newReleases: Array<() => void> = [];
    for (const path of oldPaths) oldReleases.push(await this.acquireMutex(path));
    for (const path of newPaths) newReleases.push(await this.acquireMutex(path));
    try {
      for (let i = 0; i < oldPaths.length; i++) {
        const oldPath = oldPaths[i];
        const newPath = newPaths[i];
        try {
          await backend.renameFile(oldPath, newPath);
        } catch (e) {}
      }
      if (this.cache.cache.get(oldPath)) {
        this.cache.cache.set(newPath, this.cache.cache.get(oldPath)!);
        this.cache.cache.delete(oldPath);
      }
      for (const imageSize of supportedImageSizes) {
        const oldSmallPath = this.getSmallImagePath(oldPath, imageSize);
        const newSmallPath = this.getSmallImagePath(newPath, imageSize);
        if (this.cache.cache.get(oldSmallPath)) {
          this.cache.cache.set(
            newSmallPath,
            this.cache.cache.get(oldSmallPath)!,
          );
          this.cache.cache.delete(oldSmallPath);
        }
      }
    } finally {
      for (const r of newReleases) r();
      for (const r of oldReleases) r();
    }
  }

  async invalidateCache(path: string) {
    if (path.includes('fastcache')) {
      return;
    }
    const pathRelease = await this.acquireMutex(path);
    const smallReleases: Array<() => void> = [];
    for (const imageSize of supportedImageSizes) {
      const smallPath = this.getSmallImagePath(path, imageSize);
      smallReleases.push(await this.acquireMutex(smallPath));
    }
    try {
      this.cache.delete(path);
      // Memory-only invalidation: do NOT delete fastcache files on disk.
      // Server prewarms thumbnails when generating images; deleting them here
      // races with prewarm and forces re-generation on next view (slow).
      // Disk fastcache stays consistent because:
      //   - Future thumb requests overwrite via sharp().toFile()
      //   - Permanent deletion (trash/move) is handled separately by deleteImageFiles
      //   - Stage 2 disk cleanup nukes fastcache when space is needed
      for (const imageSize of supportedImageSizes) {
        const smallPath = this.getSmallImagePath(path, imageSize);
        this.cache.delete(smallPath);
      }
    } finally {
      for (const r of smallReleases) r();
      pathRelease();
    }
    this.dispatchEvent(
      new CustomEvent('image-cache-invalidated', { detail: { path } }),
    );
  }

  async fetchVibeImage(session: Session, name: string) {
    if (!name) return null;
    const path =
      imageService.getVibesDir(session) + '/' + name.split('/').pop()!;
    return await this.fetchImage(path);
  }

  async fetchEncodedVibeImage(session: Session, name: string, info: number) {
    const path =
      imageService.getEncodedVibesDir(session) +
      '/' +
      name.split('/').pop()! +
      '&info=' +
      info;
    return await this.fetchImage(path);
  }

  async writeVibeImage(session: Session, name: string, data: string) {
    const path =
      imageService.getVibesDir(session) + '/' + name.split('/').pop()!;
    await backend.writeDataFile(path, data);
    await imageService.invalidateCache(path);
  }

  async fetchReferenceImage(session: Session, name: string) {
    const path =
      imageService.getReferenceDir(session) + '/' + name.split('/').pop()!;
    return await this.fetchImage(path);
  }

  async writeReferenceImage(session: Session, name: string, data: string) {
    const resized = await this.normalizeReferenceImage(data);
    const path =
      imageService.getReferenceDir(session) + '/' + name.split('/').pop()!;
    await backend.writeDataFile(path, resized);
    await imageService.invalidateCache(path);
  }

  async fetchImage(path: string, holdMutex = true) {
    const release = holdMutex ? await this.acquireMutex(path) : null;
    try {
      if (this.cache.get(path)) {
        const res = this.cache.get(path);
        return res;
      }
      // existFile + readDataFile 2 round-trip을 readDataFile 1 round-trip으로 합침.
      // 서버가 404로 응답하면 throw — 파일 없음/네트워크 에러 둘 다 null로 일관 처리.
      try {
        const data = await backend.readDataFile(path);
        this.cache.set(path, data);
        return data;
      } catch {
        return null;
      }
    } finally {
      if (release) release();
    }
  }

  async fetchImageSmall(path: string, size: number) {
    if (size === -1 || (isMobile && size === 500)) {
      return this.fetchImage(path);
    }
    const smallImagePath = this.getSmallImagePath(path, size);
    const release = await this.acquireMutex(smallImagePath);
    try {
      // 캐시된 작은 이미지가 있는지 확인
      const resizedImageData = await this.fetchImage(smallImagePath, false);
      if (resizedImageData) {
        return resizedImageData;
      }
      // 캐시된 작은 이미지가 없음 - 원본 파일 존재 여부 확인 후 리사이즈 시도
      const originalExists = await backend.existFile(path);
      if (!originalExists) {
        // 원본 파일이 없으면 null 반환 (오류 로그 방지)
        return null;
      }
      try {
        await this.resizeImage(path, smallImagePath, size, size);
        const data = await this.fetchImage(smallImagePath, false);
        if (data) {
          this.cache.set(smallImagePath, data);
          return data;
        }
      } catch (e) {
        // 리사이즈 실패 시 원본 이미지 반환
        console.error('Failed to resize image, returning original:', path, e);
      }
      // 리사이즈 실패 시 원본 이미지 반환
      return this.fetchImage(path, false);
    } finally {
      release();
    }
  }

  getSmallImagePath(originalPath: string, size: number) {
    const pathParts = originalPath.split('/');
    const fileName = size.toString() + '_' + pathParts.pop();
    pathParts.push('fastcache');
    pathParts.push(fileName!);
    return pathParts.join('/');
  }

  async resizeImage(
    inputPath: string,
    outputPath: string,
    maxWidth: number,
    maxHeight: number,
  ) {
    let scale = maxWidth <= 200 ? 1.25 : 1.1;
    if (isMobile) {
      scale = 1.0;
    }
    maxWidth = Math.ceil(scale * maxWidth);
    maxHeight = Math.ceil(scale * maxHeight);
    await backend.resizeImage({
      inputPath,
      outputPath,
      maxWidth,
      maxHeight,
    });
  }

  // NOTE there is race condition here
  // when deleted resource is being loaded up by somebody
  // we can end up with invalid cache
  // tricky to handle without global lock
  // but only happens when "swap of scene names" is the case
  // let's just keep it simple; this is probably not common use case
  async onRenameScene(session: Session, oldName: string, newName: string) {
    const cache = this.cache.cache;
    const toDelete = [];
    for (const key of cache.keys()) {
      for (const imgDir of imageDirList.concat(maskDirList)) {
        if (key.startsWith(imgDir + '/' + session.name + '/' + oldName)) {
          toDelete.push(key);
        }
      }
    }
    for (const key of toDelete) {
      cache.delete(key);
    }
    for (const imgDir of imageDirList) {
      const oldPath = imgDir + '/' + session.name + '/' + oldName;
      const newPath = imgDir + '/' + session.name + '/' + newName;
      try {
        await backend.renameDir(oldPath, newPath);
      } catch (e) {
        console.error('rename scene error:', e);
      }
    }
    for (const imgDir of maskDirList) {
      const oldPath = imgDir + '/' + session.name + '/' + oldName + '.png';
      const newPath = imgDir + '/' + session.name + '/' + newName + '.png';
      try {
        await backend.renameFile(oldPath, newPath);
      } catch (e) {
        console.error('rename scene error:', e);
      }
    }
  }

  // 씬 병합: sourceName 씬 폴더의 이미지를 targetName 씬 폴더로 옮긴다. (SDStudio 4.13 97a6aca 이식)
  // - 파일명이 충돌하면 "_merged{n}" 접미사로 재지정하므로 이미지 손실은 없다.
  // - 복사에 성공한 원본 파일만 삭제하므로, 일부 실패해도 원본이 보존된다.
  // - 서버 /api/fs/copy 가 dest 디렉토리를 자동 생성하므로 target 씬에 이미지가
  //   하나도 없어도(폴더 미생성) 정상 동작한다.
  // 반환값: 옮긴 이미지 수
  async mergeSceneImages(
    session: Session,
    sourceName: string,
    targetName: string,
  ): Promise<number> {
    let moved = 0;
    for (const imgDir of imageDirList) {
      const srcDir = imgDir + '/' + session.name + '/' + sourceName;
      const dstDir = imgDir + '/' + session.name + '/' + targetName;

      let files: string[];
      try {
        files = (await backend.listFiles(srcDir)).filter((x) =>
          x.endsWith('.png'),
        );
      } catch (e) {
        continue; // source 폴더가 없으면 건너뜀
      }
      if (files.length === 0) continue;

      // 대상 폴더의 기존 파일명(충돌 검사용)
      const taken = new Set<string>();
      try {
        for (const f of await backend.listFiles(dstDir)) {
          if (f.endsWith('.png')) taken.add(f);
        }
      } catch (e) {
        /* 대상 폴더가 아직 없을 수 있음 */
      }

      for (const file of files) {
        // 파일명 충돌 시 "_merged{n}" 접미사로 회피
        let dstName = file;
        if (taken.has(dstName)) {
          const dot = file.lastIndexOf('.');
          const base = dot >= 0 ? file.slice(0, dot) : file;
          const ext = dot >= 0 ? file.slice(dot) : '';
          let i = 1;
          while (taken.has(`${base}_merged${i}${ext}`)) i++;
          dstName = `${base}_merged${i}${ext}`;
        }
        try {
          await backend.copyFile(srcDir + '/' + file, dstDir + '/' + dstName);
          taken.add(dstName);
          moved++;
          // 복사 성공한 원본만 삭제 (실패분은 보존)
          try {
            await backend.deleteFile(srcDir + '/' + file);
          } catch (e) {
            /* 원본 삭제 실패는 무시 */
          }
        } catch (e) {
          console.error('씬 병합 이미지 복사 실패:', file, e);
        }
      }

      // 비워진 source 폴더 정리 (남은 파일이 있으면 deleteDir가 실패할 수 있음 → 무시)
      try {
        await backend.deleteDir(srcDir);
      } catch (e) {
        /* 무시 */
      }
    }

    // source 씬 관련 캐시 무효화
    const cache = this.cache.cache;
    const toDelete: string[] = [];
    for (const key of cache.keys()) {
      for (const imgDir of imageDirList.concat(maskDirList)) {
        if (key.startsWith(imgDir + '/' + session.name + '/' + sourceName)) {
          toDelete.push(key);
        }
      }
    }
    for (const key of toDelete) cache.delete(key);

    return moved;
  }

  async onRenameSession(oldName: string, newName: string) {
    const cache = this.cache.cache;
    const toDelete = [];
    for (const key of cache.keys()) {
      if (key.includes('/' + oldName + '/')) {
        toDelete.push(key);
      }
    }
    for (const key of toDelete) {
      cache.delete(key);
    }
    // encodedVibeExistsCache key는 file path 포함 (e.g. 'vibes/<oldName>/<file>')
    const vibeKeysToDelete: string[] = [];
    for (const key of this.encodedVibeExistsCache.cache.keys()) {
      if (key.includes('/' + oldName + '/')) vibeKeysToDelete.push(key);
    }
    for (const key of vibeKeysToDelete) this.encodedVibeExistsCache.delete(key);
    const moved: string[] = [];
    for (const dir of ['outs', 'inpaints', 'vibes', 'references', 'inpaint_masks', 'inpaint_orgs']) {
      const source = dir + '/' + oldName;
      if (!(await backend.existFile(source))) continue;
      try {
        await backend.renameDir(source, dir + '/' + newName);
        moved.push(dir);
      } catch (error) {
        const rollbackErrors: string[] = [];
        for (const rollbackDir of moved.slice().reverse()) {
          try {
            await backend.renameDir(
              rollbackDir + '/' + newName,
              rollbackDir + '/' + oldName,
            );
          } catch (rollbackError) {
            rollbackErrors.push(rollbackDir + ': ' + String(rollbackError));
          }
        }
        const failure = new Error(
          `프로젝트 이미지 폴더(${dir}) 이름 변경에 실패했어요.` +
          (rollbackErrors.length > 0 ? ` 롤백 실패: ${rollbackErrors.join(', ')}` : ''),
        );
        (failure as any).cause = error;
        throw failure;
      }
    }
    // 모든 물리/논리 루트 이동이 끝난 뒤에만 이름 keyed 메모리 맵을 전환한다.
    if (oldName in this.images) {
      this.images[newName] = this.images[oldName];
      delete this.images[oldName];
    }
    if (oldName in this.inpaints) {
      this.inpaints[newName] = this.inpaints[oldName];
      delete this.inpaints[oldName];
    }
  }

  // audit H10 — 옛 코드엔 session delete 시 images/inpaints 정리 path 없어 long-lived
  // editor에서 삭제된 session.name 키가 영원히 남음. 본 메서드 호출처: AppService
  // deleteProjectBackground sessionService.delete 성공 직후.
  onSessionDeleted(sessionName: string) {
    delete this.images[sessionName];
    delete this.inpaints[sessionName];
    const cacheKeysToDelete: string[] = [];
    for (const key of this.cache.cache.keys()) {
      if (key.includes('/' + sessionName + '/')) cacheKeysToDelete.push(key);
    }
    for (const key of cacheKeysToDelete) this.cache.delete(key);
    const vibeKeysToDelete: string[] = [];
    for (const key of this.encodedVibeExistsCache.cache.keys()) {
      if (key.includes('/' + sessionName + '/')) vibeKeysToDelete.push(key);
    }
    for (const key of vibeKeysToDelete) this.encodedVibeExistsCache.delete(key);
  }

  async normalizeReferenceImage(data: string): Promise<string> {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return data;
    const img = new Image();
    img.src = base64ToDataUri(data);
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
    });

    const { canvasWidth, canvasHeight } = this.chooseReferenceResolution(img.width, img.height);
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;

    const scale = Math.min(canvasWidth / img.width, canvasHeight / img.height);
    const w = Math.floor(scale * img.width);
    const h = Math.floor(scale * img.height);
    const x = Math.floor((canvasWidth - w) / 2);
    const y = Math.floor((canvasHeight - h) / 2);

    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    ctx.drawImage(img, x, y, w, h);
    // NAI Precise Reference 스펙: 3채널 RGB 필요. HTML Canvas는 항상 RGBA이므로
    // alpha 채널을 포함하지 않는 JPEG 0.95로 인코딩하여 RGBA→RGB 변환.
    // 참고: sunanakgo/NAIS2 processCharacterImage, DNT-LAB/NAIA _letterbox
    return canvas.toDataURL('image/jpeg', 0.95).split(',')[1];
  }

  /**
   * 이미 저장된 레퍼런스 이미지(base64)를 NAI API 전송용 JPEG 3채널로 재인코딩.
   * 기존 사용자가 업로드한 RGBA PNG 레퍼런스를 재업로드 없이 호환시키기 위해
   * 생성 시점에 호출. letterbox는 수행하지 않음 (저장 시점에 이미 완료됨).
   */
  async reencodeReferenceForApi(data: string): Promise<string> {
    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return data;
      const img = new Image();
      img.src = base64ToDataUri(data);
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });
      canvas.width = img.width;
      canvas.height = img.height;
      // alpha 픽셀이 투명한 경우를 대비해 검정 배경 채움 (letterbox 색상과 일치).
      ctx.fillStyle = 'black';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      return canvas.toDataURL('image/jpeg', 0.95).split(',')[1];
    } catch (e) {
      console.warn('Failed to re-encode reference image as JPEG:', e);
      return data;
    }
  }

  chooseReferenceResolution(width: number, height: number) {
    const ratio = width / height;
    if (ratio >= 0.9 && ratio <= 1.1) 
      return { canvasWidth: 1472, canvasHeight: 1472 };
    else if (ratio < 1) 
      return { canvasWidth: 1024, canvasHeight: 1536 };
    else return { canvasWidth: 1536, canvasHeight: 1024 };
  }

  getOutputs(session: Session, scene: GenericScene) {
    if (scene.type === 'scene') {
      return this.getImages(session, scene);
    }
    return this.getInPaints(session, scene);
  }

  getImages(session: Session, scene: Scene) {
    if (!(session.name in this.images)) {
      return [];
    }
    if (!(scene.name in this.images[session.name])) {
      return [];
    }
    return this.images[session.name][scene.name];
  }

  getInPaints(session: Session, scene: InpaintScene) {
    if (!(session.name in this.inpaints)) {
      return [];
    }
    if (!(scene.name in this.inpaints[session.name])) {
      return [];
    }
    return this.inpaints[session.name][scene.name];
  }

  getOutputDir(session: Session, scene: GenericScene) {
    if (scene.type === 'scene') {
      return this.getImageDir(session, scene);
    }
    return this.getInPaintDir(session, scene);
  }

  getImageDir(session: Session, scene: Scene) {
    return 'outs/' + session.name + '/' + scene.name;
  }

  getInPaintDir(session: Session, scene: InpaintScene) {
    return 'inpaints/' + session.name + '/' + scene.name;
  }

  getVibesDir(session: Session) {
    return 'vibes/' + session.name;
  }

  getEncodedVibesDir(session: Session) {
    return this.getVibesDir(session) + '/encoded';
  }

  getReferenceDir(session: Session) {
    return 'references/' + session.name;
  }

  async storeVibeImage(session: Session, data: string) {
    const path = imageService.getVibesDir(session) + '/' + v4() + '.png';
    await backend.writeDataFile(path, data);
    return path.split('/').pop()!;
  }

  async storeGenerationVibeImage(session: Session, data: string) {
    const path = imageService.getVibesDir(session) + '/' + v4() + '.png';
    await backend.writeGenerationAsset(path, data);
    return path.split('/').pop()!;
  }

  async storeEncodedVibeImage(
    session: Session,
    name: string,
    data: string,
    info: number,
  ) {
    const path =
      imageService.getEncodedVibesDir(session) + '/' + name + '&info=' + info;
    await backend.writeDataFile(path, data);
    return path.split('/').pop()!;
  }

  async storeReferenceImage(session: Session, data: string) {
    const resized = await this.normalizeReferenceImage(data);
    const path = imageService.getReferenceDir(session) + '/' + v4() + '.png';
    await backend.writeDataFile(path, resized);
    return path.split('/').pop()!;
  }

  private _imagePath(dir: string, name: string, suffix: string = '') {
    return dir + '/' + name.split('/').pop()! + suffix;
  }

  getVibeImagePath(session: Session, name: string) {
    return this._imagePath(imageService.getVibesDir(session), name);
  }

  getEncodedVibeImagePath(session: Session, name: string, info: number) {
    return this._imagePath(imageService.getEncodedVibesDir(session), name, '&info=' + info);
  }

  getReferenceImagePath(session: Session, name: string) {
    return this._imagePath(imageService.getReferenceDir(session), name);
  }

  async refresh(
    session: Session,
    scene: GenericScene,
    emitEvent: boolean = true,
    guardEmpty: boolean = false,
  ) {
    const target = scene.type === 'scene' ? this.images : this.inpaints;
    if (!(session.name in target)) {
      target[session.name] = {};
    }
    // 옵션 C 단계 C: success 분기 가드 제거. 서버 단계 A로 200+[] = 진짜 빈 디렉토리
    // 신뢰. 5/13 "outs 비웠는데 카운트 안 사라짐" 페인의 근본 원인 fix.
    // 단계 B의 catch 분기 옛 imageMap 유지(guardEmpty=true)는 그대로 유지 — 5/12 cold
    // start stuck 패턴의 일시 throw 안전망.
    let files: string[];
    try {
      files = await backend.listFiles(this.getOutputDir(session, scene));
    } catch (e) {
      console.warn('[refresh] listFiles failed:', scene.name, e);
      if (guardEmpty && scene.imageMap.length > 0) {
        target[session.name][scene.name] = [...scene.imageMap];
        if (emitEvent)
          this.dispatchEvent(
            new CustomEvent('updated', {
              detail: { batch: false, session, scene },
            }),
          );
        return;
      }
      files = []; // guardEmpty=false: 옛 마스킹 동작과 동일 (imageMap 비움)
    }
    files = files.filter((x: string) => /\.(?:png|webp|avif)$/i.test(x));
    files.sort(naturalSort);

    const fileSet = new Set<string>(files);
    const imageMapSet = new Set<string>(scene.imageMap);
    const newImageMap = scene.imageMap.filter((x: string) => fileSet.has(x));
    for (const file of files) {
      if (!imageMapSet.has(file)) {
        newImageMap.push(file);
      }
    }
    scene.imageMap = newImageMap;
    target[session.name][scene.name] = [...scene.imageMap];
    if (scene.type === 'scene') {
      scene.mains = scene.mains.filter((x: string) => fileSet.has(x));
    }
    if (emitEvent)
      this.dispatchEvent(
        new CustomEvent('updated', {
          detail: { batch: false, session, scene },
        }),
      );
  }

  async refreshBatch(session: Session) {
    // Phase 7A: 직렬 → 청크 병렬화
    // 각 refresh 호출은 독립적인 scene의 imageMap만 갱신 (race-free).
    // 청크 크기 8: 브라우저 동시 connection 한도와 서버 부하 사이 균형.
    const CHUNK_SIZE = 8;
    // per-scene timeout — 모바일 Safari cold start로 fetch가 stuck하는 경우 회복.
    // 본인 보고 (2026-05-12): 페이지 로드 후 첫 50+씬 프로젝트 진입 시 화면 비어있음,
    // 다른 프로젝트 우회 후 풀림. 첫 chunk의 listFiles 일부가 stuck → 후속 chunk 못
    // 시작 패턴.
    const SCENE_REFRESH_TIMEOUT_MS = 15000;
    const refreshOne = async (scene: GenericScene) => {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          await Promise.race([
            this.refresh(session, scene, false, true),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('refresh timeout')), SCENE_REFRESH_TIMEOUT_MS),
            ),
          ]);
          return; // 성공
        } catch (e) {
          // 첫 시도 timeout → 즉시 retry. 두 번째 실패면 skip (다음 chunk 진행).
          if (attempt === 1) {
            console.warn('[refreshBatch] scene refresh failed after retry:', scene.name);
          }
        }
      }
    };

    const refreshAll = async (scenes: Iterable<GenericScene>) => {
      const list = Array.from(scenes);
      for (let i = 0; i < list.length; i += CHUNK_SIZE) {
        const chunk = list.slice(i, i + CHUNK_SIZE);
        await Promise.all(chunk.map(refreshOne));
      }
    };

    await refreshAll(session.scenes.values());
    await refreshAll(session.inpaints.values());

    this.dispatchEvent(
      new CustomEvent('updated', { detail: { batch: true, session } }),
    );
  }

  onAddImage(session: Session, scene: string, path: string) {
    if (!(session.name in this.images)) {
      this.images[session.name] = {};
    }
    if (!(scene in this.images[session.name])) {
      this.images[session.name][scene] = [];
    }
    this.images[session.name][scene] = this.images[session.name][scene].concat([
      path.split('/').pop()!,
    ]);
    session.scenes.get(scene)?.imageMap.push(path.split('/').pop()!);
    this.prefetchCompletedImage(path);
    this.dispatchEvent(
      new CustomEvent('image-added', {
        detail: {
          session,
          sceneType: 'scene',
          sceneName: scene,
          filename: path.split('/').pop()!,
          path,
        },
      }),
    );
    this.dispatchEvent(
      new CustomEvent('updated', {
        detail: { batch: false, session, scene: session.scenes.get(scene) },
      }),
    );
  }

  // 완료 이미지 prefetch — 진단 축3 (F2-8, 본인 확정 2026-07-02): 옛 3사이즈(200/400/500)
  // eager fetch는 P21 서버 prewarm 1사이즈 축소와 표류 — 요청·리사이즈 3배(모바일 발열·
  // 디스크)에 모바일 그리드는 200 고정이라 400/500 대부분 사장. 정책 = "fetch 시점의
  // 유효 표시 사이즈 1개"(서버 prewarm과 동일 규칙): 설정 변경 이후 완성분부터 자동
  // 반영, 옛 이미지는 표시 시점 on-demand 1회 생성(소급 재생성 없음 — 발열 재도입 방지).
  private prefetchCompletedImage(path: string) {
    if (!isMobile) return;
    import('./AppService')
      .then(({ appState }) =>
        this.fetchImageSmall(path, getInitialThumbSize(appState.initialThumbSize)),
      )
      .catch(() => {});
  }

  onAddInPaint(session: Session, scene: string, path: string) {
    if (!(session.name in this.inpaints)) {
      this.inpaints[session.name] = {};
    }
    if (!(scene in this.inpaints[session.name])) {
      this.inpaints[session.name][scene] = [];
    }
    this.inpaints[session.name][scene] = this.inpaints[session.name][
      scene
    ].concat([path.split('/').pop()!]);
    session.inpaints.get(scene)?.imageMap.push(path.split('/').pop()!);
    this.prefetchCompletedImage(path);
    this.dispatchEvent(
      new CustomEvent('image-added', {
        detail: {
          session,
          sceneType: 'inpaint',
          sceneName: scene,
          filename: path.split('/').pop()!,
          path,
        },
      }),
    );
    this.dispatchEvent(
      new CustomEvent('updated', {
        detail: { batch: false, session, scene: session.inpaints.get(scene) },
      }),
    );
  }

  async encodeVibeImage(session: Session, path: string, info: number) {
    const vibePath = this.getVibeImagePath(session, path);
    const data = await this.fetchVibeImage(session, vibePath);
    if (!data) return;
    const encoded = await backend.encodeVibeImage({
      image: dataUriToBase64(data),
      info: info,
    });
    await this.storeEncodedVibeImage(session, path, encoded, info);
    
    // 인코딩 완료 후 캐시 업데이트
    const cacheKey = this.getEncodedVibeImagePath(session, path, info);
    this.encodedVibeExistsCache.set(cacheKey, true);
    
    this.dispatchEvent(new CustomEvent('encode-vibe', {}));
    return encoded;
  }

  async checkEncodedVibeImage(session: Session, path: string, info: number) {
    const vibePath = this.getEncodedVibeImagePath(session, path, info);
    
    // 캐시에서 먼저 확인 (성능 최적화)
    const cached = this.encodedVibeExistsCache.get(vibePath);
    if (cached !== null) {
      return cached;
    }
    
    // 캐시에 없으면 파일 시스템 확인
    const exists = await backend.existFile(vibePath);
    this.encodedVibeExistsCache.set(vibePath, exists);
    return exists;
  }
}

export function base64ToDataUri(data: string) {
  return 'data:image/png;base64,' + data;
}

export function dataUriToBase64(dataUri: string) {
  // audit H21 — 옛 dataUri.split(',') 패턴은 multi-MB string 전체 스캔하며 모든
  // comma 위치 찾고 배열 생성. SDImageGenHandler/AugmentWorkFlow에서 vibe 이미지
  // 변환 시 30-150ms 모바일 hitch. indexOf는 첫 comma에서 stop (~50 bytes), slice는
  // V8에서 reference + copy-on-write라 사실상 O(1). 10-100× 가속.
  const idx = dataUri.indexOf(',');
  return idx >= 0 ? dataUri.slice(idx + 1) : dataUri;
}

export function getMainImagePath(session: Session, scene: Scene) {
  if (scene.mains.length) {
    return imageService.getImageDir(session, scene) + '/' + scene.mains[0];
  }
  const images = gameService.getOutputs(session, scene);
  if (images.length) {
    return imageService.getImageDir(session, scene) + '/' + images[0];
  }
  return undefined;
}

export async function getMainImage(
  session: Session,
  scene: GenericScene,
  size: number,
) {
  // 모바일 씬 카드 썸네일: 200_ fastcache 사용 (원본 1.6MB → 121KB, 14배 작음).
  // 첫 진입 시 N장 다운로드 시간 1~2분 → 수초로 단축.
  if (isMobile && size > 200) size = 200;
  if (scene.mains.length) {
    const path =
      imageService.getOutputDir(session, scene) + '/' + scene.mains[0];
    const base64 = await imageService.fetchImageSmall(path, size);
    return base64;
  }
  const images = gameService.getOutputs(session, scene);
  if (images.length) {
    const path = imageService.getOutputDir(session, scene) + '/' + images[0];
    return await imageService.fetchImageSmall(path, size);
  }
  return undefined;
}

export const deleteImageFiles = async (
  curSession: Session,
  paths: string[],
  scene?: GenericScene,
) => {
  if (scene) {
    // 휴지통으로 이동
    const { trashService } = await import('.');
    await trashService.moveImagesToTrash(curSession, scene, paths);
    for (const imagePath of paths) {
      const filename = imagePath.split('/').pop()!;
      if (scene.mains.includes(filename)) {
        imageService.setImageMain(curSession, scene, filename, false);
      }
    }
    // 캐시 일괄 무효화 (순차 mutex 대신 batch)
    for (const path of paths) {
      imageService.cache.delete(path);
      // 전 사이즈 무효화 — 옛 [200,400] 하드코딩은 500 캐시 잔존 (진단 축3 동반 정리)
      for (const sz of supportedImageSizes) {
        const dir = path.substring(0, path.lastIndexOf('/'));
        const name = path.substring(path.lastIndexOf('/') + 1);
        imageService.cache.delete(dir + '/fastcache/' + sz + '_' + name);
      }
    }
    await imageService.refresh(curSession, scene);
  } else {
    // scene이 없는 경우 기존 동작 유지 (OS 휴지통)
    for (const path of paths) {
      try {
        await backend.trashFile(path);
      } catch (e) {}
      await imageService.invalidateCache(path);
    }
    await imageService.refreshBatch(curSession);
  }
};

export function cropMirrorResultFromDataUri(dataUri: string, mirrorCropX?: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      // mirrorCropX가 유효하면 정확한 위치 사용, 해상도 불일치 시 폴백
      const half = Math.floor(w / 2);
      const cropX = (mirrorCropX && Math.abs(mirrorCropX - half) < 64)
        ? mirrorCropX
        : (half + 48);
      const cropW = w - cropX;
      const canvas = document.createElement('canvas');
      canvas.width = cropW;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, cropX, 0, cropW, h, 0, 0, cropW, h);
      // toBlob (async) + FileReader.readAsDataURL (async)로 main thread 양보.
      // 옛 toDataURL은 sync 50-200ms 블록 — bulk mirror export(CHUNK=4)면 누적 수초 UI freeze.
      canvas.toBlob((blob) => {
        if (!blob) { reject(new Error('toBlob returned null')); return; }
        const reader = new FileReader();
        reader.onload = () => {
          const dataUriResult = reader.result as string;
          resolve(dataUriResult.replace(/^data:image\/png;base64,/, ''));
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      }, 'image/png');
    };
    img.onerror = reject;
    img.src = dataUri;
  });
}
