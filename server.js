const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const fss = require('fs');
const http = require('http');
const { WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');
const { NaiClient } = require('./lib/nai-client');
const tagSearch = require('./lib/tag-search');
const versionCheck = require('./lib/version-check');

const DATA_DIR = path.join(__dirname, 'data');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const PORT = process.env.PORT || 6247;
const URL_PREFIX = process.env.URL_PREFIX || '';
// rclone Google Drive remote 이름. 'rclone config'로 만든 remote와 동일해야 함.
const RCLONE_REMOTE = process.env.RCLONE_REMOTE || 'gdrivemain';
const RCLONE_REMOTE_BASE = process.env.RCLONE_REMOTE_BASE || 'NAI-Studio';

// ─── Ensure directories ────────────────────────────────────────────
async function ensureDirs() {
  const dirs = ['data', 'data/projects', 'data/outs', 'data/vibes',
    'data/inpaints', 'data/inpaint_orgs', 'data/inpaint_masks', 'data/tmp'];
  for (const d of dirs) {
    await fs.mkdir(path.join(__dirname, d), { recursive: true });
  }
}

// ─── Config ─────────────────────────────────────────────────────────
async function loadConfig() {
  try {
    return JSON.parse(await fs.readFile(CONFIG_PATH, 'utf-8'));
  } catch {
    const def = {};
    await fs.writeFile(CONFIG_PATH, JSON.stringify(def));
    return def;
  }
}

// ─── NAI Client ─────────────────────────────────────────────────────
const nai = new NaiClient();

// ─── WebSocket broadcast ────────────────────────────────────────────
let wss;
function broadcast(type, data) {
  if (!wss) return;
  const msg = JSON.stringify({ type, data });
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(msg);
  });
}

// ─── File helpers ───────────────────────────────────────────────────
function resolvePath(p) {
  // All paths are relative to DATA_DIR
  const resolved = path.resolve(DATA_DIR, p);
  // Phase 7C: + path.sep 검증으로 'data2' 같은 sibling 경로 통과 방지
  if (resolved !== DATA_DIR && !resolved.startsWith(DATA_DIR + path.sep)) {
    throw new Error('Path traversal detected');
  }
  return resolved;
}

// ─── Sharp (optional) ───────────────────────────────────────────────
let sharp;
try {
  sharp = require('sharp');
} catch {
  console.warn('[NAI Studio] sharp not available, image resize disabled');
}

// Generate 200/400/500 thumbnails for the given output file into its fastcache/ sibling.
// `source` is a free-form tag included in error log prefix ('queue' or 'direct').
async function prewarmThumbnails(outPath, relativeFilePath, source) {
  if (!sharp) return;
  for (const size of [200, 400, 500]) {
    try {
      const pp = relativeFilePath.split('/');
      const fn = size + '_' + pp.pop();
      pp.push('fastcache', fn);
      const cp = resolvePath(pp.join('/'));
      await fs.mkdir(path.dirname(cp), { recursive: true });
      const maxDim = Math.ceil((size <= 200 ? 1.25 : 1.1) * size);
      await sharp(outPath).resize(maxDim, maxDim, { fit: 'inside', withoutEnlargement: true }).png().toFile(cp);
    } catch (e) { console.error('[Prewarm ' + source + '] size=' + size + ' error:', e.message); }
  }
}

// ─── Server-side generation queue ───────────────────────────────
const genQueue = [];
let queueProcessing = false;
let queuePaused = false;
let pauseRequested = false; // 사용자 명시 pause (대량 삭제 등 race 방지용)
let queueStats = { completed: 0, failed: 0, totalProcessTimeMs: 0, completedWithTiming: 0 };
// 최근 큐 에러 ring buffer (NAI 429, 5xx, 네트워크 등). queue.html 진단용.
const QUEUE_ERROR_HISTORY_MAX = 20;
let queueErrorHistory = []; // [{ts, jobId, error, kind: '429'|'5xx'|'other', retried: boolean}, ...]
function recordQueueError(jobId, error, retried, meta) {
  let kind = 'other';
  const msg = String(error || '');
  if (msg.includes('429')) kind = '429';
  else if (/5\d\d/.test(msg.slice(0, 50))) kind = '5xx';
  queueErrorHistory.push({
    ts: Date.now(),
    jobId,
    error: msg.slice(0, 500),
    kind,
    retried: !!retried,
    meta: meta || {},
  });
  if (queueErrorHistory.length > QUEUE_ERROR_HISTORY_MAX) {
    queueErrorHistory.shift();
  }
}

// ─── Timing history (raw, 2일 retention) + aggregate stats (영구) ──
// raw: [{finishedAt: ts, durationMs: number}, ...]. 시각 패턴 분석/sparkline용.
// stats: 1시간 단위 24개 bucket + allTime aggregate. raw가 prune돼도 영구 보존.
// (2026-05-13 본인 요청으로 2시간 → 1시간 단위 변경)
let timingHistory = [];
const TIMING_RETENTION_MS = 2 * 24 * 60 * 60 * 1000; // 2일
const TIMING_HISTORY_HARD_CAP = 100000; // 안전망 (정상은 age 기반 prune)
const TIMING_HISTORY_FILE = path.join(DATA_DIR, '.queue_timing.json');

// 24 bucket = 1시간 단위 (0=[0,1), 1=[1,2), ..., 23=[23,24)). KST 기준 (본인 시간대).
const TIMING_BUCKET_COUNT = 24;
const TIMING_BUCKET_HOURS = 24 / TIMING_BUCKET_COUNT;
const TIMING_TZ = 'Asia/Seoul';
const TIMING_TZ_OFFSET_MS = 9 * 60 * 60 * 1000; // KST = UTC+9
function bucketIndexFor(ts) {
  // 서버는 UTC, 본인은 KST. ts에 KST offset을 가산하고 UTC 메서드로 시각 추출 → KST hour.
  return Math.floor(new Date(ts + TIMING_TZ_OFFSET_MS).getUTCHours() / TIMING_BUCKET_HOURS);
}
let timingStats = {
  buckets: Array.from({ length: TIMING_BUCKET_COUNT }, () => ({ count: 0, totalMs: 0 })),
  allTime: { count: 0, totalMs: 0 },
  tz: TIMING_TZ,
};
const TIMING_STATS_FILE = path.join(DATA_DIR, '.queue_timing_stats.json');

function pruneTimingHistory() {
  const cutoff = Date.now() - TIMING_RETENTION_MS;
  let removed = 0;
  while (timingHistory.length > 0 && timingHistory[0].finishedAt < cutoff) {
    timingHistory.shift();
    removed++;
  }
  // 하드 캡 (이론상 도달 어렵지만 안전망)
  while (timingHistory.length > TIMING_HISTORY_HARD_CAP) {
    timingHistory.shift();
    removed++;
  }
  return removed;
}

function recordTiming(finishedAt, durationMs) {
  timingHistory.push({ finishedAt, durationMs });
  const idx = bucketIndexFor(finishedAt);
  timingStats.buckets[idx].count++;
  timingStats.buckets[idx].totalMs += durationMs;
  timingStats.allTime.count++;
  timingStats.allTime.totalMs += durationMs;
  pruneTimingHistory();
}

let _timingSaveTimeout = null;
function _writeTimingHistorySync() {
  try {
    require('fs').writeFileSync(TIMING_HISTORY_FILE, JSON.stringify(timingHistory));
  } catch {}
}
function _writeTimingStatsSync() {
  try {
    require('fs').writeFileSync(TIMING_STATS_FILE, JSON.stringify(timingStats));
  } catch {}
}
function saveTimingHistory() {
  if (_timingSaveTimeout) return;
  _timingSaveTimeout = setTimeout(() => {
    _timingSaveTimeout = null;
    _writeTimingHistorySync();
    _writeTimingStatsSync();
  }, 5000);
}
function flushTimingHistory() {
  if (_timingSaveTimeout) {
    clearTimeout(_timingSaveTimeout);
    _timingSaveTimeout = null;
  }
  _writeTimingHistorySync();
  _writeTimingStatsSync();
}
function loadTimingHistory() {
  // raw
  try {
    const raw = require('fs').readFileSync(TIMING_HISTORY_FILE, 'utf8');
    timingHistory = JSON.parse(raw) || [];
  } catch {}
  // stats (영구). raw에서 재계산하지 않음 — raw는 prune되니까.
  // 단, tz 마커가 없거나 다르면 raw에서 재집계 (timezone 변경 마이그레이션).
  let needsBootstrap = false;
  try {
    const raw = require('fs').readFileSync(TIMING_STATS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.buckets) && parsed.tz === TIMING_TZ) {
      if (parsed.buckets.length === TIMING_BUCKET_COUNT) {
        // 정확히 일치 — 그대로 load
        timingStats = {
          buckets: parsed.buckets.map(b => ({ count: b.count || 0, totalMs: b.totalMs || 0 })),
          allTime: { count: parsed.allTime?.count || 0, totalMs: parsed.allTime?.totalMs || 0 },
          tz: TIMING_TZ,
        };
      } else if (parsed.buckets.length === 12 && TIMING_BUCKET_COUNT === 24) {
        // Migration: 12-bucket(2h 단위) → 24-bucket(1h 단위). 각 2h bucket을 두 개의
        // 1h bucket으로 절반씩 split — 평균은 보존, count만 분산. (2026-05-13)
        const newBuckets = [];
        for (let i = 0; i < 12; i++) {
          const old = parsed.buckets[i];
          const halfCount = Math.floor((old.count || 0) / 2);
          const halfMs = Math.floor((old.totalMs || 0) / 2);
          newBuckets.push({ count: halfCount, totalMs: halfMs });
          newBuckets.push({ count: (old.count || 0) - halfCount, totalMs: (old.totalMs || 0) - halfMs });
        }
        timingStats = {
          buckets: newBuckets,
          allTime: { count: parsed.allTime?.count || 0, totalMs: parsed.allTime?.totalMs || 0 },
          tz: TIMING_TZ,
        };
        _writeTimingStatsSync();
        console.log('[NAI Studio] Migrated timing stats: 12-bucket (2h) → 24-bucket (1h)');
      } else {
        console.log('[NAI Studio] timing stats bucket count unexpected (' + parsed.buckets.length + ') — rebuilding from raw');
        needsBootstrap = true;
      }
    } else {
      console.log('[NAI Studio] timing stats tz mismatch (was ' + (parsed?.tz || 'none') + ', now ' + TIMING_TZ + ') — rebuilding from raw');
      needsBootstrap = true;
    }
  } catch {
    needsBootstrap = true;
  }
  if (needsBootstrap && timingHistory.length > 0) {
    // raw에서 KST bucket으로 재집계
    timingStats = {
      buckets: Array.from({ length: TIMING_BUCKET_COUNT }, () => ({ count: 0, totalMs: 0 })),
      allTime: { count: 0, totalMs: 0 },
      tz: TIMING_TZ,
    };
    for (const e of timingHistory) {
      const idx = bucketIndexFor(e.finishedAt);
      timingStats.buckets[idx].count++;
      timingStats.buckets[idx].totalMs += e.durationMs;
      timingStats.allTime.count++;
      timingStats.allTime.totalMs += e.durationMs;
    }
    _writeTimingStatsSync();
    console.log('[NAI Studio] Bootstrapped timing stats from raw (' + timingHistory.length + ' entries, tz=' + TIMING_TZ + ')');
  }
  // 로드 직후 prune (서버 다운 동안 2일 경과한 entry 제거)
  const removed = pruneTimingHistory();
  if (timingHistory.length > 0 || timingStats.allTime.count > 0) {
    console.log('[NAI Studio] Loaded timing: raw=' + timingHistory.length + ' (pruned ' + removed + '), aggregate=' + timingStats.allTime.count);
  }
}

// ─── Completed jobs (ring buffer + 4h retention) — queue.html 완료 탭용 ───
let completedJobs = []; // [{ jobId, outputFilePath, meta, completedAt, durationMs }]
const COMPLETED_JOBS_MAX = 500;
const COMPLETED_RETENTION_MS = 4 * 60 * 60 * 1000; // 4시간

function pruneCompletedJobs() {
  const now = Date.now();
  completedJobs = completedJobs.filter((e) => now - e.completedAt < COMPLETED_RETENTION_MS);
}
const COMPLETED_JOBS_FILE = path.join(DATA_DIR, '.queue_completed.json');
let _completedSaveTimeout = null;
function _writeCompletedJobsSync() {
  try {
    require('fs').writeFileSync(COMPLETED_JOBS_FILE, JSON.stringify(completedJobs));
  } catch {}
}
function saveCompletedJobs() {
  if (_completedSaveTimeout) return;
  _completedSaveTimeout = setTimeout(() => {
    _completedSaveTimeout = null;
    _writeCompletedJobsSync();
  }, 5000);
}
function loadCompletedJobs() {
  try {
    const raw = require('fs').readFileSync(COMPLETED_JOBS_FILE, 'utf8');
    completedJobs = JSON.parse(raw) || [];
    if (completedJobs.length > 0) {
      console.log('[NAI Studio] Loaded ' + completedJobs.length + ' completed jobs');
    }
  } catch {}
}

