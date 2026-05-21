#!/usr/bin/env node
// 제작자 환경의 누적 timing stats을 baseline JSON으로 dump.
// 신규 설치 사용자가 queue.html에서 참고할 수 있도록 codebase에 박힘.
// 실행: `node scripts/refresh-baseline-timing.js`
//
// 입력: data/.queue_timing_stats.json (서버가 실시간 갱신하는 영구 누적)
// 출력: lib/baseline-timing-stats.json (committed)
//
// 데이터 범위: aggregate buckets + allTime totals만. raw timestamps 없음 — 사용 패턴
// 시간대 노출 회피. count/totalMs/avgMs는 익명 통계라 sweep-safe.

const fs = require('fs');
const path = require('path');

const PROJECT_DIR = path.resolve(__dirname, '..');
const STATS_FILE = path.join(PROJECT_DIR, 'data', '.queue_timing_stats.json');
const OUT_FILE = path.join(PROJECT_DIR, 'lib', 'baseline-timing-stats.json');

let stats;
try {
  stats = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
} catch (e) {
  console.error('[refresh-baseline-timing] STATS_FILE read 실패:', e.message);
  process.exit(1);
}

if (!stats.buckets || !Array.isArray(stats.buckets) || !stats.allTime) {
  console.error('[refresh-baseline-timing] STATS_FILE 구조 불일치');
  process.exit(1);
}

const baseline = {
  snapshotDate: new Date().toISOString().slice(0, 10),
  tz: stats.tz || 'KST',
  bucketHours: Math.max(1, Math.floor(24 / stats.buckets.length)),
  bucketCount: stats.buckets.length,
  buckets: stats.buckets,
  allTime: stats.allTime,
  note: 'SDStudio Remote 제작자 환경 baseline. NAI v4/v4.5 + Oracle Cloud ARM Ampere A1. 신규 설치 시 참고용 — 본인 환경 누적 시작되면 본인 데이터와 나란히 비교 표시.',
};

fs.writeFileSync(OUT_FILE, JSON.stringify(baseline, null, 2) + '\n');
const avgMs = stats.allTime.count > 0
  ? Math.round(stats.allTime.totalMs / stats.allTime.count)
  : 0;
console.log(`baseline written: ${OUT_FILE}`);
console.log(`  count=${stats.allTime.count.toLocaleString()}, avg=${avgMs}ms (${(avgMs/1000).toFixed(2)}초)`);
console.log(`  snapshot=${baseline.snapshotDate} tz=${baseline.tz} bucketHours=${baseline.bucketHours}`);
