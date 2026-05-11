import { useEffect, useState, useRef } from 'react';

interface QueueJob {
  jobId: string;
  outputFilePath?: string;
}

interface QueueState {
  pending: number;
  processing: boolean;
  paused: boolean;
  completed: number;
  failed: number;
  jobs?: QueueJob[];
}

const API = `${location.protocol}//${location.host}${import.meta.env.BASE_URL.replace(/\/$/, '')}/api`;

// outputFilePath에서 표시용 라벨 추출
// 예: "outs/프로젝트/씬이름/파일.png" → "씬이름"
//     "outs/프로젝트/파일.png" → "프로젝트"
//     기타 → 파일명
function extractSceneLabel(outputFilePath?: string): string {
  if (!outputFilePath) return '';
  const parts = outputFilePath.split('/').filter(Boolean);
  if (parts.length >= 3) return parts[parts.length - 2];
  if (parts.length >= 2) return parts[0];
  return parts[0] || '';
}

const ServerQueueStatus = () => {
  const [queue, setQueue] = useState<QueueState | null>(null);
  const [visible, setVisible] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = async () => {
    try {
      const r = await fetch(`${API}/queue/status`);
      const data: QueueState = await r.json();
      setQueue(data);
      const isActive = data.processing || data.pending > 0;
      if (isActive) {
        setVisible(true);
        if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; }
      } else if (data.completed > 0 || data.failed > 0) {
        setVisible(true);
        if (!hideTimer.current) {
          hideTimer.current = setTimeout(() => { setVisible(false); hideTimer.current = null; }, 8000);
        }
      }
      return isActive;
    } catch { return false; }
  };

  useEffect(() => {
    fetchStatus();
    intervalRef.current = setInterval(fetchStatus, 3000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  if (!visible || !queue) return null;

  const total = queue.completed + queue.failed + queue.pending + (queue.processing ? 1 : 0);
  const done = queue.completed + queue.failed;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const isActive = queue.processing || queue.pending > 0;
  const isDone = !isActive && done > 0;

  // 처리 중인 job = jobs[0] (server.js의 genQueue[0])
  const currentScene = isActive && queue.jobs && queue.jobs.length > 0
    ? extractSceneLabel(queue.jobs[0].outputFilePath)
    : '';

  return (
    <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium select-none transition-opacity duration-300 min-w-0 max-w-full ${
      isDone
        ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
        : queue.paused
          ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300'
          : 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
    }`}>
      {isActive && (
        <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
        </svg>
      )}
      {isDone && <span>✓</span>}
      {queue.paused && <span>⏸</span>}
      <span className="truncate max-w-[120px] md:max-w-[200px]">
        {isActive
          ? (currentScene ? `서버: ${done}/${total} · ${currentScene}` : `서버: ${done}/${total}`)
          : isDone
            ? `${done}장 완료`
            : ''}
      </span>
      {queue.failed > 0 && (
        <span className="text-red-500 dark:text-red-400">({queue.failed}실패)</span>
      )}
      {isActive && (
        <div className="w-12 h-1.5 bg-black/10 dark:bg-white/10 rounded-full overflow-hidden">
          <div
            className="h-full bg-current rounded-full transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
};

export default ServerQueueStatus;
