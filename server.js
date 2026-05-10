const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const fss = require('fs');
const http = require('http');
const { WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');
const { NaiClient } = require('./lib/nai-client');

const DATA_DIR = path.join(__dirname, 'data');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const PORT = process.env.PORT || 6247;

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
  if (!resolved.startsWith(DATA_DIR)) {
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

// ─── Tag Search (db.csv based) ──────────────────────────────────────
let tagDB = [];
let piecesDB = [];

async function loadTagDB() {
  const dbPath = path.join(DATA_DIR, 'db.csv');
  try {
    const content = await fs.readFile(dbPath, 'utf-8');
    tagDB = content.split('\n').filter(Boolean).map(line => {
      // danbooru.csv format: word,category,freq,"alias1,alias2,..."
      // or SDStudio format: word,category,freq,redirect
      const i1 = line.indexOf(',');
      if (i1 === -1) return null;
      const i2 = line.indexOf(',', i1 + 1);
      if (i2 === -1) return null;
      const i3 = line.indexOf(',', i2 + 1);
      if (i3 === -1) return null;
      const word = line.substring(0, i1);
      const category = parseInt(line.substring(i1 + 1, i2)) || 0;
      const freq = parseInt(line.substring(i2 + 1, i3)) || 0;
      let rest = line.substring(i3 + 1).replace(/^"|"$/g, '');
      // If rest contains commas, it's aliases — split and store for search
      const aliases = rest ? rest.split(',').map(a => a.trim()) : [];
      // redirect = "null" means "use word as-is"
      return { word, normalized: word, freq, category, redirect: 'null', priority: 0, aliases };
    }).filter(Boolean);
    console.log(`[NAI Studio] Loaded ${tagDB.length} tags`);
  } catch {
    console.log('[NAI Studio] No db.csv found, tag search disabled');
  }
}

function searchTagsInDB(query) {
  if (!tagDB.length) return [];
  const q = query.toLowerCase().replace(/ /g, '_');
  const exact = [];
  const prefix = [];
  const contains = [];
  for (const tag of tagDB) {
    const w = tag.word.toLowerCase();
    if (w === q) { exact.push(tag); continue; }
    if (w.startsWith(q)) { prefix.push(tag); if (prefix.length > 50) continue; continue; }
    if (contains.length < 20) {
      if (w.includes(q)) { contains.push(tag); continue; }
      // Also match aliases
      if (tag.aliases && tag.aliases.some(a => a.toLowerCase().includes(q))) {
        contains.push(tag);
      }
    }
  }
  return [...exact, ...prefix.sort((a, b) => b.freq - a.freq), ...contains].slice(0, 30);
}

// ─── Server-side generation queue ───────────────────────────────
const genQueue = [];
let queueProcessing = false;
let queuePaused = false;
let queueStats = { completed: 0, failed: 0 };
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
      console.log('[NAI Studio] Restored ' + genQueue.length + ' queued jobs from disk');
      processQueue();
    }
    require('fs').unlinkSync(QUEUE_STATE_FILE);
  } catch {}
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

async function diskCleanupStage2() {
  // fastcache/ — 전부 삭제 가능 (재생성됨)
  let cleaned = 0;
  const { execSync } = require('child_process');
  try {
    const output = execSync(`find "${DATA_DIR}" -path "*/fastcache/*" -type f 2>/dev/null`).toString().trim();
    const files = output ? output.split('\n') : [];
    for (const f of files) {
      try { await fs.unlink(f); cleaned++; } catch {}
    }
    execSync(`find "${DATA_DIR}" -name "fastcache" -type d -empty -delete 2>/dev/null`);
  } catch {}
  if (cleaned > 0) console.log(`[Disk] Stage 2: deleted ${cleaned} fastcache files`);
  return cleaned;
}

async function diskCleanupStage3() {
  // .trash/ — 이미 삭제된 이미지
  let cleaned = 0;
  const { execSync } = require('child_process');
  try {
    const output = execSync(`find "${DATA_DIR}" -path "*/.trash/*" -type f 2>/dev/null`).toString().trim();
    const files = output ? output.split('\n') : [];
    for (const f of files) {
      try { await fs.unlink(f); cleaned++; } catch {}
    }
    execSync(`find "${DATA_DIR}" -name ".trash" -type d -empty -delete 2>/dev/null`);
  } catch {}
  if (cleaned > 0) console.log(`[Disk] Stage 3: deleted ${cleaned} trash files`);
  return cleaned;
}

