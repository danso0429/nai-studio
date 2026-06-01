// Self-update orchestration. 클라이언트(NDJSON 스트림)로 진행률 흘리면서
// git pull → npm install → vite build → build-info.json → pm2 restart 호출.
//
// 호출자(server.js)는 res 스트림 + send 콜백을 만들고, 이 모듈은 단계별
// execSync를 돌리고 send()로 진행 보고. pm2 restart는 res.end() 이후
// 호출자가 직접 spawn (process가 죽기 직전 명령 큐 안전).
//
// 패턴 차용: NDJSON 스트림 + 락 분리. 참조: risuai-nodeonly fork (RisuAI 계열,
// GitHub에서 찾을 수 있음) 의 server.cjs ~line 5470. backup 트랜잭션은 git이 대체.

const { exec: _exec, spawn } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const fss = require('fs');

const execAsync = promisify(_exec);

// 단계별 timeout (ms). 실측 기준: git fetch ~2s, npm install ~30s, vite build ~12s.
// 여유 5~10배 잡음.
const TIMEOUT = {
  gitFetch: 30000,
  gitPull: 60000,
  npmInstall: 300000,
  viteBuild: 600000,
};

// M11: execSync → util.promisify(exec). 옛 동작 유지하면서 event loop block 제거.
// 다른 HTTP endpoint가 self-update 진행 중에도 응답 가능. 단계별 NDJSON 진행률은 그대로.

// git/npm/vite stderr에 박힌 deployee install dir abs path를 클라 응답에서 제거.
// 평소 cwd인 projectDir만 마스킹 — 같은 머신 다른 abs path(예: /etc/...)는 그대로
// (디버깅 가치 유지). 마스킹 후에도 traversal/유사 path 노출 risk 없음.
function sanitizeStderrPaths(text, projectDir) {
  if (!text || !projectDir) return text;
  // projectDir + 그 부모(typical $HOME)도 마스킹 후보. 단 부모는 너무 generic이라
  // projectDir 자체만 — 약 90% leak 케이스 (절대 path가 projectDir로 시작).
  const escaped = projectDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(escaped, 'g'), '<project>');
}

async function runStep(cmd, opts, send, errStep) {
  try {
    const { stdout } = await execAsync(cmd, opts);
    return stdout.toString();
  } catch (e) {
    const projectDir = opts && opts.cwd;
    const stderr = sanitizeStderrPaths(e.stderr ? e.stderr.toString() : '', projectDir);
    const stdout = sanitizeStderrPaths(e.stdout ? e.stdout.toString() : '', projectDir);
    const errMsg = sanitizeStderrPaths(e.message || '', projectDir);
    const message = `${errStep} 실패: ${errMsg}${stderr ? '\n' + stderr.trim() : ''}${stdout ? '\n' + stdout.trim() : ''}`;
    send('error', 0, message.slice(0, 2000));
    throw new Error(message);
  }
}

// send(step, percent, message): NDJSON 한 줄 송신.
// 반환: { restarted: true } | { restarted: false, reason: '...' }
async function runSelfUpdate({ projectDir, send }) {
  const env = { ...process.env, PATH: process.env.PATH };

  send('checking', 0, '최신 버전 확인 중...');
  await runStep('git fetch origin main --quiet', { cwd: projectDir, timeout: TIMEOUT.gitFetch, env }, send, 'git fetch');

  const local = (await execAsync('git rev-parse HEAD', { cwd: projectDir, env })).stdout.trim();
  const remote = (await execAsync('git rev-parse origin/main', { cwd: projectDir, env })).stdout.trim();

  if (local === remote) {
    // 판정 기준이 update.sh와 다른 건 의도된 불일치 — 용도가 다르기 때문.
    //   self-update = origin sync: "원격 최신 받기"가 목적이라 local==remote면 받을 게
    //     없어 no-op. build-info gitHash(빌드 최신성)는 안 본다.
    //   update.sh:47 = build freshness: 로컬에서 소스를 고치고 빌드하는 용도라
    //     gitHash + dirty까지 봐서 uncommitted/미빌드면 재빌드.
    // 서버는 보통 clean(uncommitted 없음)이고, dirty면 아래 가드(73-)에서 throw하므로
    // self-update 경로에서 build stale을 무시해도 실사용 위험이 낮다.
    send('done', 100, '이미 최신 버전입니다. (no-op)');
    return { restarted: false, reason: 'already-latest' };
  }

  // Dirty working tree 가드 — update.sh와 동일 정책.
  // public/build/ 변경은 vite가 곧 재생성하니 제외. 그 외 modified/untracked는 차단.
  const dirty = (await execAsync(
    "git status --porcelain --untracked-files=normal | grep -Ev '^.. public/build/' || true",
    { cwd: projectDir, env, shell: '/bin/bash' },
  )).stdout.trim();
  if (dirty) {
    send('error', 0, `커밋 안 된 변경 존재 — 업데이트 차단:\n${dirty.slice(0, 1500)}`);
    throw new Error('dirty working tree');
  }

  send('pulling', 10, 'git pull origin main...');
  await runStep('git pull origin main --ff-only', { cwd: projectDir, timeout: TIMEOUT.gitPull, env }, send, 'git pull');

  send('installing', 30, '의존성 갱신 (root)...');
  await runStep('npm install --silent', { cwd: projectDir, timeout: TIMEOUT.npmInstall, env }, send, 'npm install (root)');

  send('installing-frontend', 45, '의존성 갱신 (frontend)...');
  await runStep('npm install --silent', { cwd: path.join(projectDir, 'frontend'), timeout: TIMEOUT.npmInstall, env }, send, 'npm install (frontend)');

  send('building', 60, 'vite build...');
  await runStep('npx vite build --emptyOutDir', { cwd: path.join(projectDir, 'frontend'), timeout: TIMEOUT.viteBuild, env }, send, 'vite build');

  send('writing-buildinfo', 90, 'build-info.json 갱신...');
  const gitHash = (await execAsync('git rev-parse --short HEAD', { cwd: projectDir, env })).stdout.trim();
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
