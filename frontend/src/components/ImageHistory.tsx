import React, { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useContextMenu } from 'react-contexify';
import {
  FaChevronLeft,
  FaChevronRight,
  FaStar,
  FaTimes,
} from 'react-icons/fa';
import { imageHistoryService, imageService } from '../models';
import { GenerationHistoryEntry } from '../models/ImageHistoryService';
import { appState } from '../models/AppService';
import { ContextMenuType, GenericScene } from '../models/types';
import Tooltip from './Tooltip';
import { useLongPress } from './useLongPress';
import ModalOverlayCountMarker from './ModalOverlayCountMarker';

const HistoryImageCell = observer(({
  entry,
  caption,
}: {
  entry: GenerationHistoryEntry;
  caption: string;
}) => {
  const [image, setImage] = useState<string>();
  const [ratio, setRatio] = useState<number>();
  const [scene, setScene] = useState<GenericScene>();
  const suppressClick = React.useRef(false);
  const { show } = useContextMenu({ id: ContextMenuType.HistoryImage });
  const longPress = useLongPress({
    onLongPress: (event, position) => {
      suppressClick.current = true;
      show({
        event,
        position,
        props: { ctx: { type: 'history_image', entry } },
      });
    },
  });

  useEffect(() => {
    let canceled = false;
    imageService.fetchImageSmall(entry.path, 400).then((base64) => {
      if (canceled) return;
      if (base64) setImage(base64);
    }).catch(() => {});
    imageHistoryService.resolveQuiet(entry).then((resolved) => {
      if (!canceled && resolved) setScene(resolved.scene as GenericScene);
    });
    return () => { canceled = true; };
  }, [entry.id, entry.path]);

  const favorite = !!scene?.mains.includes(entry.filename);
  return (
    <div
      className="flex flex-col cursor-pointer select-none hover:brightness-95 active:brightness-90"
      onClick={() => {
        if (suppressClick.current) {
          suppressClick.current = false;
          return;
        }
        void imageHistoryService.toggleFavorite(entry);
      }}
      onContextMenu={(event) => show({
        event,
        props: { ctx: { type: 'history_image', entry } },
      })}
      {...longPress.handlers}
      style={longPress.callout}
    >
      <div
        className={'relative w-full rounded overflow-hidden bg-[var(--c-input-bg)] flex items-center justify-center' +
          (favorite ? ' border-2 border-yellow-400' : '')}
        style={{ aspectRatio: ratio ?? 1 }}
      >
        {image && (
          <img
            src={image}
            draggable={false}
            className="w-full h-full object-cover"
            onLoad={(event) => {
              const element = event.currentTarget;
              if (element.naturalWidth && element.naturalHeight) {
                setRatio(element.naturalWidth / element.naturalHeight);
              }
            }}
          />
        )}
        {favorite && (
          <FaStar className="absolute left-1 top-1 text-yellow-400" size={12} />
        )}
      </div>
      <div className="text-[10px] text-faint truncate text-center leading-tight mt-0.5 mb-1">
        {caption}
      </div>
    </div>
  );
});

const HistoryList = observer(() => {
  if (imageHistoryService.entries.length === 0) {
    return (
      <div className="flex-1 p-4 text-xs text-faint text-center">
        최근 4시간 안에 생성된 이미지가 없습니다
      </div>
    );
  }
  return (
    <div className="flex-1 overflow-y-auto p-2 grid gap-1.5 content-start grid-cols-2">
      {imageHistoryService.entries.map((entry) => (
        <HistoryImageCell
          key={entry.id}
          entry={entry}
          caption={entry.sessionName === appState.curSession?.name
            ? entry.sceneName
            : `${entry.sessionName}/${entry.sceneName}`}
        />
      ))}
    </div>
  );
});

