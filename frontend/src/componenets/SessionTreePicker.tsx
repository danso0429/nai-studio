import * as React from 'react';
import { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import {
  FaFolderPlus, FaFolder, FaFolderOpen, FaTimes,
  FaEllipsisV, FaChevronRight, FaChevronDown,
  FaUpload, FaDownload, FaArchive, FaBookmark,
} from 'react-icons/fa';
import { sessionService } from '../models';
import { appState } from '../models/AppService';
import { josaRo } from '../models/util';

interface Props {
  selectedName?: string;
  onSelect: (name: string) => void;
}

const SessionTreePicker = observer(({ selectedName, onSelect }: Props) => {
  const [open, setOpen] = useState(false);
  const [, setVersion] = useState(0); // listupdated 강제 rerender
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  useEffect(() => {
    const onUpdate = () => setVersion(v => v + 1);
    sessionService.addEventListener('listupdated', onUpdate);
    return () => sessionService.removeEventListener('listupdated', onUpdate);
  }, []);

  // 현재 선택된 프로젝트의 폴더 자동 펼침
  useEffect(() => {
    if (!selectedName) return;
    const folder = sessionService.getFolderOf(selectedName);
    if (folder) {
      setExpandedFolders(prev => {
        if (prev.has(folder)) return prev;
        const next = new Set(prev);
        next.add(folder);
        return next;
      });
    }
  }, [selectedName]);

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
  const sortFn = (a: string, b: string) => {
    const af = sessionService.isFavorite(a);
    const bf = sessionService.isFavorite(b);
    if (af !== bf) return af ? -1 : 1;
    return a.localeCompare(b);
  };
  rootProjects.sort(sortFn);
  for (const arr of folderToProjects.values()) arr.sort(sortFn);
  const sortedFolders = [...folderList].sort((a, b) => a.localeCompare(b));

  const toggleFolder = (folder: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(folder)) next.delete(folder);
      else next.add(folder);
      return next;
    });
  };

  const selectProject = (name: string) => {
    onSelect(name);
    setOpen(false);
  };

  const handleNewFolder = async () => {
    const value = await appState.pushDialogAsync({
      type: 'input-confirm',
      text: '새 폴더 이름을 입력해주세요',
    });
    if (!value) return;
    try {
      await sessionService.createFolder(value);
      setExpandedFolders(prev => {
        const next = new Set(prev);
        next.add(value);
        return next;
      });
    } catch (e: any) {
      appState.pushMessage(e.message || '폴더 생성에 실패했습니다.');
    }
  };

  const handleFolderMenu = async (folder: string) => {
    const action = await appState.pushDialogAsync({
      type: 'select',
      text: `폴더 "${folder}" 작업`,
      items: [
        { text: '이름 변경', value: 'rename' },
        { text: '삭제 (안의 프로젝트는 휴지통으로)', value: 'delete' },
      ],
    });
    if (action === 'rename') {
      const newName = await appState.pushDialogAsync({
        type: 'input-confirm',
        text: '새 폴더 이름',
      });
      if (!newName) return;
      try {
        await sessionService.renameFolder(folder, newName);
        setExpandedFolders(prev => {
          const next = new Set(prev);
          if (next.has(folder)) {
            next.delete(folder);
            next.add(newName);
          }
          return next;
        });
      } catch (e: any) {
        appState.pushMessage(e.message || '리네임 실패');
      }
    } else if (action === 'delete') {
      const projectsInFolder = folderToProjects.get(folder) || [];
      const msg = projectsInFolder.length > 0
        ? `폴더 "${folder}" 삭제 — 안의 프로젝트 ${projectsInFolder.length}개는 휴지통으로 이동돼요. 계속할까요?`
        : `빈 폴더 "${folder}"를 삭제할까요?`;
      appState.pushDialog({
        type: 'confirm',
        text: msg,
        callback: async () => {
          try {
            await sessionService.deleteFolder(folder);
          } catch (e: any) {
            appState.pushMessage(e.message || '폴더 삭제 실패');
          }
        },
      });
    }
  };

  const handleProjectMenu = async (name: string) => {
    const currentFolder = sessionService.getFolderOf(name);
    const items: { text: string; value: string }[] = [];
    if (currentFolder !== null) items.push({ text: '루트로 이동', value: '__root__' });
    for (const f of sortedFolders) {
      if (f !== currentFolder) items.push({ text: '📁 ' + f + josaRo(f) + ' 이동', value: f });
    }
    items.push({ text: '🗑️ 프로젝트 영구 삭제', value: '__delete__' });
    const target = await appState.pushDialogAsync({
      type: 'select',
      text: `"${name}" 설정`,
      items,
    });
    if (!target) return;
    if (target === '__delete__') {
      setOpen(false);
      appState.deleteProjectBackground(name);
      return;
    }
    try {
      await sessionService.moveToFolder(name, target === '__root__' ? null : target);
    } catch (e: any) {
      appState.pushMessage(e.message || '이동 실패');
    }
  };

  const displayName = selectedName || '프로젝트 선택';
  const displayFolder = selectedName ? sessionService.getFolderOf(selectedName) : null;
  const displayFav = selectedName ? sessionService.isFavorite(selectedName) : false;

  return (
    <>
      <button
        type="button"
        className="w-full px-3 py-2 rounded-md text-left bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 truncate"
        onClick={() => setOpen(true)}
      >
        {displayFav && <FaBookmark size={12} style={{ color: '#facc15', display: 'inline', marginRight: 4 }} />}
        {displayFolder && (
          <span className="text-amber-600 dark:text-amber-400">
            <FaFolder className="inline mr-1" size={12} />
            {displayFolder} /{' '}
          </span>
        )}
        {displayName}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-lg w-full max-w-md max-h-[80vh] m-4 flex flex-col overflow-hidden border border-gray-300 dark:border-gray-600"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-700">
              <span className="font-bold">프로젝트 선택</span>
              <button
                type="button"
                className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
                onClick={() => setOpen(false)}
                aria-label="닫기"
              >
                <FaTimes />
              </button>
            </div>
            {/* 액션 행 — 항상 4열 1줄. 짧은 라벨 + 아이콘. tooltip(title)에 전체 설명. */}
            <div className="grid grid-cols-4 gap-1 px-3 py-2 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40">
              <button
                type="button"
                className="px-1 py-1.5 text-xs rounded bg-green-100 dark:bg-green-900 hover:bg-green-200 dark:hover:bg-green-800 flex items-center justify-center gap-1 min-w-0"
                onClick={() => { setOpen(false); appState.projectImport(); }}
                title="프로젝트 불러오기 (.json만)"
              >
                <FaUpload size={11} className="flex-shrink-0" />
                <span className="truncate">불러오기</span>
              </button>
              <button
                type="button"
                className="px-1 py-1.5 text-xs rounded bg-sky-100 dark:bg-sky-900 hover:bg-sky-200 dark:hover:bg-sky-800 flex items-center justify-center gap-1 min-w-0"
                onClick={() => { setOpen(false); appState.projectExportShallow(); }}
                title="프로젝트 파일 내보내기 (이미지 미포함)"
              >
                <FaDownload size={11} className="flex-shrink-0" />
                <span className="truncate">파일</span>
              </button>
              <button
                type="button"
                className="px-1 py-1.5 text-xs rounded bg-indigo-100 dark:bg-indigo-900 hover:bg-indigo-200 dark:hover:bg-indigo-800 flex items-center justify-center gap-1 min-w-0"
                onClick={() => { setOpen(false); appState.projectExportDeep(); }}
                title="프로젝트 백업 내보내기 (이미지 포함)"
              >
                <FaArchive size={11} className="flex-shrink-0" />
                <span className="truncate">백업</span>
              </button>
              <button
                type="button"
                className="px-1 py-1.5 text-xs rounded bg-blue-100 dark:bg-blue-900 hover:bg-blue-200 dark:hover:bg-blue-800 flex items-center justify-center gap-1 min-w-0"
                onClick={handleNewFolder}
                title="새 폴더"
              >
                <FaFolderPlus size={11} className="flex-shrink-0" />
                <span className="truncate">폴더</span>
              </button>
            </div>

            <div className="overflow-y-auto flex-1">
              {rootProjects.map(name => (
                <ProjectRow
                  key={'root:' + name}
                  name={name}
                  isSelected={selectedName === name}
                  onSelect={() => selectProject(name)}
                  onMenu={() => handleProjectMenu(name)}
                />
              ))}

              {sortedFolders.map(folder => {
                const isExpanded = expandedFolders.has(folder);
                const projsInFolder = folderToProjects.get(folder) || [];
                return (
                  <div key={'folder:' + folder} className="border-t border-gray-100 dark:border-gray-700">
                    <div className="flex items-center px-2 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-700">
                      <button
                        type="button"
                        className="flex items-center flex-1 text-left gap-1 min-w-0"
                        onClick={() => toggleFolder(folder)}
                      >
                        {isExpanded ? <FaChevronDown size={10} /> : <FaChevronRight size={10} />}
                        {isExpanded ? <FaFolderOpen className="text-amber-500" /> : <FaFolder className="text-amber-500" />}
                        <span className="ml-1 font-medium truncate">{folder}</span>
                        <span className="text-xs text-gray-500 ml-1 flex-shrink-0">({projsInFolder.length})</span>
                      </button>
                      <button
                        type="button"
                        className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
                        onClick={() => handleFolderMenu(folder)}
                        aria-label="폴더 메뉴"
                      >
                        <FaEllipsisV />
                      </button>
                    </div>
                    {isExpanded && projsInFolder.map(name => (
                      <ProjectRow
                        key={'folder:' + folder + ':' + name}
                        name={name}
                        isSelected={selectedName === name}
                        indent
                        onSelect={() => selectProject(name)}
                        onMenu={() => handleProjectMenu(name)}
                      />
                    ))}
                    {isExpanded && projsInFolder.length === 0 && (
                      <div className="pl-10 py-1 text-xs text-gray-500 italic">(비어있음)</div>
                    )}
                  </div>
                );
              })}

              {rootProjects.length === 0 && sortedFolders.length === 0 && (
                <div className="text-center text-gray-500 py-8">프로젝트가 없습니다.</div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
});

interface ProjectRowProps {
  name: string;
  isSelected: boolean;
  indent?: boolean;
  onSelect: () => void;
  onMenu: () => void;
}

const ProjectRow = observer(({ name, isSelected, indent, onSelect, onMenu }: ProjectRowProps) => {
  const fav = sessionService.isFavorite(name);
  return (
    <div
      className={`flex items-center px-2 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 ${
        indent ? 'pl-10' : ''
      } ${isSelected ? 'bg-blue-50 dark:bg-blue-900/40' : ''}`}
    >
      <button
        type="button"
        className="flex-1 text-left flex items-center gap-1 min-w-0"
        onClick={onSelect}
      >
        {fav && <FaBookmark size={12} style={{ color: '#facc15', flexShrink: 0 }} />}
        <span className="truncate">{name}</span>
      </button>
      <button
        type="button"
        className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-600 flex-shrink-0"
        onClick={onMenu}
        aria-label="프로젝트 메뉴"
      >
        <FaEllipsisV />
      </button>
    </div>
  );
});

export default SessionTreePicker;
