import * as React from 'react';
import { useContext, useEffect, useRef, useState } from 'react';
import { Buffer } from 'buffer';
import {
  TextAreaWithUndo,
  NumberSelect,
  Collapsible,
  FileUploadBase64,
  DropdownSelect,
} from './UtilComponents';
import { NoiseSchedule, Resolution, Sampling } from '../backends/imageGen';
import PromptEditTextArea from './PromptEditTextArea';
import { SamplingPresetButton } from './SamplingPresetDialog';
import {
  FaCopy,
  FaFont,
  FaImage,
  FaPlus,
  FaShare,
  FaStar,
  FaTrash,
  FaTrashAlt,
  FaUserAlt,
  FaArrowsAlt,
  FaToggleOn,
  FaToggleOff,
  FaFolderOpen,
  FaLayerGroup,
} from 'react-icons/fa';
import { FloatView } from './FloatView';
import { v4 } from 'uuid';
import { BigPromptEditor, SlotPiece } from './SceneEditor';
import { useContextMenu } from 'react-contexify';
import {
  CharacterPrompt,
  ContextMenuType,
  PromptNode,
  PromptPiece,
  ReferenceItem,
  Scene,
  VibeItem,
} from '../models/types';
import {
  sessionService,
  imageService,
  backend,
  promptService,
  taskQueueService,
  workFlowService,
  samplingPresetService,
  isMobile,
} from '../models';
import { toPARR, stripAllChunkTokens } from '../models/PromptService';
import { appState } from '../models/AppService';
import { observer } from 'mobx-react-lite';
import {
  WFAbstractVar,
  WFIElement,
  WFIExtraPromptInput,
  WFIGroup,
  WFIIfIn,
  WFIInlineInput,
  WFIMiddlePlaceholderInput,
  WFIPush,
  WFISceneOnly,
  WFIShowImage,
  WFIStack,
  WFVar,
  WorkFlowDef,
  wfiElementKey,
} from '../models/workflows/WorkFlow';
import {
  movePresetInput,
  PRESET_LAYOUT_ANCHORS,
  presetLayoutSlotKey,
  resolvePresetInputs,
} from '../models/presetLayout';
import { StackFixed, StackGrow, VerticalStack } from './LayoutComponents';
import Tooltip from './Tooltip';
import ModalOverlay from './ModalOverlay';
import PromptChunkManager from './PromptChunkManager';
import { FaCloudUploadAlt } from 'react-icons/fa';
import { ModelVersion } from '../backends/imageGen';
import { ResolutionPicker, resolutionValueToSize } from './ResolutionPicker';
import CompanionButtons from './CompanionButtons';
import HelpIcon from './HelpIcon';

const PROMPT_SYNTAX_HELP = `프롬프트 문법
• <그룹.조각> : 로컬 우선으로 조각 삽입
• {강조} / [약화] : 중첩 가중치
• 1.5::내용:: : 명시 가중치
• ##메모## : 생성에서 제외되는 주석
• 자동완성 : 태그 추천, < 입력 시 조각 검색`;

// Phase 7C: gray-label 핵심 패턴 헬퍼 (오타 재발 방지)
const GrayLabel: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className = '',
}) => (
  <div className={`whitespace-nowrap flex-none mr-auto md:mr-0 gray-label ${className}`.trim()}>
    {children}
  </div>
);

const ImageSelect = observer(({ input }: { input: WFIInlineInput }) => {
  const { curSession } = appState;
  const { preset, shared, meta } =
    useContext(WFElementContext)!;
  const getField = () => {
    if (input.fieldType === 'preset') return preset[input.field];
    if (input.fieldType === 'shared') return shared[input.field];
    return meta![input.field];
  };
  const setField = (val: any) => {
    if (input.fieldType === 'preset') preset[input.field] = val;
    else if (input.fieldType === 'shared') shared[input.field] = val;
    else meta![input.field] = val;
  };
  return (
    <div className="inline-flex md:flex gap-3 items-center flex-none text-eplsis overflow-hidden gap-3 mb-1 mt-2">
      <span className="gray-label">{input.label}: </span>
      <div className="w-24 md:w-48">
        <FileUploadBase64
          onFileSelect={async (file: string) => {
            if (!getField()) {
              const path = await imageService.storeVibeImage(curSession!, file);
              setField(path);
            } else {
              await imageService.writeVibeImage(curSession!, getField(), file);
            }
          }}
        ></FileUploadBase64>
      </div>
      {!isMobile && (
        <button
          className={`round-button back-sky`}
          onClick={() => {
            if (!getField()) return;
            const path = imageService.getVibeImagePath(curSession!, getField());
            backend.openImageEditor(path);
            backend.watchImage(path);
          }}
        >
          {input.label} 편집
        </button>
      )}
    </div>
  );
});

const VibeImage = ({
  path,
  onClick,
  className,
}: {
  path: string;
  onClick?: (e?: React.MouseEvent) => void;
  className: string;
}) => {
  const [image, setImage] = useState<string | null>(null);
  useEffect(() => {
    const fetchImage = async () => {
      const data = await imageService.fetchImageSmall(path, 400);
      setImage(data);
    };
    fetchImage();
    const handler = (e: any) => {
      if (e.detail.path === path) {
        fetchImage();
      }
    };
    imageService.addEventListener('image-cache-invalidated', handler);
    return () => {
      imageService.removeEventListener('image-cache-invalidated', handler);
    };
  }, [path]);
  return (
    <>
      {image && (
        <img
          className={className}
          src={image}
          onClick={onClick}
          draggable={false}
        />
      )}
      {!image && (
        <div
          className={className + ' flex items-center justify-center bg-gray-200 dark:bg-gray-700 border border-gray-300 dark:border-gray-600'}
          onClick={onClick}
        >
          <span className="text-xs text-gray-500 dark:text-gray-400 text-center px-1 select-none">
            NO IMAGE
          </span>
        </div>
      )}
    </>
  );
};

interface VibeEditorProps {
  disabled: boolean;
}

export const VibeEditor = observer(({ disabled }: VibeEditorProps) => {
  const { curSession } = appState;
  const { preset, shared, editVibe, setEditVibe, meta } =
    useContext(WFElementContext)!;
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);
  // 캐릭터 프리셋 적용 중 + shared(공용) field면 프리셋 출처 아이템 개별 잠금
  const isPresetActive = !!appState.appliedCharacterPreset && editVibe?.fieldType === 'shared';

  const getField = () => {
    if (editVibe!.fieldType === 'preset') return preset[editVibe!.field];
    if (editVibe!.fieldType === 'shared') return shared[editVibe!.field];
    return meta![editVibe!.field];
  };
  const setField = (val: any) => {
    if (editVibe!.fieldType === 'preset') preset[editVibe!.field] = val;
    else if (editVibe!.fieldType === 'shared') shared[editVibe!.field] = val;
    else meta![editVibe!.field] = val;
  };
  const vibeChange = async (vibe: string) => {
    if (!vibe) return;
    const toastId = appState.pushMessage('바이브 이미지 전송 중…', { sticky: true });
    try {
      const path = await imageService.storeVibeImage(curSession!, vibe);
      getField().push(
        VibeItem.fromJSON({ path: path, info: 1.0, strength: 0.6 }),
      );
      appState.dismissMessage(toastId);
      appState.pushMessage('바이브 이미지 추가 완료');
    } catch (e) {
      appState.dismissMessage(toastId);
      appState.pushMessage('바이브 이미지 추가 실패: ' + (e as Error).message);
    }
  };

  // Handle paste event (Ctrl+V)
  useEffect(() => {
    if (!editVibe) return;
    const handlePaste = async (e: ClipboardEvent) => {
      if (disabled) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) {
            const reader = new FileReader();
            reader.onload = async (event) => {
              const base64 = (event.target?.result as string)?.split(',')[1];
              if (base64) {
                await vibeChange(base64);
              }
            };
            reader.readAsDataURL(file);
          }
          break;
        }
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [editVibe, disabled, curSession]);

  // Handle drag and drop
  const handleDragEnter = (e: React.DragEvent) => {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDrop = async (e: React.DragEvent) => {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = async (event) => {
          const base64 = (event.target?.result as string)?.split(',')[1];
          if (base64) {
            await vibeChange(base64);
          }
        };
        reader.readAsDataURL(file);
      }
    }
  };

  return (
    editVibe && (
      <div
        ref={containerRef}
        className={`w-full h-full overflow-hidden flex flex-col ${isDragging ? 'ring-2 ring-sky-500 bg-sky-50 dark:bg-sky-900/20' : ''}`}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <div className="flex-1 overflow-hidden">
          <div className="h-full overflow-auto">
            {getField().length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-gray-400 dark:text-gray-500 p-8">
                <FaCloudUploadAlt size={48} className="mb-4 opacity-60" />
                {!isMobile ? (
                  <>
                    <p className="text-base font-medium mb-1">이미지를 드래그하거나</p>
                    <p className="text-base font-medium">Ctrl+V로 붙여넣기 할 수 있습니다</p>
                  </>
                ) : (
                  <p className="text-base font-medium text-center">아래 업로드 버튼으로<br/>이미지를 추가하세요</p>
                )}
              </div>
            )}
            {getField().map((vibe: VibeItem) => (
              <div
                key={vibe.path}
                className="border border-gray-300 mt-2 p-2 flex gap-2 items-begin"
              >
                <VibeImage
                  path={
                    vibe.path &&
                    imageService.getVibeImagePath(curSession!, vibe.path)
                  }
                  className="flex-none w-28 h-28 object-cover"
                />
                <div className="flex flex-col gap-2 w-full">
                  <div className="flex w-full items-center md:flex-row flex-col">
                    <GrayLabel>정보 추출률 (IS):</GrayLabel>
                    <div className="flex flex-1 md:w-auto w-full gap-1">
                      <input
                        className="flex-1"
                        type="range"
                        step="0.01"
                        min="0"
                        max="1"
                        value={vibe.info}
                        onChange={(e) => {
                          vibe.info = parseFloat(e.target.value);
                        }}
                        disabled={disabled}
                      />
                      <input
                        className="w-14 flex-none text-lg text-center back-lllgray rounded outline-none"
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                        min="0"
                        max="1"
                        value={vibe.info}
                        onChange={(e) => {
                          const v = parseFloat(e.target.value);
                          if (!isNaN(v)) {
                            vibe.info = Math.max(0, Math.min(1, v));
                          }
                        }}
                        disabled={disabled}
                      />
                    </div>
                  </div>
                  <div className="flex w-full md:flex-row flex-col items-center">
                    <GrayLabel>레퍼런스 강도 (RS):</GrayLabel>
                    <div className="flex flex-1 md:w-auto w-full gap-1">
                      <input
                        className="flex-1"
                        type="range"
                        step="0.01"
                        min="0"
                        max="1"
                        value={vibe.strength}
                        onChange={(e) => {
                          vibe.strength = parseFloat(e.target.value);
                        }}
                        disabled={disabled}
                      />
                      <input
                        className="w-14 flex-none text-lg text-center back-lllgray rounded outline-none"
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                        min="0"
                        max="1"
                        value={vibe.strength}
                        onChange={(e) => {
                          const v = parseFloat(e.target.value);
                          if (!isNaN(v)) {
                            vibe.strength = Math.max(0, Math.min(1, v));
                          }
                        }}
                        disabled={disabled}
                      />
                    </div>
                  </div>
                  <div className="flex-none flex ml-auto mt-auto">
                    {isPresetActive && vibe.fromPreset ? (
                      <div className="text-xs text-gray-400 dark:text-gray-500 px-2">🔒 프리셋 잠금</div>
                    ) : (
                      <Tooltip content="바이브 삭제">
                      <button
                        className={
                          `round-button h-8 px-8 ml-auto ` +
                          (disabled ? 'back-gray' : 'back-red')
                        }
                        onClick={() => {
                          if (disabled) return;
                          setField(getField().filter((x: any) => x !== vibe));
                        }}
                      >
                        <FaTrash />
                      </button>
                      </Tooltip>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="flex-none mt-auto pt-2 flex flex-col gap-2">
          {getField().length > 0 && !isMobile && (
            <div className="text-xs text-gray-500 dark:text-gray-400 text-center">
              이미지를 드래그하거나 Ctrl+V로 붙여넣기 할 수 있습니다
            </div>
          )}
          <div className="flex gap-2 items-center">
            <FileUploadBase64
              notext
              disabled={disabled}
              onFileSelect={vibeChange}
            ></FileUploadBase64>
            <button
              className={`round-button back-gray h-8 w-full`}
              onClick={() => {
                setEditVibe(undefined);
              }}
            >
              바이브 설정 닫기
            </button>
          </div>
        </div>
      </div>
    )
  );
});

export const VibeButton = observer(({ input }: { input: WFIInlineInput }) => {
  const { editVibe, setEditVibe, preset, shared, meta, modelVersion } =
    useContext(WFElementContext)!;
  const [activeIndex, setActiveIndex] = useState(0);

  const getField = () => {
    if (input.fieldType === 'preset') return preset[input.field];
    if (input.fieldType === 'shared') return shared[input.field];
    return meta![input.field];
  };

  // v4.5에서 캐릭터 레퍼런스에 이미지가 있으면 바이브 잠금
  const hasCharacterReferences = (() => {
    const refs = shared?.characterReferences;
    if (!refs || !Array.isArray(refs)) return false;
    return refs.some((ref: ReferenceItem) => ref.enabled !== false && ref.path);
  })();
  const isV4_5 = modelVersion === ModelVersion.V4_5 || modelVersion === ModelVersion.V4_5Curated;
  const locked = isV4_5 && hasCharacterReferences;

  const onClick = () => {
    if (locked) return;
    setEditVibe(input);
  };

  const handleImageClick = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (locked) return;
    const field = getField();
    if (field.length > 1) {
      setActiveIndex((prev: number) => (prev + 1) % field.length);
    } else {
      onClick();
    }
  };

  const handleOpenEditor = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (locked) return;
    onClick();
  };

  const field = getField();
  const safeActiveIndex = field.length > 0 ? Math.min(activeIndex, field.length - 1) : 0;

  return (
    <>
      {editVibe == undefined && getField().length === 0 && (
        <div className="w-full flex items-center mt-2">
          <button
            className={`round-button h-8 flex-1 flex ${locked ? 'back-llgray opacity-50 cursor-not-allowed' : 'back-gray'}`}
            onClick={onClick}
            disabled={locked}
          >
            <div className="flex-1">
              {locked ? '바이브 이미지 설정 (캐릭터 레퍼런스 사용 중)' : '바이브 이미지 설정 열기'}
            </div>
          </button>
          <CompanionButtons host="vibes" />
        </div>
      )}
      {editVibe == undefined && getField().length > 0 && (
        <div className={'w-full flex items-center mt-2' + (locked ? ' opacity-50' : '')}>
          <div className={'flex-none mr-2 gray-label'}>
            바이브 설정:
            {locked && (
              <span className="ml-1 text-xs text-red-400">
                (비활성 — v4.5에서 캐릭터 레퍼런스 사용 중)
              </span>
            )}
            {!locked && field.length > 1 && (
              <span className="ml-1 text-xs text-sky-500">
                ({safeActiveIndex + 1}/{field.length})
              </span>
            )}
          </div>
          <div className="flex-1 flex gap-1 items-center">
            <VibeImage
              path={imageService.getVibeImagePath(
                appState.curSession!,
                getField()[safeActiveIndex].path,
              )}
              className={'flex-1 h-14 rounded-xl object-cover' + (locked ? ' grayscale' : ' cursor-pointer hover:brightness-95 active:brightness-90')}
              onClick={handleImageClick}
            />
            {!locked && field.length > 1 && (
              <Tooltip content="바이브 편집">
              <button
                className="flex-none px-2 h-14 rounded-lg back-sky text-white text-xs hover:brightness-95 active:brightness-90"
                onClick={handleOpenEditor}
              >
                편집
              </button>
              </Tooltip>
            )}
          </div>
          <CompanionButtons host="vibes" />
        </div>
      )}
    </>
  );
});

