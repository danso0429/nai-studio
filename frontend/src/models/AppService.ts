import {
  backend,
  gameService,
  globalPieceService,
  globalPresetService,
  imageService,
  isMobile,
  localAIService,
  sessionService,
  taskQueueService,
  workFlowService,
  zipService,
} from '.';
import { startVisibleInterval } from '../visibleInterval';
import type { GlobalPresetType, IGlobalPresetEntry } from './GlobalPresetService';
import { SUPPORTED_GLOBAL_PRESET_TYPES } from './GlobalPresetService';
import { Dialog } from '../components/ConfirmWindow';
import { cropMirrorResultFromDataUri, dataUriToBase64, deleteImageFiles } from './ImageService';
import {
  createImageWithText,
  embedJSONInPNG,
  importPreset,
  normalizePresetJson,
  readJSONFromPNG,
} from './SessionService';
import { action, observable } from 'mobx';
import {
  CharacterPreset,
  GenericScene,
  InpaintScene,
  ISession,
  isValidPieceLibrary,
  isValidSession,
  isValidNAISPreset,
  extractNAISPieceNames,
  convertNAISToSession,
  Piece,
  PieceLibrary,
  PromptPiece,
  Scene,
  Session,
} from './types';
import { apiUrl, extractApiError, extractPromptDataFromBase64, getFirstFile, josaIGa, josaRo, josaEulReul } from './util';
import { DriveRetryStatus } from '../backend';
import { v4 } from 'uuid';
import { Resolution, resolutionMap } from '../backends/imageGen';
import { ProgressDialog } from '../components/ProgressWindow';
import { migratePieceLibrary } from './legacy';
import {
  oneTimeFlowMap,
  oneTimeFlows,
  queueRemoveBg,
} from './workflows/OneTimeFlows';

export interface BatchPickerItem {
  type: 'scene' | 'inpaint';
  text: string;
  callback: (scenes: GenericScene[]) => void;
  scenes?: GenericScene[];
}

// 이미지 내보내기 프리셋: exportPackage 다이얼로그 chain의 모든 옵션을 한 묶음으로 저장.
// 적용 시 다이얼로그 안 띄우고 즉시 exportImpl 호출.
export interface ExportPreset {
  id: string;
  name: string;
  imageSelection: 'fav' | 'all'; // 즐겨찾기만 / 모두
  fileNameFormat: 'normal' | 'prefix'; // (씬).(번호) / (캐릭터).(씬).(번호)
  prefixName: string; // prefix 형식일 때 캐릭터 이름. normal이면 빈 string.
  optimize: 'original' | 'lossy' | 'lossless' | 'avif';
  imageSize: number; // optimize !== 'original'일 때만 사용
  separator: string; // 파일명 구분자 (기본 '.')
  charsToReplace: string[]; // 변환할 특수문자 list
}

// Upload `path` to Drive via the server-side single-file sync endpoint.
// Phase 9: 백그라운드 모드. 서버는 큐에 등록 후 즉시 202 반환. 완료/실패는 WS 이벤트
// (drive-sync-complete / drive-sync-failed)로 broadcast됨. 클라가 닫혀도 서버 진행.
// - progressDialog: 큐 등록 즉시 close (백그라운드 진행 표시).
// - 완료/최종 실패는 별도 토스트로 알림.
// - 자동 재시도 진행 중은 widget(좌측 하단 + queue.html)에서 확인.
async function syncExportToDrive(opts: {
  path: string;
  pid: string;
  successLabel: string;
  logTag: string;
}): Promise<boolean> {
  const { path: jobPath, pid, successLabel, logTag } = opts;
  let queued = false;
  try {
    const r = await fetch(apiUrl('/api/fs/sync-exports'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: jobPath }),
    });
    const data = await r.json();
    queued = !!(data.ok && data.queued);
    if (!queued) console.warn('[' + logTag + '] sync-exports queue rejection:', data);
  } catch (e) {
    console.warn('[' + logTag + '] sync-exports threw:', e);
  }
  appState.finishProgressDialog(
    pid,
    queued
      ? '✓ Drive 업로드 큐 등록 (백그라운드 진행)'
      : '✗ Drive 큐 등록 실패',
    queued,
  );
  appState.refreshDriveRetryStatus();

  if (queued) {
    // WS terminal 이벤트 구독. 첫 매칭 또는 15분 timeout 후 자동 unsubscribe.
    const unsubs: Array<() => void> = [];
    const cleanup = () => unsubs.forEach((u) => u());
    let done = false;
    unsubs.push(backend.onDriveSyncComplete((data) => {
      if (done || data.requestedPath !== jobPath) return;
      done = true;
      cleanup();
      appState.pushMessage(`${successLabel} (${data.fileName})`);
      appState.refreshDriveRetryStatus();
    }));
    unsubs.push(backend.onDriveSyncFailed((data) => {
      if (done || data.requestedPath !== jobPath) return;
      if (data.willRetry) {
        // 재시도 예정 — 위젯에서 진행 확인. 토스트 안 띄움.
        appState.refreshDriveRetryStatus();
        return;
      }
      done = true;
      cleanup();
      appState.pushMessage(`✗ Drive 업로드 최종 실패: ${data.fileName} (${data.error})`);
      appState.refreshDriveRetryStatus();
    }));
    setTimeout(() => { if (!done) { done = true; cleanup(); } }, 15 * 60 * 1000);
  }

  return queued;
}

const SPECIAL_CHAR_REGEX = /[^a-zA-Z0-9가-힣ぁ-んァ-ヶ一-龥\u3000-\u303F]/g;

// toast/progress 자동 dismiss 시간 (ms). 일관성용 상수.
// SHORT: 간단 알림 (메시지), 인라인 progress 완료. 화면을 오래 가리지 않음.
// LONG : pinned progress 완료. 결과(success/error)를 좀 더 보여줄 가치.
const TOAST_DISMISS_SHORT_MS = 3000;
const TOAST_DISMISS_LONG_MS = 5000;

function detectSpecialChars(scenes: { name: string }[]): Set<string> {
  const result = new Set<string>();
  for (const s of scenes) {
    const matches = s.name.match(SPECIAL_CHAR_REGEX);
    if (matches) matches.forEach((c) => result.add(c));
  }
  return result;
}

function buildSpecialCharReplacer(chars: Set<string>): RegExp | null {
  if (chars.size === 0) return null;
  const escaped = Array.from(chars)
    .map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  return new RegExp(`(${escaped})+`, 'g');
}

export class AppState {
  @observable accessor curSession: Session | undefined = undefined;
  @observable accessor messages: { id: string; text: string }[] = [];
  @observable accessor dialogs: Dialog[] = [];
  @observable accessor samples: number = 1;
  @observable accessor progressDialogs: ProgressDialog[] = [];
  // pinned toast: 일반 progressDialogs와 별도 row(아래 줄)에 표시. 가로 flex-1 균등분할에
  // 끼지 않아 길이 줄어들지 않음. orphan 정리 같은 long-running 진행도 전용.
  @observable accessor pinnedProgressDialogs: ProgressDialog[] = [];
  @observable accessor driveRetryStatus: DriveRetryStatus | null = null;
  @observable accessor driveRetryModalOpen: boolean = false;

  // 모달 오버레이 카운터 — ModalOverlay open/close 시 useEffect에서 증감. 메타데이터 D&D 차단용.
  @observable accessor modalOverlayCount: number = 0;
  @action
  incrementModalOverlay() {
    this.modalOverlayCount++;
  }
  @action
  decrementModalOverlay() {
    this.modalOverlayCount = Math.max(0, this.modalOverlayCount - 1);
  }
  // 큐가 현재 처리 중인 씬의 getSceneKey 값 (session.name/type/name). null이면 처리 중 아님.
  // WS queue-job-start로 set, queue-status 응답 jobs[0].meta로 초기화/회복.
  @observable accessor currentProcessingSceneKey: string | null = null;

  // 서버 큐 통계 — TaskProgressBar의 정확한 ETA용. /api/queue/status에서 폴링.
  // recentAvgMs(최근 100건) → currentBucketAvgMs → allTimeAvgMs 순서로 fallback. 2026-05-13.
  @observable accessor serverQueueAvgMs: number = 0;
  // 진행 중인 export pipeline (resize/zip). tar 생성 끝나면 null로 → driveRetry가 인계.
  @observable accessor exportPipelineJobs: {
    jobId: string;
    phase: 'queued' | 'resize' | 'zip';
    done: number;
    total: number;
    outFileName: string;
  }[] = [];
  @observable accessor externalImage: string | undefined = undefined;
  @observable accessor appliedCharacterPreset: string | undefined = undefined; // 현재 적용된 캐릭터 프리셋 이름

  // 이미지 클립보드
  @observable accessor imageClipboard: string[] = [];

  // 씬 카드 디자인 설정
  @observable accessor classicSceneCard: boolean = false;

  // 씬 그리드 초기 썸네일 크기. undefined면 화면 폭으로 자동 결정. ConfigScreen
  // 에서 사용자가 명시 override 가능. App.tsx의 config-changed에서 sync.
  @observable accessor initialThumbSize: number | undefined = undefined;

  // 자동완성 모드: false=커서 왼쪽만(기본), true=콤마 사이 전체 단어
  @observable accessor fullWordAutoComplete: boolean = (() => {
    return localStorage.getItem('sdstudio-full-word-autocomplete') === 'true';
  })();

  // 이미지 내보내기 프리셋 — localStorage에 영속화. exportPackage 시 다이얼로그 chain 건너뜀.
  @observable accessor exportPresets: ExportPreset[] = (() => {
    try {
      const raw = localStorage.getItem('sdstudio-export-presets');
      if (raw) return JSON.parse(raw);
    } catch {}
    return [];
  })();
  @observable accessor exportPresetsDialogOpen: boolean = false;
  @observable accessor exportPresetsDialogType: 'scene' | 'inpaint' = 'scene';

  // 일회용 내보내기 옵션 폼. 프리셋 저장 안 하고 옵션 직접 입력 → exportImpl 즉시.
  // resolve로 ExportPreset 객체 반환 (또는 cancel 시 undefined).
  @observable accessor exportOptionsFormOpen: boolean = false;
  exportOptionsFormDefaults: ExportPreset | null = null;
  exportOptionsFormResolve: ((p: ExportPreset | undefined) => void) | null = null;

  openExportOptionsForm(defaults?: Partial<ExportPreset>): Promise<ExportPreset | undefined> {
    return new Promise((resolve) => {
      // 이전 promise 살아있으면 cancel로 정리
      if (this.exportOptionsFormResolve) {
        this.exportOptionsFormResolve(undefined);
      }
      this.exportOptionsFormDefaults = {
        id: 'one-off',
        name: '',
        imageSelection: 'all',
        fileNameFormat: 'normal',
        prefixName: '',
        optimize: 'lossy',
        imageSize: 1024,
        separator: '.',
        charsToReplace: [],
        ...defaults,
      };
      this.exportOptionsFormResolve = resolve;
      this.exportOptionsFormOpen = true;
    });
  }

  closeExportOptionsForm(result: ExportPreset | undefined) {
    if (this.exportOptionsFormResolve) {
      this.exportOptionsFormResolve(result);
      this.exportOptionsFormResolve = null;
    }
    this.exportOptionsFormOpen = false;
    this.exportOptionsFormDefaults = null;
  }

  // 커스텀 해상도 입력 (width/height 1폼). SceneEditor/InPaintEditor/
  // onSceneQueueMenuSelectAsync 3곳에서 동일 패턴 (input 2번 + 64 round-up) 중복하던 걸
  // 일체화. 결과는 이미 64 배수로 round-up된 값.
  @observable accessor customResolutionDialogOpen: boolean = false;
  customResolutionDialogDefaults: { width?: number; height?: number } | null = null;
  customResolutionDialogResolve:
    | ((r: { width: number; height: number } | undefined) => void)
    | null = null;

  openCustomResolutionAsync(defaults?: {
    width?: number;
    height?: number;
  }): Promise<{ width: number; height: number } | undefined> {
    return new Promise((resolve) => {
      if (this.customResolutionDialogResolve) {
        this.customResolutionDialogResolve(undefined);
      }
      this.customResolutionDialogDefaults = defaults ?? null;
      this.customResolutionDialogResolve = resolve;
      this.customResolutionDialogOpen = true;
    });
  }

  closeCustomResolutionDialog(
    result: { width: number; height: number } | undefined,
  ) {
    if (this.customResolutionDialogResolve) {
      this.customResolutionDialogResolve(result);
      this.customResolutionDialogResolve = null;
    }
    this.customResolutionDialogOpen = false;
    this.customResolutionDialogDefaults = null;
  }

  // 씬 이름 내보내기 — 대체문자 + 변환할 특수문자 1폼 일체화 (예전: input → checkbox 2단계).
  @observable accessor sceneNameExportFormOpen: boolean = false;
  sceneNameExportFormChars: Set<string> | null = null;
  sceneNameExportFormResolve:
    | ((r: { replacement: string; charsToReplace: Set<string> } | undefined) => void)
    | null = null;

  openSceneNameExportFormAsync(
    chars: Set<string>,
  ): Promise<{ replacement: string; charsToReplace: Set<string> } | undefined> {
    return new Promise((resolve) => {
      if (this.sceneNameExportFormResolve) {
        this.sceneNameExportFormResolve(undefined);
      }
      this.sceneNameExportFormChars = chars;
      this.sceneNameExportFormResolve = resolve;
      this.sceneNameExportFormOpen = true;
    });
  }

  closeSceneNameExportForm(
    result: { replacement: string; charsToReplace: Set<string> } | undefined,
  ) {
    if (this.sceneNameExportFormResolve) {
      this.sceneNameExportFormResolve(result);
      this.sceneNameExportFormResolve = null;
    }
    this.sceneNameExportFormOpen = false;
    this.sceneNameExportFormChars = null;
  }

  saveExportPresets() {
    try {
      localStorage.setItem(
        'sdstudio-export-presets',
        JSON.stringify(this.exportPresets),
      );
    } catch {}
  }

  openExportPresetsDialog(type: 'scene' | 'inpaint') {
    this.exportPresetsDialogType = type;
    this.exportPresetsDialogOpen = true;
  }

  // 프롬프트조각 에디터 오버레이
  @observable accessor pieceEditorOpen: boolean = false;

  // 찾기 및 변환 다이얼로그
  @observable accessor findReplaceOpen: boolean = false;

  // 씬 일괄 임포트 다이얼로그
  @observable accessor sceneImporterOpen: boolean = false;

