import React, { useCallback, useMemo, useState } from 'react';

type SortMode = 'original' | 'asc' | 'desc';

interface BatchItemSelectorProps<T> {
  title: string;
  items: T[];
  getId: (item: T) => string;
  getLabel: (item: T) => string;
  // 썸네일 / 외부 invalidation 신호. 이번 단계에서는 받기만 하고 미사용.
  // C3에서 썸네일 카드 도입 시 활성화.
  getImage?: (item: T) => Promise<string | null>;
  imageRevision?: number;
  onConfirm: (selected: T[]) => void;
  onCancel?: () => void;
  confirmLabel?: string;
}

function BatchItemSelector<T>(props: BatchItemSelectorProps<T>): React.ReactElement {
  const { title, items, getId, getLabel, onConfirm, onCancel, confirmLabel } = props;

  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
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
    const selected = items.filter((it) => selectedIds.has(getId(it)));
    onConfirm(selected);
  }, [items, selectedIds, getId, onConfirm]);

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
            const selected = selectedIds.has(id);
            return (
              <button
                key={id}
                type="button"
                onClick={() => toggle(id)}
                className={
                  'touch-manipulation cursor-pointer p-2 border flex flex-col items-center w-20 md:w-32 select-none ' +
                  (selected
                    ? 'border-sky-500 bg-sky-100 dark:bg-slate-700'
                    : 'border-gray-400 dark:border-slate-500 bg-white dark:bg-slate-800 hover:brightness-95')
                }
              >
                <div className="h-12 w-full overflow-auto break-all text-sm text-left">
                  {getLabel(item)}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-none flex gap-2 pt-2">
        {onCancel && (
          <button
            type="button"
            className="rounded px-3 py-1 bg-gray-300 hover:bg-gray-400 dark:bg-slate-600 dark:hover:bg-slate-500"
            onClick={onCancel}
          >
            취소
          </button>
        )}
        <button
          type="button"
          className="ml-auto rounded px-3 py-1 bg-emerald-500 hover:bg-emerald-600 text-white"
          onClick={handleConfirm}
        >
          {confirmLabel ?? '작업 적용'}
        </button>
      </div>
    </div>
  );
}

export default BatchItemSelector;
