import { useEffect, useState } from 'react';
import { apiUrl } from '../models/util';
import { backend } from '../models';
import { startVisibleInterval } from '../visibleInterval';

const GITHUB_REPO_URL = 'https://github.com/danso0429/nai-studio';

interface VersionInfo {
  current: string | null;
  latest: string | null;
  updateAvailable: boolean;
  notes?: string | null;
  released?: string | null;
  sdstudioBase?: string | null;
}

interface BuildInfo {
  version: string;
  sdstudioBase: string;
  gitHash?: string;
  buildTime?: string;
}

const API = apiUrl('/api');

let _cachedBuildInfo: BuildInfo | null = null;
let _cachedVersionInfo: VersionInfo | null = null;

async function fetchBuildInfo(): Promise<BuildInfo | null> {
  if (_cachedBuildInfo) return _cachedBuildInfo;
  try {
    const r = await fetch(`${API}/build-info?t=${Date.now()}`);
    if (!r.ok) return null;
    _cachedBuildInfo = await r.json();
    return _cachedBuildInfo;
  } catch {
    return null;
  }
}

async function fetchVersionCheck(): Promise<VersionInfo | null> {
  try {
    const r = await fetch(`${API}/version-check`);
    if (!r.ok) return null;
    _cachedVersionInfo = await r.json();
    return _cachedVersionInfo;
  } catch {
    return null;
  }
}

interface BuildInfoBadgeProps {
  variant: 'desktop' | 'mobile';
}

export const BuildInfoBadge = ({ variant }: BuildInfoBadgeProps) => {
  const [buildInfo, setBuildInfo] = useState<BuildInfo | null>(_cachedBuildInfo);
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(_cachedVersionInfo);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    fetchBuildInfo().then(setBuildInfo);
    fetchVersionCheck().then(setVersionInfo);
    // 30분마다 재확인 (visibility 게이트 — 백그라운드 시 timer 정지)
    return startVisibleInterval(() => {
      fetchVersionCheck().then(setVersionInfo);
    }, 30 * 60 * 1000);
  }, []);

  if (!buildInfo) return null;

  const updateAvailable = versionInfo?.updateAvailable === true;

  if (variant === 'desktop') {
    // TobBar에 들어가는 인라인 형태 (기존 텍스트 자리 대체)
    return (
      <>
        <span className="text-sub text-xs opacity-60 mr-2">
          {updateAvailable ? (
            <span>SDStudio v{buildInfo.sdstudioBase} | Remote v{buildInfo.version}</span>
          ) : (
            <button
              onClick={() => backend.openWebPage(GITHUB_REPO_URL)}
              className="hover:underline cursor-pointer"
              title="GitHub 저장소 열기"
            >
              SDStudio v{buildInfo.sdstudioBase} | Remote v{buildInfo.version}
            </button>
          )}
          {updateAvailable && (
            <button
              onClick={() => setShowModal(true)}
              className="ml-2 px-1.5 py-0.5 rounded text-[10px] bg-orange-500 text-white hover:bg-orange-600 cursor-pointer animate-pulse"
              title={`최신 버전 v${versionInfo?.latest} 사용 가능`}
            >
              🔄 업데이트 v{versionInfo?.latest}
            </button>
          )}
        </span>
        {showModal && versionInfo && (
          <UpdateModal
            current={buildInfo.version}
            latest={versionInfo.latest!}
            notes={versionInfo.notes || null}
            released={versionInfo.released || null}
            onClose={() => setShowModal(false)}
          />
        )}
      </>
    );
  }

  // mobile variant: 알약 모양, 두 줄 (SDStudio / Remote)
  return (
    <>
      <button
        onClick={() => {
          if (updateAvailable) {
            setShowModal(true);
          } else {
            backend.openWebPage(GITHUB_REPO_URL);
          }
        }}
        className={`flex flex-col items-center justify-center px-2 py-0.5 rounded-full text-[9px] leading-tight font-medium select-none cursor-pointer ${
          updateAvailable
            ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300 animate-pulse'
            : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
        }`}
        title={updateAvailable ? `업데이트 v${versionInfo?.latest} 사용 가능` : 'GitHub 저장소 열기'}
      >
        <span className="opacity-70">SD v{buildInfo.sdstudioBase}</span>
        <span className="font-semibold">
          {updateAvailable ? `🔄 v${versionInfo?.latest}` : `v${buildInfo.version}`}
        </span>
      </button>
      {showModal && versionInfo && (
        <UpdateModal
          current={buildInfo.version}
          latest={versionInfo.latest!}
          notes={versionInfo.notes || null}
          released={versionInfo.released || null}
          onClose={() => setShowModal(false)}
        />
      )}
    </>
  );
};

