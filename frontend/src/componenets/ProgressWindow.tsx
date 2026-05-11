export interface ProgressDialog {
  text: string;
  done: number;
  total: number;
}

interface Props {
  dialog: ProgressDialog;
}

const ProgressWindow = ({ dialog }: Props) => {
  const pct = dialog.total > 0 ? (dialog.done / dialog.total) * 100 : 0;
  return (
    <div
      className="fixed top-0 left-0 right-0 flex justify-center pointer-events-none"
      style={{ zIndex: 5000 }}
    >
      <div className="mt-2 mx-2 px-4 py-2 rounded-md shadow-lg bg-white dark:bg-slate-800 text-black dark:text-white flex items-center gap-3 max-w-[90vw] pointer-events-auto">
        <div className="text-sm break-keep truncate min-w-0">{dialog.text}</div>
        <div className="text-xs text-gray-500 dark:text-gray-300 whitespace-nowrap">
          {dialog.done}/{dialog.total}
        </div>
        <div className="relative w-24 h-2 bg-gray-300 dark:bg-slate-700 rounded overflow-hidden flex-shrink-0">
          <div
            className="absolute top-0 left-0 h-full bg-sky-500 dark:bg-indigo-400"
            style={{ width: pct.toString() + '%' }}
          ></div>
        </div>
      </div>
    </div>
  );
};

export default ProgressWindow;