const QUEUE_MAX_SIZE = 5000;
const DISK_WARN_GB = 15;
const DISK_CRIT_GB = 10;

function broadcastQueueStatus() {
  broadcast('queue-status', {
    pending: genQueue.length,
    processing: queueProcessing,
    paused: queuePaused,
    completed: queueStats.completed,
    failed: queueStats.failed,
  });
}
const QUEUE_STATE_FILE = path.join(DATA_DIR, '.queue_state.json');
let _queueSaveTimeout = null;
function _writeQueueStateSync() {
  try {
    const state = { queue: genQueue.map(j => j), stats: queueStats, savedAt: Date.now() };
    require('fs').writeFileSync(QUEUE_STATE_FILE, JSON.stringify(state));
  } catch {}
}
function saveQueueState() {
  // Debounced: collapse rapid calls into one disk write per 1s
  if (_queueSaveTimeout) return;
  _queueSaveTimeout = setTimeout(() => {
    _queueSaveTimeout = null;
    _writeQueueStateSync();
  }, 1000);
}
function flushQueueState() {
  // Force immediate write (e.g. on shutdown or queue idle)
  if (_queueSaveTimeout) {
    clearTimeout(_queueSaveTimeout);
    _queueSaveTimeout = null;
  }
  _writeQueueStateSync();
}
function loadQueueState() {
  try {
    const raw = require('fs').readFileSync(QUEUE_STATE_FILE, 'utf8');
    const state = JSON.parse(raw);
    if (Date.now() - state.savedAt > 24 * 60 * 60 * 1000) return; // 24시간 지나면 무시
    if (state.queue && state.queue.length > 0) {
      genQueue.push(...state.queue);
      queueStats.completed = state.stats?.completed || 0;
      queueStats.failed = state.stats?.failed || 0;
      queueStats.totalProcessTimeMs = state.stats?.totalProcessTimeMs || 0;
      queueStats.completedWithTiming = state.stats?.completedWithTiming || 0;
      console.log('[NAI Studio] Restored ' + genQueue.length + ' queued jobs from disk');
      processQueue();
    }
    require('fs').unlinkSync(QUEUE_STATE_FILE);
  } catch {}
}

// ─── Drive retry queue (Phase 9) ────────────────────────────────────
// 단일 파일 Drive 업로드 실패 시 큐에 적재, exponential 간격 자동 재시도.
// 큐는 영속(JSON 파일). 서버 재시작 시 복원.
// 6회(60s,2m,5m,10m,20m,30m) 다 실패하면 status='failed'로 두고 폴링 대상에서 제외,
// 사용자가 widget에서 dismiss 또는 reset 할 때까지 큐에 남아 표시됨.
const DRIVE_RETRY_QUEUE_FILE = path.join(DATA_DIR, '.drive-retry-queue.json');
// Drive 업로드 실패 후 재시도 간격: 네트워크 일시 끊김은 보통 10~30초면 회복.
// 분 단위는 너무 늦어 본인 체감 불편 → 초 단위로 단축 (2026-05-12 본인 요청).
const DRIVE_RETRY_INTERVALS = [10000, 20000, 30000, 60000, 120000, 300000];
const DRIVE_RETRY_MAX_ATTEMPTS = DRIVE_RETRY_INTERVALS.length;
// 폴링 주기도 단축 — 빈 큐일 땐 early-return이라 부담 거의 없음.
const DRIVE_RETRY_POLL_MS = 5000;
let driveRetryQueue = [];

async function loadDriveRetryQueue() {
  try {
    const data = await fs.readFile(DRIVE_RETRY_QUEUE_FILE, 'utf-8');
    const parsed = JSON.parse(data);
    driveRetryQueue = Array.isArray(parsed) ? parsed : [];
    console.log('[Drive retry] loaded ' + driveRetryQueue.length + ' entries');
  } catch (e) {
    if (e.code !== 'ENOENT') {
      console.warn('[Drive retry] load failed:', e.message);
    }
    driveRetryQueue = [];
  }
}

async function saveDriveRetryQueue() {
  try {
    await fs.writeFile(DRIVE_RETRY_QUEUE_FILE, JSON.stringify(driveRetryQueue, null, 2));
  } catch (e) {
    console.error('[Drive retry] save failed:', e.message);
  }
}

// requestedPath: 클라가 보낸 path (jobId 역할). WS broadcast 시 클라 매칭용.
// immediate: true면 nextRetryAt=now (초기 sync), false면 INTERVALS[0]만큼 띄움 (실패 후 재시도).
function enqueueDriveRetry(localPath, remotePath, initialError, requestedPath = null, immediate = false) {
  const existingIdx = driveRetryQueue.findIndex((e) => e.localPath === localPath);
  const now = Date.now();
  // 새 enqueue는 attempts 0부터 시작 (이전 failed 상태도 reset)
  const entry = {
    localPath,
    remotePath,
    requestedPath: requestedPath || (existingIdx >= 0 ? driveRetryQueue[existingIdx].requestedPath : null),
    addedAt: existingIdx >= 0 ? driveRetryQueue[existingIdx].addedAt : now,
    attempts: 0,
    status: 'pending',
    nextRetryAt: immediate ? now : (now + DRIVE_RETRY_INTERVALS[0]),
    lastError: initialError || null,
    lastAttemptAt: now,
  };
  if (existingIdx >= 0) {
    driveRetryQueue[existingIdx] = entry;
  } else {
    driveRetryQueue.push(entry);
  }
  saveDriveRetryQueue();
  console.log('[Drive retry] enqueued: ' + localPath + ' (queue size=' + driveRetryQueue.length + ')');
}

function dequeueDriveRetry(localPath) {
  const idx = driveRetryQueue.findIndex((e) => e.localPath === localPath);
  if (idx >= 0) {
    driveRetryQueue.splice(idx, 1);
    saveDriveRetryQueue();
    console.log('[Drive retry] removed: ' + localPath);
  }
}

function rcloneCopytoOnce(localPath, remotePath, timeoutMs) {
  return new Promise((resolve) => {
    const { exec } = require('child_process');
    const cmd =
      'rclone copyto ' +
      JSON.stringify(localPath) +
      ' ' +
      JSON.stringify(remotePath) +
      ' --log-level INFO';
    exec(cmd, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (err) => {
      if (err) resolve({ ok: false, error: err.message });
      else resolve({ ok: true });
    });
  });
}

// 동시 실행 가드: setImmediate 트리거 + 5초 폴링이 겹쳐도 한 번에 한 tick만.
let driveRetryProcessing = false;

// rclone 동시 실행 수. 본인 환경(Oracle ARM Ampere A1)에서 3 정도가 안전 마진.
// 너무 높이면 NW 대역폭/rclone 토큰 race 위험. env로 오버라이드 가능.
const DRIVE_RETRY_CONCURRENCY = Math.max(1, parseInt(process.env.DRIVE_RETRY_CONCURRENCY) || 3);

async function processDriveRetryQueue({ ignoreSchedule = false } = {}) {
  if (driveRetryProcessing) return { succeeded: 0, failed: 0, skipped: 0 };
  if (driveRetryQueue.length === 0) return { succeeded: 0, failed: 0, skipped: 0 };
  driveRetryProcessing = true;
  let succeeded = 0;
  let newlyFailed = 0;
  let skipped = 0;
  try {
    const now = Date.now();
    const workEntries = [];
    for (const entry of driveRetryQueue) {
      if (entry.status === 'failed') {
        skipped++;
        continue;
      }
      if (!ignoreSchedule && now < (entry.nextRetryAt || 0)) {
        skipped++;
        continue;
      }
      workEntries.push(entry);
    }
    // Process work entries N concurrent.
    const processOne = async (entry) => {
      const result = await rcloneCopytoOnce(entry.localPath, entry.remotePath, 30000);
      if (result.ok) {
        console.log('[Drive retry] success: ' + entry.localPath);
        succeeded++;
        broadcast('drive-sync-complete', {
          localPath: entry.localPath,
          requestedPath: entry.requestedPath,
          fileName: path.basename(entry.localPath),
        });
        return { entry, removed: true };
      }
      entry.attempts += 1;
      entry.lastError = result.error;
      entry.lastAttemptAt = Date.now();
      let willRetry = true;
      if (entry.attempts >= DRIVE_RETRY_MAX_ATTEMPTS) {
        entry.status = 'failed';
        entry.nextRetryAt = null;
        newlyFailed++;
        willRetry = false;
        console.error(
          '[Drive retry] giving up (status=failed) after ' +
            entry.attempts +
            ' attempts: ' +
            entry.localPath,
        );
      } else {
        const delay = DRIVE_RETRY_INTERVALS[entry.attempts];
        entry.nextRetryAt = Date.now() + delay;
      }
      broadcast('drive-sync-failed', {
        localPath: entry.localPath,
        requestedPath: entry.requestedPath,
        fileName: path.basename(entry.localPath),
        error: result.error,
        willRetry,
        attempts: entry.attempts,
        nextRetryAt: entry.nextRetryAt,
      });
      return { entry, removed: false };
    };
    const removedEntries = new Set();
    for (let i = 0; i < workEntries.length; i += DRIVE_RETRY_CONCURRENCY) {
      const chunk = workEntries.slice(i, i + DRIVE_RETRY_CONCURRENCY);
      const results = await Promise.all(chunk.map(processOne));
      for (const r of results) {
        if (r.removed) removedEntries.add(r.entry);
      }
    }
    // 원본 순서 보존 — entry 객체는 in-place 업데이트라 reference 그대로.
    driveRetryQueue = driveRetryQueue.filter((e) => !removedEntries.has(e));
    await saveDriveRetryQueue();
  } finally {
    driveRetryProcessing = false;
  }
  if (succeeded > 0 || newlyFailed > 0) {
    console.log(
      '[Drive retry] tick. success=' +
        succeeded +
        ', newlyFailed=' +
        newlyFailed +
        ', skipped=' +
        skipped +
        ', remaining=' +
        driveRetryQueue.length,
    );
  }
  return { succeeded, failed: newlyFailed, skipped };
}

// ─── Export pipeline queue (이미지 내보내기 서버 백그라운드) ───────────
// 클라가 paths + outFilePath + optimize 옵션 보내면 enqueue + 202 즉시 반환.
// 워커: (옵션) sharp resize → jszip 압축 → exports/<out>.tar 저장 → driveRetry enqueue.
// WS 이벤트: export-progress / export-complete / export-failed.
const exportQueue = [];
// 동시 실행 가능한 export job 수. 본인 요청: 동시 10개까지 (2026-05-13).
// 메모리/CPU 부담 회피: sharp가 multi-thread라 너무 높이면 race, 10 정도가 ARM Ampere A1에서
// 안전한 상한. env로 오버라이드 가능.
const EXPORT_CONCURRENCY = Math.max(1, parseInt(process.env.EXPORT_CONCURRENCY) || 10);
let exportWorkers = 0;
// 현재 진행 중인 export job들. key=jobId, value={ jobId, outFileName, phase, done, total, startedAt, canceled }.
// /api/export/status, /api/export/cancel에서 사용.
const activeExportJobs = new Map();

function setExportProgress(jobId, phase, done, total) {
  const info = activeExportJobs.get(jobId);
  if (info) {
    info.phase = phase;
    info.done = done;
    info.total = total;
  }
  broadcast('export-progress', { jobId, phase, done, total });
}

function isExportCanceled(jobId) {
  const info = activeExportJobs.get(jobId);
  return !!(info && info.canceled);
}

async function processExportQueue() {
  // 워커풀 방식: 빈 슬롯이 있으면 새 워커 spawn. 각 워커는 큐가 빌 때까지 job 처리.
  while (exportWorkers < EXPORT_CONCURRENCY && exportQueue.length > 0) {
    exportWorkers++;
    (async () => {
      try {
        while (exportQueue.length > 0) {
          const job = exportQueue.shift();
          activeExportJobs.set(job.jobId, {
            jobId: job.jobId,
            outFileName: (job.outFilePath || '').split('/').pop() || '',
            phase: 'queued',
            done: 0,
            total: (job.paths || []).length,
            startedAt: Date.now(),
            canceled: false,
          });
          try {
            await runExportJob(job);
          } catch (e) {
            const canceled = isExportCanceled(job.jobId);
            console.error('[Export] job ' + job.jobId + (canceled ? ' canceled' : ' failed') + ':', e.message);
            broadcast('export-failed', {
              jobId: job.jobId,
              phase: job._phase || 'unknown',
              error: canceled ? 'canceled' : e.message,
            });
            // 취소/실패 시 부분 tar 산출물 정리 — 사용 불가능하고 디스크만 차지.
            // 정상 완료 path는 catch에 안 들어오니까 outAbs 유지.
            try {
              const outAbs = resolvePath(job.outFilePath);
              await fs.unlink(outAbs);
            } catch {} // 아직 안 생성되었거나 권한 없으면 무시
          } finally {
            // Phase 1 resize 산출물 정리 (data/tmp 누적 방지). 어떤 경로로 끝나든 실행.
            for (const item of (job.paths || [])) {
              if (item.processedPath) {
                try { await fs.unlink(item.processedPath); } catch {}
              }
            }
            activeExportJobs.delete(job.jobId);
          }
        }
      } finally {
        exportWorkers--;
      }
    })();
  }
}

