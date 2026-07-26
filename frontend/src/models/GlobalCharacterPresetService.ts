import { observable, action } from 'mobx';
import { v4 as uuidv4 } from 'uuid';
import type { Backend } from '../backend';
import type { ImageService } from './ImageService';
import { Session, CharacterPreset, ICharacterPreset } from './types';
import { dataUriToBase64 } from './ImageService';
import { DebouncedJsonStore } from './DebouncedJsonStore';

const GLOBAL_CHAR_PRESETS_FILE = 'global_character_presets.json';
const GLOBAL_CHAR_IMAGES_DIR = 'global_char_images';

export interface IGlobalCharacterPresetEntry {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  // 이미지 경로(vibes/characterReferences/representativeImage)는 글로벌 파일명을 가리킨다.
  preset: ICharacterPreset;
  folder?: string;
}

export interface IGlobalCharacterPresetStore {
  version: 1;
  presets: IGlobalCharacterPresetEntry[];
  folders?: string[];
}

// 글로벌(프로젝트 공통) 캐릭터 프리셋.
// 캐릭터 프리셋 이미지는 세션 디렉터리에 종속되므로, 글로벌은 전용 디렉터리에
// 이미지를 따로 보관하고(data URI 파일), 불러올 때 세션으로 복사한다.
export class GlobalCharacterPresetService extends DebouncedJsonStore {
  @observable accessor presets: IGlobalCharacterPresetEntry[] = [];
  @observable accessor folders: string[] = [];

  constructor(backend: Backend, private readonly imageService: ImageService) {
    super(backend);
  }

  // ---------- lifecycle ----------

  protected getFileName(): string {
    return GLOBAL_CHAR_PRESETS_FILE;
  }

  protected saveErrorLabel(): string {
    return 'global character presets';
  }

  // audit B8 — load 완료 이벤트가 다른 4개와 달리 'changed'(기존 동작 보존).
  // (base 상속으로 flushOnHide는 새로 획득 — 2초 debounce 중 탭 닫을 때 저장 손실 갭 fix.)
  protected loadedEvent(): string {
    return 'changed';
  }

  protected buildStore(): IGlobalCharacterPresetStore {
    return { version: 1, presets: this.presets, folders: this.folders };
  }

  protected applyParsed(json: any): void {
    const j = json as IGlobalCharacterPresetStore;
    this.presets =
      j && Array.isArray(j.presets)
        ? j.presets
            .filter(
              (p) =>
                p &&
                typeof p.id === 'string' &&
                typeof p.name === 'string' &&
                p.preset,
            )
            .map((p) => ({
              ...p,
              folder:
                typeof p.folder === 'string' && p.folder.trim()
                  ? p.folder.trim()
                  : undefined,
            }))
        : [];
    const folders: string[] = [];
    for (const folder of Array.isArray(j?.folders) ? j.folders : []) {
      if (typeof folder !== 'string') continue;
      const trimmed = folder.trim();
      if (trimmed && !folders.includes(trimmed)) folders.push(trimmed);
    }
    this.folders = folders;
  }

  protected resetState(): void {
    this.presets = [];
    this.folders = [];
  }

  // ---------- read ----------
  list(): IGlobalCharacterPresetEntry[] {
    return this.presets.slice();
  }
  get(id: string): IGlobalCharacterPresetEntry | undefined {
    return this.presets.find((p) => p.id === id);
  }
  getByName(name: string): IGlobalCharacterPresetEntry | undefined {
    return this.presets.find((p) => p.name === name);
  }

