import { Config } from './main/config';
import {
  EncodeVibeImageInput,
  ImageAugmentInput,
  ImageGenInput,
} from './backends/imageGen';

export interface FileEntry {
  name: string;
  path: string;
}

export enum ImageOptimizeMethod {
  LOSSY = 1,
  LOSSLESS = 2,
  AVIF = 3,
}

export interface ResizeImageInput {
  inputPath: string;
  outputPath: string;
  maxWidth: number;
  maxHeight: number;
  optimize?: ImageOptimizeMethod;
}

export interface FileStatEntry {
  name: string;
  size: number;
  mtime: number;
}

export interface RecursiveListResult {
  files: string[];   // slash-joined relative paths
  dirs: string[];    // direct subdirectories at depth 0 (including empty ones)
}

export interface DriveRetryEntry {
  localPath: string;
  fileName: string;
  addedAt: number;
  attempts: number;
  status: 'pending' | 'failed';
  nextRetryAt: number | null;
  lastError: string | null;
  lastAttemptAt: number;
}

export interface DriveRetryStatus {
  // rclone 설치 + RCLONE_REMOTE 매칭 여부. false면 클라 폴링 영구 중단.
  driveAvailable: boolean;
  count: number;
  pendingCount: number;
  failedCount: number;
  intervalsMs: number[];
  maxAttempts: number;
  entries: DriveRetryEntry[];
}

export interface DriveRetryResult {
  ok: boolean;
  before: number;
  after: number;
  succeeded: number;
  failed: number;
  skipped: number;
}

// 단일 entry 즉시 재시도(/drive/retry-one) 응답. 모두 재시도(DriveRetryResult)와 달리
// before/after queue length 변동은 분기 의미 없어서 omit. succeeded/failed 합이 항상 0 또는 1.
export interface DriveRetryOneResult {
  ok: boolean;
  succeeded: number;
  failed: number;
  skipped: number;
}

// 클라가 큐 push 시 task 매핑용으로 함께 보내는 메타데이터.
// 페이지 로드 시 GET /api/queue/full-state로 회수해 task 복원.
export interface QueueJobMeta {
  taskId?: string;        // 같은 task에 속한 jobs 그룹화
  cls?: number;           // task handler index (gen-fast / gen-slow / inpaint-* 구분)
  sceneKey?: string;      // sceneStats 매핑용 (session/type/sceneName)
  sceneName?: string;     // 표시용
  taskType?: string;      // 'gen' | 'inpaint' | 'i2i' 등
  jobIndex?: number;      // task 내 1-based 순번 (queue.html 표시용)
  jobTotal?: number;      // task의 총 jobs 수 (queue.html 표시용)
  sceneJobIndex?: number; // 씬 그룹(조합 × samples) 내 1-based 순번. queueWorkflow 진입 시 박힘.
  sceneJobTotal?: number; // 씬 그룹 총 jobs (= prompts.length × samples).
}

export interface QueueFullState {
  pending: number;
  processing: boolean;
  paused: boolean;
  pauseRequested: boolean;
  jobs: Array<{
    jobId: string;
    meta: QueueJobMeta;
    outputFilePath?: string;
    priority?: boolean;
  }>;
}

export interface DeleteProjectResult {
  deleted: { local: string[]; drive: string[] };
  errors: string[];
  driveSkipped: boolean;
}

export interface DeleteFolderResult {
  folder: string;
  deletedProjects: string[];
  deleted: { local: string[]; drive: string[] };
  errors: string[];
  driveSkipped: boolean;
}

export interface CleanupOrphansStart {
  jobId: string;
  alreadyRunning: boolean;
}

export type CleanupOrphansPhase =
  | 'local-folders'
  | 'local-exports'
  | 'drive-folders'
  | 'drive-exports';

export interface CleanupOrphansProgress {
  jobId: string;
  phase: CleanupOrphansPhase;
  currentItem: string;
  deleted: { local: number; drive: number };
  errors: number;
}

export interface CleanupOrphansDone {
  jobId: string;
  deleted: { local: string[]; drive: string[] };
  errors: string[];
  driveSkipped: boolean;
}

export interface CleanupOrphansError {
  jobId: string;
  error: string;
  deleted: { local: string[]; drive: string[] };
  errors: string[];
}

