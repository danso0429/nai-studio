import React, {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import * as perf from '../utils/clientPerf';

type SortMode = 'original' | 'asc' | 'desc';

export interface BatchAction<T> {
  label: string;
  icon?: React.ReactNode;
  // tailwind background class. 미지정 시 emerald (confirm 색).
  back?: string;
  // 0건일 때 disable 할지 (기본 true).
  requiresSelection?: boolean;
  onAction: (selected: T[]) => void | Promise<void>;
  // 호출 후 selector 닫을지 (기본 false — destructive 가드 등은 callback 안에서 명시 close).
  closeAfter?: boolean;
}

interface BatchItemSelectorProps<T> {
  title: string;
  items: T[];
  getId: (item: T) => string;
  getLabel: (item: T) => string;
  // 썸네일 비동기 로더. 없으면 텍스트 카드만 표시.
  getImage?: (item: T) => Promise<string | null>;
  // 외부 invalidation 신호. 값이 바뀌면 모든 썸네일 재패치.
  // models 레이어 'updated' 이벤트는 부모에서 카운터로 변환해 내려줌.
  imageRevision?: number;
  // 단일 confirm 흐름 (씬 선택창 등). actions와 둘 중 하나.
  onConfirm?: (selected: T[]) => void;
  onCancel?: () => void;
  confirmLabel?: string;
  // 다중 액션 흐름 (이미지 선택 모드 등 — confirm 단일 대신 액션 array).
  actions?: BatchAction<T>[];
  // 처음 선택 상태 (옵션, 없으면 빈 Set).
  initialSelected?: Set<string>;
  // 라벨 표시 여부 (기본 true). 이미지 그리드 등 라벨 불필요 케이스에서 false.
  showLabel?: boolean;
}

interface ThumbnailProps<T> {
  item: T;
  getImage: (item: T) => Promise<string | null>;
  imageRevision?: number;
  alt: string;
}

function ThumbnailInner<T>({ item, getImage, imageRevision, alt }: ThumbnailProps<T>): React.ReactElement {
  const [src, setSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getImage(item)
      .then((uri) => {
        if (!cancelled) setSrc(uri);
      })
      .catch(() => {
        if (!cancelled) setSrc(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [getImage, item, imageRevision]);

  return (
    <div className="w-20 h-20 flex items-center justify-center">
      {src ? (
        <img
          className="w-auto h-auto max-w-20 max-h-20"
          draggable={false}
          src={src}
          alt={alt}
        />
      ) : loading ? (
        <div className="w-16 h-16 bg-gray-200 dark:bg-slate-600 animate-pulse rounded" />
      ) : null}
    </div>
  );
}
const Thumbnail = memo(ThumbnailInner) as typeof ThumbnailInner;

interface ItemCardProps<T> {
  item: T;
  id: string;
  label: string;
  selected: boolean;
  onToggle: (id: string) => void;
  getImage?: (item: T) => Promise<string | null>;
  imageRevision?: number;
  showLabel: boolean;
}

function ItemCardInner<T>({
  item,
  id,
  label,
  selected,
  onToggle,
  getImage,
  imageRevision,
  showLabel,
}: ItemCardProps<T>): React.ReactElement {
  const handleClick = useCallback(() => onToggle(id), [id, onToggle]);
  const handleTouchStart = useCallback(() => perf.mark('bis:touch:start'), []);
  const handleTouchEnd = useCallback(() => perf.mark('bis:touch:end'), []);
  const handlePointerDown = useCallback(() => perf.mark('bis:pointer:down'), []);
  const handlePointerUp = useCallback(() => perf.mark('bis:pointer:up'), []);
  return (
    <button
      type="button"
      onClick={handleClick}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      className={
        'touch-manipulation active:brightness-75 cursor-pointer p-2 border flex flex-col items-center w-24 md:w-32 select-none ' +
        (selected
          ? 'border-sky-500 bg-sky-100 dark:bg-slate-700'
          : 'border-gray-400 dark:border-slate-500 bg-white dark:bg-slate-800 hover:brightness-95')
      }
    >
      {getImage && (
        <Thumbnail
          item={item}
          getImage={getImage}
          imageRevision={imageRevision}
          alt={label}
        />
      )}
      {showLabel && (
        <div className="h-12 w-full overflow-auto break-all text-sm text-left pt-1">
          {label}
        </div>
      )}
    </button>
  );
}
const ItemCard = memo(ItemCardInner) as typeof ItemCardInner;

function BatchItemSelector<T>(props: BatchItemSelectorProps<T>): React.ReactElement {
  const {
    title,
    items,
    getId,
    getLabel,
    getImage,
    imageRevision,
    onConfirm,
    onCancel,
    confirmLabel,
    actions,
    initialSelected,
    showLabel = true,
  } = props;

  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(initialSelected ?? []),
  );
  const [sortMode, setSortMode] = useState<SortMode>('original');

  const sortedItems = useMemo(() => {
    if (sortMode === 'original') return items;
    const arr = items.slice();
    arr.sort((a, b) => {
      const cmp = getLabel(a).localeCompare(getLabel(b), 'ko');
      return sortMode === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [items, sortMode, getLabel]);

  const measurePendingRef = useRef<boolean>(false);

  const toggle = useCallback((id: string) => {
    perf.clearMarks('bis:toggle:click');
    perf.clearMarks('bis:toggle:setState');
    perf.clearMarks('bis:toggle:commit');
    perf.clearMarks('bis:toggle:paint');
    perf.mark('bis:toggle:click');
    measurePendingRef.current = true;
    setSelectedIds((prev) => {
      perf.mark('bis:toggle:setState');
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  useLayoutEffect(() => {
    if (!measurePendingRef.current) return;
    measurePendingRef.current = false;
    perf.mark('bis:toggle:commit');
    // touch/pointer → click 구간 (iOS click delay 격리)
    perf.measureBetween(
      'bis:touchStart→click',
      'bis:touch:start',
      'bis:toggle:click',
    );
    perf.measureBetween(
      'bis:touchEnd→click',
      'bis:touch:end',
      'bis:toggle:click',
    );
    perf.measureBetween(
      'bis:pointerDown→click',
      'bis:pointer:down',
      'bis:toggle:click',
    );
    perf.measureBetween(
      'bis:pointerUp→click',
      'bis:pointer:up',
      'bis:toggle:click',
    );
    // click 이후 React + paint
    perf.measureBetween(
      'bis:click→setState',
      'bis:toggle:click',
      'bis:toggle:setState',
    );
    perf.measureBetween(
      'bis:setState→commit',
      'bis:toggle:setState',
      'bis:toggle:commit',
    );
    perf.measureBetween(
      'bis:click→commit',
      'bis:toggle:click',
      'bis:toggle:commit',
    );
    requestAnimationFrame(() => {
      perf.mark('bis:toggle:paint');
      perf.measureBetween(
        'bis:commit→paint',
        'bis:toggle:commit',
        'bis:toggle:paint',
      );
      perf.measureBetween(
        'bis:click→paint',
        'bis:toggle:click',
        'bis:toggle:paint',
      );
      perf.measureBetween(
        'bis:touchStart→paint',
        'bis:touch:start',
        'bis:toggle:paint',
      );
      perf.log('bis:itemCount', { n: items.length });
      // 다음 cycle 격리 — touch/pointer marks 누적 방지.
      perf.clearMarks('bis:touch:start');
      perf.clearMarks('bis:touch:end');
      perf.clearMarks('bis:pointer:down');
      perf.clearMarks('bis:pointer:up');
      perf.flush();
    });
  }, [selectedIds, items.length]);

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(items.map(getId)));
  }, [items, getId]);

  const clearAll = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const handleConfirm = useCallback(() => {
    if (!onConfirm) return;
    const selected = items.filter((it) => selectedIds.has(getId(it)));
    onConfirm(selected);
  }, [items, selectedIds, getId, onConfirm]);

  const runAction = useCallback(
    async (a: BatchAction<T>) => {
      const selected = items.filter((it) => selectedIds.has(getId(it)));
      if (a.requiresSelection !== false && selected.length === 0) return;
      await a.onAction(selected);
      if (a.closeAfter && onCancel) onCancel();
    },
    [items, selectedIds, getId, onCancel],
  );

  return (
    <div className="touch-manipulation p-2 md:p-4 flex flex-col h-full text-gray-800 dark:text-gray-100">
      <div className="flex flex-wrap items-center gap-2 flex-none">
        <div className="text-lg md:text-xl font-medium">{title}</div>
        <label className="ml-auto flex items-center gap-2 text-sm">
          <span className="text-gray-600 dark:text-gray-300">정렬</span>
          <select
            className="rounded border border-gray-400 dark:border-slate-500 bg-white dark:bg-slate-800 px-2 py-1"
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as SortMode)}
          >
            <option value="original">원본 순서</option>
            <option value="asc">이름 ↑</option>
            <option value="desc">이름 ↓</option>
          </select>
        </label>
      </div>

      <div className="flex items-center gap-2 pt-2 md:pt-3 flex-none">
        <button
          type="button"
          className="rounded px-3 py-1 bg-sky-500 hover:bg-sky-600 text-white"
          onClick={selectAll}
        >
          모두 선택
        </button>
        <button
          type="button"
          className="rounded px-3 py-1 bg-gray-300 hover:bg-gray-400 dark:bg-slate-600 dark:hover:bg-slate-500"
          onClick={clearAll}
        >
          모두 선택 해제
        </button>
        <span className="ml-2 text-sm text-gray-600 dark:text-gray-300">
          {selectedIds.size} / {items.length} 선택됨
        </span>
      </div>

      <div className="flex-1 overflow-auto pt-3 pb-2">
        <div className="flex flex-wrap gap-2 content-start">
          {sortedItems.map((item) => {
            const id = getId(item);
            return (
              <ItemCard
                key={id}
                item={item}
                id={id}
                label={getLabel(item)}
                selected={selectedIds.has(id)}
                onToggle={toggle}
                getImage={getImage}
                imageRevision={imageRevision}
                showLabel={showLabel}
              />
            );
          })}
        </div>
      </div>

      <div className="flex-none flex gap-2 pt-2 flex-wrap">
        {onCancel && (
          <button
            type="button"
            className="rounded px-3 py-1 bg-gray-300 hover:bg-gray-400 dark:bg-slate-600 dark:hover:bg-slate-500"
            onClick={onCancel}
          >
            취소
          </button>
        )}
        {actions && actions.length > 0 ? (
          <div className="ml-auto flex gap-2 flex-wrap">
            {actions.map((a, i) => (
              <button
                key={i}
                type="button"
                disabled={
                  a.requiresSelection !== false && selectedIds.size === 0
                }
                className={
                  'touch-manipulation round-button text-sm inline-flex items-center gap-1 ' +
                  (a.back ?? 'back-emerald') +
                  ' disabled:opacity-40 disabled:cursor-not-allowed'
                }
                onClick={() => runAction(a)}
              >
                {a.icon} {a.label}
              </button>
            ))}
          </div>
        ) : (
          onConfirm && (
            <button
              type="button"
              className="ml-auto rounded px-3 py-1 bg-emerald-500 hover:bg-emerald-600 text-white"
              onClick={handleConfirm}
            >
              {confirmLabel ?? '작업 적용'}
            </button>
          )
        )}
      </div>
    </div>
  );
}

export default BatchItemSelector;