  // 단축키 시스템용 상태
  @observable accessor floatViewCount: number = 0;
  @observable accessor resultViewerOpen: boolean = false;
  @observable accessor imageGridFocusable: boolean = false;
  @observable accessor configScreenOpen: boolean = false;

  @action
  incrementFloatView() {
    this.floatViewCount++;
  }

  @action
  decrementFloatView() {
    this.floatViewCount = Math.max(0, this.floatViewCount - 1);
  }

  // 프로젝트 영구 삭제 (백그라운드). 같은 프로젝트 중복 enqueue 차단.
  // 호출 지점: SessionSelect의 휴지통 버튼, SessionTreePicker의 점 세개 메뉴.
  deleteProjectBackground(name: string) {
    if (sessionService.deletingProjects.has(name)) {
      this.pushMessage(`프로젝트 "${name}"${josaIGa(name)} 이미 삭제 중이에요.`);
      return;
    }
    this.pushDialog({
      type: 'confirm',
      text: `"${name}" 프로젝트를 영구 삭제합니다. 로컬과 Google Drive의 모든 데이터(outs/inpaints/vibes/inpaint_masks/inpaint_orgs/exports)가 함께 지워지며 되돌릴 수 없습니다. 진행할까요?`,
      callback: async () => {
        if (sessionService.deletingProjects.has(name)) {
          this.pushMessage(`프로젝트 "${name}"${josaIGa(name)} 이미 삭제 중이에요.`);
          return;
        }
        sessionService.deletingProjects.add(name);
        const pid = this.pushProgressDialog(`프로젝트 "${name}" 삭제 중...`, 1);
        (async () => {
          try {
            await sessionService.delete(name);
            this.finishProgressDialog(
              pid,
              `✓ 프로젝트 "${name}" 삭제 완료`,
              true,
            );
            if (this.curSession?.name === name) {
              this.curSession = undefined;
            }
          } catch (e: any) {
            this.finishProgressDialog(
              pid,
              `✗ 프로젝트 "${name}" 삭제 실패: ${extractApiError(e)}`,
              false,
            );
          } finally {
            sessionService.deletingProjects.delete(name);
          }
        })();
      },
    });
  }

  @action
  openPieceEditor() {
    this.pieceEditorOpen = true;
  }

  @action
  closePieceEditor() {
    this.pieceEditorOpen = false;
  }

  @action
  openFindReplace() {
    this.findReplaceOpen = true;
  }

  @action
  closeFindReplace() {
    this.findReplaceOpen = false;
  }

  @action
  openSceneImporter() {
    this.sceneImporterOpen = true;
  }

  @action
  closeSceneImporter() {
    this.sceneImporterOpen = false;
  }

  // 좌측 패널 상태
  @observable accessor leftPanelWidth: number = (() => {
    const saved = localStorage.getItem('sdstudio-left-panel-width');
    return saved ? Math.max(250, Math.min(800, parseInt(saved, 10) || 400)) : 400;
  })();
  @observable accessor leftPanelCollapsed: boolean = (() => {
    return localStorage.getItem('sdstudio-left-panel-collapsed') === 'true';
  })();

  @action
  setLeftPanelWidth(w: number) {
    this.leftPanelWidth = w;
    localStorage.setItem('sdstudio-left-panel-width', String(w));
  }

  @action
  toggleLeftPanel() {
    this.leftPanelCollapsed = !this.leftPanelCollapsed;
    localStorage.setItem('sdstudio-left-panel-collapsed', String(this.leftPanelCollapsed));
  }

  @action
  setSamples(samples: number): void {
    this.samples = samples;
  }

  pushMessage(msg: string, opts?: { sticky?: boolean }): string {
    const id = v4();
    this.messages.push({ id, text: msg });
    if (!opts?.sticky) this._scheduleMessageDismiss(id);
    return id;
  }

  // 진행 중 토스트 갱신 (sticky 토스트의 텍스트 바꿔야 할 때).
  updateMessage(id: string, msg: string) {
    const idx = this.messages.findIndex((m) => m.id === id);
    if (idx >= 0) this.messages[idx] = { id, text: msg };
  }

  // sticky 토스트 명시 제거 또는 일반 토스트 즉시 제거.
  dismissMessage(id: string) {
    const idx = this.messages.findIndex((m) => m.id === id);
    if (idx >= 0) this.messages.splice(idx, 1);
  }

  private _scheduleMessageDismiss(id: string) {
    setTimeout(() => {
      const idx = this.messages.findIndex((m) => m.id === id);
      if (idx >= 0) this.messages.splice(idx, 1);
    }, TOAST_DISMISS_SHORT_MS);
  }

  pushDialog(dialog: Dialog) {
    this.dialogs.push(dialog);
  }

  copyImagesToClipboard(paths: string[]) {
    this.imageClipboard = [...paths];
    this.pushMessage(paths.length + '장의 이미지가 복사되었습니다.');
  }

  async pasteImagesFromClipboard(session: Session, scene: GenericScene) {
    if (this.imageClipboard.length === 0) {
      this.pushMessage('복사된 이미지가 없습니다.');
      return;
    }
    const targetDir = imageService.getOutputDir(session, scene);
    let copied = 0;
    for (const srcPath of this.imageClipboard) {
      try {
        const filename = Date.now().toString() + '_' + copied + '.png';
        await backend.copyFile(srcPath, targetDir + '/' + filename);
        copied++;
      } catch (e) {
        console.error('이미지 붙여넣기 실패:', srcPath, e);
      }
    }
    await imageService.refresh(session, scene);
    this.pushMessage(copied + '장의 이미지가 붙여넣어졌습니다.');
  }

  pushDialogAsync(dialog: Dialog) {
    return new Promise<string | undefined>((resolve, reject) => {
      dialog.callback = (value?: string, text?: string) => {
        resolve(value);
      };
      dialog.onCancel = () => {
        resolve(undefined);
      };
      this.dialogs.push(dialog);
    });
  }

  // 기존 단일 슬롯 API. id 'legacy' 한 자리만 점유. 호환 유지용.
  setProgressDialog(dialog: Omit<ProgressDialog, 'id' | 'status'> | undefined) {
    if (dialog === undefined) {
      this.progressDialogs = this.progressDialogs.filter((p) => p.id !== 'legacy');
    } else {
      const others = this.progressDialogs.filter((p) => p.id !== 'legacy');
      this.progressDialogs = [
        ...others,
        { ...dialog, id: 'legacy', status: 'active' },
      ];
    }
  }

  pushProgressDialog(text: string, total: number = 1): string {
    const id = 'pd-' + Math.random().toString(36).slice(2, 10);
    this.progressDialogs = [
      ...this.progressDialogs,
      { id, text, done: 0, total, status: 'active' },
    ];
    return id;
  }

  updateProgressDialog(
    id: string,
    partial: Partial<Omit<ProgressDialog, 'id'>>,
  ) {
    this.progressDialogs = this.progressDialogs.map((p) =>
      p.id === id ? { ...p, ...partial } : p,
    );
  }

  removeProgressDialog(id: string) {
    this.progressDialogs = this.progressDialogs.filter((p) => p.id !== id);
  }

  finishProgressDialog(
    id: string,
    finalText: string,
    success: boolean,
    autoDismissMs: number = TOAST_DISMISS_SHORT_MS,
  ) {
    this.progressDialogs = this.progressDialogs.map((p) =>
      p.id === id
        ? { ...p, text: finalText, done: p.total, status: success ? 'success' : 'error' }
        : p,
    );
    if (autoDismissMs > 0) {
      setTimeout(() => this.removeProgressDialog(id), autoDismissMs);
    }
  }

  // ─── Pinned progress (별도 row, 가로 길이 고정) ────────────────────
  pushPinnedProgress(id: string, text: string, total: number = 1): string {
    this.pinnedProgressDialogs = [
      ...this.pinnedProgressDialogs,
      { id, text, done: 0, total, status: 'active' },
    ];
    return id;
  }

  updatePinnedProgress(
    id: string,
    partial: Partial<Omit<ProgressDialog, 'id'>>,
  ) {
    this.pinnedProgressDialogs = this.pinnedProgressDialogs.map((p) =>
      p.id === id ? { ...p, ...partial } : p,
    );
  }

  removePinnedProgress(id: string) {
    this.pinnedProgressDialogs = this.pinnedProgressDialogs.filter((p) => p.id !== id);
  }

  finishPinnedProgress(
    id: string,
    finalText: string,
    success: boolean,
    autoDismissMs: number = TOAST_DISMISS_LONG_MS,
  ) {
    this.pinnedProgressDialogs = this.pinnedProgressDialogs.map((p) =>
      p.id === id
        ? { ...p, text: finalText, done: p.total, status: success ? 'success' : 'error' }
        : p,
    );
    if (autoDismissMs > 0) {
      setTimeout(() => this.removePinnedProgress(id), autoDismissMs);
    }
  }

  blockIfBusy(): boolean {
    const active = this.progressDialogs.filter(
      (p) => !p.status || p.status === 'active',
    );
    if (active.length > 0) {
      this.pushMessage('진행 중인 작업이 끝난 후 다시 시도해주세요.');
      return true;
    }
    return false;
  }

  async refreshDriveRetryStatus(): Promise<void> {
    try {
      this.driveRetryStatus = await backend.getDriveRetryStatus();
      // rclone 사용 가능 상태가 확인됐으면 30s 폴링 시작 (이미 돌고 있으면 no-op).
      // 사용자가 rclone 설치 후 페이지 새로고침 없이도 자연스레 전환되도록.
      if (this.driveRetryStatus?.driveAvailable) ensureDrivePolling();
    } catch (e) {
      // 네트워크/서버 일시 오류는 무시 (다음 폴링에서 회복)
    }
  }

  // 서버 큐 평균 ETA 폴링. recentAvgMs > currentBucketAvgMs > allTimeAvgMs 순 fallback.
  // 2026-05-13: 본인 보고 — 클라 timeEstimator(ring buffer 128, 클래스별)가 부정확.
  // 서버 timingStats는 영구 누적이라 더 정확.
  async refreshServerQueueAvg(): Promise<void> {
    try {
      const r = await fetch(apiUrl('/api/queue/status'), { cache: 'no-store' });
      if (!r.ok) return;
      const d = await r.json();
      const avg = d.recentAvgMs || d.currentBucketAvgMs || d.allTimeAvgMs || 0;
      if (avg > 0) this.serverQueueAvgMs = avg;
      // 백그라운드 복귀 / WS 재연결 / 초기 부트 시 현재 처리 중 씬 회복.
      // genQueue[0].meta.sceneKey가 있으면 그게 진행 중 씬. processing=false면 null.
      const first = Array.isArray(d.jobs) && d.jobs.length > 0 ? d.jobs[0] : null;
      const liveKey = d.processing && first && first.meta ? (first.meta.sceneKey || null) : null;
      if (this.currentProcessingSceneKey !== liveKey) {
        this.currentProcessingSceneKey = liveKey;
      }
    } catch (e) {}
  }

  // 백그라운드 → 포그라운드 복귀 또는 WS 재연결 시 호출. 그 사이 놓친 progress/
  // complete/failed 이벤트가 안 와서 widget이 '멈춘 것처럼' 보이던 문제 보정.
  // 서버 활성 job 목록과 클라 측 exportPipelineJobs를 동기화 — 서버에 없으면
  // 끝났거나 실패한 거니까 클라에서도 제거, 있는 건 최신 phase/done/total로 갱신.
  async refreshExportStatus(): Promise<void> {
    try {
      const status = await backend.getExportStatus();
      const activeMap = new Map(status.active.map((a) => [a.jobId, a]));
      this.exportPipelineJobs = this.exportPipelineJobs
        .filter((j) => activeMap.has(j.jobId))
        .map((j) => {
          const fresh = activeMap.get(j.jobId)!;
          return {
            ...j,
            phase: fresh.phase as 'queued' | 'resize' | 'zip',
            done: fresh.done,
            total: fresh.total,
          };
        });
    } catch (e) {
      // 일시 오류 무시
    }
  }

  async driveRetryNowAndRefresh(): Promise<void> {
    try {
      await backend.driveRetryNow();
    } catch {}
    await this.refreshDriveRetryStatus();
  }

  async driveRetryDismissAndRefresh(localPath: string): Promise<void> {
    try {
      await backend.driveRetryDismiss(localPath);
    } catch {}
    await this.refreshDriveRetryStatus();
  }

  async driveRetryResetAndRefresh(localPath: string): Promise<void> {
    try {
      await backend.driveRetryReset(localPath);
    } catch {}
    await this.refreshDriveRetryStatus();
  }

