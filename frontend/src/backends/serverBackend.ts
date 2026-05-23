import { Config } from '../main/config';
import { EncodeVibeImageInput, ImageAugmentInput, ImageGenInput } from './imageGen';
import { Backend, CleanupOrphansDone, CleanupOrphansError, CleanupOrphansProgress, CleanupOrphansStart, DeleteFolderResult, DeleteProjectResult, DiskCleanupResult, DiskUsageResult, DriveRetryOneResult, DriveRetryResult, DriveRetryStatus, FileEntry, FileStatEntry, QueueFullEvent, QueueFullState, QueueJobMeta, RecursiveListResult, ResizeImageInput } from '../backend';

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
// audit H18 — multi-MB base64 payload (vibe 박힌 queue submit / 이미지 read·write /
// augment / encode-vibe / zip) 호출은 모바일 uplink에서 60초 default로 spurious abort.
// 180초로 늘림. 작은 JSON GET은 default 60초 유지.
const BINARY_API_TIMEOUT_MS = 180_000;
// 폴더 전체 영구 삭제 — N 프로젝트 × (로컬 5 sub-dir + Drive 5 purge + Drive lsf) 직렬 처리.
// <프로젝트> 폴더(22 projects)면 ~5분 가능. 모바일 abort 회피용 넉넉히.
const FOLDER_DELETE_TIMEOUT_MS = 600_000;

// retry: idempotent GET/HEAD에 default 2회. POST/PUT/DELETE는 default 0
// (replay risk 회피). caller가 명시 retries 값 주면 그대로. pm2 restart 중 502
// transient 자동 회복 (P18 audit L975).
const IDEMPOTENT_RETRY_BACKOFF_MS = [500, 1000, 2000];

function isRetriableError(e: any): boolean {
  if (e?.name === 'AbortError') return false; // timeout은 retry 안 함
  const msg = String(e?.message || '');
  // HTTP 5xx
  const m = msg.match(/^API error (\d+):/);
  if (m && parseInt(m[1], 10) >= 500) return true;
  // network error (fetch reject) — TypeError 'Failed to fetch' / 'NetworkError' 등
  if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('network')) return true;
  return false;
}

async function api(
  path: string,
  options?: RequestInit & { timeout?: number; retries?: number },
) {
  const {
    timeout = DEFAULT_API_TIMEOUT_MS,
    retries: retriesOption,
    signal: callerSignal,
    headers,
    method = 'GET',
    ...rest
  } = options ?? {};
  const isIdempotent = method === 'GET' || method === 'HEAD';
  const retries = retriesOption !== undefined ? retriesOption : (isIdempotent ? 2 : 0);

  let lastError: any;
  for (let attempt = 0; attempt <= retries; attempt++) {
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
        method,
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
        lastError = new Error(`API timeout (${timeout}ms): ${path}`);
      } else {
        lastError = e;
      }
      // 마지막 시도면 throw, 아니고 retriable이면 backoff 후 재시도
      if (attempt < retries && isRetriableError(lastError)) {
        const delay = IDEMPOTENT_RETRY_BACKOFF_MS[Math.min(attempt, IDEMPOTENT_RETRY_BACKOFF_MS.length - 1)];
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw lastError;
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    }
  }
  throw lastError;
}

async function apiJSON(path: string, options?: RequestInit & { timeout?: number }) {
  return (await api(path, options)).json();
}

