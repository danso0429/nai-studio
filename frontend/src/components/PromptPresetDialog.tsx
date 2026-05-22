import * as React from 'react';
import { useState } from 'react';
import { observer } from 'mobx-react-lite';
import {
  FaTrash,
  FaEdit,
  FaCheck,
  FaTimes,
  FaSave,
  FaSync,
  FaBookmark,
  FaPlus,
  FaArrowLeft,
} from 'react-icons/fa';
import ModalOverlay from './ModalOverlay';
import PromptEditTextArea from './PromptEditTextArea';
import { promptPresetService } from '../models';
import { appState } from '../models/AppService';
import {
  IPromptPreset,
  IPromptPresetParams,
} from '../models/PromptPresetService';

// ─── Sampler 옵션 ─────────────────────────────────────────────
const SAMPLING_OPTIONS = [
  { value: 'k_euler_ancestral', label: 'Euler Ancestral' },
  { value: 'k_euler', label: 'Euler' },
  { value: 'k_dpmpp_2s_ancestral', label: 'DPM++ 2S Ancestral' },
  { value: 'k_dpmpp_2m', label: 'DPM++ 2M' },
  { value: 'k_dpmpp_sde', label: 'DPM++ SDE' },
  { value: 'k_dpmpp_2m_sde', label: 'DPM++ 2M SDE' },
  { value: 'ddim_v3', label: 'DDIM' },
];

const NOISE_OPTIONS = [
  { value: 'native', label: 'Native' },
  { value: 'karras', label: 'Karras' },
  { value: 'exponential', label: 'Exponential' },
  { value: 'polyexponential', label: 'Polyexponential' },
];

const DEFAULTS = {
  steps: 28,
  sampling: 'k_euler_ancestral',
  promptGuidance: 5,
  cfgRescale: 0,
  noiseSchedule: 'karras',
};

// ─── Sampler 파라미터 입력 패널 ───────────────────────────────
interface SamplerPanelProps {
  enabled: boolean;
  setEnabled: (v: boolean) => void;
  steps: number;
  setSteps: (v: number) => void;
  sampling: string;
  setSampling: (v: string) => void;
  promptGuidance: number;
  setPromptGuidance: (v: number) => void;
  cfgRescale: number;
  setCfgRescale: (v: number) => void;
  noiseSchedule: string;
  setNoiseSchedule: (v: string) => void;
}

