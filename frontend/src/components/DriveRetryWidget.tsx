import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { FaCloudUploadAlt, FaTimes, FaExclamationTriangle, FaFileArchive } from 'react-icons/fa';
import { appState } from '../models/AppService';
import { backend } from '../models';
import { DriveRetryEntry } from '../backend';
import ModalOverlayCountMarker from './ModalOverlayCountMarker';

const formatRelative = (ts: number | null): string => {
  if (ts == null) return '-';
  const ms = ts - Date.now();
  if (ms <= 0) return '곧';
  const s = Math.ceil(ms / 1000);
  if (s < 60) return s + '초 후';
  const m = Math.ceil(s / 60);
  return m + '분 후';
};

const PHASE_LABEL: Record<string, string> = {
  queued: '대기 중',
  resize: '이미지 크기 조정',
  zip: 'zip 생성',
};

const DriveRetryWidget = observer(() => {
  const status = appState.driveRetryStatus;
  const exportJobs = appState.exportPipelineJobs;
  const driveCount = status?.count || 0;
  const exportCount = exportJobs.length;
  if (driveCount === 0 && exportCount === 0) return null;
  const allFailed =
    exportCount === 0 &&
    status != null &&
    status.pendingCount === 0 &&
    status.failedCount > 0;
  const totalCount = driveCount + exportCount;
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
          업로드 {allFailed ? '실패' : '진행'} {totalCount}건
        </span>
      </button>
      {appState.driveRetryModalOpen && <DriveRetryModal />}
    </>
  );
});

