import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { isMobile } from '../models';

// 씬 ImageGallery 모바일 default cellSize(imageSize 400 / 2.5 = 160)와 매칭.
// 데스크탑은 모달 너비 고려해 200 절충.
const IMAGE_CELL_PX = isMobile ? 160 : 200;

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
  // 정사각 셀에 fit 시킬 px. 미지정 시 80(라벨 모드 기존 default).
  size?: number;
}

function ThumbnailInner<T>({ item, getImage, imageRevision, alt, size }: ThumbnailProps<T>): React.ReactElement {
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

  const px = size ?? 80;

  return (
    <div className="flex items-center justify-center" style={{ width: px, height: px }}>
      {src ? (
        <img
          className="bg-checkboard w-auto h-auto"
          style={{ maxWidth: px, maxHeight: px }}
          draggable={false}
          src={src}
          alt={alt}
        />
      ) : loading ? (
        <div
          className="bg-gray-200 dark:bg-slate-600 animate-pulse rounded"
          style={{ width: Math.floor(px * 0.8), height: Math.floor(px * 0.8) }}
        />
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
  // iOS Safari 400ms click delay 우회 — onTouchEnd에서 직접 toggle.
  // - startPosRef: 스크롤 보호 (10px 이상 이동 시 toggle X).
  // - toggleLockRef: touch 경로에서 이미 toggle 했으면 1초 내 도착한 click skip
  //   (더블 toggle 방지). 데스크탑(mouse only): click 그대로 통과.
  const startPosRef = useRef<{ x: number; y: number } | null>(null);
  const toggleLockRef = useRef<number>(0);

  const handleClick = useCallback(() => {
    if (Date.now() - toggleLockRef.current < 1000) return;
    onToggle(id);
  }, [id, onToggle]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const t = e.touches[0];
    if (t) startPosRef.current = { x: t.clientX, y: t.clientY };
  }, []);

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      const start = startPosRef.current;
      startPosRef.current = null;
      if (!start) return;
      const t = e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      if (Math.hypot(dx, dy) > 10) return;
      toggleLockRef.current = Date.now();
      onToggle(id);
    },
    [id, onToggle],
  );

  if (!showLabel) {
    // 이미지 그리드 모드 — 씬 ImageGallery 셀 구조 흉내.
    // 정사각 셀에 이미지 contain, 선택 시 sky 반투명 오버레이.
    const cellPx = IMAGE_CELL_PX;
    return (
      <button
        type="button"
        onClick={handleClick}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        style={{ width: cellPx, height: cellPx }}
        className="touch-manipulation relative cursor-pointer overflow-hidden bg-white dark:bg-slate-900 select-none active:brightness-90 hover:brightness-95 flex items-center justify-center"
      >
        {getImage && (
          <Thumbnail
            item={item}
            getImage={getImage}
            imageRevision={imageRevision}
            alt={label}
            size={cellPx}
          />
        )}
        {selected && (
          <div className="absolute inset-0 bg-sky-500 opacity-50 pointer-events-none" />
        )}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
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
      <div className="h-12 w-full overflow-auto break-all text-sm text-left pt-1">
        {label}
      </div>
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

  // 이미지 그리드 모드(showLabel=false)에서 씬 ImageGallery 패턴 재현:
  // 컨테이너 너비 측정 → 그리드를 columnCount * cellPx 고정 너비로 만들고
  // 부모에서 justify-center. 마지막 줄에 셀 1개만 남으면 그리드 좌측 컬럼에 위치(=중앙 X).
  const gridWrapRef = useRef<HTMLDivElement>(null);
  const [wrapWidth, setWrapWidth] = useState(0);
  useEffect(() => {
    if (showLabel) return;
    const el = gridWrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setWrapWidth(e.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [showLabel]);
  const columnCount = Math.max(
    1,
    wrapWidth > 0 ? Math.floor(wrapWidth / IMAGE_CELL_PX) : 1,
  );
  const gridWidth = columnCount * IMAGE_CELL_PX;

  const sortedItems = useMemo(() => {
    if (sortMode === 'original') return items;
    const arr = items.slice();
    arr.sort((a, b) => {
      const cmp = getLabel(a).localeCompare(getLabel(b), 'ko');
      return sortMode === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [items, sortMode, getLabel]);

  const toggle = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

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
        {showLabel ? (
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
        ) : (
          <div ref={gridWrapRef} className="flex justify-center w-full">
            <div
              className="flex flex-wrap content-start gap-0"
              style={{ width: gridWidth }}
            >
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
        )}
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
