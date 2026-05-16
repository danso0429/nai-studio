// 클라이언트 frame timing 측정 — 큐 도는 동안 main thread jank/발열 진단용.
// rAF 기반: 매 frame 간격 측정 → 50ms 초과(=3 frame budget over)면 slow frame 카운트.
// 60초마다 batch sendBeacon → 서버 console.log → pm2 logs로 본인 분석 가능.
// visibility=hidden 시 rAF 자동 정지 (iOS Safari native) → 별도 visibility 게이트 불필요.

const SLOW_FRAME_THRESHOLD_MS = 50; // 약한 jank 기준 (16.67ms budget × 3)
const BATCH_INTERVAL_MS = 60 * 1000;

let frameCount = 0;
let slowFrameCount = 0;
let maxFrameMs = 0;
let lastFrameTs = 0;
let batchStartTs = 0;
let started = false;

function tick(now: number) {
  if (lastFrameTs) {
    const dt = now - lastFrameTs;
    frameCount++;
    if (dt > SLOW_FRAME_THRESHOLD_MS) slowFrameCount++;
    if (dt > maxFrameMs) maxFrameMs = dt;
  }
  lastFrameTs = now;

  if (now - batchStartTs >= BATCH_INTERVAL_MS) {
    flush(now);
  }
  requestAnimationFrame(tick);
}

function flush(now: number) {
  if (frameCount > 0) {
    const data = {
      type: 'frame-stats',
      ts: Date.now(),
      durationMs: Math.round(now - batchStartTs),
      frameCount,
      slowFrameCount,
      slowRatio: Number((slowFrameCount / frameCount).toFixed(4)),
      maxFrameMs: Math.round(maxFrameMs),
      ua: navigator.userAgent.slice(0, 200),
      visible: document.visibilityState === 'visible',
    };
    try {
      const blob = new Blob([JSON.stringify(data)], {
        type: 'application/json',
      });
      navigator.sendBeacon('/api/client-perf', blob);
    } catch {
      // sendBeacon 미지원 등 — 무시 (측정 인프라가 앱 동작 영향 X)
    }
    // [clientPerf-DEV] queue.html에서 데이터 보기 위한 localStorage ring buffer.
    // 다 지울 땐 이 블록 + queue.html clientPerf 패널 + index.tsx
    // startClientPerf 호출 + server.js /api/client-perf endpoint 다 같이.
    try {
      const recent = JSON.parse(
        localStorage.getItem('clientPerf.recent') || '[]',
      );
      recent.unshift(data);
      if (recent.length > 20) recent.length = 20;
      localStorage.setItem('clientPerf.recent', JSON.stringify(recent));
    } catch {
      // localStorage quota / private mode 등 — 무시
    }
    // [/clientPerf-DEV]
  }
  frameCount = 0;
  slowFrameCount = 0;
  maxFrameMs = 0;
  batchStartTs = now;
}

export function startClientPerf() {
  if (started) return;
  started = true;
  batchStartTs = performance.now();
  lastFrameTs = 0;
  requestAnimationFrame(tick);
}
