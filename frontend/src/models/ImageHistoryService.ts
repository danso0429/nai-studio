import { action, observable } from 'mobx';
import { getAppState } from './appStateRef';
import type { GenerationHistoryEntry } from './imageHistoryTypes';

export type { GenerationHistoryEntry } from './imageHistoryTypes';

interface HistoryScene {
  name: string;
  type: 'scene' | 'inpaint';
  mains: string[];
}

interface HistorySession<TScene extends HistoryScene> {
  name: string;
  scenes: { get(name: string): TScene | undefined };
  inpaints: { get(name: string): TScene | undefined };
}

interface HistoryQueueJobMeta {
  sceneKey?: string;
  sceneName?: string;
}

interface HistoryQueueCompletedEntry {
  jobId: string | null;
  outputFilePath?: string;
  meta?: HistoryQueueJobMeta;
  completedAt: number;
  durationMs: number;
}

interface HistoryBackend {
  onQueueJobComplete(callback: (entry: Omit<HistoryQueueCompletedEntry, 'completedAt' | 'durationMs'>) => void): void | (() => void);
  onWsReconnect(callback: () => void): void;
  getImageHistory(limit: number): Promise<{ entries: HistoryQueueCompletedEntry[] }>;
}

interface HistoryImageStore<TSession extends HistorySession<TScene>, TScene extends HistoryScene> {
  addEventListener(type: string, listener: EventListener): void;
  images: Record<string, Record<string, string[]>>;
  inpaints: Record<string, Record<string, string[]>>;
  refreshBatch(session: TSession): void;
}

interface HistorySessionStore<TSession extends HistorySession<TScene>, TScene extends HistoryScene> {
  addEventListener(type: string, listener: EventListener): void;
  get(name: string): Promise<TSession | undefined>;
  markDirty(name: string): void;
  dispatchEvent(event: Event): boolean;
}

export const HISTORY_LIMIT = 30;

// Remote에서는 브라우저 메모리 이벤트만 정본으로 삼지 않는다. 서버가 시간 제한 없이
// 최근 30장을 영속하는 전용 ledger를 최초 로드·WS 재연결 때 병합해 PWA 콜드 리로드와
// 다른 탭에서 끝난 생성도 히스토리에 나타나게 한다.
export class ImageHistoryService<
  TScene extends HistoryScene,
  TSession extends HistorySession<TScene>,
