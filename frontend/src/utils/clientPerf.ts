// 측정용 — 클라 performance.mark/measure 결과를 1초 debounce로 모아
// /api/client-perf에 sendBeacon. pm2 logs에 console.log로 노출돼서 본인이
// iPhone에서 토글해도 서버에서 자동으로 잡힘.

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

type Entry =
  | { kind: 'measure'; name: string; dur: number; ts: number }
  | { kind: 'log'; name: string; data?: unknown; ts: number };

const queue: Entry[] = [];
let flushTimer: number | null = null;

export function mark(name: string): void {
  try {
    performance.mark(name);
  } catch {}
}

export function clearMarks(name?: string): void {
  try {
    performance.clearMarks(name);
  } catch {}
}

export function measureBetween(
  name: string,
  startMark: string,
  endMark: string,
): void {
  try {
    performance.measure(name, startMark, endMark);
    const arr = performance.getEntriesByName(name, 'measure');
    const last = arr[arr.length - 1];
    if (!last) return;
    queue.push({
      kind: 'measure',
      name,
      dur: Math.round(last.duration * 100) / 100,
      ts: Date.now(),
    });
    performance.clearMeasures(name);
    scheduleFlush();
  } catch {}
}

export function log(name: string, data?: unknown): void {
  queue.push({ kind: 'log', name, data, ts: Date.now() });
  scheduleFlush();
}

function scheduleFlush(): void {
  if (flushTimer != null) return;
  flushTimer = window.setTimeout(() => {
    flushTimer = null;
    flush();
  }, 1000);
}

export function flush(): void {
  if (queue.length === 0) return;
  const payload = JSON.stringify({
    ua: navigator.userAgent,
    entries: queue.slice(),
  });
  queue.length = 0;
  try {
    const blob = new Blob([payload], { type: 'application/json' });
    navigator.sendBeacon(`${API_BASE}/api/client-perf`, blob);
  } catch {
    // last-resort fallback (queue 잃음 — 측정 패치라 OK)
  }
}
