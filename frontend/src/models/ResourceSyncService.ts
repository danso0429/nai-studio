import { backend } from '.';
import { sleep } from './util';
import { reaction } from 'mobx';

export interface Serealizable {
  fromJSON(json: any): any;
  toJSON(): any;
}

// readFile 재시도 간격. 첫 실패 후 500ms, 두 번째 실패 후 1500ms 대기 (총 시도 3회).
const READ_RETRY_DELAYS_MS = [500, 1500];

// 중첩 폴더 최대 깊이(= path 세그먼트 수, 최상위=1). 3단계까지 — 무한 중첩은 무의미.
// 상한 도달 폴더는 UI에서 '하위 폴더 만들기'를 숨김. (SDStudio 4.13 ① 중첩폴더)
export const MAX_FOLDER_DEPTH = 3;

// 4xx는 파일 없음/권한 등 영속 에러라 재시도 무의미. 그 외(timeout, 5xx,
// fetch reject)는 네트워크 일시 장애로 간주하고 재시도.
function isTransientReadError(e: any): boolean {
  const msg = String(e?.message ?? e);
  return !/^API error 4\d\d/.test(msg);
}

type ResourceState = 'loading' | 'ready' | 'busy';

interface ResourceEntry<T> {
  state: ResourceState;
  instance?: T;
  load?: Promise<T>;
  dirty: boolean;
  seq: number;
  dispose?: () => void;
}

export abstract class ResourceSyncService<
  T extends Serealizable,
