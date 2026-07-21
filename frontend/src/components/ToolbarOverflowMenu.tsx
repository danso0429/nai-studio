import { useEffect, useRef, type ReactNode } from 'react';
import ModalOverlay from './ModalOverlay';
import { isMobile } from '../models';
import { appState } from '../models/AppService';
import { observer } from 'mobx-react-lite';
import {
  DraggableToolbarMenuItem,
  type ToolbarGroup,
} from './ToolbarDnd';

export interface ToolbarOverflowItem {
  id: string;
  name: string;
  node: ReactNode;
}

interface ToolbarOverflowMenuProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  items: ToolbarOverflowItem[];
  group: ToolbarGroup;
  dropUp?: boolean;
}

const ToolbarOverflowMenu = observer(({
  isOpen,
  onClose,
  title,
  items,
  group,
  dropUp,
}: ToolbarOverflowMenuProps) => {
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen || isMobile) return;
    const onPointerDown = (event: PointerEvent) => {
      const root = popoverRef.current?.parentElement;
      if (root && !root.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [isOpen, onClose]);

  const rows = items.map((item, index) => (
    <DraggableToolbarMenuItem
      key={item.id}
      group={group}
      id={item.id}
      name={item.name}
      index={index}
    >
      <div
        className="flex items-center gap-3 px-2 py-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10"
        onClick={(event) => {
          const target = event.target as HTMLElement;
          if (!target.closest('button')) {
            event.currentTarget.querySelector('button')?.click();
          }
          onClose();
        }}
      >
        <div className="flex-none">{item.node}</div>
        <span className="text-sm text-default select-none">{item.name}</span>
      </div>
    </DraggableToolbarMenuItem>
  ));

  if (isMobile) {
    return (
      <ModalOverlay
        isOpen={isOpen}
        onClose={onClose}
        title={title}
        width="max-w-sm"
        hidden={appState.toolbarDragging}
      >
        <div className="flex flex-col gap-1">{rows}</div>
      </ModalOverlay>
    );
  }
  if (!isOpen) return null;
  return (
    <div
      ref={popoverRef}
      className={`absolute ${dropUp ? 'bottom-full mb-1' : 'top-full mt-1'} right-0 min-w-[240px] max-w-[80vw] max-h-[60vh] overflow-auto rounded-xl border line-color bg-[var(--c-zone)] shadow-2xl p-2`}
      style={{ zIndex: 'var(--z-context-menu)' }}
    >
      {rows}
    </div>
  );
});

export default ToolbarOverflowMenu;