  listFolders(): string[] {
    const derived = new Set(
      this.presets.map((entry) => entry.folder).filter(Boolean) as string[],
    );
    for (const folder of this.folders) derived.delete(folder);
    return [
      ...this.folders,
      ...[...derived].sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }),
      ),
    ];
  }

  @action
  createFolder(name: string): string {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('폴더 이름을 입력해 주세요.');
    if (this.listFolders().includes(trimmed)) {
      throw new Error('같은 이름의 폴더가 있습니다.');
    }
    this.folders = [...this.folders, trimmed];
    this.scheduleSave();
    this.dispatchEvent(new CustomEvent('changed'));
    return trimmed;
  }

  @action
  setFolder(id: string, folder: string | null): void {
    const entry = this.get(id);
    if (!entry) return;
    const next = folder?.trim() || undefined;
    if (entry.folder === next) return;
    entry.folder = next;
    entry.updatedAt = Date.now();
    if (next && !this.folders.includes(next)) this.folders = [...this.folders, next];
    this.presets = [...this.presets];
    this.scheduleSave();
    this.dispatchEvent(new CustomEvent('changed'));
  }

  @action
  renameFolder(oldName: string, newName: string): void {
    const trimmed = newName.trim();
    if (!trimmed) throw new Error('폴더 이름을 입력해 주세요.');
    if (oldName !== trimmed && this.listFolders().includes(trimmed)) {
      throw new Error('같은 이름의 폴더가 있습니다.');
    }
    this.folders = this.folders.includes(oldName)
      ? this.folders.map((folder) => (folder === oldName ? trimmed : folder))
      : [...this.folders, trimmed];
    this.presets = this.presets.map((entry) =>
      entry.folder === oldName
        ? { ...entry, folder: trimmed, updatedAt: Date.now() }
        : entry,
    );
    this.scheduleSave();
    this.dispatchEvent(new CustomEvent('changed'));
  }

  @action
  deleteFolder(name: string): void {
    this.folders = this.folders.filter((folder) => folder !== name);
    this.presets = this.presets.map((entry) =>
      entry.folder === name
        ? { ...entry, folder: undefined, updatedAt: Date.now() }
        : entry,
    );
    this.scheduleSave();
    this.dispatchEvent(new CustomEvent('changed'));
  }

  // ---------- image helpers (data URI 파일) ----------
  getImagePath(filename: string): string {
    return GLOBAL_CHAR_IMAGES_DIR + '/' + filename.split('/').pop()!;
  }

  // 카드 표시용 등: data URI 그대로 반환 (img src로 바로 사용 가능)
  async fetchImageData(filename: string): Promise<string | null> {
    if (!filename) return null;
    try {
      const path = this.getImagePath(filename);
      const exists = await this.backend.existFile(path);
      if (!exists) return null;
      return await this.backend.readDataFile(path);
    } catch (e) {
      return null;
    }
  }

  private async storeImageData(dataUri: string): Promise<string> {
    // read-data-file은 data URI를 주지만 write-data-file은 raw base64를 기대한다.
    const base64 = dataUri.includes(',') ? dataUri.split(',')[1] : dataUri;
    const filename = uuidv4() + '.png';
    await this.backend.writeDataFile(GLOBAL_CHAR_IMAGES_DIR + '/' + filename, base64);
    return filename;
  }

  private async deleteImageData(filename: string) {
    if (!filename) return;
    try {
      await this.backend.deleteFile(this.getImagePath(filename));
    } catch (e) {}
  }

  private resolveNameCollision(name: string): string {
    if (!this.getByName(name)) return name;
    let i = 1;
    while (this.getByName(`${name} (${i})`)) i++;
    return `${name} (${i})`;
  }

  // ---------- 로컬 → 글로벌 ----------
  @action
  async addFromSessionPreset(
    session: Session,
    preset: CharacterPreset,
  ): Promise<IGlobalCharacterPresetEntry> {
    const json: ICharacterPreset = preset.toJSON();

    for (const vibe of json.vibes || []) {
      try {
        const data = await this.backend.readDataFile(
          this.imageService.getVibeImagePath(session, vibe.path),
        );
        if (data) vibe.path = await this.storeImageData(data);
      } catch (e) {}
    }
    for (const ref of json.characterReferences || []) {
      try {
        const data = await this.backend.readDataFile(
          this.imageService.getReferenceImagePath(session, ref.path),
        );
        if (data) ref.path = await this.storeImageData(data);
      } catch (e) {}
    }
    if (json.representativeImage) {
      try {
        const data = await this.backend.readDataFile(
          this.imageService.getVibeImagePath(session, json.representativeImage),
        );
        if (data) json.representativeImage = await this.storeImageData(data);
      } catch (e) {}
    }

    const name = this.resolveNameCollision(
      (json.name || '이름없음').trim() || '이름없음',
    );
    json.name = name;
    const entry: IGlobalCharacterPresetEntry = {
      id: uuidv4(),
      name,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      preset: json,
    };
    this.presets = [...this.presets, entry];
    this.scheduleSave();
    this.dispatchEvent(new CustomEvent('changed', {}));
    return entry;
  }

  // ---------- 글로벌 → 로컬 ----------
  async instantiateIntoSession(
    session: Session,
    id: string,
  ): Promise<CharacterPreset> {
    const entry = this.get(id);
    if (!entry) throw new Error('프리셋을 찾을 수 없습니다');
    const json: ICharacterPreset = JSON.parse(JSON.stringify(entry.preset));

    for (const vibe of json.vibes || []) {
      try {
        const dataUri = await this.fetchImageData(vibe.path);
        if (dataUri) {
          vibe.path = await this.imageService.storeVibeImage(
            session,
            dataUriToBase64(dataUri),
          );
        }
      } catch (e) {}
    }
    for (const ref of json.characterReferences || []) {
      try {
        const dataUri = await this.fetchImageData(ref.path);
        if (dataUri) {
          ref.path = await this.imageService.storeReferenceImage(
            session,
            dataUriToBase64(dataUri),
          );
        }
      } catch (e) {}
    }
    if (json.representativeImage) {
      try {
        const dataUri = await this.fetchImageData(json.representativeImage);
        if (dataUri) {
          json.representativeImage = await this.imageService.storeVibeImage(
            session,
            dataUriToBase64(dataUri),
          );
        }
      } catch (e) {}
    }

    const preset = CharacterPreset.fromJSON(json);
    // 로컬 이름 충돌 방지
    let nm = preset.name;
    while (session.hasCharacterPreset(nm)) nm = nm + ' (글로벌)';
    preset.name = nm;
    session.addCharacterPreset(preset);
    return preset;
  }

  // ---------- 편집기용 이미지 저장 (FileUploadBase64는 raw base64 제공) ----------
  async storeVibeForEditor(base64: string): Promise<string> {
    const filename = uuidv4() + '.png';
    await this.backend.writeDataFile(GLOBAL_CHAR_IMAGES_DIR + '/' + filename, base64);
    return filename;
  }

  async storeReferenceForEditor(base64: string): Promise<string> {
    // 글로벌 보관은 원본 유지; 실제 정규화/리사이즈는 프로젝트로 불러올 때 수행
    const filename = uuidv4() + '.png';
    await this.backend.writeDataFile(GLOBAL_CHAR_IMAGES_DIR + '/' + filename, base64);
    return filename;
  }

  private async copyImageToken(token: string): Promise<string> {
    const dataUri = await this.fetchImageData(token);
    if (!dataUri) return token;
    return await this.storeImageData(dataUri);
  }

  private collectImageTokens(preset: ICharacterPreset): string[] {
    const t: string[] = [];
    for (const v of preset.vibes || []) if (v.path) t.push(v.path);
    for (const r of preset.characterReferences || [])
      if (r.path) t.push(r.path);
    if (preset.representativeImage) t.push(preset.representativeImage);
    return t;
  }

  // ---------- 글로벌 직접 신규/수정/복제/정렬 ----------
  // 글로벌 모드 편집기에서 만든 프리셋(이미지 토큰이 이미 글로벌 디렉터리를 가리킴)을 등록
  @action
  async addPresetObject(
    preset: CharacterPreset,
  ): Promise<IGlobalCharacterPresetEntry> {
    const json: ICharacterPreset = preset.toJSON();
    const name = this.resolveNameCollision(
      (json.name || '이름없음').trim() || '이름없음',
    );
    json.name = name;
    const entry: IGlobalCharacterPresetEntry = {
      id: uuidv4(),
      name,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      preset: json,
    };
    this.presets = [...this.presets, entry];
    this.scheduleSave();
    this.dispatchEvent(new CustomEvent('changed', {}));
    return entry;
  }

  @action
  async updateEntry(id: string, preset: CharacterPreset): Promise<void> {
    const entry = this.get(id);
    if (!entry) throw new Error('프리셋을 찾을 수 없습니다');
    const oldTokens = new Set(this.collectImageTokens(entry.preset));
    const json: ICharacterPreset = preset.toJSON();
    let nm = (json.name || '이름없음').trim() || '이름없음';
    const other = this.getByName(nm);
    if (other && other.id !== id) nm = this.resolveNameCollision(nm);
    json.name = nm;
    const newTokens = new Set(this.collectImageTokens(json));
    entry.name = nm;
    entry.preset = json;
    entry.updatedAt = Date.now();
    this.presets = [...this.presets];
    // 더 이상 참조되지 않는 글로벌 이미지 정리
    for (const t of oldTokens) if (!newTokens.has(t)) await this.deleteImageData(t);
    this.scheduleSave();
    this.dispatchEvent(new CustomEvent('changed', {}));
  }

  @action
  async duplicateEntry(id: string): Promise<void> {
    const entry = this.get(id);
    if (!entry) return;
    const json: ICharacterPreset = JSON.parse(JSON.stringify(entry.preset));
    for (const v of json.vibes || [])
      if (v.path) v.path = await this.copyImageToken(v.path);
    for (const r of json.characterReferences || [])
      if (r.path) r.path = await this.copyImageToken(r.path);
    if (json.representativeImage)
      json.representativeImage = await this.copyImageToken(
        json.representativeImage,
      );
    const name = this.resolveNameCollision((entry.name || '이름없음') + ' 복사본');
    json.name = name;
    const newEntry: IGlobalCharacterPresetEntry = {
      id: uuidv4(),
      name,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      preset: json,
      ...(entry.folder ? { folder: entry.folder } : {}),
    };
    const idx = this.presets.findIndex((p) => p.id === id);
    const arr = [...this.presets];
    arr.splice(idx < 0 ? arr.length : idx + 1, 0, newEntry);
    this.presets = arr;
    this.scheduleSave();
    this.dispatchEvent(new CustomEvent('changed', {}));
  }

  @action
  reorder(from: number, to: number) {
    if (
      from === to ||
      from < 0 ||
      to < 0 ||
      from >= this.presets.length ||
      to >= this.presets.length
    )
      return;
    const arr = [...this.presets];
    const [m] = arr.splice(from, 1);
    arr.splice(to, 0, m);
    this.presets = arr;
    this.scheduleSave();
    this.dispatchEvent(new CustomEvent('changed', {}));
  }

  // ---------- write ----------
  @action
  async rename(id: string, newName: string) {
    const entry = this.get(id);
    if (!entry) throw new Error('프리셋을 찾을 수 없습니다');
    newName = newName.trim();
    if (!newName) throw new Error('이름을 입력해 주세요');
    if (entry.name === newName) return;
    if (this.getByName(newName)) throw new Error('이미 존재하는 이름입니다');
    entry.name = newName;
    entry.preset.name = newName;
    entry.updatedAt = Date.now();
    this.presets = [...this.presets];
    this.scheduleSave();
    this.dispatchEvent(new CustomEvent('changed', {}));
  }

  @action
  async delete(id: string) {
    const entry = this.get(id);
    if (!entry) return;
    const imgs: string[] = [];
    for (const v of entry.preset.vibes || []) imgs.push(v.path);
    for (const r of entry.preset.characterReferences || []) imgs.push(r.path);
    if (entry.preset.representativeImage)
      imgs.push(entry.preset.representativeImage);
    for (const f of imgs) await this.deleteImageData(f);
    this.presets = this.presets.filter((p) => p.id !== id);
    this.scheduleSave();
    this.dispatchEvent(new CustomEvent('changed', {}));
  }

  async exportToFileData(): Promise<any> {
    const output: any = { version: 1, presets: [] };
    for (const entry of this.presets) {
      const json: any = JSON.parse(JSON.stringify(entry.preset));
      json.vibeImages = [];
      for (const vibe of json.vibes || []) {
        const data = vibe.path ? await this.fetchImageData(vibe.path) : null;
        if (data) json.vibeImages.push({ filename: vibe.path, data });
      }
      json.referenceImages = [];
      for (const ref of json.characterReferences || []) {
        const data = ref.path ? await this.fetchImageData(ref.path) : null;
        if (data) json.referenceImages.push({ filename: ref.path, data });
      }
      if (json.representativeImage) {
        json.representativeImageData = await this.fetchImageData(
          json.representativeImage,
        );
      }
      if (entry.folder) json.globalFolder = entry.folder;
      output.presets.push(json);
    }
    return output;
  }

  @action
  async importFromFileData(data: any): Promise<number> {
    if (!data || !Array.isArray(data.presets)) {
      throw new Error('올바른 캐릭터 프리셋 파일이 아닙니다.');
    }
    let imported = 0;
    for (const raw of data.presets) {
      if (!raw || typeof raw !== 'object') continue;
      try {
        const json: any = JSON.parse(JSON.stringify(raw));
        const folder =
          typeof json.globalFolder === 'string' && json.globalFolder.trim()
            ? json.globalFolder.trim()
            : undefined;
        const images = new Map<string, string>();
        for (const image of [
          ...(json.vibeImages || []),
          ...(json.referenceImages || []),
        ]) {
          if (!image?.filename || typeof image.data !== 'string') continue;
          images.set(
            String(image.filename).split('/').pop()!,
            await this.storeImageData(image.data),
          );
        }
        for (const vibe of json.vibes || []) {
          vibe.path = images.get(String(vibe.path || '').split('/').pop()!) || '';
        }
        for (const ref of json.characterReferences || []) {
          ref.path = images.get(String(ref.path || '').split('/').pop()!) || '';
        }
        json.representativeImage =
          json.representativeImage && typeof json.representativeImageData === 'string'
            ? await this.storeImageData(json.representativeImageData)
            : '';
        delete json.vibeImages;
        delete json.referenceImages;
        delete json.representativeImageData;
        delete json.globalFolder;
        const clean = CharacterPreset.fromJSON(json).toJSON();
        const name = this.resolveNameCollision(clean.name?.trim() || '이름없음');
        clean.name = name;
        this.presets = [
          ...this.presets,
          {
            id: uuidv4(),
            name,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            preset: clean,
            ...(folder ? { folder } : {}),
          },
        ];
        if (folder && !this.folders.includes(folder)) {
          this.folders = [...this.folders, folder];
        }
        imported += 1;
      } catch (error) {
        console.error('글로벌 캐릭터 프리셋 항목 불러오기 실패:', error);
      }
    }
    if (imported) {
      this.scheduleSave();
      this.dispatchEvent(new CustomEvent('changed'));
    }
    return imported;
  }
}
