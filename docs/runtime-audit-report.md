# Runtime Audit Report — SDStudio Remote (nai-studio-2)

- **Date**: 2026-05-19 (KST)
- **Scope**: full codebase — Node.js backend (`server.js` + `lib/`) + React/MobX frontend (`frontend/src/`)
- **Method**: static analysis per `docs/runtime-audit-instructions.md` (11 categories, no execution)
- **Audited version**: v1.7.0 stable
- **Runtime targets**: Node.js LTS under pm2 fork mode (long-running, Oracle ARM Ampere A1, ~24 GB RAM) + browser (mobile Safari iOS 18+ and desktop Chrome, long-lived tabs)

---

## Executive summary

| Layer | Critical | High | Medium | Low |
|---|---:|---:|---:|---:|
| Backend (`server.js` + `lib/`) | 3 | 9 | 13 | 22 |
| Frontend Models | 3 | 7 | 14 | 20 |
| Frontend Workflows + Backends | 2 | 5 | 8 | 13 |
| Frontend Components | 1 | 4 | 9 | 20 |
| **Total** | **9** | **25** | **44** | **75** |

### 처리 현황 (2026-05-20 기준)

| Severity | Fix ✓ | Defer ⊘ | 미처리 | 진행률 |
|---|---:|---:|---:|---:|
| Critical | **9 / 9** | 0 | 0 | 100% |
| High     | 17       | 7 (Q4) | 1   | 96% (defer 포함) |
| Medium   | 9 (backend M1/M2/M3/M4/M5/M6/M7/M9/M13) | 0 | ~35 (M8/M10/M11/M12 + 모든 frontend Medium) | ~20% |
| Low      | 0 | 0 | 75 | 0% |

- Critical: 모두 fix. 마킹 누락은 본 P18 turn에 일괄 보강.
- High: P17 batch + L2.5 self-find으로 24/25 분류 (Q4 defer 사유는 각 entry 명시).
- Medium: P17~P18에 backend 9건 fix. **남은 backend 4건(M8/M10/M11/M12)** + frontend Medium 대다수 미진행.
- Low: 75건 전부 미진행. 다음 batch / dead-code cleanup pass에서 일괄 처리 후보.

### Cross-layer scoring (0–10, higher = worse)

| Dimension | Score | Reasoning |
|---|---:|---|
| Memory leak risk | **7** | MobX stores + pm2-long-lived process accumulate references over days/weeks. Multiple unreleased timers, WS handler Maps, base64 retention in queue/mirror paths. |
| CPU bottleneck risk | **7** | `execSync` on hot paths, sync `toDataURL` per mirror, listener fan-out across N scene cells, KDF on main thread. |
| Long-term runtime stability | **6** | Accretive leaks but bounded for typical session length. No reconnect backoff. WS no `error` handler — crash vector. |
| Production failure likelihood | **5** | OOM possible on large export/backup; ws crash vector; permanent UI-hang scenario on `ImageService` mutex; mobile thermal/battery drain real. |

### Top 5 highest-priority fixes (cross-layer)

1. **Backend — eliminate base64 round-trip in NAI client + stream export/backup zip + drop `EXPORT_CONCURRENCY` default to 3**
   `lib/nai-client.js:270/306/330` (`async('base64')` → `async('nodebuffer')`) + `server.js:821/1044/1671/1696/2657-2716/2932-2961`.
   Closes both backend Criticals. 2-line patch on base64; medium patch on zip streaming. **Largest heap/OOM win.**

2. **Components — add missing `[]` dep array to `BigPromptEditor` listener effect**
   `frontend/src/components/SceneEditor.tsx:127-139`. Trivial 1-character fix. Eliminates `addEventListener`/`removeEventListener` storm during every queue progress tick. **Direct relief for documented iOS jank/heat.**

3. **Workflows — `prepareMirrorCanvas` async `toBlob` + canvas teardown + image-load timeout**
   `frontend/src/models/workflows/SDWorkFlow.ts:617-703`. Closes two workflow Criticals at once (UI freeze on mirror + indefinite Promise hang on malformed base64).

4. **Models — replace `ImageService.acquireMutex` single-slot rendezvous with FIFO chain + idempotent release, wrap critical sections in try/finally**
   `frontend/src/models/ImageService.ts:70-84` (+ all callers). Eliminates the permanent-hang failure mode for thumbnail loading on exceptional error paths.

5. **Models — gate `TaskQueueService.restoreMirroredState` 30s polling on `mirroredTasks.size > 0 || mirrorPaused`**
   `frontend/src/models/TaskQueueService.ts:758-794`. Idle tabs do 0 polls instead of 120/hour. **Matches JOURNAL P15 #18 heat-baseline goal.**

### Quick wins (<5-line patches, high leverage)

- `lib/nai-client.js:270/306/330`: `async('base64')` → `async('nodebuffer')` + drop `Buffer.from(base64,'base64')` at server.js call sites — ~40% per-job heap reduction.
- `frontend/src/components/SceneEditor.tsx:139`: append `, [])` to the listener `useEffect`.
- `frontend/src/backends/genVendors/nai.ts:343/403`: drop `Buffer.from(arrayBuffer)` wrapper — `JSZip.loadAsync` accepts `ArrayBuffer` directly.
- `lib/version-check.js`: update `_versionCache.fetchedAt` on fetch failure → negative caching.
- `server.js:1045`: change `await prewarmThumbnails(...)` → `prewarmThumbnails(...).catch(() => {})` — ~300ms/job throughput recovery.
- `server.js:60-65`: add `ws.on('error', ...)` handler in `wss.on('connection')` — closes crash vector.
- `frontend/src/models/ResourceSyncService.ts:61-79`: `flushOnHide` consult `this.dirty` instead of all resources.

---

# Part 1 — Backend Runtime Audit (`server.js` + `lib/`)

## Environment inference
Node.js 20.6+ (uses `process.loadEnvFile`, native `fetch`, `AbortSignal.timeout`). Express 4 fork mode under pm2 (single instance, `exec_mode: 'fork'`), long-running on Oracle ARM Ampere A1 (~24GB usable RAM). Heavy disk I/O, WebSocket broadcast hub, child-process orchestration (rclone/git/pm2). Process expected to run for weeks/months between restarts.

## Issues (sorted by severity, then category)

### Critical ✓ `74f7466` — Unbounded `Buffer.from(base64)` decoding inside NAI client + queue: per-job ~2–8 MB sustained heap pressure
- Location: `lib/nai-client.js:266-270` (`generateImage`), `:302-306` (`augmentImage`), `:329-330` (`encodeVibeImage`); `server.js:1044`, `:1671`, `:1696` (call sites converting base64 → Buffer).
- Category: Memory pressure / Heap overflow risk (Category 1) + Large string/binary (Category 7).
- Issue: Each generated image goes through `res.arrayBuffer()` → `Buffer.from(arrayBuffer)` → `JSZip.loadAsync(buffer)` → `zip.file(...).async('base64')` → returned to caller as a base64 string, then `Buffer.from(base64, 'base64')` → `fs.writeFile`. For a 2 MB PNG that materialises simultaneously: (1) arrayBuffer ~2 MB, (2) Buffer copy ~2 MB, (3) JSZip in-memory ~2 MB + decompressed ~2 MB, (4) base64 string ~2.7 MB, (5) decoded Buffer ~2 MB. Five copies of the image are live until the request returns. With `EXPORT_CONCURRENCY=10` and the queue running, peak resident set can easily reach 100+ MB just for in-flight image conversions on a 24 GB host.
- Technical cause: The base64 round-trip is gratuitous — `zip.file(...).async('nodebuffer')` would skip both the base64 stringification and the subsequent decode. The image is never used as a string downstream (only written to disk).
- Potential runtime impact: Repeated GC pause spikes during sustained queue runs; with multiple parallel `/api/generate` calls competing with the queue, RSS can grow well past 1 GB on a single image batch. Increases OOM probability when combined with `100mb` JSON body limit accepting reference images.
- Estimated frequency: Always (every generation).
- Confidence: High.
- Recommended fix: Return `nodebuffer` from the NAI client and pass `Buffer` directly to `fs.writeFile`. Eliminate the base64 string entirely.
- Patch example:
  ```js
  // before  (lib/nai-client.js:270)
  return await zip.file(entries[0]).async('base64');
  // after
  return await zip.file(entries[0]).async('nodebuffer');

  // before  (server.js:1044)
  await fs.writeFile(outPath, Buffer.from(base64, 'base64'));
  // after
  await fs.writeFile(outPath, base64); // now a Buffer
  ```
- Estimated improvement: Eliminates two of the five live copies (~40% reduction of per-job peak heap during generation), removes O(n) base64 encode + decode CPU per image.

---

