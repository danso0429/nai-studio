import { observable, action } from 'mobx';
import { v4 as uuidv4 } from 'uuid';
import { backend } from '.';

const PROMPT_PRESETS_FILE = 'prompt_presets.json';

export interface IPromptPresetSamplingOverrides {
  steps?: number;
  promptGuidance?: number;
  cfgRescale?: number;
  sampling?: string;
  noiseSchedule?: string;
}

export interface IPromptPreset {
  id: string;
  name: string;
  frontPrompt: string;
  backPrompt: string;
  uc: string;
  samplingOverrides?: IPromptPresetSamplingOverrides;
  createdAt: number;
  updatedAt: number;
}

export interface IPromptPresetStore {
  version: 1;
  presets: IPromptPreset[];
}

export class PromptPresetService extends EventTarget {
  @observable accessor presets: IPromptPreset[] = [];
  @observable accessor loaded: boolean = false;
  private saveTimeout: any = null;

  constructor() {
    super();
    // GlobalPresetService와 동일 패턴 — 2초 debounce가 fire 전 탭 닫히면 손실.
    // visibility hidden 시 keepalive fetch로 강제 flush.
    if (typeof document !== 'undefined') {
      const flushOnHide = () => {
        if (document.visibilityState !== 'hidden') return;
        if (!this.saveTimeout) return;
        clearTimeout(this.saveTimeout);
        this.saveTimeout = null;
        const store: IPromptPresetStore = {
          version: 1,
          presets: this.presets,
        };
        backend.writeFileKeepalive(PROMPT_PRESETS_FILE, JSON.stringify(store));
      };
      document.addEventListener('visibilitychange', flushOnHide);
      window.addEventListener('pagehide', flushOnHide);
    }
  }

  async load(): Promise<void> {
    try {
      const str = await backend.readFile(PROMPT_PRESETS_FILE);
      try {
        const json = JSON.parse(str) as IPromptPresetStore;
        if (json && Array.isArray(json.presets)) {
          this.presets = json.presets.filter(
            (p) =>
              p &&
              typeof p.id === 'string' &&
              typeof p.name === 'string' &&
              typeof p.frontPrompt === 'string' &&
              typeof p.backPrompt === 'string' &&
              typeof p.uc === 'string',
          );
        } else {
          this.presets = [];
        }
      } catch (parseErr) {
        const corruptName = `${PROMPT_PRESETS_FILE}.corrupt-${Date.now()}`;
        try {
          await backend.renameFile(PROMPT_PRESETS_FILE, corruptName);
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
    const store: IPromptPresetStore = {
      version: 1,
      presets: this.presets,
    };
    const data = JSON.stringify(store);
    const tmp = PROMPT_PRESETS_FILE + '.tmp';
    try {
      await backend.writeFile(tmp, data);
      await backend.renameFile(tmp, PROMPT_PRESETS_FILE);
    } catch (e) {
      try {
        await backend.writeFile(PROMPT_PRESETS_FILE, data);
      } catch (e2) {
        console.error('Failed to save prompt presets:', e2);
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

  list(): IPromptPreset[] {
    return this.presets.slice();
  }

  get(id: string): IPromptPreset | undefined {
    return this.presets.find((p) => p.id === id);
  }

  getByName(name: string): IPromptPreset | undefined {
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
  add(
    name: string,
    frontPrompt: string,
    backPrompt: string,
    uc: string,
    samplingOverrides?: IPromptPresetSamplingOverrides,
  ): IPromptPreset {
    name = name.trim();
    if (!name) throw new Error('이름을 입력해 주세요');
    const resolvedName = this.resolveNameCollision(name);
    const entry: IPromptPreset = {
      id: uuidv4(),
      name: resolvedName,
      frontPrompt,
      backPrompt,
      uc,
      samplingOverrides,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.presets = [...this.presets, entry];
    this.scheduleSave();
    this.dispatchEvent(new CustomEvent('changed', {}));
    return entry;
  }

  @action
  update(
    id: string,
    frontPrompt: string,
    backPrompt: string,
    uc: string,
    samplingOverrides?: IPromptPresetSamplingOverrides,
  ): void {
    const entry = this.get(id);
    if (!entry) throw new Error('프리셋을 찾을 수 없습니다');
    entry.frontPrompt = frontPrompt;
    entry.backPrompt = backPrompt;
    entry.uc = uc;
    entry.samplingOverrides = samplingOverrides;
    entry.updatedAt = Date.now();
    this.presets = [...this.presets];
    this.scheduleSave();
    this.dispatchEvent(new CustomEvent('changed', {}));
  }

  @action
  rename(id: string, newName: string): void {
    const entry = this.get(id);
    if (!entry) throw new Error('프리셋을 찾을 수 없습니다');
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
