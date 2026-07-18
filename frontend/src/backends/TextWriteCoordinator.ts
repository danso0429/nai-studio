type WriteMode = 'normal' | 'keepalive';

type Settler = {
  resolve: () => void;
  reject: (error: unknown) => void;
};

interface QueuedWrite {
  data: string;
  mode: WriteMode;
  settlers: Settler[];
}

/**
 * 전체 스냅숏 형태의 텍스트 파일 저장을 경로별로 직렬화한다.
 * 진행 중 쓰기 뒤에 밀린 스냅숏은 최신 하나로 병합한다.
 */
export class TextWriteCoordinator {
  readonly #writeNormal: (path: string, data: string) => Promise<void>;
  readonly #writeKeepalive: (path: string, data: string) => Promise<void>;
  readonly #pumps = new Map<string, Promise<void>>();
  readonly #queued = new Map<string, QueuedWrite>();

  constructor(
    writeNormal: (path: string, data: string) => Promise<void>,
    writeKeepalive: (path: string, data: string) => Promise<void>,
  ) {
    this.#writeNormal = writeNormal;
    this.#writeKeepalive = writeKeepalive;
  }

  write(path: string, data: string, mode: WriteMode = 'normal'): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const queued = this.#queued.get(path);
      if (queued) {
        queued.data = data;
        // 종료 내구성이 필요한 호출이 하나라도 합류하면 최신 스냅숏도 keepalive로 보낸다.
        if (mode === 'keepalive') queued.mode = 'keepalive';
        queued.settlers.push({ resolve, reject });
      } else {
        this.#queued.set(path, {
          data,
          mode,
          settlers: [{ resolve, reject }],
        });
      }
      this.#ensurePump(path);
    });
  }

  async flushPath(path: string): Promise<void> {
    while (this.#pumps.has(path)) {
      await this.#pumps.get(path)!.catch(() => {});
    }
  }

  async flushPrefix(prefix: string): Promise<void> {
    const normalized = prefix.endsWith('/') ? prefix : prefix + '/';
    while (true) {
      const pending = [...this.#pumps.entries()]
        .filter(([path]) => path === prefix || path.startsWith(normalized))
        .map(([, pump]) => pump);
      if (pending.length === 0) return;
      await Promise.allSettled(pending);
    }
  }

  async flushAll(): Promise<void> {
    while (this.#pumps.size > 0) {
      await Promise.allSettled([...this.#pumps.values()]);
    }
  }

  #ensurePump(path: string): void {
    if (this.#pumps.has(path)) return;
    const pump = this.#pump(path).finally(() => {
      this.#pumps.delete(path);
      // 종료 직전 microtask에서 새 쓰기가 들어왔으면 다시 가동한다.
      if (this.#queued.has(path)) this.#ensurePump(path);
    });
    this.#pumps.set(path, pump);
  }

  async #pump(path: string): Promise<void> {
    let queued: QueuedWrite | undefined;
    while ((queued = this.#queued.get(path))) {
      this.#queued.delete(path);
      try {
        const writer = queued.mode === 'keepalive'
          ? this.#writeKeepalive
          : this.#writeNormal;
        await writer(path, queued.data);
        for (const settler of queued.settlers) settler.resolve();
      } catch (error) {
        for (const settler of queued.settlers) settler.reject(error);
      }
    }
  }
}