export const ImageHistoryPanel = observer(() => {
  const collapsed = appState.historyPanelCollapsed;
  const width = Math.round(240 * appState.historyThumbnailPercent / 100);
  return (
    <div className="flex-none hidden md:flex h-full flex-row">
      <div
        className={'flex-none w-5 flex flex-col items-center border-l line-color ' +
          (collapsed ? 'cursor-pointer' : '')}
        onClick={collapsed ? () => appState.toggleHistoryPanel() : undefined}
      >
        <Tooltip content={collapsed ? '히스토리 펼치기' : '히스토리 접기'}>
          <button
            className="splitter-toggle-btn"
            onClick={(event) => {
              event.stopPropagation();
              appState.toggleHistoryPanel();
            }}
          >
            {collapsed ? <FaChevronLeft size={10} /> : <FaChevronRight size={10} />}
          </button>
        </Tooltip>
      </div>
      <div
        className="flex flex-col h-full border-l line-color bg-[var(--c-surface-2)] overflow-hidden"
        style={{
          width: collapsed ? 0 : width,
          minWidth: collapsed ? 0 : width,
          visibility: collapsed ? 'hidden' : 'visible',
        }}
      >
        <div className="flex flex-col h-full" style={{ width, minWidth: width }}>
          <div className="flex-none px-3 py-2 border-b line-color flex items-center justify-between">
            <span className="text-sm font-semibold gray-label">히스토리</span>
          </div>
          <HistoryList />
        </div>
      </div>
    </div>
  );
});

export const ImageHistoryHandle = observer(() => {
  const open = appState.historyDrawerOpen;
  const [handleRatio, setHandleRatio] = useState(() => {
    try {
      const raw = localStorage.getItem('sdstudio-history-handle-y');
      if (raw !== null) {
        const saved = Number(raw);
        if (Number.isFinite(saved)) return Math.max(0.08, Math.min(0.92, saved));
      }
    } catch {}
    return 0.5;
  });
  const [dragging, setDragging] = useState(false);
  const drag = React.useRef({
    pointerId: -1,
    startY: 0,
    startRatio: 0.5,
    currentRatio: 0.5,
    moved: false,
    suppressClickUntil: 0,
  });

  const moveHandle = (clientY: number) => {
    const height = Math.max(window.innerHeight, 1);
    const edge = Math.min(40, height / 4);
    const nextPx = drag.current.startRatio * height + clientY - drag.current.startY;
    const next = Math.max(edge, Math.min(height - edge, nextPx)) / height;
    drag.current.currentRatio = next;
    setHandleRatio(next);
    return next;
  };

  const finishHandleDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.pointerId !== drag.current.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (drag.current.moved) {
      try {
        localStorage.setItem('sdstudio-history-handle-y', String(drag.current.currentRatio));
      } catch {}
      drag.current.suppressClickUntil = performance.now() + 500;
    }
    drag.current.pointerId = -1;
    setDragging(false);
  };

  useEffect(() => {
    let startX = 0;
    let startY = 0;
    let tracking = false;
    const onStart = (event: TouchEvent) => {
      if (appState.toolbarDragging) return;
      if (appState.historyDrawerOpen || event.touches.length !== 1) return;
      if (appState.projectDrawerOpen) return;
      const touch = event.touches[0];
      if (touch.clientX < window.innerWidth - 32) return;
      startX = touch.clientX;
      startY = touch.clientY;
      tracking = true;
    };
    const onMove = (event: TouchEvent) => {
      if (appState.toolbarDragging) {
        tracking = false;
        return;
      }
      if (!tracking || event.touches.length !== 1) return;
      const touch = event.touches[0];
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      if (dx < -40 && Math.abs(dx) > Math.abs(dy)) {
        tracking = false;
        appState.openHistoryDrawer();
      }
    };
    const stop = () => { tracking = false; };
    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: true });
    document.addEventListener('touchend', stop, { passive: true });
    document.addEventListener('touchcancel', stop, { passive: true });
    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', stop);
      document.removeEventListener('touchcancel', stop);
    };
  }, []);

  if (appState.projectDrawerOpen) return null;

  return (
    <button
      className={'fixed right-0 -translate-y-1/2 md:hidden flex items-center justify-center w-6 h-14 rounded-l-md border border-r-0 line-color bg-[var(--c-surface-2)] active:opacity-100 ' +
        (dragging ? 'opacity-100' : 'opacity-70')}
      style={{
        zIndex: 'var(--z-drawer-handle)',
        top: `${handleRatio * 100}%`,
        touchAction: 'none',
      }}
      onPointerDown={(event) => {
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        drag.current.pointerId = event.pointerId;
        drag.current.startY = event.clientY;
        drag.current.startRatio = handleRatio;
        drag.current.currentRatio = handleRatio;
        drag.current.moved = false;
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
      }}
      onPointerMove={(event) => {
        if (event.pointerId !== drag.current.pointerId) return;
        if (Math.abs(event.clientY - drag.current.startY) > 4) drag.current.moved = true;
        if (drag.current.moved) moveHandle(event.clientY);
      }}
      onPointerUp={finishHandleDrag}
      onPointerCancel={finishHandleDrag}
      onClick={() => {
        if (performance.now() < drag.current.suppressClickUntil) return;
        appState.toggleHistoryDrawer();
      }}
      aria-label={open ? '히스토리 닫기' : '히스토리 열기, 위아래로 드래그하여 위치 이동'}
      title="위아래로 드래그하여 위치 이동"
    >
      {open ? <FaChevronRight size={11} /> : <FaChevronLeft size={11} />}
    </button>
  );
});