  handleFile(file: File) {
    // iOS Safari는 .json/.png 파일에 file.type을 빈 문자열로 주는 경우가 있어
    // 확장자 fallback도 함께 검사.
    const isJson =
      file.type === 'application/json' || /\.json$/i.test(file.name);
    const isPng =
      file.type === 'image/png' || /\.png$/i.test(file.name);
    if (isJson) {
      const reader = new FileReader();
      reader.onload = (e: any) => {
        try {
          const json = JSON.parse(e.target.result);
          handleJSONContent(file.name, json);
        } catch (err) {
          console.error(err);
        }
      };
      reader.readAsText(file);
    } else if (isPng) {
      if (!this.curSession) {
        return;
      }
      try {
        const reader = new FileReader();
        reader.onload = async (e: any) => {
          try {
            const base64 = dataUriToBase64(e.target.result);
            await this.handlePngImport(base64);
          } catch (e) {}
        };
        reader.readAsDataURL(file);
      } catch (err) {
        console.error(err);
      }
    }
    const handleJSONContent = async (name: string, json: any) => {
      if (name.endsWith('.json')) {
        name = name.slice(0, -5);
      }
      const handleAddSession = async (json: any) => {
        const importCool = async () => {
          const sess = await sessionService.get(json.name);
          if (!sess) {
            const pid = appState.pushProgressDialog('프로젝트 불러오는 중...', 1);
            try {
              await sessionService.importSessionShallow(
                json as ISession,
                json.name,
              );
              const newSession = (await sessionService.get(json.name))!;
              this.curSession = newSession;
              appState.finishProgressDialog(pid, '✓ 프로젝트를 불러왔습니다', true);
            } catch (e: any) {
              appState.finishProgressDialog(pid, '✗ 임포트 실패: ' + (e?.message || e), false);
              return;
            }
          } else {
            this.pushDialog({
              type: 'input-confirm',
              text: '프로젝트를 임포트 합니다. 새 프로젝트 이름을 입력하세요.',
              callback: async (value) => {
                if (!value || value === '') {
                  return;
                }
                const pid = appState.pushProgressDialog('프로젝트 불러오는 중...', 1);
                try {
                  await sessionService.importSessionShallow(
                    json as ISession,
                    value,
                  );
                  const newSession = (await sessionService.get(value))!;
                  this.curSession = newSession;
                  appState.finishProgressDialog(pid, '✓ 프로젝트를 불러왔습니다', true);
                } catch (e) {
                  appState.finishProgressDialog(pid, '✗ 이미 존재하는 프로젝트 이름입니다.', false);
                  this.pushMessage('이미 존재하는 프로젝트 이름입니다.');
                }
              },
            });
          }
        };
        if (!this.curSession) {
          await importCool();
        } else {
          this.pushDialog({
            type: 'select',
            text: '프로젝트를 임포트 합니다. 원하시는 방식을 선택해주세요.',
            items: [
              {
                text: '새 프로젝트로 임포트',
                value: 'new-project',
              },
              {
                text: '현재 프로젝트에 씬만 임포트 (⚠️! 씬이 덮어씌워짐)',
                value: 'cur-project',
              },
            ],
            callback: async (option?: string) => {
              if (option === 'new-project') {
                await importCool();
              } else if (option === 'cur-project') {
                const cur = this.curSession!;
                const newJson: ISession = await sessionService.migrate(json);
                for (const key of Object.keys(newJson.scenes)) {
                  if (cur.scenes.has(key)) {
                    cur.scenes.get(key)!.slots = newJson.scenes[key].slots.map(
                      (slot: any) =>
                        slot.map((piece: any) => PromptPiece.fromJSON(piece)),
                    );
                    cur.scenes.get(key)!.resolution =
                      newJson.scenes[key].resolution;
                  } else {
                    const scene = newJson.scenes[key];
                    cur.scenes.set(key, Scene.fromJSON(scene));
                    cur.scenes.get(key)!.mains = [];
                    cur.scenes.get(key)!.game = undefined;
                  }
                }
                appState.pushDialog({
                  type: 'yes-only',
                  text: '씬을 임포트 했습니다',
                });
              }
            },
          });
        }
      };
      if (isValidSession(json)) {
        handleAddSession(json);
      } else if (isValidNAISPreset(json)) {
        const pieceNames = extractNAISPieceNames(json.scenes);
        const doConvert = (libraryName?: string) => {
          const converted = convertNAISToSession(json, libraryName);
          if (libraryName && pieceNames.length > 0) {
            converted.library[libraryName] = {
              version: 1,
              name: libraryName,
              pieces: pieceNames.map((pieceName) => ({
                name: pieceName,
                prompt: '',
              })),
            };
          }
          handleAddSession(converted);
        };
        if (pieceNames.length > 0) {
          this.pushDialog({
            type: 'input-confirm',
            text: 'NAIS 프리셋에서 조각이 감지되었습니다 (' + pieceNames.join(', ') + '). 사용할 프롬프트조각 라이브러리 이름을 입력해 주세요.',
            callback: (value) => {
              if (!value || value === '') {
                doConvert();
              } else {
                doConvert(value);
              }
            },
          });
        } else {
          doConvert();
        }
      } else if (isValidPieceLibrary(json)) {
        if (!json.version) {
          json = migratePieceLibrary(json);
        }
        const importToTarget = (targetLibrary: Map<string, PieceLibrary>, scopeLabel: string) => {
          const afterImport = () => {
            if (scopeLabel === '전역') globalPieceService.scheduleSave();
            if (this.curSession) sessionService.reloadPieceLibraryDB(this.curSession);
          };

          if (!targetLibrary.has(json.name)) {
            targetLibrary.set(json.name, PieceLibrary.fromJSON(json));
            afterImport();
            this.pushDialog({
              type: 'yes-only',
              text: `조각모음을 ${scopeLabel}에 임포트 했습니다`,
            });
            return;
          }

          const srcLib = PieceLibrary.fromJSON(json);
          const targetLib = targetLibrary.get(json.name)!;
          const srcNames = new Set(srcLib.pieces.map(p => p.name));
          const tgtNames = new Set(targetLib.pieces.map(p => p.name));
          const overlap = [...srcNames].filter(n => tgtNames.has(n));
          const srcOnly = [...srcNames].filter(n => !tgtNames.has(n));
          const tgtOnly = [...tgtNames].filter(n => !srcNames.has(n));

          let detail = `${scopeLabel}에 "${json.name}" 조각그룹이 이미 존재합니다.\n\n`;
          if (overlap.length > 0) detail += `겹치는 조각(${overlap.length}개): ${overlap.slice(0, 5).join(', ')}${overlap.length > 5 ? ' ...' : ''}\n`;
          if (srcOnly.length > 0) detail += `임포트에만 있는 조각(${srcOnly.length}개): ${srcOnly.slice(0, 5).join(', ')}${srcOnly.length > 5 ? ' ...' : ''}\n`;
          if (tgtOnly.length > 0) detail += `기존에만 있는 조각(${tgtOnly.length}개): ${tgtOnly.slice(0, 5).join(', ')}${tgtOnly.length > 5 ? ' ...' : ''}\n`;

          const items: { text: string; value: string }[] = [];
          if (overlap.length > 0) {
            items.push({ text: '병합 (겹치는 조각 덮어쓰기)', value: 'merge-overwrite' });
            items.push({ text: '병합 (겹치는 조각 건너뛰기)', value: 'merge-skip' });
          } else {
            items.push({ text: '병합 (양쪽 조각 모두 유지)', value: 'merge-skip' });
          }
          items.push({ text: '통째로 덮어쓰기 (기존 조각 모두 교체)', value: 'overwrite' });
          items.push({ text: '새 이름으로 임포트', value: 'rename' });
          items.push({ text: '취소', value: 'cancel' });

          this.pushDialog({
            type: 'select',
            text: detail,
            items,
            callback: (action) => {
              if (!action || action === 'cancel') return;
              if (action === 'merge-overwrite' || action === 'merge-skip') {
                const overwriteDuplicates = action === 'merge-overwrite';
                let added = 0, overwritten = 0, skipped = 0;
                for (const srcPiece of srcLib.pieces) {
                  const existingIdx = targetLib.pieces.findIndex(p => p.name === srcPiece.name);
                  if (existingIdx >= 0) {
                    if (overwriteDuplicates) {
                      targetLib.pieces[existingIdx] = Piece.fromJSON(srcPiece.toJSON());
                      overwritten++;
                    } else {
                      skipped++;
                    }
                  } else {
                    targetLib.pieces.push(Piece.fromJSON(srcPiece.toJSON()));
                    added++;
                  }
                }
                afterImport();
                const parts = [];
                if (added > 0) parts.push(`${added}개 추가`);
                if (overwritten > 0) parts.push(`${overwritten}개 덮어쓰기`);
                if (skipped > 0) parts.push(`${skipped}개 건너뜀`);
                this.pushMessage(`"${json.name}" 병합 완료: ${parts.join(', ')}`);
              } else if (action === 'overwrite') {
                targetLibrary.delete(json.name);
                targetLibrary.set(json.name, srcLib);
                afterImport();
                this.pushMessage(`"${json.name}" 조각그룹을 덮어썼습니다`);
              } else if (action === 'rename') {
                this.pushDialog({
                  type: 'input-confirm',
                  text: '새 조각그룹 이름을 입력하세요',
                  callback: (newName) => {
                    if (!newName) return;
                    if (targetLibrary.has(newName)) {
                      this.pushMessage('이미 존재하는 이름입니다');
                      return;
                    }
                    srcLib.name = newName;
                    targetLibrary.set(newName, srcLib);
                    afterImport();
                    this.pushMessage(`"${newName}" 조각그룹을 ${scopeLabel}에 임포트 했습니다`);
                  },
                });
              }
            },
          });
        };

        // 세션이 없으면 전역으로 바로 임포트
        if (!this.curSession) {
          importToTarget(globalPieceService.library, '전역');
          return;
        }

        // 세션이 있으면 로컬/전역 선택
        this.pushDialog({
          type: 'select',
          text: '조각그룹을 어디에 임포트하시겠습니까?',
          items: [
            { text: '현재 프로젝트 (로컬)', value: 'local' },
            { text: '전역 (모든 프로젝트)', value: 'global' },
          ],
          callback: (scopeValue) => {
            if (!scopeValue) return;
            if (scopeValue === 'local') {
              importToTarget(this.curSession!.library, '로컬');
            } else {
              importToTarget(globalPieceService.library, '전역');
            }
          },
        });
      }
    };
  }

  @action
  async projectExportShallow() {
    if (!appState.curSession) return;
    const proj = await sessionService.exportSessionShallow(appState.curSession);
    const path = 'exports/' + appState.curSession.name + '.json';
    await backend.writeFile(path, JSON.stringify(proj));
    const pid = appState.pushProgressDialog('Drive 업로드 중 (프로젝트 파일)...', 1);
    await syncExportToDrive({
      path,
      pid,
      successLabel: '✓ 프로젝트 파일 Drive 업로드 완료',
      logTag: 'save',
    });
  }

  @action
  async projectExportDeep() {
    if (!appState.curSession) return;
    const path = 'exports/' + appState.curSession.name + '.tar';
    if (zipService.isZipping) {
      appState.pushMessage('이미 내보내기 작업이 진행중입니다.');
      return;
    }
    const pid = appState.pushProgressDialog('프로젝트 백업 압축 중..', 1);
    try {
      await sessionService.exportSessionDeep(appState.curSession, path);
    } catch (e: any) {
      appState.finishProgressDialog(pid, '✗ 백업 압축 실패', false);
      return;
    }
    appState.updateProgressDialog(pid, {
      text: 'Drive 업로드 중 (백업)...',
      done: 0,
      total: 1,
    });
    await syncExportToDrive({
      path,
      pid,
      successLabel: '✓ 프로젝트 백업 Drive 업로드 완료',
      logTag: 'saveDeep',
    });
  }

  // 폴더 전체 백업 (이미지 포함). projectExportDeep의 폴더 버전 — N개 프로젝트의
  // project.json + outs/inpaints/inpaint_*/vibes 전부를 1개 tar로 묶음.
  // Drive 가용시 exports/backups/{folder}.tar로 정리(서버 화이트리스트) → Drive backups/ 폴더로 자동.
  // Drive 미가용시 exports/{folder}.tar로 두고 브라우저 자동 다운로드 (이미지 내보내기와 같은 패턴).
  @action
  async folderExportDeep(folderName: string, projectNames: string[]) {
    if (projectNames.length === 0) {
      appState.pushMessage('빈 폴더예요');
      return;
    }
    if (zipService.isZipping) {
      appState.pushMessage('이미 내보내기 작업이 진행중입니다.');
      return;
    }
    // refresh 1번도 안 돈 상태에서 빠른 클릭하면 잘못된 Drive 분기 → 클릭 직전 강제 갱신.
    // refresh 실패해도 cached 값 그대로 둠 (네트워크 일시 오류 회복 대기).
    await appState.refreshDriveRetryStatus();
    // 명시적 false만 다운로드 fallback. null/undefined는 Drive 가용으로 가정 (낙관적, refresh 실패 케이스).
    const driveAvailable = appState.driveRetryStatus?.driveAvailable !== false;
    const path = driveAvailable
      ? 'exports/backups/' + folderName + '.tar'
      : 'exports/' + folderName + '.tar';
    const pid = appState.pushProgressDialog(
      `'${folderName}' 백업 압축 중...`,
      projectNames.length + 1,
    );
    try {
      await sessionService.exportFolderDeep(
        folderName,
        projectNames,
        path,
        (text, done, total) => {
          appState.updateProgressDialog(pid, { text, done, total });
        },
      );
    } catch (e: any) {
      appState.finishProgressDialog(
        pid,
        '✗ 폴더 백업 압축 실패: ' + (e?.message ?? e),
        false,
      );
      return;
    }
    if (!driveAvailable) {
      const fileName = path.split('/').pop() || folderName + '.tar';
      appState.finishProgressDialog(
        pid,
        `✓ 폴더 백업 완성 — 다운로드 시작 (${fileName})`,
        true,
      );
      backend.copyToDownloads(path).catch(() => {});
      return;
    }
    appState.updateProgressDialog(pid, {
      text: 'Drive 업로드 중 (폴더 백업)...',
      done: 0,
      total: 1,
    });
    await syncExportToDrive({
      path,
      pid,
      successLabel: '✓ 폴더 백업 Drive 업로드 완료',
      logTag: 'saveFolderDeep',
    });
  }

  // 폴더 백업 import. mediaImport의 '🗂️ 폴더 백업' 옵션에서 호출.
  // 업로드 → 폴더 이름 입력 → importFolderDeep. 충돌 시 auto-suffix, 폴더 없으면 자동 생성.
  @action
  async folderBackupImport() {
    let file: File;
    try {
      file = (await getFirstFile('.tar,.tar.gz,.tgz')) as File;
    } catch {
      return;
    }
    const isTar = /\.(tar|tar\.gz|tgz)$/i.test(file.name);
    if (!isTar) {
      appState.pushMessage('.tar 파일만 받을 수 있습니다.');
      return;
    }
    const upid = appState.pushProgressDialog('폴더 백업 업로드 중...', 1);
    let tarPath: string;
    try {
      const base64: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e: any) => {
          const result = e.target?.result as string;
          resolve(result.split(',')[1] || result);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      tarPath = 'tmp/import_folder_' + Date.now() + '_' + file.name;
      await backend.writeDataFile(tarPath, base64);
      appState.finishProgressDialog(upid, '✓ 업로드 완료', true);
    } catch (e: any) {
      appState.finishProgressDialog(upid, '✗ 업로드 실패: ' + e.message, false);
      return;
    }
    const folderName = await appState.pushDialogAsync({
      type: 'input-confirm',
      text: '복원할 폴더 이름을 입력해주세요 (없으면 새로 생성)',
    });
    if (!folderName) return;
    const ipid = appState.pushProgressDialog('폴더 백업 복원 중...', 4);
    let result;
    try {
      result = await sessionService.importFolderDeep(
        tarPath,
        folderName as string,
        (text, done, total) => {
          appState.updateProgressDialog(ipid, { text, done, total });
        },
      );
    } catch (e: any) {
      appState.finishProgressDialog(
        ipid,
        '✗ 폴더 백업 임포트 실패: ' + (e?.message ?? e),
        false,
      );
      return;
    }
    let summary = `✓ 폴더 "${result.folder}" 복원 (${result.imported.length}개)`;
    if (result.renamed.length > 0) summary += ` · 이름변경 ${result.renamed.length}`;
    if (result.skipped.length > 0) summary += ` · 실패 ${result.skipped.length}`;
    appState.finishProgressDialog(ipid, summary, true);
    if (result.renamed.length > 0) {
      const preview = result.renamed
        .slice(0, 5)
        .map((r) => `${r.from} → ${r.to}`)
        .join('\n');
      const more =
        result.renamed.length > 5 ? `\n외 ${result.renamed.length - 5}건` : '';
      appState.pushMessage(`이름 충돌로 자동 변경:\n${preview}${more}`);
    }
    if (result.skipped.length > 0) {
      const preview = result.skipped
        .slice(0, 5)
        .map((r) => `${r.name}: ${r.reason}`)
        .join('\n');
      const more =
        result.skipped.length > 5 ? `\n외 ${result.skipped.length - 5}건` : '';
      appState.pushMessage(`복원 실패:\n${preview}${more}`);
    }
  }

