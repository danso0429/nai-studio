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
    try {
      const str = await backend.readFile(GLOBAL_PIECES_FILE);
      const json: Record<string, IPieceLibrary> = JSON.parse(str);
      this.library = new Map(
        Object.entries(json).map(([key, value]) => [
          key,
          PieceLibrary.fromJSON(value),
        ]),
      );
    } catch (e) {
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