export abstract class Backend {
  abstract getConfig(): Promise<Config>;
  abstract setConfig(newConfig: Config): Promise<void>;
  abstract getVersion(): Promise<string>;
  abstract openWebPage(url: string): Promise<void>;
  abstract generateImage(arg: ImageGenInput): Promise<void>;
  abstract queueAddBatch(items: Array<{ params: ImageGenInput; meta?: QueueJobMeta }>): Promise<{ jobIds: string[]; rejected: number }>;
  abstract queueGetFullState(): Promise<QueueFullState>;
  abstract pauseQueue(): Promise<void>;
  abstract resumeQueue(): Promise<void>;
  abstract cancelQueue(): Promise<{ cancelled: number }>;
  abstract cancelQueueByTaskIds(taskIds: string[]): Promise<{ cancelled: number }>;
  abstract queuePrioritize(taskIds: string[], priority: boolean): Promise<{ changed: number }>;
  abstract getDriveRetryStatus(): Promise<DriveRetryStatus>;
  abstract driveRetryNow(): Promise<DriveRetryResult>;
  abstract driveRetryOne(localPath: string): Promise<DriveRetryOneResult>;
  abstract driveRetryDismiss(localPath: string): Promise<void>;
  abstract augmentImage(arg: ImageAugmentInput): Promise<void>;
  abstract login(email: string, password: string): Promise<void>;
  abstract loginWithToken(token: string): Promise<void>;
  abstract authStatus(): Promise<boolean>;
  abstract encodeVibeImage(arg: EncodeVibeImageInput): Promise<string>;
  abstract showFile(arg: string): Promise<void>;
  // downloadName: 브라우저 다운로드 시 저장될 파일명. 미지정 시 server 파일명 사용.
  // 웹/모바일에서 selectDir 불가능한 경우 customFilename 살리는 용도.
  abstract copyToDownloads(path: string, downloadName?: string): Promise<void>;
  abstract zipFiles(files: FileEntry[], outPath: string): Promise<{ skipped: string[] }>;
  abstract unzipFiles(tarPath: string, outPath: string): Promise<void>;
  abstract searchTags(word: string): Promise<any>;
  abstract lookupTag(word: string): Promise<any>;
  abstract loadPiecesDB(pieces: string[]): Promise<void>;
  abstract searchPieces(word: string): Promise<any>;
  abstract listFiles(arg: string): Promise<string[]>;
  abstract listFilesWithStats(arg: string): Promise<FileStatEntry[]>;
  abstract listFilesRecursive(arg: string, depth?: number): Promise<RecursiveListResult>;
  abstract readFile(filename: string): Promise<string>;
  abstract writeFile(filename: string, data: string): Promise<void>;
  // visibilitychange→hidden 같은 tab close 임박 시점에서 호출하는 변종. fetch keepalive:true
  // 사용해서 page unload 이후에도 request 완료 보장. body 64KB 한도가 있어 큰 파일은
  // 잘려나갈 수 있음 — 호출처가 작은 데이터(개별 dirty resource)만 보내야 함. fire-and-forget.
  abstract writeFileKeepalive(filename: string, data: string): void;
  abstract copyFile(src: string, dest: string): Promise<void>;
  abstract readDataFile(arg: string): Promise<string>;
  abstract writeDataFile(filename: string, data: string): Promise<void>;
  abstract writeDataFileAbsolute(absolutePath: string, data: string): Promise<void>;
  abstract existFileAbsolute(absolutePath: string): Promise<boolean>;
  abstract renameFile(oldfile: string, newfile: string): Promise<void>;
  abstract renameDir(oldfile: string, newfile: string): Promise<void>;
  abstract deleteFile(filename: string): Promise<void>;
  abstract deleteDir(filename: string): Promise<void>;
  abstract trashFile(filename: string): Promise<void>;
  abstract selectDir(): Promise<string | undefined>;
  abstract selectFile(): Promise<string | undefined>;
  abstract selectFiles(options?: { filters?: { name: string; extensions: string[] }[] }): Promise<string[]>;
  abstract readBinaryFile(filePath: string): Promise<string>;
  abstract close(): Promise<void>;
  abstract existFile(filename: string): Promise<boolean>;
  abstract download(url: string, dest: string, filename: string): Promise<void>;
  abstract resizeImage(input: ResizeImageInput): Promise<void>;
  abstract openImageEditor(inputPath: string): Promise<void>;
  abstract watchImage(inputPath: string): Promise<void>;
  abstract unwatchImage(inputPath: string): Promise<void>;
  abstract loadModel(modelPath: string): Promise<void>;
  abstract copyImageToClipboard(imagePath: string): Promise<void>;
  // 좌우 반전 — 같은 파일에 덮어쓰기 (PNG NAI metadata 보존). 비-PNG는 거부.
  abstract flipImageHorizontal(path: string): Promise<void>;
  abstract spawnLocalAI(): Promise<void>;
  abstract isLocalAIRunning(): Promise<boolean>;
  abstract getRemainCredits(): Promise<number>;
  abstract removeBackground(
    inputImageBase64: string,
    outputPath: string,
  ): Promise<void>;
  abstract onDownloadProgress(callback: (progress: any) => void): () => void;
  abstract onZipProgress(callback: (progress: any) => void): () => void;
  abstract onImageChanged(callback: (path: string) => void): () => void;
  abstract onClose(callback: () => void): () => void;
  abstract onWsReconnect(callback: () => void): () => void;
  abstract deleteProjectNow(name: string): Promise<DeleteProjectResult>;
  abstract deleteFolderNow(folder: string): Promise<DeleteFolderResult>;
  abstract cleanupOrphans(): Promise<CleanupOrphansStart>;
  abstract onCleanupOrphansStart(callback: (data: { jobId: string }) => void): () => void;
  abstract onCleanupOrphansProgress(callback: (data: CleanupOrphansProgress) => void): () => void;
  abstract onCleanupOrphansDone(callback: (data: CleanupOrphansDone) => void): () => void;
  abstract onCleanupOrphansError(callback: (data: CleanupOrphansError) => void): () => void;
  abstract getDiskUsage(): Promise<DiskUsageResult>;
  abstract cleanupDisk(targets: string[]): Promise<DiskCleanupResult>;
  abstract onQueueFull(callback: (data: QueueFullEvent) => void): () => void;
}

// server add-batch가 큐 한도 도달로 부분 rejected 했을 때 broadcast. AppService에서 listen → toast.
export type QueueFullEvent = { max: number; rejected: number; message: string };

// 디스크 정리 API — queue popup의 manual trigger. 화이트리스트 6종.
// 'outs' = 전체(원본 + thumbnail) 통째 청소. 'outs-thumbnails' = outs/ 하위 fastcache/만
// (원본 보존, prewarm 시 자동 재생성).
export type DiskCategory = 'outs' | 'outs-thumbnails' | 'exports' | 'tmp' | 'inpaints' | 'vibes';
export type DiskUsageResult = Record<DiskCategory, { count: number; size: number }>;
export type DiskCleanupResult = {
  results: Record<DiskCategory, { deletedFiles: number; deletedBytes: number; error?: string }>;
};
