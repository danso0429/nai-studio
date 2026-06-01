import {
  useEffect,
  useRef,
  useState,
} from 'react';
import { extractApiError } from '../models/util';
import Tooltip from './Tooltip';
import {
  DropdownSelect,
  TabComponent,
} from './UtilComponents';
import {
  FaImages,
  FaPlay,
  FaPlus,
  FaPuzzlePiece,
  FaSearch,
  FaStar,
  FaStop,
  FaTrash,
  FaUser,
  FaToggleOn,
  FaToggleOff,
  FaQuestionCircle,
} from 'react-icons/fa';
import PromptEditTextArea from './PromptEditTextArea';
import { UnionPreSetEditor } from './PreSetEditor';
import { TaskProgressBar } from './TaskQueueControl';
import { Resolution, resolutionMap } from '../backends/imageGen';
import { FloatView } from './FloatView';
import { v4 as uuidv4 } from 'uuid';
import { useDrag, useDrop } from 'react-dnd';
import { getEmptyImage } from 'react-dnd-html5-backend';
import {
  imageService,
  taskQueueService,
  isMobile,
  workFlowService,
  toggleGroupService,
} from '../models';
import { ISharedToggleGroup } from '../models/ToggleGroupService';
import { getMainImagePath } from '../models/ImageService';
import { highlightPrompt, lowerPromptNode } from '../models/PromptService';
import { renameScene } from '../models/SessionService';
import {
  Scene,
  PromptPiece,
  PromptPieceSlot,
  PromptNode,
  CharacterPrompt,
} from '../models/types';
import { appState } from '../models/AppService';
import { observer } from 'mobx-react-lite';
import { runInAction } from 'mobx';

interface Props {
  scene: Scene;
  onClosed: () => void;
  onDeleted?: () => void;
}
interface PromptHighlighterProps {
  text: string;
  className?: string;
}

export const PromptHighlighter = observer(
  ({ className, text }: PromptHighlighterProps) => {
    const { curSession } = appState;
    return (
      <div
        className={
          'max-w-full break-words bg-gray-200 dark:bg-slate-700 ' +
          (className ?? '')
        }
        dangerouslySetInnerHTML={{ __html: highlightPrompt(curSession!, text) }}
      ></div>
    );
  },
);

interface SlotEditorProps {
  scene: { slots: PromptPieceSlot[] };
}

interface BigPromptEditorProps {
  type?: string;
  shared?: any;
  preset?: any;
  meta?: any;
  general: boolean;
  getMiddlePrompt: () => string;
  setMiddlePrompt: (txt: string) => void;
  getCharacterMiddlePrompt: (index: number) => string;
  setCharacterMiddlePrompt: (index: number, txt: string) => void;
  queuePrompt: (middle: string, callback: (path: string) => void) => void;
  setMainImage?: (path: string) => void;
  initialImagePath?: string;
  sceneUc?: string;
  onSceneUcChange?: (v: string) => void;
}