export const ImageHistoryDrawer = observer(() => {
  const open = appState.historyDrawerOpen;
  const swipe = React.useRef({ x: 0, y: 0, active: false });
  const scale = appState.historyThumbnailPercent / 100;
  const width = `min(${80 * scale}vw, ${360 * scale}px)`;
  return (
    <div
      className="fixed inset-0 titlebar-no-drag"
      style={{
        zIndex: 'var(--z-drawer)',
        visibility: open ? 'visible' : 'hidden',
        transition: open ? 'visibility 0s' : 'visibility 0s linear 180ms',
      }}
    >
      {open && <ModalOverlayCountMarker />}
      <div
        className="absolute inset-0"
        style={{
          backgroundColor: 'rgba(0,0,0,0.35)',
          opacity: open ? 1 : 0,
          transition: 'opacity 0.18s ease',
        }}
        onClick={() => appState.closeHistoryDrawer()}
      />
      <div
        className="absolute right-0 top-0 h-full bg-[var(--c-zone)] shadow-2xl border-l line-color flex flex-col"
        style={{
          width,
          transform: open ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.18s cubic-bezier(0.4, 0, 0.2, 1)',
          willChange: 'transform',
          contain: 'layout paint',
        }}
        onTouchStart={(event) => {
          if (appState.toolbarDragging) {
            swipe.current.active = false;
            return;
          }
          swipe.current = {
            x: event.touches[0]?.clientX ?? 0,
            y: event.touches[0]?.clientY ?? 0,
            active: event.touches.length === 1,
          };
        }}
        onTouchMove={(event) => {
          if (appState.toolbarDragging) {
            swipe.current.active = false;
            return;
          }
          if (!swipe.current.active || event.touches.length !== 1) return;
          const dx = event.touches[0].clientX - swipe.current.x;
          const dy = event.touches[0].clientY - swipe.current.y;
          if (dx > 40 && Math.abs(dx) > Math.abs(dy)) {
            swipe.current.active = false;
            appState.closeHistoryDrawer();
          }
        }}
        onTouchEnd={() => { swipe.current.active = false; }}
        onTouchCancel={() => { swipe.current.active = false; }}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b line-color flex-none">
          <h2 className="text-lg font-semibold text-default">히스토리</h2>
          <div className="flex items-center gap-3">
            <button className="icon-button" onClick={() => appState.closeHistoryDrawer()}>
              <FaTimes size={18} />
            </button>
          </div>
        </div>
        <HistoryList />
      </div>
    </div>
  );
});