async function runExportJob(job) {
  const { jobId, paths: items, outFilePath, optimize, imageSize } = job;
  console.log('[Export] start jobId=' + jobId + ' items=' + items.length + ' optimize=' + optimize);

  // Phase 1: resize (skip when optimize === 'none')
  if (optimize && optimize !== 'none') {
    if (!sharp) throw new Error('sharp not available');
    job._phase = 'resize';
    const ext = optimize === 'avif' ? '.avif' : '.webp';
    let done = 0;
    const total = items.length;
    setExportProgress(jobId, 'resize', 0, total);
    const CHUNK = 4;
    for (let i = 0; i < items.length; i += CHUNK) {
      if (isExportCanceled(jobId)) throw new Error('canceled');
      const chunk = items.slice(i, i + CHUNK);
      await Promise.all(chunk.map(async (item) => {
        const inputPath = resolvePath(item.srcPath);
        const outputPath = resolvePath('tmp/' + uuidv4() + ext);
        await fs.mkdir(path.dirname(outputPath), { recursive: true });
        let pipeline = sharp(inputPath).resize(imageSize, imageSize, { fit: 'inside', withoutEnlargement: true });
        if (optimize === 'lossy') pipeline = pipeline.webp({ quality: 80 });
        else if (optimize === 'lossless') pipeline = pipeline.webp({ lossless: true });
        else if (optimize === 'avif') pipeline = pipeline.avif({ quality: 65, effort: 2 });
        await pipeline.toFile(outputPath);
        item.processedPath = outputPath;
      }));
      done += chunk.length;
      setExportProgress(jobId, 'resize', done, total);
    }
  }

  if (isExportCanceled(jobId)) throw new Error('canceled');

  // Phase 2: zip — file add 루프 + generate + write 각각의 경계에서 cancel 체크
  job._phase = 'zip';
  const totalForZip = items.length;
  setExportProgress(jobId, 'zip', 0, totalForZip);
  const JSZip = require('jszip');
  const zip = new JSZip();
  const skipped = [];
  let included = 0;
  let processed = 0;
  for (const item of items) {
    if (isExportCanceled(jobId)) throw new Error('canceled');
    const sourceFile = item.processedPath || resolvePath(item.srcPath);
    try {
      const content = await fs.readFile(sourceFile);
      zip.file(item.finalName, content);
      included++;
    } catch (e) {
      if (e.code === 'ENOENT') {
        skipped.push(item.srcPath);
        console.warn('[Export] ENOENT, skipping:', item.srcPath);
      } else {
        throw e;
      }
    }
    processed++;
    // 진행도는 매 16개나 끝에서 broadcast (너무 잦은 broadcast 회피)
    if (processed % 16 === 0 || processed === totalForZip) {
      setExportProgress(jobId, 'zip', processed, totalForZip);
    }
  }
  if (included === 0) {
    throw new Error('아카이브할 파일이 없어요');
  }
  if (isExportCanceled(jobId)) throw new Error('canceled');
  const buf = await zip.generateAsync({ type: 'nodebuffer' });
  if (isExportCanceled(jobId)) throw new Error('canceled');
  const outAbs = resolvePath(outFilePath);
  await fs.mkdir(path.dirname(outAbs), { recursive: true });
  await fs.writeFile(outAbs, buf);
  // tar 작성 후에도 한 번 더 체크 — 직후 취소 들어왔으면 정리하고 throw
  if (isExportCanceled(jobId)) {
    try { await fs.unlink(outAbs); } catch {}
    throw new Error('canceled');
  }
  setExportProgress(jobId, 'zip', totalForZip, totalForZip);

  // Phase 3: Drive enqueue (fire-and-forget, drive-sync-* 이벤트로 별도 추적)
  job._phase = 'drive-enqueue';
  const cleaned = outFilePath.replace(/^exports[\/]/, '');
  const remotePath = `${RCLONE_REMOTE}:${RCLONE_REMOTE_BASE}/data/exports/${cleaned}`;
  enqueueDriveRetry(outAbs, remotePath, null, outFilePath, true);
  setImmediate(() => processDriveRetryQueue({ ignoreSchedule: true }));

  console.log('[Export] complete jobId=' + jobId + ' included=' + included + ' skipped=' + skipped.length);
  broadcast('export-complete', { jobId, outFilePath, included, skipped });
}

async function getDiskFreeGB() {
  try {
    const { execSync } = require('child_process');
    const output = execSync("df --output=avail /home 2>/dev/null | tail -1").toString().trim();
    return parseInt(output) / 1024 / 1024; // KB → GB
  } catch {
    return 999; // assume OK if check fails
  }
}

async function diskCleanupStage1() {
  // tmp/, exports/ — 전부 삭제 가능
  let cleaned = 0;
  for (const dir of ['tmp', 'exports']) {
    const dirPath = path.join(DATA_DIR, dir);
    try {
      const files = await fs.readdir(dirPath, { recursive: true });
      for (const f of files) {
        const fp = path.join(dirPath, f);
        try {
          const stat = await fs.stat(fp);
          if (stat.isFile()) { await fs.unlink(fp); cleaned++; }
        } catch {}
      }
      // Remove empty dirs
      const { execSync } = require('child_process');
      execSync(`find "${dirPath}" -mindepth 1 -type d -empty -delete 2>/dev/null`);
    } catch {}
  }
  if (cleaned > 0) console.log(`[Disk] Stage 1: deleted ${cleaned} tmp/exports files`);
  return cleaned;
}

// Delete all files matching `pathPattern` (find -path), then remove now-empty
// `dirName` directories anywhere under DATA_DIR. Errors silently absorbed.
async function cleanupDirByPattern(pathPattern, dirName) {
  const { execSync } = require('child_process');
  let cleaned = 0;
  try {
    const output = execSync(`find "${DATA_DIR}" -path "${pathPattern}" -type f 2>/dev/null`).toString().trim();
    const files = output ? output.split('\n') : [];
    for (const f of files) {
      try { await fs.unlink(f); cleaned++; } catch {}
    }
    execSync(`find "${DATA_DIR}" -name "${dirName}" -type d -empty -delete 2>/dev/null`);
  } catch {}
  return cleaned;
}

async function diskCleanupStage2() {
  // fastcache/ — 전부 삭제 가능 (재생성됨)
  const cleaned = await cleanupDirByPattern('*/fastcache/*', 'fastcache');
  if (cleaned > 0) console.log(`[Disk] Stage 2: deleted ${cleaned} fastcache files`);
  return cleaned;
}

async function diskCleanupStage3() {
  // .trash/ — 이미 삭제된 이미지
  const cleaned = await cleanupDirByPattern('*/.trash/*', '.trash');
  if (cleaned > 0) console.log(`[Disk] Stage 3: deleted ${cleaned} trash files`);
  return cleaned;
}

async function diskCleanupStage4() {
  // outs/ 30일+ 이미지 — Drive 동기화 확인 후 삭제
  let cleaned = 0;
  const { execSync } = require('child_process');
  const outsDir = path.join(DATA_DIR, 'outs');

  // rclone이 있는지, RCLONE_REMOTE가 설정되어 있는지 확인
  let rcloneOK = false;
  try {
    execSync('which rclone', { stdio: 'pipe' });
    execSync(`rclone listremotes 2>/dev/null | grep ${RCLONE_REMOTE}`, { stdio: 'pipe' });
    rcloneOK = true;
  } catch {}

  if (!rcloneOK) {
    console.log(`[Disk] Stage 4: skipped — rclone/${RCLONE_REMOTE} not available`);
    return 0;
  }

  try {
    // 30일 이상 된 png 파일 찾기
    const output = execSync(`find "${outsDir}" -name "*.png" -not -path "*/.trash/*" -not -path "*/fastcache/*" -mtime +30 2>/dev/null`).toString().trim();
    const files = output ? output.split('\n') : [];
    if (files.length === 0) return 0;
    // Drive 인덱스를 한 번에 빌드 (lsjson --recursive). N개 lsf 호출 -> 1번 호출.
    let driveSet;
    try {
      const lsjsonOutput = execSync(
        `rclone lsjson "${RCLONE_REMOTE}:${RCLONE_REMOTE_BASE}/data/outs" --recursive --files-only 2>/dev/null`,
        { maxBuffer: 100 * 1024 * 1024 }
      ).toString();
      const entries = JSON.parse(lsjsonOutput);
      driveSet = new Set(entries.map(e => e.Path));
      console.log(`[Disk] Stage 4: indexed ${driveSet.size} Drive files for matching`);
    } catch (e) {
      console.error('[Disk] Stage 4: lsjson failed, aborting cleanup:', e.message);
      return 0;
    }
    for (const localFile of files) {
      // DATA_DIR 기준 상대 경로를 outs/ 기준 (Drive Path 형식)으로 변환
      const relPath = path.relative(DATA_DIR, localFile);
      const driveRelPath = relPath.startsWith('outs/') ? relPath.slice(5) : relPath;
      if (driveSet.has(driveRelPath)) {
        try {
          await fs.unlink(localFile);
          cleaned++;
        } catch {}
      }
    }
  } catch {}
  if (cleaned > 0) console.log(`[Disk] Stage 4: deleted ${cleaned} Drive-backed old images`);
  return cleaned;
}

async function ensureDiskSpace() {
  let freeGB = await getDiskFreeGB();

  if (freeGB >= DISK_WARN_GB) return true;

  // Stage 1: tmp, exports
  broadcast('disk-warning', { freeGB: freeGB.toFixed(1), stage: 1, message: `디스크 공간 부족 경고 (${freeGB.toFixed(1)}GB) — tmp/exports 정리 중` });
  console.log(`[Disk] ${freeGB.toFixed(1)}GB free — running stage 1`);
  await diskCleanupStage1();
  freeGB = await getDiskFreeGB();
  if (freeGB >= DISK_CRIT_GB) return true;

  // Stage 2: fastcache
  broadcast('disk-warning', { freeGB: freeGB.toFixed(1), stage: 2, message: `디스크 공간 부족 (${freeGB.toFixed(1)}GB) — 썸네일 캐시 정리 중` });
  console.log(`[Disk] ${freeGB.toFixed(1)}GB free — running stage 2`);
  await diskCleanupStage2();
  freeGB = await getDiskFreeGB();
  if (freeGB >= DISK_CRIT_GB) return true;

  // Stage 3: .trash
  broadcast('disk-warning', { freeGB: freeGB.toFixed(1), stage: 3, message: `디스크 공간 부족 (${freeGB.toFixed(1)}GB) — 휴지통 정리 중` });
  console.log(`[Disk] ${freeGB.toFixed(1)}GB free — running stage 3`);
  await diskCleanupStage3();
  freeGB = await getDiskFreeGB();
  if (freeGB >= DISK_CRIT_GB) return true;

  // Stage 4: 30d+ Drive-backed images
  broadcast('disk-warning', { freeGB: freeGB.toFixed(1), stage: 4, message: `디스크 공간 부족 (${freeGB.toFixed(1)}GB) — Drive 백업된 30일+ 이미지 정리 중` });
  console.log(`[Disk] ${freeGB.toFixed(1)}GB free — running stage 4`);
  await diskCleanupStage4();
  freeGB = await getDiskFreeGB();
  if (freeGB >= DISK_CRIT_GB) return true;

  // Stage 5: 여전히 부족 — 일시정지
  broadcast('disk-critical', { freeGB: freeGB.toFixed(1), message: `디스크 공간 심각 부족 (${freeGB.toFixed(1)}GB) — 생성 일시정지. 수동으로 이미지를 삭제해주세요.` });
  console.error(`[Disk] CRITICAL: ${freeGB.toFixed(1)}GB free — queue paused`);
  return false;
}