export class ServerBackend extends Backend {
  private ws: WebSocket | null = null;
  private eventHandlers: Map<string, Set<Function>> = new Map();
  private isFirstConnect: boolean = true;
  // audit H17 — onclose 고정 3초 재시도라 서버 다운 시 폭주. exponential backoff
  // + jitter + max 30s 캡 + online 이벤트 reset.
  private reconnectAttempt: number = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    super();
    this.connectWebSocket();
    // online 이벤트 시 backoff reset + 즉시 재연결 시도 — 모바일 백그라운드 복귀 또는
    // wifi 재연결 시 ~30초까지 늘어났던 delay를 0으로 끌어내림.
    window.addEventListener('online', () => {
      this.reconnectAttempt = 0;
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
        this.connectWebSocket();
      }
    });
  }

  private connectWebSocket() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${location.host}${API_BASE}/ws`;
    // audit H17 — 옛 this.ws.onclose/onerror closure는 `this.ws`를 호출 시점에 읽음.
    // 재연결 후 stale handler가 firing되면 새 this.ws를 close시켜 reconnect loop 진입.
    // local `ws` 변수로 closure 고정 + identity 가드로 차단.
    const ws = new WebSocket(wsUrl);
    this.ws = ws;
    // Heartbeat — 클라가 silent stale(iOS Safari WS idle, OS TCP keepalive 끊김 등 onclose
    // 미발화 케이스)을 직접 감지. 30초 주기로 ping 보내고 10초 내 pong 안 오면 ws.close()
    // 명시 트리거 → onclose → 옛 exponential backoff reconnect 흐름 자동 발화.
    const PING_INTERVAL_MS = 30_000;
    const PONG_TIMEOUT_MS = 10_000;
    let pingTimer: ReturnType<typeof setInterval> | null = null;
    let pongTimeout: ReturnType<typeof setTimeout> | null = null;
    const stopHeartbeat = () => {
      if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
      if (pongTimeout) { clearTimeout(pongTimeout); pongTimeout = null; }
    };
    ws.onopen = () => {
      if (this.ws !== ws) return; // stale
      this.reconnectAttempt = 0;
      pingTimer = setInterval(() => {
        if (this.ws !== ws) return;
        if (ws.readyState !== WebSocket.OPEN) return;
        try { ws.send(JSON.stringify({ type: 'ping', t: Date.now() })); } catch {}
        if (pongTimeout) clearTimeout(pongTimeout);
        pongTimeout = setTimeout(() => {
          if (this.ws !== ws) return;
          console.warn('[WS] pong timeout — closing for reconnect');
          try { ws.close(); } catch {}
        }, PONG_TIMEOUT_MS);
      }, PING_INTERVAL_MS);
      // 첫 연결은 skip (constructor에서 별도 init 호출). 재연결만 broadcast.
      if (this.isFirstConnect) {
        this.isFirstConnect = false;
        return;
      }
      const handlers = this.eventHandlers.get('ws-reconnect');
      if (handlers) handlers.forEach((h) => h({}));
    };
    ws.onmessage = (event) => {
      if (this.ws !== ws) return; // stale
      try {
        const msg = JSON.parse(event.data);
        if (msg && msg.type === 'pong') {
          if (pongTimeout) { clearTimeout(pongTimeout); pongTimeout = null; }
          return;
        }
        const handlers = this.eventHandlers.get(msg.type);
        if (handlers) handlers.forEach((h) => h(msg.data));
      } catch (e) {
        // malformed frame 디버깅 visibility — silent swallow는 server 측 버그 발견 어렵게 함.
        console.warn('[WS] malformed message dropped:', e);
      }
    };
    ws.onclose = () => {
      if (this.ws !== ws) return; // stale (이미 다른 ws로 교체됨)
      stopHeartbeat();
      // exponential backoff: 500ms × 2^n, max 30s, ±10% jitter
      const baseDelay = Math.min(30_000, 500 * 2 ** this.reconnectAttempt);
      const jitter = (Math.random() - 0.5) * baseDelay * 0.2;
      const delay = baseDelay + jitter;
      this.reconnectAttempt++;
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.connectWebSocket();
      }, delay);
    };
    ws.onerror = () => {
      if (this.ws !== ws) return; // stale — 새 ws에 영향 X
      ws.close();
    };
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
    // Submit to server queue — returns immediately, server processes in background.
    // body에 vibe base64 박혀 multi-MB일 수 있음 → 180s timeout (H18).
    await api('/queue/add', { method: 'POST', body: JSON.stringify(arg), timeout: BINARY_API_TIMEOUT_MS });
  }

  async queueAddBatch(items: Array<{ params: ImageGenInput; meta?: QueueJobMeta }>): Promise<{ jobIds: string[]; rejected: number }> {
    // batch는 jobs[]에 multiple vibe payload — 단일 submit보다 더 큼 (H18).
    const data = await apiJSON('/queue/add-batch', {
      method: 'POST',
      body: JSON.stringify({ jobs: items }),
      timeout: BINARY_API_TIMEOUT_MS,
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

  async driveRetryNow(): Promise<DriveRetryResult> {
    return apiJSON('/drive/retry-now', { method: 'POST' });
  }

  async driveRetryOne(localPath: string): Promise<DriveRetryOneResult> {
    return apiJSON('/drive/retry-one', {
      method: 'POST',
      body: JSON.stringify({ localPath }),
    });
  }

  async driveRetryDismiss(localPath: string): Promise<void> {
    await api('/drive/retry-dismiss', {
      method: 'POST',
      body: JSON.stringify({ localPath }),
    });
  }

  async startExportScenePack(opts: {
    paths: Array<{ srcPath: string; finalName: string }>;
    outFilePath: string;
    optimize: 'none' | 'lossy' | 'lossless' | 'avif';
    imageSize: number;
    nestedByPrefix?: boolean;
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
    // arg.image는 multi-MB base64 → 180s timeout (H18).
    await api('/augment', { method: 'POST', body: JSON.stringify(arg), timeout: BINARY_API_TIMEOUT_MS });
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
    // arg.image base64 multi-MB → 180s timeout (H18).
    return (await apiJSON('/image/encode-vibe', { method: 'POST', body: JSON.stringify(arg), timeout: BINARY_API_TIMEOUT_MS })).result;
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
    // zip 생성은 N 파일 read + stream archive → 수분 가능 (H18).
    const data = await apiJSON('/fs/zip', { method: 'POST', body: JSON.stringify({ files, outPath }), timeout: BINARY_API_TIMEOUT_MS });
    return { skipped: Array.isArray(data.skipped) ? data.skipped : [] };
  }

  async unzipFiles(tarPath: string, outPath: string): Promise<void> {
    // unzip은 archive 안 파일 수에 비례 → 180s timeout (H18).
    await api('/fs/unzip', { method: 'POST', body: JSON.stringify({ tarPath, outPath }), timeout: BINARY_API_TIMEOUT_MS });
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
    // Workflows M: 64KB 누적 cap 도달 시 navigator.sendBeacon fallback. sendBeacon은
    // body size limit이 더 관대 (브라우저별 다르지만 보통 64KB ~ 64MB+) + true return으로
    // 즉시 queue 보장. payload Blob으로 보내야 함.
    const body = JSON.stringify({ path: filename, data });
    try {
      const sent = fetch(`${API_BASE}/api/fs/write`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      });
      sent.catch(() => {
        // fetch 실패 시 sendBeacon 폴백 시도. unload 중에도 동작.
        try {
          if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
            const blob = new Blob([body], { type: 'application/json' });
            navigator.sendBeacon(`${API_BASE}/api/fs/write`, blob);
          }
        } catch {}
      });
    } catch {
      // body 크기 초과 등 fetch 생성 자체 실패 — sendBeacon으로 폴백.
      try {
        if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
          const blob = new Blob([body], { type: 'application/json' });
          navigator.sendBeacon(`${API_BASE}/api/fs/write`, blob);
        }
      } catch {}
    }
  }

  async copyFile(src: string, dest: string): Promise<void> {
    await api('/fs/copy', { method: 'POST', body: JSON.stringify({ src, dest }) });
  }

  async readDataFile(arg: string): Promise<string> {
    // multi-MB base64 download → 180s timeout (H18).
    return (await apiJSON(`/fs/read-data?path=${encodeURIComponent(arg)}`, { timeout: BINARY_API_TIMEOUT_MS })).content;
  }

  async writeDataFile(filename: string, data: string): Promise<void> {
    // multi-MB base64 upload → 180s timeout (H18).
    await api('/fs/write-data', { method: 'POST', body: JSON.stringify({ path: filename, data }), timeout: BINARY_API_TIMEOUT_MS });
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
    // Chrome 데스크탑 user activation 보존 패턴: fetch await 후 clipboard.write를
    // 직접 호출하면 activation이 만료돼 NotAllowedError. ClipboardItem에 Promise<Blob>를
    // 직접 넘기면 Chrome이 resolve까지 activation 유지. 옛 패턴은 sync blob 전달 후
    // catch에서 silent — 사용자가 실패 자체를 모름. 이번엔 throw + 호출측 toast.
    // audit H20 — 30초 defensive timeout (네트워크 hang 시 blob retain 방지).
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30_000);
    const blobPromise = (async () => {
      try {
        const res = await fetch(
          `${API_BASE}/api/fs/image?path=${encodeURIComponent(imagePath)}`,
          { signal: controller.signal },
        );
        if (!res.ok) throw new Error(`이미지 fetch 실패 (HTTP ${res.status})`);
        const raw = await res.blob();
        // Chrome/Safari/Firefox 데스크탑 모두 image/png는 안정 지원. .png 외 확장자도
        // PNG로 라벨링하면 raw 바이트가 PNG 시그니처면 그대로 붙고, 아니면 paste 측에서 거부.
        // 우리 cache는 .png가 default라 99% 케이스는 PNG.
        return new Blob([await raw.arrayBuffer()], { type: 'image/png' });
      } finally {
        clearTimeout(timeoutId);
      }
    })();
    await navigator.clipboard.write([
      new ClipboardItem({ 'image/png': blobPromise }),
    ]);
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

  async deleteFolderNow(folder: string): Promise<DeleteFolderResult> {
    return await apiJSON('/project/delete-folder-now', { method: 'POST', body: JSON.stringify({ folder }), timeout: FOLDER_DELETE_TIMEOUT_MS });
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

  async getDiskUsage(): Promise<DiskUsageResult> {
    return await apiJSON('/disk/usage');
  }

  async cleanupDisk(targets: string[]): Promise<DiskCleanupResult> {
    // 큰 폴더(예: outs/exports 다 GB 단위)는 fs.rm 직렬이라 수십초 가능. iOS Safari
    // default 60s timeout으로 spurious abort 회피 위해 FOLDER_DELETE_TIMEOUT_MS 사용.
    return await apiJSON('/disk/cleanup', {
      method: 'POST',
      body: JSON.stringify({ targets }),
      timeout: FOLDER_DELETE_TIMEOUT_MS,
    });
  }

  onDownloadProgress(callback: (progress: any) => void): () => void { return this.on('download-progress', callback); }
  onZipProgress(callback: (progress: any) => void): () => void { return this.on('zip-progress', callback); }
  onImageChanged(callback: (path: string) => void): () => void { return this.on('image-changed', callback); }
  onQueueStatus(callback: (data: any) => void): () => void { return this.on('queue-status', callback); }
  onQueueJobStart(callback: (data: { jobId: string; pending: number; meta: QueueJobMeta }) => void): () => void { return this.on('queue-job-start', callback); }
  onQueueJobComplete(callback: (data: { jobId: string; outputFilePath?: string; meta: QueueJobMeta }) => void): () => void { return this.on('queue-job-complete', callback); }
  onQueueJobError(callback: (data: { jobId: string; error: string; meta: QueueJobMeta }) => void): () => void { return this.on('queue-job-error', callback); }
  onQueueFull(callback: (data: QueueFullEvent) => void): () => void { return this.on('queue-full', callback); }
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
