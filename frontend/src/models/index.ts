import { ServerBackend } from '../backends/serverBackend';
import { FileEntry } from '../backend';
import { GameService } from './GameService';
import { ImageService } from './ImageService';
import { ImageDownloadService } from './ImageDownloadService';
import { LoginService } from './LoginService';
import { PromptService } from './PromptService';
import { SessionService } from './SessionService';
import { taskHandlers, TaskQueueService } from './TaskQueueService';
import { WorkFlowService } from './workflows/WorkFlowService';
import { registerWorkFlows } from './workflows';
import { TrashService } from './TrashService';
import { CyclingSessionService } from './CyclingSessionService';
import { GlobalPieceService } from './GlobalPieceService';
import { ArtistLibraryService } from './ArtistLibraryService';
import { GlobalPresetService } from './GlobalPresetService';
import { GlobalCharacterPresetService } from './GlobalCharacterPresetService';
import { PromptChunkService } from './PromptChunkService';
import { ToggleGroupService } from './ToggleGroupService';
import { SamplingPresetService } from './SamplingPresetService';
import { ProjectSizeService } from './ProjectSizeService';
import { ImageHistoryService } from './ImageHistoryService';

export const backend = new ServerBackend();

export const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

// 화면 폭에 따른 자동 초기 썸네일 크기. 본인 페인 (P12 #8): 인터넷 느린 환경에서
// 모바일 200 / 데스크탑 500 하드코딩이 무거움. 작은 화면 폰은 80, 폴드/태블릿
// 200, 일반 데스크탑 400, 큰 데스크탑 500. 사용자가 Config에서 override 가능.
// SSR/test env safety: window 없으면 200 default.
export function autoDetectInitialThumbSize(): number {
  if (typeof window === 'undefined') return 200;
  const w = window.innerWidth;
  if (w < 480) return 80;
  if (w < 768) return 200;
  if (w < 1280) return 400;
  return 500;
}

// Config.initialThumbSize 우선, 없으면 autoDetect. 명시적 값이면 그대로 사용.
export function getInitialThumbSize(configValue: number | undefined): number {
  if (configValue && configValue > 0) return configValue;
  return autoDetectInitialThumbSize();
}

export class ZipService extends EventTarget {
  // 진행 중인 outPath 집합. 전역 boolean 1개로 막던 시절엔 폴더 N개 동시 내보내기 불가 →
  // outPath 단위 중복만 차단해서 서로 다른 폴더는 병렬로 진행 (2026-05-20).
  private activeOutPaths: Set<string> = new Set();

  isPathZipping(outPath: string): boolean {
    return this.activeOutPaths.has(outPath);
  }

  async zipFiles(files: FileEntry[], outPath: string): Promise<{ skipped: string[] }> {
    if (this.activeOutPaths.has(outPath)) {
      throw new Error('Already zipping: ' + outPath);
    }
    this.activeOutPaths.add(outPath);
    try {
      return await backend.zipFiles(files, outPath);
    } finally {
      this.activeOutPaths.delete(outPath);
    }
  }
}

export const zipService = new ZipService();

export const sessionService = new SessionService();
sessionService.run();

export const imageService = new ImageService();

export const trashService = new TrashService();

export const imageDownloadService = new ImageDownloadService();

export const globalPieceService = new GlobalPieceService();
globalPieceService.load();

export const globalPresetService = new GlobalPresetService();
globalPresetService.load();

export const globalCharacterPresetService = new GlobalCharacterPresetService();
globalCharacterPresetService.load();

export const artistLibraryService = new ArtistLibraryService();
artistLibraryService.load();

export const promptChunkService = new PromptChunkService();
promptChunkService.load();

export const toggleGroupService = new ToggleGroupService();
toggleGroupService.load();

export const samplingPresetService = new SamplingPresetService();

export const projectSizeService = new ProjectSizeService();
samplingPresetService.load();

// 백업 복원처럼 서버가 여러 상태 파일을 직접 교체하기 전의 단일 flush 진입점.
export async function flushPersistentStores(): Promise<void> {
  await sessionService.saveAll();
  await Promise.all([
    globalPieceService.flushSave(),
    globalPresetService.flushSave(),
    globalCharacterPresetService.flushSave(),
    artistLibraryService.flushSave(),
    promptChunkService.flushSave(),
    toggleGroupService.flushSave(),
    samplingPresetService.flushSave(),
  ]);
  await backend.flushAllFileWrites();
}

export const promptService = new PromptService();

export const taskQueueService = new TaskQueueService(taskHandlers);

export const loginService = new LoginService();

export const gameService = new GameService();

// 서버의 4시간 완료 이력 + WS 완료 이벤트를 합쳐, 새로고침/다른 탭 완료도 복원한다.
export const imageHistoryService = new ImageHistoryService(backend, imageService, sessionService);

export const workFlowService = new WorkFlowService();
registerWorkFlows(workFlowService);

export const cyclingSessionService = new CyclingSessionService();

// 내보내기 프리셋을 localStorage → exportPresets.json(서버 파일)로 이관 + 로드.
// (시작 후 비동기 — 파일 없으면 localStorage에서 1회 비파괴 이관. SDStudio 4.12)
// 동적 import: AppService 조기 평가로 초기화 순서가 바뀌지 않도록 index 본문 이후로 미룸.
import('./AppService').then((m) => m.appState.initExportPresets());

(window as any).promptService = promptService;
(window as any).sessionService = sessionService;
(window as any).imageService = imageService;
(window as any).imageDownloadService = imageDownloadService;
(window as any).taskQueueService = taskQueueService;
(window as any).loginService = loginService;
(window as any).globalPresetService = globalPresetService;
(window as any).promptChunkService = promptChunkService;
(window as any).toggleGroupService = toggleGroupService;
(window as any).samplingPresetService = samplingPresetService;

// electron 잔재 정리 (진단 [동작 변경 제안], 2026-07-09):
// - backend.onClose saveAll 등록 제거 — 서버가 'close'를 broadcast하는 코드가 0이라
//   절대 발화하지 않던 죽은 배선 (웹 저장은 주기 저장 + flushOnHide가 담당).
// - appUpdateNoticeService stub 제거 — 소비처였던 App.tsx 리스너(미발화)와 환경설정
//   버튼(Med-10에서 /api/version-check 재배선) 모두 정리돼 참조 0.

// LocalAIService stub for web mode
class NoopEventTarget extends EventTarget {}

const _localAITarget = new NoopEventTarget();
export const localAIService = Object.assign(_localAITarget, {
  statsModels: () => {},
  models: [] as string[],
  isRunning: false,
  ready: false,
  downloading: false,
  download: () => {},
  modelChanged: () => {},
  notifyDownloadProgress: (_p: number) => {},
  removeBg: async (_image: string, _outputPath: string) => {},
});