> extends EventTarget {
  // 이름별 수명주기의 단일 출처. instance/load/dirty/dispose와 경로 변경 상태를
  // 여러 Map에 나눠 두면 조합 불변식을 매 호출마다 추론해야 하므로 한 레코드로 묶는다.
  protected entries: Map<string, ResourceEntry<T>> = new Map();
  resourceList: string[];
  folderList: string[];
  // basename → 소속 폴더(루트면 null). getList()가 갱신.
  folderMap: { [name: string]: string | null };
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
  #lockChains: Map<string, Promise<void>> = new Map();
  constructor(resourceDir: string, interval: number) {
    super();
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
        for (const [name, entry] of this.entries) {
          if (!entry.dirty || entry.state !== 'ready' || !entry.instance) continue;
          if (!this.canWriteResource(name)) continue;
          try {
            void backend.writeFileKeepalive(
              this.getPath(name),
              JSON.stringify(entry.instance.toJSON()),
            ).catch((e) => {
              console.warn('[ResourceSync] keepalive write failed:', name, e);
            });
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
  protected canWriteResource(_name: string): boolean {
    return true;
  }
  abstract migrate(rc: any): any | Promise<any>;

  async add(name: string) {
    if (this.hasResource(name)) {
      throw new Error('Resource already exists');
    }
    // 생성 시작과 동시에 busy placeholder를 잡아, 무거운 기본 프리셋 로드 중 get/add가
    // 같은 이름으로 별도 인스턴스를 만들지 못하게 한다.
    await this.withResourceMutation([name], async () => {
      if (this.resourceList.includes(name) || this.isLoaded(name)) {
        throw new Error('Resource already exists');
      }
      const created = await this.createDefault(name);
      await this.attach(name, created);
      this.markDirty(name);
    });
    await this.update();
  }

  list() {
    return this.resourceList;
  }

  // audit M3 — reaction 콜백 closure가 *등록 시점* name을 캡처한다. rename에서 dispose
  // 핸들만 옮기면 reaction은 여전히 oldName으로 #markUpdated → dirty[oldName](영속 skip)
  // → rename한 세션 동안 그 프로젝트 편집이 디스크에 안 닿고 새로고침 시 손실. 등록을
  // 헬퍼로 분리해 rename에서 새 name으로 재등록한다. (reaction은 생성 시 즉시 fire 안 함)
  #watch(name: string, resource: T): () => void {
    return reaction(
      () => resource.toJSON(),
      () => {
        this.markDirty(name);
      },
      {
        delay: this.updateInterval,
      },
    );
  }

  private async attach(name: string, instance: T) {
    let entry = this.entries.get(name);
    if (!entry) {
      entry = { state: 'ready', dirty: false, seq: 0 };
      this.entries.set(name, entry);
    }
    entry.instance = instance;
    if (entry.state !== 'busy') entry.state = 'ready';
    entry.dispose?.();
    entry.dispose = this.#watch(name, instance);
    await this.getHook(instance, name);
  }

  markDirty(name: string) {
    const entry = this.entries.get(name);
    if (!entry?.instance) return;
    entry.dirty = true;
    entry.seq++;
    this.dispatchEvent(
      new CustomEvent<{ name: string }>('updated', { detail: { name } }),
    );
  }

  getLoaded(name: string): T | undefined {
    return this.entries.get(name)?.instance;
  }

  isLoaded(name: string): boolean {
    return !!this.getLoaded(name);
  }

  hasResource(name: string): boolean {
    return this.entries.has(name) || this.resourceList.includes(name);
  }

  loadedNames(): string[] {
    return [...this.entries.entries()]
      .filter(([, entry]) => !!entry.instance)
      .map(([name]) => name);
  }

  // 장시간 서버 작업도 같은 잠금을 유지할 수 있도록 명시적 release lease를 반환한다.
  // 로딩 완료를 기다린 뒤 busy로 전환하고, 경로별 텍스트 저장 큐까지 소진한다.
  protected async beginResourceMutation(
    names: string[],
    persistCurrent = true,
  ): Promise<() => void> {
    const uniqueNames = Array.from(new Set(names)).sort();
    const previous = uniqueNames
      .map((name) => this.#lockChains.get(name))
      .filter(Boolean) as Promise<void>[];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    for (const name of uniqueNames) this.#lockChains.set(name, gate);

    try {
      await Promise.all(previous);
      for (const name of uniqueNames) {
        const loading = this.entries.get(name)?.load;
        if (loading) await loading.catch(() => {});
      }

      // 서버가 JSON을 직접 읽거나 경로를 바꾸기 전에, reaction debounce가 아직 dirty를
      // 세우지 못한 최신 in-memory 스냅숏까지 현재 경로에 먼저 굳힌다. import-scenes가
      // 오래된 디스크 JSON을 기반으로 적용해 직전 편집을 잃는 창을 이 지점에서 닫는다.
      if (persistCurrent) {
        await this.persistStableResourceSnapshots(uniqueNames);
      }
    } catch (error) {
      release();
      for (const name of uniqueNames) {
        if (this.#lockChains.get(name) === gate) this.#lockChains.delete(name);
      }
      throw error;
    }

    const placeholders = new Set<string>();
    try {
      for (const name of uniqueNames) {
        let entry = this.entries.get(name);
        if (!entry) {
          entry = { state: 'busy', dirty: false, seq: 0 };
          this.entries.set(name, entry);
          placeholders.add(name);
        } else {
          entry.state = 'busy';
        }
      }
      await Promise.all(uniqueNames.map((name) => backend.flushFileWrites(this.getPath(name))));
    } catch (error) {
      for (const name of uniqueNames) {
        const entry = this.entries.get(name);
        if (!entry) continue;
        if (!entry.instance && placeholders.has(name)) this.entries.delete(name);
        else entry.state = 'ready';
      }
      release();
      for (const name of uniqueNames) {
        if (this.#lockChains.get(name) === gate) this.#lockChains.delete(name);
      }
      throw error;
    }

    let released = false;
    return () => {
      if (released) return;
      released = true;
      for (const name of uniqueNames) {
        const entry = this.entries.get(name);
        if (!entry) continue;
        if (!entry.instance && placeholders.has(name)) this.entries.delete(name);
        else entry.state = 'ready';
      }
      release();
      for (const name of uniqueNames) {
        if (this.#lockChains.get(name) === gate) this.#lockChains.delete(name);
      }
    };
  }

  protected async withResourceMutation<R>(names: string[], fn: () => Promise<R>): Promise<R> {
    const release = await this.beginResourceMutation(names);
    try {
      return await fn();
    } finally {
      release();
    }
  }

  protected detachResource(name: string) {
    this.entries.get(name)?.dispose?.();
    this.entries.delete(name);
  }

  // I/O await 중 사용자가 다시 편집할 수 있다. 쓰기 전후 직렬화가 같아질 때까지 반복해
  // 서버 직접 mutation이 반드시 마지막 안정 스냅숏을 입력으로 보게 한다. 마지막 비교와
  // busy 전환 사이에는 await가 없어 UI 이벤트가 끼어들 수 없다.
  private async persistStableResourceSnapshots(names: string[]): Promise<void> {
    while (true) {
      const snapshots = new Map<string, {
        entry: ResourceEntry<T>;
        instance: T;
        payload: string;
      }>();
      for (const name of names) {
        const entry = this.entries.get(name);
        const instance = entry?.instance;
        if (!entry || !instance || entry.state !== 'ready') continue;
        try {
          snapshots.set(name, {
            entry,
            instance,
            payload: JSON.stringify(instance.toJSON()),
          });
        } catch (error) {
          console.error('[ResourceSync] serialize failed:', name, error);
          throw error;
        }
      }
      await Promise.all([...snapshots.entries()].map(([name, snapshot]) =>
        backend.writeFile(this.getPath(name), snapshot.payload)));

      let changed = false;
      for (const [name, snapshot] of snapshots) {
        const current = this.entries.get(name);
        if (current !== snapshot.entry || current.instance !== snapshot.instance || current.state !== 'ready') {
          throw new Error(`Resource changed while persisting: ${name}`);
        }
        let after: string;
        try {
          after = JSON.stringify(snapshot.instance.toJSON());
        } catch (error) {
          console.error('[ResourceSync] serialize failed:', name, error);
          throw error;
        }
        if (snapshot.payload !== after) changed = true;
      }
      if (changed) continue;
      for (const snapshot of snapshots.values()) snapshot.entry.dirty = false;
      return;
    }
  }

  protected async refreshAfterCommittedMutation(context: string): Promise<void> {
    await this.update().catch((error) => {
      // 디스크 mutation은 이미 성공했다. refresh 실패를 호출자에게 다시 던지면 같은
      // rename/delete/import를 재시도하게 되므로 캐시 상태는 다음 주기 update에 맡긴다.
      console.warn(`[ResourceSync] ${context} refresh deferred:`, error);
    });
  }

  // 외부 도구가 디스크의 resource를 직접 바꾼 뒤 다음 get()에서 새로 읽게 하는 공식 경로.
  // resources만 delete하면 reaction이 옛 객체를 영구 참조하고, 새 load가 disposer slot을
  // 덮어 old disposer handle까지 잃는다. 진행 중 load도 끝까지 기다린 뒤 함께 정리한다.
  async invalidate(name: string): Promise<void> {
    await this.withResourceMutation([name], async () => {
      this.detachResource(name);
    });
  }

  // 서버가 프로젝트 JSON을 직접 바꾸는 import/restore 경로용 공식 진입점.
  async mutateExternally<R>(names: string[], fn: () => Promise<R>): Promise<R> {
    return await this.withResourceMutation(names, async () => {
      let result: R;
      try {
        result = await fn();
      } catch (error) {
        // 응답 유실은 서버 미실행과 서버 커밋 후 연결 단절을 구분할 수 없다. 옛 인스턴스를
        // 살려 두면 후자의 경우 다음 autosave가 서버 변경을 되돌리므로 항상 캐시를 폐기한다.
        for (const name of names) this.detachResource(name);
        await this.refreshAfterCommittedMutation('uncertain external mutation');
        throw error;
      }
      for (const name of names) this.detachResource(name);
      // 서버 변경은 이미 커밋됐다. 후속 목록 갱신 실패를 작업 자체 실패로 보고하면 사용자가
      // 재시도해 import/restore를 중복 적용할 수 있으므로, 캐시는 비운 채 주기 update에 맡긴다.
      await this.update().catch((e) => {
        console.warn('[ResourceSync] external mutation refresh deferred:', e);
      });
      return result;
    });
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
    if (!this.isLoaded(name)) return;
    const srcPath = this.getPath(name);
    const deletedPath = srcPath.replace(/\.json$/, '.deleted');
    await this.withResourceMutation([name], async () => {
      // 파일 이동이 실패하면 메모리·reaction·dirty를 그대로 보존한다.
      await backend.renameFile(srcPath, deletedPath);
      this.detachResource(name);
      await this.refreshAfterCommittedMutation('delete');
    });
  }

  async rename(oldName: string, newName: string) {
    const entry = this.entries.get(oldName);
    if (!entry?.instance) throw new Error('Resource not found');
    if (this.hasResource(newName)) throw new Error('Resource already exists');
    // srcPath는 folderMap 갱신 *전*에 캡처 — getPath가 oldName의 폴더값을 봐서
    // 폴더 안 path를 만들어야 backend.renameFile src가 올바름.
    const srcPath = this.getPath(oldName);
    const oldFolder = this.folderMap[oldName] ?? null;
    const destPath = oldFolder
      ? this.resourceDir + '/' + oldFolder + '/' + newName + '.json'
      : this.resourceDir + '/' + newName + '.json';
    await this.withResourceMutation([oldName, newName], async () => {
      if (this.entries.get(oldName) !== entry || !entry.instance) {
        throw new Error('Resource changed while waiting for rename');
      }
      if (this.resourceList.includes(newName)) {
        throw new Error('Resource already exists');
      }
      // 파일 이동이 성공한 뒤에만 메모리 이름과 메타를 바꾼다.
      await backend.renameFile(srcPath, destPath);
      this.entries.delete(oldName);
      this.entries.set(newName, entry);
      await this.getHook(entry.instance, newName);
      entry.dispose?.();
      entry.dispose = this.#watch(newName, entry.instance!);
      this.folderMap[newName] = oldFolder;
      delete this.folderMap[oldName];
      await this.refreshAfterCommittedMutation('rename');
    });
  }

  getFast(name: string) {
    const rc = this.getLoaded(name);
    if (!rc) {
      void this.get(name);
    }
    return rc;
  }

  async get(
    name: string,
    opts?: { throwOnError?: boolean },
  ): Promise<T | undefined> {
    const existing = this.entries.get(name);
    if (existing?.instance) return existing.instance;
    // 경로 변경/삭제 중인 미로드 이름은 작업이 끝날 때까지 새 load를 만들지 않는다.
    if (existing?.state === 'busy') return undefined;
    // 동시 로드 디듀프: 같은 name 로드가 진행 중이면 그 프로미스를 공유해 인스턴스 하나만
    // 만든다. throwOnError는 공유 프로미스가 아니라 각 호출자가 자기 opts로 적용.
    let p = existing?.load;
    if (!p) {
      // read는 idempotent이고 transient 오류만 재시도한다. 첫 호출자의 옵션에 retry를
      // 맡기면 뒤에 합류한 사용자 선택 get이 호출 순서에 따라 재시도를 잃으므로 항상 적용.
      p = this.#doLoad(name);
      this.entries.set(name, {
        state: 'loading',
        load: p,
        dirty: false,
        seq: 0,
      });
    }
    try {
      return await p;
    } catch (e: any) {
      console.error('get library error:', e);
      if (opts?.throwOnError) throw e;
      return undefined;
    } finally {
      const current = this.entries.get(name);
      if (current?.load === p) {
        current.load = undefined;
        if (!current.instance && current.state === 'loading') this.entries.delete(name);
      }
    }
  }

  // 실제 로드(디스크 읽기→마이그레이트→인스턴스 등록). 에러는 삼키지 않고 throw —
  // throwOnError 분기는 get() 호출자별로 처리한다.
  async #doLoad(name: string): Promise<T> {
    const str = await this.readFileWithRetry(name);
    let obj = JSON.parse(str);
    obj = await this.migrate(obj);
    obj = await this.fillEmptyPresetVars(obj);
    // TOCTOU: await 사이에 다른 경로(add/rename 등)가 이미 등록했으면 그것을 사용해
    // 중복 인스턴스를 막는다.
    const current = this.entries.get(name);
    if (current?.instance) return current.instance;
    if (current?.state === 'busy') throw new Error('Resource is busy');
    const instance = this.dummy.fromJSON(obj);
    await this.attach(name, instance);
    this.dispatchEvent(
      new CustomEvent<{ name: string }>('fetched', { detail: { name } }),
    );
    return instance;
  }

  private async readFileWithRetry(name: string): Promise<string> {
    const path = this.getPath(name);
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
    await this.flushDirty();
    this.resourceList = await this.getList();
    this.saveCache();
    this.dispatchEvent(new CustomEvent('listupdated', {}));
  }

  async saveAll() {
    const names = [...this.entries.entries()]
      .filter(([, entry]) => entry.state === 'ready' && !!entry.instance)
      .map(([name]) => name);
    // 명시적 전체 flush(백업 복원 전)는 하나라도 실패하면 호출자가 복원을 중단해야 한다.
    // 주기 저장의 best-effort/allSettled 정책은 flushDirty()에만 둔다.
    await Promise.all(names.map((name) => this.writeResource(name)));
  }

  // 파일 수명주기 전환처럼 "이 resource의 새 참조가 디스크에 도달했다"는 ACK가
  // 필요한 호출자를 위한 단일-resource flush. 성공 전에 원본 파일을 지우지 않게 한다.
  async flushResource(name: string): Promise<void> {
    const entry = this.entries.get(name);
    if (!entry?.instance) throw new Error(`Resource is not loaded: ${name}`);
    const sequence = entry.seq;
    const result = await this.writeResource(name);
    if (result !== 'done') throw new Error(`Resource is busy: ${name}`);
    const current = this.entries.get(name);
    if (current === entry && current.seq === sequence) current.dirty = false;
  }

  async createFrom(name: string, value: any) {
    if (this.hasResource(name)) {
      throw new Error('Resource already exists');
    }
    await this.withResourceMutation([name], async () => {
      if (this.resourceList.includes(name) || this.isLoaded(name)) {
        throw new Error('Resource already exists');
      }
      value = await this.migrate(value);
      await this.attach(name, this.dummy.fromJSON(value));
      this.markDirty(name);
    });
    await this.update();
  }

  async run() {
    while (this.running) {
      // update()는 dirty 쓰기(안전, allSettled) 후 getList()(네트워크)에서 throw할 수 있는데,
      // 여기서 잡지 않으면 루프가 죽어 *주기 저장이 영구 정지*(다음 편집이 디스크에 안 닿음,
      // visibility flush만 남음). 잡아서 다음 주기에 재시도한다(SDStudio 4.13.5 8ea25a4 결).
      try {
        await this.update();
      } catch (e) {
        console.warn('[ResourceSync] update 실패(루프 유지, 다음 주기 재시도):', e);
      }
      await sleep(this.updateInterval);
    }
  }

  private async writeResource(name: string): Promise<'done' | 'retry'> {
    const entry = this.entries.get(name);
    const instance = entry?.instance;
    if (!entry || !instance) return 'done';
    if (entry.state !== 'ready') return 'retry';
    if (!this.canWriteResource(name)) return 'retry';
    let payload: string;
    try {
      payload = JSON.stringify(instance.toJSON());
    } catch (e) {
      console.error('[ResourceSync] serialize failed:', name, e);
      throw e;
    }
    // 직렬화 뒤 경로 작업이 시작됐을 수 있으므로 큐 등록 직전에 다시 확인한다.
    const current = this.entries.get(name);
    if (current !== entry || current.instance !== instance) return 'done';
    if (current.state !== 'ready') return 'retry';
    await backend.writeFile(this.getPath(name), payload);
    return 'done';
  }

  private async flushDirty(): Promise<void> {
    const targets = [...this.entries.entries()]
      .filter(([, entry]) => entry.dirty && entry.state === 'ready' && !!entry.instance)
      .map(([name, entry]) => ({ name, seq: entry.seq }));
    const results = await Promise.allSettled(
      targets.map(({ name }) => this.writeResource(name)),
    );
    targets.forEach((target, index) => {
      const result = results[index];
      if (result.status === 'rejected') {
        console.warn('[ResourceSync] write failed, retain dirty:', target.name, result.reason);
        return;
      }
      if (result.value === 'retry') return;
      const entry = this.entries.get(target.name);
      if (entry && entry.seq === target.seq) entry.dirty = false;
    });
  }

  private async getList() {
    // 다depth(중첩) recursive: 깊이 MAX_FOLDER_DEPTH 까지 하위 폴더 파일 포함.
    // 정책: resource name은 basename(파일명, 슬래시 없음). 폴더는 folderMap에 *path*로
    // 매핑(중첩: 'f1/f2'). 동명 충돌 시 첫 발견 우선 (이름은 전역 unique).
    const result = await backend.listFilesRecursive(this.resourceDir, MAX_FOLDER_DEPTH);
    this.folderList = result.dirs.slice();
    const newMap: { [name: string]: string | null } = {};
    const names: string[] = [];
    for (const f of result.files) {
      if (!f.endsWith('.json')) continue;
      const lastSlash = f.lastIndexOf('/'); // 마지막 슬래시 = 폴더 path와 파일명 경계
      let name: string;
      let folder: string | null;
      if (lastSlash >= 0) {
        folder = f.substring(0, lastSlash); // 폴더 path (중첩: f1/f2)
        name = f.substring(lastSlash + 1, f.length - 5);
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
