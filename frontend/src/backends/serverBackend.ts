import { Config } from '../../main/config';
import { EncodeVibeImageInput, ImageAugmentInput, ImageGenInput } from './imageGen';
import { Backend, FileEntry, FileStatEntry, ImageOptimizeMethod, ResizeImageInput } from '../backend';

const API_BASE = (() => {
  // Auto-detect base path from current URL (e.g. /nai when served at /nai/)
  const path = location.pathname;
  if (path.startsWith('/studio')) return '/studio';
  return '';
})();

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

async function api(path: string, options?: RequestInit) {
  const res = await fetch(`${API_BASE}/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return res;
}

async function apiJSON(path: string, options?: RequestInit) {
  const res = await api(path, options);
  return res.json();
}

export class ServerBackend extends Backend {
  private ws: WebSocket | null = null;
  private eventHandlers: Map<string, Set<Function>> = new Map();

  constructor() {
    super();
    this.connectWebSocket();
  }

  private connectWebSocket() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${location.host}${API_BASE}/ws`;
    this.ws = new WebSocket(wsUrl);
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

  async augmentImage(arg: ImageAugmentInput): Promise<void> {
    await api('/augment', { method: 'POST', body: JSON.stringify(arg) });
  }

  async login(email: string, password: string): Promise<void> {
    await api('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  }

  async loginWithToken(token: string): Promise<void> {
    await api('/auth/login-token', { method: 'POST', body: JSON.stringify({ token }) });
  }

  async encodeVibeImage(arg: EncodeVibeImageInput): Promise<string> {
    return (await apiJSON('/image/encode-vibe', { method: 'POST', body: JSON.stringify(arg) })).result;
  }

  async showFile(arg: string): Promise<void> {
    window.open(`${API_BASE}/api/fs/show?path=${encodeURIComponent(arg)}`, '_blank');
  }

  async copyToDownloads(path: string): Promise<void> {
    const a = document.createElement('a');
    a.href = `${API_BASE}/api/fs/download?path=${encodeURIComponent(path)}`;
    a.download = path.split('/').pop() || 'download';
    a.click();
  }

  async zipFiles(files: FileEntry[], outPath: string): Promise<void> {
    await api('/fs/zip', { method: 'POST', body: JSON.stringify({ files, outPath }) });
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

  async listFiles(arg: string): Promise<string[]> { return apiJSON(`/fs/list?path=${encodeURIComponent(arg)}`); }

  async listFilesWithStats(arg: string): Promise<FileStatEntry[]> {
    return apiJSON(`/fs/list-stats?path=${encodeURIComponent(arg)}`);
  }

  async readFile(filename: string): Promise<string> { return (await apiJSON(`/fs/read?path=${encodeURIComponent(filename)}`)).content; }

  async writeFile(filename: string, data: string): Promise<void> {
    await api('/fs/write', { method: 'POST', body: JSON.stringify({ path: filename, data }) });
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

  async trashFile(filename: string): Promise<void> { await this.deleteFile(filename); }
  async selectDir(): Promise<string | undefined> { return undefined; }
  async selectFile(): Promise<string | undefined> { return undefined; }
  async selectFiles(_options?: any): Promise<string[]> { return []; }

  async readBinaryFile(filePath: string): Promise<string> {
    return (await apiJSON(`/fs/read-data?path=${encodeURIComponent(filePath)}`)).content;
  }

  async close(): Promise<void> {}
  async existFile(filename: string): Promise<boolean> { return (await apiJSON(`/fs/exists?path=${encodeURIComponent(filename)}`)).exists; }

  async download(url: string, dest: string, filename: string): Promise<void> {
    await api('/fs/download-url', { method: 'POST', body: JSON.stringify({ url, dest, filename }) });
  }

  async resizeImage(input: ResizeImageInput): Promise<void> {
    await api('/image/resize', { method: 'POST', body: JSON.stringify(input) });
  }

  async openImageEditor(_inputPath: string): Promise<void> {}
  async watchImage(_inputPath: string): Promise<void> {}
  async unwatchImage(_inputPath: string): Promise<void> {}
  async loadModel(_modelPath: string): Promise<void> {}

  async extractZip(zipPath: string, outPath: string): Promise<void> {
    await api('/fs/extract-zip', { method: 'POST', body: JSON.stringify({ zipPath, outPath }) });
  }

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

  onDownloadProgress(callback: (progress: any) => void): () => void { return this.on('download-progress', callback); }
  onZipProgress(callback: (progress: any) => void): () => void { return this.on('zip-progress', callback); }
  onImageChanged(callback: (path: string) => void): () => void { return this.on('image-changed', callback); }
  onQueueStatus(callback: (data: any) => void): () => void { return this.on('queue-status', callback); }
  onQueueJobComplete(callback: (data: any) => void): () => void { return this.on('queue-job-complete', callback); }
  onQueueJobError(callback: (data: any) => void): () => void { return this.on('queue-job-error', callback); }
  onClose(callback: () => void): () => void { return this.on('close', callback); }
}