  @action
  async projectImport() {
    // 프로젝트(.json)만 허용. .tar/.png 등 다른 파일은 거부.
    let file: File;
    try {
      file = (await getFirstFile('.json,application/json')) as File;
    } catch {
      return; // 사용자 취소
    }
    // iOS Safari가 .json에 빈 file.type을 주는 경우 → 확장자 fallback.
    const isJson = file.type === 'application/json' || /\.json$/i.test(file.name);
    if (!isJson) {
      appState.pushMessage('프로젝트 파일(.json)만 불러올 수 있습니다.');
      return;
    }
    appState.handleFile(file);
  }

  @action
  async mediaImport() {
    // 선택 다이얼로그로 형식 분기. 각 선택지가 해당 확장자만 accept.
    const choice = await appState.pushDialogAsync({
      type: 'select',
      text: '불러올 파일 형식을 선택하세요',
      items: [
        { text: '📦 프로젝트 백업 (.tar)', value: 'tar' },
        { text: '🗂️ 폴더 백업 (.tar)', value: 'folder-tar' },
        { text: '🖼️ 이미지 (.png) — 현재 프로젝트에 추가', value: 'png' },
      ],
    });
    if (!choice) return;
    if (choice === 'folder-tar') {
      await this.folderBackupImport();
      return;
    }
    let file: File;
    try {
      file = (await getFirstFile(
        choice === 'tar' ? '.tar,.tar.gz,.tgz' : '.png,image/png',
      )) as File;
    } catch {
      return;
    }
    if (choice === 'png') {
      const isPng = file.type === 'image/png' || /\.png$/i.test(file.name);
      if (!isPng) {
        appState.pushMessage('.png 파일만 받을 수 있습니다.');
        return;
      }
      appState.handleFile(file);
      return;
    }
    // choice === 'tar'
    const isTar = /\.(tar|tar\.gz|tgz)$/i.test(file.name);
    if (!isTar) {
      appState.pushMessage('.tar 파일만 받을 수 있습니다.');
      return;
    }
    appState.pushDialog({
      type: 'input-confirm',
      text: '새로운 프로젝트 이름을 입력해주세요',
      callback: async (inputValue) => {
        if (!inputValue) return;
        if (sessionService.list().includes(inputValue)) {
          appState.pushMessage('이미 존재하는 프로젝트 이름입니다.');
          return;
        }
        const upid = appState.pushProgressDialog('프로젝트 백업 업로드 중...', 1);
        let tarPath: string;
        try {
          const base64: string = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e: any) => {
              const result = e.target?.result as string;
              resolve(result.split(',')[1] || result);
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
          });
          tarPath = 'tmp/import_' + Date.now() + '_' + file.name;
          await backend.writeDataFile(tarPath, base64);
          appState.finishProgressDialog(upid, '✓ 업로드 완료', true);
        } catch (e: any) {
          appState.finishProgressDialog(upid, '✗ 업로드 실패: ' + e.message, false);
          return;
        }
        const ipid = appState.pushProgressDialog('프로젝트 백업을 불러오는 중...', 3);
        try {
          await sessionService.importSessionDeep(tarPath, inputValue, (text, done, total) => {
            appState.updateProgressDialog(ipid, { text, done, total });
          });
        } catch (e: any) {
          appState.finishProgressDialog(ipid, '✗ 임포트 실패: ' + e.message, false);
          return;
        }
        appState.finishProgressDialog(ipid, '✓ 프로젝트 백업을 불러왔습니다', true);
        const sess = await sessionService.get(inputValue);
        this.curSession = sess;
      },
    });
  }

  @action
  projectRename() {
    if (!appState.curSession) {
      appState.pushMessage('프로젝트를 먼저 선택해주세요');
      return;
    }
    if (appState.blockIfBusy()) return;
    appState.pushDialog({
      type: 'input-confirm',
      text: '새로운 프로젝트 이름을 입력해주세요',
      callback: async (inputValue) => {
        if (!inputValue) return;
        if (sessionService.list().includes(inputValue)) {
          appState.pushMessage('이미 존재하는 프로젝트 이름입니다.');
          return;
        }
        const oldName = appState.curSession!.name;
        await imageService.onRenameSession(oldName, inputValue);
        await sessionService.rename(oldName, inputValue);
        appState.curSession!.name = inputValue;
        appState.pushMessage('프로젝트 이름이 변경되었습니다.');
      },
    });
  }

  @action
  async projectToggleFavorite() {
    if (!appState.curSession) {
      appState.pushMessage('프로젝트를 먼저 선택해주세요');
      return;
    }
    await sessionService.toggleFavorite(appState.curSession.name);
    const isFav = sessionService.isFavorite(appState.curSession.name);
    appState.pushMessage(isFav ? '즐겨찾기에 추가되었습니다' : '즐겨찾기가 해제되었습니다');
  }
  async exportPackage(
    type: 'scene' | 'inpaint',
    selected?: GenericScene[],
    preset?: ExportPreset,
    session?: Session,
  ) {
    // 폴더 전체 내보내기 같이 curSession 외 다른 세션을 대상으로 호출하는
    // 경로용. 기본은 기존 동작과 동일 (this.curSession).
    const sess = session ?? this.curSession!;
    const exportImpl = async (
      prefix: string,
      fav: boolean,
      opt: string,
      imageSize: number,
      separator: string,
      charsToReplace: Set<string>,
    ) => {
      const items = await this.gatherExportItems(
        sess,
        type,
        selected,
        fav,
        opt,
        prefix,
        separator,
        charsToReplace,
      );
      if (items.length === 0) {
        appState.pushMessage('내보낼 이미지가 없어요');
        return;
      }
      // outFilePath: 단순화 (잡다구리 제거). 같은 path 재호출 시 서버에서
      // 덮어쓰기 — 의도적 재export 가정.
      const outFilePath = 'exports/' + sess.name + '.tar';
      const optimize: 'none' | 'lossy' | 'lossless' | 'avif' =
        opt === 'original' ? 'none' : (opt as 'lossy' | 'lossless' | 'avif');
      await this.enqueueExportJob(
        items,
        outFilePath,
        optimize,
        opt === 'original' ? 0 : imageSize,
      );
    };
    // 프리셋이 주어지면 다이얼로그 chain skip — 옵션 직접 사용해 즉시 실행.
    if (preset) {
      const prefix = preset.fileNameFormat === 'prefix' && preset.prefixName
        ? preset.prefixName + preset.separator
        : '';
      await exportImpl(
        prefix,
        preset.imageSelection === 'fav',
        preset.optimize,
        preset.imageSize,
        preset.separator || '.',
        new Set(preset.charsToReplace || []),
      );
      return;
    }
    // 프리셋 항목들 + fav/all (form 진입) + 설정 항목. 프리셋은 최대 3개.
    const presetItems = appState.exportPresets.slice(0, 3).map((p) => ({
      text: `★ ${p.name}${josaRo(p.name)} 내보내기`,
      value: `preset:${p.id}`,
    }));
    const menu = await appState.pushDialogAsync({
      type: 'select',
      text: '내보낼 이미지를 선택해주세요',
      items: [
        ...presetItems,
        { text: '즐겨찾기 이미지만', value: 'fav' },
        { text: '모든 이미지', value: 'all' },
        { text: '⚙️ 내보내기 프리셋 설정', value: 'settings' },
      ],
    });
    if (!menu) return;
    if (menu === 'settings') {
      appState.openExportPresetsDialog(type);
      return;
    }
    if (typeof menu === 'string' && menu.startsWith('preset:')) {
      const presetId = menu.slice('preset:'.length);
      const preset = appState.exportPresets.find((p) => p.id === presetId);
      if (preset) {
        // 프리셋 즉시 적용. 재귀 호출로 다이얼로그 chain skip.
        return this.exportPackage(type, selected, preset);
      }
      return;
    }

    // fav/all → 일회용 옵션 폼 (chain 폐기). imageSelection 미리 채움.
    const opts = await appState.openExportOptionsForm({
      imageSelection: menu === 'fav' ? 'fav' : 'all',
    });
    if (!opts) return;
    const prefix = opts.fileNameFormat === 'prefix' && opts.prefixName
      ? opts.prefixName + opts.separator
      : '';
    await exportImpl(
      prefix,
      opts.imageSelection === 'fav',
      opts.optimize,
      opts.imageSize,
      opts.separator || '.',
      new Set(opts.charsToReplace || []),
    );
  }

  // 한 세션의 export item 수집. exportPackage / exportFolder 공통 helper.
  // 결과: [{ srcPath, finalName }] — finalName은 caller가 prefix 추가 가능.
  private async gatherExportItems(
    session: Session,
    type: 'scene' | 'inpaint',
    selected: GenericScene[] | undefined,
    fav: boolean,
    opt: string,
    prefix: string,
    separator: string,
    charsToReplace: Set<string>,
  ): Promise<Array<{ srcPath: string; finalName: string }>> {
    const items: Array<{ srcPath: string; finalName: string }> = [];
    await imageService.refreshBatch(session);
    const finalExt = opt === 'original' ? '.png' : (opt === 'avif' ? '.avif' : '.webp');
    const scenes = selected ?? session.getScenes(type);
    const replacer = buildSpecialCharReplacer(charsToReplace);
    for (const scene of scenes) {
      await gameService.refreshList(session, scene);
      const cands = gameService.getOutputs(session, scene);
      const imageMap: any = {};
      cands.forEach((x) => { imageMap[x] = true; });
      const images: string[] = [];
      if (fav) {
        if (scene.mains.length) {
          for (const main of scene.mains) {
            if (imageMap[main]) images.push(main);
          }
        } else if (cands.length) {
          images.push(cands[0]);
        }
      } else {
        for (const cand of cands) images.push(cand);
      }
      let sceneName = scene.name;
      let finalPrefix = prefix;
      if (replacer) {
        sceneName = sceneName.replace(replacer, separator);
        finalPrefix = finalPrefix.replace(replacer, separator);
      }
      const isMirror = scene.type === 'inpaint' && (scene as InpaintScene).workflowType === 'SDMirror';
      const mirrorCropX = isMirror ? (scene as InpaintScene).mirrorCropX : 0;
      const baseDir = imageService.getOutputDir(session, scene);
      // SDMirror: fetchImage + crop + writeDataFile per image — 직렬 시 N×지연. 청크 4 병렬화.
      // 일반 (mirror 아님): IO 없이 path 빌드만이라 직렬 그대로.
      const CHUNK = isMirror ? 4 : images.length;
      const built: Array<{ srcPath: string; finalName: string } | null> = new Array(images.length);
      for (let i = 0; i < images.length; i += CHUNK) {
        const slice = images.slice(i, i + CHUNK);
        await Promise.all(slice.map(async (image, k) => {
          const idx = i + k;
          let srcPath = baseDir + '/' + image;
          if (isMirror) {
            const imgData = await imageService.fetchImage(srcPath);
            if (imgData) {
              const cropped = await cropMirrorResultFromDataUri(imgData, mirrorCropX);
              const tmpPath = 'tmp/' + v4() + '.png';
              await backend.writeDataFile(tmpPath, cropped);
              srcPath = tmpPath;
            }
          }
          const baseName = images.length === 1
            ? finalPrefix + sceneName
            : finalPrefix + sceneName + separator + (idx + 1).toString();
          built[idx] = { srcPath, finalName: baseName + finalExt };
        }));
      }
      for (const it of built) if (it) items.push(it);
    }
    return items;
  }

  // 큐 등록 + WS 구독 + widget 추가. exportPackage / exportFolder 공통 helper.
  // 즉시 202 후 백그라운드 진행. resize/zip/Drive sync는 server 측 export
  // pipeline이 처리.
  private async enqueueExportJob(
    items: Array<{ srcPath: string; finalName: string }>,
    outFilePath: string,
    optimize: 'none' | 'lossy' | 'lossless' | 'avif',
    imageSize: number,
  ): Promise<string | null> {
    const pid = appState.pushProgressDialog('이미지 내보내기 큐 등록 중...', 1);
    let jobId: string | null = null;
    try {
      const result = await backend.startExportScenePack({
        paths: items,
        outFilePath,
        optimize,
        imageSize,
      });
      jobId = result.queued ? result.jobId : null;
    } catch (e: any) {
      console.warn('[enqueueExportJob] startExportScenePack threw:', e);
    }
    appState.finishProgressDialog(
      pid,
      jobId
        ? '✓ 이미지 내보내기 큐 등록 (서버 백그라운드)'
        : '✗ 이미지 내보내기 큐 등록 실패',
      !!jobId,
    );
    if (!jobId) return null;

    const outFileName = outFilePath.split('/').pop()!;
    appState.exportPipelineJobs = [
      ...appState.exportPipelineJobs,
      { jobId, phase: 'queued', done: 0, total: items.length, outFileName },
    ];
    const removeFromWidget = () => {
      appState.exportPipelineJobs = appState.exportPipelineJobs.filter((j) => j.jobId !== jobId);
    };

    const unsubs: Array<() => void> = [];
    const cleanup = () => unsubs.forEach((u) => u());
    let exportTerminal = false;
    let driveTerminal = false;
    const tryFullCleanup = () => {
      if (exportTerminal && driveTerminal) cleanup();
    };
    unsubs.push(backend.onExportProgress((data) => {
      if (exportTerminal || data.jobId !== jobId) return;
      appState.exportPipelineJobs = appState.exportPipelineJobs.map((j) =>
        j.jobId === jobId
          ? { ...j, phase: data.phase, done: data.done, total: data.total }
          : j,
      );
    }));
    unsubs.push(backend.onExportComplete((data) => {
      if (exportTerminal || data.jobId !== jobId) return;
      exportTerminal = true;
      removeFromWidget(); // tar 생성 완료 → 이후는 driveRetry가 인계
      appState.refreshDriveRetryStatus();
      if (data.skipped && data.skipped.length > 0) {
        const preview = data.skipped.slice(0, 3).map((p) => p.split('/').pop()).join(', ');
        const more = data.skipped.length > 3 ? ` 외 ${data.skipped.length - 3}개` : '';
        appState.pushMessage(`${data.skipped.length}개 파일 누락 — 자동 제외 (${preview}${more})`);
      }
      // Drive 미사용자: zip이 Drive에 안 올라가니까 브라우저 자동 다운로드로 사용자 손에 전달.
      // Drive 사용자가 'Drive 앱에 파일 떨어짐' 받는 것과 거의 동등한 경험.
      // export 시작한 탭만 이 handler 등록(jobId scope)이라 멀티 탭 중복 다운로드 없음.
      if (appState.driveRetryStatus?.driveAvailable === false) {
        backend.copyToDownloads(data.outFilePath).catch(() => {});
        const fileName = data.outFilePath.split('/').pop() || 'export.tar';
        appState.pushMessage(`✓ 내보내기 완료 — 다운로드 시작 (${fileName})`);
        driveTerminal = true; // Drive sync 경로 없음. 함께 종료.
      }
      tryFullCleanup();
    }));
    unsubs.push(backend.onExportFailed((data) => {
      if (exportTerminal || data.jobId !== jobId) return;
      exportTerminal = true;
      driveTerminal = true; // Drive sync 미진행이므로 함께 종료
      removeFromWidget();
      appState.pushMessage(`✗ 이미지 내보내기 실패 (${data.phase}): ${data.error}`);
      cleanup();
    }));
    unsubs.push(backend.onDriveSyncComplete((data) => {
      if (driveTerminal || data.requestedPath !== outFilePath) return;
      driveTerminal = true;
      appState.pushMessage(`✓ 이미지 Drive 업로드 완료 (${data.fileName})`);
      appState.refreshDriveRetryStatus();
      tryFullCleanup();
    }));
    unsubs.push(backend.onDriveSyncFailed((data) => {
      if (driveTerminal || data.requestedPath !== outFilePath) return;
      if (data.willRetry) {
        appState.refreshDriveRetryStatus();
        return;
      }
      driveTerminal = true;
      appState.pushMessage(`✗ 이미지 Drive 최종 실패: ${data.fileName} (${data.error})`);
      appState.refreshDriveRetryStatus();
      tryFullCleanup();
    }));
    setTimeout(cleanup, 30 * 60 * 1000);
    return jobId;
  }

  // 폴더 단위 일괄 내보내기. 폴더 안 모든 프로젝트(scene)의 이미지를 1개 zip으로
  // 묶음. zip 안 sub-directory로 프로젝트별 분리. outFilePath는 폴더명만.
  // path 수집은 CHUNK=4 병렬, 큐 등록은 1번.
  async exportFolder(folderName: string, projectNames: string[]) {
    if (projectNames.length === 0) {
      appState.pushMessage('빈 폴더예요');
      return;
    }

    // 프리셋 list + "새 옵션" 항목. 프리셋 0개여도 form 진입 가능.
    const items = [
      ...this.exportPresets.map((p) => ({
        text: `★ ${p.name} 적용`,
        value: `preset:${p.id}`,
      })),
      { text: '⚙️ 새 옵션으로 내보내기', value: 'form' },
    ];
    const choice = await appState.pushDialogAsync({
      type: 'select',
      text: `'${folderName}' 폴더의 ${projectNames.length}개 프로젝트에 적용할 옵션`,
      items,
    });
    if (!choice) return;

    let preset: ExportPreset | undefined;
    if (choice === 'form') {
      const opts = await appState.openExportOptionsForm();
      if (!opts) return;
      preset = opts;
    } else if (choice.startsWith('preset:')) {
      const presetId = choice.slice('preset:'.length);
      preset = this.exportPresets.find((p) => p.id === presetId);
    }
    if (!preset) return;

    // 프리셋 → exportImpl 옵션 변환
    const fav = preset.imageSelection === 'fav';
    const opt = preset.optimize;
    const imageSize = preset.imageSize;
    const separator = preset.separator || '.';
    const charsToReplace = new Set(preset.charsToReplace || []);
    const prefix = preset.fileNameFormat === 'prefix' && preset.prefixName
      ? preset.prefixName + separator
      : '';

    const total = projectNames.length;
    const pid = appState.pushProgressDialog(
      `'${folderName}' path 수집 중... 0/${total}`,
      total,
    );

    // 1단계: N개 프로젝트 path 수집 (CHUNK=4 병렬). finalName 앞에 프로젝트명 sub-dir.
    const allItems: Array<{ srcPath: string; finalName: string }> = [];
    const failures: { name: string; reason: string }[] = [];
    const CHUNK = 4;
    for (let i = 0; i < projectNames.length; i += CHUNK) {
      const chunk = projectNames.slice(i, i + CHUNK);
      const results = await Promise.all(
        chunk.map(async (name) => {
          try {
            const session = await sessionService.get(name, { throwOnError: true });
            if (!session) {
              return { name, error: '세션 객체 로드 실패' as string };
            }
            const items = await this.gatherExportItems(
              session, 'scene', undefined, fav, opt, prefix, separator, charsToReplace,
            );
            return {
              name,
              items: items.map((it) => ({
                srcPath: it.srcPath,
                finalName: name + '/' + it.finalName,
              })),
            };
          } catch (e: any) {
            return { name, error: (e?.message ?? String(e)) as string };
          }
        }),
      );
      for (const r of results) {
        if ('error' in r) failures.push({ name: r.name, reason: r.error });
        else allItems.push(...r.items);
      }
      const done = Math.min(i + CHUNK, total);
      appState.updateProgressDialog(pid, {
        done,
        text: `'${folderName}' path 수집 중... ${done}/${total}`,
      });
    }

    if (allItems.length === 0) {
      appState.finishProgressDialog(pid, '내보낼 이미지가 없어요', false);
      if (failures.length > 0) {
        const preview = failures.slice(0, 3).map((f) => `${f.name}: ${f.reason}`).join('\n');
        const more = failures.length > 3 ? `\n외 ${failures.length - 3}건` : '';
        appState.pushMessage(`수집 실패 항목:\n${preview}${more}`);
      }
      return;
    }

    const successProjects = total - failures.length;
    appState.finishProgressDialog(
      pid,
      `✓ '${folderName}' path 수집 완료 (${successProjects}/${total} 프로젝트, ${allItems.length}장)`,
      true,
    );

    // 2단계: 1번 큐 등록. outFilePath = exports/{folderName}.tar
    const outFilePath = 'exports/' + folderName + '.tar';
    const optimize: 'none' | 'lossy' | 'lossless' | 'avif' =
      opt === 'original' ? 'none' : (opt as 'lossy' | 'lossless' | 'avif');
    await this.enqueueExportJob(
      allItems,
      outFilePath,
      optimize,
      opt === 'original' ? 0 : imageSize,
    );

    if (failures.length > 0) {
      const preview = failures.slice(0, 3).map((f) => `${f.name}: ${f.reason}`).join('\n');
      const more = failures.length > 3 ? `\n외 ${failures.length - 3}건` : '';
      appState.pushMessage(`수집 실패 항목:\n${preview}${more}`);
    }
  }

  // 단일 프로젝트 이미지 일괄 export. SessionTreePicker 프로젝트 점세개 메뉴 진입점 —
  // 프로젝트를 열지 않고도 옵션 chain → exports/{name}.tar 산출. 폴더 export와 동일한
  // preset/form 흐름이지만 단일이라 다이얼로그 텍스트와 finalName sub-dir만 다름.
  async exportProjectImages(projectName: string) {
    const items = [
      ...this.exportPresets.map((p) => ({
        text: `★ ${p.name} 적용`,
        value: `preset:${p.id}`,
      })),
      { text: '⚙️ 새 옵션으로 내보내기', value: 'form' },
    ];
    const choice = await appState.pushDialogAsync({
      type: 'select',
      text: `'${projectName}' 프로젝트 이미지에 적용할 옵션`,
      items,
    });
    if (!choice) return;

    let preset: ExportPreset | undefined;
    if (choice === 'form') {
      const opts = await appState.openExportOptionsForm();
      if (!opts) return;
      preset = opts;
    } else if (choice.startsWith('preset:')) {
      const presetId = choice.slice('preset:'.length);
      preset = this.exportPresets.find((p) => p.id === presetId);
    }
    if (!preset) return;

    const fav = preset.imageSelection === 'fav';
    const opt = preset.optimize;
    const imageSize = preset.imageSize;
    const separator = preset.separator || '.';
    const charsToReplace = new Set(preset.charsToReplace || []);
    const prefix = preset.fileNameFormat === 'prefix' && preset.prefixName
      ? preset.prefixName + separator
      : '';

    const pid = appState.pushProgressDialog(
      `'${projectName}' path 수집 중...`,
      1,
    );

    let allItems: Array<{ srcPath: string; finalName: string }> = [];
    try {
      const session = await sessionService.get(projectName, { throwOnError: true });
      if (!session) {
        appState.finishProgressDialog(pid, '세션 객체 로드 실패', false);
        return;
      }
      const collected = await this.gatherExportItems(
        session, 'scene', undefined, fav, opt, prefix, separator, charsToReplace,
      );
      allItems = collected.map((it) => ({
        srcPath: it.srcPath,
        finalName: it.finalName,
      }));
    } catch (e: any) {
      appState.finishProgressDialog(pid, `수집 실패: ${e?.message ?? e}`, false);
      return;
    }

    if (allItems.length === 0) {
      appState.finishProgressDialog(pid, '내보낼 이미지가 없어요', false);
      return;
    }

    appState.finishProgressDialog(
      pid,
      `✓ '${projectName}' path 수집 완료 (${allItems.length}장)`,
      true,
    );

    const outFilePath = 'exports/' + projectName + '.tar';
    const optimize: 'none' | 'lossy' | 'lossless' | 'avif' =
      opt === 'original' ? 'none' : (opt as 'lossy' | 'lossless' | 'avif');
    await this.enqueueExportJob(
      allItems,
      outFilePath,
      optimize,
      opt === 'original' ? 0 : imageSize,
    );
  }

  async exportPreset(session: Session, preset: any) {
    try {
      let pngData;
      if (preset.profile) {
        const vibeImage = await imageService.fetchVibeImage(session, preset.profile);
        const base64 = vibeImage ? dataUriToBase64(vibeImage) : null;
        // PNG base64는 반드시 iVBOR로 시작 (PNG 시그니처 89 50 4E 47)
        if (base64 && base64.startsWith('iVBOR')) {
          pngData = base64;
        } else {
          pngData = await createImageWithText(832, 1216, preset.name);
        }
      } else {
        pngData = await createImageWithText(832, 1216, preset.name);
      }
      const newPngData = embedJSONInPNG(pngData, preset);
      const path =
        'exports/' + preset.name + '_' + Date.now().toString() + '.png';
      await backend.writeDataFile(path, newPngData);
      await backend.showFile(path);
    } catch (e: any) {
      appState.pushMessage('프리셋 내보내기 실패: ' + (e.message || e));
    }
  }

  // ---------------- PNG 임포트 분기 ----------------

  /**
   * PNG base64 데이터를 받아서 사용자에게 임포트 방식을 물어본다.
   * - 메타데이터에 유효한 프리셋이 있고 글로벌 지원 타입이면:
   *     [현재 세션으로 / 글로벌 프리셋으로 / 프롬프트만 추출]
   * - 프리셋이 있지만 글로벌 지원 외 타입이면:
   *     [현재 세션으로 / 프롬프트만 추출]
   * - 프리셋이 없으면 기존대로 externalImage (프롬프트 추출 뷰)
   */
  async handlePngImport(base64: string): Promise<void> {
    if (!this.curSession) return;
    const session = this.curSession;

    let meta: any = null;
    try {
      meta = readJSONFromPNG(base64);
    } catch (e) {
      meta = null;
    }

    if (meta) {
      meta = normalizePresetJson(meta);
    }

    const hasPreset = !!(meta && meta.type && meta.name);
    const isGlobalSupported =
      hasPreset &&
      (SUPPORTED_GLOBAL_PRESET_TYPES as readonly string[]).includes(meta.type);

    if (!hasPreset) {
      // 프리셋 메타 없음 → 프롬프트 추출 뷰로
      this.externalImage = base64;
      return;
    }

    const items: { text: string; value: string }[] = [
      {
        text: `현재 세션의 프리셋으로 가져오기`,
        value: 'session',
      },
    ];
    if (isGlobalSupported) {
      items.push({
        text: '글로벌 프리셋으로 저장',
        value: 'global',
      });
    }
    items.push({
      text: '프롬프트만 추출 (프리셋 저장 안 함)',
      value: 'extract',
    });

    const presetLabel = meta.name ? `"${meta.name}" ` : '';
    const typeLabel = isGlobalSupported
      ? meta.type === 'SDImageGenEasy'
        ? ' (그림체 이지모드)'
        : ' (그림체)'
      : ` (${meta.type})`;

    this.pushDialog({
      type: 'select',
      text: `이미지에서 ${presetLabel}프리셋${typeLabel}${josaEulReul(typeLabel)} 발견했습니다.\n어떻게 가져올까요?`,
      items,
      callback: async (option?: string) => {
        if (!option) return;
        if (option === 'session') {
          try {
            const preset = await importPreset(session, base64);
            if (preset) {
              session.selectedWorkflow = {
                workflowType: preset.type,
                presetName: preset.name,
              };
              this.pushDialog({
                type: 'yes-only',
                text: `"${preset.name}" 프리셋을 현재 세션에 가져왔습니다.`,
              });
            } else {
              this.externalImage = base64;
            }
          } catch (e: any) {
            this.pushMessage('세션 임포트 실패: ' + (e.message || e));
          }
        } else if (option === 'global') {
          try {
            const entry = await globalPresetService.importFromPng(base64);
            if (entry) {
              this.pushDialog({
                type: 'yes-only',
                text: `"${entry.name}" 프리셋을 글로벌 프리셋에 저장했습니다.`,
              });
            } else {
              this.pushMessage('글로벌 프리셋 저장 실패: 유효하지 않은 메타데이터');
            }
          } catch (e: any) {
            this.pushMessage('글로벌 프리셋 저장 실패: ' + (e.message || e));
          }
        } else if (option === 'extract') {
          this.externalImage = base64;
        }
      },
    });
  }

  // ---------------- 글로벌 프리셋 헬퍼 ----------------

  async exportPresetToGlobal(session: Session, preset: any): Promise<void> {
    try {
      const entry = await globalPresetService.addFromSessionPreset(
        session,
        preset,
      );
      this.pushMessage(`글로벌 프리셋에 추가: ${entry.name}`);
    } catch (e: any) {
      this.pushMessage('글로벌로 내보내기 실패: ' + (e.message || e));
    }
  }

  async importGlobalPresetIntoSession(
    session: Session,
    globalId: string,
  ): Promise<void> {
    try {
      const preset = await globalPresetService.instantiateIntoSession(
        session,
        globalId,
      );
      if (preset) {
        session.selectedWorkflow = {
          workflowType: preset.type,
          presetName: preset.name,
        };
        this.pushMessage(`세션에 추가: ${preset.name}`);
      }
    } catch (e: any) {
      this.pushMessage('가져오기 실패: ' + (e.message || e));
    }
  }

  @observable accessor globalPresetPicker:
    | { workflowType: GlobalPresetType; onSelect: (id: string) => void }
    | undefined = undefined;

  @action
  openGlobalPresetPicker(workflowType: GlobalPresetType): void {
    if (!this.curSession) {
      this.pushMessage('세션을 먼저 선택해주세요.');
      return;
    }
    const session = this.curSession;
    this.globalPresetPicker = {
      workflowType,
      onSelect: async (id: string) => {
        this.globalPresetPicker = undefined;
        await this.importGlobalPresetIntoSession(session, id);
      },
    };
  }

  @action
  closeGlobalPresetPicker(): void {
    this.globalPresetPicker = undefined;
  }

  async exportGlobalPresetToPng(entry: IGlobalPresetEntry): Promise<void> {
    try {
      const path =
        'exports/' + entry.name + '_' + Date.now().toString() + '.png';
      await globalPresetService.exportToPng(entry.id, path);
      await backend.showFile(path);
    } catch (e: any) {
      this.pushMessage('내보내기 실패: ' + (e.message || e));
    }
  }

  @action
  openBatchProcessMenu(
    type: 'scene' | 'inpaint',
    setBatchPicker: (item: BatchPickerItem | undefined) => void,
  ) {
    const removeBg = async (selected: GenericScene[]) => {
      if (!localAIService.ready) {
        appState.pushMessage('환경설정에서 배경 제거 기능을 활성화해주세요');
        return;
      }
      for (const scene of selected) {
        if (scene.mains.length === 0) {
          const images = gameService.getOutputs(this.curSession!, scene);
          if (!images.length) continue;
          let image = await imageService.fetchImage(
            imageService.getOutputDir(this.curSession!, scene) +
              '/' +
              images[0],
          );
          image = dataUriToBase64(image!);
          queueRemoveBg(this.curSession!, scene, image);
        } else {
          const mains = scene.mains;
          for (const main of mains) {
            const path =
              imageService.getOutputDir(this.curSession!, scene) + '/' + main;
            let image = await imageService.fetchImage(path);
            image = dataUriToBase64(image!);
            queueRemoveBg(this.curSession!, scene, image, (newPath: string) => {
              for (let j = 0; j < scene.mains.length; j++) {
                if (scene.mains[j] === main) {
                  scene.mains[j] = newPath.split('/').pop()!;
                  break;
                }
              }
            });
          }
        }
      }
    };

    const deleteScenes = async (selected: GenericScene[]) => {
      if (appState.blockIfBusy()) return;
      appState.pushDialog({
        type: 'confirm',
        text: `정말로 선택한 ${selected.length}개의 씬을 삭제하시겠습니까? (휴지통으로 이동)`,
        callback: async () => {
          const { trashService } = await import('.');
          const session = this.curSession!;
          const total = selected.length;
          const pid = appState.pushProgressDialog(`씬 삭제 중... 0/${total}`, total);
          // fire-and-forget: dialog 콜백 즉시 끝내고 백그라운드에서 진행 → 사용자 다른 작업 가능
          (async () => {
            const CHUNK = 4;
            let done = 0;
            let failed = 0;
            for (let i = 0; i < selected.length; i += CHUNK) {
              const chunk = selected.slice(i, i + CHUNK);
              await Promise.all(
                chunk.map(async (scene) => {
                  try {
                    await trashService.moveSceneToTrash(session, scene, { defer: true });
                  } catch (e) {
                    console.error('씬 삭제 실패:', scene.name, e);
                    failed++;
                  }
                }),
              );
              done = Math.min(i + CHUNK, total);
              appState.updateProgressDialog(pid, {
                done,
                text: `씬 삭제 중... ${done}/${total}`,
              });
            }
            // 모든 mutate 끝난 뒤 한 번만 trash.json save (parallel write race 회피)
            try {
              await trashService.saveTrash();
            } catch (e) {
              console.error('trash.json 저장 실패:', e);
              failed++;
            }
            const success = total - failed;
            if (failed === 0) {
              appState.finishProgressDialog(pid, `✓ ${success}개 씬 휴지통 이동 완료`, true);
            } else {
              appState.finishProgressDialog(
                pid,
                `△ ${success}/${total} 성공 (${failed}건 실패)`,
                false,
              );
            }
          })();
        },
      });
    };

    const cancelAllReservations = async (selected: GenericScene[]) => {
      let totalCancelled = 0;
      for (const scene of selected) {
        const stats = taskQueueService.statsTasksFromScene(this.curSession!, scene);
        const remaining = stats.total - stats.done;
        totalCancelled += remaining;
        taskQueueService.removeTasksFromScene(this.curSession!, scene);
      }
      appState.pushDialog({
        type: 'yes-only',
        text: `${selected.length}개 씬에서 총 ${totalCancelled}개의 예약이 취소되었습니다.`,
      });
    };

    const handleBatchProcess = async (
      value: string,
      selected: GenericScene[],
    ) => {
      const isMain = (scene: GenericScene, path: string) => {
        const filename = path.split('/').pop()!;
        return !!(scene && scene.mains.includes(filename));
      };
      // 대량 삭제는 server 큐가 새 .png를 디스크에 떨어뜨리는 동안 paths를
      // 휩쓸 수 있어 race가 발생함. 큐를 잠시 멈추고 in-flight job 완료 후
      // paths capture + 삭제 진행.
      const withQueuePaused = async (fn: () => Promise<void>) => {
        await backend.pauseQueue();
        try {
          await fn();
        } finally {
          try { await backend.resumeQueue(); } catch {}
        }
      };
      const runBatchImageDelete = (
        buildPaths: (scene: GenericScene) => string[],
      ) => {
        const session = this.curSession!;
        const total = selected.length;
        const pid = appState.pushProgressDialog(`이미지 삭제 중... 0/${total}`, total);
        (async () => {
          let failed = 0;
          try {
            await withQueuePaused(async () => {
              const CHUNK = 4;
              for (let i = 0; i < selected.length; i += CHUNK) {
                const chunk = selected.slice(i, i + CHUNK);
                await Promise.all(
                  chunk.map(async (scene) => {
                    try {
                      const paths = buildPaths(scene);
                      if (paths.length > 0) {
                        await deleteImageFiles(session, paths, scene);
                      }
                    } catch (e) {
                      console.error('이미지 삭제 실패:', scene.name, e);
                      failed++;
                    }
                  }),
                );
                const done = Math.min(i + CHUNK, total);
                appState.updateProgressDialog(pid, {
                  done,
                  text: `이미지 삭제 중... ${done}/${total}`,
                });
              }
            });
          } catch (e) {
            console.error('이미지 일괄 삭제 배치 실패:', e);
            failed++;
          }
          const success = total - failed;
          if (failed === 0) {
            appState.finishProgressDialog(pid, `✓ ${success}개 씬 이미지 삭제 완료`, true);
          } else {
            appState.finishProgressDialog(
              pid,
              `△ ${success}/${total} 성공 (${failed}건 실패)`,
              false,
            );
          }
        })();
      };
      if (value === 'removeImage') {
        if (appState.blockIfBusy()) return;
        appState.pushDialog({
          type: 'select',
          text: '이미지를 삭제합니다. 원하시는 작업을 선택해주세요.',
          items: [
            {
              text: '모든 이미지 삭제',
              value: 'all',
            },
            {
              text: '즐겨찾기 제외 모든 이미지 삭제',
              value: 'fav',
            },
            {
              text: '즐겨찾기 제외 n등 이하 이미지 삭제',
              value: 'n',
            },
          ],
          callback: async (menu) => {
            if (menu === 'all') {
              appState.pushDialog({
                type: 'confirm',
                text: '정말로 모든 이미지를 삭제하시겠습니까?',
                callback: async () => {
                  runBatchImageDelete((scene) =>
                    gameService
                      .getOutputs(this.curSession!, scene)
                      .map(
                        (x) =>
                          imageService.getOutputDir(this.curSession!, scene!) +
                          '/' +
                          x,
                      ),
                  );
                },
              });
            } else if (menu === 'n') {
              appState.pushDialog({
                type: 'input-confirm',
                text: '몇등 이하 이미지를 삭제할지 입력해주세요.',
                callback: async (value) => {
                  if (!value) return;
                  const n = parseInt(value);
                  runBatchImageDelete((scene) =>
                    gameService
                      .getOutputs(this.curSession!, scene)
                      .map(
                        (x) =>
                          imageService.getOutputDir(this.curSession!, scene!) +
                          '/' +
                          x,
                      )
                      .slice(n)
                      .filter((x) => !isMain(scene, x)),
                  );
                },
              });
            } else if (menu === 'fav') {
              appState.pushDialog({
                type: 'confirm',
                text: '정말로 즐겨찾기 외 모든 이미지를 삭제하시겠습니까?',
                callback: async () => {
                  runBatchImageDelete((scene) =>
                    gameService
                      .getOutputs(this.curSession!, scene)
                      .map(
                        (x) =>
                          imageService.getOutputDir(this.curSession!, scene!) +
                          '/' +
                          x,
                      )
                      .filter((x) => !isMain(scene, x)),
                  );
                },
              });
            }
          },
        });
      } else if (value === 'removeAllFav') {
        appState.pushDialog({
          type: 'confirm',
          text: '정말로 모든 즐겨찾기를 해제하겠습니까?',
          callback: () => {
            for (const scene of selected) {
              scene.mains = [];
            }
          },
        });
      } else if (value === 'setFav') {
        appState.pushDialog({
          type: 'input-confirm',
          text: '몇등까지 즐겨찾기로 지정할지 입력해주세요',
          callback: async (value) => {
            if (value) {
              const n = parseInt(value);
              for (const scene of selected) {
                const cands = gameService
                  .getOutputs(this.curSession!, scene)
                  .slice(0, n);
                scene.mains = scene.mains
                  .concat(cands)
                  .filter((x, i, self) => self.indexOf(x) === i);
              }
            }
          },
        });
      } else if (value === 'removeBg') {
        removeBg(selected);
      } else if (value === 'deleteScenes') {
        deleteScenes(selected);
      } else if (value === 'cancelReservations') {
        cancelAllReservations(selected);
      } else if (value === 'export') {
        this.exportPackage(type, selected);
      } else if (value === 'transform') {
        const items = oneTimeFlows.map((x) => ({
          text: x.text,
          value: x.text,
        }));
        const menu = await appState.pushDialogAsync({
          text: '이미지 변형 방법을 선택하세요',
          type: 'select',
          items: items,
        });
        if (!menu) return;
        const menuItem = oneTimeFlowMap.get(menu)!;
        const input = menuItem.getInput
          ? await menuItem.getInput(this.curSession!)
          : undefined;
        // (scene, path) 쌍으로 flatten — chunk parallel 단위
        type Pair = { scene: GenericScene; path: string };
        const pairs: Pair[] = [];
        for (const scene of selected) {
          for (const main of scene.mains) {
            pairs.push({
              scene,
              path: imageService.getOutputDir(this.curSession!, scene) + '/' + main,
            });
          }
        }
        const total = pairs.length;
        if (total === 0) return;
        const pid = appState.pushProgressDialog(
          `이미지 변형 큐 등록 중... 0/${total}`,
          total,
        );
        // fire-and-forget: 다른 작업 가능
        (async () => {
          const CHUNK = 4;
          let failed = 0;
          for (let i = 0; i < pairs.length; i += CHUNK) {
            const chunk = pairs.slice(i, i + CHUNK);
            await Promise.all(
              chunk.map(async ({ scene, path }) => {
                try {
                  let image = await imageService.fetchImage(path);
                  image = dataUriToBase64(image!);
                  const job = await extractPromptDataFromBase64(image);
                  menuItem.handler(
                    appState.curSession!,
                    scene,
                    image,
                    undefined,
                    job,
                    input,
                  );
                } catch (e) {
                  console.error('[transform] failed:', scene.name, path, e);
                  failed++;
                }
              }),
            );
            const done = Math.min(i + CHUNK, total);
            appState.updateProgressDialog(pid, {
              done,
              text: `이미지 변형 큐 등록 중... ${done}/${total}`,
            });
          }
          const success = total - failed;
          if (failed === 0) {
            appState.finishProgressDialog(
              pid,
              `✓ ${success}개 이미지 변형 큐 등록 완료`,
              true,
            );
          } else {
            appState.finishProgressDialog(
              pid,
              `△ ${success}/${total} 성공 (${failed}건 실패)`,
              false,
            );
          }
        })();
      } else if (value === 'exportSceneNames') {
        // 씬 이름에서 특수문자 구분자 감지
        const detectedChars = detectSpecialChars(selected);

        let charsToReplace = new Set<string>();
        let replacement = '_';
        if (detectedChars.size > 0) {
          const r = await appState.openSceneNameExportFormAsync(detectedChars);
          if (!r) return;
          replacement = r.replacement || '_';
          charsToReplace = r.charsToReplace;
        }

        const replacer = buildSpecialCharReplacer(charsToReplace);
        // 백틱으로 감싸 각 씬 이름 경계 명시 (특수문자 포함되어도 시각적 구분 명확).
        const wrap = (s: string) => '`' + s + '`';
        const names = (
          replacer
            ? selected.map((s) => wrap(s.name.replace(replacer, replacement)))
            : selected.map((s) => wrap(s.name))
        ).join(', ');
        const path = 'exports/scene_names_' + Date.now().toString() + '.txt';
        await backend.writeFile(path, names);
        const pid = appState.pushProgressDialog('Drive 업로드 중 (씬 이름)...', 1);
        await syncExportToDrive({
          path,
          pid,
          successLabel: `✓ ${selected.length}개 씬 이름 Drive 업로드 완료`,
          logTag: 'exportSceneNames',
        });
      } else if (value === 'mergeScenes') {
        if (selected.length < 2) {
          appState.pushMessage('통합할 씬을 2개 이상 선택해주세요');
          return;
        }
        // 이름 결정: 직접 적기 + 선택된 씬 이름 중 최대 5개
        const nameItems = [
          { text: '✍️ 직접 적기 (새 이름)', value: 'custom' },
          ...selected.slice(0, 5).map((s, i) => ({
            text: s.name,
            value: 'use:' + i,
          })),
        ];
        const performMerge = (newName: string) => {
          newName = (newName || '').trim();
          if (!newName) {
            appState.pushMessage('이름이 비어있습니다');
            return;
          }
          const selectedNameSet = new Set(selected.map((s) => s.name));
          // 새 이름이 선택 안 한 다른 씬과 충돌하면 거부
          if (!selectedNameSet.has(newName) && this.curSession!.hasScene(type, newName)) {
            appState.pushMessage('이미 존재하는 씬 이름입니다 (선택 안 한 씬과 충돌)');
            return;
          }
          appState.pushDialog({
            type: 'confirm',
            text:
              `선택한 ${selected.length}개 씬을 "${newName}"로 통합합니다.\n` +
              `조합 슬롯 + 이미지 + 즐겨찾기가 합쳐지고, 원본 씬들은 삭제됩니다.\n` +
              `(정확히 같은 조합 슬롯은 중복 제거)`,
            callback: async () => {
              const pid = appState.pushProgressDialog('씬 통합 중...', 1);
              try {
                const sessionName = this.curSession!.name;
                const newDir = 'outs/' + sessionName + '/' + newName;
                // 1. slots dedup (정확히 같은 JSON은 중복 제거)
                const allSlotsRaw: any[] = [];
                const allCharPrompts: any[] = [];
                for (const s of selected) {
                  const j: any = (s as any).toJSON();
                  if (Array.isArray(j.slots)) allSlotsRaw.push(...j.slots);
                  if (Array.isArray(j.sceneCharacterPrompts)) {
                    allCharPrompts.push(...j.sceneCharacterPrompts);
                  }
                }
                // 같은 슬롯 비교용 key — PromptPiece.id는 인스턴스마다 unique라
                // JSON.stringify로 그대로 쓰면 모두 다름. id 제외 + characterPrompts
                // 정렬해서 내용 기준 비교.
                const slotKey = (slot: any[]): string =>
                  JSON.stringify(
                    (slot || []).map((p: any) => ({
                      prompt: p?.prompt ?? '',
                      characterPrompts: [...(p?.characterPrompts || [])].sort(),
                      enabled: p?.enabled === true,
                    })),
                  );
                const seenSlots = new Set<string>();
                const allSlots: any[] = [];
                for (const slot of allSlotsRaw) {
                  const key = slotKey(slot);
                  if (!seenSlots.has(key)) {
                    seenSlots.add(key);
                    allSlots.push(slot);
                  }
                }
                // 2. 이미지 합치기. 새 이름이 selected 안 이름이면 그 폴더 유지 (파일
                // 이동 X). 그 외 selected의 png들을 새 폴더로 renameFile (server가
                // mkdir 자동). listFiles는 source 씬 단위 병렬, renameFile은 파일 단위
                // CHUNK=4 병렬. 큰 씬 통합 시 직렬 대비 수십 배 빠름.
                const keepIdx = selected.findIndex((s) => s.name === newName);
                const allMainsSet = new Set<string>();
                if (keepIdx >= 0) {
                  for (const m of selected[keepIdx].mains) allMainsSet.add(m);
                }
                // Phase A: source 씬 목록 + listFiles 병렬
                type SrcScene = { scene: GenericScene; oldDir: string };
                const sources: SrcScene[] = [];
                for (let i = 0; i < selected.length; i++) {
                  if (i === keepIdx) continue;
                  sources.push({
                    scene: selected[i],
                    oldDir: 'outs/' + sessionName + '/' + selected[i].name,
                  });
                }
                const listResults = await Promise.all(
                  sources.map(async ({ scene, oldDir }) => {
                    try {
                      const files = await backend.listFiles(oldDir);
                      return { scene, oldDir, pngs: files.filter((f) => f.endsWith('.png')) };
                    } catch {
                      return { scene, oldDir, pngs: [] as string[] };
                    }
                  }),
                );
                // Phase B: 파일 단위 rename 작업 flatten
                type RenameTask = { src: string; dst: string; file: string; sceneMains: string[] };
                const tasks: RenameTask[] = [];
                for (const { scene, oldDir, pngs } of listResults) {
                  for (const file of pngs) {
                    tasks.push({
                      src: oldDir + '/' + file,
                      dst: newDir + '/' + file,
                      file,
                      sceneMains: scene.mains,
                    });
                  }
                }
                const totalFiles = tasks.length;
                appState.updateProgressDialog(pid, {
                  total: Math.max(1, totalFiles),
                  text: totalFiles > 0
                    ? `씬 통합 중... 이미지 0/${totalFiles}`
                    : '씬 통합 중...',
                });
                // Phase C: renameFile CHUNK=4 병렬
                let movedCount = 0;
                const CHUNK = 4;
                for (let i = 0; i < tasks.length; i += CHUNK) {
                  const chunk = tasks.slice(i, i + CHUNK);
                  await Promise.all(
                    chunk.map(async (t) => {
                      try {
                        await backend.renameFile(t.src, t.dst);
                        movedCount++;
                        if (t.sceneMains.includes(t.file)) allMainsSet.add(t.file);
                      } catch (e) {
                        console.warn('[mergeScenes] rename failed:', t.src, e);
                      }
                    }),
                  );
                  const done = Math.min(i + CHUNK, totalFiles);
                  appState.updateProgressDialog(pid, {
                    done,
                    text: `씬 통합 중... 이미지 ${done}/${totalFiles}`,
                  });
                }
                // 3. 새 Scene 객체 만들기
                const base = selected[0];
                const baseJSON: any = (base as any).toJSON();
                const newJSON: any = {
                  ...baseJSON,
                  name: newName,
                  slots: allSlots,
                  mains: Array.from(allMainsSet),
                  imageMap: [],
                };
                if (type === 'scene') {
                  newJSON.sceneCharacterPrompts = allCharPrompts;
                }
                // 4. 원본 모두 삭제
                for (const s of selected) {
                  this.curSession!.removeScene(type, s.name);
                }
                // 5. 새 씬 추가
                const newScene =
                  type === 'scene'
                    ? Scene.fromJSON(newJSON)
                    : InpaintScene.fromJSON(newJSON);
                if (!newScene) {
                  appState.finishProgressDialog(pid, '✗ 통합 실패: 새 씬 생성 안 됨', false);
                  return;
                }
                this.curSession!.addScene(newScene);
                // 6. imageService refresh (새 폴더의 파일 목록 갱신)
                try {
                  await imageService.refresh(this.curSession!, newScene);
                } catch {}
                const dedupCount = allSlotsRaw.length - allSlots.length;
                appState.finishProgressDialog(
                  pid,
                  `✓ "${newName}"로 통합 완료 (이미지 ${movedCount}장 이동${dedupCount > 0 ? `, 중복 슬롯 ${dedupCount}개 제거` : ''})`,
                  true,
                );
              } catch (e: any) {
                appState.finishProgressDialog(
                  pid,
                  '✗ 통합 중 오류: ' + (e?.message || String(e)),
                  false,
                );
              }
            },
          });
        };
        appState.pushDialog({
          type: 'select',
          text: '통합 씬의 이름을 선택하거나 직접 입력하세요',
          items: nameItems,
          callback: (nameValue: string) => {
            if (nameValue === 'custom') {
              appState.pushDialog({
                type: 'input-confirm',
                text: '새 씬 이름을 입력하세요',
                callback: (input: string) => performMerge(input),
              });
            } else if (nameValue && nameValue.startsWith('use:')) {
              const idx = parseInt(nameValue.slice('use:'.length));
              if (!isNaN(idx) && selected[idx]) {
                performMerge(selected[idx].name);
              }
            }
          },
        });
      } else if (value === 'sortScenes') {
        const allScenes = this.curSession!.getScenes(type);
        const selectedSet = new Set(selected.map(s => s.name));
        const selectedSorted = [...selected].sort((a, b) =>
          a.name.localeCompare(b.name)
        );
        const indices = allScenes
          .map((s, i) => selectedSet.has(s.name) ? i : -1)
          .filter(i => i !== -1);
        for (let i = 0; i < indices.length; i++) {
          this.curSession!.moveScene(selectedSorted[i], indices[i]);
        }
        appState.pushMessage('씬 정렬 완료');
      } else {
        console.log('Not implemented');
      }
    };

    const openMenu = () => {
      let items = [
        { text: '📁 이미지 내보내기', value: 'export' },
        { text: '🔪 즐겨찾기 이미지 배경 제거', value: 'removeBg' },
        { text: '🔄 즐겨찾기 이미지 변형', value: 'transform' },
        { text: '🗑️ 이미지 삭제', value: 'removeImage' },
        { text: '❌ 즐겨찾기 전부 해제', value: 'removeAllFav' },
        { text: '⭐ 상위 n등 즐겨찾기 지정', value: 'setFav' },
        { text: '📋 씬 내용 복제', value: 'copySceneContent' },
        { text: '📝 씬 이름 내보내기', value: 'exportSceneNames' },
        { text: '🗂️ 씬 일괄 삭제', value: 'deleteScenes' },
        { text: '🔤 씬 이름순 정렬', value: 'sortScenes' },
        { text: '🔗 씬들 통합', value: 'mergeScenes' },
        { text: '⏹️ 예약 일괄 취소', value: 'cancelReservations' },
      ];
      if (type === 'inpaint') {
        items.push({ text: '🪞 이미지생성 탭 씬 이미지미러로 복제', value: 'mirrorDuplicate' });
      }
      if (isMobile) {
        items = items.filter((x) => x.value !== 'removeBg');
      }
      appState.pushDialog({
        type: 'select',
        text: '선택할 씬들에 적용할 대량 작업을 선택해주세요',
        graySelect: true,
        items: items,
        callback: (value, text) => {
          if (value === 'mirrorDuplicate') {
            const imageGenScenes = this.curSession!.getScenes('scene');
            if (imageGenScenes.length === 0) {
              appState.pushMessage('이미지생성 씬이 없습니다.');
              return;
            }
            setBatchPicker({
              type: 'inpaint',
              text: '🪞 미러로 복제할 이미지생성 씬 선택',
              scenes: imageGenScenes,
              callback: (selected) => {
                setBatchPicker(undefined);
                if (selected.length === 0) return;
                appState.pushDialog({
                  type: 'confirm',
                  text: `선택한 ${selected.length}개 씬을 이미지미러 씬으로 복제하시겠습니까?`,
                  callback: () => {
                    let count = 0;
                    for (const scene of selected) {
                      const src = scene as Scene;
                      const srcJSON = src.toJSON();
                      // 이름 충돌 해결
                      let name = src.name;
                      if (this.curSession!.hasScene('inpaint', name)) {
                        let i = 1;
                        while (
                          this.curSession!.hasScene('inpaint', `${name}_${i}`)
                        )
                          i++;
                        name = `${name}_${i}`;
                      }
                      // SDMirror 프리셋 생성 + 중위 프롬프트 동기화
                      const preset =
                        workFlowService.buildPreset('SDMirror');
                      if (
                        srcJSON.slots.length > 0 &&
                        srcJSON.slots[0].length > 0
                      ) {
                        preset.prompt = srcJSON.slots[0][0].prompt;
                      }
                      const newScene = InpaintScene.fromJSON({
                        type: 'inpaint',
                        name,
                        workflowType: 'SDMirror',
                        preset: preset.toJSON(),
                        resolution: 'portrait',
                        mains: [],
                        imageMap: [],
                        round: undefined,
                        game: undefined,
                        slots: srcJSON.slots,
                      });
                      if (newScene) {
                        this.curSession!.addScene(newScene);
                        count++;
                      }
                    }
                    appState.pushMessage(
                      `${count}개 씬이 이미지미러로 복제되었습니다.`,
                    );
                  },
                });
              },
            });
            return;
          }
          if (value === 'copySceneContent') {
            const allScenes = this.curSession!.getScenes(type);
            if (allScenes.length < 2) {
              appState.pushMessage('씬이 2개 이상 필요합니다.');
              return;
            }
            appState.pushDialog({
              type: 'dropdown',
              text: '내용을 복사할 원본 씬을 선택해주세요',
              items: allScenes.map((s) => ({ text: s.name, value: s.name })),
              callback: (sourceName) => {
                if (!sourceName) return;
                const sourceScene = allScenes.find((s) => s.name === sourceName);
                if (!sourceScene) return;
                const targetScenes = allScenes.filter((s) => s.name !== sourceName);
                setBatchPicker({
                  type: type,
                  text: `📋 내용 붙여넣기 (원본: ${sourceName})`,
                  scenes: targetScenes,
                  callback: (selected) => {
                    setBatchPicker(undefined);
                    if (selected.length === 0) return;
                    appState.pushDialog({
                      type: 'confirm',
                      text: `원본 '${sourceName}'의 내용을 선택한 ${selected.length}개 씬에 덮어씌우시겠습니까?`,
                      callback: () => {
                        if (sourceScene.type === 'scene' && type === 'scene') {
                          const src = sourceScene as Scene;
                          const srcJSON = src.toJSON();
                          for (const target of selected) {
                            const t = target as Scene;
                            t.slots = srcJSON.slots.map((slot) =>
                              slot.map((piece) => PromptPiece.fromJSON(piece)),
                            );
                            t.meta = new Map(Object.entries(srcJSON.meta ?? {}));
                            t.sceneCharacterPrompts = (srcJSON.sceneCharacterPrompts || []).map((cp) => ({
                              ...cp,
                              enabled: cp.enabled !== false,
                            }));
                            t.useSceneCharacterPrompts = srcJSON.useSceneCharacterPrompts || false;
                            t.sceneCharacterUC = srcJSON.sceneCharacterUC || '';
                          }
                        } else if (sourceScene.type === 'inpaint' && type === 'inpaint') {
                          const src = sourceScene as InpaintScene;
                          const srcJSON = src.toJSON();
                          for (const target of selected) {
                            const t = target as InpaintScene;
                            t.workflowType = srcJSON.workflowType;
                            t.preset = srcJSON.preset && workFlowService.presetFromJSON(srcJSON.preset);
                          }
                        }
                        appState.pushMessage(`${selected.length}개 씬에 내용이 복제되었습니다.`);
                      },
                    });
                  },
                });
              },
            });
            return;
          }
          if (value === 'deleteScenes') {
            setBatchPicker({
              type: type,
              text: text!,
              callback: (selected) => {
                setBatchPicker(undefined);
                deleteScenes(selected);
              },
            });
            return;
          }
          setBatchPicker({
            type: type,
            text: text!,
            callback: (selected) => {
              setBatchPicker(undefined);
              handleBatchProcess(value!, selected);
            },
          });
        },
      });
    };
    openMenu();
  }

  @action
  openChangeResolutionMenu(
    type: 'scene' | 'inpaint',
    setBatchPicker: (item: BatchPickerItem | undefined) => void,
  ) {
    setBatchPicker({
      type: type,
      text: '🖥️ 해상도 변경할 씬 선택',
      callback: async (selected) => {
        setBatchPicker(undefined);
        if (selected.length === 0) return;
        const options = Object.entries(resolutionMap)
          .filter((x) => !x[0].includes('small'))
          .map(([key, value]) => {
            if (key === 'custom')
              return { text: '커스텀 (직접 입력)', value: key };
            return {
              text: `${value.width}x${value.height}`,
              value: key,
            };
          });
        appState.pushDialog({
          type: 'dropdown',
          text: '변경할 해상도를 선택해주세요',
          items: options,
          callback: async (value?: string) => {
            if (!value) return;
            if (value === 'custom') {
              // 일괄 적용이라 첫 씬 값을 default로 (사용자가 그대로 OK하면 일관성).
              const first = selected[0];
              const r = await appState.openCustomResolutionAsync({
                width: first?.resolutionWidth,
                height: first?.resolutionHeight,
              });
              if (!r) return;
              for (const scene of selected) {
                scene.resolution = 'custom' as Resolution;
                scene.resolutionWidth = r.width;
                scene.resolutionHeight = r.height;
              }
              return;
            }
            const action = () => {
              for (const scene of selected) {
                scene.resolution = value as Resolution;
              }
            };
            if (value.includes('large') || value.includes('wallpaper')) {
              appState.pushDialog({
                text: 'Anlas를 소모하는 해상도 입니다. 계속하겠습니까?',
                type: 'confirm',
                callback: () => {
                  action();
                },
              });
            } else {
              action();
            }
          },
        });
      },
    });
  }

  @action
  async emptyProjectImageTrashWithConfirm() {
    if (!this.curSession) return;
    const { trashService } = await import('.');
    // 즉시 toast — 본인 페인 (E1): 60+ 씬 listFiles로 다이얼로그 뜨기까지 1~수초.
    // TrashService.countProjectImageTrash가 청크 8 병렬화로 단축되긴 했지만 큰
    // 프로젝트에선 여전히 체감 가능 → 사용자 입력 받았다는 신호 즉시 표시.
    this.pushMessage('🧹 트래시 계산 중...');
    const { totalImages, scenesWithTrash } =
      await trashService.countProjectImageTrash(this.curSession);
    if (totalImages === 0) {
      this.pushMessage('삭제된 이미지가 없습니다.');
      return;
    }
    appState.pushDialog({
      type: 'confirm',
      text:
        `이 프로젝트의 ${scenesWithTrash}개 씬에서 삭제된 이미지 ` +
        `${totalImages}개를 영구 삭제하시겠습니까? (복원 불가)`,
      callback: async () => {
        const deleted = await trashService.emptyProjectImageTrash(
          this.curSession!,
        );
        appState.pushDialog({
          type: 'yes-only',
          text: `${deleted}개의 이미지가 영구 삭제되었습니다.`,
        });
      },
    });
  }

  @action
  async recoverProjectImages() {
    if (!this.curSession) return;
    const session = this.curSession;

    // outs/<세션명>/ 디렉토리에서 씬 폴더 목록 조회
    let sceneDirs: string[] = [];
    try {
      const entries = await backend.listFiles('outs/' + session.name);
      // 디렉토리만 필터링 (확장자 없는 항목 = 디렉토리)
      sceneDirs = entries.filter((e: string) => !e.includes('.'));
    } catch {
      // outs 디렉토리 자체가 없으면 복구할 것 없음
    }

    if (sceneDirs.length === 0) {
      this.pushDialog({
        type: 'yes-only',
        text: '파일시스템에서 복구할 이미지 폴더를 찾지 못했습니다.',
      });
      return;
    }

    // 현재 세션에 없는 씬 폴더 찾기
    let recoveredScenes = 0;
    let recoveredImages = 0;

    for (const dirName of sceneDirs) {
      // 해당 폴더에 PNG 파일이 있는지 확인
      let pngFiles: string[] = [];
      try {
        const files = await backend.listFiles('outs/' + session.name + '/' + dirName);
        pngFiles = files.filter((f: string) => f.endsWith('.png'));
      } catch {
        continue;
      }
      if (pngFiles.length === 0) continue;

      if (!session.scenes.has(dirName)) {
        // 씬이 JSON에서 사라진 경우: 빈 씬 생성
        session.addScene(
          Scene.fromJSON({
            type: 'scene',
            name: dirName,
            resolution: 'portrait',
            slots: [
              [
                {
                  id: v4(),
                  prompt: '',
                  characterPrompts: [],
                  enabled: true,
                },
              ],
            ],
            mains: [],
            imageMap: [],
            meta: {},
          } as any),
        );
        recoveredScenes++;
      }

      // 씬의 imageMap이 비어있지만 파일은 있는 경우도 카운트
      const scene = session.scenes.get(dirName);
      if (scene && scene.imageMap.length === 0 && pngFiles.length > 0) {
        recoveredImages += pngFiles.length;
      }
    }

    // refreshBatch로 모든 씬의 imageMap 갱신 (파일시스템에서 재발견)
    await imageService.refreshBatch(session);

    // 결과 보고
    if (recoveredScenes === 0 && recoveredImages === 0) {
      this.pushDialog({
        type: 'yes-only',
        text: '모든 씬의 이미지가 정상입니다. 복구할 항목이 없습니다.',
      });
    } else {
      const parts: string[] = [];
      if (recoveredScenes > 0) parts.push(`${recoveredScenes}개 씬 복원`);
      if (recoveredImages > 0) parts.push(`${recoveredImages}개 이미지 재연결`);
      this.pushDialog({
        type: 'yes-only',
        text: `복구 완료: ${parts.join(', ')}`,
      });
    }
  }

  closeExternalImage() {
    this.externalImage = undefined;
  }

  @action
  setAppliedCharacterPreset(presetName: string | undefined) {
    this.appliedCharacterPreset = presetName;
  }

  @action
  clearAppliedCharacterPreset() {
    if (!this.curSession) return;
    
    const workflowType = this.curSession.selectedWorkflow?.workflowType;
    if (!workflowType) return;
    
    const shared = this.curSession.presetShareds.get(workflowType);
    if (!shared) return;
    
    // 프리셋에서 적용된 값들 초기화
    shared.vibes = [];
    shared.characterReferences = [];
    if (workflowType === 'SDImageGenEasy') {
      shared.characterPrompt = '';
      shared.backgroundPrompt = '';
      shared.uc = '';
    }
    
    this.appliedCharacterPreset = undefined;
    this.pushMessage('캐릭터 프리셋이 해제되었습니다');
  }

  /**
   * 현재 적용된 캐릭터 프리셋 객체를 가져옵니다.
   * @returns 현재 적용된 CharacterPreset 객체 또는 undefined
   */
  getAppliedCharacterPreset(): CharacterPreset | undefined {
    if (!this.curSession || !this.appliedCharacterPreset) {
      return undefined;
    }
    return this.curSession.getCharacterPreset(this.appliedCharacterPreset);
  }

  /**
   * 여러 그림체 파일을 한번에 가져오기
   */
  async importMultiplePresets() {
    if (!this.curSession) {
      this.pushMessage('세션을 먼저 선택해주세요.');
      return;
    }

    const files = await backend.selectFiles({
      filters: [
        { name: 'PNG 이미지', extensions: ['png'] },
        { name: '모든 파일', extensions: ['*'] },
      ],
    });

    if (!files || files.length === 0) {
      return;
    }

    this.setProgressDialog({
      text: '그림체 가져오는 중...',
      done: 0,
      total: files.length,
    });

    const results = {
      success: 0,
      failed: 0,
      failedNames: [] as string[],
    };

    for (let i = 0; i < files.length; i++) {
      const filePath = files[i];
      const fileName = filePath.split('/').pop() || filePath.split('\\').pop() || filePath;
      
      try {
        // 파일 읽기
        const base64 = await backend.readBinaryFile(filePath);
        
        // 프리셋 가져오기
        const preset = await importPreset(this.curSession!, base64);
        
        if (preset) {
          results.success++;
        } else {
          results.failed++;
          results.failedNames.push(fileName);
        }
      } catch (e: any) {
        console.error(`Failed to import preset from ${fileName}:`, e);
        results.failed++;
        results.failedNames.push(fileName);
      }

      this.setProgressDialog({
        text: '그림체 가져오는 중...',
        done: i + 1,
        total: files.length,
      });
    }

    this.setProgressDialog(undefined);

    // 결과 메시지 표시
    if (results.success > 0 && results.failed === 0) {
      this.pushDialog({
        type: 'yes-only',
        text: `${results.success}개의 그림체를 성공적으로 가져왔습니다.`,
      });
    } else if (results.success > 0 && results.failed > 0) {
      this.pushDialog({
        type: 'yes-only',
        text: `${results.success}개의 그림체를 가져왔습니다.\n${results.failed}개의 파일은 유효한 그림체 파일이 아닙니다:\n${results.failedNames.slice(0, 5).join('\n')}${results.failedNames.length > 5 ? '\n...' : ''}`,
      });
    } else {
      this.pushDialog({
        type: 'yes-only',
        text: '선택한 파일들 중 유효한 그림체 파일이 없습니다.',
      });
    }

    // 첫 번째로 성공한 그림체 선택
    if (results.success > 0) {
      const presets = this.curSession!.presets.get('SDImageGenEasy');
      if (presets && presets.length > 0) {
        const lastPreset = presets[presets.length - 1];
        this.curSession!.selectedWorkflow = {
          workflowType: lastPreset.type,
          presetName: lastPreset.name,
        };
      }
    }
  }
}

