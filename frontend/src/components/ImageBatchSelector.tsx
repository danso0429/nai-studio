import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FixedSizeGrid as Grid, GridChildComponentProps, areEqual } from 'react-window';
import {
  FaCheck,
  FaCheckSquare,
  FaCopy,
  FaDownload,
  FaRegSquare,
  FaStar,
  FaTimes,
  FaTrash,
} from 'react-icons/fa';
import { isMobile } from '../models';
import { getThumbURL } from '../backends/serverBackend';
import { CustomScrollbars } from './UtilComponents';

// 이미지 다중 선택 + 액션 일괄 적용 전용 overlay. 본인 페인 (D1, P12 #8): 기존
// ResultViewer in-place select mode 토글이 모바일에서 0.5초 hang 유발 — 토글 시
// 부모 ResultViewer + Tooltip 다수 + ImageGallery + 모든 Cell까지 재구성 chain.
//
// BatchItemSelector swap (P12 #6) 패턴 그대로 적용 — 전용 overlay 컴포넌트 + 4축
// 흡수 (touch-manipulation / mount refresh 없음 / Set<string> 검사 / Cell memo +
// stable callbacks). selection state는 overlay 안에서만 살아 ResultViewer는 mode
// 전환 자체를 모름 → 토글 hang 원천 제거.

export interface ImageBatchAction {
  // 버튼 라벨/툴팁
  label: string;
  // 아이콘 (react-icons)
  icon: React.ReactNode;
  // tailwind background class
  back: string;
  // 0건일 때 disable 할지 (false면 0건이어도 활성, 콜백은 0건 길이 받음)
  requiresSelection?: boolean;
  // 호출: 선택된 절대 경로 array 그대로 전달
  onAction: (selectedPaths: string[]) => void | Promise<void>;
  // 호출 후 selector 닫을지
  closeAfter?: boolean;
}

export interface ImageBatchSelectorProps {
  title: string;
  // 표시할 이미지 절대 경로 array (썸네일 URL 생성용).
  imagePaths: string[];
  // 처음 선택 상태 (옵션, 없으면 빈 Set).
  initialSelected?: Set<string>;
  // 액션 버튼 list — 하단 toolbar에 row로 렌더.
  actions: ImageBatchAction[];
  // 닫기 콜백 (Float 헤더 X + Escape).
  onClose: () => void;
  // 즐겨찾기 표시용 (옵션).
  isMainImage?: (path: string) => boolean;
  // 북마크 표시용 (옵션).
  bookmarkedImagePath?: string;
  // 썸네일 크기 px. 모바일 viewport에 맞춰 cell 폭/높이 계산.
  thumbSize?: number;
}

interface CellData {
  paths: string[];
  selected: Set<string>;
  toggleSelect: (path: string) => void;
  columnCount: number;
  thumbSize: number;
  isMainImage?: (path: string) => boolean;
  bookmarkedImagePath?: string;
}

function CellInner({ rowIndex, columnIndex, style, data }: GridChildComponentProps) {
  const d = data as CellData;
  const index = rowIndex * d.columnCount + columnIndex;
  const path = d.paths[index];
  if (!path) return <div style={style} />;
  const isSel = d.selected.has(path);
  const isMain = !!(d.isMainImage && d.isMainImage(path));
  const isBookmarked = d.bookmarkedImagePath === path;
  const thumbSrc = getThumbURL(path, d.thumbSize);
  return (
    <div style={style} className="p-1">
      <button
        type="button"
        onClick={() => d.toggleSelect(path)}
        className={
          'relative w-full h-full touch-manipulation cursor-pointer rounded overflow-hidden ' +
          (isSel
            ? 'ring-2 ring-sky-500 bg-sky-50 dark:bg-sky-900/30'
            : 'bg-gray-100 dark:bg-slate-800 border border-gray-300 dark:border-slate-600')
        }
      >
        <img
          src={thumbSrc}
          draggable={false}
          className="w-full h-full object-contain bg-checkboard"
          alt=""
        />
        {isMain && (
          <div className="absolute left-1 top-1 text-yellow-400 drop-shadow text-sm">
            <FaStar />
          </div>
        )}
        {isBookmarked && (
          <div className="absolute right-1 top-1 text-orange-500 drop-shadow text-sm">
            <FaCheck />
          </div>
        )}
        {/* 선택 indicator — 우하단 체크박스 + 선택 시 sky tint */}
        <div className="absolute right-1 bottom-1 text-white drop-shadow-lg text-lg">
          {isSel ? <FaCheckSquare /> : <FaRegSquare className="opacity-60" />}
        </div>
        {isSel && (
          <div className="absolute inset-0 bg-sky-500/20 pointer-events-none" />
        )}
      </button>
    </div>
  );
}
const Cell = memo(CellInner, areEqual);

const CustomScrollbarsVirtualGrid = memo(
  React.forwardRef((props: any, ref) => (
    <CustomScrollbars {...props} forwardedRef={ref} />
  )),
);

