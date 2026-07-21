import { observable, action } from 'mobx';
import { PieceLibrary, IPieceLibrary } from './types';
import { backend } from '.';
import { isBackendNotFoundError } from '../backends/apiError';

const GLOBAL_PIECES_FILE = 'global_pieces.json';

export class GlobalPieceService extends EventTarget {
  @observable accessor library: Map<string, PieceLibrary> = new Map();
  @observable accessor loaded: boolean = false;
  @observable accessor loadError: string | null = null;
  private saveTimeout: any = null;

  constructor() {
    super();
    // scheduleSave()의 2초 debounce가 fire 전에 사용자가 탭 닫으면 손실. keepalive fetch로
    // visibility hidden 시점 강제 flush. saveTimeout 있을 때만 (실제 pending인 경우만).
    if (typeof document !== 'undefined') {
      const flushOnHide = () => {
        if (document.visibilityState !== 'hidden') return;
        if (!this.saveTimeout) return;
        clearTimeout(this.saveTimeout);
        this.saveTimeout = null;
        if (!this.loaded || this.loadError) return;
        const json: Record<string, any> = {};
        for (const [key, value] of this.library.entries()) {
          json[key] = value.toJSON();
        }
        void backend.writeFileKeepalive(GLOBAL_PIECES_FILE, JSON.stringify(json)).catch((e) => {
          console.warn('[global-pieces] keepalive write failed:', e);
        });
      };
      document.addEventListener('visibilitychange', flushOnHide);
      window.addEventListener('pagehide', flushOnHide);
    }
  }

  async load() {
    // 손상/부재 분기 (진단 F2-13): 옛 코드는 통짜 catch → 빈 Map — 파싱 실패(손상)면
    // 다음 save가 손상본을 빈 데이터로 덮어써 전역 조각 전체가 복구 불가로 소실됐음.
    // DebouncedJsonStore와 같은 패턴: 손상은 .corrupt-<ts>로 원본 보존 후 빈 시작.
    this.loaded = false;
    this.loadError = null;
    let str: string;
    try {
      str = await backend.readFile(GLOBAL_PIECES_FILE);
    } catch (e: any) {
      if (isBackendNotFoundError(e)) {
        this.library = new Map();
        this.loaded = true;
        this.dispatchEvent(new CustomEvent('loaded', {}));
        return;
      }
      this.loadError = String(e?.message || e || 'unknown read error');
      if (this.saveTimeout) clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
      console.error('[global-store] global_pieces.json load failed; writes blocked:', e);
      this.dispatchEvent(new CustomEvent('load-failed', {
        detail: { file: GLOBAL_PIECES_FILE, error: this.loadError },
      }));
      return;
    }
    try {
      const json: Record<string, IPieceLibrary> = JSON.parse(str);
      this.library = new Map(
        Object.entries(json).map(([key, value]) => [
          key,
          PieceLibrary.fromJSON(value),
        ]),
      );
    } catch (e) {
      const corruptName = `${GLOBAL_PIECES_FILE}.corrupt-${Date.now()}`;
      try {
        await backend.renameFile(GLOBAL_PIECES_FILE, corruptName);
        console.error(`[global-pieces] 손상 감지 — 원본을 ${corruptName}에 보존`);
      } catch {}
      this.library = new Map();
    }
    this.loaded = true;
    this.dispatchEvent(new CustomEvent('loaded', {}));
  }

  async save() {
    if (!this.loaded || this.loadError) {
      throw new Error(`${GLOBAL_PIECES_FILE} is not loaded; write blocked to preserve existing data`);
    }
    const json: Record<string, any> = {};
    for (const [key, value] of this.library.entries()) {
      json[key] = value.toJSON();
    }
    await backend.writeFile(GLOBAL_PIECES_FILE, JSON.stringify(json));
  }

  scheduleSave() {
    if (!this.loaded || this.loadError) return;
    if (this.saveTimeout) clearTimeout(this.saveTimeout);
    this.saveTimeout = setTimeout(() => {
      this.saveTimeout = null;
      this.save().catch((e) => console.error('Failed to save global pieces:', e));
    }, 2000);
  }

  async flushSave(): Promise<void> {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }
    if (!this.loaded || this.loadError) return;
    await this.save();
  }

  async flushPendingSave(): Promise<boolean> {
    if (!this.saveTimeout) return false;
    clearTimeout(this.saveTimeout);
    this.saveTimeout = null;
    if (!this.loaded || this.loadError) return false;
    await this.save();
    return true;
  }

  @action
  addLibrary(name: string, lib: PieceLibrary) {
    this.library.set(name, lib);
    this.scheduleSave();
  }

  @action
  deleteLibrary(name: string) {
    this.library.delete(name);
    this.scheduleSave();
  }
}
