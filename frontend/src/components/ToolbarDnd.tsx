import { useEffect, useRef, type ReactNode } from 'react';
import { useDrag, useDrop } from 'react-dnd';
import { getEmptyImage } from 'react-dnd-html5-backend';
import { observer } from 'mobx-react-lite';
import { backend, isMobile } from '../models';
import { appState } from '../models/AppService';
import {
  TOOLBAR_VIEW_MAIN,
  moveToolbarButton,
  type ToolbarMove,
} from '../models/uiLayout';
import {
  assignCompanion,
  isCompanionButtonId,
  removeCompanion,
  type CompanionHost,
} from '../models/companionSlots';

export type ToolbarGroup = 'scene' | 'project';
export const TOOLBAR_DND_TYPE = 'toolbar-button/main';

export interface ToolbarDragItem {
  id: string;
  name: string;
  area: ToolbarGroup;
  portable: boolean;
  from: 'inline' | 'menu' | 'companion';
}

const metaOf = (id: string) =>
  TOOLBAR_VIEW_MAIN.flatMap(({ registry }) => registry).find((meta) => meta.id === id);

export async function applyToolbarMove(move: ToolbarMove): Promise<void> {
  const previous = appState.uiToolbar;
  const previousCompanions = appState.uiCompanionSlots;
  const next = moveToolbarButton(TOOLBAR_VIEW_MAIN, previous, move);
  const nextCompanions = removeCompanion(previousCompanions, move.id);
  if (next === previous && nextCompanions === previousCompanions) return;
  appState.uiToolbar = next;
  appState.uiCompanionSlots = nextCompanions;
  try {
    const config = await backend.getConfig();
    await backend.setConfig({
      ...config,
      uiToolbar: next,
      uiCompanionSlots: nextCompanions,
    });
  } catch (error) {
    appState.uiToolbar = previous;
    appState.uiCompanionSlots = previousCompanions;
    appState.pushMessage('툴바 배치를 저장하지 못했습니다.');
    console.error('툴바 배치 저장 실패:', error);
  }
}

export async function applyCompanionMove(
  host: CompanionHost,
  id: string,
): Promise<void> {
  if (!isCompanionButtonId(id)) return;
  const previous = appState.uiCompanionSlots;
  const next = assignCompanion(previous, host, id);
  if (next === previous) return;
  appState.uiCompanionSlots = next;
  try {
    const config = await backend.getConfig();
    await backend.setConfig({ ...config, uiCompanionSlots: next });
  } catch (error) {
    appState.uiCompanionSlots = previous;
    appState.pushMessage('동반 버튼 배치를 저장하지 못했습니다.');
    console.error('동반 버튼 배치 저장 실패:', error);
  }
}

export const CompanionDropTarget = observer(
  ({ host, children }: { host: CompanionHost; children: ReactNode }) => {
    const [{ isOver }, drop] = useDrop(
      () => ({
        accept: TOOLBAR_DND_TYPE,
        canDrop: (item: ToolbarDragItem) => isCompanionButtonId(item.id),
        drop: (item: ToolbarDragItem, monitor) => {
          if (monitor.didDrop()) return;
          void applyCompanionMove(host, item.id);
        },
        collect: (monitor) => ({
          isOver: monitor.isOver({ shallow: true }) && monitor.canDrop(),
        }),
      }),
      [host],
    );
    return (
      <div
        ref={(node) => drop(node)}
        className={`${isOver ? 'ring-2 ring-sky-400 rounded-lg bg-sky-400/10 ' : ''}${appState.editMode ? 'min-w-8 min-h-8 border border-dashed border-sky-400/60 rounded-lg' : ''}`}
      >
        {children}
      </div>
    );
  },
);