interface CharacterReferenceEditorProps {
  disabled: boolean;
}

// 레퍼런스 기본값 localStorage 키
const REF_DEFAULT_STRENGTH_KEY = 'sdstudio-ref-default-strength';
const REF_DEFAULT_FIDELITY_KEY = 'sdstudio-ref-default-fidelity';
const REF_DEFAULT_TYPE_KEY = 'sdstudio-ref-default-type';

export function getRefDefaults() {
  return {
    strength: parseFloat(localStorage.getItem(REF_DEFAULT_STRENGTH_KEY) || '0.6'),
    fidelity: parseFloat(localStorage.getItem(REF_DEFAULT_FIDELITY_KEY) || '1.0'),
    referenceType: (localStorage.getItem(REF_DEFAULT_TYPE_KEY) || 'character') as
      'character' | 'style' | 'character&style',
  };
}

export const CharacterReferenceEditor = observer(({ disabled }: CharacterReferenceEditorProps) => {
  const { curSession } = appState;
  const { preset, shared, editCharacterReference, setEditCharacterReference, meta } =
    useContext(WFElementContext)!;
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [showDefaults, setShowDefaults] = useState(false);
  const [refDefaults, setRefDefaults] = useState(getRefDefaults);
  // 캐릭터 프리셋 적용 중 + shared(공용) field면 프리셋 출처 아이템 개별 잠금
  const isPresetActive = !!appState.appliedCharacterPreset && editCharacterReference?.fieldType === 'shared';

  const updateDefault = (key: string, value: string) => {
    localStorage.setItem(key, value);
    setRefDefaults(getRefDefaults());
  };

  const getField = () => {
    if (editCharacterReference!.fieldType === 'preset') return preset[editCharacterReference!.field];
    if (editCharacterReference!.fieldType === 'shared') return shared[editCharacterReference!.field];
    return meta![editCharacterReference!.field];
  };
  const setField = (val: any) => {
    if (editCharacterReference!.fieldType === 'preset') preset[editCharacterReference!.field] = val;
    else if (editCharacterReference!.fieldType === 'shared') shared[editCharacterReference!.field] = val;
    else meta![editCharacterReference!.field] = val;
  };
  const referenceChange = async (reference: string) => {
    if (!reference) return;
    const toastId = appState.pushMessage('레퍼런스 이미지 전송 중…', { sticky: true });
    try {
      const path = await imageService.storeReferenceImage(curSession!, reference);
      const defaults = getRefDefaults();
      getField().push(
        ReferenceItem.fromJSON({
          path: path,
          info: 1.0,
          strength: defaults.strength,
          fidelity: defaults.fidelity,
          referenceType: defaults.referenceType,
        }),
      );
      appState.dismissMessage(toastId);
      appState.pushMessage('레퍼런스 이미지 추가 완료');
    } catch (e) {
      appState.dismissMessage(toastId);
      appState.pushMessage('레퍼런스 이미지 추가 실패: ' + (e as Error).message);
    }
  };

  // Handle paste event (Ctrl+V)
  useEffect(() => {
    if (!editCharacterReference) return;
    const handlePaste = async (e: ClipboardEvent) => {
      if (disabled) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) {
            const reader = new FileReader();
            reader.onload = async (event) => {
              const base64 = (event.target?.result as string)?.split(',')[1];
              if (base64) {
                await referenceChange(base64);
              }
            };
            reader.readAsDataURL(file);
          }
          break;
        }
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [editCharacterReference, disabled, curSession]);

  // Handle drag and drop
  const handleDragEnter = (e: React.DragEvent) => {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDrop = async (e: React.DragEvent) => {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = async (event) => {
          const base64 = (event.target?.result as string)?.split(',')[1];
          if (base64) {
            await referenceChange(base64);
          }
        };
        reader.readAsDataURL(file);
      }
    }
  };

  return (
    editCharacterReference && (
      <div
        ref={containerRef}
        className={`w-full h-full overflow-hidden flex flex-col ${isDragging ? 'ring-2 ring-sky-500 bg-sky-50 dark:bg-sky-900/20' : ''}`}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <div className="flex-1 overflow-hidden">
          <div className="h-full overflow-auto">
            {/* 기본값 설정 섹션 */}
            <div className="mx-2 mt-2 mb-1">
              <button
                className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 flex items-center gap-1"
                onClick={() => setShowDefaults(!showDefaults)}
              >
                {showDefaults ? '▾' : '▸'} 새 레퍼런스 기본값 설정
              </button>
              {showDefaults && (
                <div className="mt-2 p-3 bg-gray-100 dark:bg-slate-700 rounded-lg space-y-3 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="gray-label w-20 flex-none">Strength:</span>
                    <input
                      type="range"
                      className="flex-1"
                      min="0" max="2" step="0.01"
                      value={refDefaults.strength}
                      onChange={(e) => updateDefault(REF_DEFAULT_STRENGTH_KEY, e.target.value)}
                    />
                    <input
                      className="w-14 flex-none text-center text-default back-lllgray rounded outline-none"
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min="0"
                      max="2"
                      value={refDefaults.strength}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        if (!isNaN(v)) {
                          updateDefault(REF_DEFAULT_STRENGTH_KEY, String(Math.max(0, Math.min(2, v))));
                        }
                      }}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="gray-label w-20 flex-none">Fidelity:</span>
                    <input
                      type="range"
                      className="flex-1"
                      min="0" max="2" step="0.01"
                      value={refDefaults.fidelity}
                      onChange={(e) => updateDefault(REF_DEFAULT_FIDELITY_KEY, e.target.value)}
                    />
                    <input
                      className="w-14 flex-none text-center text-default back-lllgray rounded outline-none"
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min="0"
                      max="2"
                      value={refDefaults.fidelity}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        if (!isNaN(v)) {
                          updateDefault(REF_DEFAULT_FIDELITY_KEY, String(Math.max(0, Math.min(2, v))));
                        }
                      }}
                    />
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="gray-label w-20 flex-none">유형:</span>
                    {(['character', 'style', 'character&style'] as const).map((t) => (
                      <label key={t} className="flex items-center gap-1 cursor-pointer">
                        <input
                          type="radio"
                          name="ref-default-type"
                          checked={refDefaults.referenceType === t}
                          onChange={() => updateDefault(REF_DEFAULT_TYPE_KEY, t)}
                          className="accent-sky-500"
                        />
                        <span className="text-default">{t}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
            {getField().length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-gray-400 dark:text-gray-500 p-8">
                <FaCloudUploadAlt size={48} className="mb-4 opacity-60" />
                {!isMobile ? (
                  <>
                    <p className="text-base font-medium mb-1">이미지를 드래그하거나</p>
                    <p className="text-base font-medium">Ctrl+V로 붙여넣기 할 수 있습니다</p>
                  </>
                ) : (
                  <p className="text-base font-medium text-center">아래 업로드 버튼으로<br/>이미지를 추가하세요</p>
                )}
              </div>
            )}
            {getField().map((reference: ReferenceItem) => (
              <div
                key={reference.path}
                className={`border mt-2 p-2 flex gap-2 items-begin ${reference.enabled !== false ? 'border-sky-500 bg-sky-50 dark:bg-sky-900/20' : 'border-gray-300 opacity-60'}`}
              >
                <VibeImage
                  path={
                    reference.path &&
                    imageService.getReferenceImagePath(curSession!, reference.path)
                  }
                  className="flex-none w-28 h-28 object-cover"
                />
                <div className="flex flex-col gap-2 w-full">
                  <div className="flex w-full items-center justify-between">
                    <div className="flex gap-2 items-center">
                      {isPresetActive && reference.fromPreset ? (
                        <div className="text-xs text-gray-400 dark:text-gray-500">🔒 프리셋 잠금</div>
                      ) : (
                        <button
                          className={`round-button h-8 px-4 ${reference.enabled !== false ? 'back-sky' : 'back-gray'}`}
                          onClick={() => {
                            if (disabled) return;
                            reference.enabled = reference.enabled === false;
                          }}
                          disabled={disabled}
                        >
                          {reference.enabled !== false ? <FaToggleOn className="mr-1" /> : <FaToggleOff className="mr-1" />}
                          {reference.enabled !== false ? '활성화됨' : '비활성화됨'}
                        </button>
                      )}
                    </div>
                    {!(isPresetActive && reference.fromPreset) && (
                      <Tooltip content="레퍼런스 삭제">
                      <button
                        className={
                          `round-button h-8 px-4 ` +
                          (disabled ? 'back-gray' : 'back-red')
                        }
                        onClick={() => {
                          if (disabled) return;
                          setField(getField().filter((x: any) => x !== reference));
                        }}
                      >
                        <FaTrash />
                      </button>
                      </Tooltip>
                    )}
                  </div>
                  <div className="flex w-full md:flex-row flex-col items-center">
                    <GrayLabel>Strength:</GrayLabel>
                    <div className="flex flex-1 md:w-auto w-full gap-1">
                      <input
                        className="flex-1"
                        type="range"
                        step="0.01"
                        min="0"
                        max="2"
                        value={reference.strength}
                        onChange={(e) => {
                          reference.strength = parseFloat(e.target.value);
                        }}
                        disabled={disabled}
                      />
                      <input
                        className="w-14 flex-none text-lg text-center back-lllgray rounded outline-none"
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                        min="0"
                        max="2"
                        value={reference.strength}
                        onChange={(e) => {
                          const v = parseFloat(e.target.value);
                          if (!isNaN(v)) {
                            reference.strength = Math.max(0, Math.min(2, v));
                          }
                        }}
                        disabled={disabled}
                      />
                    </div>
                  </div>
                  <div className="flex w-full md:flex-row flex-col items-center">
                    <GrayLabel>Fidelity:</GrayLabel>
                    <div className="flex flex-1 md:w-auto w-full gap-1">
                      <input
                        className="flex-1"
                        type="range"
                        step="0.01"
                        min="0"
                        max="2"
                        value={reference.fidelity}
                        onChange={(e) => {
                          reference.fidelity = parseFloat(e.target.value);
                        }}
                        disabled={disabled}
                      />
                      <input
                        className="w-14 flex-none text-lg text-center back-lllgray rounded outline-none"
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                        min="0"
                        max="2"
                        value={reference.fidelity}
                        onChange={(e) => {
                          const v = parseFloat(e.target.value);
                          if (!isNaN(v)) {
                            reference.fidelity = Math.max(0, Math.min(2, v));
                          }
                        }}
                        disabled={disabled}
                      />
                    </div>
                  </div>
                  <div className="flex w-full md:flex-row flex-col items-center mt-2">
                    <div className="flex gap-4 items-center flex-wrap">
                      <label className="flex gap-1 items-center cursor-pointer">
                        <input
                          type="radio"
                          name={`refType-${reference.path}`}
                          checked={reference.referenceType === 'character'}
                          onChange={() => {
                            reference.referenceType = 'character';
                          }}
                          disabled={disabled}
                        />
                        <span className="gray-label">캐릭터</span>
                      </label>
                      <label className="flex gap-1 items-center cursor-pointer">
                        <input
                          type="radio"
                          name={`refType-${reference.path}`}
                          checked={reference.referenceType === 'style'}
                          onChange={() => {
                            reference.referenceType = 'style';
                          }}
                          disabled={disabled}
                        />
                        <span className="gray-label">스타일</span>
                      </label>
                      <label className="flex gap-1 items-center cursor-pointer">
                        <input
                          type="radio"
                          name={`refType-${reference.path}`}
                          checked={reference.referenceType === 'character&style'}
                          onChange={() => {
                            reference.referenceType = 'character&style';
                          }}
                          disabled={disabled}
                        />
                        <span className="gray-label">캐릭터+스타일</span>
                      </label>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="flex-none mt-auto pt-2 flex flex-col gap-2">
          {getField().length > 0 && !isMobile && (
            <div className="text-xs text-gray-500 dark:text-gray-400 text-center">
              이미지를 드래그하거나 Ctrl+V로 붙여넣기 할 수 있습니다
            </div>
          )}
          <div className="flex gap-2 items-center">
            <FileUploadBase64
              notext
              disabled={disabled}
              onFileSelect={referenceChange}
            ></FileUploadBase64>
            <button
              className={`round-button back-gray h-8 w-full`}
              onClick={() => {
                setEditCharacterReference(undefined);
              }}
            >
              캐릭터 레퍼런스 설정 닫기
            </button>
          </div>
        </div>
      </div>
    )
  );
});

export const CharacterReferenceButton = observer(({ input }: { input: WFIInlineInput }) => {
  const { editCharacterReference, setEditCharacterReference, preset, shared, meta, modelVersion } =
    useContext(WFElementContext)!;
  const [activeIndex, setActiveIndex] = useState(0);

  const getField = () => {
    if (input.fieldType === 'preset') return preset[input.field] || [];
    if (input.fieldType === 'shared') return shared[input.field] || [];
    return meta![input.field] || [];
  };

  // v4 모델은 캐릭터 레퍼런스 미지원
  const isV4 = modelVersion === ModelVersion.V4 || modelVersion === ModelVersion.V4Curated;
  const locked = isV4;

  const onClick = () => {
    if (locked) return;
    setEditCharacterReference(input);
  };

  const handleImageClick = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (locked) return;
    const enabledRefs = getField().filter((ref: ReferenceItem) => ref.enabled !== false);
    if (enabledRefs.length > 1) {
      setActiveIndex((prev: number) => (prev + 1) % enabledRefs.length);
    } else {
      onClick();
    }
  };

  const handleOpenEditor = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (locked) return;
    onClick();
  };

  const field = getField();
  const enabledRefs = field.filter((ref: ReferenceItem) => ref.enabled !== false);
  const safeActiveIndex = enabledRefs.length > 0 ? Math.min(activeIndex, enabledRefs.length - 1) : 0;

  const currentReference = enabledRefs.length > 0 ? enabledRefs[safeActiveIndex] : null;
  const hasValidPath = currentReference && currentReference.path;

  return (
    <>
      {editCharacterReference == undefined && field.length === 0 && (
        <div className="w-full flex items-center mt-2">
          <button
            className={`round-button h-8 flex-1 flex ${locked ? 'back-llgray opacity-50 cursor-not-allowed' : 'back-gray'}`}
            onClick={onClick}
            disabled={locked}
          >
            <div className="flex-1">
              {locked ? '캐릭터 레퍼런스 (v4 모델 미지원)' : '캐릭터 레퍼런스 설정 열기'}
            </div>
          </button>
          <CompanionButtons host="characterReferences" />
        </div>
      )}
      {editCharacterReference == undefined && field.length > 0 && (
        <div className={'w-full flex items-center mt-2' + (locked ? ' opacity-50' : '')}>
          <div className={'flex-none mr-2 gray-label'}>
            레퍼런스 설정:
            {locked ? (
              <span className="ml-1 text-xs text-red-400">(v4 미지원)</span>
            ) : (
              <span className="ml-1 text-xs text-sky-500">
                ({enabledRefs.length}/{field.length} 활성화)
              </span>
            )}
          </div>
          <div className="flex-1 flex gap-1 items-center">
            {hasValidPath ? (
              <VibeImage
                path={imageService.getReferenceImagePath(
                  appState.curSession!,
                  currentReference.path,
                )}
                className={'flex-1 h-14 rounded-xl object-cover' + (locked ? ' grayscale' : ' cursor-pointer hover:brightness-95 active:brightness-90')}
                onClick={handleImageClick}
              />
            ) : (
              <div
                className={'flex-1 h-14 rounded-xl bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-gray-500' + (locked ? '' : ' cursor-pointer hover:brightness-95 active:brightness-90')}
                onClick={handleImageClick}
              >
                {locked ? 'v4 모델 미지원' : enabledRefs.length === 0 ? '활성화된 이미지 없음' : '이미지 없음'}
              </div>
            )}
            {!locked && (
              <Tooltip content="레퍼런스 편집">
              <button
                className="flex-none px-2 h-14 rounded-lg back-sky text-white text-xs hover:brightness-95 active:brightness-90"
                onClick={handleOpenEditor}
              >
                편집
              </button>
              </Tooltip>
            )}
          </div>
          <CompanionButtons host="characterReferences" />
        </div>
      )}
    </>
  );
});

