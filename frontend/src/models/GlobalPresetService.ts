import { observable, action } from 'mobx';
import { v4 as uuidv4 } from 'uuid';
import { backend, imageService, workFlowService } from '.';
import { Session } from './types';
import { dataUriToBase64 } from './ImageService';
import { DebouncedJsonStore } from './DebouncedJsonStore';
import {
  readJSONFromPNG,
  embedJSONInPNG,
  normalizePresetJson,
  createImageWithText,
} from './SessionService';

const GLOBAL_PRESETS_FILE = 'global_presets.json';
const GLOBAL_VIBES_DIR = 'global_vibes';
// v2: 이지/일반 통합. load 시 파일이 v1이면 migrateUnify 1회(이름 타입무관 고유화). (SDStudio 4.12)
const GLOBAL_PRESETS_VERSION = 2;

export type GlobalPresetType = 'SDImageGenEasy' | 'SDImageGen';
export const SUPPORTED_GLOBAL_PRESET_TYPES: GlobalPresetType[] = [
  'SDImageGenEasy',
  'SDImageGen',
];

export interface IGlobalPresetEntry {
  id: string;
  name: string;
  workflowType: GlobalPresetType;
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
  profile?: string; // filename inside global_vibes/
  preset: any; // preset.toJSON() minus profile
}

export interface IGlobalPresetStore {
  version: number;
  presets: IGlobalPresetEntry[];
}

export class GlobalPresetService extends DebouncedJsonStore {
  @observable accessor presets: IGlobalPresetEntry[] = [];
  // load 시 파일 version < 2면 set — super.load() 후 migrateUnify 1회 트리거(이지/일반 통합).
  private needsUnifyMigration = false;

  // ---------- lifecycle ----------

  protected getFileName(): string {
    return GLOBAL_PRESETS_FILE;
  }

  protected saveErrorLabel(): string {
    return 'global presets';
  }

  protected buildStore(): IGlobalPresetStore {
    return { version: GLOBAL_PRESETS_VERSION, presets: this.presets };
  }

  protected applyParsed(json: any): void {
    const j = json as IGlobalPresetStore;
    // 파일 버전 < 현재면 super.load() 후 통합 마이그레이션 필요(load 오버라이드에서 처리).
    this.needsUnifyMigration =
      (((j as any) && (j as any).version) || 1) < GLOBAL_PRESETS_VERSION;
    if (j && Array.isArray(j.presets)) {
      this.presets = j.presets.filter(
        (p) =>
          p &&
          typeof p.id === 'string' &&
          typeof p.name === 'string' &&
          SUPPORTED_GLOBAL_PRESET_TYPES.includes(p.workflowType),
      );
    } else {
      this.presets = [];
    }
  }

  protected resetState(): void {
    this.presets = [];
    this.needsUnifyMigration = false; // 신규/손상 → v2 빈 store로 save, 마이그레이션 불필요
  }

  // super.load() 후 v1→v2 통합 마이그레이션을 1회 트리거(applyParsed에서 needsUnifyMigration set).
  // base load()는 sync applyParsed만 호출하므로, async migrateUnify(.bak 백업+save)는 여기서.
  async load(): Promise<void> {
    await super.load();
    if (this.needsUnifyMigration) {
      this.needsUnifyMigration = false;
      try {
        await this.migrateUnify();
      } catch (e) {
        console.error('글로벌 프리셋 통합 마이그레이션 실패:', e);
      }
    }
  }