> {
  @observable accessor entries: GenerationHistoryEntry[] = [];

  constructor(
    private readonly backend: HistoryBackend,
    private readonly imageService: HistoryImageStore<TSession, TScene>,
    private readonly sessionService: HistorySessionStore<TSession, TScene>,
  ) {
    this.backend.onQueueJobComplete((d) => {
      const entry = this.fromQueueEntry({
        jobId: d.jobId,
        outputFilePath: d.outputFilePath,
        meta: d.meta,
        completedAt: Date.now(),
        durationMs: 0,
      });
      if (entry) this.push(entry);
    });
    this.backend.onWsReconnect(() => { void this.refresh(); });
    this.imageService.addEventListener('image-added', ((e: Event) => {
      const d = (e as CustomEvent).detail;
      if (!d) return;
      this.push({
        id: d.path,
        sessionName: d.session.name,
        sceneType: d.sceneType,
        sceneName: d.sceneName,
        filename: d.filename,
        path: d.path,
        createdAt: Date.now(),
      });
    }) as EventListener);
    this.imageService.addEventListener('updated', ((e: Event) => {
      const d = (e as CustomEvent).detail;
      if (d?.session) this.prune(d.session, d.scene);
    }) as EventListener);
    this.sessionService.addEventListener('renamed', ((e: Event) => {
      const { oldName, newName } = (e as CustomEvent).detail ?? {};
      if (oldName && newName) this.renameSession(oldName, newName);
    }) as EventListener);
    void this.refresh();
  }

  @action
  async refresh(): Promise<void> {
    try {
      const result = await this.backend.getImageHistory(HISTORY_LIMIT);
      const remote = result.entries
        .map((entry) => this.fromQueueEntry(entry))
        .filter((entry): entry is GenerationHistoryEntry => !!entry);
      const merged = new Map<string, GenerationHistoryEntry>();
      for (const entry of [...remote, ...this.entries]) {
        const old = merged.get(entry.id);
        if (!old || entry.createdAt > old.createdAt) merged.set(entry.id, entry);
      }
      this.entries = [...merged.values()]
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, HISTORY_LIMIT);
    } catch (e) {
      console.warn('[ImageHistory] completed history load failed:', e);
    }
  }

  private fromQueueEntry(entry: HistoryQueueCompletedEntry): GenerationHistoryEntry | null {
    const outputPath = entry.outputFilePath;
    if (!outputPath) return null;
    const parts = outputPath.replace(/\\/g, '/').split('/').filter(Boolean);
    if (parts.length < 4) return null;
    const sceneType = parts[0] === 'outs'
      ? 'scene'
      : parts[0] === 'inpaints'
        ? 'inpaint'
        : null;
    if (!sceneType) return null;
    const meta = entry.meta ?? {};
    const sceneKeyParts = meta.sceneKey?.split('/') ?? [];
    const sessionName = sceneKeyParts[0] || parts[1];
    const sceneName = meta.sceneName || sceneKeyParts.slice(2).join('/') || parts[2];
    const filename = parts[parts.length - 1];
    if (!sessionName || !sceneName || !filename) return null;
    return {
      id: outputPath,
      sessionName,
      sceneType,
      sceneName,
      filename,
      path: outputPath,
      createdAt: entry.completedAt || Date.now(),
    };
  }

  @action
  push(entry: GenerationHistoryEntry) {
    this.entries = [
      entry,
      ...this.entries.filter((item) => item.id !== entry.id),
    ].slice(0, HISTORY_LIMIT);
  }

  @action
  remove(id: string) {
    this.entries = this.entries.filter((entry) => entry.id !== id);
  }

  @action
  private renameSession(oldName: string, newName: string) {
    this.entries = this.entries.map((entry) => {
      if (entry.sessionName !== oldName) return entry;
      const parts = entry.path.replace(/\\/g, '/').split('/');
      if (parts[1] === oldName) parts[1] = newName;
      const path = parts.join('/');
      return { ...entry, id: path, path, sessionName: newName };
    });
  }

  @action
  private prune(session: TSession, scene?: TScene) {
    this.entries = this.entries.filter((entry) => {
      if (entry.sessionName !== session.name) return true;
      if (scene && (entry.sceneName !== scene.name || entry.sceneType !== scene.type)) {
        return true;
      }
      const map = entry.sceneType === 'scene' ? this.imageService.images : this.imageService.inpaints;
      const files = map[entry.sessionName]?.[entry.sceneName];
      return !files || files.includes(entry.filename);
    });
  }

  async resolveQuiet(
    entry: GenerationHistoryEntry,
  ): Promise<{ session: TSession; scene: TScene } | null> {
    const session = await this.sessionService.get(entry.sessionName);
    const scene = entry.sceneType === 'scene'
      ? session?.scenes.get(entry.sceneName)
      : session?.inpaints.get(entry.sceneName);
    return session && scene ? { session, scene } : null;
  }

  async resolve(
    entry: GenerationHistoryEntry,
  ): Promise<{ session: TSession; scene: TScene } | null> {
    const resolved = await this.resolveQuiet(entry);
    if (resolved) return resolved;
    const appState = getAppState();
    appState.pushMessage('원본 씬을 찾을 수 없어 히스토리에서 제거했습니다');
    this.remove(entry.id);
    return null;
  }

  async toggleFavorite(entry: GenerationHistoryEntry): Promise<void> {
    const resolved = await this.resolve(entry);
    if (!resolved) return;
    const { scene, session } = resolved;
    const index = scene.mains.indexOf(entry.filename);
    if (index >= 0) scene.mains.splice(index, 1);
    else scene.mains.push(entry.filename);
    this.sessionService.markDirty(session.name);
  }

  async navigateTo(
    entry: GenerationHistoryEntry,
    opts: { openGrid: boolean },
  ): Promise<void> {
    const resolved = await this.resolve(entry);
    if (!resolved) return;
    const { session } = resolved;
    const appState = getAppState();
    if (appState.curSession?.name !== session.name) {
      this.imageService.refreshBatch(session);
      appState.curSession = session;
    }
    const cell = await this.waitForSceneCell(entry.sceneType, entry.sceneName);
    if (!cell) return;
    if (opts.openGrid) {
      this.sessionService.dispatchEvent(new CustomEvent('open-result-viewer', {
        detail: {
          sceneType: entry.sceneType,
          sceneName: entry.sceneName,
          filename: entry.filename,
        },
      }));
      return;
    }
    this.sessionService.dispatchEvent(new CustomEvent('close-result-viewer'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    cell.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  private waitForSceneCell(
    type: 'scene' | 'inpaint',
    name: string,
    timeoutMs = 2500,
  ): Promise<HTMLElement | null> {
    const action = type === 'scene' ? 'tab-1' : 'tab-2';
    const deadline = Date.now() + timeoutMs;
    return new Promise((resolve) => {
      const tick = () => {
        window.dispatchEvent(new CustomEvent('shortcut-action', {
          detail: { action },
        }));
        const cell = document.getElementById(`scene-cell-${type}-${name}`);
        if (cell && cell.offsetParent !== null) return resolve(cell);
        if (Date.now() > deadline) return resolve(null);
        setTimeout(tick, 100);
      };
      tick();
    });
  }
}
