import { observable } from 'mobx';
import { backend } from '.';
import { isBackendNotFoundError } from '../backend';

// audit B8 — ToggleGroup/PromptChunk/Sampling/GlobalPreset/GlobalCharacterPreset 5개
// 서비스가 JSON 파일 영속화를 거의 verbatim 중복(atomic save tmp+rename+fallback / 2s
// debounce / visibility hidden keepalive flush / 손상 JSON .corrupt 백업+reset)했음.
// 그 공통 구조를 base로 추출. 서비스별 차이(파일명/직렬화 형태/load 필터/reset/완료 이벤트/
// 에러 라벨)만 추상 메서드로 오버라이드. 동작 동일성: 4개는 1:1 동일, GlobalCharacterPreset만
// (1) load 완료 이벤트가 'changed'(loadedEvent 오버라이드로 보존) (2) flushOnHide가 base로
// 새로 생김(2초 debounce 중 탭 닫을 때 저장 손실 갭 fix — M4와 같은 결의 견고성 개선).
//
// 결합: 5개가 base에 의존(C1 충돌)하나, 각 인스턴스가 자기 saveTimeout/state라 공유 가변
// 상태 0 = 단순 위임(취성 안 늘어남). instruction 우선순위(정확성=견고성→단순함)로 수용.
export abstract class DebouncedJsonStore extends EventTarget {
  @observable accessor loaded: boolean = false;
  @observable accessor loadError: string | null = null;
  private saveTimeout: any = null;

  constructor() {
    super();
    // 2초 debounce가 fire 전 탭 닫히면 손실 → visibility hidden 시 keepalive로 강제 flush.
    // saveTimeout 있을 때만(실제 pending). 리스너 등록만 하고 추상 호출은 flush 시점(런타임).
    if (typeof document !== 'undefined') {
      const flushOnHide = () => {
        if (document.visibilityState !== 'hidden') return;
        if (!this.saveTimeout) return;
        clearTimeout(this.saveTimeout);
        this.saveTimeout = null;
        try {
          backend.writeFileKeepalive(
            this.getFileName(),
            JSON.stringify(this.buildStore()),
          );
        } catch {
          // buildStore/직렬화 실패 — 무시(다음 정상 save로 회복)
        }
      };
      document.addEventListener('visibilitychange', flushOnHide);
      window.addEventListener('pagehide', flushOnHide);
    }
  }

  // ── 서비스별 오버라이드 ──
  protected abstract getFileName(): string;
  // 디스크에 쓸 store 객체 (예: { version: 1, presets } ). save/flushOnHide 공통 사용.
  protected abstract buildStore(): any;
  // JSON.parse 결과를 in-memory state에 반영(검증/필터 포함). parse 성공 분기에서 호출.
  protected abstract applyParsed(json: any): void;
  // 파일 없음/손상 시 빈 state로 초기화.
  protected abstract resetState(): void;
  // load 완료 시 dispatch할 이벤트명. 기본 'loaded', GlobalCharacterPreset만 'changed'.
  protected loadedEvent(): string {
    return 'loaded';
  }
  // console.error 라벨 ("Failed to save <label>").
  protected saveErrorLabel(): string {
    return this.getFileName();
  }

  // ── 공통 영속화 ──
  async load(): Promise<void> {
    const file = this.getFileName();
    this.loaded = false;
    this.loadError = null;
    try {
      const str = await backend.readFile(file);
      try {
        const json = JSON.parse(str);
        this.applyParsed(json);
      } catch (parseErr) {
        // 손상 JSON — .corrupt-<ts>로 백업 후 reset(다음 save가 손상본 덮어쓰는 것 방지).
        const corruptName = `${file}.corrupt-${Date.now()}`;
        try {
          await backend.renameFile(file, corruptName);
        } catch (e) {
          // ignore rename errors
        }
        this.resetState();
        this.dispatchEvent(
          new CustomEvent('corrupted', { detail: { backupName: corruptName } }),
        );
      }
    } catch (e: any) {
      if (isBackendNotFoundError(e)) {
        // 404만 신규/미생성 파일로 인정한다.
        this.resetState();
      } else {
        // 네트워크·timeout·5xx는 기존 파일이 있을 수 있다. 빈 정상 상태로 승격하지 않고
        // loaded=false를 유지해 이후 save/keepalive가 원본을 덮지 못하게 fail-closed.
        this.loadError = String(e?.message || e || 'unknown read error');
        if (this.saveTimeout) clearTimeout(this.saveTimeout);
        this.saveTimeout = null;
        console.error(`[global-store] ${file} load failed; writes blocked:`, e);
        this.dispatchEvent(new CustomEvent('load-failed', {
          detail: { file, error: this.loadError },
        }));
        return;
      }
    }
    this.loaded = true;
    this.dispatchEvent(new CustomEvent(this.loadedEvent(), {}));
  }

  async save(): Promise<void> {
    const file = this.getFileName();
    if (!this.loaded || this.loadError) {
      throw new Error(`${file} is not loaded; write blocked to preserve existing data`);
    }
    const data = JSON.stringify(this.buildStore());
    const tmp = file + '.tmp';
    try {
      await backend.writeFile(tmp, data);
      await backend.renameFile(tmp, file);
    } catch (e) {
      // Fallback: atomic rename 실패 시 직접 쓰기
      try {
        await backend.writeFile(file, data);
      } catch (e2) {
        console.error('Failed to save ' + this.saveErrorLabel() + ':', e2);
      }
    }
  }

  scheduleSave(): void {
    if (!this.loaded || this.loadError) return;
    if (this.saveTimeout) clearTimeout(this.saveTimeout);
    this.saveTimeout = setTimeout(() => {
      this.saveTimeout = null;
      this.save().catch((e) =>
        console.error('Failed to save ' + this.saveErrorLabel() + ':', e),
      );
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
}