  // v2 통합 마이그레이션: 타입(이지/일반) 구분 없이 이름이 겹치면 뒤(나중에 만든) 것에
  // " (2)", " (3)"... 을 붙여 라이브러리 전체에서 이름을 고유하게 만든다. 비파괴(.bak 백업).
  private async migrateUnify(): Promise<void> {
    // 백업은 *필수*. migrateUnify는 super.load()가 파일을 v1으로 성공 파싱했을 때만 실행되므로
    // (applyParsed가 needsUnifyMigration set, 읽기실패/손상이면 resetState로 false) 파일은 반드시
    // 존재한다 — 옛 "파일 없으면 백업 불필요" 분기는 도달 불가였음. 백업이 실패(읽기/쓰기 어느 쪽이든)
    // 하면 save()로 원본을 덮어쓰면 백업 없이 손실되므로, 덮어쓰지 않고 중단한다(version v1 유지 →
    // 다음 로드가 원본에서 재시도 = 멱등). 사용자에게도 'unify-backup-failed'로 알린다.
    try {
      const cur = await backend.readFile(GLOBAL_PRESETS_FILE);
      await backend.writeFile(
        GLOBAL_PRESETS_FILE + '.bak-unify-' + Date.now(),
        cur,
      );
    } catch (e) {
      console.error(
        '글로벌 프리셋 통합 — 백업 실패로 중단(원본 보존, 다음 로드 재시도):',
        e,
      );
      this.dispatchEvent(new CustomEvent('unify-backup-failed', {}));
      return;
    }
    if (this.presets.length > 0) {
      // createdAt 오름차순 — 먼저 만든 프리셋이 원래 이름을 유지
      const used = new Set<string>();
      const ordered = [...this.presets].sort(
        (a, b) => (a.createdAt || 0) - (b.createdAt || 0),
      );
      for (const entry of ordered) {
        if (!used.has(entry.name)) {
          used.add(entry.name);
          continue;
        }
        let k = 2;
        while (used.has(`${entry.name} (${k})`)) k++;
        entry.name = `${entry.name} (${k})`;
        used.add(entry.name);
      }
      this.presets = [...this.presets];
    }
    // 버전을 v2로 올려 저장 (빈 목록이어도 재실행 방지)
    await this.save();
  }

  // 모드 간 프리셋 변환. 두 타입의 프리셋 구조 차이는 characterPrompts 위치뿐:
  //  - SDImageGen: characterPrompts를 프리셋 레벨에 가짐
  //  - SDImageGenEasy: 프리셋엔 없음(캐릭터는 씬/공유 레벨)
  // 이지→일반은 무손실(빈 배열 보강), 일반→이지는 프리셋 레벨 characterPrompts를 버린다.
  private convertPresetJSON(
    presetJSON: any,
    from: GlobalPresetType,
    to: GlobalPresetType,
  ): any {
    if (from === to) return presetJSON;
    const out = { ...presetJSON };
    if (to === 'SDImageGenEasy') {
      delete out.characterPrompts;
    } else {
      if (!Array.isArray(out.characterPrompts)) out.characterPrompts = [];
    }
    return out;
  }

  // ---------- read ----------

  list(type?: GlobalPresetType): IGlobalPresetEntry[] {
    if (type) return this.presets.filter((p) => p.workflowType === type);
    return this.presets.slice();
  }

  get(id: string): IGlobalPresetEntry | undefined {
    return this.presets.find((p) => p.id === id);
  }

  getByName(
    type: GlobalPresetType,
    name: string,
  ): IGlobalPresetEntry | undefined {
    return this.presets.find(
      (p) => p.workflowType === type && p.name === name,
    );
  }

  getDefaults(type: GlobalPresetType): IGlobalPresetEntry[] {
    return this.presets.filter(
      (p) => p.workflowType === type && p.isDefault,
    );
  }

  // ---------- profile image helpers ----------

  getProfilePath(profile: string): string {
    return GLOBAL_VIBES_DIR + '/' + profile.split('/').pop()!;
  }

  async fetchProfileImage(profile: string): Promise<string | null> {
    if (!profile) return null;
    const path = this.getProfilePath(profile);
    try {
      const exists = await backend.existFile(path);
      if (!exists) return null;
      return await backend.readDataFile(path);
    } catch (e) {
      return null;
    }
  }

  private async storeProfileImage(base64: string): Promise<string> {
    const filename = uuidv4() + '.png';
    const path = GLOBAL_VIBES_DIR + '/' + filename;
    await backend.writeDataFile(path, base64);
    return filename;
  }

  private async deleteProfileImage(profile: string): Promise<void> {
    if (!profile) return;
    try {
      await backend.deleteFile(this.getProfilePath(profile));
    } catch (e) {
      // ignore — file may already be missing
    }
  }

  // ---------- write ----------

  private resolveNameCollision(
    type: GlobalPresetType,
    name: string,
  ): string {
    if (!this.getByName(type, name)) return name;
    let i = 1;
    while (this.getByName(type, `${name} (${i})`)) i++;
    return `${name} (${i})`;
  }

