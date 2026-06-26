// SDStudio upstream(Dd154663) latest version 체크. fork version-check.js와 동일 패턴 —
// 60분 TTL, negative cache, single-flight. fork보다 cache 길게 둠 (업스트림은 자주 업데이트 X).

const { isOlderVersion } = require('./version-compare');

let _cache = { fetchedAt: 0, latest: null, htmlUrl: null, publishedAt: null };
const CACHE_TTL = 60 * 60 * 1000; // 60분
let _pendingFetch = null;

const UPSTREAM_API = 'https://api.github.com/repos/Dd154663/SDStudio/releases/latest';
const UPSTREAM_REPO = 'https://github.com/Dd154663/SDStudio';

// "v4.8.2" → "4.8.2". semver 비교용 — 단순 string equality는 leading v 차이로 false negative.
function stripV(s) {
  if (!s) return s;
  return s.startsWith('v') ? s.slice(1) : s;
}

async function checkSdstudioVersion({ currentBase }) {
  const now = Date.now();
  const stale = now - _cache.fetchedAt > CACHE_TTL;
  if (stale) {
    if (_pendingFetch) {
      await _pendingFetch;
    } else {
      _pendingFetch = (async () => {
        try {
          // User-Agent 헤더 — GitHub API는 UA 없으면 403.
          const r = await fetch(UPSTREAM_API, {
            signal: AbortSignal.timeout(5000),
            headers: { 'User-Agent': 'nai-studio-2', 'Accept': 'application/vnd.github+json' },
          });
          if (r.ok) {
            const data = await r.json();
            _cache = {
              fetchedAt: Date.now(),
              latest: stripV(data.tag_name),
              htmlUrl: data.html_url || (UPSTREAM_REPO + '/releases/tag/' + data.tag_name),
              publishedAt: data.published_at || null,
              body: data.body || null,
            };
          } else {
            _cache.fetchedAt = Date.now();
          }
        } catch (e) {
          console.warn('[sdstudio-version-check] fetch failed:', e.message);
          _cache.fetchedAt = Date.now();
        } finally {
          _pendingFetch = null;
        }
      })();
      await _pendingFetch;
    }
  }

  const latest = _cache.latest;
  const current = stripV(currentBase);
  return {
    current,
    latest,
    updateAvailable: !!(current && latest && isOlderVersion(current, latest)),
    htmlUrl: _cache.htmlUrl,
    publishedAt: _cache.publishedAt,
    body: _cache.body,
  };
}

module.exports = { checkSdstudioVersion };
