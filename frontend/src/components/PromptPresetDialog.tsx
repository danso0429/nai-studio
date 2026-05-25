import * as React from 'react';
import { useState } from 'react';
import { observer } from 'mobx-react-lite';
import {
  FaTrash,
  FaEdit,
  FaCheck,
  FaSave,
  FaSync,
  FaBookmark,
  FaPlus,
  FaArrowLeft,
  FaStar,
  FaGlobe,
} from 'react-icons/fa';
import ModalOverlay from './ModalOverlay';
import PromptEditTextArea from './PromptEditTextArea';
import { promptPresetService } from '../models';
import { appState } from '../models/AppService';
import { IPromptPreset, IPromptPresetSamplingOverrides } from '../models/PromptPresetService';
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

// ─── 편집/신규 폼 ────────────────────────────────────────────
interface PromptPresetFormProps {
  initialName: string;
  initialFrontPrompt: string;
  initialBackPrompt: string;
  initialUc: string;
  initialSamplingOverrides?: IPromptPresetSamplingOverrides;
  isNew: boolean;
  onSave: (
    name: string,
    frontPrompt: string,
    backPrompt: string,
    uc: string,
    samplingOverrides?: IPromptPresetSamplingOverrides,
  ) => void;
  onCancel: () => void;
}

const PromptPresetForm = observer(
  ({
    initialName,
    initialFrontPrompt,
    initialBackPrompt,
    initialUc,
    initialSamplingOverrides,
    isNew,
    onSave,
    onCancel,
  }: PromptPresetFormProps) => {
    const [name, setName] = useState(initialName);
    const [frontPrompt, setFrontPrompt] = useState(initialFrontPrompt);
    const [backPrompt, setBackPrompt] = useState(initialBackPrompt);
    const [uc, setUc] = useState(initialUc);

    const [stepsEnabled, setStepsEnabled] = useState(initialSamplingOverrides?.steps != null);
    const [stepsStr, setStepsStr] = useState(initialSamplingOverrides?.steps != null ? String(initialSamplingOverrides.steps) : '');
    const [guidanceEnabled, setGuidanceEnabled] = useState(initialSamplingOverrides?.promptGuidance != null);
    const [guidanceStr, setGuidanceStr] = useState(initialSamplingOverrides?.promptGuidance != null ? String(initialSamplingOverrides.promptGuidance) : '');
    const [rescaleEnabled, setRescaleEnabled] = useState(initialSamplingOverrides?.cfgRescale != null);
    const [rescaleStr, setRescaleStr] = useState(initialSamplingOverrides?.cfgRescale != null ? String(initialSamplingOverrides.cfgRescale) : '');
    const [samplerEnabled, setSamplerEnabled] = useState(initialSamplingOverrides?.sampling != null);
    const [sampler, setSampler] = useState(initialSamplingOverrides?.sampling ?? Sampling.KEulerAncestral);
    const [scheduleEnabled, setScheduleEnabled] = useState(initialSamplingOverrides?.noiseSchedule != null);
    const [schedule, setSchedule] = useState(initialSamplingOverrides?.noiseSchedule ?? NoiseSchedule.Karras);

    const parseNum = (s: string): number | undefined => {
      const trimmed = s.trim();
      if (!trimmed) return undefined;
      const n = Number(trimmed);
      return isNaN(n) ? undefined : n;
    };

    const buildOverrides = (): IPromptPresetSamplingOverrides | undefined => {
      const o: IPromptPresetSamplingOverrides = {};
      if (stepsEnabled) { const v = parseNum(stepsStr); if (v != null) o.steps = v; }
      if (guidanceEnabled) { const v = parseNum(guidanceStr); if (v != null) o.promptGuidance = v; }
      if (rescaleEnabled) { const v = parseNum(rescaleStr); if (v != null) o.cfgRescale = v; }
      if (samplerEnabled) o.sampling = sampler;
      if (scheduleEnabled) o.noiseSchedule = schedule;
      return Object.keys(o).length > 0 ? o : undefined;
    };

    const handleSave = () => {
      if (!name.trim()) {
        appState.pushMessage('프리셋 이름을 입력해주세요');
        return;
      }
      onSave(name, frontPrompt, backPrompt, uc, buildOverrides());
    };

    const selectClass = 'w-full px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-700 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400';

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
            프리셋 이름 *
          </label>
          <input
            type="text"
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="예: 그림체A"
          />
        </div>

        <div>
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 block">
            상위 프롬프트
          </label>
          <div className="h-40">
            <PromptEditTextArea
              value={frontPrompt}
              onChange={setFrontPrompt}
              disabled={false}
            />
          </div>
        </div>
        <div>
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 block">
            하위 프롬프트
          </label>
          <div className="h-40">
            <PromptEditTextArea
              value={backPrompt}
              onChange={setBackPrompt}
              disabled={false}
            />
          </div>
        </div>
        <div>
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 block">
            네거티브 프롬프트
          </label>
          <div className="h-40">
            <PromptEditTextArea
              value={uc}
              onChange={setUc}
              disabled={false}
            />
          </div>
        </div>

        {/* 샘플링 설정 덮어쓰기 */}
        <div className="border-t border-gray-200 dark:border-gray-600 pt-3">
          <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            샘플링 설정 덮어쓰기
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">
            체크한 항목만 프리셋 적용 시 덮어써요. 빈칸이면 프로젝트 설정 그대로.
          </div>
          <div className="flex flex-col gap-2">
            {/* 스텝 수 */}
            <div className="flex items-center gap-2">
              <input type="checkbox" checked={stepsEnabled} onChange={(e) => setStepsEnabled(e.target.checked)} />
              <span className="text-sm w-40 flex-none">스텝 수</span>
              <input
                type="text" inputMode="numeric"
                className={selectClass + ' flex-1'}
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
                className={selectClass + ' flex-1'}
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
                className={selectClass + ' flex-1'}
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
                className={selectClass + ' flex-1'}
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
                className={selectClass + ' flex-1'}
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
            className="flex-1 px-4 py-2 rounded-lg bg-sky-500 hover:bg-sky-600 text-white text-sm font-medium transition-colors"
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
interface PromptPresetDialogProps {
  isOpen: boolean;
  onClose: () => void;
  currentFrontPrompt: string;
  currentBackPrompt: string;
  currentUc: string;
  onApply: (presetId: string) => void;
}

type DialogMode =
  | { kind: 'list' }
  | { kind: 'new' }
  | { kind: 'edit'; id: string };

export const PromptPresetDialog = observer(
  ({
    isOpen,
    onClose,
    currentFrontPrompt,
    currentBackPrompt,
    currentUc,
    onApply,
  }: PromptPresetDialogProps) => {
    const [mode, setMode] = useState<DialogMode>({ kind: 'list' });
    const [newName, setNewName] = useState('');
    const presets = promptPresetService.list();

    const handleSaveFromCurrent = () => {
      const name = newName.trim();
      if (!name) {
        appState.pushMessage('프리셋 이름을 입력해주세요');
        return;
      }
      try {
        const entry = promptPresetService.add(
          name,
          currentFrontPrompt,
          currentBackPrompt,
          currentUc,
        );
        setNewName('');
        appState.setAppliedPromptPreset(entry.id);
        appState.pushMessage(`"${entry.name}" 프리셋 저장됨`);
      } catch (e) {
        appState.pushMessage((e as Error).message);
      }
    };

    const globalPresetId = appState.globalPromptPresetId;

    const handleApplyGlobal = (preset: IPromptPreset) => {
      const currentGlobal = globalPresetId
        ? promptPresetService.get(globalPresetId)
        : undefined;
      if (currentGlobal && currentGlobal.id !== preset.id) {
        appState.pushDialog({
          type: 'confirm',
          text: `현재 "${currentGlobal.name}" 프리셋이 기본 적용 중입니다.\n"${preset.name}"(으)로 변경하시겠습니까?`,
          callback: async () => {
            onClose();
            appState.pushMessage(`"${preset.name}" 기본 프리셋으로 설정됨 (모든 프로젝트)`);
            await appState.setGlobalPromptPreset(preset.id);
          },
        });
        return;
      }
      onClose();
      appState.pushMessage(`"${preset.name}" 기본 프리셋으로 설정됨 (모든 프로젝트)`);
      appState.setGlobalPromptPreset(preset.id);
    };

    const handleApplyProject = (preset: IPromptPreset) => {
      onClose();
      onApply(preset.id);
      appState.pushMessage(`"${preset.name}" 이 프로젝트에 적용됨`);
    };

    const handleOverwrite = (preset: IPromptPreset) => {
      appState.pushDialog({
        type: 'confirm',
        text: `"${preset.name}" 프리셋을 현재 값으로 덮어쓸까요?`,
        callback: () => {
          try {
            promptPresetService.update(
              preset.id,
              currentFrontPrompt,
              currentBackPrompt,
              currentUc,
              preset.samplingOverrides,
            );
            appState.setAppliedPromptPreset(preset.id);
            appState.pushMessage(`"${preset.name}" 덮어씀`);
          } catch (e) {
            appState.pushMessage((e as Error).message);
          }
        },
      });
    };

    const handleDelete = (preset: IPromptPreset) => {
      appState.pushDialog({
        type: 'confirm',
        text: `"${preset.name}" 프리셋을 삭제할까요?`,
        callback: async () => {
          if (appState.appliedPromptPreset === preset.id) {
            appState.clearAppliedPromptPreset();
          }
          if (globalPresetId === preset.id) {
            await appState.clearGlobalPromptPreset();
          }
          promptPresetService.delete(preset.id);
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
          title="프롬프트 프리셋 — 새 프리셋"
          width="max-w-4xl"
        >
          <div className="text-default">
            <PromptPresetForm
              initialName={newName.trim()}
              initialFrontPrompt=""
              initialBackPrompt=""
              initialUc=""
              isNew={true}
              onSave={(name, fp, bp, uc, so) => {
                try {
                  const entry = promptPresetService.add(name, fp, bp, uc, so);
                  setNewName('');
                  appState.pushMessage(`"${entry.name}" 프리셋 저장됨`);
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
      const target = promptPresetService.get(mode.id);
      if (!target) {
        setMode({ kind: 'list' });
        return null;
      }
      return (
        <ModalOverlay
          isOpen={true}
          onClose={onClose}
          title={`프롬프트 프리셋 — "${target.name}" 편집`}
          width="max-w-4xl"
        >
          <div className="text-default">
            <PromptPresetForm
              initialName={target.name}
              initialFrontPrompt={target.frontPrompt}
              initialBackPrompt={target.backPrompt}
              initialUc={target.uc}
              initialSamplingOverrides={target.samplingOverrides}
              isNew={false}
              onSave={(name, fp, bp, uc, so) => {
                try {
                  if (name.trim() !== target.name) {
                    promptPresetService.rename(target.id, name);
                  }
                  promptPresetService.update(target.id, fp, bp, uc, so);
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
        title="프롬프트 프리셋"
        width="max-w-4xl"
      >
        <div className="text-default flex flex-col gap-3">
          {/* 안내 */}
          <div className="text-xs text-gray-500 dark:text-gray-400">
            상위/하위/네거티브 프롬프트 셋을 묶어서 저장. 적용하면 현재 슬롯 값 앞에 합쳐져요(덮어쓰기 X).
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
                className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-700 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
                placeholder="이름 (예: 그림체A)"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveFromCurrent();
                }}
              />
              <button
                className="px-4 py-2 rounded-lg bg-sky-500 hover:bg-sky-600 text-white text-sm font-medium transition-colors whitespace-nowrap"
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
              저장된 프리셋이 없습니다
            </div>
          ) : (
            <div className="flex flex-col gap-2 max-h-[55vh] overflow-y-auto">
              {presets.map((preset) => {
                const isApplied = appState.appliedPromptPreset === preset.id;
                return (
                  <div
                    key={preset.id}
                    className={`p-3 border rounded-lg transition-colors ${
                      isApplied
                        ? 'border-sky-400 bg-sky-50 dark:bg-sky-900/20'
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
                          <span className="ml-2 text-xs text-sky-500">
                            적용 중
                          </span>
                        )}
                      </span>
                      <button
                        className="px-3 py-1 rounded-lg text-xs bg-sky-500 hover:bg-sky-600 text-white"
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
                        title="현재 값으로 덮어쓰기"
                        onClick={() => handleOverwrite(preset)}
                      >
                        <FaSync size={10} />
                      </button>
                      <button
                        className="px-2 py-1 rounded-lg text-xs bg-gray-500 hover:bg-gray-600 text-white"
                        title="편집"
                        onClick={() =>
                          setMode({ kind: 'edit', id: preset.id })
                        }
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
                    <div className="text-xs text-gray-500 dark:text-gray-400 space-y-0.5">
                      <div className="truncate">
                        <span className="font-medium">상위:</span>{' '}
                        {preset.frontPrompt || (
                          <em className="text-gray-400">(비어있음)</em>
                        )}
                      </div>
                      <div className="truncate">
                        <span className="font-medium">하위:</span>{' '}
                        {preset.backPrompt || (
                          <em className="text-gray-400">(비어있음)</em>
                        )}
                      </div>
                      <div className="truncate">
                        <span className="font-medium">네거티브:</span>{' '}
                        {preset.uc || (
                          <em className="text-gray-400">(비어있음)</em>
                        )}
                      </div>
                      {preset.samplingOverrides && Object.keys(preset.samplingOverrides).length > 0 && (
                        <div className="truncate text-teal-600 dark:text-teal-400">
                          <span className="font-medium">설정:</span>{' '}
                          {[
                            preset.samplingOverrides.steps != null && `스텝 ${preset.samplingOverrides.steps}`,
                            preset.samplingOverrides.promptGuidance != null && `가이던스 ${preset.samplingOverrides.promptGuidance}`,
                            preset.samplingOverrides.cfgRescale != null && `리스케일 ${preset.samplingOverrides.cfgRescale}`,
                            preset.samplingOverrides.sampling != null && (SAMPLER_LABELS[preset.samplingOverrides.sampling] ?? preset.samplingOverrides.sampling),
                            preset.samplingOverrides.noiseSchedule != null && (NOISE_SCHEDULE_LABELS[preset.samplingOverrides.noiseSchedule] ?? preset.samplingOverrides.noiseSchedule),
                          ].filter(Boolean).join(' · ')}
                        </div>
                      )}
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
interface PromptPresetButtonProps {
  getFrontPrompt: () => string;
  getBackPrompt: () => string;
  getUc: () => string;
  onApply: (presetId: string) => void;
}

export const PromptPresetButton = observer(
  ({
    getFrontPrompt,
    getBackPrompt,
    getUc,
    onApply,
  }: PromptPresetButtonProps) => {
    const [open, setOpen] = useState(false);
    const [showContent, setShowContent] = useState(false);
    const appliedId = appState.appliedPromptPreset;
    const appliedPreset = appliedId
      ? promptPresetService.get(appliedId)
      : undefined;
    const session = appState.curSession;
    const isProjectOverride = session ? typeof session.promptPresetId === 'string' : false;
    const sourceLabel = isProjectOverride ? '프로젝트 전용' : '기본';
    return (
      <>
        {appliedPreset ? (
          <div className={`mb-2 rounded-lg text-white shadow-md ${isProjectOverride ? 'bg-teal-500' : 'bg-sky-500'}`}>
            <div className="px-3 py-1.5 flex items-center gap-2">
              <FaBookmark size={14} className="flex-none opacity-80" />
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
                    title="프로젝트 전용 해제 → 기본 프리셋으로 되돌리기"
                    onClick={() => appState.revertToGlobalPreset()}
                  >
                    기본으로
                  </button>
                )}
                <button
                  className="px-2 py-1 rounded text-xs bg-white/20 hover:bg-white/30 transition-colors"
                  title="이 프로젝트에서 프리셋 해제 (슬롯 값은 그대로)"
                  onClick={() => appState.clearAppliedPromptPreset()}
                >
                  해제
                </button>
              </div>
            </div>
            {showContent && (
              <div className="px-3 pb-3 pt-1 text-xs space-y-1.5 border-t border-white/20">
                <div className="break-all">
                  <span className="font-semibold opacity-80">상위:</span>{' '}
                  <span className="opacity-95">{appliedPreset.frontPrompt || <em className="opacity-70">(비어있음)</em>}</span>
                </div>
                <div className="break-all">
                  <span className="font-semibold opacity-80">하위:</span>{' '}
                  <span className="opacity-95">{appliedPreset.backPrompt || <em className="opacity-70">(비어있음)</em>}</span>
                </div>
                <div className="break-all">
                  <span className="font-semibold opacity-80">네거티브:</span>{' '}
                  <span className="opacity-95">{appliedPreset.uc || <em className="opacity-70">(비어있음)</em>}</span>
                </div>
                {appliedPreset.samplingOverrides && Object.keys(appliedPreset.samplingOverrides).length > 0 && (
                  <div className="break-all">
                    <span className="font-semibold opacity-80">설정 덮어쓰기:</span>{' '}
                    <span className="opacity-95">
                      {[
                        appliedPreset.samplingOverrides.steps != null && `스텝 ${appliedPreset.samplingOverrides.steps}`,
                        appliedPreset.samplingOverrides.promptGuidance != null && `가이던스 ${appliedPreset.samplingOverrides.promptGuidance}`,
                        appliedPreset.samplingOverrides.cfgRescale != null && `리스케일 ${appliedPreset.samplingOverrides.cfgRescale}`,
                        appliedPreset.samplingOverrides.sampling != null && (SAMPLER_LABELS[appliedPreset.samplingOverrides.sampling] ?? appliedPreset.samplingOverrides.sampling),
                        appliedPreset.samplingOverrides.noiseSchedule != null && (NOISE_SCHEDULE_LABELS[appliedPreset.samplingOverrides.noiseSchedule] ?? appliedPreset.samplingOverrides.noiseSchedule),
                      ].filter(Boolean).join(' · ')}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2 mb-1">
            <button
              className="px-3 py-1 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 bg-gray-200 dark:bg-slate-600 text-gray-700 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-slate-500"
              onClick={() => setOpen(true)}
            >
              <FaBookmark size={10} />
              프롬프트 프리셋
            </button>
          </div>
        )}
        {open && (
          <PromptPresetDialog
            isOpen={true}
            onClose={() => setOpen(false)}
            currentFrontPrompt={getFrontPrompt()}
            currentBackPrompt={getBackPrompt()}
            currentUc={getUc()}
            onApply={onApply}
          />
        )}
      </>
    );
  },
);

export default PromptPresetDialog;
