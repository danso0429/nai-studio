import { observable, action } from 'mobx';
import { v4 as uuidv4 } from 'uuid';
import { DebouncedJsonStore } from './DebouncedJsonStore';

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

export class SamplingPresetService extends DebouncedJsonStore {
  @observable accessor presets: ISamplingPreset[] = [];

  protected getFileName(): string {
    return SAMPLING_PRESETS_FILE;
  }

  protected saveErrorLabel(): string {
    return 'sampling presets';
  }

  protected buildStore(): ISamplingPresetStore {
    return { version: 1, presets: this.presets };
  }

  protected applyParsed(json: any): void {
    const j = json as ISamplingPresetStore;
    if (j && Array.isArray(j.presets)) {
      this.presets = j.presets.filter(
        (p) => p && typeof p.id === 'string' && typeof p.name === 'string',
      );
    } else {
      this.presets = [];
    }
  }

  protected resetState(): void {
    this.presets = [];
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