  @action
  async addFromSessionPreset(
    session: Session,
    preset: any,
  ): Promise<IGlobalPresetEntry> {
    if (!preset || !preset.type) {
      throw new Error('유효하지 않은 프리셋입니다');
    }
    if (!SUPPORTED_GLOBAL_PRESET_TYPES.includes(preset.type)) {
      throw new Error(
        `이 워크플로우 타입(${preset.type})은 글로벌 프리셋으로 저장할 수 없습니다`,
      );
    }

    // Detached clone via toJSON
    const json: any =
      typeof preset.toJSON === 'function'
        ? preset.toJSON()
        : JSON.parse(JSON.stringify(preset));

    // Copy profile image if present
    let newProfile: string | undefined;
    const srcProfile = json.profile || preset.profile;
    if (srcProfile) {
      try {
        const dataUri = await imageService.fetchVibeImage(session, srcProfile);
        if (dataUri) {
          const base64 = dataUriToBase64(dataUri);
          newProfile = await this.storeProfileImage(base64);
        }
      } catch (e) {
        console.warn('Failed to copy profile image to global:', e);
      }
    }

    // Strip profile from stored preset JSON so it lives only in entry.profile
    if ('profile' in json) delete json.profile;

    const resolvedName = this.resolveNameCollision(
      preset.type,
      preset.name || '이름없음',
    );

    const entry: IGlobalPresetEntry = {
      id: uuidv4(),
      name: resolvedName,
      workflowType: preset.type,
      isDefault: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      profile: newProfile,
      preset: json,
    };

    this.presets = [...this.presets, entry];
    this.scheduleSave();
    this.dispatchEvent(new CustomEvent('changed', {}));
    return entry;
  }

  /**
   * 메모리상의 preset 객체와 원본 이미지 base64를 받아 글로벌 엔트리 생성.
   * 세션에 의존하지 않으므로 ExternalImageView 등 "세션 외부"에서 구성된
   * 프리셋을 바로 글로벌에 저장할 때 사용.
   */
  @action
  async addFromPresetAndImage(
    preset: any,
    imageBase64: string | null,
    suggestedName: string,
  ): Promise<IGlobalPresetEntry> {
    if (!preset || !preset.type) {
      throw new Error('유효하지 않은 프리셋입니다');
    }
    if (!SUPPORTED_GLOBAL_PRESET_TYPES.includes(preset.type)) {
      throw new Error(
        `이 워크플로우 타입(${preset.type})은 글로벌 프리셋으로 저장할 수 없습니다`,
      );
    }

    // Detached clone via toJSON
    const json: any =
      typeof preset.toJSON === 'function'
        ? preset.toJSON()
        : JSON.parse(JSON.stringify(preset));

    // Store image as profile if provided
    let newProfile: string | undefined;
    if (imageBase64) {
      try {
        newProfile = await this.storeProfileImage(imageBase64);
      } catch (e) {
        console.warn('Failed to store profile image for global preset:', e);
      }
    }

    // Strip profile from stored preset JSON
    if ('profile' in json) delete json.profile;

    const resolvedName = this.resolveNameCollision(
      preset.type,
      (suggestedName || preset.name || '이름없음').trim() || '이름없음',
    );

    const entry: IGlobalPresetEntry = {
      id: uuidv4(),
      name: resolvedName,
      workflowType: preset.type,
      isDefault: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      profile: newProfile,
      preset: json,
    };

    this.presets = [...this.presets, entry];
    this.scheduleSave();
    this.dispatchEvent(new CustomEvent('changed', {}));
    return entry;
  }

  @action
  async importFromPng(
    base64: string,
  ): Promise<IGlobalPresetEntry | undefined> {
    let json = readJSONFromPNG(base64);
    if (!json || !json.type || !json.name) return undefined;

    json = normalizePresetJson(json);

    if (!SUPPORTED_GLOBAL_PRESET_TYPES.includes(json.type)) {
      throw new Error(
        `이 워크플로우 타입(${json.type})은 글로벌 프리셋으로 저장할 수 없습니다`,
      );
    }

    // Store the full PNG as the profile image (matches importPreset behavior)
    const newProfile = await this.storeProfileImage(base64);

    // Remove any profile path from embedded JSON; we own the image now
    if ('profile' in json) delete json.profile;

    const resolvedName = this.resolveNameCollision(
      json.type,
      json.name || '이름없음',
    );

    const entry: IGlobalPresetEntry = {
      id: uuidv4(),
      name: resolvedName,
      workflowType: json.type,
      isDefault: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      profile: newProfile,
      preset: json,
    };

    this.presets = [...this.presets, entry];
    this.scheduleSave();
    this.dispatchEvent(new CustomEvent('changed', {}));
    return entry;
  }

  @action
  async rename(id: string, newName: string): Promise<void> {
    const entry = this.get(id);
    if (!entry) throw new Error('프리셋을 찾을 수 없습니다');
    newName = newName.trim();
    if (!newName) throw new Error('이름을 입력해 주세요');
    if (entry.name === newName) return;
    const existing = this.getByName(entry.workflowType, newName);
    if (existing && existing.id !== id) {
      throw new Error('이미 존재하는 이름입니다');
    }
    entry.name = newName;
    entry.updatedAt = Date.now();
    this.presets = [...this.presets];
    this.scheduleSave();
    this.dispatchEvent(new CustomEvent('changed', {}));
  }

