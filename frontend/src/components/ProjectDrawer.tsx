import React, { useState, useEffect, useCallback, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import {
  FaTimes,
  FaSearch,
  FaFolder,
  FaStar,
  FaPlus,
  FaChevronDown,
  FaChevronRight,
  FaPalette,
  FaFolderPlus,
  FaCheck,
  FaPen,
  FaTrashAlt,
  FaFileExport,
  FaEllipsisV,
  FaDownload,
  FaUpload,
  FaArchive,
  FaSignInAlt,
} from 'react-icons/fa';
import { sessionService, imageService, isMobile } from '../models';
import { MAX_FOLDER_DEPTH } from '../models/ResourceSyncService';
import { appState } from '../models/AppService';
import Tooltip from './Tooltip';
import MobileColorPicker from './MobileColorPicker';
import ModalOverlayCountMarker from './ModalOverlayCountMarker';

// 최근 프로젝트 기록 (localStorage — 업스트림 ProjectBrowser.pushRecentProject 대체).
const pushRecentProject = (name: string) => {
  try {
    const raw = localStorage.getItem('recentProjects');
    let list: string[] = raw ? JSON.parse(raw) : [];
    list = list.filter((n) => n !== name);
    list.unshift(name);
    if (list.length > 12) list.length = 12;
    localStorage.setItem('recentProjects', JSON.stringify(list));
  } catch {}
};

const naturalCmp = (a: string, b: string) =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

// 중첩 폴더 path 헬퍼. 폴더는 'f1/f2/f3' 형태 path. parent=마지막 슬래시 앞(없으면 최상위=null),
// leaf=마지막 단계 이름(트리에서 표시명, 들여쓰기가 계층을 나타내므로 leaf만 보임).
const parentOfFolder = (path: string): string | null => {
  const i = path.lastIndexOf('/');
  return i >= 0 ? path.substring(0, i) : null;
};
const leafOfFolder = (path: string): string => {
  const i = path.lastIndexOf('/');
  return i >= 0 ? path.substring(i + 1) : path;
};
// 폴더 깊이 = path 세그먼트 수(최상위=1). 깊이가 상한이면 하위 폴더를 더 못 만든다.
const folderDepth = (path: string): number => path.split('/').length;
const canAddSubfolder = (path: string): boolean => folderDepth(path) < MAX_FOLDER_DEPTH;

// 폴더 색상 팔레트 (hex). 미지정 폴더는 기본색을 사용한다.
const FOLDER_COLORS = [
  '#64748b', // slate
  '#ef4444', // red
  '#f97316', // orange
  '#f59e0b', // amber
  '#22c55e', // green
  '#14b8a6', // teal
  '#0ea5e9', // sky (기본)
  '#6366f1', // indigo
  '#a855f7', // purple
  '#ec4899', // pink
];
const DEFAULT_FOLDER_COLOR = '#0ea5e9';

// hex 색상에 알파를 붙여 옅은 배경을 만든다.
const withAlpha = (hex: string, alpha: string) => hex + alpha;

// 프로젝트 행. 모듈 레벨 컴포넌트(안정적 정체성)라 드래그 중 리렌더에도 언마운트되지 않는다.
const ProjectRow = observer(
  ({
    name,
    showFolder,
    dndEnabled,
    dragging,
    selectMode,
    selected,
    onSelect,
    onDragStart,
    onDragEnd,
    onMenu,
  }: {
    name: string;
    showFolder?: boolean;
    dndEnabled?: boolean;
    dragging?: boolean;
    selectMode?: boolean;
    selected?: boolean;
    onSelect: () => void;
    onDragStart: (e: React.DragEvent) => void;
    onDragEnd: (e: React.DragEvent) => void;
    onMenu?: () => void;
  }) => {
    const active = appState.curSession?.name === name;
    const isFav = sessionService.isFavorite(name);
    const folder = showFolder ? sessionService.getFolderOf(name) : null;
    const folderColor = folder
      ? sessionService.getFolderColor(folder) || DEFAULT_FOLDER_COLOR
      : null;
    const highlighted = selectMode ? selected : active;
    return (
      <button
        onClick={onSelect}
        draggable={dndEnabled}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        style={dragging ? { opacity: 0.4 } : undefined}
        className={`w-full flex items-center gap-2 px-2.5 py-2.5 rounded-md text-[15px] text-left transition-colors ${
          highlighted
            ? 'bg-sky-500 text-white shadow-sm'
            : 'hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-800 dark:text-gray-100'
        }`}
      >
        {selectMode ? (
          <span
            className={`flex-none w-[15px] h-[15px] rounded-full border flex items-center justify-center ${
              selected
                ? 'bg-white border-white text-sky-500'
                : 'border-gray-400 dark:border-slate-400'
            }`}
          >
            {selected && <FaCheck size={9} />}
          </span>
        ) : (
          <Tooltip content={isFav ? '즐겨찾기 해제' : '즐겨찾기'}>
          <span
            role="button"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              sessionService.toggleFavorite(name);
            }}
            className="flex-none -m-1 p-1 rounded cursor-pointer hover:bg-black/10 dark:hover:bg-white/10"
          >
            <FaStar
              size={13}
              className={`${
                isFav
                  ? 'text-yellow-400'
                  : active
                    ? 'text-sky-100'
                    : 'text-gray-300 dark:text-slate-600'
              }`}
            />
          </span>
          </Tooltip>
        )}
        <span className="truncate flex-1">{name}</span>
        {folder && (
          <span
            className={`text-xs flex-none flex items-center gap-1 ${
              active ? 'text-sky-100' : 'text-gray-400'
            }`}
          >
            <FaFolder
              size={10}
              style={!active && folderColor ? { color: folderColor } : undefined}
            />
            <span className="max-w-[80px] truncate">{folder}</span>
          </span>
        )}
        {!selectMode && onMenu && (
          <Tooltip content="프로젝트 메뉴 (큐 등록·내보내기·이동·삭제)">
          <span
            role="button"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onMenu();
            }}
            className="flex-none -m-1 p-1 rounded cursor-pointer hover:bg-black/10 dark:hover:bg-white/10"
          >
            <FaEllipsisV
              size={13}
              className={active ? 'text-sky-100' : 'text-gray-400'}
            />
          </span>
          </Tooltip>
        )}
      </button>
    );
  },
);