interface UpdateModalProps {
  current: string;
  latest: string;
  notes: string | null;
  released: string | null;
  onClose: () => void;
}

interface Progress {
  step: string;
  percent: number;
  message: string;
}

// 서버 재시작 대기. PocketRisu update.ts:117 패턴 — 3초 sleep (서버 죽기 전 fetch
// 의미 X) 후 60초 동안 2초 간격으로 build-info 폴링 → version 일치하면 return true.
async function waitForServerRestart(expectedVersion: string): Promise<boolean> {
  await new Promise((r) => setTimeout(r, 3000));
  const start = Date.now();
  while (Date.now() - start < 60000) {
    try {
      const r = await fetch(`${API}/build-info?t=${Date.now()}`);
      if (r.ok) {
        const info = await r.json();
        if (info.version === expectedVersion) return true;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

const UpdateModal = ({ current, latest, notes, released, onClose }: UpdateModalProps) => {
  type Phase = 'idle' | 'running' | 'done' | 'error';
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState<Progress | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const runUpdate = async () => {
    setPhase('running');
    setErrMsg(null);
    setProgress({ step: 'connecting', percent: 0, message: '서버 연결 중...' });

    let r: Response;
    try {
      r = await fetch(`${API}/self-update`, { method: 'POST' });
    } catch (e: any) {
      setPhase('error');
      setErrMsg('서버 연결 실패: ' + (e?.message || e));
      return;
    }

    if (r.status === 401) {
      setPhase('error');
      setErrMsg('NAI 로그인이 필요합니다. 로그인 후 다시 시도하세요.');
      return;
    }
    if (r.status === 409) {
      setPhase('error');
      setErrMsg('이미 다른 업데이트가 진행 중입니다.');
      return;
    }
    if (!r.ok || !r.body) {
      setPhase('error');
      setErrMsg(`HTTP ${r.status}`);
      return;
    }

    // NDJSON 스트림 read — 라인 단위로 buffer split + JSON.parse.
    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let lastObj: Progress & { step: string } | null = null;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          try {
            const obj = JSON.parse(line) as Progress;
            setProgress(obj);
            lastObj = obj;
            if (obj.step === 'error') {
              setPhase('error');
              setErrMsg(obj.message);
              return;
            }
          } catch {}
        }
      }
    } catch (e: any) {
      // 서버가 pm2 restart로 죽으면서 connection reset — restarting 단계에선 정상.
      if (lastObj?.step !== 'restarting') {
        setPhase('error');
        setErrMsg('스트림 끊김: ' + (e?.message || e));
        return;
      }
    }

    if (lastObj?.step === 'restarting') {
      setProgress({ step: 'reconnecting', percent: 100, message: `서버 재시작 대기 중... (v${latest})` });
      const ok = await waitForServerRestart(latest);
      if (ok) {
        setPhase('done');
        setProgress({ step: 'done', percent: 100, message: `업데이트 완료 — v${latest}` });
      } else {
        setPhase('error');
        setErrMsg('서버 재시작 60초 타임아웃. 수동으로 확인 필요.');
      }
    } else if (lastObj?.step === 'done') {
      // "이미 최신" 응답
      setPhase('done');
    }
  };

  // PocketRisu UpdatePopup canClose 패턴 — running 중엔 backdrop/닫기 차단.
  const canClose = phase !== 'running';
  const backdropClick = canClose ? onClose : undefined;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={backdropClick}
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold mb-3 text-gray-900 dark:text-gray-100">
          {phase === 'done' ? '✓ 업데이트 완료' : phase === 'error' ? '❌ 업데이트 실패' : '🔄 업데이트 사용 가능'}
        </h2>

        {phase === 'idle' && (
          <>
            <div className="space-y-2 text-sm text-gray-700 dark:text-gray-300">
              <p>
                현재: <code className="bg-gray-100 dark:bg-gray-900 px-1 py-0.5 rounded">v{current}</code>
                {' → '}
                최신: <code className="bg-orange-100 dark:bg-orange-900/40 px-1 py-0.5 rounded">v{latest}</code>
              </p>
              {released && <p className="text-xs opacity-70">출시일: {released}</p>}
              {notes && (
                <div className="mt-3 p-2 bg-gray-50 dark:bg-gray-900/50 rounded text-xs">
                  <div className="font-semibold mb-1">변경사항:</div>
                  <div className="whitespace-pre-wrap opacity-80">{notes}</div>
                </div>
              )}
            </div>
            <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded text-xs text-blue-800 dark:text-blue-300 opacity-90">
              데이터(프리셋, 이미지, 설정)는 그대로 유지됩니다. 업데이트 중 약 1~2분 서버 재시작.
            </div>
            <div className="mt-4 flex gap-2">
              <button
                onClick={runUpdate}
                className="flex-1 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded text-sm font-medium"
              >
                지금 업데이트
              </button>
              <button
                onClick={onClose}
                className="px-4 py-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 rounded text-sm font-medium text-gray-900 dark:text-gray-100"
              >
                나중에
              </button>
            </div>
          </>
        )}

        {phase === 'running' && progress && (
          <>
            <div className="space-y-3">
              <div className="text-sm text-gray-700 dark:text-gray-300">
                <span className="font-semibold">{progress.step}</span>
                <span className="opacity-60 ml-2">{progress.message}</span>
              </div>
              <div className="w-full h-3 bg-gray-200 dark:bg-gray-700 rounded overflow-hidden">
                <div
                  className="h-full bg-orange-500 transition-all duration-300"
                  style={{ width: `${Math.max(2, Math.min(100, progress.percent ?? 0))}%` }}
                />
              </div>
              <p className="text-xs opacity-60 text-center">
                업데이트 중에는 닫지 마세요. 약 1~2분 소요됩니다.
              </p>
            </div>
          </>
        )}

        {phase === 'done' && (
          <>
            <div className="text-sm text-gray-700 dark:text-gray-300 space-y-2">
              <p>v{current} → <span className="font-semibold">v{latest}</span> 업데이트 완료.</p>
              <p className="text-xs opacity-70">새로고침해서 적용된 화면을 확인하세요.</p>
            </div>
            <button
              onClick={() => window.location.reload()}
              className="mt-4 w-full px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded text-sm font-medium"
            >
              새로고침
            </button>
          </>
        )}

        {phase === 'error' && (
          <>
            <div className="text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20 p-3 rounded whitespace-pre-wrap break-all max-h-60 overflow-y-auto">
              {errMsg || '알 수 없는 오류'}
            </div>
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => { setPhase('idle'); setErrMsg(null); setProgress(null); }}
                className="flex-1 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded text-sm font-medium"
              >
                다시 시도
              </button>
              <button
                onClick={onClose}
                className="px-4 py-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 rounded text-sm font-medium text-gray-900 dark:text-gray-100"
              >
                닫기
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default BuildInfoBadge;