export const appState = new AppState();

// Drive retry status 폴링: 부팅 시 1회. Drive 사용 중일 때만 30s 주기 폴링 유지
// (rclone 미설치 사용자의 모바일 데이터/배터리 낭비 차단). WS drive-sync-* 이벤트로
// 큐 변경 시 강제 refresh 되니까 폴링이 영구 중단돼도 누락 없음.
// visibility 게이트 적용 — 백그라운드 시 timer 정지 (모바일 발열·배터리 누수 차단).
let _driveStop: (() => void) | null = null;
function ensureDrivePolling() {
  if (_driveStop) return;
  _driveStop = startVisibleInterval(() => appState.refreshDriveRetryStatus(), 30000);
}
appState.refreshDriveRetryStatus().then(() => {
  if (appState.driveRetryStatus?.driveAvailable) ensureDrivePolling();
});

// 서버 큐 평균 ETA 폴링: 부팅 시 1회 + 15s 주기 (큐 처리 도중 추세 반영).
// visibility 게이트 — 백그라운드 시 timer 정지. 포그라운드 복귀 시 즉시 갱신은
// 아래 resyncBackgroundState 가 담당.
appState.refreshServerQueueAvg();
startVisibleInterval(() => appState.refreshServerQueueAvg(), 15000);

// 백그라운드 → 포그라운드 복귀 + WS 재연결 시 export/driveRetry 상태 동기화.
// iPhone Safari가 백그라운드 가면 WS 끊겨서 progress/complete 이벤트 미스 →
// widget이 '멈춘 듯' 보이고 완료 신호도 못 받는 문제 보정 (2026-05-13 본인 보고).
// queueMicrotask로 lazy 등록 — 모듈 톱 레벨에서 backend.method() 즉시 호출 시
// ESM 순서 의존으로 backend가 미정의일 수 있어 부트 실패 (흰화면 회귀).
queueMicrotask(() => {
  const resyncBackgroundState = () => {
    appState.refreshExportStatus();
    appState.refreshDriveRetryStatus();
    // 백그라운드 사이 놓친 queue-job-start 이벤트 대비 — 진행 중 씬 sceneKey도 회복.
    appState.refreshServerQueueAvg();
  };
  backend.onWsReconnect(resyncBackgroundState);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      resyncBackgroundState();
    }
  });

  // 현재 처리 중인 씬 sceneKey 추적 — SceneCell 외곽 파란 펄스 표시용.
  backend.onQueueJobStart((data) => {
    const key = data?.meta?.sceneKey;
    if (typeof key === 'string' && key.length > 0) {
      appState.currentProcessingSceneKey = key;
    }
  });
  // complete/error는 sceneKey를 굳이 null로 비우지 않음 — 다음 job-start가 곧 덮어씀.
  // 큐가 진짜 비면 다음 refreshServerQueueAvg 폴링에서 processing=false 보고 null로 회복.
});

// Phase 7A: v4.5 자동 vibe 비활성화 알림 (페이지 로드당 1회)
// queueMicrotask로 lazy 등록 — 모듈 톱 레벨에서 즉시 호출 시
// taskQueueService가 ESM 순서 의존으로 아직 미정의일 수 있어 부트 실패함.
let vibeLockNoticeShown = false;
queueMicrotask(() => {
  taskQueueService.addEventListener('vibe-locked', () => {
    if (vibeLockNoticeShown) return;
    vibeLockNoticeShown = true;
    appState.pushMessage(
      'NAI v4.5는 캐릭터 레퍼런스 사용 시 바이브를 동시에 적용할 수 없어, 바이브가 비활성화된 상태로 생성됩니다.'
    );
  });
});