const EditorField = ({
  label,
  full,
  children,
  bold,
}: {
  label: string;
  children: React.ReactNode;
  full: boolean;
  bold?: boolean;
}) => {
  return (
    <>
      <div className={'pt-2 pb-1 gray-label'}>
        {bold ? <b>{label}</b> : label}
      </div>
      <div className={full ? 'flex-1 min-h-0' : 'flex-none mt-3'}>
        {children}
      </div>
    </>
  );
};

const InlineEditorField = ({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) => {
  return (
    <div className="pt-2 flex gap-2 items-center">
      <span className={'flex-none gray-label'}>{label}:</span>
      {children}
    </div>
  );
};

interface InnerEditorProps {
  type: string;
  shared: any;
  preset: any;
}

const InnerEditor: React.FC<InnerEditorProps> = ({ type, shared, preset }) => {
  const { curSession } = appState;
  const prompt = React.useRef<string>('');
  const presets = curSession!.presets.get(type)!;
  const getPrompt = () => prompt.current;
  const setPrompt = (txt: string) => {
    prompt.current = txt;
  };
  const [name, setName] = useState(preset.name);
  const queueprompt = async (
    middle: string,
    callback: (path: string) => void,
  ) => {
    let scene = curSession!.getScene('scene', 'style_test') as
      | Scene
      | undefined;
    if (!scene) {
      scene = new Scene();
      scene.name = 'style_test';
      curSession!.addScene(scene);
    }
    scene.resolution = 'portrait';
    scene.slots = [
      [
        PromptPiece.fromJSON({
          enabled: true,
          prompt: middle,
          characterPrompts: [],
          id: v4(),
        }),
      ],
    ];
    const dummyShared = workFlowService.buildShared(type);
    const prompts = await workFlowService.createPrompts(
      type,
      curSession!,
      scene,
      preset,
      dummyShared,
    );
    const characterPrompts = await workFlowService.createCharacterPrompts(
      type,
      curSession!,
      scene,
      preset,
      dummyShared,
    );
    await workFlowService.pushJob(
      type,
      curSession!,
      scene,
      prompts[0].prompt,
      characterPrompts[0],
      preset,
      dummyShared,
      1,
      undefined,
      callback,
      true,
      prompts[0].uc,
    );
    taskQueueService.run();
  };
  const setMainImage = async (path: string) => {
    const newPath = imageService.getVibesDir(curSession!) + '/' + v4() + '.png';
    await backend.copyFile(path, newPath);
    preset.profile = newPath.split('/').pop()!;
  };
  return (
    <div className="flex flex-col h-full">
      <div className="grow-0 pt-1 px-2 flex gap-2 items-center text-nowrap flex-wrap mb-1 md:mb-0">
        <div className="flex items-center gap-2">
          <label className="gray-label">그림체 이름:</label>
          <input
            className="gray-input"
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        </div>
        <button
          className={`round-button back-sky`}
          onClick={async () => {
            if (presets.find((x) => x.name === name)) {
              appState.pushMessage('이미 존재하는 그림체 이름입니다');
              return;
            }
            if (curSession!.selectedWorkflow?.presetName === preset.name) {
              preset.name = name;
              curSession!.selectedWorkflow = {
                workflowType: type,
                presetName: name,
              };
            } else {
              preset.name = name;
            }
          }}
        >
          이름변경
        </button>
      </div>
      <div className="flex-1 overflow-hidden p-2">
        <BigPromptEditor
          PresetEditor={UnionPreSetEditor}
          key="bigprompt"
          general={false}
          type={type}
          preset={preset}
          shared={shared}
          getMiddlePrompt={getPrompt}
          setMiddlePrompt={setPrompt}
          getCharacterMiddlePrompt={() => ''}
          setCharacterMiddlePrompt={() => {}}
          queuePrompt={queueprompt}
          setMainImage={setMainImage}
          initialImagePath={undefined}
        />
      </div>
    </div>
  );
};

const ProfilePreSetSelect = observer(({}) => {
  const { curSession } = appState;
  const { preset, type, shared, middlePromptMode } =
    useContext(WFElementContext)!;
  const presets = curSession!.presets.get(type)!;
  const [selected, setSelected] = useState<any | undefined>(undefined);
  const multiImportInputRef = React.useRef<HTMLInputElement>(null);
  const { show, hideAll } = useContextMenu({
    id: ContextMenuType.Style,
  });
  const containerRef = React.useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onStyleEdit = (e: any) => {
      if (e.detail.container !== containerRef.current) return;
      setSelected(e.detail.preset);
    };
    sessionService.addEventListener('style-edit', onStyleEdit);
    return () => {
      sessionService.removeEventListener('style-edit', onStyleEdit);
    };
  });

  return (
    <div
      ref={containerRef}
      className={
        'mt-2 overflow-hidden min-h-0 ' + (middlePromptMode ? 'h-1/5' : 'h-1/3')
      }
    >
      {selected && (
        <FloatView
          priority={1}
          onEscape={() => {
            setSelected(undefined);
          }}
        >
          <InnerEditor type={type} shared={shared} preset={selected} />
        </FloatView>
      )}
      <div className="h-full w-full flex overflow-auto gap-2">
        {presets.map((x) => (
          <div
            className={
              'h-full relative flex-none hover:brightness-95 active:brightness-90 cursor-pointer ' +
              (x == preset ? 'border-2 border-sky-500' : 'border-2 line-color')
            }
            key={x.name}
            onContextMenu={(e) => {
              show({
                event: e,
                props: {
                  ctx: {
                    type: 'style',
                    preset: x,
                    session: curSession!,
                    container: containerRef.current!,
                  },
                },
              });
            }}
            onClick={() => {
              curSession!.selectedWorkflow = {
                workflowType: type,
                presetName: x.name,
              };
            }}
          >
            {x.profile && (
              <VibeImage
                path={
                  imageService.getVibesDir(curSession!) +
                  '/' +
                  x.profile.split('/').pop()!
                }
                className="w-auto h-full"
              />
            )}
            {!x.profile && <div className="w-40 h-full"></div>}
            <div
              className="absolute bottom-0 right-0 bg-gray-700 opacity-80 text-sm text-white p-1 rounded-xl m-2 truncate select-none"
              style={{ maxWidth: '90%' }}
            >
              {x.name}
            </div>
          </div>
        ))}
        <div className="h-full relative flex-none flex flex-col gap-2">
          <Tooltip content="새 그림체 추가">
          <div
            className="flex-1 w-10 flex m-4 items-center justify-center rounded-xl clickable back-lllgray"
            onClick={async () => {
              const name = await appState.pushDialogAsync({
                type: 'input-confirm',
                text: '그림체 이름을 입력하세요',
              });
              if (!name) return;
              if (presets.find((x) => x.name === name)) {
                appState.pushMessage('이미 존재하는 그림체 이름입니다');
                return;
              }
              const newPreset = workFlowService.buildPreset(type);
              newPreset.name = name;
              presets.push(newPreset);
            }}
          >
            <FaPlus />
          </div>
          </Tooltip>
          <Tooltip content="여러 그림체 파일 가져오기">
          <div
            className="flex-1 w-10 flex m-4 items-center justify-center rounded-xl clickable back-lllgray"
            onClick={() => multiImportInputRef.current?.click()}
          >
            <FaFolderOpen />
          </div>
          </Tooltip>
          {/* 진단 Med-12: 웹은 selectFiles 불가 — file input으로 읽어 base64 리스트 전달 */}
          <input
            type="file"
            accept="image/png"
            multiple
            ref={multiImportInputRef}
            className="hidden"
            onChange={async (e) => {
              const files = e.target.files;
              e.target.value = '';
              if (!files || files.length === 0) return;
              const list: Array<{ name: string; base64: string }> = [];
              for (const file of Array.from(files)) {
                const buf = await file.arrayBuffer();
                list.push({ name: file.name, base64: Buffer.from(buf).toString('base64') });
              }
              await appState.importMultiplePresets(list);
            }}
          />
          <Tooltip content="글로벌 프리셋에서 가져오기">
          <div
            className="flex-1 w-10 flex m-4 items-center justify-center rounded-xl clickable back-lllgray"
            onClick={() => {
              appState.openGlobalPresetPicker('SDImageGenEasy');
            }}
          >
            <FaStar />
          </div>
          </Tooltip>
        </div>
      </div>
    </div>
  );
});