async function processQueue() {
  if (queueProcessing) return;
  queueProcessing = true;
  queuePaused = false;
  while (genQueue.length > 0) {
    // 사용자 명시 pause: in-flight job 완료 후 다음 job 시작 안 함
    if (pauseRequested) {
      if (!queuePaused) {
        queuePaused = true;
        broadcastQueueStatus();
      }
      await new Promise(r => setTimeout(r, 500));
      continue;
    }
    if (queuePaused && !pauseRequested) {
      queuePaused = false;
      broadcastQueueStatus();
    }
    // Disk space check before each generation
    const diskOK = await ensureDiskSpace();
    if (!diskOK) {
      queuePaused = true;
      broadcastQueueStatus();
      // Check every 60 seconds if space freed up
      await new Promise(r => setTimeout(r, 60000));
      const retryGB = await getDiskFreeGB();
      if (retryGB < DISK_CRIT_GB) {
        // Still not enough — keep paused, exit loop
        // Queue will resume when new job is added or manual intervention
        break;
      }
      queuePaused = false;
    }

    const job = genQueue[0];
    const jobStartedAt = Date.now();
    try {
      broadcast('queue-job-start', { jobId: job.jobId, pending: genQueue.length, meta: job.meta || {} });
      broadcastQueueStatus();

      if (!nai.token) {
        try { nai.token = await fs.readFile(resolvePath('TOKEN.txt'), 'utf-8'); } catch {}
      }
      if (!nai.token) throw new Error('Not logged in');

      const config = await loadConfig();
      const base64 = await nai.generateImage(job.params, config);

      if (job.params.outputFilePath) {
        const outPath = resolvePath(job.params.outputFilePath);
        await fs.mkdir(path.dirname(outPath), { recursive: true });
        await fs.writeFile(outPath, Buffer.from(base64, 'base64'));
        await prewarmThumbnails(outPath, job.params.outputFilePath, 'queue');
      }

      broadcast('queue-job-complete', {
        jobId: job.jobId,
        outputFilePath: job.params.outputFilePath,
        meta: job.meta || {},
      });
      broadcastQueueStatus();
      broadcast('image-changed', job.params.outputFilePath);
      const durationMs = Date.now() - jobStartedAt;
      queueStats.totalProcessTimeMs += durationMs;
      queueStats.completedWithTiming++;
      queueStats.completed++;
      // raw + aggregate (2시간 bucket + allTime). raw는 2일 retention, aggregate 영구.
      recordTiming(Date.now(), durationMs);
      saveTimingHistory();
      // 완료 jobs (queue.html 완료 탭용). 4시간 retention.
      completedJobs.push({
        jobId: job.jobId,
        outputFilePath: job.params.outputFilePath,
        meta: job.meta || {},
        completedAt: Date.now(),
        durationMs,
      });
      pruneCompletedJobs();
      if (completedJobs.length > COMPLETED_JOBS_MAX) completedJobs.shift();
      saveCompletedJobs();
    } catch (e) {
      const msg = e.message || '';
      const is429 = msg.includes('429');
      const fiveXxMatch = msg.match(/Generate failed: (5\d\d)/);
      const is5xx = !!(fiveXxMatch && fiveXxMatch[1] !== '501');

      if (is429) {
        job._retries = (job._retries || 0) + 1;
        if (job._retries <= 10) {
          console.log(`[NAI Studio] Queue job ${job.jobId}: NAI rate limited, retry ${job._retries}/10 in 5s...`);
          recordQueueError(job.jobId, msg, true, job.meta);
          await new Promise(r => setTimeout(r, 5000));
          continue;
        }
        console.error(`[NAI Studio] Queue job ${job.jobId}: max retries exceeded (429)`);
      } else if (is5xx) {
        job._5xxRetries = (job._5xxRetries || 0) + 1;
        if (job._5xxRetries <= 10) {
          console.log(`[NAI Studio] Queue job ${job.jobId}: NAI ${fiveXxMatch[1]}, retry ${job._5xxRetries}/10 in 5s...`);
          recordQueueError(job.jobId, msg, true, job.meta);
          await new Promise(r => setTimeout(r, 5000));
          continue;
        }
        console.error(`[NAI Studio] Queue job ${job.jobId}: max retries exceeded (5xx)`);
      }
      recordQueueError(job.jobId, msg, false, job.meta);
      broadcast('queue-job-error', { jobId: job.jobId, error: msg, meta: job.meta || {} });
      broadcastQueueStatus();
      queueStats.failed++;
      console.error(`[NAI Studio] Queue job ${job.jobId} error:`, msg);
    }
    genQueue.shift();
    saveQueueState();
    broadcastQueueStatus();
  }
  queueProcessing = false;
  queuePaused = false;
  flushQueueState();  // flush final state when queue goes idle
  broadcastQueueStatus();
}

// ─── Express App ────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: '100mb' }));

// Strip URL prefix when reverse-proxied under a subpath.
// Configure via URL_PREFIX env var. Empty string disables stripping.
app.use((req, res, next) => {
  if (URL_PREFIX && req.url.startsWith(URL_PREFIX)) {
    req.url = req.url.slice(URL_PREFIX.length) || '/';
  }
  next();
});

// Serve static frontend.
// public/ 은 사람·update.sh가 관리하는 정적 파일 (queue.html, build-info.json).
// public/build/ 는 vite 빌드 산출물 (index.html, assets/*). vite emptyOutDir이
// public/build/ 만 휩쓸어서 사람·update.sh 파일은 안전.
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, 'public/build')));

