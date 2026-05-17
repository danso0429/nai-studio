import { Config } from '../main/config';
import { EncodeVibeImageInput, ImageAugmentInput, ImageGenInput } from './imageGen';
import { Backend, CleanupOrphansDone, CleanupOrphansError, CleanupOrphansProgress, CleanupOrphansStart, DeleteProjectResult, DriveRetryStatus, FileEntry, FileStatEntry, QueueFullState, QueueJobMeta, RecursiveListResult, ResizeImageInput } from '../backend';

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

/**
 * Returns a direct URL for serving a thumbnail image.
 * Bypasses the base64-via-JSON pipeline for better gallery performance.
 */
export function getThumbURL(filePath: string, size: number, revision?: number): string {
  let url = `${API_BASE}/api/fs/thumb?path=${encodeURIComponent(filePath)}&size=${size}`;
  if (revision !== undefined) url += `&v=${revision}`;
  return url;
}

/**
 * Returns a direct URL for serving an image file.
 */
export function getImageURL(filePath: string): string {
  return `${API_BASE}/api/fs/image?path=${encodeURIComponent(filePath)}`;
}

// 모든 API 호출의 default timeout. 인터넷이 매우 느릴 때 무한 대기를 막기 위함.
// 호출처가 timeout 옵션을 명시하면 그 값이 우선. signal을 직접 넘기면 호출처
// 책임으로 위임 (timeout 미적용).
const DEFAULT_API_TIMEOUT_MS = 60_000;

