import { observable, action } from 'mobx';
import { v4 as uuidv4 } from 'uuid';
import { DebouncedJsonStore } from './DebouncedJsonStore';

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

export class ToggleGroupService extends DebouncedJsonStore {
  @observable accessor groupsByScene: {
    [sceneName: string]: ISharedToggleGroup[];
  } = {};

  protected getFileName(): string {
    return TOGGLE_GROUPS_FILE;
  }

  protected saveErrorLabel(): string {
    return 'toggle groups';
  }

  protected buildStore(): IToggleGroupStore {
    return { version: 1, groupsByScene: this.groupsByScene };
  }

  protected applyParsed(json: any): void {
    const raw = (json as IToggleGroupStore)?.groupsByScene;
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
  }

  protected resetState(): void {
    this.groupsByScene = {};
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
