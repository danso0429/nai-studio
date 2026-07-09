import { observable, action } from 'mobx';
import { PieceLibrary, IPieceLibrary } from './types';
import { backend } from '.';

const GLOBAL_PIECES_FILE = 'global_pieces.json';

export class GlobalPieceService {
  @observable accessor library: Map<string, PieceLibrary> = new Map();
  private saveTimeout: any = null;

  constructor() {
    // scheduleSave()의 2초 debounce가 fire 전에 사용자가 탭 닫으면 손실. keepalive fetch로
    // visibility hidden 시점 강제 flush. saveTimeout 있을 때만 (실제 pending인 경우만).
    if (typeof document !== 'undefined') {
      const flushOnHide = () => {
        if (document.visibilityState !== 'hidden') return;
        if (!this.saveTimeout) return;
        clearTimeout(this.saveTimeout);
        this.saveTimeout = null;
        const json: Record<string, any> = {};
        for (const [key, value] of this.library.entries()) {
          json[key] = value.toJSON();
        }
        backend.writeFileKeepalive(GLOBAL_PIECES_FILE, JSON.stringify(json));
      };
      document.addEventListener('visibilitychange', flushOnHide);
      window.addEventListener('pagehide', flushOnHide);
    }
  }

  async load() {
    // 손상/부재 분기 (진단 F2-13): 옛 코드는 통짜 catch → 빈 Map — 파싱 실패(손상)면
    // 다음 save가 손상본을 빈 데이터로 덮어써 전역 조각 전체가 복구 불가로 소실됐음.
    // DebouncedJsonStore와 같은 패턴: 손상은 .corrupt-<ts>로 원본 보존 후 빈 시작.
    let str: string;
    try {
      str = await backend.readFile(GLOBAL_PIECES_FILE);
    } catch (e) {
      // 파일 없음/read 실패 — 빈 state로 시작 (기존 동작).
      this.library = new Map();
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
  }

  async save() {
    const json: Record<string, any> = {};
    for (const [key, value] of this.library.entries()) {
      json[key] = value.toJSON();
    }
    await backend.writeFile(GLOBAL_PIECES_FILE, JSON.stringify(json));
  }

  scheduleSave() {
    if (this.saveTimeout) clearTimeout(this.saveTimeout);
    this.saveTimeout = setTimeout(() => this.save(), 2000);
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
