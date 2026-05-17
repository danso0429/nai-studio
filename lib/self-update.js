// Self-update orchestration. 클라이언트(NDJSON 스트림)로 진행률 흘리면서
// git pull → npm install → vite build → build-info.json → pm2 restart 호출.
//
// 호출자(server.js)는 res 스트림 + send 콜백을 만들고, 이 모듈은 단계별
// execSync를 돌리고 send()로 진행 보고. pm2 restart는 res.end() 이후
// 호출자가 직접 spawn (process가 죽기 직전 명령 큐 안전).
//
// PocketRisu(~/risuai-nodeonly/server/node/server.cjs:5470~)
// 패턴 차용: NDJSON 스트림 + 락 분리. backup 트랜잭션은 git이 대체.

const { execSync, spawn } = require('child_process');
const path = require('path');
const fss = require('fs');

// 단계별 timeout (ms). 실측 기준: git fetch ~2s, npm install ~30s, vite build ~12s.
// 여유 5~10배 잡음.
const TIMEOUT = {
  gitFetch: 30000,
  gitPull: 60000,
  npmInstall: 300000,
  viteBuild: 600000,
};

function runStep(cmd, opts, send, errStep) {
  try {
    return execSync(cmd, opts).toString();
  } catch (e) {
    const stderr = e.stderr ? e.stderr.toString() : '';
    const stdout = e.stdout ? e.stdout.toString() : '';
    const message = `${errStep} 실패: ${e.message}${stderr ? '\n' + stderr.trim() : ''}${stdout ? '\n' + stdout.trim() : ''}`;
    send('error', 0, message.slice(0, 2000));
    throw new Error(message);
  }
}

// send(step, percent, message): NDJSON 한 줄 송신.
// 반환: { restarted: true } | { restarted: false, reason: '...' }
async function runSelfUpdate({ projectDir, send }) {
  const env = { ...process.env, PATH: process.env.PATH };

  send('checking', 0, '최신 버전 확인 중...');
  runStep('git fetch origin main --quiet', { cwd: projectDir, timeout: TIMEOUT.gitFetch, env }, send, 'git fetch');

  const local = execSync('git rev-parse HEAD', { cwd: projectDir, env }).toString().trim();
  const remote = execSync('git rev-parse origin/main', { cwd: projectDir, env }).toString().trim();

  if (local === remote) {
    // build artifact stale일 수도 있지만 우선 main 일치면 "이미 최신"으로 처리.
    // (update.sh도 BUILT_HASH 비교 후 재빌드. self-update에선 단순화 — 명시적 force 시만 재빌드)
    send('done', 100, '이미 최신 버전입니다. (no-op)');
    return { restarted: false, reason: 'already-latest' };
  }

  // Dirty working tree 가드 — update.sh와 동일 정책.
  // public/build/ 변경은 vite가 곧 재생성하니 제외. 그 외 modified/untracked는 차단.
  const dirty = execSync(
    "git status --porcelain --untracked-files=normal | grep -Ev '^.. public/build/' || true",
    { cwd: projectDir, env, shell: '/bin/bash' },
  ).toString().trim();
  if (dirty) {
    send('error', 0, `커밋 안 된 변경 존재 — 업데이트 차단:\n${dirty.slice(0, 1500)}`);
    throw new Error('dirty working tree');
  }

  send('pulling', 10, 'git pull origin main...');
  runStep('git pull origin main --ff-only', { cwd: projectDir, timeout: TIMEOUT.gitPull, env }, send, 'git pull');

  send('installing', 30, '의존성 갱신 (root)...');
  runStep('npm install --silent', { cwd: projectDir, timeout: TIMEOUT.npmInstall, env }, send, 'npm install (root)');

  send('installing-frontend', 45, '의존성 갱신 (frontend)...');
  runStep('npm install --silent', { cwd: path.join(projectDir, 'frontend'), timeout: TIMEOUT.npmInstall, env }, send, 'npm install (frontend)');

  send('building', 60, 'vite build...');
  runStep('npx vite build --emptyOutDir', { cwd: path.join(projectDir, 'frontend'), timeout: TIMEOUT.viteBuild, env }, send, 'vite build');

  send('writing-buildinfo', 90, 'build-info.json 갱신...');
  const gitHash = execSync('git rev-parse --short HEAD', { cwd: projectDir, env }).toString().trim();
  const buildTime = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  let versionInfo = { version: '?', sdstudioBase: '?' };
  try {
    versionInfo = JSON.parse(fss.readFileSync(path.join(projectDir, 'version.json'), 'utf8'));
  } catch {}
  fss.writeFileSync(
    path.join(projectDir, 'public', 'build-info.json'),
    JSON.stringify({
      buildTime,
      gitHash,
      version: versionInfo.version,
      sdstudioBase: versionInfo.sdstudioBase,
    }),
  );

  send('restarting', 100, '서버 재시작 중... (pm2 restart)');
  return { restarted: true, gitHash, version: versionInfo.version };
}

// res.end() 직후 호출자가 부르는 헬퍼. detached spawn으로 pm2 restart 던지고
// 1초 후 process.exit — pm2가 우리를 알아서 새 인스턴스로 갈아끼움.
function triggerPm2Restart(pm2Name) {
  const child = spawn('pm2', ['restart', pm2Name, '--update-env'], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  setTimeout(() => process.exit(0), 1000);
}

module.exports = { runSelfUpdate, triggerPm2Restart };
