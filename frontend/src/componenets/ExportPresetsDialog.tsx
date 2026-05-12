import { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { v4 } from 'uuid';
import { FaPlay, FaPlus, FaTimes, FaEdit, FaTrash } from 'react-icons/fa';
import { appState, ExportPreset } from '../models/AppService';

const DEFAULT_PRESET = (): ExportPreset => ({
  id: v4(),
  name: '새 프리셋',
  imageSelection: 'all',
  fileNameFormat: 'normal',
  prefixName: '',
  optimize: 'lossy',
  imageSize: 1024,
  separator: '.',
  charsToReplace: [],
});

const optimizeLabel: Record<ExportPreset['optimize'], string> = {
  original: '원본',
  lossy: '저손실 webp',
  lossless: '무손실 webp',
  avif: 'AVIF',
};

const ExportPresetsDialog = observer(() => {
  const [editing, setEditing] = useState<ExportPreset | null>(null);

  if (!appState.exportPresetsDialogOpen) return null;

  const type = appState.exportPresetsDialogType;
  const presets = appState.exportPresets;

  const close = () => {
    appState.exportPresetsDialogOpen = false;
    setEditing(null);
  };

  const onCreate = () => setEditing(DEFAULT_PRESET());

  const onSave = () => {
    if (!editing) return;
    const idx = appState.exportPresets.findIndex((p) => p.id === editing.id);
    if (idx >= 0) {
      const next = [...appState.exportPresets];
      next[idx] = editing;
      appState.exportPresets = next;
    } else {
      appState.exportPresets = [...appState.exportPresets, editing];
    }
    appState.saveExportPresets();
    setEditing(null);
  };

  const onDelete = (id: string) => {
    if (!confirm('이 프리셋을 삭제할까요?')) return;
    appState.exportPresets = appState.exportPresets.filter((p) => p.id !== id);
    appState.saveExportPresets();
  };

  const onApply = (preset: ExportPreset) => {
    close();
    appState.exportPackage(type, undefined, preset);
  };

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ zIndex: 5500, backgroundColor: 'rgba(0,0,0,0.7)' }}
      onClick={close}
    >
      <div
        className="bg-white dark:bg-slate-800 text-black dark:text-white rounded-md shadow-xl p-4 max-w-2xl w-[92vw] max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-3">
          <h2 className="text-lg font-bold">내보내기 프리셋</h2>
          <button onClick={close} className="text-2xl leading-none px-2">
            ×
          </button>
        </div>

        {editing ? (
          <PresetForm
            preset={editing}
            onChange={setEditing}
            onSave={onSave}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <>
            {presets.length === 0 ? (
              <div className="text-sm text-gray-500 mb-3">저장된 프리셋이 없어요.</div>
            ) : (
              <div className="space-y-2 mb-3">
                {presets.map((p) => (
                  <PresetRow
                    key={p.id}
                    preset={p}
                    onApply={() => onApply(p)}
                    onEdit={() => setEditing(p)}
                    onDelete={() => onDelete(p.id)}
                  />
                ))}
              </div>
            )}
            <button
              onClick={onCreate}
              className="w-full py-2 px-3 bg-sky-500 hover:bg-sky-600 text-white rounded flex items-center justify-center gap-2 text-sm"
            >
              <FaPlus size={12} />
              새 프리셋 추가
            </button>
          </>
        )}
      </div>
    </div>
  );
});

