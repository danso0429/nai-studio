import { observable, action } from 'mobx';
import { v4 as uuidv4 } from 'uuid';
import { backend } from '.';

const TOGGLE_GROUPS_FILE = 'toggle_groups.json';

// 씬 토글 그룹 — 조합 piece에 박힌 충돌 태그(예: nude 복장과 부딪히는 'fully clothed
// female')를 묶어 on/off. 그룹 "정의"(name/tags)는 씬 이름을 키로 전역 공유 —
// 같은 이름 씬이면 다른 프로젝트에서도 동일 그룹이 보임. 추가/이름·태그 수정/삭제는
// 모두 같은 이름 씬에 공유. on/off(enabled)만 씬(프로젝트)별로 Scene.toggleGroupStates에
// 따로 저장. 2026-05-31.
export interface ISharedToggleGroup {
  id: string;
  name: string;
  tags: string[];
}

export interface IToggleGroupStore {
  version: 1;
  groupsByScene: { [sceneName: string]: ISharedToggleGroup[] };
}

export class ToggleGroupService extends EventTarget {
  @observable accessor groupsByScene: {
    [sceneName: string]: ISharedToggleGroup[];
  } = {};
  @observable accessor loaded: boolean = false;
  private saveTimeout: any = null;

  constructor() {
    super();
    // 2초 debounce가 fire 전 탭 닫히면 손실 → visibility hidden 시 keepalive로 강제 flush.
    if (typeof document !== 'undefined') {
      const flushOnHide = () => {
        if (document.visibilityState !== 'hidden') return;
        if (!this.saveTimeout) return;
        clearTimeout(this.saveTimeout);
        this.saveTimeout = null;
        backend.writeFileKeepalive(
          TOGGLE_GROUPS_FILE,
          JSON.stringify(this.buildStore()),
        );
      };
      document.addEventListener('visibilitychange', flushOnHide);
      window.addEventListener('pagehide', flushOnHide);
    }
  }

  private buildStore(): IToggleGroupStore {
    return { version: 1, groupsByScene: this.groupsByScene };
  }

  async load(): Promise<void> {
    try {
      const str = await backend.readFile(TOGGLE_GROUPS_FILE);
      try {
        const json = JSON.parse(str) as IToggleGroupStore;
        const raw = json?.groupsByScene;
        const clean: { [k: string]: ISharedToggleGroup[] } = {};
        if (raw && typeof raw === 'object') {
          for (const [sceneName, groups] of Object.entries(raw)) {
            if (!Array.isArray(groups)) continue;
            clean[sceneName] = groups
              .filter(
                (g: any) =>
                  g && typeof g.id === 'string' && typeof g.name === 'string',
              )
              .map((g: any) => ({
                id: g.id,
                name: g.name,
                tags: Array.isArray(g.tags)
                  ? g.tags.filter((t: any) => typeof t === 'string')
                  : [],
              }));
          }
        }
        this.groupsByScene = clean;
      } catch (parseErr) {
        const corruptName = `${TOGGLE_GROUPS_FILE}.corrupt-${Date.now()}`;
        try {
          await backend.renameFile(TOGGLE_GROUPS_FILE, corruptName);
        } catch (e) {
          // ignore rename errors
        }
        this.groupsByScene = {};
        this.dispatchEvent(
          new CustomEvent('corrupted', { detail: { backupName: corruptName } }),
        );
      }
    } catch (e) {
      this.groupsByScene = {};
    }
    this.loaded = true;
    this.dispatchEvent(new CustomEvent('loaded', {}));
  }

  async save(): Promise<void> {
    const data = JSON.stringify(this.buildStore());
    const tmp = TOGGLE_GROUPS_FILE + '.tmp';
    try {
      await backend.writeFile(tmp, data);
      await backend.renameFile(tmp, TOGGLE_GROUPS_FILE);
    } catch (e) {
      try {
        await backend.writeFile(TOGGLE_GROUPS_FILE, data);
      } catch (e2) {
        console.error('Failed to save toggle groups:', e2);
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

  // 씬 이름으로 그룹 목록 조회 (복사본 — mutate은 add/update/remove 통해서만).
  list(sceneName: string): ISharedToggleGroup[] {
    return (this.groupsByScene[sceneName] ?? []).slice();
  }

  @action
  addGroup(sceneName: string, name: string, tags: string[]): ISharedToggleGroup {
    const entry: ISharedToggleGroup = { id: uuidv4(), name, tags };
    const cur = this.groupsByScene[sceneName] ?? [];
    this.groupsByScene = {
      ...this.groupsByScene,
      [sceneName]: [...cur, entry],
    };
    this.scheduleSave();
    this.dispatchEvent(new CustomEvent('changed', {}));
    return entry;
  }

  @action
  updateGroup(
    sceneName: string,
    id: string,
    fields: { name?: string; tags?: string[] },
  ): void {
    const cur = this.groupsByScene[sceneName];
    if (!cur) return;
    const next = cur.map((g) =>
      g.id === id
        ? {
            ...g,
            ...(fields.name !== undefined ? { name: fields.name } : {}),
            ...(fields.tags !== undefined ? { tags: fields.tags } : {}),
          }
        : g,
    );
    this.groupsByScene = { ...this.groupsByScene, [sceneName]: next };
    this.scheduleSave();
    this.dispatchEvent(new CustomEvent('changed', {}));
  }

  @action
  removeGroup(sceneName: string, id: string): void {
    const cur = this.groupsByScene[sceneName];
    if (!cur) return;
    this.groupsByScene = {
      ...this.groupsByScene,
      [sceneName]: cur.filter((g) => g.id !== id),
    };
    this.scheduleSave();
    this.dispatchEvent(new CustomEvent('changed', {}));
  }
}