function ImageBatchSelector({
  title,
  imagePaths,
  initialSelected,
  actions,
  onClose,
  isMainImage,
  bookmarkedImagePath,
  thumbSize,
}: ImageBatchSelectorProps): React.ReactElement {
  // selection은 Set<string>으로 O(1) has 검사. 초기값은 prop의 sparse copy.
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(initialSelected ?? []),
  );

  // 컨테이너 크기 측정 — ResizeObserver로 mount + 회전 대응.
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        setContainerSize({ w: e.contentRect.width, h: e.contentRect.height });
      }
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // 썸네일 cell 폭/높이. 모바일은 화면 1/3, 데스크탑은 prop 또는 200.
  const baseSize = thumbSize ?? (isMobile ? 200 : 240);
  const cellSize = isMobile ? Math.min(baseSize, Math.floor(containerSize.w / 3) - 8) : baseSize;
  const columnCount = Math.max(1, Math.floor(containerSize.w / cellSize));
  const rowCount = Math.ceil(imagePaths.length / columnCount);

  // 안정 stable toggle — useCallback([]) + ref로 selected 최신 접근. 매 render 새
  // closure 만들면 memo(Cell)이 무효화 → 모든 cell 재렌더. P12 #6 4축 흡수.
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const toggleSelect = useCallback((path: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelected(new Set(imagePaths));
  }, [imagePaths]);
  const clearAll = useCallback(() => setSelected(new Set()), []);

  // memoizeOne 없이 useMemo로 itemData stable 유지. 모든 dep이 stable이면 동일 ref.
  const itemData = useMemo<CellData>(
    () => ({
      paths: imagePaths,
      selected,
      toggleSelect,
      columnCount,
      thumbSize: cellSize,
      isMainImage,
      bookmarkedImagePath,
    }),
    [imagePaths, selected, toggleSelect, columnCount, cellSize, isMainImage, bookmarkedImagePath],
  );

  // 액션 실행 wrapper — 선택 array snapshot으로 콜백 호출, closeAfter true면 닫음.
  const runAction = useCallback(
    async (action: ImageBatchAction) => {
      const selectedPaths = Array.from(selectedRef.current);
      if (action.requiresSelection !== false && selectedPaths.length === 0) {
        return;
      }
      await action.onAction(selectedPaths);
      if (action.closeAfter) onClose();
    },
    [onClose],
  );

  return (
    <div className="touch-manipulation w-full h-full flex flex-col bg-white dark:bg-slate-900 text-default">
      <div className="flex-none flex items-center gap-2 px-3 py-2 border-b line-color">
        <span className="font-bold text-lg truncate flex-1">{title}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="닫기"
          className="p-1 rounded hover:bg-gray-100 dark:hover:bg-slate-700"
        >
          <FaTimes size={18} />
        </button>
      </div>
      <div className="flex-none flex items-center gap-2 px-3 py-2 border-b line-color flex-wrap">
        <button
          type="button"
          className="touch-manipulation round-button back-sky text-sm"
          onClick={selectAll}
        >
          모두 선택
        </button>
        <button
          type="button"
          className="touch-manipulation round-button back-gray text-sm"
          onClick={clearAll}
        >
          모두 해제
        </button>
        <span className="ml-2 text-sm text-gray-600 dark:text-gray-300">
          {selected.size} / {imagePaths.length} 선택됨
        </span>
      </div>
      <div ref={containerRef} className="flex-1 overflow-hidden">
        {containerSize.w > 0 && containerSize.h > 0 && imagePaths.length > 0 && (
          <Grid
            columnCount={columnCount}
            columnWidth={cellSize}
            height={containerSize.h}
            rowCount={rowCount}
            rowHeight={cellSize}
            width={containerSize.w}
            itemData={itemData}
            outerElementType={CustomScrollbarsVirtualGrid}
            overscanRowCount={isMobile ? 2 : 4}
          >
            {Cell}
          </Grid>
        )}
        {imagePaths.length === 0 && (
          <div className="w-full h-full flex items-center justify-center text-gray-500 dark:text-gray-400">
            이미지가 없습니다
          </div>
        )}
      </div>
      <div className="flex-none flex items-center gap-2 px-3 py-2 border-t line-color flex-wrap">
        {actions.map((a, i) => (
          <button
            key={i}
            type="button"
            disabled={
              a.requiresSelection !== false && selected.size === 0
            }
            className={
              'touch-manipulation round-button text-sm inline-flex items-center gap-1 ' +
              a.back +
              ' disabled:opacity-40 disabled:cursor-not-allowed'
            }
            onClick={() => runAction(a)}
          >
            {a.icon} {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default ImageBatchSelector;

// 기본 액션 helper들 — caller가 적절히 조합해서 actions array 빌드 가능. 본인이
// 사용하는 경우 ResultViewer side에서 직접 inline. helper는 일반적 패턴 도큐먼트.
export const DefaultActionIcons = {
  delete: <FaTrash />,
  favorite: <FaStar />,
  download: <FaDownload />,
  copy: <FaCopy />,
};
