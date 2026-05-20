import { backend } from '.';
import { sleep } from './util';
import { reaction } from 'mobx';

export interface Serealizable {
  fromJSON(json: any): any;
  toJSON(): any;
}

// readFile 재시도 간격. 첫 실패 후 500ms, 두 번째 실패 후 1500ms 대기 (총 시도 3회).
const READ_RETRY_DELAYS_MS = [500, 1500];

// 4xx는 파일 없음/권한 등 영속 에러라 재시도 무의미. 그 외(timeout, 5xx,
// fetch reject)는 네트워크 일시 장애로 간주하고 재시도.
function isTransientReadError(e: any): boolean {
  const msg = String(e?.message ?? e);
  return !/^API error 4\d\d/.test(msg);
}

export abstract class ResourceSyncService<
  T extends Serealizable,
> extends EventTarget {
  resources: { [name: string]: T };
  dirty: { [name: string]: boolean };
  resourceList: string[];
  folderList: string[];
  // basename → 소속 폴더(루트면 null). getList()가 갱신.
  folderMap: { [name: string]: string | null };
  disposes: { [name: string]: () => void };
  resourceDir: string;
  updateInterval: number;
  running: boolean;
  // dummy는 sync 초기화 — 본인 페인 (P12 #8, 인터넷 느린 환경): 옛 흐름은
  // createDefault('dummy')로 dummy 만들었는데 SessionService의 createDefault는
  // importDefaultPresets (globalPresetService.load + 1~1.4MB defaultassets 3개
  // fetch) 호출 → 인터넷 느린 환경에서 fetch 실패 시 dummyReady Promise 영구
  // reject → 후속 모든 get()의 await this.dummyReady에서 throw → **모든 프로젝트
  // load 실패 cascade.** 본질: dummy는 prototype access (this.dummy.fromJSON)용
  // 빈 인스턴스만 필요. 무거운 default presets 임포트 불필요. 별도 createDummy()
  // sync 메소드로 분리, race fix(dummyReady)도 자연 해소.
  dummy: T;
  constructor(resourceDir: string, interval: number) {
    super();
    this.resources = {};
    this.dirty = {};
    this.disposes = {};
    this.resourceDir = resourceDir;
    this.resourceList = [];
    this.folderList = [];
    this.folderMap = {};
    this.updateInterval = interval;
    this.running = true;
    // 인터넷 느릴 때 첫 update() 응답 전에 마지막 리스트 즉시 표시.
    // 백그라운드 update() 도착 시 saveCache로 갱신 + listupdated dispatch.
    this.loadCache();
    this.dummy = this.createDummy();
    // tab close 임박 (visibilitychange→hidden, pagehide) 직전 dirty 자원을 keepalive fetch로
    // 즉시 굳힘. run() loop의 5초 polling + reaction debounce 사이에 사용자가 탭 닫으면
    // 마지막 편집이 디스크 도달 못 하는 race window 해소. 본인 페인 2026-05-16: 편집 직후
    // sdstudio 닫으면 원래 프로젝트 default로 회귀 (이미지엔 in-memory state 박혀있음).
    if (typeof document !== 'undefined') {
      // Models M: flushOnHide는 dirty 자원만 flush. 옛 코드는 모든 resources를 fetch keepalive로
      // 보내서 30+ session × 50-500KB가 visibility flip마다 굳어짐 → bandwidth/CPU drain.
      // 또 writeFileKeepalive는 64KB 누적 cap이라 의미 있는 항목만 흘려야 cap 안 새어 나감.
      const flushOnHide = () => {
        if (document.visibilityState !== 'hidden') return;
        for (const name of Object.keys(this.dirty)) {
          if (!(name in this.resources)) continue;
          const rc = this.resources[name];
          if (!rc) continue;
          try {
            backend.writeFileKeepalive(
              this.getPath(name),
              JSON.stringify(rc.toJSON()),
            );
          } catch {
            // 개별 자원 toJSON 실패 — 무시 (다른 자원은 계속 flush)
          }
        }
      };
      document.addEventListener('visibilitychange', flushOnHide);
      window.addEventListener('pagehide', flushOnHide);
    }
  }

  // dummy 인스턴스 — prototype access만 필요. 빈 인스턴스 반환.
  abstract createDummy(): T;
  // 사용자 명시 새 리소스 생성 (add()) 용 — 기본값/프리셋 포함. 무거운 I/O 허용.
  abstract createDefault(name: string): T | Promise<T>;
  abstract getHook(rc: T, name: string): Promise<void>;
  abstract migrate(rc: any): any | Promise<any>;

  async add(name: string) {
    if (name in this.resources) {
      throw new Error('Resource already exists');
    }
    this.resources[name] = await this.createDefault(name);
    await this.onAdded(name);
    this.#markUpdated(name);
    await this.update();
  }

  list() {
    return this.resourceList;
  }

  async onAdded(name: string) {
    const resource = this.resources[name];
    const dispose = reaction(
      () => resource.toJSON(),
      (_) => {
        this.#markUpdated(name);
      },
      {
        delay: this.updateInterval,
      },
    );
    this.disposes[name] = dispose;
    await this.getHook(this.resources[name], name);
  }

  getPath(name: string) {
    const folder = this.folderMap[name];
    return folder
      ? this.resourceDir + '/' + folder + '/' + name + '.json'
      : this.resourceDir + '/' + name + '.json';
  }

  getFolderOf(name: string): string | null {
    return this.folderMap[name] ?? null;
  }

  getDeletedPath(name: string) {
    // .deleted suffix는 .json과 같은 디렉토리(폴더 안이면 그 안)에 둠.
    return this.getPath(name).replace(/\.json$/, '.deleted');
  }

  async delete(name: string) {
    if (name in this.resources) {
      delete this.resources[name];
      this.disposes[name]();
      await backend.renameFile(this.getPath(name), this.getDeletedPath(name));
      await this.update();
    }
  }

  async rename(oldName: string, newName: string) {
    if (!(oldName in this.resources)) throw new Error('Resource not found');
    if (newName in this.resources) throw new Error('Resource already exists');
    this.resources[newName] = this.resources[oldName];
    delete this.resources[oldName];
    this.disposes[newName] = this.disposes[oldName];
    delete this.disposes[oldName];
    if (oldName in this.dirty) {
      this.dirty[newName] = this.dirty[oldName];
      delete this.dirty[oldName];
    }
    await backend.renameFile(this.getPath(oldName), this.getPath(newName));
    await this.update();
  }

  getFast(name: string) {
    const rc = this.resources[name];
    if (!rc) {
      this.get(name);
    }
    return rc;
  }

  async get(
    name: string,
    opts?: { throwOnError?: boolean; retry?: boolean },
  ): Promise<T | undefined> {
    if (!(name in this.resources)) {
      try {
        const str = await this.readFileWithRetry(name, opts?.retry === true);
        let obj = JSON.parse(str);
        obj = await this.migrate(obj);
        obj = await this.fillEmptyPresetVars(obj);
        this.resources[name] = this.dummy.fromJSON(obj);
        await this.onAdded(name);
        this.dispatchEvent(
          new CustomEvent<{ name: string }>('fetched', { detail: { name } }),
        );
      } catch (e: any) {
        console.error('get library error:', e);
        if (opts?.throwOnError) throw e;
        return undefined;
      }
    }
    return this.resources[name];
  }

  private async readFileWithRetry(
    name: string,
    retry: boolean,
  ): Promise<string> {
    const path = this.getPath(name);
    if (!retry) return backend.readFile(path);
    let lastErr: any;
    for (let attempt = 0; attempt <= READ_RETRY_DELAYS_MS.length; attempt++) {
      if (attempt > 0) await sleep(READ_RETRY_DELAYS_MS[attempt - 1]);
      try {
        return await backend.readFile(path);
      } catch (e: any) {
        lastErr = e;
        if (!isTransientReadError(e)) throw e;
      }
    }
    throw lastErr;
  }

  async update() {
    // Models M: dirty entry는 write 성공한 것만 clear. 옛 코드는 마지막에 `this.dirty = {}`로
    // 전체 wipe — write 실패한 entry도 같이 잃어버려 다음 update까지 누락. edge-case data loss.
    const names = Object.keys(this.dirty);
    for (const name of names) {
      if (!(name in this.resources)) {
        delete this.dirty[name];
        continue;
      }
      const l = this.getFast(name);
      if (l) {
        try {
          await backend.writeFile(this.getPath(name), JSON.stringify(l.toJSON()));
          delete this.dirty[name];
        } catch (e) {
          // dirty 유지 — 다음 update에서 재시도. log만.
          console.warn('[ResourceSync] write failed, retain dirty:', name, e);
        }
      } else {
        delete this.dirty[name];
      }
    }
    this.resourceList = await this.getList();
    this.saveCache();
    this.dispatchEvent(new CustomEvent('listupdated', {}));
  }

  async saveAll() {
    for (const name of Object.keys(this.resources)) {
      const l = this.resources[name];
      await backend.writeFile(this.getPath(name), JSON.stringify(l.toJSON()));
    }
  }

  async createFrom(name: string, value: any) {
    if (name in this.resources) {
      throw new Error('Resource already exists');
    }
    value = await this.migrate(value);
    this.resources[name] = this.dummy.fromJSON(value);
    await this.onAdded(name);
    this.#markUpdated(name);
    await this.update();
  }

  async run() {
    while (this.running) {
      await this.update();
      await sleep(this.updateInterval);
    }
  }

  #markUpdated(name: string) {
    this.dirty[name] = true;
    this.dispatchEvent(
      new CustomEvent<{ name: string }>('updated', { detail: { name } }),
    );
  }

  private async getList() {
    // depth=1 recursive: includes files in 1-level subfolders.
    // 정책: resource name은 basename(슬래시 없음). 폴더는 folderMap에 별도 매핑.
    // 동명 충돌 시 첫 발견 우선 (안전 — 폴더 안/밖에 같은 이름 막기).
    const result = await backend.listFilesRecursive(this.resourceDir, 1);
    this.folderList = result.dirs.slice();
    const newMap: { [name: string]: string | null } = {};
    const names: string[] = [];
    for (const f of result.files) {
      if (!f.endsWith('.json')) continue;
      const slashIdx = f.indexOf('/');
      let name: string;
      let folder: string | null;
      if (slashIdx >= 0) {
        folder = f.substring(0, slashIdx);
        name = f.substring(slashIdx + 1, f.length - 5);
      } else {
        folder = null;
        name = f.substring(0, f.length - 5);
      }
      if (name in newMap) continue; // 동명 충돌 — 첫 발견 유지
      newMap[name] = folder;
      names.push(name);
    }
    this.folderMap = newMap;
    return names;
  }

  listFolders(): string[] {
    return this.folderList.slice();
  }

  private cacheKey(): string {
    return 'rss-cache:' + this.resourceDir;
  }

  private loadCache(): void {
    try {
      if (typeof localStorage === 'undefined') return;
      const raw = localStorage.getItem(this.cacheKey());
      if (!raw) return;
      const data = JSON.parse(raw);
      if (Array.isArray(data.resourceList)) this.resourceList = data.resourceList;
      if (Array.isArray(data.folderList)) this.folderList = data.folderList;
      if (data.folderMap && typeof data.folderMap === 'object') {
        this.folderMap = data.folderMap;
      }
    } catch (e) {
      // 캐시 파싱 실패 — 무시 (다음 update에서 정상 갱신)
    }
  }

  private saveCache(): void {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(
        this.cacheKey(),
        JSON.stringify({
          resourceList: this.resourceList,
          folderList: this.folderList,
          folderMap: this.folderMap,
        }),
      );
    } catch (e) {
      // localStorage quota / disabled — 무시
    }
  }

  private async fillEmptyPresetVars(obj: any) {
    let updated = false;

    Object.entries(obj.presets).forEach(([key, value]: [string, any]) => {
      value = value as object[]
      switch (key) {
        case 'SDImageGen':
          for (const preset of value) {
            fillEmptyVar(preset, 'characterPrompts', []);
            fillEmptyVar(preset, 'useCoords', false);
            fillEmptyVar(preset, 'legacyPromptConditioning', false);
            fillEmptyVar(preset, 'varietyPlus', false);
            fillEmptyVar(preset, 'deliberateEulerAncestralBug', false);
          } break;
        case 'SDImageGenEasy':
          for (const preset of value) {
            fillEmptyVar(preset, 'useCoords', false);
            fillEmptyVar(preset, 'legacyPromptConditioning', false);
            fillEmptyVar(preset, 'varietyPlus', false);
            fillEmptyVar(preset, 'deliberateEulerAncestralBug', false);
          } break;
        case 'SDInpaint':
          for (const preset of value) {
            fillEmptyVar(preset, 'characterPrompts', []);
            fillEmptyVar(preset, 'useCoords', false);
            fillEmptyVar(preset, 'legacyPromptConditioning', false);
            fillEmptyVar(preset, 'varietyPlus', false);
            fillEmptyVar(preset, 'deliberateEulerAncestralBug', false);
          } break;
        case 'SDI2I':
          for (const preset of value) {
            fillEmptyVar(preset, 'characterPrompts', []);
            fillEmptyVar(preset, 'useCoords', false);
            fillEmptyVar(preset, 'legacyPromptConditioning', false);
            fillEmptyVar(preset, 'varietyPlus', false);
            fillEmptyVar(preset, 'deliberateEulerAncestralBug', false);
            fillEmptyVar(preset, 'characterReferences', []);
          } break;
      }
    });
    Object.entries(obj.presetShareds).forEach(([key, value]: [string, any]) => {
      switch (key) {
        case 'SDImageGen':
          fillEmptyVar(value, 'normalizeStrength', true);
          fillEmptyVar(value, 'characterReferences', []);
          break;
        case 'SDImageGenEasy':
          fillEmptyVar(value, 'characterPrompts', []);
          fillEmptyVar(value, 'normalizeStrength', true);
          fillEmptyVar(value, 'characterReferences', []);
          break;
        case 'SDInpaint':
      }
    });

    if (updated)
      await this.update();

    return obj;

    function fillEmptyVar(obj: any, varName: string, defaultValue: any) {
      if (!(varName in obj)) {
        obj[varName] = defaultValue;
        updated = true;
      }
    }
  }
}