async function diskCleanupStage4() {
  // outs/ 30일+ 이미지 — Drive 동기화 확인 후 삭제
  let cleaned = 0;
  const { execSync } = require('child_process');
  const outsDir = path.join(DATA_DIR, 'outs');

  // rclone이 있는지, gdrivemain이 설정되어 있는지 확인
  let rcloneOK = false;
  try {
    execSync('which rclone', { stdio: 'pipe' });
    execSync('rclone listremotes 2>/dev/null | grep gdrivemain', { stdio: 'pipe' });
    rcloneOK = true;
  } catch {}

  if (!rcloneOK) {
    console.log('[Disk] Stage 4: skipped — rclone/gdrivemain not available');
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
        `rclone lsjson "gdrivemain:NAI-Studio/data/outs" --recursive --files-only 2>/dev/null`,
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
    try {
      broadcast('queue-job-start', { jobId: job.jobId, pending: genQueue.length });
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
        // Pre-generate thumbnails (200/400 sizes; 500 generated on-demand by thumb endpoint)
        if (sharp) {
          for (const size of [200, 400, 500]) {
            try {
              const pp = job.params.outputFilePath.split('/');
              const fn = size + '_' + pp.pop();
              pp.push('fastcache', fn);
              const cp = resolvePath(pp.join('/'));
              await fs.mkdir(path.dirname(cp), { recursive: true });
              const maxDim = Math.ceil((size <= 200 ? 1.25 : 1.1) * size);
              await sharp(outPath).resize(maxDim, maxDim, { fit: 'inside', withoutEnlargement: true }).png().toFile(cp);
            } catch (e) { console.error('[Prewarm queue] size=' + size + ' error:', e.message); }
          }
        }
      }

      broadcast('queue-job-complete', {
        jobId: job.jobId,
        outputFilePath: job.params.outputFilePath,
      });
      broadcastQueueStatus();
      broadcast('image-changed', job.params.outputFilePath);
      queueStats.completed++;
    } catch (e) {
      if (e.message && e.message.includes('429')) {
        job._retries = (job._retries || 0) + 1;
        if (job._retries <= 10) {
          console.log(`[NAI Studio] Queue job ${job.jobId}: NAI rate limited, retry ${job._retries}/10 in 5s...`);
          await new Promise(r => setTimeout(r, 5000));
          continue;
        }
        console.error(`[NAI Studio] Queue job ${job.jobId}: max retries exceeded`);
      }
      broadcast('queue-job-error', { jobId: job.jobId, error: e.message });
      broadcastQueueStatus();
      queueStats.failed++;
      console.error(`[NAI Studio] Queue job ${job.jobId} error:`, e.message);
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

// Strip /nai prefix (Tailscale serve --set-path /nai passes it through)
app.use((req, res, next) => {
  if (req.url.startsWith('/studio')) {
    req.url = req.url.slice(7) || '/';
  }
  next();
});

// Serve static frontend
app.use(express.static(path.join(__dirname, 'public')));

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
// ─── Version check (GitHub-based) ───
let _versionCache = { fetchedAt: 0, latest: null, repoUrl: null };
const VERSION_CACHE_TTL = 5 * 60 * 1000;  // 5분

function getRepoVersionUrl() {
  if (process.env.NAI_STUDIO_VERSION_URL) return process.env.NAI_STUDIO_VERSION_URL;
  try {
    const { execSync } = require('child_process');
    const remote = execSync('git -C ' + __dirname + ' remote get-url origin', { encoding: 'utf8', timeout: 2000 }).trim();
    const m = remote.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
    if (m) return 'https://raw.githubusercontent.com/' + m[1] + '/' + m[2] + '/main/version.json';
  } catch {}
  return null;
}

app.get('/api/version-check', async (req, res) => {
  try {
    const now = Date.now();
    const repoUrl = getRepoVersionUrl();
    if (!repoUrl) return res.json({ current: null, latest: null, updateAvailable: false, error: 'no-repo-url' });

    if (now - _versionCache.fetchedAt > VERSION_CACHE_TTL || _versionCache.repoUrl !== repoUrl) {
      try {
        const r = await fetch(repoUrl, { signal: AbortSignal.timeout(5000) });
        if (r.ok) {
          const data = await r.json();
          _versionCache = { fetchedAt: now, latest: data.version, repoUrl, notes: data.notes || null, released: data.released || null };
        }
      } catch (e) {
        console.warn('[version-check] fetch failed:', e.message);
      }
    }

    let current = null;
    try {
      const bi = JSON.parse(await fs.readFile(path.join(__dirname, 'public', 'build-info.json'), 'utf8'));
      current = bi.version;
    } catch {}

    res.json({
      current,
      latest: _versionCache.latest,
      updateAvailable: !!(current && _versionCache.latest && current !== _versionCache.latest),
      notes: _versionCache.notes,
      released: _versionCache.released,
    });
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
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/login-token', async (req, res) => {
  try {
    const { token } = req.body;
    nai.token = token;
    await fs.writeFile(resolvePath('TOKEN.txt'), token, 'utf-8');
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
  const jobId = uuidv4();
  genQueue.push({ jobId, params: req.body });
  broadcastQueueStatus();
  // Kick off processing (non-blocking)
  setImmediate(() => processQueue());
  res.json({ jobId });
  saveQueueState();
});

app.post('/api/queue/add-batch', async (req, res) => {
  const jobs = req.body.jobs || [];
  const space = QUEUE_MAX_SIZE - genQueue.length;
  const toAdd = jobs.slice(0, space);
  const jobIds = [];
  for (const params of toAdd) {
    const jobId = uuidv4();
    genQueue.push({ jobId, params });
    jobIds.push(jobId);
  }
  broadcastQueueStatus();
  setImmediate(() => processQueue());
  res.json({ jobIds, rejected: jobs.length - toAdd.length });
});

app.get('/api/queue/status', async (req, res) => {
  const freeGB = await getDiskFreeGB();
  res.json({
    pending: genQueue.length,
    processing: queueProcessing,
    paused: queuePaused,
    completed: queueStats.completed,
    failed: queueStats.failed,
    diskFreeGB: parseFloat(freeGB.toFixed(1)),
    jobs: genQueue.slice(0, 20).map(j => ({ jobId: j.jobId, outputFilePath: j.params.outputFilePath })),
    totalJobs: genQueue.length,
  });
});

app.post('/api/queue/cancel', (req, res) => {
  const cancelled = genQueue.length;
  genQueue.length = 0;
  broadcastQueueStatus();
  res.json({ ok: true, cancelled });
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

      // Pre-generate thumbnails so gallery shows instantly
      if (sharp) {
        for (const size of [200, 400, 500]) {
          try {
            const pp = params.outputFilePath.split('/');
            const fn = size + '_' + pp.pop();
            pp.push('fastcache', fn);
            const cp = resolvePath(pp.join('/'));
            await fs.mkdir(path.dirname(cp), { recursive: true });
            const maxDim = Math.ceil((size <= 200 ? 1.25 : 1.1) * size);
            await sharp(outPath).resize(maxDim, maxDim, { fit: 'inside', withoutEnlargement: true }).png().toFile(cp);
          } catch (e) { console.error('[Prewarm direct] size=' + size + ' error:', e.message); }
        }
      }
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
    let moved = 0;
    for (const { src, dest } of moves) {
      try {
        const srcPath = resolvePath(src);
        const destPath = resolvePath(dest);
        await fs.mkdir(path.dirname(destPath), { recursive: true });
        await fs.rename(srcPath, destPath);
        moved++;
      } catch {}
    }
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

    // 1. Clean orphan .deleted files
    const projectDir = resolvePath('projects');
    try {
      const allFiles = await fs.readdir(projectDir);
      const jsonSet = new Set(allFiles.filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)));
      for (const f of allFiles) {
        if (f.endsWith('.deleted')) {
          try { await fs.unlink(path.join(projectDir, f)); cleanedOrphans++; } catch {}
        }
      }
    } catch {}

    // 2. Clean expired image trash (walk server-side)
    const activeProjects = [];
    try {
      const files = await fs.readdir(projectDir);
      for (const f of files) {
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
  const { exec } = require('child_process');
  const exportsDir = path.join(__dirname, 'data', 'exports');
  const cmd = 'rclone copy ' + JSON.stringify(exportsDir + '/') + ' gdrivemain:NAI-Studio/data/exports/ --log-level INFO';
  exec(cmd, { timeout: 180000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
    if (err) {
      console.error('[Sync exports] error:', err.message);
      return res.status(500).json({ ok: false, error: err.message });
    }
    console.log('[Sync exports] uploaded');
    res.json({ ok: true });
  });
});

app.post('/api/fs/zip', async (req, res) => {
  try {
    const JSZip = require('jszip');
    const zip = new JSZip();
    for (const entry of req.body.files) {
      const content = await fs.readFile(resolvePath(entry.path));
      zip.file(entry.name, content);
    }
    const buf = await zip.generateAsync({ type: 'nodebuffer' });
    const outPath = resolvePath(req.body.outPath);
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, buf);
    res.json({ ok: true });
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

app.post('/api/fs/extract-zip', async (req, res) => {
  try {
    const JSZip = require('jszip');
    const buf = await fs.readFile(resolvePath(req.body.zipPath));
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
  const results = searchTagsInDB(req.query.q || '');
  // Strip aliases from response (frontend doesn't need them)
  res.json(results.map(({ aliases, ...rest }) => rest));
});

app.get('/api/tags/lookup', (req, res) => {
  const q = (req.query.q || '').toLowerCase().replace(/ /g, '_');
  const tag = tagDB.find(t => t.word.toLowerCase() === q);
  if (tag) {
    const { aliases, ...rest } = tag;
    res.json(rest);
  } else {
    res.json(null);
  }
});

// ─── API: Pieces ────────────────────────────────────────────────────
app.post('/api/pieces/load', (req, res) => {
  piecesDB = req.body.pieces || [];
  res.json({ ok: true });
});

app.get('/api/pieces/search', (req, res) => {
  const q = (req.query.q || '').toLowerCase();
  const results = piecesDB.filter(p => p.toLowerCase().includes(q)).slice(0, 30);
  res.json(results);
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
  await loadTagDB();

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
    console.log(`[NAI Studio] Frontend: http://localhost:${PORT}`);
    console.log(`[NAI Studio] API: http://localhost:${PORT}/api`);
  });
}

process.on('SIGINT', () => {
  console.log('[NAI Studio] SIGINT received, flushing queue state...');
  flushQueueState();
  process.exit(0);
});
process.on('SIGTERM', () => {
  console.log('[NAI Studio] SIGTERM received, flushing queue state...');
  flushQueueState();
  process.exit(0);
});

start().catch(console.error);
