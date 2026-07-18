export interface ProgressDialog {
  id: string;
  text: string;
  done: number;
  total: number;
  status?: 'active' | 'success' | 'error';
  // 정의 시 X 버튼 노출. status === 'active'일 때만 노출 (finish 후 자동 숨김).
  // 호출측이 cancel signal 직접 처리해야 함 (setTimeout/loop guard 등).
  onCancel?: () => void;
}

interface Props {
  dialogs: ProgressDialog[];
  messagesCount?: number;
  // pinned: true면 일반 progressDialogs row 아래에 별도 row로 렌더. 가로 flex-1
  // 균등 분할을 끄고 고정 너비를 사용해 다른 toast와 자리 다툼 없음.
  pinned?: boolean;
  // 위쪽 추가 offset px (pinned가 true일 때 일반 progressDialogs 줄 높이만큼 띄워줌)
  topOffset?: number;
}

const barColor = (status?: string) => {
  if (status === 'success') return 'bg-green-500';
  if (status === 'error') return 'bg-red-500';
  return 'bg-sky-500 dark:bg-indigo-400';
};

const ProgressWindow = ({ dialogs, messagesCount = 0, pinned = false, topOffset = 0 }: Props) => {
  if (dialogs.length === 0) return null;
  const topPx = 8 + messagesCount * 40 + topOffset;
  // pinned는 flex-1 균등분할 X — 고정 폭. 일반은 기존 동작 유지.
  const containerCls = 'fixed top-0 left-0 right-0 flex justify-center gap-2 pointer-events-none px-2';
  const itemCls = pinned
    ? 'px-3 py-2 rounded-md shadow-lg bg-white dark:bg-slate-800 text-black dark:text-white flex items-center gap-2 min-w-0 max-w-full sm:max-w-md w-full sm:w-auto'
    : 'px-3 py-2 rounded-md shadow-lg bg-white dark:bg-slate-800 text-black dark:text-white flex items-center gap-2 flex-1 min-w-0';
  return (
    <div
      className={containerCls}
      style={{ zIndex: 'var(--z-toast)', marginTop: topPx + 'px' }}
    >
      {dialogs.map((d) => {
        const finished = d.status === 'success' || d.status === 'error';
        const pct = finished ? 100 : d.total > 0 ? (d.done / d.total) * 100 : 0;
        return (
          <div key={d.id} className={itemCls + ' pointer-events-auto'}>
            <div className="text-xs sm:text-sm break-keep truncate min-w-0 flex-1">
              {d.text}
            </div>
            {!finished && (
              <div className="text-xs text-gray-500 dark:text-gray-300 whitespace-nowrap">
                {d.done}/{d.total}
              </div>
            )}
            <div className="relative w-16 sm:w-20 h-2 bg-gray-300 dark:bg-slate-700 rounded overflow-hidden flex-shrink-0">
              <div
                className={'absolute top-0 left-0 h-full ' + barColor(d.status)}
                style={{ width: pct.toString() + '%' }}
              ></div>
            </div>
            {!finished && d.onCancel && (
              <button
                className="text-xs px-1.5 py-0.5 rounded text-gray-500 dark:text-gray-300 hover:text-red-500 dark:hover:text-red-400 flex-shrink-0"
                onClick={() => d.onCancel?.()}
                aria-label="취소"
                title="취소"
              >
                ✕
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default ProgressWindow;
