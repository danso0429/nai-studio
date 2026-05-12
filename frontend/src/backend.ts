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
  count: number;
  pendingCount: number;
  failedCount: number;
  intervalsMs: number[];
  maxAttempts: number;
  entries: DriveRetryEntry[];
}

// 클라가 큐 push 시 task 매핑용으로 함께 보내는 메타데이터.
// 페이지 로드 시 GET /api/queue/full-state로 회수해 task 복원.
export interface QueueJobMeta {
  taskId?: string;        // 같은 task에 속한 jobs 그룹화
  cls?: number;           // task handler index (gen-fast / gen-slow / inpaint-* 구분)
  sceneKey?: string;      // sceneStats 매핑용 (session/type/sceneName)
  sceneName?: string;     // 표시용
  taskType?: string;      // 'gen' | 'inpaint' | 'i2i' 등
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
  }>;
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
  abstract getDriveRetryStatus(): Promise<DriveRetryStatus>;
  abstract driveRetryNow(): Promise<void>;
  abstract driveRetryDismiss(localPath: string): Promise<void>;
  abstract driveRetryReset(localPath: string): Promise<void>;
  abstract augmentImage(arg: ImageAugmentInput): Promise<void>;
  abstract login(email: string, password: string): Promise<void>;
  abstract loginWithToken(token: string): Promise<void>;
  abstract encodeVibeImage(arg: EncodeVibeImageInput): Promise<string>;
  abstract showFile(arg: string): Promise<void>;
  abstract copyToDownloads(path: string): Promise<void>;
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
}