async function api(
  path: string,
  options?: RequestInit & { timeout?: number },
) {
  const {
    timeout = DEFAULT_API_TIMEOUT_MS,
    signal: callerSignal,
    headers,
    ...rest
  } = options ?? {};
  let signal: AbortSignal | undefined = callerSignal ?? undefined;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  if (!signal) {
    const controller = new AbortController();
    signal = controller.signal;
    timeoutId = setTimeout(() => controller.abort(), timeout);
  }
  try {
    const res = await fetch(`${API_BASE}/api${path}`, {
      ...rest,
      signal,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`API error ${res.status}: ${text}`);
    }
    return res;
  } catch (e: any) {
    if (e?.name === 'AbortError' && timeoutId !== undefined) {
      throw new Error(`API timeout (${timeout}ms): ${path}`);
    }
    throw e;
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

async function apiJSON(path: string, options?: RequestInit) {
  return (await api(path, options)).json();
}

export class ServerBackend extends Backend {
  private ws: WebSocket | null = null;
  private eventHandlers: Map<string, Set<Function>> = new Map();
  private isFirstConnect: boolean = true;

  constructor() {
    super();
    this.connectWebSocket();
  }

  private connectWebSocket() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${location.host}${API_BASE}/ws`;
    this.ws = new WebSocket(wsUrl);
    this.ws.onopen = () => {
      // 첫 연결은 skip (constructor에서 별도 init 호출). 재연결만 broadcast.
      if (this.isFirstConnect) {
        this.isFirstConnect = false;
        return;
      }
      const handlers = this.eventHandlers.get('ws-reconnect');
      if (handlers) handlers.forEach((h) => h({}));
    };
    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        const handlers = this.eventHandlers.get(msg.type);
        if (handlers) handlers.forEach((h) => h(msg.data));
      } catch (e) {}
    };
    this.ws.onclose = () => { setTimeout(() => this.connectWebSocket(), 3000); };
    this.ws.onerror = () => { this.ws?.close(); };
  }

  private on(type: string, handler: Function): () => void {
    if (!this.eventHandlers.has(type)) this.eventHandlers.set(type, new Set());
    this.eventHandlers.get(type)!.add(handler);
    return () => { this.eventHandlers.get(type)?.delete(handler); };
  }

  async getConfig(): Promise<Config> { return apiJSON('/config'); }
  async setConfig(newConfig: Config): Promise<void> { await api('/config', { method: 'POST', body: JSON.stringify(newConfig) }); }
  async getVersion(): Promise<string> { return (await apiJSON('/version')).version; }
  async openWebPage(url: string): Promise<void> { window.open(url, '_blank'); }

  async generateImage(arg: ImageGenInput): Promise<void> {
    // Submit to server queue — returns immediately, server processes in background
    await api('/queue/add', { method: 'POST', body: JSON.stringify(arg) });
  }

  async queueAddBatch(items: Array<{ params: ImageGenInput; meta?: QueueJobMeta }>): Promise<{ jobIds: string[]; rejected: number }> {
    const data = await apiJSON('/queue/add-batch', {
      method: 'POST',
      body: JSON.stringify({ jobs: items }),
    });
    return { jobIds: data.jobIds || [], rejected: data.rejected || 0 };
  }

  async queueGetFullState(): Promise<QueueFullState> {
    return apiJSON('/queue/full-state');
  }

  async pauseQueue(): Promise<void> {
    // server in-flight job 완료 후 응답 (대량 삭제 race 방지)
    await api('/queue/pause', { method: 'POST' });
  }

  async resumeQueue(): Promise<void> {
    await api('/queue/resume', { method: 'POST' });
  }

  async cancelQueue(): Promise<{ cancelled: number }> {
    const data = await apiJSON('/queue/cancel', { method: 'POST' });
    return { cancelled: data.cancelled || 0 };
  }

  async cancelQueueByTaskIds(taskIds: string[]): Promise<{ cancelled: number }> {
    const data = await apiJSON('/queue/cancel-by-task-ids', {
      method: 'POST',
      body: JSON.stringify({ taskIds }),
    });
    return { cancelled: data.cancelled || 0 };
  }

  async queuePrioritize(taskIds: string[], priority: boolean): Promise<{ changed: number }> {
    const data = await apiJSON('/queue/prioritize', {
      method: 'POST',
      body: JSON.stringify({ taskIds, priority }),
    });
    return { changed: data.changed || 0 };
  }

  async getDriveRetryStatus(): Promise<DriveRetryStatus> {
    return apiJSON('/drive/retry-status');
  }

  async driveRetryNow(): Promise<void> {
    await api('/drive/retry-now', { method: 'POST' });
  }

  async driveRetryDismiss(localPath: string): Promise<void> {
    await api('/drive/retry-dismiss', {
      method: 'POST',
      body: JSON.stringify({ localPath }),
    });
  }

  async driveRetryReset(localPath: string): Promise<void> {
    await api('/drive/retry-reset', {
      method: 'POST',
      body: JSON.stringify({ localPath }),
    });
  }

  async startExportScenePack(opts: {
    paths: Array<{ srcPath: string; finalName: string }>;
    outFilePath: string;
    optimize: 'none' | 'lossy' | 'lossless' | 'avif';
    imageSize: number;
  }): Promise<{ jobId: string; queued: boolean }> {
    const data = await apiJSON('/export/scene-pack', {
      method: 'POST',
      body: JSON.stringify(opts),
    });
    return { jobId: data.jobId, queued: !!data.queued };
  }

  async cancelExportScenePack(jobId: string): Promise<void> {
    await apiJSON('/export/cancel', {
      method: 'POST',
      body: JSON.stringify({ jobId }),
    });
  }

  async getExportStatus(): Promise<{
    active: Array<{ jobId: string; outFileName: string; phase: string; done: number; total: number; startedAt: number; canceled?: boolean }>;
    waiting: Array<{ jobId: string; outFileName: string; total: number }>;
    concurrency: number;
  }> {
    return apiJSON('/export/status');
  }

  async augmentImage(arg: ImageAugmentInput): Promise<void> {
    await api('/augment', { method: 'POST', body: JSON.stringify(arg) });
  }

  async login(email: string, password: string): Promise<void> {
    await api('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  }

  async loginWithToken(token: string): Promise<void> {
    await api('/auth/login-token', { method: 'POST', body: JSON.stringify({ token }) });
  }

  async authStatus(): Promise<boolean> {
    return (await apiJSON('/auth/status')).loggedIn;
  }

  async encodeVibeImage(arg: EncodeVibeImageInput): Promise<string> {
    return (await apiJSON('/image/encode-vibe', { method: 'POST', body: JSON.stringify(arg) })).result;
  }

  async showFile(arg: string): Promise<void> {
    window.open(`${API_BASE}/api/fs/show?path=${encodeURIComponent(arg)}`, '_blank');
  }

  async copyToDownloads(path: string, downloadName?: string): Promise<void> {
    const a = document.createElement('a');
    a.href = `${API_BASE}/api/fs/download?path=${encodeURIComponent(path)}`;
    a.download = downloadName || path.split('/').pop() || 'download';
    a.click();
  }

  async zipFiles(files: FileEntry[], outPath: string): Promise<{ skipped: string[] }> {
    const data = await apiJSON('/fs/zip', { method: 'POST', body: JSON.stringify({ files, outPath }) });
    return { skipped: Array.isArray(data.skipped) ? data.skipped : [] };
  }

  async unzipFiles(tarPath: string, outPath: string): Promise<void> {
    await api('/fs/unzip', { method: 'POST', body: JSON.stringify({ tarPath, outPath }) });
  }

  async searchTags(word: string): Promise<any> { return apiJSON(`/tags/search?q=${encodeURIComponent(word)}`); }
  async lookupTag(word: string): Promise<any> { return apiJSON(`/tags/lookup?q=${encodeURIComponent(word)}`); }

  async loadPiecesDB(pieces: string[]): Promise<void> {
    await api('/pieces/load', { method: 'POST', body: JSON.stringify({ pieces }) });
  }

  async searchPieces(word: string): Promise<any> { return apiJSON(`/pieces/search?q=${encodeURIComponent(word)}`); }

  // 옵션 C 단계 B: 단계 A의 silent fallback wrap 제거. 5xx면 그대로 throw.
  // 호출처 정독 결과 ImageService.refresh + GameService.createGame 2군데만 try/catch
  // 없었음 → 자체 try/catch 추가. SessionService(ignoreError)/refreshBatch(retry)/
  // useTournament(상위 try)/TrashService/AppService recover & merge는 자기 try/catch.
  async listFiles(arg: string): Promise<string[]> { return apiJSON(`/fs/list?path=${encodeURIComponent(arg)}`); }
  async listFilesRecursive(arg: string, depth?: number): Promise<RecursiveListResult> {
    const d = depth !== undefined ? `&depth=${depth}` : '';
    return apiJSON(`/fs/list-recursive?path=${encodeURIComponent(arg)}${d}`);
  }

  async listFilesWithStats(arg: string): Promise<FileStatEntry[]> {
    return apiJSON(`/fs/list-stats?path=${encodeURIComponent(arg)}`);
  }

  async readFile(filename: string): Promise<string> { return (await apiJSON(`/fs/read?path=${encodeURIComponent(filename)}`)).content; }

  async writeFile(filename: string, data: string): Promise<void> {
    await api('/fs/write', { method: 'POST', body: JSON.stringify({ path: filename, data }) });
  }

  writeFileKeepalive(filename: string, data: string): void {
    // visibilitychange/pagehide에서 호출. await 안 함 — fire-and-forget.
    // keepalive:true는 page unload 이후에도 브라우저가 request 완료 보장 (iOS Safari 14.5+).
    // body 64KB total 한도 — 한 page lifecycle 안에서 keepalive 합산 기준.
    try {
      const body = JSON.stringify({ path: filename, data });
      fetch(`${API_BASE}/api/fs/write`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      }).catch(() => {
        // unload 중이라 fetch가 reject되어도 무시 (브라우저가 백그라운드에서 시도).
      });
    } catch {
      // body 크기 초과로 fetch 생성 자체 실패 — 무시.
    }
  }

  async copyFile(src: string, dest: string): Promise<void> {
    await api('/fs/copy', { method: 'POST', body: JSON.stringify({ src, dest }) });
  }

  async readDataFile(arg: string): Promise<string> { return (await apiJSON(`/fs/read-data?path=${encodeURIComponent(arg)}`)).content; }

  async writeDataFile(filename: string, data: string): Promise<void> {
    await api('/fs/write-data', { method: 'POST', body: JSON.stringify({ path: filename, data }) });
  }

  async writeDataFileAbsolute(absolutePath: string, data: string): Promise<void> {
    await api('/fs/write-data', { method: 'POST', body: JSON.stringify({ path: absolutePath, data, absolute: true }) });
  }

  async existFileAbsolute(absolutePath: string): Promise<boolean> {
    return (await apiJSON(`/fs/exists?path=${encodeURIComponent(absolutePath)}&absolute=true`)).exists;
  }

  async renameFile(oldfile: string, newfile: string): Promise<void> {
    await api('/fs/rename', { method: 'POST', body: JSON.stringify({ oldPath: oldfile, newPath: newfile }) });
  }

  async renameDir(oldfile: string, newfile: string): Promise<void> {
    await api('/fs/rename-dir', { method: 'POST', body: JSON.stringify({ oldPath: oldfile, newPath: newfile }) });
  }

  async deleteFile(filename: string): Promise<void> {
    await api('/fs/delete', { method: 'POST', body: JSON.stringify({ path: filename }) });
  }

  async deleteBatch(paths: string[]): Promise<void> {
    await api('/fs/delete-batch', { method: 'POST', body: JSON.stringify({ paths }) });
  }

  async moveBatch(moves: { src: string; dest: string }[]): Promise<void> {
    await api('/fs/move-batch', { method: 'POST', body: JSON.stringify({ moves }) });
  }

  async deleteDir(filename: string): Promise<void> {
    await api('/fs/delete-dir', { method: 'POST', body: JSON.stringify({ path: filename }) });
  }

  // 웹 모드에선 휴지통 거치지 않고 즉시 영구 삭제 (deleteFile alias).
  async trashFile(filename: string): Promise<void> { await this.deleteFile(filename); }
  async selectDir(): Promise<string | undefined> { return undefined; }
  async selectFile(): Promise<string | undefined> { return undefined; }
  async selectFiles(_options?: any): Promise<string[]> { return []; }

  async readBinaryFile(filePath: string): Promise<string> {
    return (await apiJSON(`/fs/read-data?path=${encodeURIComponent(filePath)}`)).content;
  }

  async close(): Promise<void> {}
  async existFile(filename: string): Promise<boolean> { return (await apiJSON(`/fs/exists?path=${encodeURIComponent(filename)}`)).exists; }

  async download(_url: string, _dest: string, _filename: string): Promise<void> {
    // Endpoint removed (SSRF surface, no callers). If a future feature needs URL-based downloads,
    // re-introduce with private-IP filtering and a domain whitelist.
    throw new Error('download() is not supported in web mode');
  }

  async resizeImage(input: ResizeImageInput): Promise<void> {
    await api('/image/resize', { method: 'POST', body: JSON.stringify(input) });
  }

  async openImageEditor(_inputPath: string): Promise<void> {}
  async watchImage(_inputPath: string): Promise<void> {}
  async unwatchImage(_inputPath: string): Promise<void> {}
  async loadModel(_modelPath: string): Promise<void> {}

  async copyImageToClipboard(imagePath: string): Promise<void> {
    try {
      const res = await fetch(`${API_BASE}/api/fs/image?path=${encodeURIComponent(imagePath)}`);
      const blob = await res.blob();
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
    } catch (e) { console.error('Clipboard copy failed:', e); }
  }

  async spawnLocalAI(): Promise<void> {}
  async isLocalAIRunning(): Promise<boolean> { return false; }

  async getRemainCredits(): Promise<number> {
    return (await apiJSON('/auth/credits')).credits;
  }

  async removeBackground(inputImageBase64: string, outputPath: string): Promise<void> {
    await api('/image/remove-bg', { method: 'POST', body: JSON.stringify({ image: inputImageBase64, outputPath }) });
  }

  async deleteProjectNow(name: string): Promise<DeleteProjectResult> {
    return await apiJSON('/project/delete-now', { method: 'POST', body: JSON.stringify({ name }) });
  }

  async cleanupOrphans(): Promise<CleanupOrphansStart> {
    return await apiJSON('/project/cleanup-orphans', { method: 'POST' });
  }

  onCleanupOrphansStart(callback: (data: { jobId: string }) => void): () => void {
    return this.on('cleanup-orphans-start', callback);
  }
  onCleanupOrphansProgress(callback: (data: CleanupOrphansProgress) => void): () => void {
    return this.on('cleanup-orphans-progress', callback);
  }
  onCleanupOrphansDone(callback: (data: CleanupOrphansDone) => void): () => void {
    return this.on('cleanup-orphans-done', callback);
  }
  onCleanupOrphansError(callback: (data: CleanupOrphansError) => void): () => void {
    return this.on('cleanup-orphans-error', callback);
  }

  onDownloadProgress(callback: (progress: any) => void): () => void { return this.on('download-progress', callback); }
  onZipProgress(callback: (progress: any) => void): () => void { return this.on('zip-progress', callback); }
  onImageChanged(callback: (path: string) => void): () => void { return this.on('image-changed', callback); }
  onQueueStatus(callback: (data: any) => void): () => void { return this.on('queue-status', callback); }
  onQueueJobStart(callback: (data: { jobId: string; pending: number; meta: QueueJobMeta }) => void): () => void { return this.on('queue-job-start', callback); }
  onQueueJobComplete(callback: (data: { jobId: string; outputFilePath?: string; meta: QueueJobMeta }) => void): () => void { return this.on('queue-job-complete', callback); }
  onQueueJobError(callback: (data: { jobId: string; error: string; meta: QueueJobMeta }) => void): () => void { return this.on('queue-job-error', callback); }
  onWsReconnect(callback: () => void): () => void { return this.on('ws-reconnect', callback); }
  onDriveSyncComplete(callback: (data: { localPath: string; requestedPath: string | null; fileName: string }) => void): () => void {
    return this.on('drive-sync-complete', callback);
  }
  onDriveSyncFailed(callback: (data: { localPath: string; requestedPath: string | null; fileName: string; error: string; willRetry: boolean; attempts: number; nextRetryAt: number | null }) => void): () => void {
    return this.on('drive-sync-failed', callback);
  }
  onExportProgress(callback: (data: { jobId: string; phase: 'resize' | 'zip'; done: number; total: number }) => void): () => void {
    return this.on('export-progress', callback);
  }
  onExportComplete(callback: (data: { jobId: string; outFilePath: string; included: number; skipped: string[] }) => void): () => void {
    return this.on('export-complete', callback);
  }
  onExportFailed(callback: (data: { jobId: string; phase: string; error: string }) => void): () => void {
    return this.on('export-failed', callback);
  }
  onClose(callback: () => void): () => void { return this.on('close', callback); }
}
