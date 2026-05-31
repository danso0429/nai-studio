import * as React from 'react';
import { useState } from 'react';
import { observer } from 'mobx-react-lite';
import {
  FaTrash,
  FaEdit,
  FaCheck,
  FaSave,
  FaSync,
  FaPlus,
  FaArrowLeft,
  FaStar,
  FaGlobe,
  FaSlidersH,
} from 'react-icons/fa';
import ModalOverlay from './ModalOverlay';
import { samplingPresetService } from '../models';
import { appState } from '../models/AppService';
import {
  ISamplingPreset,
  ISamplingPresetFields,
  isSamplingPresetEmpty,
} from '../models/SamplingPresetService';
import { Sampling, NoiseSchedule } from '../backends/imageGen';

const SAMPLER_LABELS: Record<string, string> = {
  [Sampling.KEulerAncestral]: 'Euler Ancestral',
  [Sampling.KEuler]: 'Euler',
  [Sampling.KDPMPP2SAncestral]: 'DPM++ 2S Ancestral',
  [Sampling.KDPMPP2MSDE]: 'DPM++ 2M SDE',
  [Sampling.KDPMPP2M]: 'DPM++ 2M',
  [Sampling.KDPMPPSDE]: 'DPM++ SDE',
  [Sampling.DDIM]: 'DDIM',
};

const NOISE_SCHEDULE_LABELS: Record<string, string> = {
  [NoiseSchedule.Native]: 'Native',
  [NoiseSchedule.Karras]: 'Karras',
  [NoiseSchedule.Exponential]: 'Exponential',
  [NoiseSchedule.Polyexponential]: 'Polyexponential',
};

// 묶음 → 한 줄 요약 (목록/배너 미리보기 공용)
function summarize(p: ISamplingPresetFields): string {
  const parts = [
    p.steps != null && `스텝 ${p.steps}`,
    p.promptGuidance != null && `가이던스 ${p.promptGuidance}`,
    p.cfgRescale != null && `리스케일 ${p.cfgRescale}`,
    p.sampling != null && (SAMPLER_LABELS[p.sampling] ?? p.sampling),
    p.noiseSchedule != null && (NOISE_SCHEDULE_LABELS[p.noiseSchedule] ?? p.noiseSchedule),
  ].filter(Boolean);
  return parts.join(' · ');
}

// ─── 편집/신규 폼 ────────────────────────────────────────────
interface SamplingPresetFormProps {
  initialName: string;
  initialFields?: ISamplingPresetFields;
  isNew: boolean;
  onSave: (name: string, fields: ISamplingPresetFields) => void;
  onCancel: () => void;
}