interface PresetRowProps {
  preset: ExportPreset;
  onApply: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

const PresetRow = ({ preset, onApply, onEdit, onDelete }: PresetRowProps) => {
  const summary: string[] = [];
  summary.push(preset.imageSelection === 'fav' ? '즐겨찾기' : '전체');
  summary.push(preset.fileNameFormat === 'prefix' && preset.prefixName ? `${preset.prefixName}.씬.번호` : '씬.번호');
  summary.push(optimizeLabel[preset.optimize]);
  if (preset.optimize !== 'original' && preset.imageSize) summary.push(`${preset.imageSize}px`);
  if (preset.separator && preset.separator !== '.') summary.push(`구분자 "${preset.separator}"`);
  if (preset.charsToReplace.length > 0) summary.push(`변환 ${preset.charsToReplace.length}자`);
  return (
    <div className="border border-gray-200 dark:border-slate-600 rounded p-3 flex items-center gap-2">
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm truncate">{preset.name}</div>
        <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 break-all">
          {summary.join(' · ')}
        </div>
      </div>
      <button
        onClick={onApply}
        className="px-2 py-1 bg-green-600 hover:bg-green-700 text-white rounded text-xs flex items-center gap-1 flex-shrink-0"
        title="이 프리셋으로 즉시 내보내기"
      >
        <FaPlay size={10} />
        적용
      </button>
      <button
        onClick={onEdit}
        className="px-2 py-1 bg-gray-500 hover:bg-gray-600 text-white rounded text-xs flex-shrink-0"
        title="편집"
      >
        <FaEdit size={10} />
      </button>
      <button
        onClick={onDelete}
        className="px-2 py-1 bg-red-500 hover:bg-red-600 text-white rounded text-xs flex-shrink-0"
        title="삭제"
      >
        <FaTrash size={10} />
      </button>
    </div>
  );
};

interface PresetFormProps {
  preset: ExportPreset;
  onChange: (p: ExportPreset) => void;
  onSave: () => void;
  onCancel: () => void;
}

const PresetForm = ({ preset, onChange, onSave, onCancel }: PresetFormProps) => {
  const charsText = preset.charsToReplace.join(',');
  return (
    <div className="space-y-3">
      <div>
        <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">프리셋 이름</label>
        <input
          type="text"
          className="w-full p-1.5 border border-gray-300 dark:border-slate-600 rounded bg-white dark:bg-slate-700 text-sm"
          value={preset.name}
          onChange={(e) => onChange({ ...preset, name: e.target.value })}
        />
      </div>

      <div>
        <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">이미지 선택</label>
        <select
          className="w-full p-1.5 border border-gray-300 dark:border-slate-600 rounded bg-white dark:bg-slate-700 text-sm"
          value={preset.imageSelection}
          onChange={(e) => onChange({ ...preset, imageSelection: e.target.value as 'fav' | 'all' })}
        >
          <option value="fav">즐겨찾기 이미지만</option>
          <option value="all">모든 이미지</option>
        </select>
      </div>

      <div>
        <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">파일 이름 형식</label>
        <select
          className="w-full p-1.5 border border-gray-300 dark:border-slate-600 rounded bg-white dark:bg-slate-700 text-sm"
          value={preset.fileNameFormat}
          onChange={(e) => onChange({ ...preset, fileNameFormat: e.target.value as 'normal' | 'prefix' })}
        >
          <option value="normal">(씬이름).(번호)</option>
          <option value="prefix">(캐릭터).(씬이름).(번호)</option>
        </select>
      </div>

      {preset.fileNameFormat === 'prefix' && (
        <div>
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">캐릭터 이름</label>
          <input
            type="text"
            className="w-full p-1.5 border border-gray-300 dark:border-slate-600 rounded bg-white dark:bg-slate-700 text-sm"
            value={preset.prefixName}
            onChange={(e) => onChange({ ...preset, prefixName: e.target.value })}
          />
        </div>
      )}

      <div>
        <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">최적화</label>
        <select
          className="w-full p-1.5 border border-gray-300 dark:border-slate-600 rounded bg-white dark:bg-slate-700 text-sm"
          value={preset.optimize}
          onChange={(e) => onChange({ ...preset, optimize: e.target.value as ExportPreset['optimize'] })}
        >
          <option value="original">원본 (압축 없음)</option>
          <option value="lossy">저손실 webp (에셋용 권장)</option>
          <option value="lossless">무손실 webp</option>
          <option value="avif">AVIF</option>
        </select>
      </div>

      {preset.optimize !== 'original' && (
        <div>
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">이미지 픽셀 크기 (추천 1024)</label>
          <input
            type="number"
            min={64}
            max={4096}
            className="w-full p-1.5 border border-gray-300 dark:border-slate-600 rounded bg-white dark:bg-slate-700 text-sm"
            value={preset.imageSize}
            onChange={(e) => {
              const n = parseInt(e.target.value) || 0;
              onChange({ ...preset, imageSize: Math.max(0, Math.min(4096, n)) });
            }}
          />
        </div>
      )}

      <div>
        <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">파일명 구분자 (기본 ".")</label>
        <input
          type="text"
          className="w-full p-1.5 border border-gray-300 dark:border-slate-600 rounded bg-white dark:bg-slate-700 text-sm"
          value={preset.separator}
          onChange={(e) => onChange({ ...preset, separator: e.target.value })}
        />
      </div>

      <div>
        <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
          변환할 특수문자 (콤마로 구분, 예: " ,-")
        </label>
        <input
          type="text"
          className="w-full p-1.5 border border-gray-300 dark:border-slate-600 rounded bg-white dark:bg-slate-700 text-sm font-mono"
          value={charsText}
          onChange={(e) => {
            const chars = e.target.value
              .split(',')
              .map((c) => c)
              .filter((c) => c.length > 0);
            onChange({ ...preset, charsToReplace: chars });
          }}
          placeholder="(없으면 비워두기)"
        />
        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          여기 적힌 문자가 씬 이름에 있으면 구분자로 변환됨. 빈 입력이면 변환 없음.
        </div>
      </div>

      <div className="flex gap-2 justify-end pt-2">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 bg-gray-500 hover:bg-gray-600 text-white rounded text-sm flex items-center gap-1"
        >
          <FaTimes size={10} />
          취소
        </button>
        <button
          onClick={onSave}
          className="px-3 py-1.5 bg-sky-500 hover:bg-sky-600 text-white rounded text-sm"
        >
          저장
        </button>
      </div>
    </div>
  );
};

export default ExportPresetsDialog;