export const BigPromptEditor = observer(
  ({
    general,
    type,
    shared,
    preset,
    meta,
    getMiddlePrompt,
    setMiddlePrompt,
    getCharacterMiddlePrompt,
    setCharacterMiddlePrompt,
    initialImagePath,
    queuePrompt,
    setMainImage,
    sceneUc,
    onSceneUcChange,
  }: BigPromptEditorProps) => {
    const [image, setImage] = useState<string | undefined>(undefined);
    const [path, setPath] = useState<string | undefined>(initialImagePath);
    const [_, rerender] = useState<{}>({});
    useEffect(() => {
      setImage(undefined);
      (async () => {
        if (path) {
          const dataUri = await imageService.fetchImage(path);
          setImage(dataUri!);
        }
      })();
    }, [path]);
    useEffect(() => {
      const handleProgress = () => {
        rerender({});
      };
      taskQueueService.addEventListener('start', handleProgress);
      taskQueueService.addEventListener('stop', handleProgress);
      taskQueueService.addEventListener('progress', handleProgress);
      return () => {
        taskQueueService.removeEventListener('start', handleProgress);
        taskQueueService.removeEventListener('stop', handleProgress);
        taskQueueService.removeEventListener('progress', handleProgress);
      };
    }, []);

    const [promptOpen, setPromptOpen] = useState(false);
    const [editDisabled, setEditDisabled] = useState(true);

    useEffect(() => {
      const timer = setTimeout(() => {
        setEditDisabled(false);
      }, 100);
      return () => {
        clearTimeout(timer);
      };
    }, []);

    return (
      <div className="flex h-full flex-col md:flex-row">
        {promptOpen && (
          <FloatView
            key="float"
            priority={0}
            onEscape={() => {
              setPromptOpen(false);
            }}
          >
            <UnionPreSetEditor
              general={general}
              type={type}
              preset={preset}
              meta={meta}
              shared={shared}
              middlePromptMode={true}
              getMiddlePrompt={getMiddlePrompt}
              onMiddlePromptChange={setMiddlePrompt}
              getCharacterMiddlePrompt={getCharacterMiddlePrompt}
              onCharacterMiddlePromptChange={setCharacterMiddlePrompt}
            />
          </FloatView>
        )}
        <div
          className={
            'overflow-auto flex-none h-1/3 md:h-auto md:w-1/3 md:h-full'
          }
        >
          <div className={'hidden md:flex md:flex-col h-full'}>
            <div className="flex-1 min-h-0 overflow-auto">
              <UnionPreSetEditor
                general={general}
                type={type}
                preset={preset}
                meta={meta}
                shared={shared}
                middlePromptMode={true}
                getMiddlePrompt={getMiddlePrompt}
                onMiddlePromptChange={setMiddlePrompt}
                getCharacterMiddlePrompt={getCharacterMiddlePrompt}
                onCharacterMiddlePromptChange={setCharacterMiddlePrompt}
              />
            </div>
            {/* 씬 전용 네거티브 — 중위 프롬프트 밑. 모든 조합에 적용 (2026-05-13) */}
            {onSceneUcChange && (
              <div className="flex-none px-3 py-2 border-t line-color">
                <label className="text-xs text-red-500 dark:text-red-400 select-none block mb-1">
                  씬 전용 네거티브
                </label>
                {/* 2026-06-01: 조합 네거티브와 동일하게 PromptEditTextArea로 교체 — db.csv 태그 자동완성. */}
                <div className="h-16">
                  <PromptEditTextArea
                    whiteBg
                    value={sceneUc || ''}
                    onChange={onSceneUcChange}
                  />
                </div>
              </div>
            )}
          </div>
          <div className="h-full flex flex-col p-2 overflow-hidden block md:hidden">
            <div className="flex-none font-bold text-sub">
              중위 프롬프트 (이 씬에만 적용됨):
            </div>
            <div className="flex-1 p-2 overflow-hidden">
              <PromptEditTextArea
                disabled={editDisabled}
                onChange={setMiddlePrompt}
                value={getMiddlePrompt()}
              />
            </div>
            {/* 씬 전용 네거티브 — 중위 프롬프트 밑 (2026-05-13) */}
            {onSceneUcChange && (
              <div className="flex-none px-2 pb-2">
                <label className="text-xs text-red-500 dark:text-red-400 select-none block mb-1">
                  씬 전용 네거티브
                </label>
                {/* 2026-06-01: 조합 네거티브와 동일하게 PromptEditTextArea로 교체 — db.csv 태그 자동완성. */}
                <div className="h-16">
                  <PromptEditTextArea
                    whiteBg
                    value={sceneUc || ''}
                    onChange={onSceneUcChange}
                  />
                </div>
              </div>
            )}
            <div className="flex-none">
              <button
                className="round-button back-sky"
                onClick={() => setPromptOpen(true)}
              >
                상세설정
              </button>
            </div>
          </div>
        </div>
        <div className="flex-none h-2/3 md:h-auto md:w-2/3 overflow-hidden">
          <div className="flex flex-col h-full">
            <div className="flex-1 overflow-hidden">
              {image && (
                <img
                  className="w-full h-full object-contain"
                  src={image}
                  draggable={false}
                />
              )}
            </div>
            <div className="ml-auto flex-none flex gap-4 pt-2 mb-2 md:mb-0">
              {path && (
                <button
                  className="round-button back-orange h-8 md:w-36 flex items-center justify-center"
                  onClick={() => {
                    setMainImage && setMainImage(path);
                  }}
                >
                  {general ? (
                    !isMobile ? (
                      '즐겨찾기 지정'
                    ) : (
                      <FaStar />
                    )
                  ) : (
                    '프로필 지정'
                  )}
                </button>
              )}
              <TaskProgressBar fast />
              {!taskQueueService.isRunning() ? (
                <Tooltip content="생성">
                <button
                  className="round-button back-green h-8 w-16 md:w-36 flex items-center justify-center"
                  onClick={() => {
                    queuePrompt(getMiddlePrompt(), (path: string) => {
                      setPath(path);
                    });
                  }}
                >
                  <FaPlay size={15} />
                </button>
                </Tooltip>
              ) : (
                <Tooltip content="중지">
                <button
                  className="round-button back-red h-8 w-16 md:w-36 flex items-center justify-center"
                  onClick={() => {
                    taskQueueService.removeAllTasks();
                    taskQueueService.stop();
                  }}
                >
                  <FaStop size={15} />
                </button>
                </Tooltip>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  },
);

interface SlotPieceProps {
  scene: { slots: PromptPieceSlot[] };
  piece: PromptPiece;
  removePiece?: (piece: PromptPiece) => void;
  moveSlotPiece?: (from: string, to: string) => void;
  style?: React.CSSProperties;
}

interface CharacterPromptsEditorProps {
  piece: PromptPiece;
  onClose: () => void;
}

const CharacterPromptsEditor = observer(
  ({ piece, onClose }: CharacterPromptsEditorProps) => {
    const addCharacterPrompt = () => {
      piece.characterPrompts.push('');
    };

    const updatePrompt = (index: number, value: string) => {
      piece.characterPrompts[index] = value;
    };

    const removePrompt = (index: number) => {
      piece.characterPrompts.splice(index, 1);
    };

    return (
      <div className="w-full h-full overflow-hidden flex flex-col p-3">
        <div className="flex-1 overflow-hidden">
          <div className="h-full overflow-auto">
            {piece.characterPrompts.length > 0 &&
              piece.characterPrompts.map((prompt, index) => (
                <div key={index} className="border rounded-md mt-3 p-3">
                  <div className="flex justify-between items-center mb-2">
                    <div className="flex items-center gap-2 gray-label">
                      캐릭터 프롬프트
                    </div>
                    <div className="flex items-center gap-2">
                      <Tooltip content="캐릭터 프롬프트 삭제">
                      <button
                        className="icon-button back-red"
                        onClick={() => removePrompt(index)}
                      >
                        <FaTrash />
                      </button>
                      </Tooltip>
                    </div>
                  </div>
                  <div className="mb-2">
                    <PromptEditTextArea
                      value={prompt}
                      onChange={(value) => updatePrompt(index, value)}
                    />
                  </div>
                </div>
              ))}
          </div>
        </div>
        <div className="flex-none mt-auto pt-2 flex gap-2 items-center">
          <button
            className="round-button back-green h-8"
            onClick={addCharacterPrompt}
          >
            캐릭터 추가
          </button>
          <button
            className="round-button back-gray h-8 w-full"
            onClick={onClose}
          >
            캐릭터 프롬프트 닫기
          </button>
        </div>
      </div>
    );
  },
);

export const SlotPiece = observer(
  ({ scene, piece, removePiece, moveSlotPiece, style }: SlotPieceProps) => {
    const [showCharacterPrompts, setShowCharacterPrompts] = useState(false);
    const [{ isDragging }, drag, preview] = useDrag(
      () => ({
        type: 'slot',
        item: { scene, piece },
        collect: (monitor) => {
          return {
            isDragging: monitor.isDragging(),
          };
        },
      }),
      [scene, piece],
    );

    // drop은 더 이상 piece 개별이 아니라 열(SlotColumn) 단위로 받음 — 빈 열에도
    // 자유 이동 가능하게. SlotPiece는 ⠿ 핸들 drag source만 담당.
    useEffect(() => {
      preview(getEmptyImage(), { captureDraggingState: true });
    }, [preview]);

    return (
      <div
        style={style}
        className={
          'p-3 m-2 bg-gray-200 dark:bg-slate-600 rounded-xl ' +
          (isDragging ? 'opacity-0' : '')
        }
      >
        {/* drag 핸들 — slot 전체가 draggable이면 안쪽 프롬프트 칸 클릭을 Firefox가
            드래그로 잡아 caret이 튐(P26 원리). 핸들만 drag source, 칸은 편집 전용. */}
        {moveSlotPiece && (
          <div
            ref={drag as any}
            className="cursor-move select-none text-center text-gray-400 hover:text-gray-600 dark:text-slate-400 dark:hover:text-slate-200 text-lg leading-none -mt-1 mb-1"
            title="드래그해서 다른 칸으로 이동"
          >
            ⠿
          </div>
        )}
        {showCharacterPrompts && (
          <FloatView
            priority={0}
            onEscape={() => setShowCharacterPrompts(false)}
          >
            <CharacterPromptsEditor
              piece={piece}
              onClose={() => setShowCharacterPrompts(false)}
            />
          </FloatView>
        )}

        {/* 본인 페인 (F1, F2, P12 #7): 모바일 h-12 w-28(48×112px)이 너무 작아서 prompt
            텍스트 overflow → 네거태그 영역까지 침범 + 슬롯 크기 늘려달라 요청. 모바일
            크기 확장 (h-32 w-60 = 128×240px). 데스크탑은 그대로 유지. */}
        <div className={'mb-3 h-32 w-60 md:h-24 md:w-48'}>
          <PromptEditTextArea
            whiteBg
            disabled={!moveSlotPiece}
            value={piece.prompt}
            onChange={(s) => {
              if (!moveSlotPiece) return;
              piece.prompt = s;
            }}
          />
        </div>
        {/* 조합 단위 네거티브 — 같은 조합에 들어간 모든 piece의 uc를 합쳐 base negative에 추가 (2026-05-13) */}
        {/* 2026-06-01: 조합 프롬프트와 동일하게 PromptEditTextArea로 교체 — db.csv 태그 자동완성 도우미 제공. */}
        <div className="mb-2 w-60 md:w-48">
          <label className="text-xs text-red-500 dark:text-red-400 select-none block">
            조합 네거티브
          </label>
          <div className="h-20 md:h-16">
            <PromptEditTextArea
              whiteBg
              disabled={!moveSlotPiece}
              value={piece.uc || ''}
              onChange={(s) => {
                if (!moveSlotPiece) return;
                piece.uc = s;
              }}
            />
          </div>
        </div>
        <div className="flex gap-2 select-none">
          <label className="gray-label">활성화</label>
          <input
            type="checkbox"
            checked={piece.enabled == undefined || piece.enabled}
            onChange={(e) => {
              if (!moveSlotPiece) return;
              piece.enabled = e.currentTarget.checked;
            }}
          />
          <Tooltip content="캐릭터 프롬프트 편집">
          <button
            className="active:brightness-90 hover:brightness-95 text-blue-600 dark:text-blue-400"
            onClick={() => {
              if (!moveSlotPiece) return;
              setShowCharacterPrompts(true);
            }}
          >
            <FaUser size={20} />
            {piece.characterPrompts.length > 0 && (
              <span className="absolute top-0 right-0 transform translate-x-1/2 -translate-y-1/3 bg-red-500 text-white rounded-full w-4 h-4 flex items-center justify-center text-xs">
                {piece.characterPrompts.length}
              </span>
            )}
          </button>
          </Tooltip>
          <button
            className="active:brightness-90 hover:brightness-95 ml-auto text-red-500 dark:text-red-400"
            onClick={() => {
              if (!moveSlotPiece) return;
              removePiece && removePiece(piece);
            }}
          >
            <FaTrash size={20} />
          </button>
        </div>
      </div>
    );
  },
);

// 씬별 캐릭터 프롬프트 에디터 (씬 전용 캐릭터 프롬프트 직접 입력)
interface SceneCharacterPromptEditorProps {
  scene: Scene;
}

const sceneCharColors = [
  '#ef4444', '#3b82f6', '#22c55e', '#eab308', '#a855f7',
  '#ec4899', '#f97316', '#06b6d4', '#6366f1', '#14b8a6',
];

const SceneCharacterPromptEditor = observer(({ scene }: SceneCharacterPromptEditorProps) => {
  const [showCoordMap, setShowCoordMap] = useState(false);
  const coordMapRef = useRef<SVGSVGElement | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const addCharacter = () => {
    const newCharacter: CharacterPrompt = {
      id: uuidv4(),
      prompt: '',
      uc: '',
      position: { x: 0.5, y: 0.5 },
      enabled: true,
    };
    scene.sceneCharacterPrompts = [...(scene.sceneCharacterPrompts || []), newCharacter];
  };

  const removeCharacter = (id: string) => {
    scene.sceneCharacterPrompts = (scene.sceneCharacterPrompts || []).filter(c => c.id !== id);
  };

  const updateCharacter = (id: string, updates: Partial<CharacterPrompt>) => {
    // range input 60Hz tick에 array map + obj spread = ~300 alloc/sec → in-place mutation.
    // MobX reaction은 obj property 단위 dirty mark로 reaction surface 축소.
    runInAction(() => {
      const arr = scene.sceneCharacterPrompts;
      if (!arr) return;
      const target = arr.find(c => c.id === id);
      if (target) Object.assign(target, updates);
    });
  };

  const toggleCharacter = (id: string) => {
    runInAction(() => {
      const arr = scene.sceneCharacterPrompts;
      if (!arr) return;
      const target = arr.find(c => c.id === id);
      if (target) target.enabled = target.enabled === false ? true : false;
    });
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

  const characters = scene.sceneCharacterPrompts || [];
  const enabledCount = characters.filter(c => c.enabled !== false).length;

  return (
    <div className="flex flex-col h-full p-4 overflow-hidden">
      <div className="flex-none mb-4">
        <div className="flex items-center justify-between mb-2">
          <div className="text-lg font-medium">
            <FaUser className="inline mr-2" />
            씬 전용 캐릭터 프롬프트
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={scene.useSceneCharacterPrompts || false}
                onChange={(e) => {
                  scene.useSceneCharacterPrompts = e.target.checked;
                }}
                className="w-4 h-4"
              />
              <span className="text-sm">씬 전용 캐릭터 프롬프트 사용</span>
            </label>
          </div>
        </div>
        <div className="text-sm text-gray-500 dark:text-gray-400">
          이 씬에서만 사용할 캐릭터 프롬프트를 직접 입력하세요.
          {scene.useSceneCharacterPrompts
            ? ' (활성화됨 - 공유 캐릭터 프롬프트 대신 이 프롬프트가 사용됩니다)'
            : ' (비활성화됨 - 공유 캐릭터 프롬프트가 사용됩니다)'}
        </div>
        {characters.length > 0 && (
          <div className="mt-2 text-sm">
            <span className="px-2 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded">
              {enabledCount}/{characters.length} 캐릭터 활성화
            </span>
          </div>
        )}
      </div>

      {/* 좌표평면 UI */}
      {characters.length > 0 && (
        <div className="flex-none mb-3">
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
                  const color = sceneCharColors[idx % sceneCharColors.length];
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

      <div className="flex-1 overflow-auto">
        {characters.length === 0 ? (
          <div className="text-center text-gray-500 py-8">
            <FaUser className="text-4xl mx-auto mb-2 opacity-50" />
            <div>캐릭터 프롬프트가 없습니다</div>
            <div className="text-sm mt-1">아래 버튼을 눌러 캐릭터를 추가하세요</div>
          </div>
        ) : (
          <div className="space-y-4">
            {characters.map((character, index) => (
              <div
                key={character.id}
                className={`border rounded-lg p-4 transition-all ${
                  character.enabled !== false
                    ? 'border-sky-500 bg-sky-50 dark:bg-sky-900/20'
                    : 'border-gray-300 opacity-60'
                }`}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-flex items-center justify-center w-6 h-6 rounded-full text-white text-xs font-bold"
                      style={{ backgroundColor: sceneCharColors[index % sceneCharColors.length] }}
                    >
                      {index + 1}
                    </span>
                    <span className="font-medium">캐릭터 {index + 1}</span>
                    <button
                      className={`round-button h-7 px-3 text-sm ${
                        character.enabled !== false ? 'back-sky' : 'back-gray'
                      }`}
                      onClick={() => toggleCharacter(character.id)}
                    >
                      {character.enabled !== false ? (
                        <>
                          <FaToggleOn className="mr-1" />
                          활성화
                        </>
                      ) : (
                        <>
                          <FaToggleOff className="mr-1" />
                          비활성화
                        </>
                      )}
                    </button>
                  </div>
                  <button
                    className="icon-button back-red"
                    onClick={() => removeCharacter(character.id)}
                  >
                    <FaTrash />
                  </button>
                </div>

                <div className="mb-3">
                  <label className="block text-sm font-medium mb-1 gray-label">
                    캐릭터 프롬프트
                  </label>
                  <PromptEditTextArea
                    value={character.prompt}
                    onChange={(value) => updateCharacter(character.id, { prompt: value })}
                    chunkInsert={true}
                    chunkLabel="캐릭터 프롬프트"
                  />
                </div>

                <div className="mb-3">
                  <label className="block text-sm font-medium mb-1 gray-label">
                    캐릭터 네거티브 프롬프트
                  </label>
                  <PromptEditTextArea
                    value={character.uc}
                    onChange={(value) => updateCharacter(character.id, { uc: value })}
                    chunkInsert={true}
                    chunkLabel="캐릭터 네거티브 프롬프트"
                  />
                </div>

                <div className="text-sm text-gray-500 dark:text-gray-400">
                  위치: ({character.position?.x?.toFixed(2) || '0.50'}, {character.position?.y?.toFixed(2) || '0.50'})
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex-none mt-4 pt-4 border-t">
        <div className="flex gap-2">
          <button
            className="round-button back-green h-8 flex-1"
            onClick={addCharacter}
          >
            <FaPlus className="mr-2" />
            캐릭터 추가
          </button>
        </div>

        {/* 씬 전용 캐릭터 네거티브 프롬프트 (전체) */}
        <div className="mt-4">
          <label className="block text-sm font-medium mb-1 gray-label">
            씬 전용 캐릭터 공통 네거티브 프롬프트
          </label>
          <PromptEditTextArea
            value={scene.sceneCharacterUC || ''}
            onChange={(value) => {
              scene.sceneCharacterUC = value;
            }}
          />
        </div>

        {/* 씬 전용 일반 UC 입력은 BigPromptEditor(중위 프롬프트 밑)로 이동 — 2026-05-13 */}
      </div>
    </div>
  );
});

interface SlotColumnProps {
  scene: { slots: PromptPieceSlot[] };
  slot: PromptPieceSlot;
  slotIndex: number;
  moveToColumn: (pieceId: string, columnIndex: number) => void;
  removePiece: (slot: PromptPieceSlot, pieceIndex: number) => void;
  onRemoveColumn: (columnIndex: number) => void;
}

// 열(column) 전체를 drop zone으로 — piece를 빈 열 포함 아무 열에나 자유 이동.
// 같은 열로의 drop은 canDrop=false라 무시되고 강조도 안 됨. 핸들 drag는 SlotPiece 담당.
const SlotColumn = observer(
  ({
    scene,
    slot,
    slotIndex,
    moveToColumn,
    removePiece,
    onRemoveColumn,
  }: SlotColumnProps) => {
    const [{ isOver }, drop] = useDrop(
      () => ({
        accept: 'slot',
        canDrop: (item: any) => !slot.some((p) => p.id === item.piece.id),
        collect: (monitor) => ({
          isOver: monitor.isOver() && monitor.canDrop(),
        }),
        drop: (item: any) => {
          moveToColumn(item.piece.id, slotIndex);
        },
      }),
      [scene, slotIndex, slot.length],
    );
    return (
      <div
        ref={drop as any}
        className={
          'flex flex-row md:flex-col overflow-x-auto md:overflow-x-visible border-b md:border-b-0 md:border-r border-gray-200 dark:border-slate-700 last:border-0 ' +
          (isOver ? 'bg-sky-100 dark:bg-sky-900/30 rounded-lg' : '')
        }
      >
        {slot.map((piece) => (
          <SlotPiece
            key={piece.id!}
            scene={scene}
            piece={piece}
            removePiece={(p: PromptPiece) => removePiece(slot, slot.indexOf(p))}
            moveSlotPiece={() => {}}
          />
        ))}
        {slot.length === 0 && (
          <div className="m-2 w-32 md:w-auto md:min-w-[8rem] h-32 md:h-24 flex items-center justify-center text-center text-xs text-gray-400 dark:text-slate-400 select-none border-2 border-dashed border-gray-300 dark:border-slate-500 rounded-xl px-2">
            여기로
            <br />
            드래그
          </div>
        )}
        <button
          className="p-2 m-2 w-14 flex-none back-lllgray clickable rounded-xl flex justify-center self-center"
          onClick={() => {
            slot.push(
              PromptPiece.fromJSON({
                prompt: '',
                characterPrompts: [],
                enabled: true,
                id: uuidv4(),
              }),
            );
          }}
        >
          <FaPlus />
        </button>
        {slot.length === 0 && (
          <button
            className="p-2 m-2 w-14 flex-none clickable rounded-xl flex justify-center self-center text-red-500 hover:text-red-600 border border-red-300 dark:border-red-700"
            onClick={() => onRemoveColumn(slotIndex)}
            title="빈 열 삭제"
          >
            <FaTrash />
          </button>
        )}
      </div>
    );
  },
);

// 토글 그룹 태그 입력 — controlled value에 매 keystroke split/trim/filter를 걸면
// 쉼표 직후 빈 토큰이 사라져 쉼표를 못 치므로, raw 텍스트는 로컬 state로 들고
// 파싱 결과만 전역 그룹(toggleGroupService)에 반영. 2026-05-31.
const ToggleTagsInput = observer(
  ({ sceneName, group }: { sceneName: string; group: ISharedToggleGroup }) => {
    const [raw, setRaw] = useState(group.tags.join(', '));
    return (
      <input
        className="gray-input flex-1 min-w-[7rem] text-sm"
        placeholder="태그 (쉼표로 구분, 예: fully clothed female)"
        value={raw}
        onChange={(e) => {
          setRaw(e.target.value);
          toggleGroupService.updateGroup(sceneName, group.id, {
            tags: e.target.value
              .split(',')
              .map((t) => t.trim())
              .filter((t) => t.length > 0),
          });
        }}
      />
    );
  },
);

// 씬 토글 그룹 UI — 그룹 정의(이름/태그)는 "씬 이름" 키로 전역 공유(toggleGroupService).
// 같은 이름 씬이면 다른 프로젝트에서도 동일 그룹이 보임. on/off만 씬별
// (scene.toggleGroupStates, 값 없으면 기본 ON). OFF면 생성 시 그 태그 제거.
const ToggleGroupEditor = observer(({ scene }: { scene: Scene }) => {
  const sceneName = scene.name;
  const groups = toggleGroupService.list(sceneName);
  const isOn = (id: string) => scene.toggleGroupStates[id] !== false;
  return (
    <div className="w-full px-2 py-2 mt-2 border-t border-gray-200 dark:border-slate-700">
      <div className="flex items-center gap-2 mb-2 text-sm font-semibold text-default">
        <FaToggleOn className="text-gray-500 dark:text-slate-400" />
        토글 그룹
        <Tooltip content="조합 piece에 들어있는 태그를 그룹으로 묶어 on/off 합니다. 그룹(이름·태그)은 같은 이름의 씬끼리 공유되고, on/off는 프로젝트마다 따로 저장됩니다. OFF로 끄면 이미지 생성 시 그 태그가 빠집니다(piece 원본은 그대로).">
          <FaQuestionCircle className="text-gray-400 dark:text-gray-500 cursor-help" />
        </Tooltip>
      </div>
      {groups.length === 0 && (
        <div className="text-xs text-gray-400 dark:text-slate-500 mb-2">
          아직 토글 그룹이 없어요. 아래 + 버튼으로 추가하세요. (같은 이름 씬끼리 공유)
        </div>
      )}
      {groups.map((g) => {
        const on = isOn(g.id);
        return (
          <div
            key={g.id}
            className="flex flex-wrap items-center gap-2 mb-2 p-2 rounded-xl bg-gray-100 dark:bg-slate-700"
          >
            <button
              className={
                'flex items-center justify-center gap-1 px-2 py-1 rounded-lg text-sm clickable flex-none w-16 ' +
                (on
                  ? 'bg-green-500 text-white'
                  : 'bg-gray-300 dark:bg-slate-500 text-gray-600 dark:text-slate-100')
              }
              onClick={() => {
                scene.toggleGroupStates = {
                  ...scene.toggleGroupStates,
                  [g.id]: !on,
                };
              }}
              title={on ? '켜짐 — 태그 적용' : '꺼짐 — 생성 시 태그 제거'}
            >
              {on ? <FaToggleOn /> : <FaToggleOff />}
              {on ? 'ON' : 'OFF'}
            </button>
            <input
              className="gray-input w-24 flex-none text-sm"
              placeholder="그룹 이름"
              value={g.name}
              onChange={(e) => {
                toggleGroupService.updateGroup(sceneName, g.id, {
                  name: e.target.value,
                });
              }}
            />
            <ToggleTagsInput sceneName={sceneName} group={g} />
            <button
              className="flex-none px-2 py-1 text-red-500 hover:text-red-600 clickable"
              onClick={() => {
                toggleGroupService.removeGroup(sceneName, g.id);
              }}
              title="그룹 삭제 (같은 이름 씬 전체에서 삭제)"
            >
              <FaTrash />
            </button>
          </div>
        );
      })}
      <button
        className="flex items-center gap-1 px-2 py-1 text-sm back-lllgray clickable rounded-lg"
        onClick={() => {
          toggleGroupService.addGroup(sceneName, '', []);
        }}
      >
        <FaPlus /> 그룹 추가
      </button>
    </div>
  );
});

// 조합 슬롯 오른쪽 끝 — 클릭하면 빈 열 추가, piece를 드래그해 떨어뜨리면 그 piece를
// 새 열로 분리(자동 열 생성). drop 가능할 때(출발 열에 piece 2개 이상)만 강조 + 안내.
const SlotEndDropZone = observer(
  ({
    scene,
    onAddColumn,
    moveToNew,
  }: {
    scene: { slots: PromptPieceSlot[] };
    onAddColumn: () => void;
    moveToNew: (pieceId: string) => void;
  }) => {
    const [{ isOver, active }, drop] = useDrop(
      () => ({
        accept: 'slot',
        canDrop: (item: any) =>
          scene.slots.some((s) => s.some((p) => p.id === item.piece.id)),
        collect: (m) => ({ isOver: m.isOver() && m.canDrop(), active: m.canDrop() }),
        drop: (item: any) => moveToNew(item.piece.id),
      }),
      [scene],
    );
    return (
      <div
        ref={drop as any}
        className={
          'flex items-center justify-center m-2 rounded-xl ' +
          (active
            ? 'min-w-[6rem] self-stretch border-2 border-dashed text-xs text-center px-2 ' +
              (isOver
                ? 'border-sky-500 bg-sky-100 dark:bg-sky-900/30 text-sky-600 dark:text-sky-300'
                : 'border-gray-300 dark:border-slate-500 text-gray-400 dark:text-slate-400')
            : '')
        }
      >
        {active ? (
          <span>
            새 열로
            <br />
            이동
          </span>
        ) : (
          <button
            className="p-2 h-14 flex items-center back-lllgray clickable rounded-xl self-center md:self-auto"
            onClick={onAddColumn}
            title="빈 열 추가 (또는 piece를 여기로 드래그해 새 열로 분리)"
          >
            <FaPlus />
          </button>
        )}
      </div>
    );
  },
);

export const SlotEditor = observer(({ scene }: SlotEditorProps) => {
  useEffect(() => {
    // Components M: MobX observable mutate은 runInAction 안에서. 옛 코드는 reaction마다
    // 개별 dispatch — strict mode warning + 비최적. 한 action으로 batching.
    runInAction(() => {
      for (const slot of scene.slots) {
        for (const piece of slot) {
          if (!piece.id) {
            piece.id = uuidv4();
          }
        }
      }
    });
  }, [scene]);

  // 조각이 enabled일 때만 한 조합에 포함. piece.enabled가 undefined면 기본 enabled로 간주
  // (UI checkbox 기본값과 일치 — line 502). 슬롯 한 개라도 enabled 0이면 총 조합 0.
  // 빈 열(+버튼으로 막 생성, 아직 piece 미배치)은 총 조합 계산에서 제외 — 0 곱으로
  // 전체 조합이 0이 되는 걸 막음. piece가 들어오면 정상 집계.
  const enabledPerSlot = scene.slots
    .filter((slot) => slot.length > 0)
    .map(
      (slot) => slot.filter((p) => p.enabled == undefined || p.enabled).length,
    );
  const totalCombinations = enabledPerSlot.reduce((acc, n) => acc * n, 1);
  const formula = enabledPerSlot.length > 0 ? enabledPerSlot.join(' × ') : '0';

  const removePiece = (slot: PromptPieceSlot, pieceIndex: number) => {
    const slotIndex = scene.slots.indexOf(slot);
    // 전체 조각이 하나뿐(조합이 정말로 1 — 1열 1행)일 때만 삭제 막음(빈 조합 방지).
    // 그 외엔 그냥 행 삭제(같은 열 아래 행들이 위로) — 그 열의 마지막 행이면 열까지
    // 삭제돼 다음 열이 첫 번째 열이 된다. 1×1(열 2개 각 1행) 등은 막지 않음.
    const totalPieces = scene.slots.reduce((acc, s) => acc + s.length, 0);
    if (totalPieces <= 1) {
      appState.pushMessage('조각이 하나뿐이라 삭제할 수 없습니다');
      return;
    }
    slot.splice(pieceIndex, 1);
    if (slot.length === 0) {
      scene.slots.splice(slotIndex, 1);
    }
  };

  // 조합 piece를 다른 열(column)로 이동 — 빈 열에도 drop(끝에 추가). 같은 열은 무시.
  // 옮긴 뒤 출발 열이 비면 그 열 제거(빈 열은 + 버튼으로만 생성).
  const moveSlotPieceToColumn = (pieceId: string, targetColumnIndex: number) => {
    if (!scene.slots[targetColumnIndex]) return;
    const fromColIdx = scene.slots.findIndex((slot) =>
      slot.some((p) => p.id === pieceId),
    );
    if (fromColIdx === -1 || fromColIdx === targetColumnIndex) return;
    const fromPieceIdx = scene.slots[fromColIdx].findIndex(
      (p) => p.id === pieceId,
    );
    const piece = scene.slots[fromColIdx][fromPieceIdx];
    scene.slots[fromColIdx].splice(fromPieceIdx, 1);
    scene.slots[targetColumnIndex].push(piece);
    if (scene.slots[fromColIdx].length === 0) {
      scene.slots.splice(fromColIdx, 1);
    }
  };

  // 끝 빈 공간으로 drop — piece를 새 열로 분리(자동 열 생성). 출발 열에 piece가
  // 1개뿐이면 위치만 그대로라 무시(빈 열만 늘어나는 것 방지).
  const moveSlotPieceToNewColumn = (pieceId: string) => {
    const fromColIdx = scene.slots.findIndex((slot) =>
      slot.some((p) => p.id === pieceId),
    );
    if (fromColIdx === -1) return;
    const fromPieceIdx = scene.slots[fromColIdx].findIndex(
      (p) => p.id === pieceId,
    );
    const piece = scene.slots[fromColIdx][fromPieceIdx];
    scene.slots[fromColIdx].splice(fromPieceIdx, 1);
    scene.slots.push([piece]);
    if (scene.slots[fromColIdx].length === 0) {
      scene.slots.splice(fromColIdx, 1);
    }
  };

  // 빈 열(slot 0개)만 삭제. slot이 들어있는 열은 무시(UI에서도 빈 열일 때만 버튼 표시).
  const removeColumn = (columnIndex: number) => {
    if (scene.slots[columnIndex]?.length === 0) {
      scene.slots.splice(columnIndex, 1);
    }
  };

  // 본인 페인 (F3, P12 #7): 모바일 세로화면에서 slot=column 레이아웃은 좁은 가로
  // 공간을 N개 column으로 더 쪼개서 piece 폭이 더 줄어듦. 모바일에선 slot을 row로
  // 돌려서 column 폭 자유롭게 + 세로 스크롤로 slot 간 이동. 데스크탑은 기존 column
  // 레이아웃 유지 (가로 공간 충분).
  return (
    <div className="flex flex-col w-full">
      <div className="px-2 pt-1 text-xs text-gray-500 dark:text-gray-400 flex items-center gap-2">
        <span>총 조합:</span>
        <span className="font-semibold text-default">{totalCombinations}</span>
        {enabledPerSlot.length > 0 && (
          <span className="text-gray-400 dark:text-gray-500">({formula})</span>
        )}
        <Tooltip content="각 열의 프롬프트를 조합하여 열x행의 모든 경우의 수만큼 이미지를 생성합니다. 열 추가: 오른쪽 + 버튼 | 행 추가: 열 하단 + 버튼">
          <FaQuestionCircle className="text-gray-400 dark:text-gray-500 cursor-help" />
        </Tooltip>
      </div>
      {(scene as unknown as Scene).type === 'scene' && (
        <ToggleGroupEditor scene={scene as unknown as Scene} />
      )}
      <div className="flex flex-col md:flex-row w-full">
        {scene.slots.map((slot, slotIndex) => (
          <SlotColumn
            key={slotIndex}
            scene={scene}
            slot={slot}
            slotIndex={slotIndex}
            moveToColumn={moveSlotPieceToColumn}
            removePiece={removePiece}
            onRemoveColumn={removeColumn}
          />
        ))}
        <SlotEndDropZone
          scene={scene}
          onAddColumn={() => {
            // 빈 열 생성 — piece를 드래그해 채우거나 하단 + 버튼으로 행 추가.
            scene.slots.push([]);
          }}
          moveToNew={moveSlotPieceToNewColumn}
        />
      </div>
    </div>
  );
});

const SceneEditor = observer(({ scene, onClosed, onDeleted }: Props) => {
  const { curSession } = appState;
  const [_, rerender] = useState<{}>({});
  const [curName, setCurName] = useState('');
  const [type, preset, shared] = curSession!.getCommonSetup(
    curSession!.selectedWorkflow!,
  );

  // render 본문 setState 안티패턴 회피 — useEffect로 이동 (concurrent rendering 무한 루프 위험)
  useEffect(() => {
    if (type && !scene.meta.has(type)) {
      scene.meta.set(type, workFlowService.buildMeta(type));
      rerender({});
    }
  }, [type, scene]);

  useEffect(() => {
    setCurName(scene.name);
  }, [scene]);

  const getMiddlePrompt = () => {
    if (scene.slots.length === 0 || scene.slots[0].length === 0) {
      return '';
    }
    return scene.slots[0][0].prompt;
  };

  const onMiddlePromptChange = (txt: string) => {
    if (scene.slots.length === 0 || scene.slots[0].length === 0) {
      return;
    }
    scene.slots[0][0].prompt = txt;
  };

  const getCharacterMiddlePrompt = (index: number) => {
    if (scene.slots.length === 0 || scene.slots[0].length === 0) {
      return '';
    }
    return scene.slots[0][0].characterPrompts[index] || '';
  };

  const onCharacterMiddlePromptChange = (index: number, txt: string) => {
    if (scene.slots.length === 0 || scene.slots[0].length === 0) {
      return;
    }
    scene.slots[0][0].characterPrompts[index] = txt;
  };

  const queuePrompt = async (
    middle: string,
    callback: (path: string) => void,
  ) => {
    try {
      const prompts = await workFlowService.createPrompts(
        type,
        curSession!,
        scene,
        preset,
        shared,
      );
      const characterPrompts = await workFlowService.createCharacterPrompts(
        type,
        curSession!,
        scene,
        preset,
        shared,
      );
      await workFlowService.pushJob(
        type,
        curSession!,
        scene,
        prompts[0].prompt,
        characterPrompts[0],
        preset,
        shared,
        1,
        scene.meta.get(type),
        callback,
        true,
        prompts[0].uc,
      );
      taskQueueService.run();
    } catch (e: any) {
      appState.pushMessage(extractApiError(e));
      return;
    }
  };

  const setMainImage = (path: string) => {
    const filename = path.split('/').pop()!;
    if (!scene.mains.includes(filename)) {
      scene.mains.push(filename);
    }
  };

  const [previews, setPreviews] = useState<{ prompt: PromptNode; uc: string }[]>([]);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const PromptPreview = previewError ? (
    <div className="bg-red-500 p-2 m-2">{previewError}</div>
  ) : (
    <div>
      {previews.map((preview, index) => (
        <div key={index} className="m-2 border-b border-gray-300 dark:border-gray-700 pb-2">
          <PromptHighlighter
            className="inline-block word-breaks p-2"
            text={lowerPromptNode(preview.prompt)}
          />
          {preview.uc && (
            <div className="px-2 pt-1 text-xs text-red-500 break-all">
              <span className="font-semibold">조합 단위 네거티브:</span> {preview.uc}
            </div>
          )}
        </div>
      ))}
    </div>
  );

  const SmallSlotEditor = <SlotEditor scene={scene} />;

  const BigEditor = (
    <BigPromptEditor
      general={true}
      meta={type && scene.meta.get(type)}
      getMiddlePrompt={getMiddlePrompt}
      setMiddlePrompt={onMiddlePromptChange}
      getCharacterMiddlePrompt={getCharacterMiddlePrompt}
      setCharacterMiddlePrompt={onCharacterMiddlePromptChange}
      queuePrompt={queuePrompt}
      setMainImage={setMainImage}
      initialImagePath={getMainImagePath(curSession!, scene)}
      sceneUc={scene.uc}
      onSceneUcChange={(v) => { scene.uc = v; }}
    />
  );

  const resolutionOptions = Object.entries(resolutionMap)
    .map(([key, value]) => {
      const resolVal =
        (scene.resolutionWidth ?? '') + 'x' + (scene.resolutionHeight ?? '');
      if (key === 'custom')
        return { label: '커스텀 (' + resolVal + ')', value: key };
      return { label: `${value.width}x${value.height}`, value: key };
    })
    .filter((x) => !x.value.startsWith('small'));

  return (
    <div className="w-full h-full overflow-hidden">
      <div className="flex flex-col overflow-hidden h-full w-full">
        <div className="grow-0 pt-2 px-3 flex gap-3 items-center text-nowrap flex-wrap mb-2 md:mb-0">
          <div className="flex items-center gap-2">
            <label className="gray-label">씬 이름:</label>
            <input
              className="gray-input"
              type="text"
              value={curName}
              onChange={(e) => {
                setCurName(e.currentTarget.value);
              }}
            />
          </div>
          <div className="flex items-center gap-2 ">
            <label className="gray-label">해상도:</label>
            <div className="md:w-36">
              <DropdownSelect
                options={resolutionOptions}
                menuPlacement="bottom"
                selectedOption={scene.resolution}
                onSelect={async (opt) => {
                  if (
                    opt.value.startsWith('large') ||
                    opt.value.startsWith('wallpaper')
                  ) {
                    appState.pushDialog({
                      type: 'confirm',
                      text: '해당 해상도는 Anlas를 소모합니다 (유로임) 계속하시겠습니까?',
                      callback: () => {
                        scene.resolution = opt.value as Resolution;
                      },
                    });
                  } else if (opt.value === 'custom') {
                    const r = await appState.openCustomResolutionAsync({
                      width: scene.resolutionWidth,
                      height: scene.resolutionHeight,
                    });
                    if (!r) return;
                    scene.resolution = opt.value as Resolution;
                    scene.resolutionWidth = r.width;
                    scene.resolutionHeight = r.height;
                  } else {
                    scene.resolution = opt.value as Resolution;
                  }
                }}
              />
            </div>
          </div>

          <button
            className="round-button back-sky"
            onClick={async () => {
              const trimmedName = curName.trimEnd();
              if (!trimmedName) return;
              if (trimmedName in curSession!.scenes) {
                appState.pushMessage('해당 이름의 씬이 이미 존재합니다');
                return;
              }
              await renameScene(curSession!, scene.name, trimmedName);
            }}
          >
            이름 변경
          </button>
          <button
            className="round-button back-red"
            onClick={() => {
              appState.pushDialog({
                type: 'confirm',
                text: '정말로 해당 씬을 삭제하시겠습니까? (휴지통으로 이동)',
                callback: async () => {
                  const { trashService } = await import('../models');
                  await trashService.moveSceneToTrash(curSession!, scene);
                  onClosed();
                  if (onDeleted) {
                    onDeleted();
                  }
                },
              });
            }}
          >
            삭제
          </button>
        </div>
        <div className="flex-1 overflow-hidden">
          <TabComponent
            tabs={[
              {
                label: '프롬프트 에디터',
                content: BigEditor,
                emoji: <FaImages />,
              },
              {
                label: '조합 에디터',
                content: SmallSlotEditor,
                emoji: <FaPuzzlePiece />,
              },
              {
                label: '씬 캐릭터 프롬프트',
                content: <SceneCharacterPromptEditor scene={scene} />,
                emoji: <FaUser />,
              },
              {
                label: '최종 프롬프트 미리보기',
                content: PromptPreview,
                emoji: <FaSearch />,
                onClick: () => {
                  (async () => {
                    try {
                      const prompts = await workFlowService.createPrompts(
                        type,
                        curSession!,
                        scene,
                        preset,
                        shared,
                      );
                      setPreviews(prompts);
                    } catch (e: any) {
                      setPreviewError(e.message);
                    }
                  })();
                },
              },
            ]}
          />
        </div>
      </div>
    </div>
  );
});

export default SceneEditor;