const ProjectDrawer = observer(() => {
  const [filter, setFilter] = useState('');
  const [, setVersion] = useState(0);
  // 즐겨찾기는 기본 펼침('__favorites__' 포함)
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(['__favorites__']),
  );
  const [colorPickerFor, setColorPickerFor] = useState<string | null>(null);
  const [editingFolder, setEditingFolder] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  // 커스텀 컬러 피커 저장 디바운스 타이머 (훅 규칙: 조기 반환 이전에 선언)
  const customColorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 선택 모드(다중 선택 → 폴더 일괄 이동)
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // 선택 모드 목적 — 'move'(폴더 일괄 이동) | 'export'(내보내기). selectMode true일 때만 의미.
  const [selectPurpose, setSelectPurpose] = useState<'move' | 'export'>('move');
  // 드래그&드롭 상태 (PC 전용)
  const [drag, setDrag] = useState<{
    type: 'project' | 'folder';
    name: string;
  } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const open = appState.projectDrawerOpen;
  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    const onUpdate = () => refresh();
    sessionService.addEventListener('listupdated', onUpdate);
    return () => sessionService.removeEventListener('listupdated', onUpdate);
  }, [refresh]);

  // 열릴 때마다 현재 프로젝트의 폴더 자동 펼침 + 검색/색상선택 초기화
  useEffect(() => {
    if (!open) return;
    setFilter('');
    setColorPickerFor(null);
    setSelectMode(false);
    setSelected(new Set());
    setSelectPurpose('move');
    const cur = appState.curSession?.name;
    const folder = cur ? sessionService.getFolderOf(cur) : null;
    if (folder) {
      setExpanded((prev) => {
        const next = new Set(prev);
        // 중첩 폴더: 조상 폴더까지 모두 펼쳐야 트리에서 보임 ('f1/f2/f3' → f1, f1/f2, f1/f2/f3).
        const segs = folder.split('/');
        for (let i = 1; i <= segs.length; i++) next.add(segs.slice(0, i).join('/'));
        return next;
      });
    }
  }, [open]);

  // Esc로 닫기
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (colorPickerFor) {
          setColorPickerFor(null);
          return;
        }
        if (selectMode) {
          setSelectMode(false);
          setSelected(new Set());
          return;
        }
        appState.closeProjectDrawer();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, colorPickerFor, selectMode]);

  const close = () => {
    appState.closeProjectDrawer();
  };

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

  const toggleFolder = (f: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });
  };

  const selectProject = (name: string) => {
    // 선택 로직(sticky 토스트·연타 가드·retry)은 appState.selectSession로 단일화.
    appState.selectSession(name);
    pushRecentProject(name);
    close();
  };

  const createProject = async (folder: string | null) => {
    const name = await appState.pushDialogAsync({
      type: 'input-confirm',
      text: folder ? `"${folder}" 폴더에 새 프로젝트 이름` : '신규 프로젝트 이름',
    });
    if (!name) return;
    if (sessionService.list().includes(name)) {
      appState.pushMessage('이미 존재하는 프로젝트 이름입니다.');
      return;
    }
    // 생성은 기본 프리셋 로드 + 서버 저장에 잠깐 걸리는데 표시가 없어 "만들어졌나?" 불안 →
    // 진행 중 sticky 토스트 + 완료 시 "생성됨"으로 확실한 피드백.
    const toastId = appState.pushMessage('프로젝트 만드는 중…', { sticky: true });
    try {
      await sessionService.add(name);
      if (folder) {
        try {
          await sessionService.moveToFolder(name, folder);
        } catch (e) {}
      }
      const session = await sessionService.get(name);
      if (session) {
        imageService.refreshBatch(session);
        appState.curSession = session;
        pushRecentProject(name);
      }
      appState.dismissMessage(toastId);
      appState.pushMessage(`프로젝트 "${name}" 생성됨`);
      close();
    } catch (e: any) {
      appState.dismissMessage(toastId);
      appState.pushMessage(e.message || '프로젝트 생성에 실패했습니다.');
    }
  };

  const createFolder = async () => {
    const value = await appState.pushDialogAsync({
      type: 'input-confirm',
      text: '새 폴더 이름을 입력하세요',
    });
    if (!value) return;
    try {
      await sessionService.createFolder(value);
      // 새로 만든 폴더를 펼친 상태로
      setExpanded((prev) => {
        const next = new Set(prev);
        next.add(value.trim());
        return next;
      });
    } catch (e: any) {
      appState.pushMessage(e.message || '폴더 생성에 실패했습니다.');
    }
  };

  const pickColor = async (f: string, c: string | null) => {
    setColorPickerFor(null);
    try {
      await sessionService.setFolderColor(f, c);
    } catch (e) {}
  };

  // 커스텀 컬러 피커 전용: 크로뮴은 색상 팝업을 드래그하는 동안 change 이벤트가
  // 연속 발생하므로, 패널을 닫지 않고(input 언마운트 → 팝업 닫힘 방지) 저장만
  // 디바운스한다. 이렇게 해야 슬라이더로 색을 자유롭게 조정할 수 있다.
  const pickCustomColor = (f: string, c: string) => {
    if (customColorTimer.current) clearTimeout(customColorTimer.current);
    customColorTimer.current = setTimeout(() => {
      sessionService.setFolderColor(f, c).catch(() => {});
    }, 200);
  };

  // ===== 폴더 인라인 이름 편집 / 삭제 =====
  const startRename = (f: string) => {
    setColorPickerFor(null);
    setEditingFolder(f);
    setEditValue(leafOfFolder(f)); // 중첩 폴더는 leaf만 편집(부모 경로 보존)
  };

  const cancelRename = () => {
    setEditingFolder(null);
    setEditValue('');
  };

  const commitRename = async () => {
    const f = editingFolder;
    if (!f) return;
    const newLeaf = editValue.trim();
    if (!newLeaf || newLeaf === leafOfFolder(f)) {
      cancelRename();
      return;
    }
    const parent = parentOfFolder(f);
    const newPath = parent ? parent + '/' + newLeaf : newLeaf;
    try {
      await sessionService.renameFolder(f, newLeaf);
      // 펼침 상태도 폴더 자신 + 하위까지 path 키 remap(누락 시 rename 후 접힘).
      setExpanded((prev) => {
        const next = new Set<string>();
        for (const k of prev) {
          if (k === f || k.startsWith(f + '/')) next.add(newPath + k.slice(f.length));
          else next.add(k);
        }
        return next;
      });
      cancelRename();
    } catch (e: any) {
      appState.pushMessage(e.message || '이름 변경에 실패했습니다.');
    }
  };

  const deleteFolderConfirm = (f: string) => {
    const cleanup = () => {
      if (editingFolder === f) cancelRename();
    };
    // 하위 폴더 프로젝트까지 포함(중첩). 서버는 트리를 통째 삭제하므로 카운트도 subtree 기준.
    const inSubtree = (n: string) => {
      const fp = sessionService.getFolderOf(n);
      return fp === f || (fp || '').startsWith(f + '/');
    };
    const count = sessionService.list().filter(inSubtree).length;
    // 빈 폴더 → 단순 확인
    if (count === 0) {
      appState.pushDialog({
        type: 'confirm',
        text: `폴더 "${f}"를 삭제할까요?`,
        callback: async () => {
          try {
            await sessionService.deleteFolder(f, true);
            cleanup();
          } catch (e: any) {
            appState.pushMessage(e.message || '폴더 삭제에 실패했습니다.');
          }
        },
      });
      return;
    }
    // 프로젝트가 있는 폴더 → 삭제 방식 선택
    appState.pushDialog({
      type: 'select',
      text: `폴더 "${f}" 삭제 (${count}개 프로젝트)`,
      items: [
        { text: '폴더만 삭제 (프로젝트는 미분류로 이동)', value: 'folderOnly' },
        { text: '⚠️ 폴더와 프로젝트 모두 삭제', value: 'withProjects' },
      ],
      callback: async (value) => {
        if (value === 'folderOnly') {
          // 우리 deleteFolder는 안의 프로젝트를 영구삭제하므로, 먼저 (하위 폴더 포함) 모든
          // 프로젝트를 미분류로 빼낸 뒤 빈 폴더 트리를 삭제한다 (프로젝트 보존). 이동 하나라도
          // 실패하면 deleteFolder를 절대 호출하지 않는다 — 남은 프로젝트까지 영구삭제되기 때문.
          try {
            const projects = sessionService.list().filter(inSubtree);
            const failed: string[] = [];
            for (const p of projects) {
              try {
                await sessionService.moveToFolder(p, null);
              } catch {
                failed.push(p);
              }
            }
            if (failed.length > 0) {
              const moved = projects.length - failed.length;
              const preview = failed.slice(0, 3).join(', ');
              const more = failed.length > 3 ? ` 외 ${failed.length - 3}개` : '';
              appState.pushMessage(
                `폴더 삭제를 중단했습니다. ${moved}개 이동 완료, ${failed.length}개 이동 실패: ${preview}${more}`,
              );
              return;
            }

            // 마지막 이동의 update 뒤 목록을 한 번 더 새로 읽어, 다른 탭 변경이나 stale 목록으로
            // 폴더 안 프로젝트가 남았으면 파괴적 deleteFolder 호출을 차단한다.
            await sessionService.update();
            const remaining = sessionService.list().filter(inSubtree);
            if (remaining.length > 0) {
              appState.pushMessage(
                `폴더 삭제를 중단했습니다. 폴더 안에 프로젝트 ${remaining.length}개가 남아 있습니다.`,
              );
              return;
            }
            await sessionService.deleteFolder(f);
            cleanup();
          } catch (e: any) {
            appState.pushMessage(e.message || '폴더 삭제에 실패했습니다.');
          }
        } else if (value === 'withProjects') {
          // 위험 동작 → 2차 확인. 우리 정책은 휴지통을 거치지 않는 영구 삭제.
          appState.pushDialog({
            type: 'confirm',
            text: `정말 폴더 "${f}"와 그 안의 ${count}개 프로젝트를 모두 영구 삭제할까요?\n복구할 수 없습니다.`,
            callback: async () => {
              await appState.deleteFolderWithProjects(f);
              cleanup();
            },
          });
        }
      },
    });
  };

  // 모바일: 폴더마다 ⋮ 메뉴 (데스크톱은 인라인 버튼 유지)
  const openFolderMenu = async (f: string) => {
    const v = await appState.pushDialogAsync({
      type: 'select',
      text: `폴더 "${leafOfFolder(f)}"`,
      items: [
        // 깊이 상한 도달 시 '하위 폴더 만들기' 숨김 (에러 토스트 없이 자연 차단).
        ...(canAddSubfolder(f) ? [{ text: '📁 하위 폴더 만들기', value: 'subfolder' }] : []),
        { text: '📂 폴더로 이동', value: 'move' },
        { text: '📤 내보내기/불러오기', value: 'export' },
        { text: '🎨 색상 변경', value: 'color' },
        { text: '✏️ 이름 편집', value: 'rename' },
        { text: '🗑️ 폴더 삭제', value: 'delete' },
        { text: '➕ 이 폴더에 새 프로젝트', value: 'add' },
      ],
    });
    if (!v) return;
    if (v === 'subfolder') createSubFolder(f);
    else if (v === 'move') moveFolderTo(f);
    else if (v === 'export') appState.folderBackupMenu(f);
    else if (v === 'color') setColorPickerFor((p) => (p === f ? null : f));
    else if (v === 'rename') startRename(f);
    else if (v === 'delete') deleteFolderConfirm(f);
    else if (v === 'add') createProject(f);
  };

  // ===== 드래그&드롭 =====
  const reorderFolders = (moved: string, target: string) => {
    if (moved === target) return;
    const cur = sessionService.getOrderedFolders();
    const from = cur.indexOf(moved);
    const to = cur.indexOf(target);
    if (from < 0 || to < 0) return;
    const without = cur.filter((f) => f !== moved);
    const tIdx = without.indexOf(target);
    const insertAt = from < to ? tIdx + 1 : tIdx;
    without.splice(insertAt, 0, moved);
    sessionService.setFolderOrder(without);
  };

  const moveProjectTo = async (name: string, folder: string | null) => {
    if (sessionService.getFolderOf(name) === folder) return;
    try {
      await sessionService.moveToFolder(name, folder);
    } catch (e: any) {
      appState.pushMessage(e?.message || '이동에 실패했습니다.');
    }
  };

  // 폴더 헤더에 드롭: 폴더면 순서변경, 프로젝트면 폴더로 이동
  const handleFolderDrop = (targetFolder: string) => {
    const d = drag;
    setDrag(null);
    setDropTarget(null);
    if (!d) return;
    if (d.type === 'folder') reorderFolders(d.name, targetFolder);
    else moveProjectTo(d.name, targetFolder);
  };

  // 미분류 헤더에 드롭: 프로젝트만 (폴더에서 빼내기)
  const handleUnfiledDrop = () => {
    const d = drag;
    setDrag(null);
    setDropTarget(null);
    if (!d || d.type !== 'project') return;
    moveProjectTo(d.name, null);
  };

  const dndEnabled = !isMobile;

  // 드롭 가능 여부 판정 (시각 피드백용)
  const canDropOnFolder = (f: string) =>
    drag != null &&
    (drag.type === 'project' ? sessionService.getFolderOf(drag.name) !== f : drag.name !== f);

  // ===== 선택 모드 (다중 선택 → 폴더 일괄 이동) =====
  const toggleSelect = (n: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });
  };

  const exitSelect = () => {
    setSelectMode(false);
    setSelected(new Set());
  };

  const selectAllVisible = () => {
    const all = filter.trim() ? searchResults : sessionNames;
    setSelected(new Set(all));
  };

  const bulkMove = async () => {
    const count = selected.size;
    if (count === 0) return;
    const items: { text: string; value: string }[] = [
      { text: '📤 미분류로 이동', value: '__root__' },
      ...folders.map((f) => ({ text: '📁 ' + f, value: f })),
    ];
    const target = await appState.pushDialogAsync({
      type: 'select',
      text: `선택한 ${count}개 프로젝트 이동`,
      items,
    });
    if (!target) return;
    const folder = target === '__root__' ? null : target;
    const failed: string[] = [];
    for (const name of selected) {
      try {
        await sessionService.moveToFolder(name, folder);
      } catch {
        failed.push(name);
      }
    }
    if (failed.length > 0) {
      // 실패 항목만 선택 상태로 남겨 같은 동작을 바로 재시도할 수 있게 한다.
      setSelected(new Set(failed));
      const succeeded = count - failed.length;
      const preview = failed.slice(0, 3).join(', ');
      const more = failed.length > 3 ? ` 외 ${failed.length - 3}개` : '';
      appState.pushMessage(
        `${succeeded}개 이동 완료, ${failed.length}개 이동 실패: ${preview}${more}`,
      );
      return;
    }
    exitSelect();
    appState.pushMessage(`${count}개 프로젝트를 이동했습니다.`);
  };

  // 선택 모드(export 목적)에서 선택한 프로젝트 일괄 내보내기.
  // 즉시 종료 + 백그라운드 실행 — 진행은 메인 progress dialog가 추적(projectExportMulti 내부 토스트).
  const bulkExport = () => {
    const count = selected.size;
    if (count === 0) return;
    const names = Array.from(selected);
    exitSelect();
    appState.projectExportMulti(names).catch((e: any) => {
      appState.pushMessage('내보내기 실패: ' + (e?.message || e));
    });
  };

  // 선택한 프로젝트 일괄 영구 삭제. 확인 다이얼로그는 appState가 띄우고, 확인 시에만
  // 선택 해제(취소하면 선택 유지). 삭제는 백그라운드 순차(rclone Drive purge 폭주 방지).
  const bulkDelete = () => {
    if (selected.size === 0) return;
    appState.deleteProjectsBackground(Array.from(selected), exitSelect);
  };

  // ===== 선택 모드 — 그룹(폴더/즐겨찾기/미분류) 단위 전체선택 =====
  const groupState = (projs: string[]): 'all' | 'some' | 'none' => {
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
  // 그룹 헤더 우측 전체선택 체크박스 (일부 선택 시 indeterminate). 선택 모드에서만 렌더.
  const groupCheckbox = (projs: string[]) => {
    const st = groupState(projs);
    return (
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
    );
  };

  // 프로젝트 행 공통 props. ProjectRow는 모듈 레벨에 정의해
  // 드래그 도중 setDrag 리렌더로 인한 언마운트/리마운트(드래그 중단)를 방지한다.
  const rowProps = (n: string) => ({
    name: n,
    dndEnabled: dndEnabled && !selectMode,
    dragging: drag?.type === 'project' && drag.name === n,
    selectMode,
    selected: selected.has(n),
    onSelect: () => (selectMode ? toggleSelect(n) : selectProject(n)),
    onDragStart: (e: React.DragEvent) => {
      setDrag({ type: 'project', name: n });
      e.dataTransfer.effectAllowed = 'move';
      e.stopPropagation();
    },
    onDragEnd: () => {
      setDrag(null);
      setDropTarget(null);
    },
    onMenu: () => appState.projectActionMenu(n),
  });

  // ===== 중첩 폴더 트리 =====
  const childFoldersOf = (f: string): string[] =>
    folders.filter((c) => parentOfFolder(c) === f);
  // 폴더 자신 + 모든 하위 폴더의 직속 프로젝트 합산(접힌 폴더의 총 프로젝트 수 표시).
  const subtreeProjectCount = (f: string): number => {
    let n = (folderToProjects.get(f) || []).length;
    for (const c of childFoldersOf(f)) n += subtreeProjectCount(c);
    return n;
  };
  // 보이는 폴더를 트리 순서로 평탄화 — 조상이 모두 펼쳐진 폴더만 포함, depth로 들여쓰기.
  const visibleFolders: { f: string; depth: number }[] = [];
  const collectVisible = (f: string, depth: number) => {
    visibleFolders.push({ f, depth });
    if (expanded.has(f)) {
      for (const c of childFoldersOf(f)) collectVisible(c, depth + 1);
    }
  };
  for (const f of folders) if (parentOfFolder(f) === null) collectVisible(f, 0);

  // 하위 폴더 만들기 (부모 path + leaf).
  const createSubFolder = async (parent: string) => {
    const value = await appState.pushDialogAsync({
      type: 'input-confirm',
      text: `"${leafOfFolder(parent)}" 안에 만들 하위 폴더 이름`,
    });
    if (!value) return;
    const leaf = value.trim();
    if (!leaf) return;
    const full = parent + '/' + leaf;
    try {
      await sessionService.createFolder(full);
      setExpanded((prev) => new Set(prev).add(parent).add(full));
    } catch (e: any) {
      appState.pushMessage(e.message || '폴더 생성에 실패했습니다.');
    }
  };

  // 폴더(하위 폴더·프로젝트 통째)를 다른 폴더 안(또는 최상위)으로 이동.
  const moveFolderTo = async (f: string) => {
    const curParent = parentOfFolder(f);
    // 옮기는 서브트리의 가장 깊은 폴더가 대상 아래로 가도 상한을 넘지 않아야 후보.
    const subtree = folders.filter((k) => k === f || k.startsWith(f + '/'));
    const relExtra = Math.max(...subtree.map((k) => folderDepth(k))) - folderDepth(f);
    // 자신·하위·현재 부모·깊이초과 제외한 폴더 + (최상위가 아니면) 최상위.
    const candidates = folders.filter(
      (t) =>
        t !== f &&
        !t.startsWith(f + '/') &&
        t !== curParent &&
        folderDepth(t) + 1 + relExtra <= MAX_FOLDER_DEPTH,
    );
    const items: { text: string; value: string }[] = [
      ...(curParent !== null ? [{ text: '⬆️ 최상위로 이동', value: '__root__' }] : []),
      ...candidates.map((t) => ({ text: '📁 ' + t, value: t })),
    ];
    if (items.length === 0) {
      appState.pushMessage('옮길 수 있는 다른 폴더가 없어요.');
      return;
    }
    const target = await appState.pushDialogAsync({
      type: 'select',
      text: `"${leafOfFolder(f)}" 폴더 이동`,
      items,
    });
    if (!target) return;
    try {
      await sessionService.moveFolder(f, target === '__root__' ? null : target);
      if (target !== '__root__') setExpanded((prev) => new Set(prev).add(target));
    } catch (e: any) {
      appState.pushMessage(e.message || '폴더 이동에 실패했습니다.');
    }
  };

  return (
    <div
      className="fixed inset-0 titlebar-no-drag"
      style={{
        zIndex: 2100,
        visibility: open ? 'visible' : 'hidden',
        transition: open ? 'visibility 0s' : 'visibility 0s linear 180ms',
      }}
      onClick={close}
    >
      {open && <ModalOverlayCountMarker />}
      <div
        className="absolute inset-0"
        style={{
          backgroundColor: 'rgba(0,0,0,0.35)',
          opacity: open ? 1 : 0,
          transition: 'opacity 0.18s ease',
        }}
      />
      <div
        className="absolute left-0 top-0 h-full w-[90vw] max-w-[400px] bg-[var(--c-zone)] shadow-2xl border-r line-color flex flex-col"
        style={{
          transform: open ? 'translateX(0)' : 'translateX(-100%)',
          transition: 'transform 0.18s cubic-bezier(0.4, 0, 0.2, 1)',
          willChange: 'transform',
          contain: 'layout paint',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-slate-600 flex-none">
          <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">
            프로젝트
          </h2>
          <div className="flex items-center gap-2">
            {!selectMode && (
              <button
                onClick={() => { setSelectPurpose('move'); setSelectMode(true); }}
                className="text-sm px-2.5 py-1 rounded-md bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-slate-600"
              >
                선택
              </button>
            )}
            <button
              className="p-1.5 rounded-md hover:bg-gray-200 dark:hover:bg-slate-600 text-gray-500 dark:text-gray-400"
              onClick={close}
            >
              <FaTimes size={18} />
            </button>
          </div>
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

        {/* 액션 */}
        {selectMode ? (
          <div className="px-3 py-2.5 flex items-center gap-2 flex-none">
            <span className="text-sm font-medium text-sky-600 dark:text-sky-400 flex-none">
              {selected.size}개 선택
            </span>
            <button
              onClick={selectAllVisible}
              className="px-2 py-1.5 rounded-lg text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-700"
            >
              전체 선택
            </button>
            <div className="flex-1" />
            {selectPurpose === 'export' ? (
              <button
                onClick={bulkExport}
                disabled={selected.size === 0}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm bg-sky-500 hover:bg-sky-600 text-white disabled:opacity-40"
              >
                <FaUpload size={12} /> 내보내기
              </button>
            ) : (
              <>
                <button
                  onClick={bulkDelete}
                  disabled={selected.size === 0}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm bg-red-500 hover:bg-red-600 text-white disabled:opacity-40"
                >
                  <FaTrashAlt size={12} /> 삭제
                </button>
                <button
                  onClick={bulkMove}
                  disabled={selected.size === 0}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm bg-sky-500 hover:bg-sky-600 text-white disabled:opacity-40"
                >
                  <FaFolder size={12} /> 이동
                </button>
              </>
            )}
            <button
              onClick={exitSelect}
              className="px-2.5 py-1.5 rounded-lg text-sm bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-slate-600"
            >
              취소
            </button>
          </div>
        ) : (
        <>
        <div className="px-3 py-2.5 flex gap-2 flex-none">
          <button
            onClick={() => createProject(null)}
            className="flex-1 flex items-center justify-center gap-1.5 px-2 py-2.5 rounded-lg text-sm font-medium bg-sky-500 hover:bg-sky-600 text-white transition-colors"
          >
            <FaPlus size={12} /> 새 프로젝트
          </button>
          <Tooltip content="새 폴더 만들기">
          <button
            onClick={createFolder}
            className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-sm font-medium bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-slate-600 transition-colors"
          >
            <FaFolderPlus size={14} /> 폴더
          </button>
          </Tooltip>
        </div>
        {/* 백업 / 복원 — 앱 전체 단위 (옛 SessionTreePicker 하단 글로벌 버튼 흡수) */}
        <div className="grid grid-cols-3 gap-2 px-3 pb-2.5 flex-none">
          <button
            onClick={() => appState.projectImport()}
            title="프로젝트·폴더 백업 불러오기 (복원)"
            className="flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg text-xs font-medium bg-green-100 dark:bg-green-900/50 text-green-800 dark:text-green-200 hover:bg-green-200 dark:hover:bg-green-800 transition-colors min-w-0"
          >
            <FaDownload size={12} className="flex-shrink-0" />
            <span className="truncate">불러오기</span>
          </button>
          <button
            onClick={() => { setSelectPurpose('export'); setSelectMode(true); }}
            title="프로젝트 내보내기 — 선택 모드"
            className="flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg text-xs font-medium bg-sky-100 dark:bg-sky-900/50 text-sky-800 dark:text-sky-200 hover:bg-sky-200 dark:hover:bg-sky-800 transition-colors min-w-0"
          >
            <FaUpload size={12} className="flex-shrink-0" />
            <span className="truncate">내보내기</span>
          </button>
          <button
            onClick={() => appState.projectExportDeep()}
            title="프로젝트 백업 내보내기 (이미지 포함)"
            className="flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg text-xs font-medium bg-indigo-100 dark:bg-indigo-900/50 text-indigo-800 dark:text-indigo-200 hover:bg-indigo-200 dark:hover:bg-indigo-800 transition-colors min-w-0"
          >
            <FaArchive size={12} className="flex-shrink-0" />
            <span className="truncate">백업</span>
          </button>
        </div>
        </>
        )}

        {/* 목록 */}
        <div className="flex-1 overflow-y-auto min-h-0 px-2 pb-3">
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
                searchResults.map((n) => (
                  <ProjectRow key={n} showFolder {...rowProps(n)} />
                ))
              )}
            </div>
          ) : (
            <>
              {/* 즐겨찾기 (접기 가능, 기본 펼침) */}
              {favs.length > 0 && (
                <div
                  className="mb-1.5 rounded-md"
                  style={{
                    borderLeft: '3px solid #facc15',
                    backgroundColor: withAlpha('#facc15', '12'),
                  }}
                >
                  <div className="flex items-center pr-1">
                  <button
                    onClick={() => toggleFolder('__favorites__')}
                    className="flex-1 min-w-0 flex items-center gap-2 pl-1.5 pr-2 py-2.5 text-[15px] font-semibold text-gray-700 dark:text-gray-200"
                  >
                    {expanded.has('__favorites__') ? (
                      <FaChevronDown size={12} className="flex-none text-gray-400" />
                    ) : (
                      <FaChevronRight size={12} className="flex-none text-gray-400" />
                    )}
                    <span
                      className="flex items-center justify-center w-7 h-7 rounded-md flex-none"
                      style={{ backgroundColor: withAlpha('#facc15', '26') }}
                    >
                      <FaStar className="text-yellow-400" size={14} />
                    </span>
                    <span className="flex-1 text-left">즐겨찾기</span>
                    <span className="text-xs text-gray-400 font-normal">
                      {favs.length}
                    </span>
                  </button>
                  {selectMode && groupCheckbox(favs)}
                  </div>
                  {expanded.has('__favorites__') && (
                    <div className="pl-3 pb-1">
                      {favs.map((n) => (
                        <ProjectRow key={'fav-' + n} showFolder {...rowProps(n)} />
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* 폴더들 */}
              {visibleFolders.map(({ f, depth }) => {
                const projects = folderToProjects.get(f) || [];
                const isOpen = expanded.has(f);
                const childCount = childFoldersOf(f).length;
                const color =
                  sessionService.getFolderColor(f) || DEFAULT_FOLDER_COLOR;
                const picking = colorPickerFor === f;
                const isDropping = dropTarget === f && canDropOnFolder(f);
                const folderDragging =
                  drag?.type === 'folder' && drag.name === f;
                return (
                  <div
                    key={f}
                    className="mb-1.5 rounded-md transition-shadow"
                    style={{
                      marginLeft: depth * 16, // 중첩 깊이 들여쓰기 (트리)
                      borderLeft: `3px solid ${color}`,
                      boxShadow: isDropping
                        ? `inset 0 0 0 2px ${color}`
                        : undefined,
                      backgroundColor: isDropping
                        ? withAlpha(color, '26')
                        : withAlpha(color, '12'),
                      opacity: folderDragging ? 0.4 : undefined,
                    }}
                    onDragOver={(e) => {
                      if (drag && canDropOnFolder(f)) {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                        setDropTarget(f);
                      }
                    }}
                    onDragLeave={(e) => {
                      if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                        setDropTarget((t) => (t === f ? null : t));
                      }
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      handleFolderDrop(f);
                    }}
                  >
                    {editingFolder === f ? (
                      <div className="flex items-center gap-1 pl-1.5 pr-1 py-1">
                        <span
                          className="flex items-center justify-center w-7 h-7 rounded-md flex-none"
                          style={{ backgroundColor: withAlpha(color, '26') }}
                        >
                          <FaFolder size={14} style={{ color }} />
                        </span>
                        <input
                          autoFocus
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              commitRename();
                            } else if (e.key === 'Escape') {
                              e.preventDefault();
                              cancelRename();
                            }
                          }}
                          className="flex-1 min-w-0 bg-white dark:bg-slate-700 border border-sky-400 rounded px-2 py-1.5 text-[15px] text-gray-900 dark:text-gray-100 outline-none"
                        />
                        <Tooltip content="저장">
                        <button
                          onClick={commitRename}
                          className="p-2 rounded-md flex-none text-green-500 hover:bg-gray-100 dark:hover:bg-slate-700"
                        >
                          <FaCheck size={15} />
                        </button>
                        </Tooltip>
                        <Tooltip content="취소">
                        <button
                          onClick={cancelRename}
                          className="p-2 rounded-md flex-none text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-700"
                        >
                          <FaTimes size={15} />
                        </button>
                        </Tooltip>
                      </div>
                    ) : (
                    <div className="flex items-center gap-0.5 pl-1.5 pr-1">
                      <button
                        onClick={() => toggleFolder(f)}
                        draggable={dndEnabled && !selectMode}
                        onDragStart={(e) => {
                          setDrag({ type: 'folder', name: f });
                          e.dataTransfer.effectAllowed = 'move';
                          e.stopPropagation();
                        }}
                        onDragEnd={() => {
                          setDrag(null);
                          setDropTarget(null);
                        }}
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
                          <FaFolder size={14} style={{ color }} />
                        </span>
                        <span className="truncate flex-1 text-left">{leafOfFolder(f)}</span>
                        <span className="text-xs text-gray-400 font-normal flex-none">
                          {subtreeProjectCount(f)}
                        </span>
                      </button>
                      {selectMode ? (
                        groupCheckbox(projects)
                      ) : isMobile ? (
                        /* 모바일: ⋮ 메뉴 하나로 폴더 동작 5종 노출 */
                        <Tooltip content="폴더 메뉴">
                        <button
                          onClick={() => openFolderMenu(f)}
                          className="p-2 rounded-md flex-none text-gray-500 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors"
                        >
                          <FaEllipsisV size={16} />
                        </button>
                        </Tooltip>
                      ) : (
                        <>
                          <Tooltip content="폴더 내보내기/불러오기">
                          <button
                            onClick={() => appState.folderBackupMenu(f)}
                            className="p-1.5 rounded-md flex-none text-gray-400 hover:text-amber-500 hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors"
                          >
                            <FaFileExport size={14} />
                          </button>
                          </Tooltip>
                          <Tooltip content="폴더 색상">
                          <button
                            onClick={() =>
                              setColorPickerFor(picking ? null : f)
                            }
                            className={`p-2 rounded-md flex-none transition-colors ${
                              picking
                                ? 'bg-gray-200 dark:bg-slate-600 text-sky-500'
                                : 'text-gray-400 hover:text-sky-500 hover:bg-gray-100 dark:hover:bg-slate-700'
                            }`}
                          >
                            <FaPalette size={15} />
                          </button>
                          </Tooltip>
                          <Tooltip content="이름 편집">
                          <button
                            onClick={() => startRename(f)}
                            className="p-2 rounded-md flex-none text-gray-400 hover:text-sky-500 hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors"
                          >
                            <FaPen size={15} />
                          </button>
                          </Tooltip>
                          <Tooltip content="폴더 삭제">
                          <button
                            onClick={() => deleteFolderConfirm(f)}
                            className="p-2 rounded-md flex-none text-gray-400 hover:text-red-500 hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors"
                          >
                            <FaTrashAlt size={15} />
                          </button>
                          </Tooltip>
                          <Tooltip content="이 폴더에 새 프로젝트">
                          <button
                            onClick={() => createProject(f)}
                            className="p-2 rounded-md flex-none text-gray-400 hover:text-sky-500 hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors"
                          >
                            <FaPlus size={15} />
                          </button>
                          </Tooltip>
                          {canAddSubfolder(f) && (
                          <Tooltip content="하위 폴더 만들기">
                          <button
                            onClick={() => createSubFolder(f)}
                            className="p-2 rounded-md flex-none text-gray-400 hover:text-sky-500 hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors"
                          >
                            <FaFolderPlus size={15} />
                          </button>
                          </Tooltip>
                          )}
                          <Tooltip content="폴더로 이동">
                          <button
                            onClick={() => moveFolderTo(f)}
                            className="p-2 rounded-md flex-none text-gray-400 hover:text-sky-500 hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors"
                          >
                            <FaSignInAlt size={15} />
                          </button>
                          </Tooltip>
                        </>
                      )}
                    </div>
                    )}
                    {picking && (
                      <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 bg-gray-50 dark:bg-slate-700/50 rounded-md mx-1 mb-1">
                        {FOLDER_COLORS.map((c) => {
                          const selected = color === c;
                          return (
                            <button
                              key={c}
                              onClick={() => pickColor(f, c)}
                              title={c}
                              className="w-7 h-7 rounded-full flex-none transition-transform hover:scale-110"
                              style={{
                                backgroundColor: c,
                                boxShadow: selected
                                  ? `0 0 0 2px #fff, 0 0 0 4px ${c}`
                                  : 'none',
                              }}
                            />
                          );
                        })}
                        <button
                          onClick={() => pickColor(f, null)}
                          className="px-2 h-7 rounded-md text-xs flex-none bg-gray-200 dark:bg-slate-600 text-gray-600 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-slate-500"
                        >
                          기본
                        </button>
                        {/* 직접 색상 선택: 데스크톱은 OS 네이티브 피커, 모바일은 빈약한
                            WebView 다이얼로그 대신 내장 HSL 피커(MobileColorPicker) */}
                        {!isMobile ? (
                          <label
                            title="직접 색상 선택"
                            className="relative w-7 h-7 rounded-full flex-none cursor-pointer overflow-hidden border border-gray-300 dark:border-slate-500 transition-transform hover:scale-110"
                            style={{
                              background:
                                'conic-gradient(red, orange, yellow, lime, cyan, blue, magenta, red)',
                            }}
                          >
                            <input
                              type="color"
                              defaultValue={
                                /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#0ea5e9'
                              }
                              onInput={(e) => pickCustomColor(f, e.currentTarget.value)}
                              onChange={(e) => pickCustomColor(f, e.target.value)}
                              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                            />
                          </label>
                        ) : (
                          <MobileColorPicker
                            initial={/^#[0-9a-fA-F]{6}$/.test(color) ? color : '#0ea5e9'}
                            onChange={(hex) => pickCustomColor(f, hex)}
                            onClose={() => setColorPickerFor(null)}
                          />
                        )}
                      </div>
                    )}
                    {isOpen && (projects.length > 0 || childCount === 0) && (
                      <div className="pl-3 pb-1">
                        {projects.length === 0 ? (
                          <div className="text-xs text-gray-400 px-2 py-1.5">
                            비어 있음
                          </div>
                        ) : (
                          projects.map((n) => <ProjectRow key={n} {...rowProps(n)} />)
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* 미분류 */}
              {(() => {
                const canDropUnfiled =
                  drag?.type === 'project' &&
                  sessionService.getFolderOf(drag.name) !== null;
                const unfiledDropping =
                  dropTarget === '__unfiled__' && canDropUnfiled;
                return (
              <div
                className="mb-1 rounded-md transition-shadow"
                style={{
                  borderLeft: '3px solid #94a3b8',
                  boxShadow: unfiledDropping
                    ? 'inset 0 0 0 2px #94a3b8'
                    : undefined,
                  backgroundColor: unfiledDropping ? '#94a3b826' : '#94a3b812',
                }}
                onDragOver={(e) => {
                  if (canDropUnfiled) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    setDropTarget('__unfiled__');
                  }
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                    setDropTarget((t) => (t === '__unfiled__' ? null : t));
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  handleUnfiledDrop();
                }}
              >
                <div className="flex items-center pr-1">
                <button
                  onClick={() => toggleFolder('__unfiled__')}
                  className="flex-1 min-w-0 flex items-center gap-2 pl-1.5 pr-2 py-2.5 text-[15px] font-semibold text-gray-700 dark:text-gray-200"
                >
                  {expanded.has('__unfiled__') ? (
                    <FaChevronDown size={11} className="flex-none text-gray-400" />
                  ) : (
                    <FaChevronRight size={11} className="flex-none text-gray-400" />
                  )}
                  <span
                    className="flex items-center justify-center w-7 h-7 rounded-md flex-none"
                    style={{ backgroundColor: withAlpha('#94a3b8', '26') }}
                  >
                    <FaFolder className="text-gray-400" size={14} />
                  </span>
                  <span className="flex-1 text-left">미분류</span>
                  <span className="text-xs text-gray-400 font-normal">
                    {unfiled.length}
                  </span>
                </button>
                {selectMode && groupCheckbox(unfiled)}
                </div>
                {expanded.has('__unfiled__') && (
                  <div className="pl-3 pb-1">
                    {unfiled.map((n) => (
                      <ProjectRow key={n} {...rowProps(n)} />
                    ))}
                  </div>
                )}
              </div>
                );
              })()}
            </>
          )}
        </div>
      </div>
    </div>
  );
});

export default ProjectDrawer;
