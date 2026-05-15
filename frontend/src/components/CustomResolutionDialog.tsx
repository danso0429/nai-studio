import { useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { appState } from '../models/AppService';

// 커스텀 해상도 입력 폼. width/height를 한 다이얼로그에서 동시 입력 (예전: 너비 →
// 높이 2단계 다이얼로그가 SceneEditor/InPaintEditor/onSceneQueueMenu 3곳에 중복).
// 헬퍼에서 64 배수 round-up까지 처리해 호출처 단순화.
const CustomResolutionDialog = observer(() => {
  const [width, setWidth] = useState('');
  const [height, setHeight] = useState('');
  const widthRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (appState.customResolutionDialogOpen) {
      const d = appState.customResolutionDialogDefaults;
      setWidth(d?.width ? String(d.width) : '');
      setHeight(d?.height ? String(d.height) : '');
      // autofocus — 모바일에서 키보드 즉시 올라옴.
      setTimeout(() => widthRef.current?.focus(), 50);
    }
  }, [appState.customResolutionDialogOpen]);

  if (!appState.customResolutionDialogOpen) return null;

  const onCancel = () => appState.closeCustomResolutionDialog(undefined);
  const onConfirm = () => {
    const w = parseInt(width);
    const h = parseInt(height);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
      appState.pushMessage('너비/높이를 숫자로 입력해주세요');
      return;
    }
    // 64 배수 round-up — NAI 모델 요구사항. 3곳 callsite에서 중복하던 걸 헬퍼로 흡수.
    appState.closeCustomResolutionDialog({
      width: (w + 63) & ~63,
      height: (h + 63) & ~63,
    });
  };

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ zIndex: 5500, backgroundColor: 'rgba(0,0,0,0.7)' }}
      onClick={onCancel}
    >
      <div
        className="bg-white dark:bg-slate-800 text-black dark:text-white rounded-md shadow-xl p-4 w-[92vw] max-w-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-3">
          <h2 className="text-lg font-bold">커스텀 해상도</h2>
          <button onClick={onCancel} className="text-2xl leading-none px-2">
            ×
          </button>
        </div>
        <div className="space-y-3">
          <label className="block">
            <span className="text-sm">너비 (px)</span>
            <input
              ref={widthRef}
              type="number"
              inputMode="numeric"
              className="w-full mt-1 px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-700"
              value={width}
              onChange={(e) => setWidth(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  // 너비 enter → 높이 input으로 포커스 이동 (모바일 next button 대응)
                  const next = e.currentTarget.parentElement?.parentElement?.querySelectorAll('input')[1];
                  (next as HTMLInputElement | undefined)?.focus();
                }
              }}
            />
          </label>
          <label className="block">
            <span className="text-sm">높이 (px)</span>
            <input
              type="number"
              inputMode="numeric"
              className="w-full mt-1 px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-700"
              value={height}
              onChange={(e) => setHeight(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  onConfirm();
                }
              }}
            />
          </label>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            입력값은 64 배수로 올림돼요 (NAI 모델 요구사항).
          </p>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-slate-700"
          >
            취소
          </button>
          <button
            onClick={onConfirm}
            className="px-3 py-1.5 rounded bg-sky-500 text-white hover:bg-sky-600"
          >
            확인
          </button>
        </div>
      </div>
    </div>
  );
});

export default CustomResolutionDialog;