export const DraggableCompanionButton = observer(
  ({ id, children }: { id: string; children: ReactNode }) => {
    const meta = metaOf(id);
    const area = TOOLBAR_VIEW_MAIN.find(({ registry }) =>
      registry.some((candidate) => candidate.id === id),
    )?.area as ToolbarGroup | undefined;
    const [{ isDragging }, drag, preview] = useDrag(
      () => ({
        type: TOOLBAR_DND_TYPE,
        item: (): ToolbarDragItem => ({
          id,
          name: meta?.name ?? id,
          area: area ?? 'project',
          portable: meta?.portable === true,
          from: 'companion',
        }),
        canDrag: () => canEdit() && !appState.uiToolbar.classic,
        collect: (monitor) => ({ isDragging: monitor.isDragging() }),
        end: () => {
          appState.toolbarDragging = false;
        },
      }),
      [id, area, appState.editMode, appState.uiToolbar.classic],
    );
    useEffect(() => {
      preview(getEmptyImage(), { captureDraggingState: true });
    }, [preview]);
    useEffect(() => {
      if (isDragging) appState.toolbarDragging = true;
    }, [isDragging]);
    return (
      <div
        ref={(node) => drag(node)}
        className={isDragging ? 'opacity-30' : ''}
        onClickCapture={(event) => {
          if (!appState.editMode) return;
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        {children}
      </div>
    );
  },
);

const canEdit = () => isMobile || appState.editMode;

export const DraggableToolbarButton = observer(
  ({
    group,
    id,
    name,
    index,
    children,
  }: {
    group: ToolbarGroup;
    id: string;
    name: string;
    index: number;
    children: ReactNode;
  }) => {
    const ref = useRef<HTMLDivElement | null>(null);
    const [{ isDragging }, drag, preview] = useDrag(
      () => ({
        type: TOOLBAR_DND_TYPE,
        item: (): ToolbarDragItem => ({
          id,
          name,
          area: group,
          portable: metaOf(id)?.portable === true,
          from: 'inline',
        }),
        canDrag: () => canEdit() && !appState.uiToolbar.classic,
        collect: (monitor) => ({ isDragging: monitor.isDragging() }),
        end: () => {
          appState.toolbarDragging = false;
        },
      }),
      [group, id, name, index, appState.editMode, appState.uiToolbar.classic],
    );
    const [{ isOver, before }, drop] = useDrop(
      () => ({
        accept: TOOLBAR_DND_TYPE,
        canDrop: (item: ToolbarDragItem) =>
          item.id !== id && (item.area === group || item.portable),
        drop: (item: ToolbarDragItem, monitor) => {
          if (monitor.didDrop()) return;
          const rect = ref.current?.getBoundingClientRect();
          const point = monitor.getClientOffset();
          const insertBefore = !rect || !point || point.x < rect.left + rect.width / 2;
          void applyToolbarMove({
            id: item.id,
            toArea: group,
            slot: 'inline',
            anchor: { id, side: insertBefore ? 'before' : 'after' },
          });
        },
        collect: (monitor) => {
          const rect = ref.current?.getBoundingClientRect();
          const point = monitor.getClientOffset();
          return {
            isOver: monitor.isOver({ shallow: true }) && monitor.canDrop(),
            before: !rect || !point || point.x < rect.left + rect.width / 2,
          };
        },
      }),
      [group, id, index],
    );
    useEffect(() => {
      preview(getEmptyImage(), { captureDraggingState: true });
    }, [preview]);
    useEffect(() => {
      if (isDragging) appState.toolbarDragging = true;
    }, [isDragging]);

    return (
      <div
        ref={(node) => {
          ref.current = node;
          drag(drop(node));
        }}
        className={`${isDragging ? 'opacity-30 ' : ''}${isOver ? (before ? 'border-l-2 border-sky-400' : 'border-r-2 border-sky-400') : ''}`}
        onClickCapture={(event) => {
          if (!appState.editMode) return;
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        {children}
      </div>
    );
  },
);

export const ToolbarSlotDropTarget = observer(
  ({
    group,
    slot,
    children,
  }: {
    group: ToolbarGroup;
    slot: 'inline' | 'menu' | 'hidden';
    children: ReactNode;
  }) => {
    const [{ isOver }, drop] = useDrop(
      () => ({
        accept: TOOLBAR_DND_TYPE,
        canDrop: (item: ToolbarDragItem) => item.area === group || item.portable,
        drop: (item: ToolbarDragItem, monitor) => {
          if (monitor.didDrop()) return;
          void applyToolbarMove({ id: item.id, toArea: group, slot });
        },
        collect: (monitor) => ({
          isOver: monitor.isOver({ shallow: true }) && monitor.canDrop(),
        }),
      }),
      [group, slot],
    );
    return (
      <div
        ref={(node) => drop(node)}
        className={isOver ? 'ring-2 ring-sky-400 rounded-lg bg-sky-400/10' : ''}
      >
        {children}
      </div>
    );
  },
);

export const DraggableToolbarMenuItem = observer(
  ({
    group,
    id,
    name,
    index,
    children,
  }: {
    group: ToolbarGroup;
    id: string;
    name: string;
    index: number;
    children: ReactNode;
  }) => {
    const ref = useRef<HTMLDivElement | null>(null);
    const [{ isDragging }, drag, preview] = useDrag(
      () => ({
        type: TOOLBAR_DND_TYPE,
        item: (): ToolbarDragItem => ({
          id,
          name,
          area: group,
          portable: metaOf(id)?.portable === true,
          from: 'menu',
        }),
        canDrag: () => canEdit() && !appState.uiToolbar.classic,
        collect: (monitor) => ({ isDragging: monitor.isDragging() }),
        end: () => {
          appState.toolbarDragging = false;
        },
      }),
      [group, id, name, index, appState.editMode, appState.uiToolbar.classic],
    );
    const [{ isOver, before }, drop] = useDrop(
      () => ({
        accept: TOOLBAR_DND_TYPE,
        canDrop: (item: ToolbarDragItem) =>
          item.id !== id && (item.area === group || item.portable),
        drop: (item: ToolbarDragItem, monitor) => {
          if (monitor.didDrop()) return;
          const rect = ref.current?.getBoundingClientRect();
          const point = monitor.getClientOffset();
          const insertBefore = !rect || !point || point.y < rect.top + rect.height / 2;
          void applyToolbarMove({
            id: item.id,
            toArea: group,
            slot: 'menu',
            anchor: { id, side: insertBefore ? 'before' : 'after' },
          });
        },
        collect: (monitor) => {
          const rect = ref.current?.getBoundingClientRect();
          const point = monitor.getClientOffset();
          return {
            isOver: monitor.isOver({ shallow: true }) && monitor.canDrop(),
            before: !rect || !point || point.y < rect.top + rect.height / 2,
          };
        },
      }),
      [group, id, index],
    );
    useEffect(() => {
      preview(getEmptyImage(), { captureDraggingState: true });
    }, [preview]);
    useEffect(() => {
      if (isDragging) appState.toolbarDragging = true;
    }, [isDragging]);
    return (
      <div
        ref={(node) => {
          ref.current = node;
          drag(drop(node));
        }}
        className={`${isDragging ? 'opacity-30 ' : ''}${isOver ? (before ? 'border-t-2 border-sky-400' : 'border-b-2 border-sky-400') : ''}`}
        onClickCapture={(event) => {
          if (!appState.editMode) return;
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        {children}
      </div>
    );
  },
);

export const ToolbarHideZone = observer(({ group }: { group: ToolbarGroup }) => {
  if (!appState.editMode) return null;
  return (
    <ToolbarSlotDropTarget group={group} slot="hidden">
      <div className="px-3 py-1.5 rounded-lg border-2 border-dashed border-red-400 text-red-500 text-xs">
        여기에 놓아 숨기기
      </div>
    </ToolbarSlotDropTarget>
  );
});
