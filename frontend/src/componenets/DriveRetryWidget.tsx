import { observer } from 'mobx-react-lite';
import { FaCloudUploadAlt, FaTimes, FaExclamationTriangle } from 'react-icons/fa';
import { appState } from '../models/AppService';
import { DriveRetryEntry } from '../backend';

const formatRelative = (ts: number | null): string => {
  if (ts == null) return '-';
  const ms = ts - Date.now();
  if (ms <= 0) return '곧';
  const s = Math.ceil(ms / 1000);
  if (s < 60) return s + '초 후';
  const m = Math.ceil(s / 60);
  return m + '분 후';
};

const DriveRetryWidget = observer(() => {
  const status = appState.driveRetryStatus;
  if (!status || status.count === 0) return null;
  const allFailed = status.pendingCount === 0 && status.failedCount > 0;
  return (
    <>
      <button
        onClick={() => (appState.driveRetryModalOpen = true)}
        className={
          'fixed bottom-4 left-4 px-3 py-2 rounded-full shadow-lg text-white flex items-center gap-2 text-xs sm:text-sm font-medium ' +
          (allFailed
            ? 'bg-red-600 hover:bg-red-700'
            : 'bg-amber-500 hover:bg-amber-600')
        }
        style={{ zIndex: 4500 }}
      >
        {allFailed ? <FaTimes /> : <FaCloudUploadAlt />}
        <span>
          Drive {allFailed ? '실패' : '대기'} {status.count}건
        </span>
      </button>
      {appState.driveRetryModalOpen && <DriveRetryModal />}
    </>
  );
});

const DriveRetryModal = observer(() => {
  const status = appState.driveRetryStatus;
  if (!status) return null;
  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ zIndex: 5500, backgroundColor: 'rgba(0,0,0,0.8)' }}
      onClick={() => (appState.driveRetryModalOpen = false)}
    >
      <div
        className="bg-white dark:bg-slate-800 text-black dark:text-white rounded-md shadow-xl p-4 max-w-2xl w-[90vw] max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-2">
          <h2 className="text-lg font-bold">Drive 업로드 대기 ({status.count}건)</h2>
          <button
            onClick={() => (appState.driveRetryModalOpen = false)}
            className="text-2xl leading-none px-2"
          >
            ×
          </button>
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          자동 재시도 간격: 1분 → 2분 → 5분 → 10분 → 20분 → 30분 (총 6회). 마지막
          시도까지 실패하면 X로 표시되고, [재시도] 버튼으로 다시 큐에 넣거나 [포기]로
          제거할 수 있어요.
        </div>
        {status.entries.length === 0 ? (
          <div className="text-sm text-gray-500">대기 항목이 없어요.</div>
        ) : (
          status.entries.map((e) => <DriveRetryRow key={e.localPath} entry={e} maxAttempts={status.maxAttempts} />)
        )}
        {status.pendingCount > 0 && (
          <div className="mt-4 flex justify-end">
            <button
              onClick={() => appState.driveRetryNowAndRefresh()}
              className="px-3 py-2 text-sm bg-green-600 hover:bg-green-700 text-white rounded"
            >
              지금 모두 재시도 ({status.pendingCount})
            </button>
          </div>
        )}
      </div>
    </div>
  );
});

interface RowProps {
  entry: DriveRetryEntry;
  maxAttempts: number;
}

const DriveRetryRow = ({ entry, maxAttempts }: RowProps) => {
  const failed = entry.status === 'failed';
  return (
    <div className="border-b border-gray-200 dark:border-slate-700 py-2 flex items-center gap-2">
      <div className="flex-shrink-0">
        {failed ? (
          <FaExclamationTriangle className="text-red-500" />
        ) : (
          <FaCloudUploadAlt className="text-amber-500" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm truncate font-medium">{entry.fileName}</div>
        <div className="text-xs text-gray-500 dark:text-gray-400">
          {failed
            ? `포기됨 (${entry.attempts}/${maxAttempts}회 시도)`
            : `다음 재시도: ${formatRelative(entry.nextRetryAt)} (${entry.attempts}/${maxAttempts}회)`}
        </div>
        {entry.lastError && (
          <div className="text-xs text-red-500 truncate">{entry.lastError}</div>
        )}
      </div>
      <div className="flex gap-1 flex-shrink-0">
        {failed && (
          <button
            onClick={() => appState.driveRetryResetAndRefresh(entry.localPath)}
            className="px-2 py-1 text-xs bg-blue-500 hover:bg-blue-600 text-white rounded"
          >
            재시도
          </button>
        )}
        <button
          onClick={() => appState.driveRetryDismissAndRefresh(entry.localPath)}
          className="px-2 py-1 text-xs bg-gray-500 hover:bg-gray-600 text-white rounded"
        >
          포기
        </button>
      </div>
    </div>
  );
};

export default DriveRetryWidget;
