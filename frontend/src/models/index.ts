import {
  ImageGenInput,
  Model,
  NoiseSchedule,
  Resolution,
  Sampling,
} from '../backends/imageGen';
import { CircularQueue } from '../circularQueue';

import { v4 as uuidv4, v4 } from 'uuid';
import ExifReader from 'exifreader';
import { ServerBackend } from '../backends/serverBackend';
import extractChunks from 'png-chunks-extract';
import encodeChunks from 'png-chunks-encode';
import { Buffer } from 'buffer';
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
import { GlobalPieceService } from './GlobalPieceService';
import { GlobalPresetService } from './GlobalPresetService';

export const backend = new ServerBackend();

export const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

export class ZipService extends EventTarget {
  isZipping: boolean;
  constructor() {
    super();
    this.isZipping = false;
  }

  async zipFiles(files: FileEntry[], outPath: string): Promise<{ skipped: string[] }> {
    this.isZipping = true;
    try {
      return await backend.zipFiles(files, outPath);
    } finally {
      this.isZipping = false;
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

export const promptService = new PromptService();

export const taskQueueService = new TaskQueueService(taskHandlers);

export const loginService = new LoginService();

export const gameService = new GameService();

export const workFlowService = new WorkFlowService();
registerWorkFlows(workFlowService);

(window as any).promptService = promptService;
(window as any).sessionService = sessionService;
(window as any).imageService = imageService;
(window as any).imageDownloadService = imageDownloadService;
(window as any).taskQueueService = taskQueueService;
(window as any).loginService = loginService;
(window as any).globalPresetService = globalPresetService;

backend.onClose(() => {
  (async () => {
    await sessionService.saveAll();
  })();
});

// LocalAIService and AppUpdateNoticeService stubs for web mode
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

const _updateTarget = new NoopEventTarget();
export const appUpdateNoticeService = Object.assign(_updateTarget, {
  run: () => {},
  notice: undefined as string | undefined,
  outdated: false,
  latestVersion: '',
  current: '2.0.0-web',
  isDismissed: (_v: string) => true,
  dismissVersion: (_v: string) => {},
  checkForUpdate: async () => ({ outdated: false, latest: '2.0.0-web' }),
});
