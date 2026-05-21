import { useState, useMemo } from 'react';
import { observer } from 'mobx-react-lite';
import {
  FaFolder,
  FaFolderOpen,
  FaTimes,
  FaChevronRight,
  FaChevronDown,
  FaUpload,
  FaBookmark,
} from 'react-icons/fa';
import { sessionService } from '../models';
import { appState } from '../models/AppService';

interface Props {
  onClose: () => void;
}

// 폴더 체크박스 3-state: 'all' = 폴더 내 전부 선택, 'some' = 일부, 'none' = 미선택.
type FolderState = 'all' | 'some' | 'none';

const ProjectExportPickerDialog = observer(({ onClose }: Props) => {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  // 트리 구조 — SessionTreePicker와 같은 sort/folder 분류 로직 (한글/숫자 자연 정렬).
  const tree = useMemo(() => {
    const naturalCmp = (a: string, b: string) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
    const sortFn = (a: string, b: string) => {
      const af = sessionService.isFavorite(a);
      const bf = sessionService.isFavorite(b);
      if (af !== bf) return af ? -1 : 1;
      return naturalCmp(a, b);
    };
    const sessionNames = sessionService.list();
    const folderList = sessionService.listFolders();
    const rootProjects: string[] = [];
    const folderToProjects: Map<string, string[]> = new Map();
    for (const f of folderList) folderToProjects.set(f, []);
    for (const name of sessionNames) {
      const folder = sessionService.getFolderOf(name);
      if (folder && folderToProjects.has(folder)) {
        folderToProjects.get(folder)!.push(name);
      } else {
        rootProjects.push(name);
      }
    }
    rootProjects.sort(sortFn);
    for (const arr of folderToProjects.values()) arr.sort(sortFn);
    const sortedFolders = [...folderList].sort(naturalCmp);
    return { rootProjects, folderToProjects, sortedFolders };
  }, []);

  const toggleProject = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const folderState = (folder: string): FolderState => {
    const projs = tree.folderToProjects.get(folder) || [];
    if (projs.length === 0) return 'none';
    let count = 0;
    for (const p of projs) if (selected.has(p)) count++;
    if (count === 0) return 'none';
    if (count === projs.length) return 'all';
    return 'some';
  };

  const toggleFolderCheckbox = (folder: string) => {
    const projs = tree.folderToProjects.get(folder) || [];
    const state = folderState(folder);
    setSelected((prev) => {
      const next = new Set(prev);
      if (state === 'all') {
        for (const p of projs) next.delete(p);
      } else {
        // 'some' 또는 'none' → 폴더 내 전부 선택
        for (const p of projs) next.add(p);
      }
      return next;
    });
  };

  const toggleFolderExpand = (folder: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folder)) next.delete(folder);
      else next.add(folder);
      return next;
    });
  };

  const handleExport = () => {
    if (selected.size === 0) return;
    const names = Array.from(selected);
    // picker 즉시 닫고 백그라운드 실행 — 진행 상황은 메인 UI의 progress dialog가 추적.
    // 토스트도 projectExportMulti 내부에서 발사.
    onClose();
    appState.projectExportMulti(names).catch((e: any) => {
      appState.pushMessage('내보내기 실패: ' + (e?.message || e));
    });
  };

  const totalProjects =
    tree.rootProjects.length +
    Array.from(tree.folderToProjects.values()).reduce((s, a) => s + a.length, 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-800 text-default rounded-lg w-full max-w-md max-h-[80vh] m-4 flex flex-col overflow-hidden border border-gray-300 dark:border-gray-600"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-700">
          <span className="font-bold">
            프로젝트 내보내기 — {selected.size}개 선택
          </span>
          <button
            type="button"
            className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
            onClick={onClose}
            aria-label="닫기"
          >
            <FaTimes />
          </button>
        </div>

        {/* 상단 내보내기 액션 */}
        <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40">
          <button
            type="button"
            className="w-full px-3 py-2 text-sm rounded bg-sky-500 hover:bg-sky-600 disabled:bg-sky-700 disabled:opacity-70 text-white flex items-center justify-center gap-2"
            onClick={handleExport}
            disabled={selected.size === 0}
          >
            <FaUpload size={11} />
            <span>
              {selected.size === 0
                ? '내보낼 프로젝트 선택'
                : `내보내기 (${selected.size}개) — 백그라운드`}
            </span>
          </button>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 text-center">
            클릭 즉시 picker 닫힘. 진행은 메인 화면 progress dialog로 추적.
          </p>
        </div>

        {/* 트리 */}
        <div className="overflow-y-auto flex-1">
          {tree.rootProjects.map((name) => (
            <ExportProjectRow
              key={'root:' + name}
              name={name}
              isSelected={selected.has(name)}
              onToggle={() => toggleProject(name)}
            />
          ))}

          {tree.sortedFolders.map((folder) => {
            const isExpanded = expandedFolders.has(folder);
            const projsInFolder = tree.folderToProjects.get(folder) || [];
            const state = folderState(folder);
            return (
              <div
                key={'folder:' + folder}
                className="border-t border-gray-100 dark:border-gray-700"
              >
                <div className="flex items-center px-2 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-700">
                  <button
                    type="button"
                    className="flex items-center flex-1 text-left gap-1 min-w-0"
                    onClick={() => toggleFolderExpand(folder)}
                  >
                    {isExpanded ? <FaChevronDown size={10} /> : <FaChevronRight size={10} />}
                    {isExpanded ? (
                      <FaFolderOpen className="text-amber-500" />
                    ) : (
                      <FaFolder className="text-amber-500" />
                    )}
                    <span className="ml-1 font-medium truncate">{folder}</span>
                    <span className="text-xs text-gray-500 ml-1 flex-shrink-0">
                      ({projsInFolder.length})
                    </span>
                  </button>
                  {/* 폴더 체크박스 — 폴더 내 전체 선택/해제 + indeterminate 상태 */}
                  <label
                    className="flex items-center gap-1 px-2 cursor-pointer select-none flex-shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      className="w-4 h-4 cursor-pointer accent-blue-500"
                      checked={state === 'all'}
                      ref={(el) => {
                        if (el) el.indeterminate = state === 'some';
                      }}
                      onChange={() => toggleFolderCheckbox(folder)}
                      disabled={projsInFolder.length === 0}
                    />
                  </label>
                </div>
                {isExpanded &&
                  projsInFolder.map((name) => (
                    <ExportProjectRow
                      key={'folder:' + folder + ':' + name}
                      name={name}
                      isSelected={selected.has(name)}
                      indent
                      onToggle={() => toggleProject(name)}
                    />
                  ))}
                {isExpanded && projsInFolder.length === 0 && (
                  <div className="pl-10 py-1 text-xs text-gray-500 italic">
                    (비어있음)
                  </div>
                )}
              </div>
            );
          })}

          {totalProjects === 0 && (
            <div className="text-center text-gray-500 py-8">
              내보낼 프로젝트가 없습니다.
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

interface ExportProjectRowProps {
  name: string;
  isSelected: boolean;
  indent?: boolean;
  onToggle: () => void;
}

const ExportProjectRow = observer(
  ({ name, isSelected, indent, onToggle }: ExportProjectRowProps) => {
    const fav = sessionService.isFavorite(name);
    return (
      <button
        type="button"
        onClick={onToggle}
        className={
          'w-full flex items-center px-2 py-1.5 text-left ' +
          (indent ? 'pl-10 ' : '') +
          (isSelected
            ? 'bg-blue-100 dark:bg-blue-900/60 hover:bg-blue-200 dark:hover:bg-blue-900/80 '
            : 'hover:bg-gray-100 dark:hover:bg-gray-700 ')
        }
      >
        {fav && (
          <FaBookmark
            size={12}
            style={{ color: '#facc15', flexShrink: 0, marginRight: 4 }}
          />
        )}
        <span className="flex-1 truncate">{name}</span>
        {isSelected && (
          <span
            className="text-blue-600 dark:text-blue-300 text-xs ml-2 flex-shrink-0"
            aria-label="선택됨"
          >
            ✓ 선택됨
          </span>
        )}
      </button>
    );
  },
);

export default ProjectExportPickerDialog;
