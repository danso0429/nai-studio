// 버전 비교 — 업데이트 알림이 "현재 < 최신"일 때만 뜨도록.
//
// 단순 문자열 부등호(current !== latest)는 현재 버전이 최신보다 *높거나*(다운그레이드)
// pre-release 표기만 달라도 "업데이트 있음"으로 오판한다. (예: 로컬 1.11.0 인데
// origin 의 version.json 이 아직 1.10.0 이면 1.11.0 !== 1.10.0 → 업데이트 표시.)
//
// isOlderVersion(current, latest): current 가 latest 보다 낮으면(= 받을 게 있으면) true.
// - leading "v" 제거, pre-release 접미사(-experimental.N 등)는 떼고 stable 숫자 부분만 비교.
// - 같거나(current >= latest) 더 높으면 false → 알림 안 뜸.
function isOlderVersion(current, latest) {
  const parse = (v) =>
    String(v)
      .replace(/^v/, '')
      .split('-')[0]
      .split('.')
      .map((n) => parseInt(n, 10) || 0);
  const c = parse(current);
  const l = parse(latest);
  const len = Math.max(c.length, l.length);
  for (let i = 0; i < len; i++) {
    const cv = c[i] || 0;
    const lv = l[i] || 0;
    if (cv < lv) return true;
    if (cv > lv) return false;
  }
  return false; // 동일
}

module.exports = { isOlderVersion };
