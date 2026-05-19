// GitHub-based version check: reads version.json from origin's main branch,
// compares with local public/build-info.json. Cached 5 min per repo URL.

const path = require('path');
const fs = require('fs').promises;

let _versionCache = { fetchedAt: 0, latest: null, repoUrl: null };
const VERSION_CACHE_TTL = 5 * 60 * 1000;  // 5분
// audit M7 — flaky 네트워크에서 실패 시에도 fetchedAt 안 갱신 → 매 호출 재시도로
// GitHub raw 호출 폭주. negative cache (실패 시점도 fetchedAt 박음) + 다중 동시
// 호출 단일-flight로 합침.
let _pendingFetch = null;

function getRepoVersionUrl(projectDir) {
  if (process.env.NAI_STUDIO_VERSION_URL) return process.env.NAI_STUDIO_VERSION_URL;
  try {
    const { execSync } = require('child_process');
    const remote = execSync('git -C ' + projectDir + ' remote get-url origin', { encoding: 'utf8', timeout: 2000 }).trim();
    const m = remote.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
    if (m) return 'https://raw.githubusercontent.com/' + m[1] + '/' + m[2] + '/main/version.json';
  } catch {}
  return null;
}

async function checkVersion({ projectDir }) {
  const now = Date.now();
  const repoUrl = getRepoVersionUrl(projectDir);
  if (!repoUrl) return { current: null, latest: null, updateAvailable: false, error: 'no-repo-url' };

  const stale = now - _versionCache.fetchedAt > VERSION_CACHE_TTL || _versionCache.repoUrl !== repoUrl;
  if (stale) {
    if (_pendingFetch) {
      // 동시 호출 합치기 — 같은 fetch promise 공유
      await _pendingFetch;
    } else {
      _pendingFetch = (async () => {
        try {
          const r = await fetch(repoUrl, { signal: AbortSignal.timeout(5000) });
          if (r.ok) {
            const data = await r.json();
            _versionCache = { fetchedAt: Date.now(), latest: data.version, repoUrl, notes: data.notes || null, released: data.released || null };
          } else {
            // 실패도 fetchedAt 박아 negative cache — 5분 동안 재시도 안 함
            _versionCache.fetchedAt = Date.now();
          }
        } catch (e) {
          console.warn('[version-check] fetch failed:', e.message);
          _versionCache.fetchedAt = Date.now();
        } finally {
          _pendingFetch = null;
        }
      })();
      await _pendingFetch;
    }
  }

  let current = null;
  try {
    const bi = JSON.parse(await fs.readFile(path.join(projectDir, 'public', 'build-info.json'), 'utf8'));
    current = bi.version;
  } catch {}

  return {
    current,
    latest: _versionCache.latest,
    updateAvailable: !!(current && _versionCache.latest && current !== _versionCache.latest),
    notes: _versionCache.notes,
    released: _versionCache.released,
  };
}

module.exports = { checkVersion };
