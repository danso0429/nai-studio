import { useRef, useState } from 'react';
import { FaGripLines, FaLink } from 'react-icons/fa';
import { backend } from '../models';
import { appState } from '../models/AppService';
import TaskQueueControl from './TaskQueueControl';

const GenControlFloating = ({ canDock }: { canDock: boolean }) => {
  const [dragging, setDragging] = useState(false);
  const start = useRef({ pointerX: 0, pointerY: 0, x: 0, y: 0 });
  const persist = async () => {
    try {
      const config = await backend.getConfig();
      await backend.setConfig({ ...config, genWidget: appState.genWidget });
    } catch (error) {
      console.error('생성 컨트롤 위치 저장 실패:', error);
    }
  };
  const position =
    typeof appState.genWidget.x === 'number' && typeof appState.genWidget.y === 'number'
      ? { left: appState.genWidget.x, top: appState.genWidget.y }
      : { right: 16, bottom: 16 };
  return (
    <div
      className="fixed max-w-[calc(100vw-2rem)] rounded-xl border line-color bg-[var(--c-surface-2)] shadow-xl px-3 py-2"
      style={{ ...position, zIndex: 'var(--z-widget)' }}
    >
      <div
        className={`flex items-center gap-2 pb-1.5 text-xs text-sub select-none ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          const rect = event.currentTarget.parentElement!.getBoundingClientRect();
          start.current = {
            pointerX: event.clientX,
            pointerY: event.clientY,
            x: rect.left,
            y: rect.top,
          };
          setDragging(true);
        }}
        onPointerMove={(event) => {
          if (!dragging) return;
          appState.genWidget = {
            x: Math.max(
              4,
              Math.min(window.innerWidth - 220, start.current.x + event.clientX - start.current.pointerX),
            ),
            y: Math.max(
              4,
              Math.min(window.innerHeight - 80, start.current.y + event.clientY - start.current.pointerY),
            ),
          };
        }}
        onPointerUp={() => {
          if (!dragging) return;
          setDragging(false);
          void persist();
        }}
        onPointerCancel={() => setDragging(false)}
      >
        <FaGripLines />
        <span className="flex-1">생성 컨트롤</span>
        {canDock && (
          <button
            className="icon-button"
            title="하단 바에 붙이기"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={async () => {
              const next = { ...appState.uiLayoutSlots, genControl: 'docked' as const };
              appState.uiLayoutSlots = next;
              const config = await backend.getConfig();
              await backend.setConfig({ ...config, uiLayoutSlots: next });
            }}
          >
            <FaLink size={12} />
          </button>
        )}
      </div>
      <TaskQueueControl />
    </div>
  );
};

export default GenControlFloating;
