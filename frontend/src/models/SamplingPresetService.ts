import { observable, action } from 'mobx';
import { v4 as uuidv4 } from 'uuid';
import { backend } from '.';

const SAMPLING_PRESETS_FILE = 'sampling_presets.json';

// 샘플링 프리셋 = 이름 붙인 생성 파라미터 묶음 (steps/guidance/rescale/sampler/schedule).
// chunk(태그 묶음)로 담을 수 없는 샘플링 설정을 이름 붙여 저장·적용.
// 전역 저장(프로젝트 무관), 적용/해제 override 모델.
export interface ISamplingPresetFields {
  steps?: number;
  promptGuidance?: number;
  cfgRescale?: number;
  sampling?: string;
  noiseSchedule?: string;
}

export interface ISamplingPreset extends ISamplingPresetFields {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

export interface ISamplingPresetStore {
  version: 1;
  presets: ISamplingPreset[];
}

// 빈 묶음(아무 필드도 없음)인지 — 적용해도 override가 0개라 무의미.
export function isSamplingPresetEmpty(p: ISamplingPresetFields): boolean {
  return (
    p.steps == null &&
    p.promptGuidance == null &&
    p.cfgRescale == null &&
    p.sampling == null &&
    p.noiseSchedule == null
  );
}

export class SamplingPresetService extends EventTarget {
  @observable accessor presets: ISamplingPreset[] = [];
  @observable accessor loaded: boolean = false;
  private saveTimeout: any = null;

  constructor() {
    super();
    // 2초 debounce가 fire 전 탭 닫히면 손실 → visibility hidden 시 keepalive fetch로 강제 flush.
    if (typeof document !== 'undefined') {
      const flushOnHide = () => {
        if (document.visibilityState !== 'hidden') return;
        if (!this.saveTimeout) return;
        clearTimeout(this.saveTimeout);
        this.saveTimeout = null;
        backend.writeFileKeepalive(
          SAMPLING_PRESETS_FILE,
          JSON.stringify(this.buildStore()),
        );
      };
      document.addEventListener('visibilitychange', flushOnHide);
      window.addEventListener('pagehide', flushOnHide);
    }
  }

  private buildStore(): ISamplingPresetStore {
    return { version: 1, presets: this.presets };
  }

  async load(): Promise<void> {
    try {
      const str = await backend.readFile(SAMPLING_PRESETS_FILE);
      try {
        const json = JSON.parse(str) as ISamplingPresetStore;
        if (json && Array.isArray(json.presets)) {
          this.presets = json.presets.filter(
            (p) =>
              p && typeof p.id === 'string' && typeof p.name === 'string',
          );
        } else {
          this.presets = [];
        }
      } catch (parseErr) {
        const corruptName = `${SAMPLING_PRESETS_FILE}.corrupt-${Date.now()}`;
        try {
          await backend.renameFile(SAMPLING_PRESETS_FILE, corruptName);
        } catch (e) {
          // ignore rename errors
        }
        this.presets = [];
        this.dispatchEvent(
          new CustomEvent('corrupted', { detail: { backupName: corruptName } }),
        );
      }
    } catch (e) {
      this.presets = [];
    }
    this.loaded = true;
    this.dispatchEvent(new CustomEvent('loaded', {}));
  }

  async save(): Promise<void> {
    const data = JSON.stringify(this.buildStore());
    const tmp = SAMPLING_PRESETS_FILE + '.tmp';
    try {
      await backend.writeFile(tmp, data);
      await backend.renameFile(tmp, SAMPLING_PRESETS_FILE);
    } catch (e) {
      try {
        await backend.writeFile(SAMPLING_PRESETS_FILE, data);
      } catch (e2) {
        console.error('Failed to save sampling presets:', e2);
      }
    }
  }

  scheduleSave(): void {
    if (this.saveTimeout) clearTimeout(this.saveTimeout);
    this.saveTimeout = setTimeout(() => {
      this.save();
      this.saveTimeout = null;
    }, 2000);
  }

  async flushSave(): Promise<void> {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }
    await this.save();
  }

  list(): ISamplingPreset[] {
    return this.presets.slice();
  }

  get(id: string): ISamplingPreset | undefined {
    return this.presets.find((p) => p.id === id);
  }

  getByName(name: string): ISamplingPreset | undefined {
    return this.presets.find((p) => p.name === name);
  }

  private resolveNameCollision(name: string, ignoreId?: string): string {
    const conflict = (n: string) =>
      this.presets.some((p) => p.name === n && p.id !== ignoreId);
    if (!conflict(name)) return name;
    let i = 1;
    while (conflict(`${name} (${i})`)) i++;
    return `${name} (${i})`;
  }

  @action
  add(name: string, fields: ISamplingPresetFields): ISamplingPreset {
    name = name.trim();
    if (!name) throw new Error('이름을 입력해 주세요');
    const entry: ISamplingPreset = {
      id: uuidv4(),
      name: this.resolveNameCollision(name),
      steps: fields.steps,
      promptGuidance: fields.promptGuidance,
      cfgRescale: fields.cfgRescale,
      sampling: fields.sampling,
      noiseSchedule: fields.noiseSchedule,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.presets = [...this.presets, entry];
    this.scheduleSave();
    this.dispatchEvent(new CustomEvent('changed', {}));
    return entry;
  }

  @action
  update(id: string, fields: ISamplingPresetFields): void {
    const entry = this.get(id);
    if (!entry) throw new Error('샘플링 프리셋을 찾을 수 없습니다');
    entry.steps = fields.steps;
    entry.promptGuidance = fields.promptGuidance;
    entry.cfgRescale = fields.cfgRescale;
    entry.sampling = fields.sampling;
    entry.noiseSchedule = fields.noiseSchedule;
    entry.updatedAt = Date.now();
    this.presets = [...this.presets];
    this.scheduleSave();
    this.dispatchEvent(new CustomEvent('changed', {}));
  }

  @action
  rename(id: string, newName: string): void {
    const entry = this.get(id);
    if (!entry) throw new Error('샘플링 프리셋을 찾을 수 없습니다');
    newName = newName.trim();
    if (!newName) throw new Error('이름을 입력해 주세요');
    if (entry.name === newName) return;
    const existing = this.presets.find((p) => p.name === newName);
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
  delete(id: string): void {
    const entry = this.get(id);
    if (!entry) return;
    this.presets = this.presets.filter((p) => p.id !== id);
    this.scheduleSave();
    this.dispatchEvent(new CustomEvent('changed', {}));
  }
}
