import { useState, type ReactNode } from 'react';
import { observer } from 'mobx-react-lite';
import {
  FaFolder,
  FaStar,
  FaTimes,
  FaChevronRight,
  FaChevronDown,
  FaUpload,
  FaSearch,
  FaCheck,
} from 'react-icons/fa';
import { sessionService } from '../models';
import { appState } from '../models/AppService';
import ModalOverlayCountMarker from './ModalOverlayCountMarker';

interface Props {
  onClose: () => void;
}

// 그룹(폴더/즐겨찾기/미분류) 체크 3-state: 'all' = 전부 선택, 'some' = 일부, 'none' = 미선택.
type GroupState = 'all' | 'some' | 'none';

// ProjectDrawer 폴더 UI와 동일한 색상/정렬 유틸 (모듈 로컬 — 드로어와 1:1 일치).
const DEFAULT_FOLDER_COLOR = '#0ea5e9';
const withAlpha = (hex: string, alpha: string) => hex + alpha;
const naturalCmp = (a: string, b: string) =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

const ProjectExportPickerDialog = observer(({ onClose }: Props) => {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // 즐겨찾기는 기본 펼침(드로어와 동일). 폴더는 기본 접힘.
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(['__favorites__']),
  );
  const [filter, setFilter] = useState('');

  // 트리 — ProjectDrawer와 동일하게 매 렌더 계산(observer라 색상/순서/목록 변경 즉시 반영).
  const sessionNames = sessionService.list();
  const folders = sessionService.getOrderedFolders();
  const isFav = (n: string) => sessionService.isFavorite(n);
  const sortFn = (a: string, b: string) => {
    const af = isFav(a);
    const bf = isFav(b);
    if (af !== bf) return af ? -1 : 1;
    return naturalCmp(a, b);
  };
  const favs = sessionNames.filter(isFav).sort(naturalCmp);
  const folderToProjects = new Map<string, string[]>();
  folders.forEach((f) => folderToProjects.set(f, []));
  const unfiled: string[] = [];
  for (const n of sessionNames) {
    const f = sessionService.getFolderOf(n);
    if (f && folderToProjects.has(f)) folderToProjects.get(f)!.push(n);
    else unfiled.push(n);
  }
  folderToProjects.forEach((arr) => arr.sort(sortFn));
  unfiled.sort(sortFn);

  const searching = filter.trim().length > 0;
  const searchResults = searching
    ? sessionNames
        .filter((n) => n.toLowerCase().includes(filter.toLowerCase()))
        .sort(sortFn)
    : [];
  const totalProjects = sessionNames.length;

  const toggleProject = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const toggleExpand = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // 그룹 전체선택 헬퍼 — 폴더/즐겨찾기/미분류 공통.
  const groupState = (projs: string[]): GroupState => {
    if (projs.length === 0) return 'none';
    let count = 0;
    for (const p of projs) if (selected.has(p)) count++;
    if (count === 0) return 'none';
    if (count === projs.length) return 'all';
    return 'some';
  };
  const toggleGroup = (projs: string[]) => {
    const state = groupState(projs);
    setSelected((prev) => {
      const next = new Set(prev);
      if (state === 'all') projs.forEach((p) => next.delete(p));
      else projs.forEach((p) => next.add(p)); // 'some'/'none' → 전부 선택
      return next;
    });
  };

  const handleExport = () => {
    if (selected.size === 0) return;
    const names = Array.from(selected);
    // picker 즉시 닫고 백그라운드 실행 — 진행은 메인 UI의 progress dialog가 추적.
    onClose();
    appState.projectExportMulti(names).catch((e: any) => {
      appState.pushMessage('내보내기 실패: ' + (e?.message || e));
    });
  };

  // 프로젝트 행 — 드로어 ProjectRow의 selectMode 비주얼 차용(원형 체크 + 선택 시 sky 배경).
  const renderRow = (name: string, showFolder = false) => {
    const sel = selected.has(name);
    const folder = showFolder ? sessionService.getFolderOf(name) : null;
    const folderColor = folder
      ? sessionService.getFolderColor(folder) || DEFAULT_FOLDER_COLOR
      : null;
    return (
      <button
        key={name}
        type="button"
        onClick={() => toggleProject(name)}
        className={`w-full flex items-center gap-2 px-2.5 py-2.5 rounded-md text-[15px] text-left transition-colors ${
          sel
            ? 'bg-sky-500 text-white shadow-sm'
            : 'hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-800 dark:text-gray-100'
        }`}
      >
        <span
          className={`flex-none w-[15px] h-[15px] rounded-full border flex items-center justify-center ${
            sel
              ? 'bg-white border-white text-sky-500'
              : 'border-gray-400 dark:border-slate-400'
          }`}
        >
          {sel && <FaCheck size={9} />}
        </span>
        <span className="truncate flex-1">{name}</span>
        {folder && (
          <span
            className={`text-xs flex-none flex items-center gap-1 ${
              sel ? 'text-sky-100' : 'text-gray-400'
            }`}
          >
            <FaFolder
              size={10}
              style={!sel && folderColor ? { color: folderColor } : undefined}
            />
            <span className="max-w-[80px] truncate">{folder}</span>
          </span>
        )}
      </button>
    );
  };

  // 그룹 헤더(폴더/즐겨찾기/미분류) — 펼침 토글 + 색상 박스 + 라벨 + 카운트 + 전체선택 체크.
  const renderGroupHeader = (
    key: string,
    color: string,
    icon: ReactNode,
    label: string,
    projs: string[],
  ) => {
    const isOpen = expanded.has(key);
    const st = groupState(projs);
    return (
      <div className="flex items-center gap-0.5 pl-1.5 pr-1">
        <button
          type="button"
          onClick={() => toggleExpand(key)}
          className="flex-1 flex items-center gap-2 px-1 py-2.5 text-[15px] font-semibold text-gray-700 dark:text-gray-200 min-w-0"
        >
          {isOpen ? (
            <FaChevronDown size={12} className="flex-none text-gray-400" />
          ) : (
            <FaChevronRight size={12} className="flex-none text-gray-400" />
          )}
          <span
            className="flex items-center justify-center w-7 h-7 rounded-md flex-none"
            style={{ backgroundColor: withAlpha(color, '26') }}
          >
            {icon}
          </span>
          <span className="truncate flex-1 text-left">{label}</span>
          <span className="text-xs text-gray-400 font-normal flex-none">
            {projs.length}
          </span>
        </button>
        <label
          className="flex items-center px-2 py-2 cursor-pointer flex-none"
          onClick={(e) => e.stopPropagation()}
        >
          <input
            type="checkbox"
            className="w-4 h-4 cursor-pointer accent-sky-500"
            checked={st === 'all'}
            ref={(el) => {
              if (el) el.indeterminate = st === 'some';
            }}
            onChange={() => toggleGroup(projs)}
            disabled={projs.length === 0}
          />
        </label>
      </div>
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <ModalOverlayCountMarker />
      <div
        className="bg-white dark:bg-slate-800 text-default rounded-lg w-full max-w-md max-h-[80vh] m-4 flex flex-col overflow-hidden border border-gray-300 dark:border-slate-600"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-slate-600">
          <span className="font-bold">
            프로젝트 내보내기 — {selected.size}개 선택
          </span>
          <button
            type="button"
            className="p-1 rounded hover:bg-gray-100 dark:hover:bg-slate-700"
            onClick={onClose}
            aria-label="닫기"
          >
            <FaTimes />
          </button>
        </div>

        {/* 상단 내보내기 액션 */}
        <div className="px-3 py-2 border-b border-gray-200 dark:border-slate-600 bg-gray-50 dark:bg-slate-900/40 flex-none">
          <button
            type="button"
            className="w-full px-3 py-2 text-sm rounded-lg bg-sky-500 hover:bg-sky-600 disabled:bg-sky-700 disabled:opacity-70 text-white flex items-center justify-center gap-2 transition-colors"
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

        {/* 검색 */}
        <div className="px-3 pt-3 flex-none">
          <div className="relative">
            <FaSearch
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
              size={13}
            />
            <input
              type="text"
              placeholder="프로젝트 검색..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
            />
          </div>
        </div>

        {/* 트리 */}
        <div className="flex-1 overflow-y-auto min-h-0 px-2 py-3">
          {searching ? (
            <div>
              <div className="px-1 py-1 text-xs text-gray-500 dark:text-gray-400">
                검색 결과 ({searchResults.length})
              </div>
              {searchResults.length === 0 ? (
                <div className="text-sm text-gray-400 text-center py-6">
                  결과가 없습니다
                </div>
              ) : (
                searchResults.map((n) => renderRow(n, true))
              )}
            </div>
          ) : (
            <>
              {/* 즐겨찾기 */}
              {favs.length > 0 && (
                <div
                  className="mb-1.5 rounded-md"
                  style={{
                    borderLeft: '3px solid #facc15',
                    backgroundColor: withAlpha('#facc15', '12'),
                  }}
                >
                  {renderGroupHeader(
                    '__favorites__',
                    '#facc15',
                    <FaStar className="text-yellow-400" size={14} />,
                    '즐겨찾기',
                    favs,
                  )}
                  {expanded.has('__favorites__') && (
                    <div className="pl-3 pb-1">
                      {favs.map((n) => renderRow(n, true))}
                    </div>
                  )}
                </div>
              )}

              {/* 폴더들 */}
              {folders.map((f) => {
                const projects = folderToProjects.get(f) || [];
                const isOpen = expanded.has(f);
                const color =
                  sessionService.getFolderColor(f) || DEFAULT_FOLDER_COLOR;
                return (
                  <div
                    key={f}
                    className="mb-1.5 rounded-md"
                    style={{
                      borderLeft: `3px solid ${color}`,
                      backgroundColor: withAlpha(color, '12'),
                    }}
                  >
                    {renderGroupHeader(
                      f,
                      color,
                      <FaFolder size={14} style={{ color }} />,
                      f,
                      projects,
                    )}
                    {isOpen && (
                      <div className="pl-3 pb-1">
                        {projects.length === 0 ? (
                          <div className="text-xs text-gray-400 px-2 py-1.5">
                            비어 있음
                          </div>
                        ) : (
                          projects.map((n) => renderRow(n))
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* 미분류 */}
              {unfiled.length > 0 && (
                <div
                  className="mb-1 rounded-md"
                  style={{
                    borderLeft: '3px solid #94a3b8',
                    backgroundColor: '#94a3b812',
                  }}
                >
                  {renderGroupHeader(
                    '__unfiled__',
                    '#94a3b8',
                    <FaFolder className="text-gray-400" size={14} />,
                    '미분류',
                    unfiled,
                  )}
                  {expanded.has('__unfiled__') && (
                    <div className="pl-3 pb-1">
                      {unfiled.map((n) => renderRow(n))}
                    </div>
                  )}
                </div>
              )}

              {totalProjects === 0 && (
                <div className="text-center text-gray-500 py-8">
                  내보낼 프로젝트가 없습니다.
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
});

export default ProjectExportPickerDialog;
