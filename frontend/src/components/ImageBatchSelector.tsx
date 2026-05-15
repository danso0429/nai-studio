import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

// 이미지 다중 선택 + 액션 일괄 적용 전용 overlay. 본인 페인 (D1, P12 #8 + P13):
// 기존 ResultViewer in-place select mode 토글이 모바일에서 0.5초 hang 유발 → 1차
// 재설계(3a37ab4)로 전용 컴포넌트 swap + react-window 가상화 박았지만 본인 환경
// 0.5초 잔존.
//
// 본인 단서 (P13 L3): "씬 선택창(BatchItemSelector)에서 고쳐진 걸 참고". 진단 결과
// BatchItemSelector는 가상화 없이 flex-wrap + Thumbnail skeleton 패턴이라 iOS
// Safari에서 portal mount + Grid reconcile + cell 18~24 paint 단계 없음. 같은
// 패턴으로 ImageBatchSelector 재작성 — react-window 제거 + CSS grid + img native
// lazy/async decoding. 모든 cell mount이지만 brower native layout이 react-window
// reconcile보다 빠른 게 본인 환경 측정 결과.

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
  // 썸네일 크기 px (서버 thumb 요청 size). P13 initialThumbSize 값 받음.
  thumbSize?: number;
}

interface ImageCellProps {
  path: string;
  thumbSize: number;
  selected: boolean;
  onToggle: (path: string) => void;
  isMain: boolean;
  isBookmarked: boolean;
}

function ImageCellInner({
  path,
  thumbSize,
  selected,
  onToggle,
  isMain,
  isBookmarked,
}: ImageCellProps): React.ReactElement {
  const handleClick = useCallback(() => onToggle(path), [path, onToggle]);
  // src를 useEffect로 deferred — 첫 commit엔 skeleton만, paint 후 useEffect
  // fire → setSrc로 img mount. BatchItemSelector Thumbnail 패턴 그대로 채용
  // (P13 L3 본인 단서). 60+ cell 첫 paint는 빈 skeleton만이라 빠름.
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    setSrc(getThumbURL(path, thumbSize));
  }, [path, thumbSize]);
  return (
    <button
      type="button"
      onClick={handleClick}
      className={
        'relative aspect-square touch-manipulation cursor-pointer rounded overflow-hidden ' +
        (selected
          ? 'ring-2 ring-sky-500 bg-sky-50 dark:bg-sky-900/30'
          : 'bg-gray-100 dark:bg-slate-800 border border-gray-300 dark:border-slate-600')
      }
    >
      {src ? (
        <img
          src={src}
          draggable={false}
          decoding="async"
          loading="lazy"
          className="w-full h-full object-contain bg-checkboard"
          alt=""
        />
      ) : (
        <div className="w-full h-full bg-gray-200 dark:bg-slate-600 animate-pulse" />
      )}
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
        {selected ? <FaCheckSquare /> : <FaRegSquare className="opacity-60" />}
      </div>
      {selected && (
        <div className="absolute inset-0 bg-sky-500/20 pointer-events-none" />
      )}
    </button>
  );
}
const ImageCell = memo(ImageCellInner);

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

  // 안정 stable toggle — useCallback([])로 memo(ImageCell) 무효화 회피.
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

  // isMainImage / bookmarkedImagePath는 prop으로 받지만 ImageCell엔 boolean으로
  // 풀어서 전달 — function reference 변경 시 memo 무효화 회피.
  const mainSet = useMemo(() => {
    if (!isMainImage) return null;
    const s = new Set<string>();
    for (const p of imagePaths) if (isMainImage(p)) s.add(p);
    return s;
  }, [imagePaths, isMainImage]);

  const effectiveThumbSize = thumbSize ?? (isMobile ? 200 : 240);

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
      <div className="flex-1 overflow-y-auto p-1">
        {imagePaths.length === 0 ? (
          <div className="w-full h-full flex items-center justify-center text-gray-500 dark:text-gray-400">
            이미지가 없습니다
          </div>
        ) : (
          <div
            className={
              'grid gap-1 ' +
              (isMobile
                ? 'grid-cols-3'
                : 'grid-cols-4 md:grid-cols-5 lg:grid-cols-6')
            }
          >
            {imagePaths.map((path) => (
              <ImageCell
                key={path}
                path={path}
                thumbSize={effectiveThumbSize}
                selected={selected.has(path)}
                onToggle={toggleSelect}
                isMain={!!(mainSet && mainSet.has(path))}
                isBookmarked={bookmarkedImagePath === path}
              />
            ))}
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