const IntSliderInput = ({
  label,
  value,
  onChange,
  disabled,
  step,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (val: number) => void;
  disabled: boolean;
  step: number;
  min: number;
  max: number;
}) => {
  return (
    <div className="flex w-full items-center md:flex-row flex-col mt-2 gap-2">
      <GrayLabel>{label}:</GrayLabel>
      <div className="flex flex-1 md:w-auto w-full gap-1">
        <input
          className="flex-1"
          type="range"
          step={step}
          min={min}
          max={max}
          value={value}
          onChange={(e) => {
            onChange(parseFloat(e.target.value));
          }}
          disabled={disabled}
        />
        <div className="w-11 flex-none text-lg text-center back-lllgray">
          {value}
        </div>
      </div>
    </div>
  );
};

// 현재 프로젝트의 상위/하위/네거티브 프롬프트를 다른 프로젝트로 통째 복사.
// chunk 토큰은 stripAllChunkTokens로 제외(텍스트만 복사) — 단계 4.
// 대상 preset 필드는 makeAutoObservable이라 수정 시 onAdded reaction이 자동 저장.
const PromptCopyDialog = observer(
  ({
    workflowType,
    sourcePreset,
    onClose,
  }: {
    workflowType: string;
    sourcePreset: any;
    onClose: () => void;
  }) => {
    const curSession = appState.curSession!;
    const FIELDS: { key: 'frontPrompt' | 'backPrompt' | 'uc'; label: string }[] = [
      { key: 'frontPrompt', label: '상위 프롬프트' },
      { key: 'backPrompt', label: '하위 프롬프트' },
      { key: 'uc', label: '네거티브 프롬프트' },
    ];
    const [checked, setChecked] = useState<Record<string, boolean>>({
      frontPrompt: true,
      backPrompt: true,
      uc: true,
    });
    const [selectedTargets, setSelectedTargets] = useState<Set<string>>(
      new Set(),
    );
    const [busy, setBusy] = useState(false);
    // chunk 포함 여부 — 기본 제외(텍스트만). chunk는 전역이라 토큰 그대로 복사하면
    // 대상 프로젝트에서도 같은 알약으로 유효(별도 마이그레이션 불필요).
    const [includeChunks, setIncludeChunks] = useState(false);
    // 다른 프로젝트만 대상 (워크플로우 일치 여부는 복사 시점에 개별 검사).
    const targets = sessionService
      .list()
      .filter((n) => n !== curSession.name);

    const selectedKeys = FIELDS.filter((f) => checked[f.key]).map((f) => f.key);
    const toggleTarget = (n: string) =>
      setSelectedTargets((s) => {
        const next = new Set(s);
        if (next.has(n)) next.delete(n);
        else next.add(n);
        return next;
      });

    // 대상 프로젝트를 폴더 트리로: 미분류(루트) + 폴더별 그룹.
    const folderOf = (n: string) => sessionService.folderMap[n] ?? null;
    const rootTargets = targets.filter((n) => !folderOf(n));
    const folderGroups = sessionService.folderList
      .map((f) => ({ folder: f, items: targets.filter((n) => folderOf(n) === f) }))
      .filter((g) => g.items.length > 0);
    const renderTarget = (n: string) => (
      <label
        key={n}
        className="flex items-center gap-2 cursor-pointer text-sm gray-label p-2 rounded hover:bg-gray-100 dark:hover:bg-slate-700"
      >
        <input
          type="checkbox"
          checked={selectedTargets.has(n)}
          onChange={() => toggleTarget(n)}
        />
        {n}
      </label>
    );
    const toggleFolder = (items: string[]) => {
      const allSel = items.every((n) => selectedTargets.has(n));
      setSelectedTargets((s) => {
        const next = new Set(s);
        items.forEach((n) => (allSel ? next.delete(n) : next.add(n)));
        return next;
      });
    };

    const doCopy = async () => {
      if (selectedTargets.size === 0 || selectedKeys.length === 0 || busy) return;
      setBusy(true);
      try {
        let ok = 0;
        const skipped: string[] = [];
        for (const name of selectedTargets) {
          const targetSession = await sessionService.get(name);
          if (!targetSession) {
            skipped.push(`${name}(불러오기 실패)`);
            continue;
          }
          const flow = targetSession.selectedWorkflow;
          if (!flow || flow.workflowType !== workflowType) {
            skipped.push(`${name}(워크플로우 다름)`);
            continue;
          }
          const targetPreset =
            flow.presetName &&
            targetSession.getPreset(workflowType, flow.presetName);
          if (!targetPreset) {
            skipped.push(`${name}(사전세팅 없음)`);
            continue;
          }
          for (const key of selectedKeys) {
            const raw = sourcePreset[key] || '';
            // includeChunks=true면 토큰 그대로(전역 chunk라 대상에서도 유효),
            // false면 토큰 제외하고 사용자 텍스트만.
            targetPreset[key] = includeChunks ? raw : stripAllChunkTokens(raw);
          }
          ok++;
        }
        let msg = `${ok}개 프로젝트로 프롬프트를 복사했어요.`;
        if (skipped.length) msg += ` 건너뜀: ${skipped.join(', ')}`;
        appState.pushMessage(msg);
        if (ok > 0) onClose();
      } catch (e: any) {
        appState.pushMessage('복사 실패: ' + (e?.message || e));
      } finally {
        setBusy(false);
      }
    };

    return (
      <ModalOverlay isOpen={true} onClose={onClose} title="다른 프로젝트로 프롬프트 복사">
        <div className="text-default flex flex-col gap-4">
          <div className="text-xs text-gray-500 dark:text-gray-400">
            현재 프로젝트의 프롬프트를 선택한 프로젝트들의 같은 워크플로우 사전세팅에
            <strong> 덮어쓰기</strong> 해요.
          </div>

          {/* 복사할 항목 */}
          <div className="flex flex-col gap-2">
            <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
              복사할 항목
            </div>
            {FIELDS.map((f) => (
              <label
                key={f.key}
                className="flex items-center gap-2 cursor-pointer text-sm gray-label"
              >
                <input
                  type="checkbox"
                  checked={checked[f.key]}
                  onChange={(e) =>
                    setChecked((c) => ({ ...c, [f.key]: e.target.checked }))
                  }
                />
                {f.label}
              </label>
            ))}
            <label className="flex items-center gap-2 cursor-pointer text-sm gray-label mt-1 pt-2 border-t border-gray-200 dark:border-gray-600">
              <input
                type="checkbox"
                checked={includeChunks}
                onChange={(e) => setIncludeChunks(e.target.checked)}
              />
              chunk 알약도 함께 복사 (끄면 텍스트만, 켜면 알약 그대로 — 전역이라 대상에서도 동일하게 표시)
            </label>
          </div>

          {/* 대상 프로젝트 (다중 선택) */}
          <div className="flex flex-col gap-2">
            <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
              대상 프로젝트 (여러 개 선택 가능)
            </div>
            {targets.length === 0 ? (
              <div className="text-sm text-gray-500 dark:text-gray-400 py-2">
                복사할 다른 프로젝트가 없어요.
              </div>
            ) : (
              <div className="flex flex-col gap-1 max-h-[40vh] overflow-y-auto">
                {rootTargets.map(renderTarget)}
                {folderGroups.map((g) => (
                  <div key={g.folder} className="flex flex-col">
                    <button
                      className="flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-gray-400 px-2 pt-1.5 pb-0.5 hover:text-gray-700 dark:hover:text-gray-200 text-left"
                      onClick={() => toggleFolder(g.items)}
                      title="폴더 안 전체 선택/해제"
                    >
                      <span>📁</span>
                      <span className="truncate">{g.folder}</span>
                      <span className="opacity-60">({g.items.filter((n) => selectedTargets.has(n)).length}/{g.items.length})</span>
                    </button>
                    <div className="ml-3 flex flex-col">{g.items.map(renderTarget)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 실행 */}
          <button
            className="w-full px-4 py-2 rounded-lg bg-sky-500 hover:bg-sky-600 text-white text-sm font-medium transition-colors disabled:opacity-50"
            disabled={selectedTargets.size === 0 || selectedKeys.length === 0 || busy}
            onClick={() => {
              appState.pushDialog({
                type: 'confirm',
                text: `${selectedTargets.size}개 프로젝트의 사전세팅에 선택한 프롬프트를 덮어쓸까요? (기존 내용 대체)`,
                callback: doCopy,
              });
            }}
          >
            {busy ? '복사 중…' : '복사'}
          </button>
        </div>
      </ModalOverlay>
    );
  },
);

// 현재 프로젝트의 상위/하위/네거티브 프롬프트(체크한 칸)를 비우기. 복사와 같은 UI.
// preset 필드를 빈 문자열로 = makeAutoObservable이라 자동 저장.
const PromptClearDialog = observer(
  ({
    sourcePreset,
    onClose,
  }: {
    sourcePreset: any;
    onClose: () => void;
  }) => {
    const FIELDS: { key: 'frontPrompt' | 'backPrompt' | 'uc'; label: string }[] = [
      { key: 'frontPrompt', label: '상위 프롬프트' },
      { key: 'backPrompt', label: '하위 프롬프트' },
      { key: 'uc', label: '네거티브 프롬프트' },
    ];
    const [checked, setChecked] = useState<Record<string, boolean>>({
      frontPrompt: true,
      backPrompt: true,
      uc: true,
    });
    const selectedKeys = FIELDS.filter((f) => checked[f.key]).map((f) => f.key);

    const doClear = () => {
      for (const key of selectedKeys) {
        sourcePreset[key] = '';
      }
      appState.pushMessage(`${selectedKeys.length}개 프롬프트를 비웠어요.`);
      onClose();
    };

    return (
      <ModalOverlay isOpen={true} onClose={onClose} title="프롬프트 전체 삭제">
        <div className="text-default flex flex-col gap-4">
          <div className="text-xs text-gray-500 dark:text-gray-400">
            현재 프로젝트의 선택한 프롬프트 칸을 <strong>전부 비워요</strong>.
          </div>
          <div className="flex flex-col gap-2">
            <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
              삭제할 항목
            </div>
            {FIELDS.map((f) => (
              <label
                key={f.key}
                className="flex items-center gap-2 cursor-pointer text-sm gray-label"
              >
                <input
                  type="checkbox"
                  checked={checked[f.key]}
                  onChange={(e) =>
                    setChecked((c) => ({ ...c, [f.key]: e.target.checked }))
                  }
                />
                {f.label}
              </label>
            ))}
          </div>
          <button
            className="w-full px-4 py-2 rounded-lg bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors disabled:opacity-50"
            disabled={selectedKeys.length === 0}
            onClick={() => {
              appState.pushDialog({
                type: 'confirm',
                text: `선택한 ${selectedKeys.length}개 프롬프트를 비울까요? (되돌릴 수 없어요)`,
                callback: doClear,
              });
            }}
          >
            비우기
          </button>
        </div>
      </ModalOverlay>
    );
  },
);

const PreSetSelect = observer(({ workflowType }: { workflowType: string }) => {
  const curSession = appState.curSession!;
  const [isOpen, setIsOpen] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [chunkOpen, setChunkOpen] = useState(false);
  const clicked = React.useRef(false);
  const presets = curSession.presets.get(workflowType)!;
  const { preset } = useContext(WFElementContext)!;
  useEffect(() => {
    const close = () => {
      if (!clicked.current) setIsOpen(false);
      else clicked.current = false;
    };
    window.addEventListener('click', close);
    return () => {
      window.removeEventListener('click', close);
    };
  });
  return (
    <div className="flex flex-wrap gap-2 mt-2 items-center relative">
      <div className="flex-none gray-label">사전세팅선택:</div>
      <div
        className="round-button back-gray h-9 flex-auto min-w-0 truncate"
        onClick={() => {
          setIsOpen(!isOpen);
          clicked.current = true;
        }}
      >
        {curSession.selectedWorkflow?.presetName}
      </div>
      <div className="flex gap-2 items-center flex-none">
      <button
        className={`icon-button`}
        onClick={async () => {
          const name = await appState.pushDialogAsync({
            type: 'input-confirm',
            text: '사전 세팅 이름을 입력하세요',
          });
          if (!name) return;
          if (presets.find((x) => x.name === name)) {
            appState.pushMessage('이미 존재하는 사전 세팅 이름입니다');
            return;
          }
          const newPreset = workFlowService.buildPreset(workflowType);
          newPreset.name = name;
          curSession.addPreset(newPreset);
          curSession.selectedWorkflow = {
            workflowType: workflowType,
            presetName: name,
          };
        }}
      >
        <FaPlus />
      </button>
      {workflowType === 'SDImageGen' && (
        <Tooltip content="글로벌 프리셋에서 가져오기">
          <button
            className={`icon-button`}
            onClick={() => {
              appState.openGlobalPresetPicker('SDImageGen');
            }}
          >
            <FaStar />
          </button>
        </Tooltip>
      )}
      <Tooltip content="다른 프로젝트로 프롬프트 복사">
        <button
          className={`icon-button`}
          onClick={() => {
            if (!preset) {
              appState.pushMessage('복사할 사전세팅이 없어요.');
              return;
            }
            setCopyOpen(true);
          }}
        >
          <FaCopy />
        </button>
      </Tooltip>
      <Tooltip content="프롬프트 전체 삭제">
        <button
          className={`icon-button`}
          onClick={() => {
            if (!preset) {
              appState.pushMessage('삭제할 사전세팅이 없어요.');
              return;
            }
            setClearOpen(true);
          }}
        >
          <FaTrashAlt />
        </button>
      </Tooltip>
      <Tooltip content="프롬프트 chunk 관리">
        <button className={`icon-button`} onClick={() => setChunkOpen(true)}>
          <FaLayerGroup />
        </button>
      </Tooltip>
      </div>
      {chunkOpen && (
        <PromptChunkManager onClose={() => setChunkOpen(false)} />
      )}
      {copyOpen && preset && (
        <PromptCopyDialog
          workflowType={workflowType}
          sourcePreset={preset}
          onClose={() => setCopyOpen(false)}
        />
      )}
      {clearOpen && preset && (
        <PromptClearDialog
          sourcePreset={preset}
          onClose={() => setClearOpen(false)}
        />
      )}
      {isOpen && (
        <ul className="left-0 top-10 absolute max-h-60 z-20 w-full mt-1 bg-white border-2 border-gray-300 dark:border-slate-600 rounded-md shadow-lg overflow-auto dark:bg-slate-700">
          {presets.map((option) => (
            <li
              key={option.name}
              className="text-default flex items-center justify-between p-2 clickable bg-white dark:bg-slate-700"
            >
              <button
                onClick={() => {
                  curSession.selectedWorkflow = {
                    workflowType: workflowType,
                    presetName: option.name,
                  };
                }}
                className="w-full text-left"
              >
                {option.name}
              </button>
              <div className="flex">
                <button
                  onClick={async () => {
                    const newName = await appState.pushDialogAsync({
                      type: 'input-confirm',
                      text: '새 사전 세팅 이름을 입력하세요',
                    });
                    if (!newName) return;
                    if (presets.find((x) => x.name === newName)) {
                      appState.pushMessage(
                        '이미 존재하는 사전 세팅 이름입니다',
                      );
                      return;
                    }
                    if (
                      curSession.selectedWorkflow?.presetName === option.name
                    ) {
                      option.name = newName;
                      curSession.selectedWorkflow = {
                        workflowType: workflowType,
                        presetName: newName,
                      };
                    } else {
                      option.name = newName;
                    }
                  }}
                  className="p-2 mx-1 icon-button bg-green-500"
                >
                  <FaFont />
                </button>
                <Tooltip content="그림체 복제">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    const newPreset = workFlowService.presetFromJSON(
                      option.toJSON(),
                    );
                    let num = 1;
                    while (
                      presets.find(
                        (x) =>
                          x.name === option.name + ' copy ' + num.toString(),
                      )
                    ) {
                      num++;
                    }
                    const newName = option.name + ' copy ' + num.toString();
                    newPreset.name = newName;
                    curSession!.addPreset(newPreset);
                  }}
                  className="p-2 mx-1 icon-button bg-sky-500"
                >
                  <FaCopy />
                </button>
                </Tooltip>
                <Tooltip content="그림체 내보내기">
                <button
                  onClick={async (e) => {
                    e.stopPropagation();
                    await appState.exportPreset(curSession, option);
                  }}
                  className="p-2 mx-1 icon-button bg-orange-500"
                >
                  <FaShare />
                </button>
                </Tooltip>
                {(workflowType === 'SDImageGen' ||
                  workflowType === 'SDImageGenEasy') && (
                  <Tooltip content="글로벌 프리셋으로 저장">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        appState.exportPresetToGlobal(curSession, option);
                      }}
                      className="p-2 mx-1 icon-button bg-yellow-500"
                    >
                      <FaStar />
                    </button>
                  </Tooltip>
                )}
                <Tooltip content="그림체 삭제">
                <button
                  onClick={() => {
                    if (presets.length === 1) {
                      appState.pushMessage(
                        '마지막 사전 세팅은 삭제할 수 없습니다',
                      );
                      return;
                    }
                    appState.pushDialog({
                      type: 'confirm',
                      text: '정말로 사전 세팅을 삭제하시겠습니까?',
                      callback: () => {
                        curSession!.removePreset(workflowType, option.name);
                        curSession!.selectedWorkflow = {
                          workflowType: workflowType,
                          presetName: undefined,
                        };
                      },
                    });
                  }}
                  className="p-2 mx-1 icon-button bg-red-500"
                >
                  <FaTrash />
                </button>
                </Tooltip>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});

interface NullIntInputProps {
  label: string;
  value: number | null;
  disabled: boolean;
  onChange: (val: number | undefined) => void;
}

const NullIntInput = ({
  label,
  value,
  onChange,
  disabled,
}: NullIntInputProps) => {
  return (
    <input
      className={`w-full gray-input`}
      disabled={disabled}
      value={value ? value.toString() : ''}
      onChange={(e) => {
        try {
          const num = parseInt(e.target.value);
          if (e.target.value === '') throw new Error('No seed');
          if (isNaN(num)) throw new Error('Invalid seed');
          if (!Number.isInteger(num))
            throw new Error('Seed must be an integer');
          if (num <= 0) throw new Error('Seed must be positive');
          onChange(num);
        } catch (e) {
          onChange(undefined);
        }
      }}
    />
  );
};

interface IWFElementContext {
  preset: any;
  shared: any;
  meta?: any;
  type: string;
  middlePromptMode: boolean;
  editVibe: WFIInlineInput | undefined;
  setEditVibe: (vibe: WFIInlineInput | undefined) => void;
  editCharacterReference: WFIInlineInput | undefined;
  setEditCharacterReference: (reference: WFIInlineInput | undefined) => void;
  editCharacters: string | undefined;
  setEditCharacters: (field: string | undefined) => void;
  showGroup?: string;
  setShowGroup: (group: string | undefined) => void;
  showGroupOverlay?: string;
  setShowGroupOverlay: (group: string | undefined) => void;
  groupElement?: WFIGroup;
  getMiddlePrompt?: () => string;
  onMiddlePromptChange?: (txt: string) => void;
  getCharacterMiddlePrompt?: (index: number) => string;
  onCharacterMiddlePromptChange?: (index: number, txt: string) => void;
  modelVersion: ModelVersion;
}

interface WFElementProps {
  element: WFIElement;
}

const WFElementContext = React.createContext<IWFElementContext | null>(null);

interface IWFGroupContext {
  curGroup?: string;
}

const WFGroupContext = React.createContext<IWFGroupContext | null>(null);
const PresetFooterContext = React.createContext<React.ReactNode>(undefined);

const PROMPT_FOLD_LS_KEY = 'sdstudio-prompt-fold';
function loadPromptFold(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(PROMPT_FOLD_LS_KEY) || '{}') || {};
  } catch {
    return {};
  }
}
function getPromptFold(key: string, defaultFolded: boolean): boolean {
  const state = loadPromptFold();
  return typeof state[key] === 'boolean' ? state[key] : defaultFolded;
}
function persistPromptFold(key: string, folded: boolean): void {
  const state = loadPromptFold();
  state[key] = folded;
  try {
    localStorage.setItem(PROMPT_FOLD_LS_KEY, JSON.stringify(state));
  } catch {}
}

const WFRenderElement = observer(({ element }: WFElementProps) => {
  switch (element.type) {
    case 'stack':
      return <WFRStack element={element} />;
    case 'inline':
      return <WFRInline element={element} />;
    case 'group':
      return <WFRGroup element={element} />;
    case 'presetSelect':
      return <WFRPresetSelect element={element} />;
    case 'profilePresetSelect':
      return <WFRProfilePresetSelect element={element} />;
    case 'push':
      return <WFRPush element={element} />;
    case 'middlePlaceholder':
      return <WFRMiddlePlaceholder element={element} />;
    case 'extraPrompt':
      return <WFRExtraPrompt element={element} />;
    case 'showImage':
      return <WFRShowImage element={element} />;
    case 'ifIn':
      return <WFRIfIn element={element} />;
    case 'sceneOnly':
      return <WFRSceneOnly element={element} />;
  }
});

const WFRSceneOnly = observer(({ element }: WFElementProps) => {
  const { meta, editVibe, showGroup } =
    useContext(WFElementContext)!;
  const { curGroup } = useContext(WFGroupContext)!;
  const input = element as WFISceneOnly;
  if (editVibe != undefined || curGroup !== showGroup) {
    return <></>;
  }
  if (!meta) {
    return <></>;
  }
  return <WFRenderElement element={input.element} />;
});

const WFRIfIn = observer(({ element }: WFElementProps) => {
  const { shared, preset, meta, showGroup, editVibe } =
    useContext(WFElementContext)!;
  const { curGroup } = useContext(WFGroupContext)!;
  const input = element as WFIIfIn;
  const getField = () => {
    if (input.fieldType === 'preset') return preset[input.field];
    if (input.fieldType === 'shared') return shared[input.field];
    return meta![input.field];
  };
  if (editVibe != undefined || curGroup !== showGroup) {
    return <></>;
  }
  if (!input.values.includes(getField())) {
    return <></>;
  }
  return <WFRenderElement element={input.element} />;
});

const WFRShowImage = observer(({ element }: WFElementProps) => {
  const curSession = appState.curSession;
  const { meta, preset, shared, editVibe, showGroup } =
    useContext(WFElementContext)!;
  const { curGroup } = useContext(WFGroupContext)!;
  const input = element as WFIShowImage;
  const getField = () => {
    if (input.fieldType === 'preset') return preset[input.field];
    if (input.fieldType === 'shared') return shared[input.field];
    return meta![input.field];
  };
  if (editVibe != undefined || curGroup !== showGroup) {
    return <></>;
  }
  return (
    <div className="mt-2">
      {getField() && (
        <VibeImage
          path={imageService.getVibeImagePath(curSession!, getField())}
          className="flex-none w-40 h-40 object-cover"
        />
      )}
    </div>
  );
});

const WFRMiddlePlaceholder = observer(({ element }: WFElementProps) => {
  const { editVibe, showGroup, getMiddlePrompt, onMiddlePromptChange } =
    useContext(WFElementContext)!;
  const input = element as WFIMiddlePlaceholderInput;
  if (!getMiddlePrompt || !onMiddlePromptChange) {
    return <></>;
  }
  if (showGroup || editVibe) {
    return <></>;
  }
  return (
    <EditorField label={input.label} full={true} bold>
      <PromptEditTextArea
        value={getMiddlePrompt!()}
        disabled={false}
        onChange={onMiddlePromptChange!}
      ></PromptEditTextArea>
    </EditorField>
  );
});

const WFRExtraPrompt = observer(({ element }: WFElementProps) => {
  const { editVibe, showGroup } = useContext(WFElementContext)!;
  const session = appState.curSession;
  const input = element as WFIExtraPromptInput;
  const [folded, setFolded] = useState(() => getPromptFold('extraPrompt', true));
  if (!session || showGroup || editVibe) return <></>;
  const toggle = () => {
    const next = !folded;
    persistPromptFold('extraPrompt', next);
    setFolded(next);
  };
  return (
    <div className={folded ? 'flex-none' : 'flex-1 min-h-0'}>
      <PromptEditTextArea
        value={session.extraPrompt}
        disabled={false}
        onChange={(value) => { session.extraPrompt = value; }}
        chunkInsert={true}
        chunkLabel={input.label}
        headerLabel={input.label}
        headerFull={!folded}
        headerCollapsed={folded}
        headerBadge={session.extraPrompt.trim() ? '작성됨' : undefined}
        onHeaderToggle={toggle}
        searchEnabled={true}
      />
    </div>
  );
});

const WFRProfilePresetSelect = observer(({ element }: WFElementProps) => {
  return <ProfilePreSetSelect />;
});

const WFRPresetSelect = observer(({ element }: WFElementProps) => {
  const { type } = useContext(WFElementContext)!;
  return <PreSetSelect workflowType={type} />;
});

const GlobalModelSettings = observer(() => {
  const [modelVersion, setModelVersion] = useState<ModelVersion>(ModelVersion.V4_5);
  const [furryMode, setFurryMode] = useState(false);
  const [disableQuality, setDisableQuality] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const config = await backend.getConfig();
      setModelVersion(config.modelVersion ?? ModelVersion.V4_5);
      setFurryMode(config.furryMode ?? false);
      setDisableQuality(config.disableQuality ?? false);
      setLoaded(true);
    })();
  }, []);

  const saveConfig = async (updates: Record<string, any>) => {
    const config = await backend.getConfig();
    await backend.setConfig({ ...config, ...updates });
    sessionService.configChanged();
  };

  if (!loaded) return null;

  return (
    <div className="mt-4 pt-4 border-t border-gray-200 dark:border-slate-600">
      <div className="text-sm font-semibold text-gray-600 dark:text-gray-300 mb-3">
        모델 설정 (전역)
      </div>
      <div className="space-y-3">
        <div>
          <label className="text-sm gray-label mb-1 block">NAI 모델 버전</label>
          <DropdownSelect
            selectedOption={modelVersion}
            menuPlacement="auto"
            options={[
              { label: 'V4.5 Full', value: ModelVersion.V4_5 },
              { label: 'V4.5 Curated', value: ModelVersion.V4_5Curated },
              { label: 'V4 Full', value: ModelVersion.V4 },
              { label: 'V4 Curated', value: ModelVersion.V4Curated },
            ]}
            onSelect={(opt) => {
              setModelVersion(opt.value as ModelVersion);
              saveConfig({ modelVersion: opt.value });
            }}
          />
        </div>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="globalFurryMode"
            checked={furryMode}
            onChange={(e) => {
              setFurryMode(e.target.checked);
              saveConfig({ furryMode: e.target.checked });
            }}
          />
          <label htmlFor="globalFurryMode" className="text-sm gray-label">
            퍼리 모드 켜기
          </label>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="globalDisableQuality"
            checked={disableQuality}
            onChange={(e) => {
              setDisableQuality(e.target.checked);
              saveConfig({ disableQuality: e.target.checked });
            }}
          />
          <label htmlFor="globalDisableQuality" className="text-sm gray-label">
            NAI 자동 퀄리티 태그 비활성화
          </label>
        </div>
      </div>
    </div>
  );
});

const WFRGroup = observer(({ element }: WFElementProps) => {
  const grp = element as WFIGroup;
  const { editVibe, setShowGroupOverlay } =
    useContext(WFElementContext)!;
  if (editVibe != undefined) {
    return <></>;
  }
  return (
    <button
      className={`round-button back-gray h-8 w-full mt-2`}
      onClick={() => {
        setShowGroupOverlay(grp.label);
      }}
    >
      {grp.label}
    </button>
  );
});

const WFRStack = observer(({ element }: WFElementProps) => {
  const stk = element as WFIStack;
  const footer = useContext(PresetFooterContext);
  return (
    <VerticalStack>
      {stk.inputs.map((x) => (
        <WFRenderElement element={x} />
      ))}
      {footer}
    </VerticalStack>
  );
});

const PresetRootStack = observer(({
  stack,
  slot,
}: {
  stack: WFIStack;
  slot: string;
}) => {
  const footer = useContext(PresetFooterContext);
  const dragged = useRef<string>();
  const inputs = resolvePresetInputs(stack, appState.uiPresetLayout[slot]);
  const keys = inputs.map(wfiElementKey);
  const canEdit = appState.editMode && keys.every(Boolean) && new Set(keys).size === keys.length;

  const commitMove = async (from: string, before?: string) => {
    const current = keys as string[];
    const order = movePresetInput(current, from, before);
    if (order.join('\0') === current.join('\0')) return;
    const previous = appState.uiPresetLayout;
    const next = { ...previous, [slot]: order };
    appState.uiPresetLayout = next;
    try {
      const config = await backend.getConfig();
      await backend.setConfig({ ...config, uiPresetLayout: next });
    } catch (error) {
      appState.uiPresetLayout = previous;
      appState.pushMessage('프리셋 배치 저장 실패: ' + String(error));
    }
  };

  return (
    <div
      className="w-full h-full flex flex-col overflow-hidden"
      onDragOver={(event) => { if (canEdit) event.preventDefault(); }}
      onDrop={(event) => {
        if (!canEdit || !dragged.current) return;
        event.preventDefault();
        void commitMove(dragged.current);
        dragged.current = undefined;
      }}
    >
      {inputs.map((element, index) => {
        const key = keys[index] as string | undefined;
        const movable = canEdit && !!key && !PRESET_LAYOUT_ANCHORS.has(key);
        return (
          <div
            key={key ?? index}
            draggable={movable}
            className={canEdit ? 'relative border border-dashed border-sky-400/60 rounded-md my-0.5' : ''}
            onDragStart={(event) => {
              if (!movable || !key) return;
              dragged.current = key;
              event.dataTransfer.effectAllowed = 'move';
            }}
            onDragOver={(event) => { if (canEdit) event.preventDefault(); }}
            onDrop={(event) => {
              if (!canEdit || !dragged.current || !key) return;
              event.preventDefault();
              event.stopPropagation();
              void commitMove(dragged.current, key);
              dragged.current = undefined;
            }}
          >
            {movable && (
              <span className="absolute right-1 top-1 z-10 px-1 rounded bg-sky-500 text-white text-[10px] cursor-grab">
                ↕
              </span>
            )}
            <WFRenderElement element={element} />
          </div>
        );
      })}
      {footer}
    </div>
  );
});

const NewSceneResolutionRow = observer(() => {
  const session = appState.curSession;
  if (!session) return <></>;
  const value = session.newSceneResolution;
  const size = resolutionValueToSize(value);
  const applyAll = () => {
    const scenes = Array.from(session.scenes.values());
    if (scenes.length === 0) {
      appState.pushMessage('적용할 씬이 없습니다');
      return;
    }
    appState.pushDialog({
      type: 'confirm',
      text: `씬 탭의 모든 씬 ${scenes.length}개에 ${size.width}x${size.height} 해상도를 적용하시겠습니까?`,
      callback: () => {
        const next = value ?? { resolution: 'portrait' };
        for (const scene of scenes) {
          scene.resolution = next.resolution;
          if (next.resolution === 'custom') {
            scene.resolutionWidth = next.width;
            scene.resolutionHeight = next.height;
          } else {
            scene.resolutionWidth = undefined;
            scene.resolutionHeight = undefined;
          }
        }
        sessionService.markDirty(session.name);
        appState.pushMessage(`${scenes.length}개 씬에 해상도를 적용했습니다`);
      },
    });
  };
  return (
    <div className="flex-none mt-2 flex items-center gap-2">
      <span className="flex-none gray-label">새 씬 해상도:</span>
      <ResolutionPicker
        className="flex-1 min-w-0"
        triggerClassName="w-full justify-between py-1.5"
        value={value}
        onApply={(next) => {
          session.newSceneResolution = next;
          sessionService.markDirty(session.name);
        }}
      />
      <Tooltip content="씬 탭의 모든 씬에 이 해상도를 일괄 적용합니다 (인페인트 제외)">
        <button
          className="round-button back-gray text-sm flex-none !px-2.5 !py-1 !min-w-0"
          onClick={applyAll}
        >
          일괄 적용
        </button>
      </Tooltip>
    </div>
  );
});

const WFRPush = observer(({ element }: WFElementProps) => {
  const { showGroup, showGroupOverlay, editVibe } = useContext(WFElementContext)!;
  const { curGroup } = useContext(WFGroupContext)!;
  const push = element as WFIPush;
  const isInOverlay = curGroup !== undefined && curGroup === showGroupOverlay;
  if (!isInOverlay) {
    if (curGroup !== showGroup || editVibe != undefined) {
      return <></>;
    }
  }

  if (push.direction === 'top') {
    return <div className="mt-auto"></div>;
  } else if (push.direction === 'bottom') {
    return <div className="mb-auto"></div>;
  } else if (push.direction === 'left') {
    return <div className="ml-auto"></div>;
  } else if (push.direction === 'right') {
    return <div className="mr-auto"></div>;
  }
});

const charColors = [
  '#ef4444', '#3b82f6', '#22c55e', '#eab308', '#a855f7',
  '#ec4899', '#f97316', '#06b6d4', '#6366f1', '#14b8a6',
];

const CharacterPromptEditor = observer(
  ({ input }: { input: WFIInlineInput }) => {
    const {
      preset,
      shared,
      meta,
      type,
      editCharacters,
      setEditCharacters,
      middlePromptMode,
      getCharacterMiddlePrompt,
      onCharacterMiddlePromptChange,
    } = useContext(WFElementContext)!;

    const [showCoordMap, setShowCoordMap] = useState(false);
    const coordMapRef = useRef<SVGSVGElement | null>(null);
    const [draggingId, setDraggingId] = useState<string | null>(null);

    const getField = () => {
      if (input.fieldType === 'preset') return preset[input.field] || [];
      if (input.fieldType === 'shared') return shared[input.field] || [];
      return meta![input.field] || [];
    };

    const setField = (val: any) => {
      if (input.fieldType === 'preset') preset[input.field] = val;
      else if (input.fieldType === 'shared') shared[input.field] = val;
      else meta![input.field] = val;
    };

    const addCharacter = () => {
      const characters = [...getField()];
      characters.push({
        id: v4(),
        name: '',
        prompt: '',
        uc: '',
        position: { x: 0.5, y: 0.5 },
        enabled: true,
      });
      setField(characters);
    };

    const removeCharacter = (id: string) => {
      const characters = getField().filter((c: CharacterPrompt) => c.id !== id);
      setField(characters);
    };

    const updateCharacter = (id: string, updates: Partial<CharacterPrompt>) => {
      const characters = getField().map((c: CharacterPrompt) =>
        c.id === id ? { ...c, ...updates } : c,
      );
      setField(characters);
    };

    const toggleCharacter = (id: string) => {
      const characters = getField().map((c: CharacterPrompt) =>
        c.id === id ? { ...c, enabled: c.enabled === false ? true : false } : c,
      );
      setField(characters);
    };

    const handleCoordPointer = (e: React.PointerEvent<SVGSVGElement>) => {
      if (!draggingId) return;
      const svg = coordMapRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
      updateCharacter(draggingId, { position: { x: parseFloat(x.toFixed(2)), y: parseFloat(y.toFixed(2)) } });
    };

    if (editCharacters !== input.field) {
      return null;
    }

    const characters = getField();

    return (
      <div className="w-full h-full overflow-hidden flex flex-col">
        <div className="flex-1 overflow-hidden">
          <div className="h-full overflow-auto">
            {/* useCoords 체크박스 */}
            <div className="flex items-center gap-2 px-3 pt-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={preset.useCoords || false}
                  onChange={(e) => {
                    preset.useCoords = e.target.checked;
                  }}
                  className="w-4 h-4"
                />
                <span className="text-sm gray-label">캐릭터 위치 지정 사용</span>
              </label>
            </div>

            {/* 좌표평면 UI */}
            {preset.useCoords && characters.length > 0 && (
              <div className="px-3 pt-2">
                <button
                  className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 flex items-center gap-1 mb-1"
                  onClick={() => setShowCoordMap(!showCoordMap)}
                >
                  {showCoordMap ? '▾' : '▸'} 좌표평면
                </button>
                {showCoordMap && (
                  <div className="relative border border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden"
                    style={{ width: '100%', aspectRatio: '1 / 1', maxWidth: 280 }}>
                    <svg
                      ref={coordMapRef}
                      viewBox="0 0 100 100"
                      className="w-full h-full cursor-crosshair select-none"
                      style={{ touchAction: 'none' }}
                      onPointerDown={(e) => {
                        const svg = coordMapRef.current;
                        if (!svg) return;
                        const rect = svg.getBoundingClientRect();
                        const px = (e.clientX - rect.left) / rect.width;
                        const py = (e.clientY - rect.top) / rect.height;
                        // 가장 가까운 캐릭터 찾기
                        let closest: string | null = null;
                        let minDist = Infinity;
                        for (const c of characters) {
                          if (c.enabled === false) continue;
                          const dx = (c.position?.x ?? 0.5) - px;
                          const dy = (c.position?.y ?? 0.5) - py;
                          const dist = dx * dx + dy * dy;
                          if (dist < minDist) {
                            minDist = dist;
                            closest = c.id;
                          }
                        }
                        if (closest) {
                          setDraggingId(closest);
                          svg.setPointerCapture(e.pointerId);
                        }
                      }}
                      onPointerMove={handleCoordPointer}
                      onPointerUp={(e) => {
                        if (draggingId) {
                          handleCoordPointer(e);
                          setDraggingId(null);
                          coordMapRef.current?.releasePointerCapture(e.pointerId);
                        }
                      }}
                    >
                      {/* 배경 */}
                      <rect x="0" y="0" width="100" height="100" fill="currentColor" className="text-gray-100 dark:text-slate-700" />
                      {/* 9등분 격자선 */}
                      <line x1="33.33" y1="0" x2="33.33" y2="100" stroke="currentColor" className="text-gray-300 dark:text-gray-600" strokeWidth="0.5" />
                      <line x1="66.67" y1="0" x2="66.67" y2="100" stroke="currentColor" className="text-gray-300 dark:text-gray-600" strokeWidth="0.5" />
                      <line x1="0" y1="33.33" x2="100" y2="33.33" stroke="currentColor" className="text-gray-300 dark:text-gray-600" strokeWidth="0.5" />
                      <line x1="0" y1="66.67" x2="100" y2="66.67" stroke="currentColor" className="text-gray-300 dark:text-gray-600" strokeWidth="0.5" />
                      {/* 캐릭터 마커 */}
                      {characters.map((c: CharacterPrompt, idx: number) => {
                        if (c.enabled === false) return null;
                        const cx = (c.position?.x ?? 0.5) * 100;
                        const cy = (c.position?.y ?? 0.5) * 100;
                        const color = charColors[idx % charColors.length];
                        return (
                          <g key={c.id}>
                            <circle cx={cx} cy={cy} r="5" fill={color} stroke="white" strokeWidth="1" opacity={draggingId === c.id ? 0.8 : 1} />
                            <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central" fill="white" fontSize="5" fontWeight="bold" style={{ pointerEvents: 'none' }}>
                              {idx + 1}
                            </text>
                          </g>
                        );
                      })}
                    </svg>
                  </div>
                )}
              </div>
            )}

            {characters.map((character: CharacterPrompt, i: number) => (
              <div
                key={character.id}
                className={`border rounded-md mt-3 p-3 ${character.enabled === false ? 'opacity-60 border-gray-300' : 'border-sky-500 bg-sky-50 dark:bg-sky-900/20'}`}
              >
                <div className="flex justify-between items-center mb-2">
                  <div className="flex items-center gap-2 gray-label">
                    <span
                      className="inline-flex items-center justify-center w-6 h-6 rounded-full text-white text-xs font-bold"
                      style={{ backgroundColor: charColors[i % charColors.length] }}
                    >
                      {i + 1}
                    </span>
                    캐릭터 프롬프트
                  </div>
                  <div className="flex items-center gap-2">
                    <Tooltip content={character.enabled !== false ? '비활성화' : '활성화'}>
                    <button
                      className={`round-button h-8 px-4 ${character.enabled !== false ? 'back-sky' : 'back-gray'}`}
                      onClick={() => toggleCharacter(character.id)}
                    >
                      {character.enabled !== false ? <FaToggleOn className="mr-1" /> : <FaToggleOff className="mr-1" />}
                      {character.enabled !== false ? '활성화됨' : '비활성화됨'}
                    </button>
                    </Tooltip>
                    <Tooltip content="캐릭터 삭제">
                    <button
                      className="icon-button back-red"
                      onClick={() => removeCharacter(character.id)}
                    >
                      <FaTrash />
                    </button>
                    </Tooltip>
                  </div>
                </div>
                <div className="mb-2">
                  <PromptEditTextArea
                    value={character.prompt}
                    onChange={(value) =>
                      updateCharacter(character.id, { prompt: value })
                    }
                    chunkInsert={true}
                    chunkLabel="캐릭터 프롬프트"
                    headerLabel="캐릭터 프롬프트"
                  />
                </div>
                {middlePromptMode && (
                  <>
                    <div className="flex justify-between items-center mb-2">
                      <div className="flex items-center gap-2 gray-label">
                        중간 프롬프트 (이 씬에만 적용됨)
                      </div>
                    </div>
                    <div className="mb-2">
                      <PromptEditTextArea
                        value={getCharacterMiddlePrompt!(i)}
                        onChange={(value) =>
                          onCharacterMiddlePromptChange!(i, value)
                        }
                      />
                    </div>
                  </>
                )}
                <div className="mb-2">
                  <PromptEditTextArea
                    value={character.uc}
                    onChange={(value) =>
                      updateCharacter(character.id, { uc: value })
                    }
                    chunkInsert={true}
                    chunkLabel="캐릭터 네거티브 프롬프트"
                    headerLabel="네거티브 프롬프트"
                  />
                </div>
                {preset.useCoords && (
                  <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                    <FaArrowsAlt className="text-xs" />
                    <span>위치: ({character.position?.x?.toFixed(2)}, {character.position?.y?.toFixed(2)})</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
        <div className="flex-none mt-auto pt-2 flex gap-2 items-center">
          <button
            className="round-button back-green h-8"
            onClick={addCharacter}
          >
            캐릭터 추가
          </button>
          <button
            className="round-button back-gray h-8 w-full"
            onClick={() => {
              setEditCharacters(undefined);
            }}
          >
            캐릭터 프롬프트 닫기
          </button>
        </div>
      </div>
    );
  },
);

export const CharacterButton = ({ input }: { input: WFIInlineInput }) => {
  const { editCharacters, setEditCharacters, preset, shared, meta } =
    useContext(WFElementContext)!;

  const getField = () => {
    if (input.fieldType === 'preset') return preset[input.field] || [];
    if (input.fieldType === 'shared') return shared[input.field] || [];
    return meta![input.field] || [];
  };

  const onClick = () => {
    setEditCharacters(input.field);
  };

  const field = getField();
  const enabledCount = field.filter((c: CharacterPrompt) => c.enabled !== false).length;
  const totalCount = field.length;

  return (
    <>
      {editCharacters === undefined && field.length === 0 && (
        <div className="w-full flex items-center mt-2">
          <button
            className="round-button back-gray h-8 flex-1 flex"
            onClick={onClick}
          >
            <div className="flex-1">
              <FaUserAlt className="inline mr-2" />
              캐릭터 프롬프트 열기
            </div>
          </button>
          <CompanionButtons host="characterPrompts" />
        </div>
      )}
      {editCharacters === undefined && field.length > 0 && (
        <div className="w-full mt-2 flex items-center">
          <button
            className="round-button back-sky h-8 flex-1 flex justify-between items-center"
            onClick={onClick}
          >
            <div className="flex items-center">
              <FaUserAlt className="mr-2" />
              <span>캐릭터 프롬프트 열기</span>
            </div>
            <div className="flex flex-wrap gap-1">
              <span className="px-2 py-0.5 text-xs rounded-full bg-gray-100 text-green-800">
                {enabledCount}/{totalCount} 활성화
              </span>
            </div>
          </button>
          <CompanionButtons host="characterPrompts" />
        </div>
      )}
    </>
  );
};

const WFRInline = observer(({ element }: WFElementProps) => {
  const { editVibe, editCharacters, type, showGroup, showGroupOverlay, preset, shared, meta } =
    useContext(WFElementContext)!;
  const { curGroup } = useContext(WFGroupContext)!;
  const input = element as WFIInlineInput;
  const promptFoldKey = input.flex === 'flex-1' ? input.field : '';
  const [promptFolded, setPromptFolded] = useState(() =>
    promptFoldKey ? getPromptFold(promptFoldKey, false) : false,
  );
  const field = workFlowService.getVarDef(type, input.fieldType, input.field)!;
  const getField = () => {
    if (input.fieldType === 'preset') {
      return preset[input.field];
    } else if (input.fieldType === 'shared') {
      return shared[input.field];
    } else {
      return meta![input.field];
    }
  };
  const setField = (val: any) => {
    if (input.fieldType === 'preset') {
      preset[input.field] = val;
    } else if (input.fieldType === 'shared') {
      shared[input.field] = val;
    } else {
      meta![input.field] = val;
    }
  };
  // 오버레이 내부에서는 curGroup이 설정됨 — showGroupOverlay와 비교
  // 일반 인라인에서는 기존대로 showGroup과 비교
  const isInOverlay = curGroup !== undefined && curGroup === showGroupOverlay;
  if (!isInOverlay) {
    if (
      curGroup !== showGroup ||
      editVibe != undefined
    ) {
      return <></>;
    }
  }
  const key = `${type}_${preset.name}_${input.field}`;
  // 샘플링 필드 잠금 — 적용된 샘플링 프리셋이 이 필드를 override하면 그 값을
  // 화면에 표시 + disabled. 해제하면 원본 값 복귀(override 모델).
  const _samplingFieldNames = ['steps', 'promptGuidance', 'cfgRescale', 'sampling', 'noiseSchedule'];
  const _isSamplingField = _samplingFieldNames.includes(input.field);
  const _samplingPresetId = appState.appliedSamplingPreset;
  const _samplingPresetObj: any = _samplingPresetId ? samplingPresetService.get(_samplingPresetId) : undefined;
  const _overrideValue = _isSamplingField && _samplingPresetObj && _samplingPresetObj[input.field] != null
    ? _samplingPresetObj[input.field]
    : undefined;
  const _samplingLocked = _overrideValue !== undefined;
  const _isSamplingProjectOverride = appState.curSession ? typeof appState.curSession.samplingPresetId === 'string' : false;
  const _lockBorderClass = !_samplingLocked
    ? ''
    : (_isSamplingProjectOverride ? 'ring-2 ring-teal-400/50 rounded-lg' : 'ring-2 ring-indigo-400/50 rounded-lg');
  switch (field.type) {
    case 'prompt': {
      const showPresetBtn =
        input.field === 'frontPrompt' &&
        (type === 'SDImageGen' || type === 'SDImageGenEasy');
      return (
        <>
          {showPresetBtn && (
            <div className="flex items-center gap-1">
              <SamplingPresetButton
                getCurrent={() => ({
                  steps: preset.steps,
                  promptGuidance: preset.promptGuidance,
                  cfgRescale: preset.cfgRescale,
                  sampling: preset.sampling,
                  noiseSchedule: preset.noiseSchedule,
                })}
                onApply={(id) => {
                  appState.setAppliedSamplingPreset(id);
                }}
              />
              <CompanionButtons host="sampling" />
            </div>
          )}
          {/* 라벨+버튼을 PromptEditTextArea 헤더 줄로(item ④: 입력창 위 absolute 버튼 → 라벨 줄).
              EditorField의 라벨/래퍼를 직접 대체 — 라벨은 headerLabel로 넘김. */}
          {input.field === 'frontPrompt' && (
            <div className="flex-none flex items-center gap-1 text-xs text-muted mt-1">
              프롬프트 문법 <HelpIcon content={PROMPT_SYNTAX_HELP} size={13} />
            </div>
          )}
          <div className={promptFolded ? 'flex-none' : input.flex === 'flex-1' ? 'flex-1 min-h-0' : 'flex-none mt-3'}>
            <PromptEditTextArea
              key={key}
              value={getField()}
              disabled={false}
              onChange={setField}
              chunkInsert={true}
              chunkLabel={input.label}
              headerLabel={input.label}
              headerFull={input.flex === 'flex-1' && !promptFolded}
              headerCollapsed={promptFolded}
              headerBadge={typeof getField() === 'string' && getField().trim() ? '작성됨' : undefined}
              onHeaderToggle={promptFoldKey ? () => {
                const next = !promptFolded;
                persistPromptFold(promptFoldKey, next);
                setPromptFolded(next);
              } : undefined}
              searchEnabled={true}
            ></PromptEditTextArea>
          </div>
        </>
      );
    }
    case 'select':
      return (
        <InlineEditorField label={input.label}>
          <DropdownSelect
            key={key}
            selectedOption={getField()}
            disabled={_samplingLocked}
            menuPlacement={input.menuPlacement}
            options={field.options.map((x) => ({
              label: x.label,
              value: x.value,
            }))}
            onSelect={(opt) => {
              setField(opt.value);
            }}
          />
        </InlineEditorField>
      );
    case 'characterPrompts':
      return <CharacterButton input={input} key={key} />;
    case 'nullInt':
      return (
        <InlineEditorField label={input.label}>
          <NullIntInput
            label={input.label}
            value={getField()}
            disabled={false}
            onChange={(val) => setField(val)}
            key={key}
          />
        </InlineEditorField>
      );
    case 'vibeSet':
      return <VibeButton input={input} key={key} />;
    case 'characterReferences':
      return <CharacterReferenceButton input={input} key={key} />;
    case 'bool':
      return (
        <InlineEditorField label={input.label}>
          <input
            key={key}
            type="checkbox"
            checked={getField()}
            onChange={(e) => setField(e.target.checked)}
          />
        </InlineEditorField>
      );
    case 'int':
      return (
        <div className={_lockBorderClass}>
          <IntSliderInput
            label={input.label}
            value={_samplingLocked ? _overrideValue : getField()}
            onChange={setField}
            disabled={_samplingLocked}
            min={field.min}
            max={field.max}
            step={field.step}
            key={key}
          />
        </div>
      );
    case 'sampling':
      return (
        <InlineEditorField label={input.label}>
          <div className={_lockBorderClass}>
            <DropdownSelect
              key={key}
              selectedOption={_samplingLocked ? _overrideValue : getField()}
              disabled={_samplingLocked}
              menuPlacement="auto"
              options={Object.values(Sampling).map((x) => ({
                label: x,
                value: x,
              }))}
              onSelect={(opt) => {
                setField(opt.value);
              }}
            />
          </div>
        </InlineEditorField>
      );
    case 'noiseSchedule':
      return (
        <InlineEditorField label={input.label}>
          <div className={_lockBorderClass}>
            <DropdownSelect
              key={key}
              selectedOption={_samplingLocked ? _overrideValue : getField()}
              disabled={_samplingLocked}
              menuPlacement="auto"
              options={Object.values(NoiseSchedule).map((x) => ({
                label: x,
                value: x,
              }))}
              onSelect={(opt) => {
                setField(opt.value);
              }}
            />
          </div>
        </InlineEditorField>
      );
    case 'image':
      return <ImageSelect input={input} key={key} />;
  }
  return <InlineEditorField label={input.label}>asdf</InlineEditorField>;
});

interface ImplProps {
  type: string;
  shared: any;
  preset: any;
  meta?: any;
  middlePromptMode: boolean;
  element: WFIElement;
  getMiddlePrompt?: () => string;
  onMiddlePromptChange?: (txt: string) => void;
  getCharacterMiddlePrompt?: (index: number) => string;
  onCharacterMiddlePromptChange?: (index: number, txt: string) => void;
  showNewSceneResolution?: boolean;
  layoutSlot: string;
}

export const PreSetEditorImpl = observer(
  ({
    type,
    shared,
    preset,
    element,
    meta,
    middlePromptMode,
    getMiddlePrompt,
    onMiddlePromptChange,
    getCharacterMiddlePrompt,
    onCharacterMiddlePromptChange,
    showNewSceneResolution,
    layoutSlot,
  }: ImplProps) => {
    const [editVibe, setEditVibe] = useState<WFIInlineInput | undefined>(
      undefined,
    );
    const [editCharacterReference, setEditCharacterReference] = useState<WFIInlineInput | undefined>(
      undefined,
    );
    const [editCharacters, setEditCharacters] = useState<string | undefined>(
      undefined,
    );
    const [showGroup, setShowGroup] = useState<string | undefined>(undefined);
    const [showGroupOverlay, setShowGroupOverlay] = useState<string | undefined>(undefined);
    const [modelVersion, setModelVersion] = useState<ModelVersion>(ModelVersion.V4_5);

    useEffect(() => {
      (async () => {
        const config = await backend.getConfig();
        setModelVersion(config.modelVersion ?? ModelVersion.V4_5);
      })();
      const onConfigChanged = async () => {
        const config = await backend.getConfig();
        setModelVersion(config.modelVersion ?? ModelVersion.V4_5);
      };
      sessionService.addEventListener('config-changed', onConfigChanged);
      return () => sessionService.removeEventListener('config-changed', onConfigChanged);
    }, []);

    // element 트리에서 group 요소 찾기
    const findGroupElement = (el: WFIElement): WFIGroup | undefined => {
      if (el.type === 'group') return el as WFIGroup;
      if (el.type === 'stack') {
        for (const child of (el as WFIStack).inputs) {
          const found = findGroupElement(child);
          if (found) return found;
        }
      }
      return undefined;
    };
    const groupElement = findGroupElement(element);

    useEffect(() => {
      setShowGroup(undefined);
      setShowGroupOverlay(undefined);
    }, [type]);

    // 단축키에서 샘플링/모델 설정 열기 이벤트 수신
    useEffect(() => {
      const handler = (e: Event) => {
        const action = (e as CustomEvent).detail?.action;
        if (action === 'open-sampling-settings' && groupElement) {
          setShowGroupOverlay('샘플링/모델 설정');
        }
      };
      window.addEventListener('shortcut-action', handler);
      return () => window.removeEventListener('shortcut-action', handler);
    }, [groupElement]);
    return (
      <StackGrow>
        <WFElementContext.Provider
          value={{
            preset: preset,
            shared: shared,
            meta: meta,
            showGroup: showGroup,
            editVibe: editVibe,
            setEditVibe: setEditVibe,
            editCharacterReference: editCharacterReference,
            setEditCharacterReference: setEditCharacterReference,
            editCharacters: editCharacters,
            setEditCharacters: setEditCharacters,
            setShowGroup: setShowGroup,
            showGroupOverlay: showGroupOverlay,
            setShowGroupOverlay: setShowGroupOverlay,
            groupElement: groupElement,
            type: type,
            middlePromptMode,
            modelVersion,
            getMiddlePrompt,
            onMiddlePromptChange,
            getCharacterMiddlePrompt,
            onCharacterMiddlePromptChange,
          }}
        >
          <WFGroupContext.Provider value={{}}>
            <VibeEditor disabled={false} />
            <CharacterReferenceEditor disabled={false} />
            {editCharacters && (
              <CharacterPromptEditor
                input={
                  {
                    type: 'inline',
                    label: 'Characters',
                    field: editCharacters,
                    fieldType:
                      shared?.type === 'SDImageGenEasy' ? 'shared' : 'preset',
                    flex: 'flex-none',
                  } as WFIInlineInput
                }
              />
            )}
            {!editVibe && !editCharacters && !editCharacterReference && (
              <PresetFooterContext.Provider
                value={showNewSceneResolution ? <NewSceneResolutionRow /> : undefined}
              >
                {element.type === 'stack' ? (
                  <PresetRootStack stack={element as WFIStack} slot={layoutSlot} />
                ) : (
                  <WFRenderElement element={element} />
                )}
              </PresetFooterContext.Provider>
            )}
          </WFGroupContext.Provider>
          {/* 샘플링/모델 설정 오버레이 */}
          <ModalOverlay
            isOpen={!!showGroupOverlay && !!groupElement}
            onClose={() => setShowGroupOverlay(undefined)}
            title={showGroupOverlay || ''}
            width="max-w-xl"
          >
            {showGroupOverlay && groupElement && (
              <WFGroupContext.Provider value={{ curGroup: showGroupOverlay }}>
                {groupElement.inputs.map((x, i) => (
                  <WFRenderElement key={i} element={x} />
                ))}
                <GlobalModelSettings />
              </WFGroupContext.Provider>
            )}
          </ModalOverlay>
        </WFElementContext.Provider>
      </StackGrow>
    );
  },
);

interface InnerProps {
  type: string;
  shared: any;
  preset: any;
  meta?: any;
  element: WFIElement;
  middlePromptMode: boolean;
  nopad?: boolean;
  getMiddlePrompt?: () => string;
  onMiddlePromptChange?: (txt: string) => void;
  getCharacterMiddlePrompt?: (index: number) => string;
  onCharacterMiddlePromptChange?: (index: number, txt: string) => void;
}

interface UnionProps {
  general: boolean;
  type?: string;
  shared?: any;
  meta?: any;
  preset?: any;
  middlePromptMode: boolean;
  getMiddlePrompt?: () => string;
  onMiddlePromptChange?: (txt: string) => void;
  getCharacterMiddlePrompt?: (index: number) => string;
  onCharacterMiddlePromptChange?: (index: number, txt: string) => void;
}

export const InnerPreSetEditor = observer(
  ({
    type,
    shared,
    preset,
    meta,
    element,
    middlePromptMode,
    getMiddlePrompt,
    onMiddlePromptChange,
    getCharacterMiddlePrompt,
    onCharacterMiddlePromptChange,
    nopad,
  }: InnerProps) => {
    return (
      <VerticalStack className={nopad ? '' : 'p-2'}>
        <PreSetEditorImpl
          type={type}
          shared={shared}
          preset={preset}
          meta={meta}
          element={element}
          middlePromptMode={middlePromptMode}
          layoutSlot={presetLayoutSlotKey(type, true)}
          getMiddlePrompt={getMiddlePrompt}
          onMiddlePromptChange={onMiddlePromptChange}
          getCharacterMiddlePrompt={getCharacterMiddlePrompt}
          onCharacterMiddlePromptChange={onCharacterMiddlePromptChange}
        />
      </VerticalStack>
    );
  },
);

interface Props {
  meta?: any;
  middlePromptMode: boolean;
  getMiddlePrompt?: () => string;
  onMiddlePromptChange?: (txt: string) => void;
  getCharacterMiddlePrompt?: (index: number) => string;
  onCharacterMiddlePromptChange?: (index: number, txt: string) => void;
}

const PreSetEditor = observer(
  ({
    middlePromptMode,
    getMiddlePrompt,
    onMiddlePromptChange,
    getCharacterMiddlePrompt,
    onCharacterMiddlePromptChange,
    meta,
  }: Props) => {
    const [_, rerender] = useState<{}>({});
    const curSession = appState.curSession!;
    const legacyWorkflow = appState.legacyWorkflowMode;
    const workflowType = curSession.selectedWorkflow?.workflowType;
    const shared = curSession.presetShareds?.get(workflowType!);
    const presets = curSession.presets?.get(workflowType!);
    if (!workflowType) {
      curSession.selectedWorkflow = {
        workflowType: legacyWorkflow
          ? workFlowService.generalFlows[0].getType()
          : 'SDImageGen',
      };
      rerender({});
    } else if (!legacyWorkflow && workflowType !== 'SDImageGen') {
      curSession.selectedWorkflow = { workflowType: 'SDImageGen' };
      rerender({});
    } else {
      if (!presets) {
        const preset = workFlowService.buildPreset(workflowType);
        preset.name = 'default';
        curSession.presets.set(workflowType, [preset]);
        rerender({});
      } else if (!shared) {
        curSession.presetShareds.set(
          workflowType,
          workFlowService.buildShared(workflowType),
        );
        rerender({});
      } else if (
        !curSession.selectedWorkflow!.presetName ||
        !presets.find((x) => x.name === curSession.selectedWorkflow!.presetName)
      ) {
        if (presets.length === 0) {
          const preset = workFlowService.buildPreset(workflowType);
          preset.name = 'default';
          curSession.presets.set(workflowType, [preset]);
          curSession.selectedWorkflow!.presetName = 'default';
        } else {
          curSession.selectedWorkflow!.presetName = presets[0].name;
        }
        rerender({});
      }
    }
    return (
      workflowType &&
      shared &&
      curSession.selectedWorkflow!.presetName && (
        <VerticalStack className="p-2">
          {legacyWorkflow && <StackFixed className="flex gap-2 items-center">
            <span className={'flex-none gray-label'}>작업모드: </span>
            <DropdownSelect
              selectedOption={workflowType}
              menuPlacement="bottom"
              options={workFlowService.generalFlows.map((x) => ({
                value: x.getType(),
                label: x.getTitle(),
              }))}
              onSelect={(opt) => {
                curSession.selectedWorkflow = {
                  workflowType: opt.value,
                };
              }}
            />
            <CompanionButtons host="presetTop" />
          </StackFixed>}
          {!legacyWorkflow && <CompanionButtons host="presetTop" />}
          <PreSetEditorImpl
            type={workflowType}
            shared={shared}
            meta={meta}
            preset={
              presets!.find(
                (x) => x.name === curSession.selectedWorkflow!.presetName,
              )!
            }
            middlePromptMode={middlePromptMode}
            layoutSlot={presetLayoutSlotKey(workflowType, false)}
            element={workFlowService.getGeneralEditor(workflowType)}
            getMiddlePrompt={getMiddlePrompt}
            onMiddlePromptChange={onMiddlePromptChange}
            getCharacterMiddlePrompt={getCharacterMiddlePrompt}
            onCharacterMiddlePromptChange={onCharacterMiddlePromptChange}
            showNewSceneResolution
          />
        </VerticalStack>
      )
    );
  },
);

export const UnionPreSetEditor = observer(
  ({
    general,
    type,
    shared,
    meta,
    preset,
    middlePromptMode,
    getMiddlePrompt,
    onMiddlePromptChange,
    getCharacterMiddlePrompt,
    onCharacterMiddlePromptChange,
  }: UnionProps) => {
    return general ? (
      <PreSetEditor
        meta={meta}
        middlePromptMode={middlePromptMode}
        getMiddlePrompt={getMiddlePrompt}
        onMiddlePromptChange={onMiddlePromptChange}
        getCharacterMiddlePrompt={getCharacterMiddlePrompt}
        onCharacterMiddlePromptChange={onCharacterMiddlePromptChange}
      />
    ) : (
      <InnerPreSetEditor
        meta={meta}
        type={type!}
        shared={shared!}
        preset={preset!}
        element={workFlowService.getInnerEditor(type!)}
        middlePromptMode={middlePromptMode}
        getMiddlePrompt={getMiddlePrompt}
        onMiddlePromptChange={onMiddlePromptChange}
        getCharacterMiddlePrompt={getCharacterMiddlePrompt}
        onCharacterMiddlePromptChange={onCharacterMiddlePromptChange}
      />
    );
  },
);

export default PreSetEditor;
