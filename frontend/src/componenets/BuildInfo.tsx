import { useEffect, useState } from 'react';

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

const API = `${location.protocol}//${location.host}${import.meta.env.BASE_URL.replace(/\/$/, '')}/api`;

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
    // 30분마다 재확인
    const id = setInterval(() => {
      fetchVersionCheck().then(setVersionInfo);
    }, 30 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  if (!buildInfo) return null;

  const updateAvailable = versionInfo?.updateAvailable === true;

  if (variant === 'desktop') {
    // TobBar에 들어가는 인라인 형태 (기존 텍스트 자리 대체)
    return (
      <>
        <span className="text-sub text-xs opacity-60 mr-2">
          SDStudio v{buildInfo.sdstudioBase} | Remote v{buildInfo.version}
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
        onClick={() => updateAvailable && setShowModal(true)}
        className={`flex flex-col items-center justify-center px-2 py-0.5 rounded-full text-[9px] leading-tight font-medium select-none ${
          updateAvailable
            ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300 cursor-pointer animate-pulse'
            : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
        }`}
        title={updateAvailable ? `업데이트 v${versionInfo?.latest} 사용 가능` : ''}
        disabled={!updateAvailable}
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

const UpdateModal = ({ current, latest, notes, released, onClose }: UpdateModalProps) => {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold mb-3 text-gray-900 dark:text-gray-100">
          🔄 업데이트 사용 가능
        </h2>
        <div className="space-y-2 text-sm text-gray-700 dark:text-gray-300">
          <p>
            현재: <code className="bg-gray-100 dark:bg-gray-900 px-1 py-0.5 rounded">v{current}</code>
            {' → '}
            최신: <code className="bg-orange-100 dark:bg-orange-900/40 px-1 py-0.5 rounded">v{latest}</code>
          </p>
          {released && (
            <p className="text-xs opacity-70">출시일: {released}</p>
          )}
          {notes && (
            <div className="mt-3 p-2 bg-gray-50 dark:bg-gray-900/50 rounded text-xs">
              <div className="font-semibold mb-1">변경사항:</div>
              <div className="whitespace-pre-wrap opacity-80">{notes}</div>
            </div>
          )}
        </div>

        <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded text-xs">
          <div className="font-semibold mb-2 text-blue-900 dark:text-blue-200">
            서버에서 다음 명령 실행:
          </div>
          <div className="bg-gray-900 text-green-400 p-2 rounded font-mono text-[11px] overflow-x-auto">
            cd ~/nai-studio && ./update.sh
          </div>
          <div className="mt-2 text-blue-800 dark:text-blue-300 opacity-80">
            데이터(프리셋, 이미지, 설정)는 그대로 유지됩니다.
          </div>
        </div>

        <button
          onClick={onClose}
          className="mt-4 w-full px-4 py-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 rounded text-sm font-medium text-gray-900 dark:text-gray-100"
        >
          닫기
        </button>
      </div>
    </div>
  );
};

export default BuildInfoBadge;