const SamplingPresetForm = observer(
  ({ initialName, initialFields, isNew, onSave, onCancel }: SamplingPresetFormProps) => {
    const [name, setName] = useState(initialName);

    const [stepsEnabled, setStepsEnabled] = useState(initialFields?.steps != null);
    const [stepsStr, setStepsStr] = useState(initialFields?.steps != null ? String(initialFields.steps) : '');
    const [guidanceEnabled, setGuidanceEnabled] = useState(initialFields?.promptGuidance != null);
    const [guidanceStr, setGuidanceStr] = useState(initialFields?.promptGuidance != null ? String(initialFields.promptGuidance) : '');
    const [rescaleEnabled, setRescaleEnabled] = useState(initialFields?.cfgRescale != null);
    const [rescaleStr, setRescaleStr] = useState(initialFields?.cfgRescale != null ? String(initialFields.cfgRescale) : '');
    const [samplerEnabled, setSamplerEnabled] = useState(initialFields?.sampling != null);
    const [sampler, setSampler] = useState(initialFields?.sampling ?? Sampling.KEulerAncestral);
    const [scheduleEnabled, setScheduleEnabled] = useState(initialFields?.noiseSchedule != null);
    const [schedule, setSchedule] = useState(initialFields?.noiseSchedule ?? NoiseSchedule.Karras);

    const parseNum = (s: string): number | undefined => {
      const trimmed = s.trim();
      if (!trimmed) return undefined;
      const n = Number(trimmed);
      return isNaN(n) ? undefined : n;
    };

    const buildFields = (): ISamplingPresetFields => {
      const o: ISamplingPresetFields = {};
      if (stepsEnabled) { const v = parseNum(stepsStr); if (v != null) o.steps = v; }
      if (guidanceEnabled) { const v = parseNum(guidanceStr); if (v != null) o.promptGuidance = v; }
      if (rescaleEnabled) { const v = parseNum(rescaleStr); if (v != null) o.cfgRescale = v; }
      if (samplerEnabled) o.sampling = sampler;
      if (scheduleEnabled) o.noiseSchedule = schedule;
      return o;
    };

    const handleSave = () => {
      if (!name.trim()) {
        appState.pushMessage('샘플링 프리셋 이름을 입력해주세요');
        return;
      }
      const fields = buildFields();
      if (isSamplingPresetEmpty(fields)) {
        appState.pushMessage('항목을 하나 이상 체크해주세요');
        return;
      }
      onSave(name, fields);
    };

    const inputClass = 'w-full px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-700 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400';

    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center">
          <button
            className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
            onClick={onCancel}
          >
            <FaArrowLeft size={12} />
            돌아가기
          </button>
        </div>
        <div>
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 block">
            샘플링 프리셋 이름 *
          </label>
          <input
            type="text"
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="예: 부드러운 라인"
          />
        </div>

        <div className="border-t border-gray-200 dark:border-gray-600 pt-3">
          <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">
            체크한 항목만 적용 시 덮어써요. 체크 해제한 항목은 프로젝트 설정 그대로.
          </div>
          <div className="flex flex-col gap-2">
            {/* 스텝 수 */}
            <div className="flex items-center gap-2">
              <input type="checkbox" checked={stepsEnabled} onChange={(e) => setStepsEnabled(e.target.checked)} />
              <span className="text-sm w-40 flex-none">스텝 수</span>
              <input
                type="text" inputMode="numeric"
                className={inputClass + ' flex-1'}
                placeholder="1~50"
                value={stepsStr} onChange={(e) => setStepsStr(e.target.value)}
                disabled={!stepsEnabled}
              />
            </div>
            {/* 프롬프트 가이던스 */}
            <div className="flex items-center gap-2">
              <input type="checkbox" checked={guidanceEnabled} onChange={(e) => setGuidanceEnabled(e.target.checked)} />
              <span className="text-sm w-40 flex-none">프롬프트 가이던스</span>
              <input
                type="text" inputMode="decimal"
                className={inputClass + ' flex-1'}
                placeholder="0~10"
                value={guidanceStr} onChange={(e) => setGuidanceStr(e.target.value)}
                disabled={!guidanceEnabled}
              />
            </div>
            {/* Prompt Guidance Rescale */}
            <div className="flex items-center gap-2">
              <input type="checkbox" checked={rescaleEnabled} onChange={(e) => setRescaleEnabled(e.target.checked)} />
              <span className="text-sm w-40 flex-none">Prompt Guidance Rescale</span>
              <input
                type="text" inputMode="decimal"
                className={inputClass + ' flex-1'}
                placeholder="0~1"
                value={rescaleStr} onChange={(e) => setRescaleStr(e.target.value)}
                disabled={!rescaleEnabled}
              />
            </div>
            {/* 샘플러 */}
            <div className="flex items-center gap-2">
              <input type="checkbox" checked={samplerEnabled} onChange={(e) => setSamplerEnabled(e.target.checked)} />
              <span className="text-sm w-40 flex-none">샘플러</span>
              <select
                className={inputClass + ' flex-1'}
                value={sampler} onChange={(e) => setSampler(e.target.value)}
                disabled={!samplerEnabled}
              >
                {Object.values(Sampling).map((v) => (
                  <option key={v} value={v}>{SAMPLER_LABELS[v] ?? v}</option>
                ))}
              </select>
            </div>
            {/* 노이즈 스케줄 */}
            <div className="flex items-center gap-2">
              <input type="checkbox" checked={scheduleEnabled} onChange={(e) => setScheduleEnabled(e.target.checked)} />
              <span className="text-sm w-40 flex-none">노이즈 스케줄</span>
              <select
                className={inputClass + ' flex-1'}
                value={schedule} onChange={(e) => setSchedule(e.target.value)}
                disabled={!scheduleEnabled}
              >
                {Object.values(NoiseSchedule).map((v) => (
                  <option key={v} value={v}>{NOISE_SCHEDULE_LABELS[v] ?? v}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="flex gap-2 pt-2 border-t border-gray-200 dark:border-gray-600">
          <button
            className="flex-1 px-4 py-2 rounded-lg bg-indigo-500 hover:bg-indigo-600 text-white text-sm font-medium transition-colors"
            onClick={handleSave}
          >
            <FaCheck className="inline mr-1.5" size={11} />
            {isNew ? '프리셋 추가' : '프리셋 저장'}
          </button>
          <button
            className="flex-1 px-4 py-2 rounded-lg bg-gray-200 dark:bg-slate-600 hover:bg-gray-300 dark:hover:bg-slate-500 text-gray-700 dark:text-gray-200 text-sm transition-colors"
            onClick={onCancel}
          >
            취소
          </button>
        </div>
      </div>
    );
  },
);

// ─── 다이얼로그 본체 ─────────────────────────────────────────
interface SamplingPresetDialogProps {
  isOpen: boolean;
  onClose: () => void;
  getCurrent: () => ISamplingPresetFields;
  onApply: (presetId: string) => void;
}

type DialogMode =
  | { kind: 'list' }
  | { kind: 'new' }
  | { kind: 'edit'; id: string };

export const SamplingPresetDialog = observer(
  ({ isOpen, onClose, getCurrent, onApply }: SamplingPresetDialogProps) => {
    const [mode, setMode] = useState<DialogMode>({ kind: 'list' });
    const [newName, setNewName] = useState('');
    const presets = samplingPresetService.list();

    const handleSaveFromCurrent = () => {
      const name = newName.trim();
      if (!name) {
        appState.pushMessage('샘플링 프리셋 이름을 입력해주세요');
        return;
      }
      const fields = getCurrent();
      if (isSamplingPresetEmpty(fields)) {
        appState.pushMessage('현재 샘플링 설정이 비어 있어요');
        return;
      }
      try {
        const entry = samplingPresetService.add(name, fields);
        setNewName('');
        appState.setAppliedSamplingPreset(entry.id);
        appState.pushMessage(`"${entry.name}" 샘플링 프리셋 저장됨`);
      } catch (e) {
        appState.pushMessage((e as Error).message);
      }
    };

    const globalPresetId = appState.globalSamplingPresetId;

    const handleApplyGlobal = (preset: ISamplingPreset) => {
      const currentGlobal = globalPresetId
        ? samplingPresetService.get(globalPresetId)
        : undefined;
      if (currentGlobal && currentGlobal.id !== preset.id) {
        appState.pushDialog({
          type: 'confirm',
          text: `현재 "${currentGlobal.name}" 샘플링 프리셋이 기본 적용 중입니다.\n"${preset.name}"(으)로 변경하시겠습니까?`,
          callback: async () => {
            onClose();
            appState.pushMessage(`"${preset.name}" 기본 샘플링 프리셋으로 설정됨 (모든 프로젝트)`);
            await appState.setGlobalSamplingPreset(preset.id);
          },
        });
        return;
      }
      onClose();
      appState.pushMessage(`"${preset.name}" 기본 샘플링 프리셋으로 설정됨 (모든 프로젝트)`);
      appState.setGlobalSamplingPreset(preset.id);
    };

    const handleApplyProject = (preset: ISamplingPreset) => {
      onClose();
      onApply(preset.id);
      appState.pushMessage(`"${preset.name}" 이 프로젝트에 적용됨`);
    };

    const handleOverwrite = (preset: ISamplingPreset) => {
      appState.pushDialog({
        type: 'confirm',
        text: `"${preset.name}" 샘플링 프리셋을 현재 설정값으로 덮어쓸까요?`,
        callback: () => {
          const fields = getCurrent();
          if (isSamplingPresetEmpty(fields)) {
            appState.pushMessage('현재 샘플링 설정이 비어 있어요');
            return;
          }
          try {
            samplingPresetService.update(preset.id, fields);
            appState.setAppliedSamplingPreset(preset.id);
            appState.pushMessage(`"${preset.name}" 덮어씀`);
          } catch (e) {
            appState.pushMessage((e as Error).message);
          }
        },
      });
    };

    const handleDelete = (preset: ISamplingPreset) => {
      appState.pushDialog({
        type: 'confirm',
        text: `"${preset.name}" 샘플링 프리셋을 삭제할까요?`,
        callback: async () => {
          if (appState.appliedSamplingPreset === preset.id) {
            appState.clearAppliedSamplingPreset();
          }
          if (globalPresetId === preset.id) {
            await appState.clearGlobalSamplingPreset();
          }
          samplingPresetService.delete(preset.id);
          appState.pushMessage(`"${preset.name}" 삭제됨`);
        },
      });
    };

    if (!isOpen) return null;

    // ─── 신규 작성 모드 ─────────────────────────────────────
    if (mode.kind === 'new') {
      return (
        <ModalOverlay
          isOpen={true}
          onClose={onClose}
          title="샘플링 프리셋 — 새 프리셋"
          width="max-w-2xl"
        >
          <div className="text-default">
            <SamplingPresetForm
              initialName={newName.trim()}
              initialFields={getCurrent()}
              isNew={true}
              onSave={(name, fields) => {
                try {
                  const entry = samplingPresetService.add(name, fields);
                  setNewName('');
                  appState.pushMessage(`"${entry.name}" 샘플링 프리셋 저장됨`);
                  setMode({ kind: 'list' });
                } catch (e) {
                  appState.pushMessage((e as Error).message);
                }
              }}
              onCancel={() => setMode({ kind: 'list' })}
            />
          </div>
        </ModalOverlay>
      );
    }

    // ─── 편집 모드 ───────────────────────────────────────────
    if (mode.kind === 'edit') {
      const target = samplingPresetService.get(mode.id);
      if (!target) {
        setMode({ kind: 'list' });
        return null;
      }
      return (
        <ModalOverlay
          isOpen={true}
          onClose={onClose}
          title={`샘플링 프리셋 — "${target.name}" 편집`}
          width="max-w-2xl"
        >
          <div className="text-default">
            <SamplingPresetForm
              initialName={target.name}
              initialFields={target}
              isNew={false}
              onSave={(name, fields) => {
                try {
                  if (name.trim() !== target.name) {
                    samplingPresetService.rename(target.id, name);
                  }
                  samplingPresetService.update(target.id, fields);
                  appState.pushMessage(`"${name.trim()}" 저장됨`);
                  setMode({ kind: 'list' });
                } catch (e) {
                  appState.pushMessage((e as Error).message);
                }
              }}
              onCancel={() => setMode({ kind: 'list' })}
            />
          </div>
        </ModalOverlay>
      );
    }

    // ─── 목록 모드 (default) ─────────────────────────────────
    return (
      <ModalOverlay
        isOpen={true}
        onClose={onClose}
        title="샘플링 프리셋"
        width="max-w-2xl"
      >
        <div className="text-default flex flex-col gap-3">
          {/* 안내 */}
          <div className="text-xs text-gray-500 dark:text-gray-400">
            스텝/가이던스/리스케일/샘플러/노이즈 스케줄을 묶어서 저장. 적용하면 생성 시 그 값이 쓰여요.
            <br />
            <strong>기본 적용</strong> = 모든 프로젝트에 적용 (껐다 켜도 유지) · <strong>프로젝트 적용</strong> = 이 프로젝트만
          </div>

          {/* 새 프리셋 추가 */}
          <div className="p-3 border border-gray-200 dark:border-gray-600 rounded-lg flex flex-col gap-2">
            <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
              새 프리셋 추가
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-700 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                placeholder="이름 (예: 부드러운 라인)"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveFromCurrent();
                }}
              />
              <button
                className="px-4 py-2 rounded-lg bg-indigo-500 hover:bg-indigo-600 text-white text-sm font-medium transition-colors whitespace-nowrap"
                onClick={handleSaveFromCurrent}
              >
                <FaSave className="inline mr-1.5" size={11} />
                현재 값으로 저장
              </button>
            </div>
            <button
              className="w-full px-4 py-2 rounded-lg bg-gray-200 dark:bg-slate-600 hover:bg-gray-300 dark:hover:bg-slate-500 text-gray-700 dark:text-gray-200 text-sm font-medium transition-colors flex items-center justify-center gap-1.5"
              onClick={() => setMode({ kind: 'new' })}
            >
              <FaPlus size={11} />
              직접 작성으로 새 프리셋 만들기
            </button>
          </div>

          {/* 리스트 */}
          {presets.length === 0 ? (
            <div className="text-center py-8 text-gray-500 dark:text-gray-400 text-sm">
              저장된 샘플링 프리셋이 없습니다
            </div>
          ) : (
            <div className="flex flex-col gap-2 max-h-[55vh] overflow-y-auto">
              {presets.map((preset) => {
                const isApplied = appState.appliedSamplingPreset === preset.id;
                return (
                  <div
                    key={preset.id}
                    className={`p-3 border rounded-lg transition-colors ${
                      isApplied
                        ? 'border-indigo-400 bg-indigo-50 dark:bg-indigo-900/20'
                        : 'border-gray-200 dark:border-gray-600'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <span className="font-medium text-sm flex-1 min-w-0 truncate">
                        {preset.name}
                        {globalPresetId === preset.id && (
                          <span className="ml-2 text-xs text-amber-500">
                            <FaStar className="inline mr-0.5" size={9} />
                            기본
                          </span>
                        )}
                        {isApplied && (
                          <span className="ml-2 text-xs text-indigo-500">
                            적용 중
                          </span>
                        )}
                      </span>
                      <button
                        className="px-3 py-1 rounded-lg text-xs bg-indigo-500 hover:bg-indigo-600 text-white"
                        title="모든 프로젝트 기본으로 설정"
                        onClick={() => handleApplyGlobal(preset)}
                      >
                        <FaGlobe className="inline mr-1" size={9} />
                        기본 적용
                      </button>
                      <button
                        className="px-3 py-1 rounded-lg text-xs bg-teal-500 hover:bg-teal-600 text-white"
                        title="이 프로젝트에만 적용"
                        onClick={() => handleApplyProject(preset)}
                      >
                        프로젝트 적용
                      </button>
                      <button
                        className="px-2 py-1 rounded-lg text-xs bg-orange-500 hover:bg-orange-600 text-white"
                        title="현재 설정값으로 덮어쓰기"
                        onClick={() => handleOverwrite(preset)}
                      >
                        <FaSync size={10} />
                      </button>
                      <button
                        className="px-2 py-1 rounded-lg text-xs bg-gray-500 hover:bg-gray-600 text-white"
                        title="편집"
                        onClick={() => setMode({ kind: 'edit', id: preset.id })}
                      >
                        <FaEdit size={10} />
                      </button>
                      <button
                        className="px-2 py-1 rounded-lg text-xs bg-red-500 hover:bg-red-600 text-white"
                        title="삭제"
                        onClick={() => handleDelete(preset)}
                      >
                        <FaTrash size={10} />
                      </button>
                    </div>
                    {/* 미리보기 */}
                    <div className="text-xs text-indigo-600 dark:text-indigo-400 truncate">
                      {summarize(preset) || <em className="text-gray-400">(비어있음)</em>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </ModalOverlay>
    );
  },
);

// ─── 진입점 버튼 ─────────────────────────────────────────────
interface SamplingPresetButtonProps {
  getCurrent: () => ISamplingPresetFields;
  onApply: (presetId: string) => void;
}

export const SamplingPresetButton = observer(
  ({ getCurrent, onApply }: SamplingPresetButtonProps) => {
    const [open, setOpen] = useState(false);
    const [showContent, setShowContent] = useState(false);
    const appliedId = appState.appliedSamplingPreset;
    const appliedPreset = appliedId
      ? samplingPresetService.get(appliedId)
      : undefined;
    const session = appState.curSession;
    const isProjectOverride = session ? typeof session.samplingPresetId === 'string' : false;
    return (
      <>
        {appliedPreset ? (
          <div className={`mb-2 rounded-lg text-white shadow-md ${isProjectOverride ? 'bg-teal-500' : 'bg-indigo-500'}`}>
            <div className="px-3 py-1.5 flex items-center gap-2">
              <FaSlidersH size={14} className="flex-none opacity-80" />
              <div className="flex-1 min-w-0 text-sm font-semibold truncate">
                {appliedPreset.name}
              </div>
              <div className="flex gap-1.5 flex-none">
                <button
                  className="px-2 py-1 rounded text-xs bg-white/20 hover:bg-white/30 transition-colors"
                  onClick={() => setShowContent(!showContent)}
                >
                  {showContent ? '닫기' : '내용'}
                </button>
                <button
                  className="px-2 py-1 rounded text-xs bg-white/20 hover:bg-white/30 transition-colors"
                  onClick={() => setOpen(true)}
                >
                  관리
                </button>
                {isProjectOverride && (
                  <button
                    className="px-2 py-1 rounded text-xs bg-white/20 hover:bg-white/30 transition-colors"
                    title="프로젝트 전용 해제 → 기본 샘플링 프리셋으로 되돌리기"
                    onClick={() => appState.revertToGlobalSamplingPreset()}
                  >
                    기본으로
                  </button>
                )}
                <button
                  className="px-2 py-1 rounded text-xs bg-white/20 hover:bg-white/30 transition-colors"
                  title="이 프로젝트에서 샘플링 프리셋 해제"
                  onClick={() => appState.clearAppliedSamplingPreset()}
                >
                  해제
                </button>
              </div>
            </div>
            {showContent && (
              <div className="px-3 pb-3 pt-1 text-xs space-y-1.5 border-t border-white/20">
                <div className="break-all">
                  <span className="opacity-95">{summarize(appliedPreset) || <em className="opacity-70">(비어있음)</em>}</span>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2 mb-1">
            <button
              className="px-3 py-1 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 bg-gray-200 dark:bg-slate-600 text-gray-700 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-slate-500"
              onClick={() => setOpen(true)}
            >
              <FaSlidersH size={10} />
              샘플링 프리셋
            </button>
          </div>
        )}
        {open && (
          <SamplingPresetDialog
            isOpen={true}
            onClose={() => setOpen(false)}
            getCurrent={getCurrent}
            onApply={onApply}
          />
        )}
      </>
    );
  },
);

export default SamplingPresetDialog;