### Critical ✓ `59751c5` — `/api/backup/full` and `/api/fs/zip` build the entire archive in memory (potential multi-GB allocations)
- Location: `server.js:2657-2716` (`/api/backup/full`), `server.js:2932-2961` (`/api/fs/zip`), `server.js:821` (`runExportJob` final zip).
- Category: Memory pressure (Category 1) + Large string/binary (Category 7).
- Issue: `/api/fs/zip` and `runExportJob` call `zip.generateAsync({ type: 'nodebuffer' })`, which materialises the whole archive as a single Buffer before `fs.writeFile`. The export pipeline also reads every source file with `await fs.readFile(sourceFile)` into a Buffer and stuffs them all into the JSZip instance before generating — so memory ≈ Σ(file sizes) + final archive Buffer (~2×). For project export jobs that touch hundreds of generated PNGs (~2 MB each), this routinely allocates 500 MB – 2 GB on a 24 GB host. `/api/backup/full` does stream the output (`generateNodeStream`), but still loads every source file into memory (`fs.readFile`) before adding to the zip, so peak heap ≈ total backup size.
- Technical cause: JSZip API design — `zip.file(name, buffer)` keeps the buffer alive in the zip object until `generateAsync` finishes. There is no incremental write path.
- Potential runtime impact: Hard OOM on large exports/backups. Even when it survives, GC pauses can freeze the event loop for hundreds of ms, stalling WS heartbeats and queue tick.
- Estimated frequency: Under Load (every export/backup; with `EXPORT_CONCURRENCY=10` ten concurrent in-memory zips can run).
- Confidence: High.
- Recommended fix: Use a streaming archiver (e.g., `archiver` npm) that writes files incrementally to a `fs.createWriteStream` and never holds the full set in memory. As a minimum fix, lower `EXPORT_CONCURRENCY` default to 2–3 and switch JSZip to `generateNodeStream` + pipe to disk (still buffers all input but at least the output isn't materialised twice). Also stream input files via `zip.file(name, fss.createReadStream(path))` which JSZip accepts via `streamFiles: true`.
- Patch example:
  ```js
  // server.js: runExportJob phase 2 — before
  const content = await fs.readFile(sourceFile);
  zip.file(item.finalName, content);
  ...
  const buf = await zip.generateAsync({ type: 'nodebuffer' });
  await fs.writeFile(outAbs, buf);
  // after (stream both input and output)
  zip.file(item.finalName, fss.createReadStream(sourceFile));
  ...
  await new Promise((resolve, reject) => {
    zip.generateNodeStream({ type: 'nodebuffer', streamFiles: true })
      .pipe(fss.createWriteStream(outAbs))
      .on('finish', resolve).on('error', reject);
  });
  ```
- Estimated improvement: Peak heap during export drops from O(total bytes) to O(per-file buffer); 10× export concurrency becomes safe instead of risky.

---

### Critical ✓ `59751c5` — `wss.clients.forEach(client.send(JSON.stringify(...)))` produces a serialised payload per client and never tracks back-pressure
- Location: `server.js:59-65` (`broadcast`), used at very high frequency from `setExportProgress` (`server.js:688-696`), `prewarmThumbnails`-adjacent paths, and per-job `broadcastQueueStatus()` in the queue loop.
- Category: Memory leaks (Category 2) + Async safety (Category 4) + Resource lifecycle (Category 8).
- Issue: (a) JSON serialised once per call (good), but the same string is sent via `client.send(msg)` to every connected client without checking `client.bufferedAmount`. If a stale tab/phone with a poor link can't drain, ws will buffer payloads in memory until the socket finally errors out — for a connected-but-asleep iPhone (Safari background) this is observed to take several minutes. With queue running ~5 broadcasts per job × hundreds of jobs/hour, the per-client buffer can grow to MBs before disconnect cleanup. (b) No `ws.on('error', ...)` handler is attached, only `'close'` — an error event without a listener throws as 'unhandledError' on the EventEmitter and can crash the process in some ws versions.
- Technical cause: Naive broadcast without back-pressure or error handling. The `wss.on('connection', ws => ...)` handler in `server.js:3143-3146` only attaches `'close'`. Error path is unbound.
- Potential runtime impact: (1) Slow-client memory bloat — per-process resident memory grows several hundred MB during long sessions with one flaky client. (2) Process crash on unhandled `ws` error (Node EventEmitter behavior). (3) Wasted CPU JSON.stringify of identical state for already-disconnected clients in the same tick.
- Estimated frequency: Under Load (queue running + flaky network).
- Confidence: High for the error handler issue; Medium for the bufferedAmount leak (depends on traffic + client count).
- Recommended fix: Add `ws.on('error', ...)`, skip clients whose `bufferedAmount` exceeds a threshold (e.g. 1 MB) and forcibly close them, and consider rate-limiting `broadcastQueueStatus` to e.g. 4 Hz (it currently fires up to 5× per job inside the loop).
- Patch example:
  ```js
  function broadcast(type, data) {
    if (!wss) return;
    const msg = JSON.stringify({ type, data });
    const MAX_BUFFER = 1 * 1024 * 1024;
    wss.clients.forEach(client => {
      if (client.readyState !== WebSocket.OPEN) return;
      if (client.bufferedAmount > MAX_BUFFER) {
        try { client.terminate(); } catch {}
        return;
      }
      client.send(msg, (err) => { if (err) { try { client.terminate(); } catch {} } });
    });
  }
  // and in wss.on('connection'):
  ws.on('error', (err) => console.warn('[ws] client error:', err.message));
  ```
- Estimated improvement: Eliminates one class of slow-client memory leak and a crash vector.

---

### High ✓ `86f16d1` — `setInterval(processDriveRetryQueue, 5000)` never cleared; restart logic relies on whole process exit
- Location: `server.js:3165`, `lib/self-update.js:100-107` (`triggerPm2Restart`).
- Category: Memory leaks (Category 2) + Resource lifecycle (Category 8).
- Issue: A 5-second `setInterval` is started inside `loadDriveRetryQueue().then(...)` and never `clearInterval`'d. `SIGINT`/`SIGTERM` handlers call `process.exit(0)` synchronously so the timer would be GC'd at exit, but `triggerPm2Restart` uses `setTimeout(() => process.exit(0), 1000)` — during that 1-second window the interval can fire a new `processDriveRetryQueue()` tick that races with the pm2 restart.
- Technical cause: Long-lived interval has no shutdown gate. No `unref()` either.
- Potential runtime impact: Possible double-flight of rclone copyto during self-update window (mild); intervals continuing during slow shutdown.
- Estimated frequency: Rare (only during shutdown/restart).
- Confidence: Medium.
- Recommended fix: Capture the handle and clear it in SIGINT/SIGTERM/self-update path.
- Patch example:
  ```js
  const driveRetryTimer = setInterval(processDriveRetryQueue, DRIVE_RETRY_POLL_MS);
  // SIGINT/SIGTERM handlers:
  clearInterval(driveRetryTimer);
  ```

---

### High ✓ `86f16d1` — SIGINT/SIGTERM handlers do not flush `completedJobs`
- Location: `server.js:3174-3187` (signal handlers); `server.js:340-341` (`saveCompletedJobs`).
- Category: Resource lifecycle (Category 8) + Error handling (Category 5).
- Issue: The signal handlers flush `queueState`, `timingHistory`, and `driveRetryQueue`, but not `completedJobs`. A debounced save can have an outstanding `_completedSaver.save()` (5s debounce) at SIGTERM time — those last-completed jobs vanish.
- Potential runtime impact: Up to 5 seconds of completed-job history loss per restart.
- Estimated frequency: Always at restart.
- Confidence: High.
- Recommended fix: Expose a flush method and call it in signal handlers.
- Patch example:
  ```js
  const _completedSaver = makeDebouncedSaver(_writeCompletedJobsSync, 5000);
  function saveCompletedJobs() { _completedSaver.save(); }
  function flushCompletedJobs() { _completedSaver.flush(); }
  // SIGINT/SIGTERM: flushCompletedJobs();
  ```

---

### High ✓ `b26d7a7` — `processQueue` retry loop on 429/5xx can starve the event loop for up to ~100 s
- Location: `server.js:1073-1107` (queue catch + retry).
- Category: Async safety (Category 4) + Infinite growth (Category 9) + CPU hotspot (Category 3).
- Issue: `await new Promise(r => setTimeout(r, 5000))` blocks the entire queue runner for 5 seconds × 10 retries × 2 categories = potentially 100 seconds of queue stall while other jobs cannot progress. New `/api/queue/add` requests keep being accepted (no back-pressure). `pauseRequested` is checked only after the retry sleep returns, so user-pause has up to 5s latency.
- Potential runtime impact: Long stalls under NAI 429 storms; user-perceived "queue stuck" lasting up to ~100 seconds.
- Estimated frequency: Under Load (NAI rate limit events).
- Confidence: High.
- Recommended fix: Move retry to a scheduled re-enqueue with `notBefore` timestamp — let the runner skip jobs not yet ready and process other unrelated jobs in the meantime.
- Patch example:
  ```js
  job._retries = (job._retries || 0) + 1;
  job.notBefore = Date.now() + 5000;
  genQueue.shift();
  genQueue.push(job);
  continue;
  // at top of while-loop:
  if (job.notBefore && job.notBefore > Date.now()) {
    genQueue.push(genQueue.shift());
    await new Promise(r => setTimeout(r, 200));
    continue;
  }
  ```

---

### High ✓ `f129602` — Unbounded `Promise.all(items.map(async ...))` fan-out in `/api/fs/list-stats`, `/api/fs/delete-batch`, `/api/fs/move-batch`
- Location: `server.js:1732-1737`, `:1882-1889`, `:1895-1903`.
- Category: CPU hotspot (Category 3) + Resource lifecycle (Category 8) + Memory pressure (Category 1).
- Issue: `Promise.all(paths.map(async (p) => fs.unlink(...)))` spawns one outstanding syscall per path. For thousands of paths, this exhausts libuv's default thread pool (4 workers) and queues thousands of fs operations.
- Potential runtime impact: Event-loop responsiveness drops; other endpoints appear stalled while the batch runs.
- Estimated frequency: Under Load.
- Confidence: High.
- Recommended fix: Bound concurrency to ~8–16 via a chunk loop (same pattern as `reconcileImageMap`).
- Patch example:
  ```js
  const CHUNK = 16;
  for (let i = 0; i < paths.length; i += CHUNK) {
    const chunk = paths.slice(i, i + CHUNK);
    await Promise.all(chunk.map(async (p) => { try { await fs.unlink(resolvePath(p)); deleted++; } catch {} }));
  }
  ```

---

### High ✓ `7bc397d` — Multiple synchronous `execSync` calls inside HTTP request paths (event loop block)
- Location: `server.js:848-853` (`getDiskFreeGB` — called from `/api/queue/status` on every poll), `server.js:884-889` (`cleanupDirByPattern`), `server.js:921` (`diskCleanupStage4` `find`), `server.js:927-931` (`rclone lsjson` — 100 MB maxBuffer), `server.js:1501-1504` (`/api/queue/completed` `find` with 50 MB maxBuffer + 10s timeout), `server.js:1996-1997` (`checkRcloneAvailable` first call).
- Category: Event loop starvation (Category 6) + CPU hotspot (Category 3) + Async safety (Category 4).
- Issue: `execSync` blocks the entire event loop until the child exits. For `df` ~5 ms; for `find $DATA_DIR -mmin -240` over a populated `outs/` (tens of thousands of files), hundreds of ms to seconds. `/api/queue/status` is polled continuously by the queue UI.
- Potential runtime impact: All concurrent HTTP requests stall during the sync call. WS heartbeats can miss, queue tick stalls.
- Estimated frequency: Always (status polled continuously) for `df`; Under Load for find/lsjson.
- Confidence: High.
- Recommended fix: Convert to `execFile` async + cache `getDiskFreeGB` for 5–10 seconds.
- Patch example:
  ```js
  let _diskFreeCache = { value: 999, fetchedAt: 0 };
  async function getDiskFreeGB() {
    if (Date.now() - _diskFreeCache.fetchedAt < 5000) return _diskFreeCache.value;
    try {
      const { stdout } = await new Promise((resolve, reject) =>
        execFile('df', ['--output=avail', '/home'], (e, so) => e ? reject(e) : resolve({ stdout: so })));
      _diskFreeCache.value = parseInt(stdout.trim().split('\n').pop()) / 1024 / 1024;
    } catch { _diskFreeCache.value = 999; }
    _diskFreeCache.fetchedAt = Date.now();
    return _diskFreeCache.value;
  }
  ```

---

### High ✓ `9b18800` — `JSON.parse`/`JSON.stringify` of unbounded-size queue state in hot path
- Location: `server.js:230` (`_writeTimingHistorySync`), `:337` (completedJobs), `:369` (queue state), `:514` (drive retry queue pretty-printed).
- Category: Event loop starvation (Category 6) + Memory pressure (Category 1).
- Issue: `fss.writeFileSync(file, JSON.stringify(...))` runs entirely on the main thread. For `genQueue` containing 5000 jobs each with vibe/character reference base64 images embedded in `params`, a single save can serialise 50+ MB of JSON synchronously every ~1 s while jobs are being added/processed.
- Potential runtime impact: Each queue state write can freeze the event loop for hundreds of ms with a large queue.
- Estimated frequency: Under Load (large queue with reference images).
- Confidence: High.
- Recommended fix: (a) async write via `fs.writeFile`, or (b) separate persistent metadata from per-job base64 payloads, or (c) drop payloads on persist.
- Patch example:
  ```js
  function _writeQueueStateSync() {
    const state = { queue: genQueue.slice(), stats: queueStats, savedAt: Date.now() };
    fs.writeFile(QUEUE_STATE_FILE, JSON.stringify(state)).catch(e =>
      console.error('[queue] save failed:', e.message));
  }
  ```

---

### High ⊘ Q4 defer — `processExportQueue` with default `EXPORT_CONCURRENCY=10` × in-memory zips can OOM
- **Status (P17, 2026-05-19)**: 본인 명시 spec (server.js:689 주석 "본인 요청: 동시 10개까지 2026-05-13") + C2 streaming archive (`59751c5`) 도입으로 in-memory zip 폭발 위험 완화. 변경 안 함.
- Location: `server.js:678-751`.
- Category: Memory pressure (Category 1) + CPU hotspot (Category 3).
- Issue: 10 parallel export jobs each hold all source PNGs in JSZip buffers, run `sharp` resize, and generate `nodebuffer` archives. `sharp` itself uses libvips + its own thread pool. Combined peak heap can blow RSS sharply.
- Estimated frequency: Rare in normal use; Under Load for bulk exports.
- Confidence: Medium.
- Recommended fix: Reduce default `EXPORT_CONCURRENCY` to 3; combine with streaming archiver (see Critical above). Per-job size budget check.
- Patch example:
  ```js
  const EXPORT_CONCURRENCY = Math.max(1, parseInt(process.env.EXPORT_CONCURRENCY) || 3);
  ```

---

### High ⊘ Q4 defer — `app.use(express.json({ limit: '100mb' }))` + unauthenticated endpoints accept 100 MB bodies
- **Status (P17, 2026-05-19)**: tailnet 단일 사용자 환경 — 외부 노출 0건이라 이론적 위험. 변경 안 함.
- Location: `server.js:1122` + all routes under `/api/fs/write-data`, `/api/generate`, `/api/queue/add`, `/api/queue/add-batch`.
- Category: Security (Category 11) + Memory pressure (Category 1).
- Issue: 100 MB body limit. None of the endpoints except `/api/auth/login*` use rate limiting. A single buggy client can hold 100 MB in memory per concurrent request.
- Estimated frequency: Rare (trusted network), but trivial to trigger accidentally.
- Confidence: Medium.
- Recommended fix: Lower default to 25 MB; per-route limit for legitimately large endpoints; rate-limit `/api/queue/add*`.
- Patch example:
  ```js
  app.use(express.json({ limit: '25mb' }));
  app.post('/api/fs/write-data', express.json({ limit: '50mb' }), async (req, res) => { ... });
  ```

---

### High ⊘ Q4 defer — `nai.token` is process-global; concurrent calls share a single client and racing logins overwrite each other
- **Status (P17, 2026-05-19)**: 단일 사용자 spec — concurrent login 시나리오 미발생. self-update gate도 Phase 15 ADMIN_TOKEN → nai.token pivot로 본인 명시 결정. 변경 안 함.
- Location: `lib/nai-client.js:11-42`, `server.js:55`, `:1033-1036`, `:1213-1218`, `:1297-1316`, `:1630-1634`, `:1685-1688`.
- Category: Async safety (Category 4) + Security (Category 11).
- Issue: Mutable module-global client state with no synchronization. Self-update gate `if (!nai.token)` means anyone who can write `TOKEN.txt` can trigger self-update.
- Estimated frequency: Rare (single-user use case).
- Confidence: Medium.
- Recommended fix: Document single-user assumption; or pass token per-call. Don't gate `/api/self-update` purely on `nai.token` presence.

---

### Medium ✓ `30b2181` — `setImmediate(() => processQueue())` burst storm + unhandled rejection if runner throws synchronously
- Location: `server.js:993-1112` + callers `:1358`, `:1377`, `:1622`, `:3150`.
- Category: Async safety (Category 4).
- Issue: Multiple `setImmediate(() => processQueue())` queued per tick; only one wins the re-entry guard. Outer caller doesn't `.catch`, so a sync throw before the first await crashes the process.
- Recommended fix: Wrap with `.catch`.
- Patch example:
  ```js
  setImmediate(() => { processQueue().catch(e => console.error('[queue] runner crashed:', e)); });
  ```

---

### Medium ✓ `a8980e5` — `reconcileImageMap` outer file loop never yields; boot-time linear scan
- Location: `server.js:403-477`.
- Issue: Boot-time job; can extend to seconds with very large project counts.
- Recommended fix: `await new Promise(r => setImmediate(r))` at top of outer loop.

---

### Medium ✓ `7bc397d` — `/api/queue/completed` sync `find` + `execSync` with 50 MB maxBuffer
- Location: `server.js:1500-1543`.
- Issue: Multi-second event-loop block on installs with many output files.
- Recommended fix: `execFile` async + cache the result for 30–60 seconds.

---

### Medium ✓ `ed1c7d1` — `wss.clients.forEach` broadcast: rate-limit `broadcastQueueStatus`
- Location: `server.js:59-65`.
- Issue: ~5 broadcasts/job × hundreds of jobs/hour × N clients.
- Recommended fix: Debounce to ~250 ms minimum interval.
- Patch example:
  ```js
  let _bcastQTimer = null;
  function broadcastQueueStatus() {
    if (_bcastQTimer) return;
    _bcastQTimer = setTimeout(() => { _bcastQTimer = null; broadcast('queue-status', { /* ... */ }); }, 250);
  }
  ```

---

### Medium ✓ `e97bb6e` — `prewarmThumbnails` runs serially in queue worker, blocks next job ~300 ms
- Location: `server.js:134-147`, called from `:1045` and `:1672`.
- Recommended fix: Fire-and-forget.
- Patch example:
  ```js
  prewarmThumbnails(outPath, job.params.outputFilePath, 'queue').catch(() => {});
  ```

---

### Medium ✓ `ea47e5f` — `timingHistory.shift()` while loop is O(n²) when many entries drop at once
- Location: `server.js:171-173`, `:202-215`.
- Recommended fix: `splice(0, dropCount)` once.
- Patch example:
  ```js
  function pruneTimingHistory() {
    const cutoff = Date.now() - TIMING_RETENTION_MS;
    let i = 0;
    while (i < timingHistory.length && timingHistory[i][0] < cutoff) i++;
    if (i > 0) timingHistory.splice(0, i);
    if (timingHistory.length > TIMING_HISTORY_HARD_CAP) {
      timingHistory.splice(0, timingHistory.length - TIMING_HISTORY_HARD_CAP);
    }
  }
  ```

---

### Medium ✓ `4be7d13` — `lib/version-check.js` no negative cache on failure → GitHub hammered on flaky network
- Location: `lib/version-check.js:21-50`.
- Recommended fix: Update `fetchedAt` even on failure; add single-flight via `_pendingFetch` Promise.

---

### Medium — `searchTagsInDB` linear scan of ~100k tag DB per keystroke
- Location: `lib/tag-search.js:52-66`.
- Recommended fix: Prefix index (Trie or sorted array + binary search).

---

### Medium ✓ `eb6c645` — `walkDir` recursive readdir has no node-count cap
- Location: `server.js:1755-1778`.
- Recommended fix: Cap at e.g. 50000 entries + truncated flag.

---

### Medium — Error responses leak absolute paths via `e.message`
- Location: 50+ `res.status(500).json({ error: e.message })` patterns throughout `server.js`.
- Recommended fix: Log full error server-side, return `{ error: e.code || 'internal' }` to client.

---

### Medium — `runSelfUpdate` uses `execSync` for git/npm/vite — server unresponsive ~45s during self-update
- Location: `lib/self-update.js:24-95`.
- Recommended fix: Use `child_process.spawn` with piped stdio; stream output in real time.

---

### Medium — `processDriveRetryQueue` snapshot consistency under concurrent enqueue
- Location: `server.js:580-672`.
- Recommended fix: Snapshot the queue at tick start.

---

### Medium ✓ `eb6c645` — `app.get('*', ...)` SPA fallback uses sync `fss.existsSync` per request
- Location: `server.js:3100-3108`.
- Recommended fix: Check once at boot, cache the result.

## Low-severity / stylistic findings
- `server.js:62-64` `broadcast` could short-circuit when `wss.clients.size === 0`.
- `server.js:106-122` `makeDebouncedSaver.save()` ignores additional calls during debounce window — by design.
- `server.js:850` `execSync('df ...| tail -1')` uses shell pipeline; `execFile('df', ...)` removes one shell.
- `server.js:1502` `find -mmin -240` recomputed every request without caching.
- `server.js:1659` `JSON.stringify(logParams, null, 2)` always paid when logging.
- `server.js:2655` Hard-coded `db.csv` excluded from backup — file is large but acceptable.
- `server.js:2667-2681` `walkAndAdd` in `/api/backup/full` reads each file fully into memory before adding.
- `lib/nai-client.js:248` `clearTimeout` only on success path; on body-read failure, timeout may briefly leak.
- `lib/nai-client.js:38-42` `login` throws strings inline.
- `lib/nai-client.js:267, :303, :329` All three methods do `Buffer.from(await res.arrayBuffer())` — see Critical above.
- `lib/self-update.js:101-106` `triggerPm2Restart` exits without graceful flush.
- `lib/tag-search.js:9` `tagDB` module-global mutable.
- `reconcile_image_map.js` uses sync I/O throughout — OK as one-shot script.
- `ecosystem.config.js` uses `exec_mode: 'fork'` single-instance — correct.
- `server.js:1196-1197` `/api/config` writes pretty-printed JSON without `atomicWriteFile`.
- `server.js:1791-1797` `/api/fs/read` reads file as utf-8 unconditionally.
- `server.js:1863-1875` `/api/fs/delete`/`delete-dir` accept any path under DATA_DIR.
- `server.js:3120-3142` `verifyClient` v3 ws signature — verify version compat.
- No `app.use((err, req, res, next) => ...)` Express error handler.
- No `process.on('uncaughtException')` or `'unhandledRejection'` handlers.

## Backend section scores (0–10, higher = worse risk)
- Memory leak risk: **6**
- CPU bottleneck risk: **6**
- Long-term stability risk: **6**
- Production failure likelihood: **5**

**Top 3 backend priorities:**
1. Eliminate base64 round-trip in NAI client + write paths (Critical) — largest per-image heap saving.
2. Stream the export/backup zip pipeline + drop default `EXPORT_CONCURRENCY` to 3 (Critical) — removes biggest OOM vector.
3. Convert sync `execSync`/`fss.readFileSync` of large outputs to async + cache `getDiskFreeGB` (High) — restores event-loop responsiveness.

---

# Part 2 — Frontend Models Runtime Audit

## Environment inference
Browser (mobile Safari iOS 18+ and desktop Chrome) running React + MobX stores instantiated once at module load and kept for the lifetime of the tab. Stores hold a lot of long-lived observable state (Session.scenes/inpaints Maps, ImageService LRU + per-path mutex map, TaskQueueService mirrored Maps, taskLogs ring buffer, in-memory image cache strings). Long-lived tabs (hours) and WS-driven event streams make leak surfaces and unbounded growth the dominant risks. Module-level top-level side effects in `index.ts`/`AppService.ts` install `setInterval`s and `document` listeners that are never removed.

## Issues (sorted by severity, then category)

### Critical ✓ `74cd2ef` — `mutexes` map never drains on contention; promise + resolver leaks until each path's last caller
- Location: `frontend/src/models/ImageService.ts:70-84` (`acquireMutex`/`releaseMutex`), used by `fetchImage`, `fetchImageSmall`, `renameImage`, `invalidateCache`, `onRenameFile`
- Category: 2. Memory Leak (also 4. Async Safety)
- Issue: `acquireMutex` does `while (this.mutexes[path]) await this.mutexes[path];` then unconditionally **overwrites** `this.mutexes[path]` with a new Promise. When N callers contend, every `await` resolves on the same promise — they all wake up simultaneously and race to overwrite. Only one wins; the others see the slot, await again on the *new* promise. There is no try/finally discipline in some callers — if any callback inside the critical section throws synchronously before `releaseMutex` runs, `this.mutexes[path]` is leaked forever and every future `fetchImage(path)` hangs indefinitely.
- Technical cause: (a) Single-slot rendezvous, not a queue — overwriting loses FIFO order; (b) `releaseMutex` reads `this.mutexes[path].resolve` after `delete this.mutexes[path]` (TOCTOU pattern); (c) several call sites only release in `finally`, but compound `onRenameFile` walks 7 paths.
- Potential runtime impact: Heavy thumbnail loading (200+ images × 3 sizes) on mobile transiently grows the mutex map; if any backend call throws unexpectedly, the path becomes permanently locked → all future thumbnail fetches for it hang. UI freeze.
- Estimated frequency: Under Load (mobile thumbnail prewarm on a list of 50+ scenes)
- Confidence: High
- Recommended fix: Replace single-slot with proper FIFO promise chain per key; idempotent `releaseMutex`; hard try/finally everywhere.
- Patch example:
  ```ts
  // after — chain pattern: each acquirer gets the previous tail, then becomes the new tail
  private mutexChain: Map<string, Promise<void>> = new Map();
  private async acquireMutex(path: string): Promise<() => void> {
    const prev = this.mutexChain.get(path) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((r) => { release = r; });
    this.mutexChain.set(path, prev.then(() => mine));
    await prev;
    return () => {
      release();
      if (this.mutexChain.get(path) === mine) this.mutexChain.delete(path);
    };
  }
  // callers: const rel = await this.acquireMutex(path); try { ... } finally { rel(); }
  ```

---

### Critical ✓ `dee035a` — `restoreMirroredState` 30s polling never stops + reconnect handler permanently retained
- Location: `frontend/src/models/TaskQueueService.ts:758-794` (constructor)
- Category: 2. Memory Leak; 4. Async Safety; 9. Infinite Growth
- Issue: Constructor (runs once at module load) installs `backend.onQueueJobComplete`/`onQueueJobError` callbacks capturing `this`, `backend.onWsReconnect(() => restoreMirroredState())`, and `startVisibleInterval(() => restoreMirroredState(), 30000)`. None disposed. `startVisibleInterval` return value (stop fn) discarded. The 30s HTTP round-trip continues forever including during long idle, walking `mirroredTasks.entries()` and rebuilding stats. Single-flight gate dedups concurrent calls, not periodic firing.
- Potential runtime impact: Continuous network chatter, periodic JS work to rebuild stats Maps, CPU/battery drain on mobile across 5+ hour tab sessions. Combined with `groupStats[cls].total/done` arithmetic mutating observables, every poll triggers MobX reactions → React re-renders even when queue is empty.
- Estimated frequency: Always (every 30 s when foreground)
- Confidence: High
- Recommended fix: Only poll when there is state to mirror.
- Patch example:
  ```ts
  startVisibleInterval(() => {
    if (this.mirroredTasks.size === 0 && !this.mirrorPaused) return;
    this.restoreMirroredState().catch(...);
  }, 30000);
  ```
- Estimated improvement: Idle tab does 0 polls instead of 120/hour. Reduces mobile thermal load — matches 2026-05-17 baseline JOURNAL goal.

---

### Critical ✓ `738829c` — `addBatchChain` promise chain retains every batch's closure (and base64 payloads) until drained
- Location: `frontend/src/models/TaskQueueService.ts:749, 978-1031`
- Category: 2. Memory Leak
- Issue: Each new `addMirroredTask` references the prior `addBatchChain` in its closure. While the promise eventually resolves, the chain itself isn't broken — every queued batch's `items: Array<{params, meta}>` (containing base64 vibes/references in `arg`) is captured by the closure until `releaseMySlot` runs. Under backlog of 100 queued batches, 100 batches' worth of base64 image strings retained in memory simultaneously.
- Potential runtime impact: Heavy batch queue (50 scenes × 4 samples, 0.5–2 MB base64 vibe per item) → peak retained memory hundreds of MB. Mobile Safari OOM risk.
- Estimated frequency: Under Load (large queue with vibe/reference)
- Confidence: High
- Recommended fix: Null out captured `items`/`localOutputs` after `releaseMySlot`.
- Patch example:
  ```ts
  try {
    await prevSlot;
    const result = await backend.queueAddBatch(items);
    for (let i = 0; i < result.jobIds.length; i++) {
      this.mirroredJobs.set(result.jobIds[i], { taskId, outputFilePath: localOutputs[i] });
    }
  } finally {
    items.length = 0;
    localOutputs.length = 0;
    releaseMySlot();
  }
  ```

---

### High ✓ `8f4038a` — `imageService.images` / `inpaints` keyed by `session.name` never GC'd across project deletes/renames
- Location: `frontend/src/models/ImageService.ts:53-67, 312-363, 460-473`
- Category: 9. Infinite Growth; 2. Memory Leak
- Issue: No removal path when session deleted; `onRenameSession` only rewrites `cache` keys, not `images`/`inpaints`. Long-lived editors accumulate hundreds of stale keys.
- Recommended fix: Add `onSessionDeleted(name)` / `onSessionRenamed(oldName, newName)`.
- Patch example:
  ```ts
  onSessionDeleted(sessionName: string) {
    delete this.images[sessionName];
    delete this.inpaints[sessionName];
    for (const key of Array.from(this.encodedVibeExistsCache.cache.keys())) {
      if (key.includes('/' + sessionName + '/')) this.encodedVibeExistsCache.delete(key);
    }
  }
  ```

---

### High ⊘ Q2 defer — Four parallel mirror-state Maps desync on WS reconnect / 30s polling overlap
- **Status (P17, 2026-05-19)**: VERIFIED real bug — `_doRestoreMirroredState`가 `await backend.queueGetFullState()` 중 WS event 끼어들면 mutation 손실. 단 4 Map collapse refactor = caller 7곳 동시 변경 (handleMirroredComplete/handleMirroredError/addMirroredTask/restoreMirroredState/prioritizeTasks/removeAllTasks/removeTasksFromScene) + lockstep 1곳 누락 시 silent regression. Q2 (Cross-cutting/Refactor) 단독 commit + L3 통과 후 별도 phase에서 진행.
- Location: `frontend/src/models/TaskQueueService.ts:738-756, 1034-1117, 1119-1218`
- Category: 9. Infinite Growth; 4. Async Safety
- Issue: `mirroredTasks` / `mirroredJobs` / `mirrorRunStartTimes` / `mirrorTaskSceneKeys` need lockstep updates under three concurrent code paths (WS event, addMirroredTask, restore). Single-flight gate only blocks concurrent restores, not WS complete events overlapping with `_doRestoreMirroredState`'s `mirroredTasks.clear()`. Lost progress increments, stuck UI counters. `mirrorRunStartTimes` not repopulated on restore → skewed ETAs after reconnect.
- Recommended fix: Collapse into one `Map<taskId, {task, jobIds: Set<string>, sceneKey, startTs}>` + secondary `jobToTask` index.

---

### High ⊘ Q4 defer (premise stale) — `withTimeout` races but never aborts underlying `handleTask` work
- **Status (P17, 2026-05-19)**: SDStudio Remote는 Phase 9에서 서버 큐 도입 후 `generateImage = POST /queue/add` cheap ACK라 client-side 백그라운드 fetch에 multi-MB vibe stack 가정 stale. 또 runInternal은 serial while loop라 단일 in-flight. 실제 위험 ≈ 0. 변경 surface (TaskHandler interface + 3 구현체 + backend signature + fetch signal plumb) 큼 → defer. 본 case로 audit instructions Section 0 Architecture Pass 도입 결정 (`278bd61`).
- Location: `frontend/src/models/TaskQueueService.ts:1386-1394, 1419`
- Category: 4. Async Safety; 2. Memory Leak
- Issue: `Promise.race` chooses first resolution, never cancels the loser. Stale `generateImage` flights stack — each holding multi-MB base64 vibes. Mobile Safari foreground tab budget is ~1.5GB.
- Recommended fix: Plumb `AbortSignal` through backend `generateImage`.
- Patch example:
  ```ts
  private withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<T> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(new Error('Timeout')), timeoutMs);
    return fn(ac.signal).finally(() => clearTimeout(timer));
  }
  await this.withTimeout((signal) => handler.handleTask(task, cur, signal), timeoutMs);
  ```

---

### High ✓ `c779f6e` — `taskLogs` ring buffer uses O(N) `splice` instead of O(1) rotation
- Location: `frontend/src/models/TaskQueueService.ts:796-805`
- Category: 3. CPU Hotspot; 9. Infinite Growth
- Issue: `splice(0, k)` is O(N). Over a long batch (1000s of tasks), O(N²) total CPU. Error storms (429 retry × 100 tasks) → ms-scale main-thread blocking + GC pressure.
- Recommended fix: True ring buffer with cursor.
- Patch example:
  ```ts
  private logCursor = 0;
  private logBuffer: (TaskLog | undefined)[] = new Array(MAX_TASK_LOGS);
  addLog(level, scene, message) {
    this.logBuffer[this.logCursor] = { timestamp: Date.now(), level, scene, message };
    this.logCursor = (this.logCursor + 1) % MAX_TASK_LOGS;
  }
  ```

---

### High ⊘ Q4 partially-mitigated — `embedJSONInPNG` / `readJSONFromPNG` synchronously decode + re-encode full PNG base64 on main thread
- **Status (P17, 2026-05-19)**: 다중파일 batch freeze는 H16 (`816fed8` handleFiles 4-chunk + yield)로 부분 흡수. 단일파일 50-150ms mobile hitch는 Web Worker 필요 → defer.
- Location: `frontend/src/models/SessionService.ts:855-888`
- Category: 6. Event Loop Starvation; 7. Large String/Binary
- Issue: `Buffer.from(inputBase64, 'base64')` + `extractChunks` + `Buffer.from(encodeChunks(chunks)).toString('base64')`. For NAI 1024×1024 PNG, 5–15 ms desktop, 50–150 ms mobile Safari. Multi-file drop = ~1 s freeze.
- Recommended fix: Yield between files (or move to Web Worker).

---

### High ✓ `34823bd` — `pasteImagesFromClipboard` no rate limit; deletes-then-refreshes O(N) every image
- Location: `frontend/src/models/AppService.ts:507-525`
- Issue: Serial loop, no per-copy timeout, single `refresh()` at end re-lists 500+ entries.

---

### High ✓ `816fed8` — `handleFiles` parses N JSONs concurrently via `Promise.all`, each blocks main thread
- Location: `frontend/src/models/AppService.ts:754-811`
- Issue: 20 concurrent `JSON.parse` of 50–500 KB project.json → ~50–500 ms freeze on bulk import.
- Recommended fix: Chunk-parallelize CHUNK=4, yield between chunks.

---

### Medium — `appState.messages` / `progressDialogs` allocate new array on every update
- Location: `frontend/src/models/AppService.ts:480-626`
- Issue: `this.progressDialogs = this.progressDialogs.map(...)` per per-second updates. GC pressure + MobX reactions.
- Recommended fix: Indexed mutation inside MobX action.

---

### Medium — `runInternal` 429 retry sleeps 60s, ignores user pause/stop during the sleep
- Location: `frontend/src/models/TaskQueueService.ts:1452-1460`
- Recommended fix: Abortable sleep with `cur` state check.

---

### Medium — `dispatchProgress()` fires on every micro-event including idle 30s polls
- Location: `TaskQueueService.ts:1364-1366` and ~10 call sites
- Recommended fix: Diff stats before dispatching, or emit state snapshot.

---

### Medium — `gatherExportItems` builds single 60k-entry items array; 9 MB HTTP body
- Location: `frontend/src/models/AppService.ts:1694-1761`
- Recommended fix: Move path-walking to server (post project names; server walks fs).

---

### Medium — `imageService.fetchImage` LRU stores raw base64 strings (MBs each, UTF-16 doubled)
- Location: `frontend/src/models/ImageService.ts:65, 221-240`
- Issue: Desktop 256 × 1.3 MB ≈ 333 MB; mobile 64 × 1.3 MB ≈ 83 MB. JS strings are UTF-16 → 2× → 666 MB / 166 MB. Pushes mobile Safari into tab-budget territory.
- Recommended fix: Cache `URL.createObjectURL(Blob)` strings; revoke on LRU eviction.
- Patch example:
  ```ts
  set(key: string, blob: Blob) {
    if (this.cache.has(key)) URL.revokeObjectURL(this.cache.get(key)!.url);
    this.cache.set(key, { url: URL.createObjectURL(blob), blob });
    if (this.cache.size > this.limit) {
      const first = this.cache.keys().next().value;
      URL.revokeObjectURL(this.cache.get(first!)!.url);
      this.cache.delete(first!);
    }
  }
  ```
- Estimated improvement: ~3–5× memory reduction; faster GC.

---

### Medium — `cropMirrorResultFromDataUri` synchronous canvas `toDataURL` per image
- Location: `frontend/src/models/ImageService.ts:774-796`
- Issue: 50–200 ms each on mobile. Bulk mirror export with CHUNK=4 → seconds of UI block.
- Recommended fix: `canvas.convertToBlob()` (async) or OffscreenCanvas in Worker.

---

### Medium — `ResourceSyncService.update` wipes all dirty flags after partial failures
- Location: `frontend/src/models/ResourceSyncService.ts:209-221`
- Issue: `this.dirty = {}` at end loses dirty bits for failed writes; edge-case data loss.
- Recommended fix: Clear dirty entry only on successful write.

---

### Medium — `flushOnHide` writes every resource on every visibility hidden — even non-dirty
- Location: `frontend/src/models/ResourceSyncService.ts:61-79`
- Issue: 30+ sessions × 50–500 KB each × multiple visibility flips per hour = bandwidth/CPU drain.
- Recommended fix: Iterate `this.dirty` not `this.resources`.

---

### Medium — `visibilitychange` + `pagehide` listeners in 3 services never removed
- Location: `GlobalPresetService.ts:47-61`, `GlobalPieceService.ts:14-28`, `ResourceSyncService.ts:61-79`
- Issue: Acceptable for singletons but `KeyboardShortcutService` properly provides install/uninstall.
- Recommended fix: Provide `dispose()` methods for testability.

---

### Medium — `appState.exportPipelineJobs` 30-min `setTimeout` never cancelled on success
- Location: `frontend/src/models/AppService.ts:1803-1866`
- Recommended fix: Track timer ID, `clearTimeout` in `tryFullCleanup`.

---

### Medium — `syncExportToDrive` 15-min setTimeout never cleared
- Location: `frontend/src/models/AppService.ts:111-136`

---

### Medium — `CyclingSessionService.disposers` array can leak on re-start
- Location: `frontend/src/models/CyclingSessionService.ts:29, 69-77, 202-213`

---

### Medium — `Tags.calcGapMatch` DP allocates O(M×N×2) 2D tuple array per call
- Location: `frontend/src/models/Tags.ts:151-209`
- Issue: ~25 KB per call × 50 candidates per keystroke ≈ 1.25 MB/keystroke allocation churn.
- Recommended fix: Typed arrays (`Int32Array(m*n*2)`) with flat indexing.

## Low-severity findings
- `AppService.ts:484, 495` `pushMessage` uses uuid v4 but only needs strings; `Math.random().toString(36)` cheaper.
- `AppService.ts:2728-2735` `slotKey` JSON.stringify per slot during merge dedup.
- `PromptService.ts:117-138` no max-iteration guard on `pieceRegex.exec`.
- `PromptService.ts:566-608` `highlightPrompt` `Int8Array(text.length)` per call.
- `PromptService.ts:268-305` `dfsPrompts` recursion depth = `scene.slots.length`; malicious JSON could explode combinations.
- `types.ts:556-601` `Session.fromJSON` builds many Maps without streaming.
- `SessionService.ts:798-845` `importDefaultPresets` races 3 fetches without per-fetch timeout.
- `GameService.ts:36-48` `onImageUpdated` rebuilds output list per session of single image update.
- `util.ts:144-164` `decompressGzip` accumulates Uint8Array chunks without cap (gzip bomb).
- `util.ts:175-241` `extractMetadataFromAlpha` `ctx.getImageData(0, 0, w, h)` no size check; 4096² = 64 MB pixel buffer.
- `TaskQueueService.ts:746-749` `addBatchChain` tail never reset to `Promise.resolve()` after quiescent.
- `ResourceSyncService.ts:241-246` `while (this.running)` loop — `this.running` never set false; no graceful shutdown.
- `ImageService.ts:629-666` `onAddImage`/`onAddInPaint` concat O(N²) on batch adds.
- `AppService.ts:3402` `appState` module-level singleton; HMR may accumulate duplicates.
- `AppService.ts:3413-3415` `refreshDriveRetryStatus().then(...)` no `.catch`.
- `AppService.ts:3428-3451` `queueMicrotask` WS handler registration safe but no unregister path.
- `CyclingSessionService.ts:69-77` MobX reaction not wrapped in `runInAction`.
- `TaskQueueService.ts:1303-1308` `calculateCost` iterator allocates per iteration.
- `TaskQueueService.ts:1396-1490` `runInternal` outer loop bounded only by queue emptiness; 40 retries × 60s sleep = 40 min hang.

## Models section scores (0–10, higher = worse risk)
- Memory leak risk: **7**
- CPU bottleneck risk: **5**
- Long-term stability risk (long-lived tab): **7**
- Production failure likelihood: **5**

**Top 3 model-layer priorities:**
1. Fix `ImageService.acquireMutex` — FIFO chain + idempotent release with try/finally. Eliminates permanent-hang failure mode.
2. Make `TaskQueueService.restoreMirroredState` 30s polling conditional + drop captured `items[]`/`localOutputs[]` after `releaseMySlot`. Matches JOURNAL P15 thermal baseline goal.
3. Plumb cache eviction across project lifecycle (`onSessionDeleted`/`onSessionRenamed`) + switch LRU from base64 strings to Blob URL handles.

---

# Part 3 — Frontend Workflows + Backends Runtime Audit

## Environment inference
Browser (Vite + React + MobX). Long-lived tab — single ServerBackend singleton holding a WebSocket + event-handler Map. Heavy base64 image payloads flow through workflow handlers (SD i2i / inpaint / augment / mirror) into a HTTP queue; the NAI vendor module also runs in-browser (libsodium-wrappers-sumo, jszip, Buffer polyfill). Canvases (`<canvas>` + `toDataURL`) are constructed for the mirror workflow.

## Issues (sorted by severity, then category)

### Critical ✓ `8cf4163` — Mirror canvas not released; `toDataURL('image/png')` runs twice synchronously on main thread
- Location: `frontend/src/models/workflows/SDWorkFlow.ts:617-703` (`prepareMirrorCanvas`)
- Category: 6 Event Loop Starvation / 7 Large String / 2 Memory Leak
- Issue: Creates two `HTMLCanvasElement`s, calls `cvs.toDataURL('image/png')` and `maskCvs.toDataURL('image/png')` synchronously. At NAI free pixel limit, each is a multi-hundred-millisecond main-thread block. Canvases and `Image`/temp canvas remain reachable until function return; two base64 strings (1–3 MB each) returned and held by caller.
- Potential runtime impact: UI freeze 100–600 ms per mirror generation on mobile. Peak heap spike ~5–10 MB strings simultaneously.
- Estimated frequency: Always (every mirror invocation)
- Confidence: High
- Recommended fix: (a) `canvas.toBlob` (async, off main task) → `ArrayBuffer` → chunked btoa; (b) explicit canvas teardown `cvs.width = cvs.height = 0`; (c) skip mask data-URL when not needed.
- Patch example:
  ```ts
  const toB64 = (c: HTMLCanvasElement) =>
    new Promise<string>((resolve, reject) => {
      c.toBlob(async (blob) => {
        if (!blob) return reject(new Error('toBlob failed'));
        const buf = await blob.arrayBuffer();
        let s = '';
        const u8 = new Uint8Array(buf);
        for (let i = 0; i < u8.length; i += 0x8000) {
          s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000) as any);
        }
        resolve(btoa(s));
      }, 'image/png');
    });
  const canvasBase64 = await toB64(cvs);
  const maskBase64 = await toB64(maskCvs);
  cvs.width = cvs.height = 0;
  maskCvs.width = maskCvs.height = 0;
  return { canvas: canvasBase64, mask: maskBase64, width: canvasWidth, height: canvasHeight, cropX: inpaintStart, downscaled };
  ```
- Estimated improvement: Removes 100–600 ms main-thread block per mirror op; drops peak heap by 2–4 MB; eliminates rare tap-hang signature on iOS Safari.

---

### Critical ✓ `8cf4163` — `prepareMirrorCanvas` `img.onerror` has no timeout, no real Error
- Location: `frontend/src/models/workflows/SDWorkFlow.ts:617-622`
- Category: 4 Async Safety / 5 Error Handling
- Issue: `img.onload = () => resolve(); img.onerror = reject;` — malformed base64 hangs the Promise forever, freezing the mirror handler and dangling the awaiting MobX queue commit.
- Recommended fix: Wrap with timeout + convert error to real Error.
- Patch example:
  ```ts
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('image decode timeout')), 15_000);
    img.onload = () => { clearTimeout(t); resolve(); };
    img.onerror = () => { clearTimeout(t); reject(new Error('image decode failed')); };
    img.src = 'data:image/png;base64,' + sourceBase64;
  });
  ```

---

### High ✓ `735e3bd` — `ServerBackend` WebSocket reconnect: no backoff, no online-event reset, handler Map only grows
- Location: `frontend/src/backends/serverBackend.ts:74-112`
- Category: 2 Memory Leak / 4 Async Safety / 9 Infinite Growth
- Issue: Fixed 3-second retry; no max attempts; no jitter; no online/offline listener. Stale `onerror` closure can call `this.ws?.close()` on the *new* ws because closures reference `this.ws` not local var. `eventHandlers` Set only deleted via opt-in disposer.
- Recommended fix: Exponential backoff + jitter + cap; local `ws` var for closures.
- Patch example:
  ```ts
  private reconnectAttempt = 0;
  private connectWebSocket() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${location.host}${API_BASE}/ws`;
    const ws = new WebSocket(wsUrl);
    this.ws = ws;
    ws.onopen = () => { this.reconnectAttempt = 0; /* ... */ };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      const delay = Math.min(30_000, 500 * 2 ** this.reconnectAttempt++) + Math.random() * 500;
      setTimeout(() => this.connectWebSocket(), delay);
    };
    ws.onerror = () => { if (this.ws === ws) ws.close(); };
  }
  ```

---

### High ✓ `61fb8c9` — `apiJSON` callers don't propagate per-endpoint timeout; large reads + queue submits silently capped at 60s
- Location: `frontend/src/backends/serverBackend.ts:27-72`, `:279`, `:308`, `:352-354`
- Category: 4 Async Safety / 5 Error Handling / 7 Large Binary
- Issue: Single `DEFAULT_API_TIMEOUT_MS = 60_000` for all endpoints. Multi-MB image reads and queue base64 submits can spuriously abort on slow mobile uplinks.
- Recommended fix: Per-endpoint timeout — 15s for small JSON GET, 180s for binary read/write/queue submit.
- Patch example:
  ```ts
  await api('/queue/add', { method: 'POST', body: JSON.stringify(arg), timeout: 180_000 });
  ```

---

### High — `JSZip.loadAsync(Buffer.from(arrayBuffer))` doubles memory in browser NAI vendor
- **Status (P17 verification, 2026-05-19)**: ☠ DEAD CODE — `NovelAiImageGenService` 클래스 frontend caller 0건 (`grep -rn NovelAiImageGenService frontend/src` 단일 결과 = 정의 줄). SDStudio Phase 9에서 서버 측 NAI client (`lib/nai-client.js`)로 이전 후 잔존물. Vite tree-shaking으로 빌드 결과물에도 안 들어감. 서버 측 `lib/nai-client.js:267,306`은 이미 `JSZip.loadAsync(buffer)`로 doubling 없음. **Fix 적용해도 production 효과 0** → 본인 결정 (2026-05-19): "일괄 dead-code cleanup 시 같이 폴더 삭제". 본 audit batch에서는 손 안 댐.
- Location: `frontend/src/backends/genVendors/nai.ts:343-350`, `:403-410`
- Category: 1 Memory Pressure / 7 Large Binary
- Issue: arrayBuffer (1.4 MB) + Buffer copy (1.4 MB) + JSZip internal (1.4 MB) + base64 (1.9 MB) ≈ 6 MB simultaneous per 1024² PNG.
- Recommended fix: Pass `arrayBuffer` directly — JSZip accepts it.
- Patch example:
  ```ts
  // before
  const zip = await JSZip.loadAsync(Buffer.from(arrayBuffer));
  // after
  const zip = await JSZip.loadAsync(arrayBuffer);
  ```
- Estimated improvement: ~30% peak heap reduction per NAI generation.

---

### High ✓ `9f6d68f` — `copyImageToClipboard` / image fetch paths missing `AbortController`
- Location: `frontend/src/backends/serverBackend.ts:374-380`, `:11-22`
- Category: 2 Memory Leak / 10 Browser-Specific
- Issue: No signal, no timeout — hung fetch holds blob (1–5 MB) for whole network timeout.
- Recommended fix: Add `AbortController` + 30s defensive timeout.

---

### High ✓ `46dafaa` — `SDImageGenHandler` synchronously decodes `preset.image`/`preset.mask` data URI base64 on main thread
- Location: `frontend/src/models/workflows/SDWorkFlow.ts:403-440`
- Category: 6 Event Loop / 7 Large Binary
- Issue: `dataUriToBase64` `.split`/`.replace` on multi-MB strings — 30–150 ms hitches per i2i/inpaint task on mobile. Pattern repeats in `AugmentWorkFlow.ts:132-136, :255-263`.
- Recommended fix: Expose `fetchVibeImageBase64` API skipping data-URI wrap.

---

### Medium — `NovelAiImageGenService.login` runs Argon2id KDF on main thread (200ms–3s freeze)
- Location: `frontend/src/backends/genVendors/nai.ts:90-119`
- Recommended fix: Web Worker (libsodium has worker build), or server-side auth (already exists).

---

### Medium — `on*` consumer cleanup is opt-in; static audit can't verify every disposer is called
- Location: `frontend/src/backends/serverBackend.ts:108-112`, `:401-437`
- Recommended fix: Audit every `on*` consumer; consider `WeakRef` + `FinalizationRegistry` for ad-hoc observers.

---

### Medium — `WorkFlowService` builds fresh MobX observables per call; UI consumers may leak reactions
- Location: `frontend/src/models/workflows/WorkFlowService.ts:21-33, :68-82`, `WorkFlow.ts:282`
- Recommended fix: Audit `observer()` cleanup; cache preset instances by key.

---

### Medium — `NovelAiImageGenService.getConfig` 30s TTL cache never invalidated on auth/config change
- Location: `frontend/src/backends/genVendors/nai.ts:23-47`
- Issue: Stale `modelVersion`/`disableQuality` for up to 30s after setting change.
- Recommended fix: Invalidate from `setConfig` event.

---

### Medium — `api()` no retry; transient 502 during pm2 restart surfaces as user-visible failure
- Location: `frontend/src/backends/serverBackend.ts:29-68`
- Recommended fix: `retry: { attempts, backoffMs }` option; default 0 for writes, 2 for idempotent GETs.

---

### Medium — `queueRemoveBg` posts `width: 0, height: 0` — silent failure if server validates
- Location: `frontend/src/models/workflows/OneTimeFlows.ts:33-52`

---

### Medium — `writeFileKeepalive` silently drops failures past 64 KB browser keepalive cap
- Location: `frontend/src/backends/serverBackend.ts:285-302`
- Issue: `keepalive: true` has 64 KB total per page lifecycle. Last-second state save can be lost on tab unload.
- Recommended fix: Track cumulative bytes, fallback to `navigator.sendBeacon`.

---

### Medium — `taskQueueService.addTask` fire-and-forget in workflow handlers; rejections silently swallowed
- Location: `SDWorkFlow.ts:270, :448`, `AugmentWorkFlow.ts:153, :280`, `OneTimeFlows.ts:51, :86`
- Issue: Quietly dropped queue submissions when queue cap reached. Matches P15 "queue 905개 손실" incident class.
- Recommended fix: Always `await addTask` + try/catch with explicit error toast.

---

### Medium — `generateImage` `reference_strength_multiple` divides by zero → NaN ships as null
- Location: `frontend/src/backends/genVendors/nai.ts:204-213`
- Recommended fix: Skip normalization when sum is 0.

## Low-severity findings
- `serverBackend.ts:104` reconnect `setTimeout` handle never tracked.
- `serverBackend.ts:97-102` `JSON.parse(event.data)` empty `catch {}` swallows malformed frames silently.
- `serverBackend.ts:241-245` `copyToDownloads` uses `a.click()` without DOM attach; Safari quirks.
- `SDWorkFlow.ts:202-209` `toPARR(cp.prompt).map(parseWord)` recomputed per handler.
- `SDWorkFlow.ts:705` `SDMirrorPreset = SDInpaintPreset.clone()` — cosmetic note.
- `nai.ts:80-84` `Math.random()` for seeds — non-cryptographic, intended.
- `nai.ts:115, :362-368` typo "reponse"; naked `await reponse.json()` may throw confusing parse error.
- `OneTimeFlows.ts:121, :168` `parseInt` without radix.
- `WorkFlow.ts:293-322` `fromJSON`/`toJSON` mutate observables outside `action()`.
- `WorkFlowService.ts:38` `console.warn` on unknown workflow + `null` returned; downstream may not null-check.
- `WorkFlowService.ts:85-95` `find` + `!` non-null assertion.
- `AugmentWorkFlow.ts:132-136` same dataUriToBase64 double-allocation as i2i path.
- `config.ts` — pure types, no runtime risk.

## Workflows+Backends section scores (0–10, higher = worse risk)
- Memory leak risk: **5**
- CPU bottleneck risk: **6**
- Long-term stability risk: **6**
- Production failure likelihood: **5**

**Top 3 priorities for this layer:**
1. Fix `prepareMirrorCanvas` — async `toBlob` + explicit canvas teardown + image-load timeout (resolves two Critical issues at once).
2. Add exponential backoff + stale-ws guard to `ServerBackend.connectWebSocket`; audit `on*` consumer cleanup.
3. Drop `Buffer.from` wrapper in `nai.ts` JSZip path + per-endpoint timeouts in `api()` for binary/queue routes.

---

# Part 4 — Frontend Components Runtime Audit

## Environment inference
React 18 + Vite 5 + MobX (observer HOC) + react-dnd + react-contexify, built for browser. Target: mobile Safari iOS 18+ and desktop Chrome; long-lived tabs (hours) with heavy image galleries and DnD. Code consistently uses MobX `observer`, custom service `EventTarget`-style emitters, and many `useEffect` cleanups — overall structure is good, but several concrete leaks and CPU hot spots remain.

## Issues (sorted by severity, then category)

### Critical ✓ `ecb4660` — Missing dependency array on `useEffect` causes infinite subscribe/unsubscribe churn each render
- Location: `frontend/src/components/SceneEditor.tsx:127-139` (`BigPromptEditor`)
- Category: 10 (Environment-Specific) + 3 (CPU Hotspot)
- Issue: `useEffect` registers `start`/`stop`/`progress` listeners on `taskQueueService` but is missing its dep array — block ends with `});` instead of `}, []);`. The effect calls `rerender({})` on `progress`, which re-runs cleanup + re-runs subscription. Combined with `progress` event firing once per task tick during generation, this creates a self-reinforcing addEventListener/removeEventListener storm.
- Potential runtime impact: While generation runs with Scene/Inpaint editor open, every progress tick performs 3× remove + 3× add. Continuous GC pressure + observer batching stress. iOS Safari particularly slow on listener registration.
- Estimated frequency: Always (Scene/Inpaint editor + queue active = normal use case)
- Confidence: High
- Recommended fix: Add `[]` dep array.
- Patch example:
  ```tsx
  // before
      useEffect(() => {
        const handleProgress = () => { rerender({}); };
        taskQueueService.addEventListener('start', handleProgress);
        taskQueueService.addEventListener('stop', handleProgress);
        taskQueueService.addEventListener('progress', handleProgress);
        return () => {
          taskQueueService.removeEventListener('start', handleProgress);
          taskQueueService.removeEventListener('stop', handleProgress);
          taskQueueService.removeEventListener('progress', handleProgress);
        };
      });   // ← missing dep array

  // after — add , [])
      }, []);
  ```
- Estimated improvement: Single subscription for editor lifetime. Noticeable iOS jank/heat relief during long generation runs.

---

### High ✓ `735a8e2` — `SceneCell` per-card listener subscription multiplies by scene count (N × 5 listeners)
- Location: `frontend/src/components/SceneQueueControl.tsx:248-291`
- Category: 2 (Memory Leak) + 3 (CPU)
- Issue: Every visible `SceneCell` subscribes to `gameService:updated`, `taskQueueService:progress`, `imageService:image-cache-invalidated`, plus two MobX reactions. For 50–500 scenes, 5N listeners. Every `progress` event during generation → all `SceneCell`s rerender + refetch thumbnails (no path filter).
- Potential runtime impact: 200 scenes × 1 progress/sec = 200 React rerenders/sec + 200 needless thumbnail refetches. **Primary mobile-jank/heat contributor during batch runs** (matches "발열 baseline" memory).
- Estimated frequency: Always (during any active generation with scene grid visible)
- Confidence: High
- Recommended fix: Filter event payloads by sceneKey/path; or hoist to parent + observable global keyed by sceneKey.
- Patch example:
  ```tsx
  useEffect(() => {
    const sceneKey = getSceneKey(curSession, scene);
    const onProgress = (e: any) => {
      if (e?.detail?.sceneKey && e.detail.sceneKey !== sceneKey) return;
      rerender({});
    };
    const onCacheInvalidated = (e: any) => {
      const p = e?.detail?.path;
      if (p && !isPathForScene(scene, p)) return;
      refreshImage();
    };
    taskQueueService.addEventListener('progress', onProgress);
    imageService.addEventListener('image-cache-invalidated', onCacheInvalidated);
    // ...
  }, [scene, getImage]);
  ```
- Estimated improvement: ~95% reduction in rerenders during steady-state generation.

---

### High ✓ `f385274` — `VibeImage` re-runs `fetchImageSmall` without cancellation guard during rapid path changes
- Location: `frontend/src/components/CharacterPresetEditor.tsx:54-70`
- Category: 2 (Memory Leak) + 4 (Async Safety)
- Issue: No `cancelled` flag — stale fetch resolves after new one and overwrites. Closure-retained base64 strings until GC.
- Recommended fix: Add `let cancelled = false` pattern (matches `BatchItemSelector.tsx:64-80`).

---

### High ✓ `3a2058a` + `6583b04` — `TaskQueueList.syncFromService` rebuilds 3 Maps per event; O(commits) per progress tick
- Location: `frontend/src/components/TaskQueueControl.tsx:310-471`
- Category: 3 (CPU Hotspot) + 6 (Event Loop)
- Issue: On every `start`/`stop`/`progress`/`complete`/`error`: iterate queue + mirroredTasks, clear+rebuild 3 Maps, iterate commits again for totals, iterate scenes/projects/folders. With 500+ commits + ~1 Hz progress events → 2500 iterations + Map allocations per event. iOS Safari: 5–20 ms per event.
- Recommended fix: Coalesce via `requestAnimationFrame`.
- Patch example:
  ```tsx
  const rafRef = useRef<number | null>(null);
  const onChange = () => {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      syncFromService();
    });
  };
  ```
- Estimated improvement: Up to 60× rebuild reduction when many events fire within one frame.

---

### High ⊘ Q4 defer (severity overstated) — `useTournament` `useMemo([tick, scene, toURL])` re-derives podium sort per match click
- **Status (P17, 2026-05-19)**: audit "10ms per click on iOS Safari" 추정 과대 — 500 items simple comparator sort는 mobile에서 1-2ms 수준 예상. game-version 감지 인프라 필요 (현재 `tick` 통째 invalidation 패턴). measurement-first 권장 → defer.
- Location: `frontend/src/components/tournament/useTournament.ts:190-237`
- Category: 3 (CPU) + 4 (Async)
- Issue: `[...game].sort(...)` runs even when only `round.curPlayer` changed. 500-image tournament: ~10ms per click on iOS Safari.
- Recommended fix: Split into separate useMemos with distinct invalidation triggers.

---

### Medium — `TournamentArena` prefetch effect's `img.src=''` doesn't reliably release on iOS Safari
- Location: `frontend/src/components/tournament/TournamentArena.tsx:49-59`
- Issue: Closure-held `imgs[]` accumulates during fast clicking through large tournament. Tens of MB decoded data on iOS Safari → tab crash on long sessions.
- Recommended fix: JSX-rendered hidden imgs (auto-removed by React) or bounded queue + AbortController.

---

### Medium — `FloatViewProvider` re-binds `keydown` listener on every `views` change with stale closure
- Location: `frontend/src/components/FloatView.tsx:66-77`
- Recommended fix: Ref pattern + bind once with `[]`.

---

### Medium — `FloatView` module-level `viewId` monotonic counter never resets
- Location: `frontend/src/components/FloatView.tsx:125-130`
- Issue: Used as `zIndex` — past 32-bit threshold browsers bail to slow path.
- Recommended fix: Reset to 0 when `views.length === 0`.

---

### Medium — `BatchItemSelector.Thumbnail` thundering-herd fetch on 200+ scene list
- Location: `frontend/src/components/BatchItemSelector.tsx:64-80`
- Recommended fix: `IntersectionObserver` viewport-aware fetch.

---

### Medium — `addAllToQueue` fire-and-forget chunk loop has no AbortController
- Location: `frontend/src/components/SceneQueueControl.tsx:651-730`
- Issue: User navigates away mid-iteration — closure retains stale session/scenes; toasts arrive after user moved on.
- Recommended fix: `AbortController` + parent unmount cleanup.

---

### Medium — `SceneCharacterPromptEditor.updateCharacter` map+spread per slider tick
- Location: `frontend/src/components/SceneEditor.tsx:547-557`
- Issue: Range inputs fire 60Hz; full array + object copies → ~300 allocations/sec during slider drag.
- Recommended fix: MobX in-place mutation (`Object.assign(target, updates)`).

---

### Medium — `SlotEditor` mutates `scene.slots` outside `runInAction`
- Location: `frontend/src/components/SceneEditor.tsx:748-757`
- Recommended fix: Wrap in `runInAction`.

---

### Medium — `Tooltip` portal position doesn't update on scroll
- Location: `frontend/src/components/Tooltip.tsx:29-52`
- Recommended fix: Close tooltip on scroll, or re-query rect on scroll/resize.

---

### Medium — `ConfirmWindow` window keydown re-binds on every `appState.dialogs` mutation
- Location: `frontend/src/components/ConfirmWindow.tsx:50-62`
- Recommended fix: Ref pattern + bind once with `[]`.

---

### Medium — `taskCommitsRef` Map slow-leaks in pathological visibility-flag scenarios
- Location: `frontend/src/components/TaskQueueControl.tsx:299-302, 506-512`
- Recommended fix: Hard age-based GC pass (5min, !active, no progress).

---

### Medium — `BigPromptEditor` setTimeout(100ms) `editDisabled` not idempotent in concurrent mode
- Location: `frontend/src/components/SceneEditor.tsx:144-151`
- Recommended fix: `useLayoutEffect` + immediate enable, or CSS solution.

## Low-severity findings
- `SceneQueueControl.tsx:947` `getInitialThumbSize` called per render outside useMemo.
- `SceneQueueControl.tsx:1437-1450` `document.createElement('input')` for file picker never removed; GC-safe.
- `CharacterPresetEditor.tsx:829-834` ObjectURL revoked synchronously — OK.
- `CharacterPresetEditor.tsx:104-119` `imagePath` useMemo deps include `length` only, not first item path.
- `TournamentArena.tsx:59` `prefetchURLs.join('|')` dep — eslint-bypass.
- `BatchItemSelector.tsx:247-252` `ResizeObserver` correctly disconnected.
- `Tooltip.tsx:117-125` `setTimeout` cleared in `hide`.
- `ResizableSplitter.tsx:20-39` `mousemove`/`mouseup` listeners; release outside window leaks. Consider `pointerup` + `lostpointercapture`.
- `useTournament.ts:76-114` `cancelled` flag correct.
- `useLongPress.ts:55-69` timer cleanup correct.
- `DownloadDialog.tsx:58-60` `useEffect([settings])` per keystroke — could debounce.
- `AppContextMenu.tsx` pure rendering. Clean.
- `SessionSelect.tsx:46-72` sticky toast handled correctly.
- `SceneNameExportForm.tsx` clean.
- `ProgressWindow.tsx` pure render.
- `FloatView.tsx:127-145` `useRef(++viewId)` — see medium issue above.
- `TournamentPodium.tsx`, `TournamentHeader.tsx`, `TournamentToolbar.tsx` `React.memo` clean.
- `ExportPresetsDialog.tsx` clean; spread-update OK for non-hot path.

## Components section scores (0–10, higher = worse risk)
- Memory leak risk: **5**
- CPU bottleneck risk: **7**
- Long-term stability risk: **5**
- Production failure likelihood: **4**

**Top 3 component-layer priorities:**
1. Fix `SceneEditor.tsx:127-139` missing `[]` dep array (Critical — listener storm during every generation).
2. Payload-level filtering on `SceneCell` listeners (`SceneQueueControl.tsx:248-291`) — primary mobile-jank/heat contributor.
3. Coalesce `syncFromService` in `TaskQueueControl.tsx` with `requestAnimationFrame`; bound `TournamentArena` prefetch.

---

# Final Summary

1. **Number of critical issues**: **9** (3 backend + 3 models + 2 workflows + 1 components)
2. **Memory leak risk score**: **7/10** — long-lived MobX stores + Node pm2 process accumulate references over weeks. Unreleased timers, WS handler Maps, base64 retention in queue/mirror chains.
3. **CPU bottleneck risk score**: **7/10** — sync `execSync` on hot HTTP paths, sync `toDataURL` per mirror, N-scene listener fan-out, KDF on main thread, O(N²) array.shift patterns.
4. **Long-term runtime stability score**: **6/10** — bounded for typical sessions but accretive leaks across WS reconnect storms, mirror caches, MobX observer retention, queue retry loops. WS no-`error`-handler is a real crash vector.
5. **Estimated production failure likelihood**: **5/10** — no Always-crash, but Critical OOM possible on large export/backup; ws crash vector; permanent UI-hang scenario on ImageService mutex; documented mobile thermal/battery drain.

## Top 5 highest-priority fixes (consolidated)

| # | Fix | Layer | Type | Effort | Impact |
|---|---|---|---|---|---|
| 1 | Eliminate base64 round-trip in NAI client + stream zip pipeline + drop `EXPORT_CONCURRENCY` to 3 | Backend | Critical ×2 | M | Largest heap/OOM win |
| 2 | Add `[]` dep array to `BigPromptEditor` listener `useEffect` | Components | Critical | XS | Instant mobile jank relief |
| 3 | `prepareMirrorCanvas` async `toBlob` + canvas teardown + image-load timeout | Workflows | Critical ×2 | S | Removes UI freeze + indefinite hang on bad mirror input |
| 4 | `ImageService.acquireMutex` FIFO chain + idempotent release + try/finally | Models | Critical | M | Eliminates permanent UI hang failure mode |
| 5 | `TaskQueueService.restoreMirroredState` 30s polling conditional (skip when idle) | Models | Critical | XS | Mobile thermal/battery; matches JOURNAL P15 baseline goal |

## Implementation phasing recommendation

**Phase A — quick wins (<1 hour total):** items 2, 5, and all "Quick wins" in executive summary. Each is <5 lines, no architecture change, immediate user-visible relief.

**Phase B — backend memory criticals (~half day):** item 1 (base64 elimination + zip streaming). Test with large export job.

**Phase C — async safety (1 day):** items 3, 4. Plus ws error handler + retry-loop rework.

**Phase D — long-term hygiene (multi-session):** Models mirror state consolidation, observability for `eventHandlers` Map growth, per-endpoint API timeouts, IndexedDB-backed image cache.

Phases A and B together should deliver the bulk of measurable production improvement; C and D harden for long-running stability.

---

*Generated by parallel static-audit agents per `docs/runtime-audit-instructions.md`. Findings are static-analysis-only and have NOT been verified by execution. Confidence ratings are documented per issue.*
