// GitHub-based version check: reads version.json from origin's main branch,
// compares with local public/build-info.json. Cached 5 min per repo URL.

const path = require('path');
const fs = require('fs').promises;

let _versionCache = { fetchedAt: 0, latest: null, repoUrl: null };
const VERSION_CACHE_TTL = 5 * 60 * 1000;  // 5분

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
