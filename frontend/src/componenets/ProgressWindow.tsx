export interface ProgressDialog {
  id: string;
  text: string;
  done: number;
  total: number;
  status?: 'active' | 'success' | 'error';
}

interface Props {
  dialogs: ProgressDialog[];
  messagesCount?: number;
}

const barColor = (status?: string) => {
  if (status === 'success') return 'bg-green-500';
  if (status === 'error') return 'bg-red-500';
  return 'bg-sky-500 dark:bg-indigo-400';
};

const ProgressWindow = ({ dialogs, messagesCount = 0 }: Props) => {
  if (dialogs.length === 0) return null;
  const topPx = 8 + messagesCount * 40;
  return (
    <div
      className="fixed top-0 left-0 right-0 flex justify-center gap-2 pointer-events-none px-2"
      style={{ zIndex: 5000, marginTop: topPx + 'px' }}
    >
      {dialogs.map((d) => {
        const finished = d.status === 'success' || d.status === 'error';
        const pct = finished ? 100 : d.total > 0 ? (d.done / d.total) * 100 : 0;
        return (
          <div
            key={d.id}
            className="px-3 py-2 rounded-md shadow-lg bg-white dark:bg-slate-800 text-black dark:text-white flex items-center gap-2 flex-1 min-w-0 pointer-events-auto"
          >
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
          </div>
        );
      })}
    </div>
  );
};

export default ProgressWindow;