  @action
  async setDefault(id: string, value: boolean): Promise<void> {
    const entry = this.get(id);
    if (!entry) throw new Error('프리셋을 찾을 수 없습니다');
    if (entry.isDefault === value) return;
    entry.isDefault = value;
    entry.updatedAt = Date.now();
    this.presets = [...this.presets];
    this.scheduleSave();
    this.dispatchEvent(new CustomEvent('changed', {}));
  }

  @action
  async delete(id: string): Promise<void> {
    const entry = this.get(id);
    if (!entry) return;
    if (entry.profile) {
      await this.deleteProfileImage(entry.profile);
    }
    this.presets = this.presets.filter((p) => p.id !== id);
    this.scheduleSave();
    this.dispatchEvent(new CustomEvent('changed', {}));
  }

  @action
  async replaceProfileImage(id: string, base64: string): Promise<void> {
    const entry = this.get(id);
    if (!entry) throw new Error('프리셋을 찾을 수 없습니다');
    const oldProfile = entry.profile;
    const newProfile = await this.storeProfileImage(base64);
    entry.profile = newProfile;
    entry.updatedAt = Date.now();
    this.presets = [...this.presets];
    if (oldProfile && oldProfile !== newProfile) {
      await this.deleteProfileImage(oldProfile);
    }
    this.scheduleSave();
    this.dispatchEvent(new CustomEvent('changed', {}));
  }

  // ---------- session ↔ global ----------

  @action
  async updatePreset(id: string, patch: Record<string, any>): Promise<void> {
    const entry = this.get(id);
    if (!entry) throw new Error('프리셋을 찾을 수 없습니다');
    entry.preset = { ...(entry.preset || {}), ...patch };
    entry.updatedAt = Date.now();
    this.presets = [...this.presets];
    this.scheduleSave();
    this.dispatchEvent(new CustomEvent('changed', {}));
  }

  async instantiateIntoSession(
    session: Session,
    id: string,
    targetType?: GlobalPresetType,
  ): Promise<any> {
    const entry = this.get(id);
    if (!entry) throw new Error('프리셋을 찾을 수 없습니다');

    // 적용 타깃 모드(미지정 시 원본 타입). 다르면 프리셋 구조를 변환한다.
    const target =
      targetType && SUPPORTED_GLOBAL_PRESET_TYPES.includes(targetType)
        ? targetType
        : entry.workflowType;

    // Deep clone preset JSON + 모드 변환
    let clone = JSON.parse(JSON.stringify(entry.preset));
    clone = this.convertPresetJSON(clone, entry.workflowType, target);
    clone.type = target;
    clone.name = entry.name;

    // Copy profile image from global_vibes -> session vibes
    if (entry.profile) {
      try {
        const dataUri = await this.fetchProfileImage(entry.profile);
        if (dataUri) {
          const base64 = dataUriToBase64(dataUri);
          const sessionProfile = await imageService.storeVibeImage(
            session,
            base64,
          );
          clone.profile = sessionProfile;
        }
      } catch (e) {
        console.warn('Failed to copy global profile to session:', e);
      }
    }

    const preset = workFlowService.presetFromJSON(clone);
    if (!preset) throw new Error('프리셋 복원 실패');
    session.addPreset(preset);
    return preset;
  }

  async exportToPng(id: string, outPath: string): Promise<void> {
    const entry = this.get(id);
    if (!entry) throw new Error('프리셋을 찾을 수 없습니다');

    // Build the PNG to embed JSON in
    let pngBase64: string | null = null;
    if (entry.profile) {
      const dataUri = await this.fetchProfileImage(entry.profile);
      if (dataUri) {
        const raw = dataUriToBase64(dataUri);
        if (raw.startsWith('iVBOR')) {
          pngBase64 = raw;
        }
      }
    }

    if (!pngBase64) {
      // Fallback: create placeholder image
      pngBase64 = createImageWithText(832, 1216, entry.name);
    }

    // Construct JSON with type/name/profile so it can be re-imported
    const jsonForPng = {
      ...entry.preset,
      type: entry.workflowType,
      name: entry.name,
    };

    const newPng = embedJSONInPNG(pngBase64, jsonForPng);
    await backend.writeDataFile(outPath, newPng);
  }
}