const DriveRetryModal = observer(() => {
  const status = appState.driveRetryStatus;
  const exportJobs = appState.exportPipelineJobs;
  const driveCount = status?.count || 0;
  const exportCount = exportJobs.length;
  const [retrying, setRetrying] = useState(false);
  // 개별 [재시도] 버튼 click 시 그 localPath만 시각화 추적. row pulse + spinner.
  // 모두 재시도(retrying)와 독립 — 동시 진행 가능하지만 server processDriveRetryQueue
  // 가드(driveRetryProcessing)에서 한쪽이 skip 처리됨.
  const [retryingPaths, setRetryingPaths] = useState<Set<string>>(new Set());
  const onRetryAll = async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      await appState.driveRetryNowAndRefresh();
    } finally {
      setRetrying(false);
    }
  };
  const onRetryOne = async (localPath: string, fileName: string) => {
    if (retryingPaths.has(localPath)) return;
    setRetryingPaths((prev) => new Set(prev).add(localPath));
    try {
      await appState.driveRetryOneAndRefresh(localPath, fileName);
    } finally {
      setRetryingPaths((prev) => {
        const next = new Set(prev);
        next.delete(localPath);
        return next;
      });
    }
  };
  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ zIndex: 5500, backgroundColor: 'rgba(0,0,0,0.8)' }}
      onClick={() => (appState.driveRetryModalOpen = false)}
    >
      <ModalOverlayCountMarker />
      <div
        className="bg-white dark:bg-slate-800 text-black dark:text-white rounded-md shadow-xl p-4 max-w-2xl w-[90vw] max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-2">
          <h2 className="text-lg font-bold">업로드 진행 ({driveCount + exportCount}건)</h2>
          <button
            onClick={() => (appState.driveRetryModalOpen = false)}
            className="text-2xl leading-none px-2"
          >
            ×
          </button>
        </div>
        {retrying && (
          <div className="mb-2 px-3 py-2 rounded bg-amber-100 dark:bg-amber-900/40 border border-amber-300 dark:border-amber-700 flex items-center gap-2 text-sm text-amber-800 dark:text-amber-200">
            <Spinner className="border-amber-600 dark:border-amber-300" />
            <span>재시도 처리 중 — rclone 호출 응답 대기 (최대 30초/항목)</span>
          </div>
        )}
        {exportCount > 0 && (
          <>
            <div className="text-xs text-gray-500 dark:text-gray-400 mb-2 uppercase tracking-wide">
              내보내기 처리 중 (서버)
            </div>
            {exportJobs.map((j) => <ExportPipelineRow key={j.jobId} job={j} />)}
            <div className="h-3" />
          </>
        )}
        <div className="text-xs text-gray-500 dark:text-gray-400 mb-2 uppercase tracking-wide">
          Drive 업로드
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          자동 재시도 간격: 1분 → 2분 → 5분 → 10분 → 20분 → 30분 (총 6회). 마지막
          시도까지 실패하면 X로 표시되고, [재시도]로 즉시 다시 시도하거나 [포기]로
          제거할 수 있어요. 자동 재시도 대기 중인 항목도 [재시도]로 일정 무시하고 즉시 시도 가능해요.
        </div>
        {!status || status.entries.length === 0 ? (
          <div className="text-sm text-gray-500">Drive 대기 항목이 없어요.</div>
        ) : (
          status.entries.map((e) => (
            <DriveRetryRow
              key={e.localPath}
              entry={e}
              maxAttempts={status.maxAttempts}
              retrying={retrying}
              retryingThis={retryingPaths.has(e.localPath)}
              onRetryOne={() => onRetryOne(e.localPath, e.fileName)}
            />
          ))
        )}
        {status && status.pendingCount > 0 && (
          <div className="mt-4 flex justify-end">
            <button
              onClick={onRetryAll}
              disabled={retrying}
              className="px-3 py-2 text-sm bg-green-600 hover:bg-green-700 disabled:bg-green-700 disabled:opacity-70 disabled:cursor-wait text-white rounded flex items-center gap-2"
            >
              {retrying ? (
                <>
                  <Spinner className="border-white" />
                  <span>재시도 중...</span>
                </>
              ) : (
                <span>지금 모두 재시도 ({status.pendingCount})</span>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
});

const Spinner = ({ className = '' }: { className?: string }) => (
  <span
    className={
      'inline-block w-3 h-3 border-2 border-t-transparent rounded-full animate-spin ' + className
    }
    aria-hidden
  />
);

interface ExportRowProps {
  job: {
    jobId: string;
    phase: 'queued' | 'resize' | 'zip';
    done: number;
    total: number;
    outFileName: string;
  };
}

const ExportPipelineRow = ({ job }: ExportRowProps) => {
  const label = PHASE_LABEL[job.phase] || job.phase;
  const pct = job.total > 0 ? Math.round((job.done / job.total) * 100) : 0;
  const cancel = async () => {
    try {
      await backend.cancelExportScenePack(job.jobId);
    } catch (e: any) {
      appState.pushMessage('취소 요청 실패: ' + (e?.message || e));
    }
  };
  return (
    <div className="border-b border-gray-200 dark:border-slate-700 py-2 flex items-center gap-2">
      <div className="flex-shrink-0">
        <FaFileArchive className="text-sky-500" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm truncate font-medium">{job.outFileName}</div>
        <div className="text-xs text-gray-500 dark:text-gray-400">
          {label} {job.total > 0 ? `(${job.done}/${job.total})` : ''}
        </div>
        <div className="relative h-1.5 mt-1 bg-gray-200 dark:bg-slate-700 rounded overflow-hidden">
          <div
            className="absolute top-0 left-0 h-full bg-sky-500 dark:bg-indigo-400"
            style={{ width: pct + '%' }}
          ></div>
        </div>
      </div>
      <button
        onClick={cancel}
        className="px-2 py-1 text-xs bg-red-500 hover:bg-red-600 text-white rounded flex-shrink-0"
      >
        취소
      </button>
    </div>
  );
};

interface RowProps {
  entry: DriveRetryEntry;
  maxAttempts: number;
  retrying?: boolean;
  retryingThis?: boolean;
  onRetryOne: () => void;
}

const DriveRetryRow = ({ entry, maxAttempts, retrying, retryingThis, onRetryOne }: RowProps) => {
  const failed = entry.status === 'failed';
  // active: (a) 모두 재시도 진행 중인데 본 entry는 failed가 아니라 처리 대상이거나
  //         (b) 본 row의 [재시도] 버튼 누른 상태(retryingThis). 둘 다 펄스로 강조.
  const active = (!!retrying && !failed) || !!retryingThis;
  // 버튼 disable: 모두 재시도 진행 중이거나 본 row 진행 중일 때만. 둘 다 server-side
  // driveRetryProcessing 가드와 일관 — 동시 클릭해도 안전하지만 UX상 중복 트리거 차단.
  const buttonsDisabled = !!retrying || !!retryingThis;
  return (
    <div
      className={
        'border-b border-gray-200 dark:border-slate-700 py-2 flex items-center gap-2 ' +
        (active ? 'animate-pulse' : '')
      }
    >
      <div className="flex-shrink-0">
        {failed && !retryingThis ? (
          <FaExclamationTriangle className="text-red-500" />
        ) : active ? (
          <Spinner className="border-amber-500" />
        ) : (
          <FaCloudUploadAlt className="text-amber-500" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm truncate font-medium">{entry.fileName}</div>
        <div className="text-xs text-gray-500 dark:text-gray-400">
          {retryingThis
            ? '재시도 중 — rclone 호출 응답 대기'
            : failed
            ? `포기됨 (${entry.attempts}/${maxAttempts}회 시도)`
            : `다음 재시도: ${formatRelative(entry.nextRetryAt)} (${entry.attempts}/${maxAttempts}회)`}
        </div>
        {entry.lastError && !retryingThis && (
          <div className="text-xs text-red-500 truncate">{entry.lastError}</div>
        )}
      </div>
      <div className="flex gap-1 flex-shrink-0">
        <button
          onClick={onRetryOne}
          disabled={buttonsDisabled}
          className="px-2 py-1 text-xs bg-blue-500 hover:bg-blue-600 disabled:bg-blue-700 disabled:opacity-60 disabled:cursor-wait text-white rounded"
        >
          {retryingThis ? '재시도 중...' : '재시도'}
        </button>
        <button
          onClick={() => appState.driveRetryDismissAndRefresh(entry.localPath)}
          disabled={buttonsDisabled}
          className="px-2 py-1 text-xs bg-gray-500 hover:bg-gray-600 disabled:bg-gray-700 disabled:opacity-60 text-white rounded"
        >
          포기
        </button>
      </div>
    </div>
  );
};

export default DriveRetryWidget;
