import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { observer } from 'mobx-react-lite';
import {
  FaBolt,
  FaBroom,
  FaExchangeAlt,
  FaFileImport,
  FaFolderOpen,
  FaHistory,
  FaPuzzlePiece,
  FaShare,
  FaTrashAlt,
} from 'react-icons/fa';
import { appState } from '../models/AppService';
import { isMobile } from '../models';
import { QUICK_MENU_ACTIONS, normalizeQuickMenu } from '../models/quickMenu';
import ModalOverlay from './ModalOverlay';
import Tooltip from './Tooltip';

const ICONS: Record<string, ReactNode> = {
  'project-browser': <FaFolderOpen size={18} />,
  'piece-editor': <FaPuzzlePiece size={18} />,
  'find-replace': <FaExchangeAlt size={18} />,
  'media-import': <FaShare size={18} />,
  'scene-importer': <FaFileImport size={18} />,
  history: <FaHistory size={18} />,
  'empty-image-trash': <FaBroom size={18} />,
  'delete-session': <FaTrashAlt size={18} />,
};

const POSITION_KEY = 'sdstudio-quick-menu-position';
const loadPosition = (): { x: number; y: number } | undefined => {
  try {
    const parsed = JSON.parse(localStorage.getItem(POSITION_KEY) ?? 'null');
    if (typeof parsed?.x === 'number' && typeof parsed?.y === 'number') return parsed;
  } catch {}
  return undefined;
};

const QuickMenu = observer(() => {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState(loadPosition);
  const [dragging, setDragging] = useState(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout>>();
  const moved = useRef(false);
  const close = () => {
    appState.quickMenuOpen = false;
  };

  useEffect(() => {
    if (!appState.quickMenuOpen || isMobile) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [appState.quickMenuOpen]);

  const ids = normalizeQuickMenu(appState.quickMenu);
  const actions = ids
    .map((id) => QUICK_MENU_ACTIONS.find((action) => action.id === id))
    .filter((action): action is NonNullable<typeof action> => !!action);
  const run = (id: string) => {
    close();
    switch (id) {
      case 'project-browser':
        appState.openProjectDrawer();
        break;
      case 'piece-editor':
        appState.openPieceEditor();
        break;
      case 'find-replace':
        appState.openFindReplace();
        break;
      case 'media-import':
        appState.mediaImport();
        break;
      case 'scene-importer':
        appState.openSceneImporter();
        break;
      case 'history':
        if (isMobile) appState.openHistoryDrawer();
        else appState.toggleHistoryPanel();
        break;
      case 'empty-image-trash':
        appState.emptyProjectImageTrashWithConfirm();
        break;
      case 'delete-session':
        if (appState.curSession) appState.deleteProjectBackground(appState.curSession.name);
        break;
    }
  };

  const hidden =
    !appState.quickMenuButton ||
    appState.floatViewCount > 0 ||
    appState.configScreenOpen ||
    appState.editMode;
  const floatingStyle: CSSProperties = position
    ? { left: position.x, top: position.y }
    : { right: isMobile ? 12 : 16, bottom: isMobile ? 112 : 96 };
  const panelStyle = (): CSSProperties => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return { right: 16, bottom: 150 };
    return {
      ...(rect.top > window.innerHeight / 2
        ? { bottom: window.innerHeight - rect.top + 8 }
        : { top: rect.bottom + 8 }),
      ...(rect.left > window.innerWidth / 2
        ? { right: Math.max(8, window.innerWidth - rect.right) }
        : { left: Math.max(8, rect.left) }),
    };
  };
  const rows = actions.map((action) => {
    const disabled = !!action.needsProject && !appState.curSession;
    return (
      <button
        key={action.id}
        className="btn-ghost w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm text-default text-left"
        disabled={disabled}
        onClick={() => run(action.id)}
      >
        <span className="w-5 flex-none flex justify-center">{ICONS[action.id] ?? <FaBolt />}</span>
        <span className="flex-1 truncate">{action.name}</span>
      </button>
    );
  });

  return (
    <>
      {!hidden && (
        <Tooltip content={isMobile ? '퀵 메뉴' : '퀵 메뉴 (Ctrl+K) · 길게 눌러 이동'}>
          <button
            ref={buttonRef}
            className={`btn fixed w-11 h-11 rounded-full shadow-lg flex items-center justify-center border border-amber-500/70 bg-amber-400/80 text-amber-950${dragging ? ' scale-110 cursor-grabbing' : ''}`}
            style={{ ...floatingStyle, zIndex: 'var(--z-widget)', touchAction: 'none' }}
            onPointerDown={(event) => {
              moved.current = false;
              const target = event.currentTarget;
              holdTimer.current = setTimeout(() => {
                setDragging(true);
                target.setPointerCapture(event.pointerId);
              }, 400);
            }}
            onPointerMove={(event) => {
              if (!dragging) return;
              moved.current = true;
              setPosition({
                x: Math.max(4, Math.min(window.innerWidth - 48, event.clientX - 22)),
                y: Math.max(4, Math.min(window.innerHeight - 48, event.clientY - 22)),
              });
            }}
            onPointerUp={() => {
              if (holdTimer.current) clearTimeout(holdTimer.current);
              holdTimer.current = undefined;
              if (dragging && position) localStorage.setItem(POSITION_KEY, JSON.stringify(position));
              setDragging(false);
            }}
            onPointerCancel={() => {
              if (holdTimer.current) clearTimeout(holdTimer.current);
              setDragging(false);
            }}
            onClick={() => {
              if (moved.current) {
                moved.current = false;
                return;
              }
              appState.quickMenuOpen = !appState.quickMenuOpen;
            }}
          >
            <FaBolt size={16} />
          </button>
        </Tooltip>
      )}
      {isMobile ? (
        <ModalOverlay isOpen={appState.quickMenuOpen} onClose={close} title="퀵 메뉴" width="max-w-sm">
          <div className="grid grid-cols-2 gap-2">{rows}</div>
        </ModalOverlay>
      ) : (
        appState.quickMenuOpen && (
          <>
            <div className="fixed inset-0" style={{ zIndex: 'var(--z-widget)' }} onClick={close} />
            <div
              className="fixed w-64 max-h-[60vh] overflow-y-auto rounded-lg border line-color bg-[var(--c-surface-2)] shadow-xl p-1.5"
              style={{ ...panelStyle(), zIndex: 'var(--z-widget)' }}
            >
              {rows.length > 0 ? rows : <p className="p-3 text-sm text-sub">퀵 메뉴가 비어 있어요.</p>}
            </div>
          </>
        )
      )}
    </>
  );
});

export default QuickMenu;