// ─── API: Config ────────────────────────────────────────────────────
app.get('/api/config', async (req, res) => {
  try { res.json(await loadConfig()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/config', async (req, res) => {
  try {
    await fs.writeFile(CONFIG_PATH, JSON.stringify(req.body, null, 2));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── API: Version ───────────────────────────────────────────────────
app.get('/api/version-check', async (req, res) => {
  try {
    res.json(await versionCheck.checkVersion({ projectDir: __dirname }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/build-info', (req, res) => {
  try {
    const info = require('fs').readFileSync(path.join(__dirname, 'public/build-info.json'), 'utf8');
    res.json(JSON.parse(info));
  } catch { res.json({ buildTime: 'unknown', gitHash: 'unknown' }); }
});
app.get('/api/version', (req, res) => {
  res.json({ version: '2.0.0-web' });
});

// ─── API: Auth ──────────────────────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    await nai.login(email, password);
    // Also save token to file for persistence
    await fs.writeFile(resolvePath('TOKEN.txt'), nai.token, 'utf-8');
    await fs.chmod(resolvePath('TOKEN.txt'), 0o600);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/login-token', async (req, res) => {
  try {
    const { token } = req.body;
    nai.token = token;
    await fs.writeFile(resolvePath('TOKEN.txt'), token, 'utf-8');
    await fs.chmod(resolvePath('TOKEN.txt'), 0o600);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/auth/credits', async (req, res) => {
  try {
    // Try to load token from file if not in memory
    if (!nai.token) {
      try {
        nai.token = await fs.readFile(resolvePath('TOKEN.txt'), 'utf-8');
      } catch {}
    }
    if (!nai.token) return res.json({ credits: 0 });
    const credits = await nai.getCredits();
    res.json({ credits });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── API: Generation Queue ──────────────────────────────────────────
app.post('/api/queue/add', async (req, res) => {
  if (genQueue.length >= QUEUE_MAX_SIZE) {
    broadcast('queue-full', { max: QUEUE_MAX_SIZE, message: `큐가 가득 찼습니다 (${QUEUE_MAX_SIZE}개)` });
    return res.status(429).json({ error: `Queue full (max ${QUEUE_MAX_SIZE})` });
  }
  // body 형식: ImageGenInput 자체 (legacy) | { params: ImageGenInput, meta: {...} } (새 형식)
  const body = req.body || {};
  const params = body.params && body.meta !== undefined ? body.params : body;
  const meta = body.meta || {};
  const jobId = uuidv4();
  genQueue.push({ jobId, params, meta });
  broadcastQueueStatus();
  // Kick off processing (non-blocking)
  setImmediate(() => processQueue());
  res.json({ jobId });
  saveQueueState();
});

app.post('/api/queue/add-batch', async (req, res) => {
  // body.jobs 형식: ImageGenInput[] (legacy) | { params, meta }[] (새 형식)
  const jobs = req.body.jobs || [];
  const space = QUEUE_MAX_SIZE - genQueue.length;
  const toAdd = jobs.slice(0, space);
  const jobIds = [];
  for (const item of toAdd) {
    const params = item && item.params && item.meta !== undefined ? item.params : item;
    const meta = (item && item.meta) || {};
    const jobId = uuidv4();
    genQueue.push({ jobId, params, meta });
    jobIds.push(jobId);
  }
  broadcastQueueStatus();
  setImmediate(() => processQueue());
  saveQueueState();
  res.json({ jobIds, rejected: jobs.length - toAdd.length });
});

app.get('/api/queue/status', async (req, res) => {
  const freeGB = await getDiskFreeGB();
  // 누적 평균 (timing 측정한 건수 기준)
  const avgMs = queueStats.completedWithTiming > 0
    ? queueStats.totalProcessTimeMs / queueStats.completedWithTiming
    : 0;
  // 최근 100건 평균 (추세 반영). 5건 미만이면 안정성 위해 누적 평균 사용
  const recentN = Math.min(100, timingHistory.length);
  const recentSlice = timingHistory.slice(-recentN);
  const recentAvgMs = recentN >= 5
    ? recentSlice.reduce((s, e) => s + e.durationMs, 0) / recentN
    : avgMs;
  // ETA는 최근 평균 기준 (더 정확)
  const baseAvg = recentAvgMs > 0 ? recentAvgMs : avgMs;
  const etaMs = baseAvg > 0 ? Math.round(baseAvg * genQueue.length) : null;
  res.json({
    pending: genQueue.length,
    processing: queueProcessing,
    paused: queuePaused,
    completed: queueStats.completed,
    failed: queueStats.failed,
    diskFreeGB: parseFloat(freeGB.toFixed(1)),
    jobs: genQueue.slice(0, 20).map(j => ({ jobId: j.jobId, outputFilePath: j.params.outputFilePath, meta: j.meta || {} })),
    totalJobs: genQueue.length,
    avgProcessTimeMs: Math.round(avgMs),
    recentAvgMs: Math.round(recentAvgMs),
    timingHistoryCount: timingHistory.length,
    // 영구 aggregate. queueStats는 일시적이라(큐 idle시 휘발 가능) timingStats를 신뢰 소스로 사용.
    allTimeCount: timingStats.allTime.count,
    allTimeAvgMs: timingStats.allTime.count > 0
      ? Math.round(timingStats.allTime.totalMs / timingStats.allTime.count)
      : 0,
    // 현재 시간대(2h bucket) 평균 — 추세 vs 현재 비교용
    currentBucket: bucketIndexFor(Date.now()),
    currentBucketAvgMs: (() => {
      const b = timingStats.buckets[bucketIndexFor(Date.now())];
      return b.count > 0 ? Math.round(b.totalMs / b.count) : 0;
    })(),
    etaMs,
    recentErrors: queueErrorHistory.slice(-10), // 최근 10개 (queue.html 표시용)
  });
});

// 페이지 로드/새로고침 시 클라가 큐 상태 복원용. params는 무거우니 메타데이터만.
app.get('/api/queue/full-state', (req, res) => {
  res.json({
    pending: genQueue.length,
    processing: queueProcessing,
    paused: queuePaused,
    pauseRequested,
    jobs: genQueue.map((j) => ({
      jobId: j.jobId,
      meta: j.meta || {},
      outputFilePath: j.params && j.params.outputFilePath,
    })),
  });
});

// 완료된 jobs. 메모리 ring buffer (정확한 meta) + 파일시스템 walk (옛 jobs 복원).
// 둘 다 합쳐서 반환. 4시간 이내, 최근부터. dedupe = outputFilePath 기준 (메모리 우선).
app.get('/api/queue/completed', (req, res) => {
  pruneCompletedJobs();
  const limit = Math.min(parseInt(req.query.limit) || COMPLETED_JOBS_MAX, COMPLETED_JOBS_MAX);
  const sinceMs = Date.now() - COMPLETED_RETENTION_MS;

  const memEntries = completedJobs.slice().reverse();
  const seenPaths = new Set(memEntries.map((e) => e.outputFilePath).filter(Boolean));

  // 파일시스템 fallback: outs/ 안 4시간 내 mtime png. ring buffer에 없는 것만 추가.
  const fsEntries = [];
  try {
    const { execSync } = require('child_process');
    const outsDir = path.join(DATA_DIR, 'outs');
    const out = execSync(
      `find ${JSON.stringify(outsDir)} -type f -name "*.png" -mmin -240 -not -path "*/.trash/*" -not -path "*/fastcache/*" -printf "%T@ %P\\n" 2>/dev/null`,
      { maxBuffer: 50 * 1024 * 1024, timeout: 10000 }
    ).toString();
    for (const line of out.split('\n')) {
      if (!line.trim()) continue;
      const sp = line.indexOf(' ');
      if (sp < 0) continue;
      const mtimeSec = parseFloat(line.substring(0, sp));
      const relPath = line.substring(sp + 1);
      const completedAt = Math.round(mtimeSec * 1000);
      if (completedAt < sinceMs) continue;
      const outputFilePath = 'outs/' + relPath;
      if (seenPaths.has(outputFilePath)) continue;
      const parts = relPath.split('/');
      const project = parts[0] || '';
      const sceneName = parts.length >= 2 ? parts[parts.length - 2] : '';
      fsEntries.push({
        jobId: null,
        outputFilePath,
        meta: {
          sceneKey: project + '/scene/' + sceneName,
          sceneName,
          taskType: 'scene',
        },
        completedAt,
        durationMs: 0,
      });
    }
  } catch (e) {
    console.warn('[completed] fs walk failed:', e.message);
  }

  const combined = [...memEntries, ...fsEntries].sort((a, b) => b.completedAt - a.completedAt);
  res.json({
    entries: combined.slice(0, limit),
    count: combined.length,
    memCount: memEntries.length,
    fsCount: fsEntries.length,
    maxSize: COMPLETED_JOBS_MAX,
    retentionMs: COMPLETED_RETENTION_MS,
  });
});

// ─── Raw timing history + aggregate stats ────────────────────────
// raw entries: 최근 2일 (sparkline용). stats: 2시간 단위 12 bucket + allTime, 영구 누적.

app.get('/api/queue/timing-history', (req, res) => {
  // 응답 전 한번 prune (장시간 idle 후 호출되면 stale entry가 섞여있을 수 있음)
  pruneTimingHistory();
  const buckets = timingStats.buckets.map((b, i) => ({
    index: i,
    hourStart: i * TIMING_BUCKET_HOURS,
    hourEnd: (i + 1) * TIMING_BUCKET_HOURS,
    count: b.count,
    avgMs: b.count > 0 ? Math.round(b.totalMs / b.count) : 0,
  }));
  res.json({
    entries: timingHistory,
    count: timingHistory.length,
    retentionMs: TIMING_RETENTION_MS,
    stats: {
      buckets,
      bucketHours: TIMING_BUCKET_HOURS,
      currentBucket: bucketIndexFor(Date.now()),
      allTimeCount: timingStats.allTime.count,
      allTimeAvgMs: timingStats.allTime.count > 0
        ? Math.round(timingStats.allTime.totalMs / timingStats.allTime.count)
        : 0,
    },
  });
});

app.post('/api/queue/cancel', (req, res) => {
  const cancelled = genQueue.length;
  genQueue.length = 0;
  broadcastQueueStatus();
  saveQueueState();
  res.json({ ok: true, cancelled });
});

// 특정 task의 jobs만 cancel. mirror에서 한 씬/씬 집합 취소 시 사용.
app.post('/api/queue/cancel-by-task-ids', (req, res) => {
  const taskIds = new Set(req.body.taskIds || []);
  if (taskIds.size === 0) return res.json({ ok: true, cancelled: 0 });
  const before = genQueue.length;
  for (let i = genQueue.length - 1; i >= 0; i--) {
    const tid = genQueue[i].meta && genQueue[i].meta.taskId;
    if (tid && taskIds.has(tid)) {
      genQueue.splice(i, 1);
    }
  }
  const cancelled = before - genQueue.length;
  broadcastQueueStatus();
  saveQueueState();
  res.json({ ok: true, cancelled });
});

app.post('/api/queue/pause', async (req, res) => {
  pauseRequested = true;
  // 큐가 idle이면 in-flight 없음 → 즉시 응답
  if (!queueProcessing) {
    queuePaused = true;
    broadcastQueueStatus();
    return res.json({ ok: true, idle: true });
  }
  // in-flight job 완료 + pause loop 진입까지 대기 (최대 120초)
  const start = Date.now();
  while (queueProcessing && !queuePaused) {
    if (Date.now() - start > 120000) {
      return res.json({ ok: true, timeout: true });
    }
    await new Promise(r => setTimeout(r, 100));
  }
  res.json({ ok: true });
});

app.post('/api/queue/resume', (req, res) => {
  pauseRequested = false;
  // pause loop가 다음 iteration에서 빠져나옴. 큐가 idle이면 새로 시작.
  if (!queueProcessing) {
    setImmediate(() => processQueue());
  }
  res.json({ ok: true });
});

// ─── API: Generate / Augment ────────────────────────────────────────
app.post('/api/generate', async (req, res) => {
  try {
    if (!nai.token) {
      try { nai.token = await fs.readFile(resolvePath('TOKEN.txt'), 'utf-8'); } catch {}
    }
    if (!nai.token) return res.status(401).json({ error: 'Not logged in' });

    const params = req.body;

    // Log generation request details (excluding large binary data)
    const logParams = { ...params };
    // Truncate base64 fields for logging
    for (const key of Object.keys(logParams)) {
      if (typeof logParams[key] === 'string' && logParams[key].length > 200) {
        logParams[key] = logParams[key].substring(0, 100) + `...[${logParams[key].length} chars]`;
      }
      // Also truncate nested arrays with base64 (vibes, characterReferences)
      if (Array.isArray(logParams[key])) {
        logParams[key] = logParams[key].map(item => {
          if (item && typeof item === 'object') {
            const copy = { ...item };
            if (typeof copy.image === 'string' && copy.image.length > 200) {
              copy.image = `[${copy.image.length} chars]`;
            }
            return copy;
          }
          return item;
        });
      }
    }
    console.log(`[NAI Studio] Generate request:`, JSON.stringify(logParams, null, 2));

    // Load config for model version
    const config = await loadConfig();
    const base64 = await nai.generateImage(params, config);
    console.log(`[NAI Studio] Generate success: ${params.outputFilePath || 'no output path'}`);

    // Write the output file
    if (params.outputFilePath) {
      const outPath = resolvePath(params.outputFilePath);
      await fs.mkdir(path.dirname(outPath), { recursive: true });
      await fs.writeFile(outPath, Buffer.from(base64, 'base64'));
      await prewarmThumbnails(outPath, params.outputFilePath, 'direct');
    }

    broadcast('image-changed', params.outputFilePath);
    res.json({ ok: true });
  } catch (e) {
    console.error(`[NAI Studio] Generate error:`, e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/augment', async (req, res) => {
  try {
    if (!nai.token) {
      try { nai.token = await fs.readFile(resolvePath('TOKEN.txt'), 'utf-8'); } catch {}
    }
    if (!nai.token) return res.status(401).json({ error: 'Not logged in' });

    const params = req.body;
    const base64 = await nai.augmentImage(params);

    if (params.outputFilePath) {
      const outPath = resolvePath(params.outputFilePath);
      await fs.mkdir(path.dirname(outPath), { recursive: true });
      await fs.writeFile(outPath, Buffer.from(base64, 'base64'));
    }

    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── API: File System ───────────────────────────────────────────────
app.get('/api/fs/list', async (req, res) => {
  try {
    const dirPath = resolvePath(req.query.path);
    await fs.mkdir(dirPath, { recursive: true });
    const files = await fs.readdir(dirPath);
    res.json(files);
  } catch (e) { res.json([]); }
});

app.get('/api/fs/list-stats', async (req, res) => {
  try {
    const dirPath = resolvePath(req.query.path);
    await fs.mkdir(dirPath, { recursive: true });
    const files = await fs.readdir(dirPath);
    const stats = await Promise.all(files.map(async (name) => {
      try {
        const st = await fs.stat(path.join(dirPath, name));
        return { name, size: st.size, mtime: st.mtimeMs };
      } catch { return { name, size: 0, mtime: 0 }; }
    }));
    res.json(stats);
  } catch (e) { res.json([]); }
});

// Walk a directory up to `depth` levels deep, returning file paths (slash-joined,
// relative to the base) and direct subdirectories. Hidden entries (starting with '.')
// are excluded so internal markers like .trash / .folder don't leak.
async function walkDir(basePath, depth) {
  const files = [];
  const dirs = [];
  async function walk(currentRel, currentDepth) {
    let entries;
    try {
      entries = await fs.readdir(path.join(basePath, currentRel), { withFileTypes: true });
    } catch { return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const rel = currentRel ? currentRel + '/' + entry.name : entry.name;
      if (entry.isDirectory()) {
        if (currentDepth === 0) dirs.push(rel);
        if (currentDepth < depth) {
          await walk(rel, currentDepth + 1);
        }
      } else if (entry.isFile()) {
        files.push(rel);
      }
    }
  }
  await walk('', 0);
  return { files, dirs };
}

app.get('/api/fs/list-recursive', async (req, res) => {
  try {
    const dirPath = resolvePath(req.query.path);
    await fs.mkdir(dirPath, { recursive: true });
    const parsed = parseInt(req.query.depth, 10);
    const depth = Math.max(0, Math.min(10, Number.isNaN(parsed) ? 1 : parsed));
    const result = await walkDir(dirPath, depth);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message, files: [], dirs: [] }); }
});

app.get('/api/fs/read', async (req, res) => {
  try {
    const filePath = resolvePath(req.query.path);
    const content = await fs.readFile(filePath, 'utf-8');
    res.json({ content });
  } catch (e) { res.status(404).json({ error: e.message }); }
});

app.post('/api/fs/write', async (req, res) => {
  try {
    const filePath = resolvePath(req.body.path);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, req.body.data, 'utf-8');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/fs/read-data', async (req, res) => {
  try {
    const filePath = resolvePath(req.query.path);
    const buf = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const mimeMap = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp' };
    const mime = mimeMap[ext] || 'application/octet-stream';
    res.json({ content: `data:${mime};base64,${buf.toString('base64')}` });
  } catch (e) { res.status(404).json({ error: e.message }); }
});

app.post('/api/fs/write-data', async (req, res) => {
  try {
    const filePath = resolvePath(req.body.path);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    // Strip data URI prefix if present (data:mime;base64,...)
    let data = req.body.data;
    if (data.startsWith('data:')) {
      data = data.split(',')[1] || data;
    }
    await fs.writeFile(filePath, Buffer.from(data, 'base64'));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/fs/copy', async (req, res) => {
  try {
    const src = resolvePath(req.body.src);
    const dest = resolvePath(req.body.dest);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(src, dest);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/fs/rename', async (req, res) => {
  try {
    const oldPath = resolvePath(req.body.oldPath);
    const newPath = resolvePath(req.body.newPath);
    await fs.mkdir(path.dirname(newPath), { recursive: true });
    await fs.rename(oldPath, newPath);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/fs/rename-dir', async (req, res) => {
  try {
    const oldPath = resolvePath(req.body.oldPath);
    const newPath = resolvePath(req.body.newPath);
    await fs.mkdir(path.dirname(newPath), { recursive: true });
    await fs.rename(oldPath, newPath);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/fs/delete', async (req, res) => {
  try {
    await fs.unlink(resolvePath(req.body.path));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/fs/delete-dir', async (req, res) => {
  try {
    await fs.rm(resolvePath(req.body.path), { recursive: true, force: true });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── API: Batch operations ───────────────────────────────────────
app.post('/api/fs/delete-batch', async (req, res) => {
  try {
    const paths = req.body.paths || [];
    let deleted = 0;
    await Promise.all(paths.map(async (p) => {
      try {
        await fs.unlink(resolvePath(p));
        deleted++;
      } catch {}
    }));
    res.json({ ok: true, deleted });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/fs/move-batch', async (req, res) => {
  try {
    const moves = req.body.moves || []; // [{src, dest}]
    const results = await Promise.all(moves.map(async ({ src, dest }) => {
      try {
        const srcPath = resolvePath(src);
        const destPath = resolvePath(dest);
        await fs.mkdir(path.dirname(destPath), { recursive: true });
        await fs.rename(srcPath, destPath);
        return 1;
      } catch { return 0; }
    }));
    const moved = results.reduce((a, b) => a + b, 0);
    res.json({ ok: true, moved });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/trash/auto-cleanup', async (req, res) => {
  try {
    const now = Date.now();
    const IMAGE_RETENTION_MS = 3 * 24 * 60 * 60 * 1000; // 3 days
    const IMAGE_TRASH_DIR = '.trash';
    const TRASH_META_FILE = 'trash_meta.json';
    let cleanedImages = 0;
    let cleanedOrphans = 0;

    // 1. Clean orphan .deleted files (recursive: folders allowed at depth 1)
    const projectDir = resolvePath('projects');
    try {
      const walked = await walkDir(projectDir, 1);
      for (const f of walked.files) {
        if (f.endsWith('.deleted')) {
          try { await fs.unlink(path.join(projectDir, f)); cleanedOrphans++; } catch {}
        }
      }
    } catch {}

    // 2. Clean expired image trash (walk server-side, folder-aware)
    const activeProjects = [];
    try {
      const walked = await walkDir(projectDir, 1);
      for (const f of walked.files) {
        if (f.endsWith('.json')) activeProjects.push(f.slice(0, -5));
      }
    } catch {}

    for (const proj of activeProjects) {
      for (const imgDir of ['outs', 'inpaints']) {
        const projDir = resolvePath(imgDir + '/' + proj);
        let sceneDirs;
        try { sceneDirs = await fs.readdir(projDir); } catch { continue; }
        for (const scene of sceneDirs) {
          if (scene === IMAGE_TRASH_DIR || scene.startsWith('.')) continue;
          const metaPath = path.join(projDir, scene, IMAGE_TRASH_DIR, TRASH_META_FILE);
          try {
            const metaStr = await fs.readFile(metaPath, 'utf-8');
            const meta = JSON.parse(metaStr);
            let changed = false;
            for (const [filename, deletedAt] of Object.entries(meta)) {
              if (now - deletedAt >= IMAGE_RETENTION_MS) {
                try { await fs.unlink(path.join(projDir, scene, IMAGE_TRASH_DIR, filename)); } catch {}
                delete meta[filename];
                changed = true;
                cleanedImages++;
              }
            }
            if (changed) {
              await fs.writeFile(metaPath, JSON.stringify(meta));
            }
          } catch {}
        }
      }
    }

    res.json({ ok: true, cleanedImages, cleanedOrphans });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Project permanent deletion (local + Drive, no trash) ──────────
// 본인 정책: 휴지통 거치지 않고 즉시 영구 삭제. Drive 휴지통도 우회(--drive-use-trash=false).

const RCLONE_TRASH_BYPASS = '--drive-use-trash=false';
const PROJECT_SUB_DIRS = ['outs', 'inpaints', 'vibes', 'inpaint_masks', 'inpaint_orgs'];

function sanitizeProjectName(name) {
  if (typeof name !== 'string' || !name) return null;
  if (name.includes('/') || name.includes('\\')) return null;
  if (name === '.' || name === '..') return null;
  if (name.startsWith('.')) return null;
  return name;
}

function checkRcloneAvailable() {
  const { execSync } = require('child_process');
  try {
    execSync('which rclone', { stdio: 'pipe' });
    execSync(`rclone listremotes 2>/dev/null | grep ${RCLONE_REMOTE}`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function rcloneRun(cmd, timeoutMs) {
  return new Promise((resolve) => {
    const { exec } = require('child_process');
    exec(cmd, { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({
        ok: !err,
        stdout: stdout ? stdout.toString() : '',
        stderr: stderr ? stderr.toString() : '',
        error: err ? err.message : null,
      });
    });
  });
}

// Drive purge가 디렉토리 없을 때 출력하는 메시지 — 에러로 안 셈
function isNotFoundError(text) {
  const t = (text || '').toLowerCase();
  return t.includes('not found') ||
    t.includes("doesn't exist") ||
    t.includes('directory not found') ||
    t.includes('object not found');
}

// projects 안에서 살아있는 프로젝트 basename set (폴더 depth 1 포함)
async function listActiveProjectNames() {
  const projectsDir = resolvePath('projects');
  const walked = await walkDir(projectsDir, 1);
  const names = new Set();
  for (const f of walked.files) {
    if (!f.endsWith('.json')) continue;
    const base = path.basename(f, '.json');
    if (base) names.add(base);
  }
  return names;
}

// exports 파일명에서 프로젝트 prefix 추출. 프로젝트 export가 아니면 null.
// 패턴: <name>.json, <name>.tar, <name>_main_images_<ts>.tar
function deriveProjectPrefixFromExport(filename) {
  if (filename.endsWith('.json')) return filename.slice(0, -5);
  if (filename.endsWith('.tar')) {
    const m = filename.match(/^(.+)_main_images_\d+\.tar$/);
    if (m) return m[1];
    return filename.slice(0, -4);
  }
  return null;
}

async function permanentlyDeleteProjectFiles(name) {
  const deleted = { local: [], drive: [] };
  const errors = [];

  // 1. 로컬 projects/<...>.json + <...>.deleted (폴더형 포함)
  const projectsDir = resolvePath('projects');
  try {
    const walked = await walkDir(projectsDir, 1);
    for (const f of walked.files) {
      if (!f.endsWith('.json') && !f.endsWith('.deleted')) continue;
      const base = path.basename(f, path.extname(f));
      if (base !== name) continue;
      try {
        await fs.unlink(path.join(projectsDir, f));
        deleted.local.push('projects/' + f);
      } catch (e) {
        errors.push('local rm projects/' + f + ': ' + e.message);
      }
    }
  } catch (e) {
    errors.push('local scan projects: ' + e.message);
  }

  // 2. 로컬 5개 폴더의 <name>/ 디렉토리 — 서로 독립이라 병렬화
  await Promise.all(PROJECT_SUB_DIRS.map(async (d) => {
    const p = path.join(DATA_DIR, d, name);
    try {
      let exists = false;
      try { await fs.access(p); exists = true; } catch {}
      if (!exists) return;
      await fs.rm(p, { recursive: true, force: true });
      deleted.local.push(d + '/' + name);
    } catch (e) {
      errors.push('local rm ' + d + '/' + name + ': ' + e.message);
    }
  }));

  // 3. 로컬 exports — <name>.json + <name>.tar + <name>_main_images_*.tar
  const exportsDir = path.join(DATA_DIR, 'exports');
  try {
    const entries = await fs.readdir(exportsDir);
    for (const f of entries) {
      const prefix = deriveProjectPrefixFromExport(f);
      if (prefix !== name) continue;
      try {
        await fs.unlink(path.join(exportsDir, f));
        deleted.local.push('exports/' + f);
      } catch (e) {
        errors.push('local rm exports/' + f + ': ' + e.message);
      }
    }
  } catch {
    // 디렉토리 자체가 없으면 무시
  }

  // 4. Drive — rclone 없으면 skip
  if (!checkRcloneAvailable()) {
    return { deleted, errors, driveSkipped: true };
  }

  // 4a. Drive 5개 폴더 purge — 각 rclone purge는 네트워크 RT가 커서 직렬 5번이
  // 가장 큰 병목 (15-25초). 서로 독립적인 다른 remote path라 동시 실행 안전.
  await Promise.all(PROJECT_SUB_DIRS.map(async (d) => {
    const remotePath = `${RCLONE_REMOTE}:${RCLONE_REMOTE_BASE}/data/${d}/${name}`;
    const r = await rcloneRun(
      `rclone purge ${JSON.stringify(remotePath)} ${RCLONE_TRASH_BYPASS} 2>&1`,
      60000,
    );
    if (r.ok) {
      deleted.drive.push(d + '/' + name);
    } else if (!isNotFoundError(r.stderr || r.stdout || r.error)) {
      errors.push('drive purge ' + d + '/' + name + ': ' + (r.stderr || r.error));
    }
  }));

  // 4b. Drive projects/ 안 <name>.json / <name>.deleted (폴더형 포함, lsf --recursive)
  const projRemoteDir = `${RCLONE_REMOTE}:${RCLONE_REMOTE_BASE}/data/projects`;
  const lsfProj = await rcloneRun(
    `rclone lsf ${JSON.stringify(projRemoteDir)} --recursive --files-only`,
    30000,
  );
  if (lsfProj.ok) {
    const lines = lsfProj.stdout.split('\n').filter(Boolean);
    for (const line of lines) {
      const base = path.basename(line);
      if (!base.endsWith('.json') && !base.endsWith('.deleted')) continue;
      const baseName = base.replace(/\.(json|deleted)$/, '');
      if (baseName !== name) continue;
      const remoteFile = `${projRemoteDir}/${line}`;
      const dr = await rcloneRun(
        `rclone deletefile ${JSON.stringify(remoteFile)} ${RCLONE_TRASH_BYPASS}`,
        30000,
      );
      if (dr.ok) {
        deleted.drive.push('projects/' + line);
      } else if (!isNotFoundError(dr.stderr || dr.error)) {
        errors.push('drive del projects/' + line + ': ' + (dr.stderr || dr.error));
      }
    }
  }

  // 4c. Drive exports prefix 매칭
  const exportRemoteDir = `${RCLONE_REMOTE}:${RCLONE_REMOTE_BASE}/data/exports`;
  const lsfExp = await rcloneRun(
    `rclone lsf ${JSON.stringify(exportRemoteDir)} --files-only`,
    30000,
  );
  if (lsfExp.ok) {
    const lines = lsfExp.stdout.split('\n').filter(Boolean);
    for (const f of lines) {
      const prefix = deriveProjectPrefixFromExport(f);
      if (prefix !== name) continue;
      const remoteFile = `${exportRemoteDir}/${f}`;
      const dr = await rcloneRun(
        `rclone deletefile ${JSON.stringify(remoteFile)} ${RCLONE_TRASH_BYPASS}`,
        30000,
      );
      if (dr.ok) {
        deleted.drive.push('exports/' + f);
      } else if (!isNotFoundError(dr.stderr || dr.error)) {
        errors.push('drive del exports/' + f + ': ' + (dr.stderr || dr.error));
      }
    }
  }

  return { deleted, errors, driveSkipped: false };
}

app.post('/api/project/delete-now', async (req, res) => {
  try {
    const name = sanitizeProjectName(req.body && req.body.name);
    if (!name) return res.status(400).json({ ok: false, error: 'Invalid project name' });
    const result = await permanentlyDeleteProjectFiles(name);
    console.log(`[Project] delete-now "${name}": local=${result.deleted.local.length}, drive=${result.deleted.drive.length}, errors=${result.errors.length}`);
    res.json({ ok: true, ...result });
  } catch (e) {
    console.error('[Project] delete-now error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// cleanup-orphans는 Drive purge 다수로 long-running. iPhone Safari fetch
// timeout과 충돌하지 않게 fire-and-forget + WS 진행도 broadcast 방식.
let cleanupOrphansActiveJobId = null;

function emitOrphansProgress(jobId, phase, currentItem, deleted, errors) {
  broadcast('cleanup-orphans-progress', {
    jobId,
    phase,
    currentItem: currentItem || '',
    deleted: { local: deleted.local.length, drive: deleted.drive.length },
    errors: errors.length,
  });
}

async function runCleanupOrphans(jobId) {
  const deleted = { local: [], drive: [] };
  const errors = [];
  try {
    const activeSet = await listActiveProjectNames();

    // 1. 로컬 5폴더
    emitOrphansProgress(jobId, 'local-folders', '', deleted, errors);
    for (const d of PROJECT_SUB_DIRS) {
      const dirPath = path.join(DATA_DIR, d);
      let entries;
      try { entries = await fs.readdir(dirPath, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        if (e.name.startsWith('.')) continue;
        if (activeSet.has(e.name)) continue;
        const item = d + '/' + e.name;
        emitOrphansProgress(jobId, 'local-folders', item, deleted, errors);
        try {
          await fs.rm(path.join(dirPath, e.name), { recursive: true, force: true });
          deleted.local.push(item);
        } catch (err) {
          errors.push('local rm ' + item + ': ' + err.message);
        }
      }
    }

    // 2. 로컬 exports prefix
    emitOrphansProgress(jobId, 'local-exports', '', deleted, errors);
    const exportsDir = path.join(DATA_DIR, 'exports');
    try {
      const entries = await fs.readdir(exportsDir);
      for (const f of entries) {
        const prefix = deriveProjectPrefixFromExport(f);
        if (prefix == null) continue;
        if (activeSet.has(prefix)) continue;
        const item = 'exports/' + f;
        emitOrphansProgress(jobId, 'local-exports', item, deleted, errors);
        try {
          await fs.unlink(path.join(exportsDir, f));
          deleted.local.push(item);
        } catch (err) {
          errors.push('local rm ' + item + ': ' + err.message);
        }
      }
    } catch {}

    // 3. Drive — rclone 없으면 skip
    if (!checkRcloneAvailable()) {
      console.log(`[Project] cleanup-orphans done jobId=${jobId}: local=${deleted.local.length}, drive=0(rclone skipped), errors=${errors.length}`);
      broadcast('cleanup-orphans-done', { jobId, deleted, errors, driveSkipped: true });
      return;
    }

    // 3a. Drive 5폴더
    emitOrphansProgress(jobId, 'drive-folders', '', deleted, errors);
    for (const d of PROJECT_SUB_DIRS) {
      const remoteDir = `${RCLONE_REMOTE}:${RCLONE_REMOTE_BASE}/data/${d}`;
      const r = await rcloneRun(
        `rclone lsf ${JSON.stringify(remoteDir)} --dirs-only`,
        30000,
      );
      if (!r.ok) continue;
      const lines = r.stdout.split('\n').filter(Boolean);
      for (const line of lines) {
        const dirName = line.replace(/\/$/, '');
        if (!dirName || dirName.startsWith('.')) continue;
        if (activeSet.has(dirName)) continue;
        const item = d + '/' + dirName;
        emitOrphansProgress(jobId, 'drive-folders', item, deleted, errors);
        const remotePath = `${remoteDir}/${dirName}`;
        const pr = await rcloneRun(
          `rclone purge ${JSON.stringify(remotePath)} ${RCLONE_TRASH_BYPASS} 2>&1`,
          60000,
        );
        if (pr.ok) {
          deleted.drive.push(item);
        } else if (!isNotFoundError(pr.stderr || pr.stdout || pr.error)) {
          errors.push('drive purge ' + item + ': ' + (pr.stderr || pr.error));
        }
      }
    }

    // 3b. Drive exports prefix
    emitOrphansProgress(jobId, 'drive-exports', '', deleted, errors);
    const exportRemoteDir = `${RCLONE_REMOTE}:${RCLONE_REMOTE_BASE}/data/exports`;
    const lsfExp = await rcloneRun(
      `rclone lsf ${JSON.stringify(exportRemoteDir)} --files-only`,
      30000,
    );
    if (lsfExp.ok) {
      const lines = lsfExp.stdout.split('\n').filter(Boolean);
      for (const f of lines) {
        const prefix = deriveProjectPrefixFromExport(f);
        if (prefix == null) continue;
        if (activeSet.has(prefix)) continue;
        const item = 'exports/' + f;
        emitOrphansProgress(jobId, 'drive-exports', item, deleted, errors);
        const remoteFile = `${exportRemoteDir}/${f}`;
        const dr = await rcloneRun(
          `rclone deletefile ${JSON.stringify(remoteFile)} ${RCLONE_TRASH_BYPASS}`,
          30000,
        );
        if (dr.ok) {
          deleted.drive.push(item);
        } else if (!isNotFoundError(dr.stderr || dr.error)) {
          errors.push('drive del ' + item + ': ' + (dr.stderr || dr.error));
        }
      }
    }

    console.log(`[Project] cleanup-orphans done jobId=${jobId}: local=${deleted.local.length}, drive=${deleted.drive.length}, errors=${errors.length}`);
    broadcast('cleanup-orphans-done', { jobId, deleted, errors, driveSkipped: false });
  } catch (e) {
    console.error('[Project] cleanup-orphans error jobId=' + jobId + ':', e);
    broadcast('cleanup-orphans-error', { jobId, error: e.message, deleted, errors });
  } finally {
    if (cleanupOrphansActiveJobId === jobId) cleanupOrphansActiveJobId = null;
  }
}

app.post('/api/project/cleanup-orphans', (req, res) => {
  // 이미 진행 중이면 동일 jobId 반환 (동시 실행 가드)
  if (cleanupOrphansActiveJobId) {
    return res.json({ ok: true, jobId: cleanupOrphansActiveJobId, alreadyRunning: true });
  }
  const jobId = 'cleanup-' + Date.now().toString() + '-' + Math.random().toString(36).slice(2, 8);
  cleanupOrphansActiveJobId = jobId;
  console.log('[Project] cleanup-orphans started jobId=' + jobId);
  broadcast('cleanup-orphans-start', { jobId });
  res.json({ ok: true, jobId, alreadyRunning: false });
  // fire-and-forget — 응답 보낸 뒤 백그라운드 진행
  runCleanupOrphans(jobId);
});

// ─── Scene import (LLM-friendly JSON schema) ─────────────────────────
// 워크플로우: 본인이 GET /api/import-schema/scenes로 스키마 예시 받아
// LLM에 prompt 함께 넣어 결과 JSON 생성 → POST /api/projects/import-scenes로 전송.
// dryRun=true면 변경 계획만 반환 (UI에서 미리보기). dryRun=false면 백업 후 적용.
//
// 입력 형식 (예시):
//   {
//     "format": "sdstudio-scene-import-v1",
//     "scenes": {
//       "씬 이름": {
//         "resolution": "portrait",       // 선택, 새 씬일 때만 사용
//         "slots": [                       // 필수, 2차원 배열
//           ["슬롯 0 단일 piece"],
//           ["슬롯 1 변형 A", "슬롯 1 변형 B"],
//           [{ "prompt": "객체형도 가능", "enabled": false }]
//         ]
//       }
//     }
//   }
//
// piece는 string 또는 {prompt, enabled?, characterPrompts?} 객체. id는 자동 생성.

const SCENE_IMPORT_FORMAT = 'sdstudio-scene-import-v1';

const SCENE_IMPORT_SCHEMA_EXAMPLE = {
  format: SCENE_IMPORT_FORMAT,
  _note: '슬롯은 2차원 배열. 항목은 string (= prompt 텍스트) 또는 {prompt, enabled?} 객체. ' +
         'id/characterPrompts/mains/meta 등은 자동 채움. 기존 씬과 이름이 겹치면 ' +
         'policy에서 overwrite|skip을 선택 (기본 skip). 새 씬은 자동 추가.',
  scenes: {
    '예시 씬.variant': {
      resolution: 'portrait',
      slots: [
        ['슬롯 0 단일 piece'],
        ['슬롯 1 변형 A', '슬롯 1 변형 B'],
        [{ prompt: '객체형 piece (enabled=false면 후보에서 제외)', enabled: false }],
      ],
    },
  },
};

async function findProjectFile(name) {
  const projectsDir = resolvePath('projects');
  const walked = await walkDir(projectsDir, 1);
  for (const f of walked.files) {
    if (!f.endsWith('.json')) continue;
    if (path.basename(f, '.json') === name) {
      return path.join(projectsDir, f);
    }
  }
  return null;
}

function normalizeSceneImport(body) {
  if (!body || typeof body !== 'object') throw new Error('body required');
  if (body.format !== SCENE_IMPORT_FORMAT) {
    throw new Error(`format must be "${SCENE_IMPORT_FORMAT}" (got "${body.format}")`);
  }
  if (!body.scenes || typeof body.scenes !== 'object' || Array.isArray(body.scenes)) {
    throw new Error('scenes object required');
  }
  const out = {};
  for (const [name, scene] of Object.entries(body.scenes)) {
    if (!scene || typeof scene !== 'object') throw new Error(`scenes["${name}"] must be object`);
    if (!Array.isArray(scene.slots)) throw new Error(`scenes["${name}"].slots must be array`);
    const slots = scene.slots.map((slot, si) => {
      if (!Array.isArray(slot)) throw new Error(`scenes["${name}"].slots[${si}] must be array`);
      return slot.map((piece, pi) => {
        if (typeof piece === 'string') {
          return { prompt: piece, characterPrompts: [], id: uuidv4(), enabled: true };
        }
        if (piece && typeof piece === 'object' && typeof piece.prompt === 'string') {
          return {
            prompt: piece.prompt,
            characterPrompts: Array.isArray(piece.characterPrompts) ? piece.characterPrompts : [],
            id: typeof piece.id === 'string' && piece.id ? piece.id : uuidv4(),
            enabled: piece.enabled !== false,
          };
        }
        throw new Error(`scenes["${name}"].slots[${si}][${pi}] must be string or {prompt}`);
      });
    });
    out[name] = {
      slots,
      resolution: typeof scene.resolution === 'string' ? scene.resolution : null,
    };
  }
  return out;
}

app.get('/api/import-schema/scenes', (req, res) => {
  res.json(SCENE_IMPORT_SCHEMA_EXAMPLE);
});

app.post('/api/projects/import-scenes', async (req, res) => {
  try {
    const name = sanitizeProjectName(req.body && req.body.projectName);
    if (!name) return res.status(400).json({ ok: false, error: 'Invalid projectName' });
    const dryRun = !!req.body.dryRun;
    const policy = (req.body && req.body.policy && typeof req.body.policy === 'object') ? req.body.policy : {};

    let normalized;
    try {
      normalized = normalizeSceneImport(req.body);
    } catch (e) {
      return res.status(400).json({ ok: false, error: e.message });
    }

    const projectPath = await findProjectFile(name);
    if (!projectPath) {
      return res.status(404).json({ ok: false, error: `Project "${name}" not found` });
    }

    const raw = await fs.readFile(projectPath, 'utf-8');
    const data = JSON.parse(raw);
    if (!data.scenes || typeof data.scenes !== 'object') data.scenes = {};

    const plan = { new: [], conflicts: [], skipped: [], applied: [] };
    for (const [scName, scNew] of Object.entries(normalized)) {
      const newSlotCounts = scNew.slots.map((s) => s.length);
      const newCombos = newSlotCounts.reduce((a, b) => a * b, 1);
      if (data.scenes[scName]) {
        const curSlots = Array.isArray(data.scenes[scName].slots) ? data.scenes[scName].slots : [];
        const curSlotCounts = curSlots.map((s) => s.length);
        const curCombos = curSlotCounts.reduce((a, b) => a * b, 1);
        const action = policy[scName] || 'skip';
        plan.conflicts.push({
          name: scName,
          currentSlots: curSlotCounts,
          currentCombos: curCombos,
          newSlots: newSlotCounts,
          newCombos,
          action,
        });
      } else {
        plan.new.push({ name: scName, newSlots: newSlotCounts, newCombos });
      }
    }

    if (dryRun) {
      return res.json({ ok: true, dryRun: true, projectPath: path.basename(projectPath), plan });
    }

    // Apply
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupPath = projectPath + '.bak-import-' + ts;
    await fs.copyFile(projectPath, backupPath);

    for (const [scName, scNew] of Object.entries(normalized)) {
      if (data.scenes[scName]) {
        const action = policy[scName] || 'skip';
        if (action === 'skip') {
          plan.skipped.push(scName);
          continue;
        }
        if (action === 'overwrite') {
          data.scenes[scName].slots = scNew.slots;
          if (scNew.resolution) data.scenes[scName].resolution = scNew.resolution;
          plan.applied.push({ name: scName, action: 'overwrite' });
        } else {
          return res.status(400).json({ ok: false, error: `Invalid policy for "${scName}": ${action}` });
        }
      } else {
        data.scenes[scName] = {
          name: scName,
          resolution: scNew.resolution || 'portrait',
          imageMap: [],
          mains: [],
          type: 'scene',
          slots: scNew.slots,
          meta: { SDImageGen: { type: 'SDImageGen' } },
          sceneCharacterPrompts: [],
          useSceneCharacterPrompts: false,
          sceneCharacterUC: '',
        };
        plan.applied.push({ name: scName, action: 'new' });
      }
    }

    const tmp = projectPath + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
    await fs.rename(tmp, projectPath);

    console.log(`[Import] project="${name}" applied=${plan.applied.length} skipped=${plan.skipped.length} backup=${path.basename(backupPath)}`);
    res.json({ ok: true, backup: path.basename(backupPath), plan });
  } catch (e) {
    console.error('[Import] error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/fs/exists', async (req, res) => {
  try {
    await fs.access(resolvePath(req.query.path));
    res.json({ exists: true });
  } catch { res.json({ exists: false }); }
});

app.get('/api/fs/show', async (req, res) => {
  try {
    const filePath = resolvePath(req.query.path);
    res.sendFile(filePath);
  } catch (e) { res.status(404).json({ error: e.message }); }
});

app.get('/api/fs/download', async (req, res) => {
  try {
    const filePath = resolvePath(req.query.path);
    res.download(filePath);
  } catch (e) { res.status(404).json({ error: e.message }); }
});

app.get('/api/fs/image', async (req, res) => {
  try {
    const filePath = resolvePath(req.query.path);
    const ext = path.extname(filePath).toLowerCase();
    const mimeMap = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
    res.contentType(mimeMap[ext] || 'application/octet-stream');
    res.sendFile(filePath);
  } catch (e) { res.status(404).json({ error: e.message }); }
});

app.post('/api/fs/sync-exports', async (req, res) => {
  // Phase 9: 단일 파일 모드는 백그라운드 큐. 클라가 응답 안 기다리고,
  // 서버는 driveRetryQueue에 enqueue + setImmediate 트리거 후 즉시 202 반환.
  // 완료/실패는 WS (drive-sync-complete/failed) 이벤트로 broadcast.
  const exportsDir = path.join(__dirname, 'data', 'exports');
  const requestedPath = (req.body && typeof req.body.path === 'string') ? req.body.path : '';

  if (requestedPath) {
    // 보안: exports/ 하위 단일 파일로 제한. 'exports/foo.tar' 또는 'foo.tar' 둘 다 허용.
    const cleaned = requestedPath.replace(/^exports[\/]/, '');
    if (cleaned.includes('..') || cleaned.includes('/') || cleaned.includes('\\')) {
      return res.status(400).json({ ok: false, error: 'Invalid path' });
    }
    const candidate = path.join(exportsDir, cleaned);
    if (!candidate.startsWith(exportsDir + path.sep)) {
      return res.status(400).json({ ok: false, error: 'Path traversal' });
    }
    try {
      await fs.access(candidate);
    } catch {
      return res.status(404).json({ ok: false, error: 'File not found' });
    }
    const localPath = candidate;
    const remotePath = `${RCLONE_REMOTE}:${RCLONE_REMOTE_BASE}/data/exports/${cleaned}`;
    // 큐에 enqueue + 즉시 처리 트리거 (setImmediate로 event loop 양보 후 처리).
    enqueueDriveRetry(localPath, remotePath, null, requestedPath, true);
    setImmediate(() => processDriveRetryQueue({ ignoreSchedule: true }));
    return res.status(202).json({ ok: true, jobId: requestedPath, queued: true });
  }

  // 레거시 dir 모드: 전체 exports/ 디렉토리 동기 업로드. 현재 클라에서 호출하는 경로 없음.
  // backwards compat 유지차 동기 흐름 그대로 둠.
  const { exec } = require('child_process');
  const rcloneCmd = `rclone copy ${JSON.stringify(exportsDir + '/')} ${RCLONE_REMOTE}:${RCLONE_REMOTE_BASE}/data/exports/ --log-level INFO`;
  exec(rcloneCmd, { timeout: 180000, maxBuffer: 4 * 1024 * 1024 }, (err) => {
    if (err) {
      console.error('[Sync exports] error (mode=dir):', err.message);
      return res.status(500).json({ ok: false, error: err.message, mode: 'dir' });
    }
    console.log('[Sync exports] uploaded (mode=dir)');
    res.json({ ok: true, mode: 'dir' });
  });
});

app.get('/api/drive/retry-status', (req, res) => {
  res.json({
    count: driveRetryQueue.length,
    pendingCount: driveRetryQueue.filter((e) => e.status !== 'failed').length,
    failedCount: driveRetryQueue.filter((e) => e.status === 'failed').length,
    intervalsMs: DRIVE_RETRY_INTERVALS,
    maxAttempts: DRIVE_RETRY_MAX_ATTEMPTS,
    entries: driveRetryQueue.map((e) => ({
      localPath: e.localPath,
      requestedPath: e.requestedPath || null,
      fileName: path.basename(e.localPath),
      addedAt: e.addedAt,
      attempts: e.attempts,
      status: e.status || 'pending',
      nextRetryAt: e.nextRetryAt || null,
      lastError: e.lastError,
      lastAttemptAt: e.lastAttemptAt,
    })),
  });
});

// 즉시 재시도 (스케줄 무시). 모든 pending entry를 한 번에 시도.
app.post('/api/drive/retry-now', async (req, res) => {
  const before = driveRetryQueue.length;
  const result = await processDriveRetryQueue({ ignoreSchedule: true });
  res.json({ ok: true, before, after: driveRetryQueue.length, ...result });
});

// 특정 entry 큐에서 제거 + 로컬 파일도 삭제. widget의 dismiss/포기 버튼용.
// "포기" = Drive 동기화 + 로컬 산출물 둘 다 완전 취소 (2026-05-13 본인 요청).
// localPath는 enqueueDriveRetry가 항상 resolvePath() 출력 (DATA_DIR 하위)이라
// path traversal 위험은 없지만 startsWith 검증 한 번 더.
app.post('/api/drive/retry-dismiss', async (req, res) => {
  const { localPath } = req.body || {};
  if (!localPath || typeof localPath !== 'string') {
    return res.status(400).json({ ok: false, error: 'localPath required' });
  }
  const idx = driveRetryQueue.findIndex((e) => e.localPath === localPath);
  if (idx < 0) return res.json({ ok: true, removed: false });
  driveRetryQueue.splice(idx, 1);
  saveDriveRetryQueue();
  // 로컬 파일 삭제 — DATA_DIR 하위만 허용
  let localRemoved = false;
  if (localPath.startsWith(DATA_DIR + path.sep)) {
    try {
      await fs.unlink(localPath);
      localRemoved = true;
    } catch {} // 이미 없거나 권한 없으면 무시
  }
  res.json({ ok: true, removed: true, localRemoved });
});

// failed entry를 다시 pending으로 (attempts=0). widget의 reset 버튼용.
app.post('/api/drive/retry-reset', (req, res) => {
  const { localPath } = req.body || {};
  if (!localPath || typeof localPath !== 'string') {
    return res.status(400).json({ ok: false, error: 'localPath required' });
  }
  const entry = driveRetryQueue.find((e) => e.localPath === localPath);
  if (!entry) return res.status(404).json({ ok: false, error: 'not found' });
  entry.status = 'pending';
  entry.attempts = 0;
  entry.nextRetryAt = Date.now() + DRIVE_RETRY_INTERVALS[0];
  saveDriveRetryQueue();
  res.json({ ok: true });
});

// ─── API: Export pipeline (이미지 내보내기 백그라운드) ─────────────────
// body: { paths: [{ srcPath, finalName }], outFilePath, optimize: 'none'|'lossy'|'lossless'|'avif', imageSize }
// 큐에 적재 + 즉시 처리 트리거, 202 + jobId 반환. WS 이벤트로 진행/완료 알림.
app.post('/api/export/scene-pack', async (req, res) => {
  const { paths: items, outFilePath, optimize, imageSize } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ ok: false, error: 'paths required' });
  }
  if (!outFilePath || typeof outFilePath !== 'string') {
    return res.status(400).json({ ok: false, error: 'outFilePath required' });
  }
  // outFilePath는 exports/ 하위 단일 파일이어야 함 (path traversal 방지).
  const exportsDir = path.join(__dirname, 'data', 'exports');
  const cleaned = outFilePath.replace(/^exports[\/]/, '');
  if (cleaned.includes('..') || cleaned.includes('/') || cleaned.includes('\\')) {
    return res.status(400).json({ ok: false, error: 'Invalid outFilePath' });
  }
  const outAbs = path.join(exportsDir, cleaned);
  if (!outAbs.startsWith(exportsDir + path.sep)) {
    return res.status(400).json({ ok: false, error: 'outFilePath traversal' });
  }
  // 각 srcPath도 data dir 안에 있어야 함. resolvePath가 던지면 400.
  try {
    for (const item of items) {
      if (!item || typeof item.srcPath !== 'string' || typeof item.finalName !== 'string') {
        return res.status(400).json({ ok: false, error: 'paths[i] needs { srcPath, finalName }' });
      }
      resolvePath(item.srcPath);  // throws on traversal
    }
  } catch (e) {
    return res.status(400).json({ ok: false, error: 'srcPath invalid: ' + e.message });
  }
  const jobId = uuidv4();
  exportQueue.push({
    jobId,
    paths: items,
    outFilePath: 'exports/' + cleaned,
    optimize: optimize || 'none',
    imageSize: imageSize || 0,
  });
  setImmediate(() => processExportQueue());
  res.status(202).json({ ok: true, jobId, queued: true });
});

app.get('/api/export/status', (req, res) => {
  res.json({
    active: Array.from(activeExportJobs.values()),
    waiting: exportQueue.map((j) => ({
      jobId: j.jobId,
      outFileName: (j.outFilePath || '').split('/').pop() || '',
      total: (j.paths || []).length,
    })),
    concurrency: EXPORT_CONCURRENCY,
  });
});

// 진행 중 또는 대기 중 export job 취소.
// active면 canceled 플래그 set → 다음 chunk 경계에서 throw (Promise.all 진행 중 chunk는
// 완료까지 진행, 다음 chunk는 안 시작). queue에 있으면 그냥 제거.
app.post('/api/export/cancel', async (req, res) => {
  const jobId = req.body && req.body.jobId;
  if (!jobId || typeof jobId !== 'string') {
    return res.status(400).json({ ok: false, error: 'jobId required' });
  }
  // 1. 대기 큐에서 제거
  const qIdx = exportQueue.findIndex((j) => j.jobId === jobId);
  if (qIdx >= 0) {
    exportQueue.splice(qIdx, 1);
    broadcast('export-failed', { jobId, phase: 'queued', error: 'canceled' });
    return res.json({ ok: true, where: 'queue' });
  }
  // 2. 진행 중이면 플래그 set
  const info = activeExportJobs.get(jobId);
  if (info) {
    info.canceled = true;
    return res.json({ ok: true, where: 'active' });
  }
  // 3. 둘 다 없으면 이미 끝났거나 알 수 없음
  res.json({ ok: false, error: 'not found (already finished?)' });
});

app.post('/api/fs/zip', async (req, res) => {
  try {
    const JSZip = require('jszip');
    const zip = new JSZip();
    const skipped = [];
    let included = 0;
    for (const entry of req.body.files) {
      try {
        const content = await fs.readFile(resolvePath(entry.path));
        zip.file(entry.name, content);
        included++;
      } catch (e) {
        if (e.code === 'ENOENT') {
          skipped.push(entry.path);
          console.warn('[zip] ENOENT, skipping:', entry.path);
        } else {
          throw e;
        }
      }
    }
    if (included === 0) {
      return res.status(400).json({ ok: false, error: '아카이브할 파일이 없어요', skipped });
    }
    const buf = await zip.generateAsync({ type: 'nodebuffer' });
    const outPath = resolvePath(req.body.outPath);
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, buf);
    res.json({ ok: true, included, skipped });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/fs/unzip', async (req, res) => {
  try {
    const JSZip = require('jszip');
    const buf = await fs.readFile(resolvePath(req.body.tarPath));
    const zip = await JSZip.loadAsync(buf);
    const outDir = resolvePath(req.body.outPath);
    await fs.mkdir(outDir, { recursive: true });
    for (const [name, file] of Object.entries(zip.files)) {
      if (file.dir) {
        await fs.mkdir(path.join(outDir, name), { recursive: true });
      } else {
        const filePath = path.join(outDir, name);
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, await file.async('nodebuffer'));
      }
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── API: Thumbnail (direct image serving, no base64) ──────────
app.get('/api/fs/thumb', async (req, res) => {
  try {
    const imagePath = resolvePath(req.query.path);
    const size = parseInt(req.query.size) || 200;

    // Build fastcache path: same directory structure as ImageService.getSmallImagePath
    const pathParts = req.query.path.split('/');
    const fileName = size.toString() + '_' + pathParts.pop();
    pathParts.push('fastcache');
    pathParts.push(fileName);
    const cachePath = resolvePath(pathParts.join('/'));

    // Check if cached thumbnail exists
    let thumbExists = false;
    try {
      await fs.access(cachePath);
      thumbExists = true;
    } catch {}

    if (!thumbExists) {
      // Generate thumbnail with sharp
      if (!sharp) {
        // Fallback: serve original image
        const ext = path.extname(imagePath).toLowerCase();
        const mimeMap = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
        res.contentType(mimeMap[ext] || 'image/png');
        res.sendFile(imagePath);
        return;
      }
      await fs.mkdir(path.dirname(cachePath), { recursive: true });
      const scale = size <= 200 ? 1.25 : 1.1;
      const maxDim = Math.ceil(scale * size);
      await sharp(imagePath)
        .resize(maxDim, maxDim, { fit: 'inside', withoutEnlargement: true })
        .png()
        .toFile(cachePath);
    }

    const ext = path.extname(cachePath).toLowerCase();
    const mimeMap = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
    res.contentType(mimeMap[ext] || 'image/png');
    res.set('Cache-Control', 'private, max-age=3600');
    res.sendFile(cachePath);
  } catch (e) { res.status(404).json({ error: e.message }); }
});

// ─── API: Image Processing ──────────────────────────────────────────
app.post('/api/image/resize', async (req, res) => {
  try {
    if (!sharp) return res.status(501).json({ error: 'sharp not available' });
    const { inputPath, outputPath, maxWidth, maxHeight, optimize } = req.body;
    const input = resolvePath(inputPath);
    const output = resolvePath(outputPath);
    await fs.mkdir(path.dirname(output), { recursive: true });

    let pipeline = sharp(input).resize(maxWidth, maxHeight, { fit: 'inside', withoutEnlargement: true });

    if (optimize === 1) { // LOSSY
      pipeline = pipeline.webp({ quality: 80 });
    } else if (optimize === 2) { // LOSSLESS
      pipeline = pipeline.webp({ lossless: true });
    } else if (optimize === 3) { // AVIF
      pipeline = pipeline.avif({ quality: 65, effort: 2 });
    }

    await pipeline.toFile(output);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/image/remove-bg', async (req, res) => {
  res.status(501).json({ error: 'Background removal not available in server mode' });
});

app.post('/api/image/encode-vibe', async (req, res) => {
  try {
    if (!nai.token) {
      try { nai.token = await fs.readFile(resolvePath('TOKEN.txt'), 'utf-8'); } catch {}
    }
    if (!nai.token) return res.status(401).json({ error: 'Not logged in' });
    const config = await loadConfig();
    const result = await nai.encodeVibeImage(req.body, config);
    res.json({ result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── API: Tags ──────────────────────────────────────────────────────
app.get('/api/tags/search', (req, res) => {
  const results = tagSearch.searchTagsInDB(req.query.q || '');
  // Strip aliases from response (frontend doesn't need them)
  res.json(results.map(({ aliases, ...rest }) => rest));
});

app.get('/api/tags/lookup', (req, res) => {
  const tag = tagSearch.lookupTag(req.query.q || '');
  if (tag) {
    const { aliases, ...rest } = tag;
    res.json(rest);
  } else {
    res.json(null);
  }
});

// ─── API: Pieces ────────────────────────────────────────────────────
app.post('/api/pieces/load', (req, res) => {
  tagSearch.setPieces(req.body.pieces);
  res.json({ ok: true });
});

app.get('/api/pieces/search', (req, res) => {
  res.json(tagSearch.searchPieces(req.query.q || ''));
});

// ─── SPA fallback ───────────────────────────────────────────────────
app.get('*', (req, res) => {
  // Serve index.html for SPA routing
  const indexPath = path.join(__dirname, 'public', 'index.html');
  if (fss.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send('Frontend not built. Run: cd frontend && npm run build');
  }
});

// ─── Start server ───────────────────────────────────────────────────
async function start() {
  await ensureDirs();
  await tagSearch.loadTagDB(path.join(DATA_DIR, 'db.csv'));

  // Try to load saved token
  try {
    nai.token = await fs.readFile(resolvePath('TOKEN.txt'), 'utf-8');
    console.log('[NAI Studio] Token loaded from file');
  } catch {}

  const server = http.createServer(app);

  // WebSocket
  wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (ws) => {
    console.log('[NAI Studio] WebSocket client connected');
    ws.on('close', () => console.log('[NAI Studio] WebSocket client disconnected'));
  });

  server.listen(PORT, () => {
    console.log(`[NAI Studio] Server running on port ${PORT}`);
  loadQueueState();
  loadTimingHistory();
  loadCompletedJobs();
    loadDriveRetryQueue().then(() => {
      // Migrate legacy entries (pre-F1): no status/nextRetryAt fields.
      // 부팅 직후 모두 즉시 시도하지 않게 nextRetryAt을 띄움.
      const now = Date.now();
      for (const e of driveRetryQueue) {
        if (!e.status) e.status = 'pending';
        if (e.nextRetryAt == null && e.status === 'pending') {
          const idx = Math.min(e.attempts || 0, DRIVE_RETRY_INTERVALS.length - 1);
          e.nextRetryAt = now + DRIVE_RETRY_INTERVALS[idx];
        }
      }
      if (driveRetryQueue.length > 0) saveDriveRetryQueue();
      setInterval(processDriveRetryQueue, DRIVE_RETRY_POLL_MS);
    });
    console.log(`[NAI Studio] Frontend: http://localhost:${PORT}`);
    console.log(`[NAI Studio] API: http://localhost:${PORT}/api`);
  });
}

process.on('SIGINT', () => {
  console.log('[NAI Studio] SIGINT received, flushing queue state...');
  flushQueueState();
  flushTimingHistory();
  process.exit(0);
});
process.on('SIGTERM', () => {
  console.log('[NAI Studio] SIGTERM received, flushing queue state...');
  flushQueueState();
  flushTimingHistory();
  process.exit(0);
});

start().catch(console.error);
