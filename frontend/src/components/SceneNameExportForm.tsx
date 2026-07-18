import { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { appState } from '../models/AppService';
import ModalOverlayCountMarker from './ModalOverlayCountMarker';

// 씬 이름 내보내기 특수문자 변환 폼. 예전: 대체문자 input → 특수문자 checkbox
// 2단계 다이얼로그. 신규: 한 폼에서 대체문자(text) + 변환할 특수문자(checkbox grid)
// 동시 입력. 감지된 chars 기본 전체 선택.
const SceneNameExportForm = observer(() => {
  const [replacement, setReplacement] = useState('_');
  const [checked, setChecked] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (appState.sceneNameExportFormOpen) {
      const chars = appState.sceneNameExportFormChars ?? new Set<string>();
      setReplacement('_');
      setChecked(new Set(chars));
    }
  }, [appState.sceneNameExportFormOpen]);

  if (!appState.sceneNameExportFormOpen) return null;

  const chars = appState.sceneNameExportFormChars ?? new Set<string>();
  const onCancel = () => appState.closeSceneNameExportForm(undefined);
  const onConfirm = () => {
    appState.closeSceneNameExportForm({
      replacement: replacement || '_',
      charsToReplace: new Set(checked),
    });
  };

  const toggle = (c: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  };

  const sortedChars = Array.from(chars).sort();
  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ zIndex: 'var(--z-blocking-modal)', backgroundColor: 'rgba(0,0,0,0.7)' }}
      onClick={onCancel}
    >
      <ModalOverlayCountMarker />
      <div
        className="bg-white dark:bg-slate-800 text-black dark:text-white rounded-md shadow-xl p-4 w-[92vw] max-w-md max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-3">
          <h2 className="text-lg font-bold">씬 이름 내보내기 — 특수문자 변환</h2>
          <button onClick={onCancel} className="text-2xl leading-none px-2">
            ×
          </button>
        </div>
        <div className="space-y-3">
          <label className="block">
            <span className="text-sm">대체 문자</span>
            <input
              type="text"
              className="w-full mt-1 px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-700"
              value={replacement}
              onChange={(e) => setReplacement(e.target.value)}
              maxLength={5}
              placeholder="_"
            />
            <span className="text-xs text-gray-500 dark:text-gray-400 mt-1 block">
              감지된 특수문자가 이 문자로 치환돼요. 빈 값이면 기본값 `_` 적용.
            </span>
          </label>
          <div>
            <div className="text-sm mb-1">변환할 특수문자 ({sortedChars.length}개 감지)</div>
            <div className="flex flex-wrap gap-2">
              {sortedChars.map((c) => (
                <label
                  key={c}
                  className="flex items-center gap-1.5 px-2 py-1 rounded bg-gray-100 dark:bg-slate-700 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={checked.has(c)}
                    onChange={() => toggle(c)}
                  />
                  <span className="text-sm font-mono">
                    {c === ' ' ? '띄어쓰기' : `"${c}"`}
                  </span>
                </label>
              ))}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-2">
              체크 해제한 문자는 그대로 유지돼요.
            </div>
          </div>
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
            내보내기
          </button>
        </div>
      </div>
    </div>
  );
});

export default SceneNameExportForm;