const SamplerPanel = ({
  enabled,
  setEnabled,
  steps,
  setSteps,
  sampling,
  setSampling,
  promptGuidance,
  setPromptGuidance,
  cfgRescale,
  setCfgRescale,
  noiseSchedule,
  setNoiseSchedule,
}: SamplerPanelProps) => {
  return (
    <div className="p-3 border border-gray-200 dark:border-gray-600 rounded-lg">
      <label className="flex items-center gap-2 cursor-pointer mb-2">
        <input
          type="checkbox"
          className="accent-sky-500"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
          샘플링/모델 설정도 함께 저장
        </span>
      </label>
      {!enabled && (
        <div className="text-xs text-gray-500 dark:text-gray-400">
          체크하면 스탭/샘플러/가이던스/리스케일/노이즈 스케줄도 그림체별로 저장돼요. 적용 시 현재 값이 덮어 써져요.
        </div>
      )}
      {enabled && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="text-xs gray-label block mb-1">
              스탭 수 ({steps})
            </label>
            <div className="flex gap-2 items-center">
              <input
                type="range"
                min={1}
                max={50}
                step={1}
                value={steps}
                onChange={(e) => setSteps(parseInt(e.target.value))}
                className="flex-1"
              />
              <input
                type="number"
                min={1}
                max={50}
                step={1}
                value={steps}
                onChange={(e) =>
                  setSteps(Math.max(1, Math.min(50, parseInt(e.target.value) || 1)))
                }
                className="w-16 px-1 py-0.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-700 text-sm"
              />
            </div>
          </div>
          <div>
            <label className="text-xs gray-label block mb-1">샘플러</label>
            <select
              value={sampling}
              onChange={(e) => setSampling(e.target.value)}
              className="w-full px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-700 text-sm"
            >
              {SAMPLING_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs gray-label block mb-1">
              프롬프트 가이던스 ({promptGuidance.toFixed(1)})
            </label>
            <div className="flex gap-2 items-center">
              <input
                type="range"
                min={0}
                max={10}
                step={0.1}
                value={promptGuidance}
                onChange={(e) => setPromptGuidance(parseFloat(e.target.value))}
                className="flex-1"
              />
              <input
                type="number"
                min={0}
                max={10}
                step={0.1}
                value={promptGuidance}
                onChange={(e) =>
                  setPromptGuidance(
                    Math.max(0, Math.min(10, parseFloat(e.target.value) || 0)),
                  )
                }
                className="w-16 px-1 py-0.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-700 text-sm"
              />
            </div>
          </div>
          <div>
            <label className="text-xs gray-label block mb-1">
              CFG 리스케일 ({cfgRescale.toFixed(2)})
            </label>
            <div className="flex gap-2 items-center">
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={cfgRescale}
                onChange={(e) => setCfgRescale(parseFloat(e.target.value))}
                className="flex-1"
              />
              <input
                type="number"
                min={0}
                max={1}
                step={0.01}
                value={cfgRescale}
                onChange={(e) =>
                  setCfgRescale(
                    Math.max(0, Math.min(1, parseFloat(e.target.value) || 0)),
                  )
                }
                className="w-16 px-1 py-0.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-700 text-sm"
              />
            </div>
          </div>
          <div className="md:col-span-2">
            <label className="text-xs gray-label block mb-1">노이즈 스케줄</label>
            <select
              value={noiseSchedule}
              onChange={(e) => setNoiseSchedule(e.target.value)}
              className="w-full px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-700 text-sm"
            >
              {NOISE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── 편집/신규 폼 ────────────────────────────────────────────
interface PromptPresetFormProps {
  initialName: string;
  initialFrontPrompt: string;
  initialBackPrompt: string;
  initialUc: string;
  initialParams: IPromptPresetParams;
  isNew: boolean;
  onSave: (
    name: string,
    frontPrompt: string,
    backPrompt: string,
    uc: string,
    params: IPromptPresetParams | undefined,
  ) => void;
  onCancel: () => void;
}

const PromptPresetForm = observer(
  ({
    initialName,
    initialFrontPrompt,
    initialBackPrompt,
    initialUc,
    initialParams,
    isNew,
    onSave,
    onCancel,
  }: PromptPresetFormProps) => {
    const [name, setName] = useState(initialName);
    const [frontPrompt, setFrontPrompt] = useState(initialFrontPrompt);
    const [backPrompt, setBackPrompt] = useState(initialBackPrompt);
    const [uc, setUc] = useState(initialUc);
    const hasInitialParams =
      initialParams.steps !== undefined ||
      initialParams.sampling !== undefined ||
      initialParams.promptGuidance !== undefined ||
      initialParams.cfgRescale !== undefined ||
      initialParams.noiseSchedule !== undefined;
    const [paramsEnabled, setParamsEnabled] = useState(hasInitialParams);
    const [steps, setSteps] = useState(initialParams.steps ?? DEFAULTS.steps);
    const [sampling, setSampling] = useState(
      initialParams.sampling ?? DEFAULTS.sampling,
    );
    const [promptGuidance, setPromptGuidance] = useState(
      initialParams.promptGuidance ?? DEFAULTS.promptGuidance,
    );
    const [cfgRescale, setCfgRescale] = useState(
      initialParams.cfgRescale ?? DEFAULTS.cfgRescale,
    );
    const [noiseSchedule, setNoiseSchedule] = useState(
      initialParams.noiseSchedule ?? DEFAULTS.noiseSchedule,
    );

    const handleSave = () => {
      if (!name.trim()) {
        appState.pushMessage('프리셋 이름을 입력해주세요');
        return;
      }
      const params: IPromptPresetParams | undefined = paramsEnabled
        ? { steps, sampling, promptGuidance, cfgRescale, noiseSchedule }
        : undefined;
      onSave(name, frontPrompt, backPrompt, uc, params);
    };

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

        <SamplerPanel
          enabled={paramsEnabled}
          setEnabled={setParamsEnabled}
          steps={steps}
          setSteps={setSteps}
          sampling={sampling}
          setSampling={setSampling}
          promptGuidance={promptGuidance}
          setPromptGuidance={setPromptGuidance}
          cfgRescale={cfgRescale}
          setCfgRescale={setCfgRescale}
          noiseSchedule={noiseSchedule}
          setNoiseSchedule={setNoiseSchedule}
        />

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
  currentParams: IPromptPresetParams;
  onApply: (
    frontPrompt: string,
    backPrompt: string,
    uc: string,
    params: IPromptPresetParams | undefined,
    presetId: string,
  ) => void;
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
    currentParams,
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
          currentParams,
        );
        setNewName('');
        appState.setAppliedPromptPreset(entry.id);
        appState.pushMessage(`"${entry.name}" 프리셋 저장됨`);
      } catch (e) {
        appState.pushMessage((e as Error).message);
      }
    };

    const extractParams = (p: IPromptPreset): IPromptPresetParams | undefined => {
      const keys: (keyof IPromptPresetParams)[] = [
        'steps',
        'sampling',
        'promptGuidance',
        'cfgRescale',
        'noiseSchedule',
      ];
      const out: any = {};
      let any = false;
      for (const k of keys) {
        if (p[k] !== undefined) {
          out[k] = p[k];
          any = true;
        }
      }
      return any ? out : undefined;
    };

    const handleApply = (preset: IPromptPreset) => {
      onApply(
        preset.frontPrompt,
        preset.backPrompt,
        preset.uc,
        extractParams(preset),
        preset.id,
      );
      appState.pushMessage(`"${preset.name}" 프리셋 적용됨`);
      onClose();
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
              currentParams,
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
        callback: () => {
          if (appState.appliedPromptPreset === preset.id) {
            appState.clearAppliedPromptPreset();
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
              initialParams={{}}
              isNew={true}
              onSave={(name, fp, bp, uc, params) => {
                try {
                  const entry = promptPresetService.add(name, fp, bp, uc, params);
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
      const targetParams = extractParams(target) || {};
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
              initialParams={targetParams}
              isNew={false}
              onSave={(name, fp, bp, uc, params) => {
                try {
                  if (name.trim() !== target.name) {
                    promptPresetService.rename(target.id, name);
                  }
                  promptPresetService.update(target.id, fp, bp, uc, params);
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
            상위 프롬프트 + 하위 프롬프트 + 네거티브 프롬프트 셋을 묶어서 저장/적용해요. 필요하면 샘플링/모델 설정(스탭, 샘플러, 가이던스 등)도 그림체별로 함께 저장 가능해요.
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
                const hasParams = extractParams(preset) !== undefined;
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
                        {isApplied && (
                          <span className="ml-2 text-xs text-sky-500">
                            적용 중
                          </span>
                        )}
                        {hasParams && (
                          <span className="ml-2 text-xs text-orange-500">
                            ⚙
                          </span>
                        )}
                      </span>
                      <button
                        className="px-3 py-1 rounded-lg text-xs bg-sky-500 hover:bg-sky-600 text-white"
                        onClick={() => handleApply(preset)}
                      >
                        적용
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
                      {hasParams && (
                        <div className="truncate text-orange-500 dark:text-orange-400">
                          <span className="font-medium">샘플링:</span>{' '}
                          {[
                            preset.steps !== undefined ? `스탭 ${preset.steps}` : null,
                            preset.sampling ? preset.sampling : null,
                            preset.promptGuidance !== undefined ? `가이던스 ${preset.promptGuidance}` : null,
                            preset.cfgRescale !== undefined ? `리스케일 ${preset.cfgRescale}` : null,
                            preset.noiseSchedule ? preset.noiseSchedule : null,
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
  getCurrentParams: () => IPromptPresetParams;
  onApply: (
    frontPrompt: string,
    backPrompt: string,
    uc: string,
    params: IPromptPresetParams | undefined,
    presetId: string,
  ) => void;
}

export const PromptPresetButton = observer(
  ({
    getFrontPrompt,
    getBackPrompt,
    getUc,
    getCurrentParams,
    onApply,
  }: PromptPresetButtonProps) => {
    const [open, setOpen] = useState(false);
    const [showContent, setShowContent] = useState(false);
    const appliedId = appState.appliedPromptPreset;
    const appliedPreset = appliedId
      ? promptPresetService.get(appliedId)
      : undefined;
    const hasParams =
      appliedPreset &&
      (appliedPreset.steps !== undefined ||
        appliedPreset.sampling !== undefined ||
        appliedPreset.promptGuidance !== undefined ||
        appliedPreset.cfgRescale !== undefined ||
        appliedPreset.noiseSchedule !== undefined);
    return (
      <>
        {appliedPreset ? (
          <div className="mb-2 rounded-lg bg-sky-500 text-white shadow-md">
            <div className="p-3 flex items-center gap-3 flex-wrap">
              <FaBookmark size={18} className="flex-none" />
              <div className="flex-1 min-w-0">
                <div className="text-xs uppercase tracking-wider opacity-80 font-medium">
                  프롬프트 프리셋 적용 중
                </div>
                <div className="text-base font-semibold truncate">
                  {appliedPreset.name}
                </div>
                <div className="text-xs opacity-90 mt-0.5">
                  상위/하위/네거티브{hasParams ? ' + 샘플링 설정' : ''} 잠김 · 캐릭터/바이브/레퍼런스/시드는 자유 편집
                </div>
              </div>
              <div className="flex gap-2 flex-none flex-wrap">
                <button
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white/20 hover:bg-white/30 transition-colors"
                  onClick={() => setShowContent(!showContent)}
                >
                  {showContent ? '내용 닫기 ▲' : '내용 보기 ▼'}
                </button>
                <button
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white/20 hover:bg-white/30 transition-colors"
                  onClick={() => setOpen(true)}
                >
                  관리
                </button>
                <button
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white/20 hover:bg-white/30 transition-colors"
                  title="적용 표시 해제 (프롬프트 값은 그대로 유지)"
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
                {hasParams && (
                  <div className="break-all pt-1 border-t border-white/10">
                    <span className="font-semibold opacity-80">샘플링:</span>{' '}
                    <span className="opacity-95">
                      {[
                        appliedPreset.steps !== undefined ? `스탭 ${appliedPreset.steps}` : null,
                        appliedPreset.sampling || null,
                        appliedPreset.promptGuidance !== undefined ? `가이던스 ${appliedPreset.promptGuidance}` : null,
                        appliedPreset.cfgRescale !== undefined ? `리스케일 ${appliedPreset.cfgRescale}` : null,
                        appliedPreset.noiseSchedule || null,
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
            currentParams={getCurrentParams()}
            onApply={onApply}
          />
        )}
      </>
    );
  },
);

export default PromptPresetDialog;
