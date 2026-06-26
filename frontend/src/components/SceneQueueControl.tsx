import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { FloatView } from './FloatView';
import SceneEditor from './SceneEditor';
import { FaBookmark, FaBroom, FaChevronDown, FaChevronLeft, FaChevronRight, FaChevronUp, FaEdit, FaExchangeAlt, FaFileImage, FaPlus, FaRegCalendarTimes, FaSearch, FaSort, FaStar, FaTimes, FaTrash, FaTrashRestore } from 'react-icons/fa';
import ResultViewer from './ResultViewer';
import InPaintEditor from './InPaintEditor';
import { useDrag, useDrop } from 'react-dnd';
import { getEmptyImage } from 'react-dnd-html5-backend';
import { useContextMenu } from 'react-contexify';
import BatchItemSelector from './BatchItemSelector';
import Tooltip from './Tooltip';
import { v4 } from 'uuid';
import {
  isMobile,
  gameService,
  sessionService,
  imageService,
  taskQueueService,
  backend,
  workFlowService,
  trashService,
  promptService,
  getInitialThumbSize,
} from '../models';
import {
  getMainImage,
  dataUriToBase64,
} from '../models/ImageService';
import { getSceneKey, queueI2IWorkflow, queueMirrorWorkflow, queueWorkflow } from '../models/TaskQueueService';
import {
  GenericScene,
  ContextMenuType,
  Scene,
  InpaintScene,
  Session,
  PieceLibrary,
  Piece,
} from '../models/types';
import { extractApiError, extractPromptDataFromBase64, josaIGa, josaEulReul } from '../models/util';
import { appState, BatchPickerItem } from '../models/AppService';
import { observer } from 'mobx-react-lite';
import { createInpaintPreset, prepareMirrorCanvas } from '../models/workflows/SDWorkFlow';
import { reaction } from 'mobx';
import { oneTimeFlowMap, oneTimeFlows } from '../models/workflows/OneTimeFlows';

const createMissingPiecesForSession = (
  session: Session,
  missing: { library: string; piece: string }[],
) => {
  for (const m of missing) {
    let lib = session.library.get(m.library);
    if (!lib) {
      lib = new PieceLibrary();
      lib.name = m.library;
      session.library.set(m.library, lib);
    }
    if (!lib.pieces.find((x) => x.name === m.piece)) {
      const piece = new Piece();
      piece.name = m.piece;
      lib.pieces.push(piece);
    }
  }
  sessionService.dirty[session.name] = true;
  sessionService.reloadPieceLibraryDB(session);
};

export const queueScene = async (
  session: Session,
  scene: GenericScene,
  samples: number,
) => {
  if (scene.type === 'scene') {
    await queueWorkflow(
      session,
      session.selectedWorkflow!,
      scene,
      samples,
    );
  } else {
    const inpaintScene = scene as InpaintScene;
    if (inpaintScene.workflowType === 'SDMirror') {
      await queueMirrorWorkflow(
        session,
        inpaintScene.workflowType,
        inpaintScene.preset,
        inpaintScene,
        samples,
      );
    } else {
      await queueI2IWorkflow(
        session,
        scene.workflowType,
        scene.preset,
        scene,
        samples,
      );
    }
  }
};

interface SceneCellProps {
  scene: GenericScene;
  curSession: Session;
  cellSize: number;
  getImage: (scene: GenericScene) => Promise<string | null>;
  setDisplayScene?: (scene: GenericScene) => void;
  setEditingScene?: (scene: GenericScene) => void;
  moveScene?: (scene: GenericScene, index: number) => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  style?: React.CSSProperties;
  isBookmarked?: boolean;
  onToggleBookmark?: () => void;
  disableHover?: boolean;
  isFocused?: boolean;
}

export const SceneCell = observer(
  ({
    scene,
    getImage,
    setDisplayScene,
    moveScene,
    onMoveUp,
    onMoveDown,
    setEditingScene,
    curSession,
    cellSize,
    style,
    isBookmarked,
    onToggleBookmark,
    disableHover,
    isFocused,
  }: SceneCellProps) => {
    const { show, hideAll } = useContextMenu({
      id: ContextMenuType.Scene,
    });
    const [image, setImage] = useState<string | undefined>(undefined);
    const cardElRef = useRef<HTMLDivElement | null>(null);
    let emoji = '';
    if (scene.type === 'inpaint') {
      const def = workFlowService.getDef(scene.workflowType);
      if (def) {
        emoji = def.emoji ?? '';
      }
    }

    const isClassic = appState.classicSceneCard;
    const tabType = scene.type === 'inpaint' ? 'inpaint' : 'scene';
    const cardStyle = curSession.sceneCardStyle?.[tabType] ?? 'portrait';
    const aspectMap: Record<string, string> = {
      portrait: 'aspect-[3/4]',
      square: 'aspect-square',
      landscape: 'aspect-[4/3]',
    };
    const aspectClass = aspectMap[cardStyle];
    // 셀 내부 크기는 부모 grid track width를 따라감 (w-full). 모바일/데스크탑 공통.
    // 본인 페인 (2026-05-16): 모바일 fixed w-48/w-36에서 그리드 오른쪽 빈 공간 컸음 →
    // w-full + auto-fill grid로 가로 fill.
    const cellSizes = aspectClass
      ? Array(3).fill(`w-full ${aspectClass}`)
      : ['w-full h-36', 'w-full h-48', 'w-full h-72'];
    const canDrag = !!moveScene;
    const curIndex = curSession.getScenes(scene.type).indexOf(scene);
    const [{ isDragging }, drag, preview] = useDrag(
      () => ({
        type: 'scene',
        item: () => ({
          scene,
          curIndex,
          getImage,
          curSession,
          cellSize,
          cardWidth: cardElRef.current?.offsetWidth,
        }),
        canDrag: () => canDrag,
        collect: (monitor) => {
          const diff = monitor.getDifferenceFromInitialOffset();
          if (diff) {
            const dist = Math.sqrt(diff.x ** 2 + diff.y ** 2);
            if (dist > 20) {
              hideAll();
            }
          }
          return {
            isDragging: monitor.isDragging(),
          };
        },
        end: (item, monitor) => {
          const { scene: droppedScene, curIndex: droppedIndex } = item;
          const didDrop = monitor.didDrop();
          if (!didDrop) {
            moveScene?.(droppedScene, droppedIndex);
          }
        },
      }),
      [curIndex, scene, cellSize, canDrag],
    );

    useEffect(() => {
      preview(getEmptyImage(), { captureDraggingState: true });
    }, [preview]);

    const [{ isOver }, drop] = useDrop<any, any, any>(
      () => ({
        accept: 'scene',
        canDrop: () => canDrag,
        collect: (monitor) => {
          if (monitor.isOver()) {
            return {
              isOver: true,
            };
          }
          return { isOver: false };
        },
        drop: (item: any, monitor) => {
          const { scene: droppedScene, curIndex: droppedIndex } = item;
          const overIndex = curSession.getScenes(scene.type).indexOf(scene);
          moveScene?.(droppedScene, overIndex);
        },
      }),
      [moveScene, canDrag],
    );

    const addToQueue = async (scene: GenericScene) => {
      try {
        const missing = promptService.findMissingPieces(curSession, scene);
        if (missing.length > 0) {
          const list = missing.map((m) => `<${m.library}.${m.piece}>`).join(', ');
          appState.pushDialog({
            type: 'confirm',
            text: `존재하지 않는 프롬프트조각이 발견되었습니다:\n${list}\n\n로컬 프롬프트조각으로 새로 만들까요?\n(빈 조각이 생성되며, 내용은 직접 채워주세요)`,
            callback: async () => {
              createMissingPiecesForSession(curSession, missing);
              try {
                await queueScene(curSession, scene, appState.samples);
              } catch (e: any) {
                appState.pushMessage('프롬프트 에러: ' + e.message);
              }
            },
          });
          return;
        }
        await queueScene(curSession, scene, appState.samples);
      } catch (e: any) {
        appState.pushMessage('프롬프트 에러: ' + e.message);
      }
    };

    const [, rerender] = useState<{}>({});

    const removeFromQueue = (scene: GenericScene) => {
      taskQueueService.removeTasksFromScene(curSession!, scene);
    };

    const getSceneQueueCount = (scene: GenericScene) => {
      const stats = taskQueueService.statsTasksFromScene(curSession!, scene);
      return stats.total - stats.done;
    };

    // audit H22 — 옛 패턴: 모든 SceneCell가 progress·cache-invalidated 이벤트에
    // 무조건 rerender + 무조건 refreshImage. 200 scene × 1Hz progress = 200
    // rerender/sec + 200 refetch/sec. 모바일 발열 주범.
    // 새 패턴: (1) progress는 본 scene의 stats 변화 시에만 rerender (diff 가드).
    // (2) cache-invalidated은 detail.path가 본 scene 디렉토리 안일 때만 refreshImage.
    const lastStatsRef = useRef<{ total: number; done: number } | null>(null);
    useEffect(() => {
      const sceneOutputDir = imageService.getOutputDir(curSession!, scene);
      const refreshImage = async () => {
        try {
          const base64 = await getImage(scene);
          setImage(base64!);
        } catch (e: any) {
          setImage(undefined);
        }
        rerender({});
      };
      const onProgress = () => {
        // diff 가드: 본 scene의 (total, done)이 그대로면 UI 변경 없음 → skip.
        // 200 scene 중 매 progress tick에 실제 변하는 건 1-4 scene 정도라 ~98%
        // rerender skip.
        const stats = taskQueueService.statsTasksFromScene(curSession!, scene);
        const last = lastStatsRef.current;
        if (last && last.total === stats.total && last.done === stats.done) return;
        lastStatsRef.current = { total: stats.total, done: stats.done };
        rerender({});
      };
      const onCacheInvalidated = (e: any) => {
        const path = e?.detail?.path;
        // path detail이 본 scene의 outputDir 하위면 refetch. 다른 scene이나 vibe/ref면 skip.
        if (path && typeof path === 'string' && !path.startsWith(sceneOutputDir + '/')) return;
        refreshImage();
      };
      refreshImage();
      // 초기 stats snapshot
      lastStatsRef.current = taskQueueService.statsTasksFromScene(curSession!, scene);
      gameService.addEventListener('updated', refreshImage);
      taskQueueService.addEventListener('progress', onProgress);
      imageService.addEventListener('image-cache-invalidated', onCacheInvalidated);
      const dispose = reaction(
        () => scene.mains.join(''),
        () => {
          refreshImage();
        },
      );
      const dispose2 = reaction(
        () => scene.type === 'inpaint' && scene.preset.image,
        () => {
          refreshImage();
        },
      );
      return () => {
        gameService.removeEventListener('updated', refreshImage);
        taskQueueService.removeEventListener('progress', onProgress);
        imageService.removeEventListener(
          'image-cache-invalidated',
          onCacheInvalidated,
        );
        dispose();
        dispose2();
      };
      // getImage를 dep에 포함 — 본인 페인 (P12 #8): config의 initialThumbSize 변경
      // 시 자연스러운 refetch. QueueControl의 getImage는 useCallback([curSession,
      // thumbSize])이라 thumbSize 값이 같으면 동일 ref → useEffect skip → 불필요한
      // refetch X. 다른 값이면 새 ref → refetch + 새 썸네일로 갈아끼움.
    }, [scene, getImage]);

    const cardRef = (node: any) => {
      cardElRef.current = node;
      drag(drop(node));
    };
    const onContext = (e: any) => {
      show({ event: e, props: { ctx: { type: 'scene', scene } } });
    };
    const onClickCard = () => {
      if (isDragging) return;
      setDisplayScene?.(scene);
    };

    // 공통 버튼 렌더
    const renderButtons = (overlay?: boolean) => {
      const btnClass = 'round-button scene-btn';
      const green = overlay ? 'bg-green-500 text-white' : 'back-green';
      const gray = overlay ? 'bg-gray-500 text-white' : 'back-gray';
      const orange = overlay ? 'bg-orange-500 text-white' : 'back-orange';
      const sky = overlay ? 'bg-sky-500 text-white' : 'back-sky';
      return (
        <>
          {onMoveUp && (
            <button className={`${btnClass} ${sky}`}
              onClick={(e) => { e.stopPropagation(); onMoveUp(); }}>
              <FaChevronLeft size={14} />
            </button>
          )}
          {onMoveDown && (
            <button className={`${btnClass} ${sky}`}
              onClick={(e) => { e.stopPropagation(); onMoveDown(); }}>
              <FaChevronRight size={14} />
            </button>
          )}
          <Tooltip content="예약 추가">
          <button className={`${btnClass} ${green}`}
            onClick={(e) => { e.stopPropagation(); addToQueue(scene); }}>
            <FaPlus />
          </button>
          </Tooltip>
          <Tooltip content="예약 제거">
          <button className={`${btnClass} ${gray}`}
            onClick={(e) => { e.stopPropagation(); removeFromQueue(scene); }}>
            <FaRegCalendarTimes />
          </button>
          </Tooltip>
          <Tooltip content="씬 편집">
          <button className={`${btnClass} ${orange}`}
            onClick={(e) => { e.stopPropagation(); setEditingScene?.(scene); }}>
            <FaEdit />
          </button>
          </Tooltip>
          <Tooltip content="씬 북마크">
          <button className={`${btnClass} ${isBookmarked ? orange : gray}`}
            onClick={(e) => { e.stopPropagation(); onToggleBookmark?.(); }}>
            <FaBookmark />
          </button>
          </Tooltip>
        </>
      );
    };

    const focusRing = isFocused ? ' outline outline-4 outline-sky-400 outline-offset-2' : '';
    // 큐가 현재 이 씬을 처리 중일 때 외곽 파란 펄스 — App.css의 .scene-processing 클래스.
    const isProcessing =
      !!appState.currentProcessingSceneKey &&
      appState.currentProcessingSceneKey === getSceneKey(curSession!, scene);
    const processingClass = isProcessing ? ' scene-processing' : '';

    if (isClassic) {
      // ===== 클래식 디자인 =====
      return (
        <div
          id={`scene-cell-${scene.type}-${scene.name}`}
          className={
            'relative z-0 m-2 p-1 bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-500 ' +
            (isDragging ? 'opacity-0 no-touch ' : '') +
            (isOver ? ' outline outline-sky-500' : '') +
            focusRing +
            processingClass
          }
          style={style}
          ref={cardRef}
          onContextMenu={onContext}
        >
          {getSceneQueueCount(scene) > 0 && (
            <span className="absolute right-0 bg-yellow-400 dark:bg-indigo-400 inline-block mr-3 px-2 py-1 text-center align-middle rounded-md font-bold text-white">
              {getSceneQueueCount(scene)}
            </span>
          )}
          <div className="-z-10 clickable bg-white dark:bg-slate-800" onClick={onClickCard}>
            <div className={'p-2 flex text-lg text-default'}>
              <div className="truncate flex-1">
                {isBookmarked && <span className="text-orange-500">📌</span>}
                {emoji}
                {scene.name}
              </div>
              <div className="flex-none text-gray-400">
                {gameService.getOutputs(curSession!, scene).length}{' '}
              </div>
            </div>
            <div className={'relative image-cell overflow-hidden ' + cellSizes[cellSize]}>
              {image && (
                <div className="relative w-full h-full">
                  <img src={image} draggable={false}
                    className={'w-full h-full object-contain z-0' +
                      (scene.mains.length > 0 ? ' border-2 border-yellow-400' : '')} />
                  {scene.mains.length > 0 && (
                    <div className="absolute left-1 top-1 z-10 text-yellow-400 text-sm drop-shadow">
                      <FaStar />
                    </div>
                  )}
                </div>
              )}
              {!image && (
                <div className="w-full h-full flex items-center justify-center bg-gray-200 dark:bg-slate-700">
                  <FaFileImage className="text-2xl text-gray-400 dark:text-slate-500" />
                </div>
              )}
            </div>
          </div>
          <div className="w-full flex mt-auto justify-center items-center gap-1 md:gap-2 p-1 md:p-2">
            {renderButtons(false)}
          </div>
        </div>
      );
    }

    // ===== 신규 디자인 =====
    return (
      <div
        id={`scene-cell-${scene.type}-${scene.name}`}
        className={
          (disableHover ? '' : 'group ') + 'relative z-0 m-1.5 p-1 rounded-lg bg-white dark:bg-slate-800 border-2 ' +
          (scene.mains.length > 0 ? 'border-yellow-400 ' : 'border-gray-200 dark:border-slate-600 ') +
          (isDragging ? 'opacity-0 no-touch ' : '') +
          (isOver ? ' ring-2 ring-sky-500' : '') +
          focusRing +
          processingClass
        }
        style={style}
        ref={cardRef}
        onContextMenu={onContext}
      >
        {getSceneQueueCount(scene) > 0 && (
          <span className="absolute left-2 top-2 z-20 bg-yellow-400 dark:bg-indigo-400 px-2 py-0.5 rounded-full text-sm font-bold text-white shadow">
            {getSceneQueueCount(scene)}
          </span>
        )}
        {/* PC 전용: 카드 전체 어두운 오버레이 */}
        {!isMobile && (
          <div className="absolute inset-0 rounded-lg bg-black/0 group-hover:bg-black/40 transition-colors duration-200 z-10 pointer-events-none" />
        )}
        <div className="clickable bg-white dark:bg-slate-800" onClick={onClickCard}>
          <div className={'relative image-cell overflow-hidden rounded-md ' + cellSizes[cellSize]}>
            {image && (
              <div className="relative w-full h-full">
                <img src={image} draggable={false}
                  className="w-full h-full object-cover z-0" />
                {scene.mains.length > 0 && (
                  <div className="absolute left-1 top-1 z-10 text-yellow-400 text-sm drop-shadow">
                    <FaStar />
                  </div>
                )}
              </div>
            )}
            {!image && (
              <div className="w-full h-full flex items-center justify-center bg-gray-200 dark:bg-slate-700 rounded-md">
                <FaFileImage className="text-2xl text-gray-400 dark:text-slate-500" />
              </div>
            )}
            {/* 씬 이름 + 이미지 카운트 오버레이 */}
            <div className="absolute bottom-0 left-0 right-0 z-[5] bg-gradient-to-t from-black/70 to-transparent px-2 pt-4 pb-1.5">
              <div className="flex items-center text-sm text-white">
                <div className="truncate flex-1 font-medium drop-shadow">
                  {isBookmarked && <span className="text-orange-500 mr-0.5">📌</span>}
                  {emoji}
                  {scene.name}
                </div>
                <div className="flex-none ml-1 text-white/80 drop-shadow">
                  {gameService.getOutputs(curSession!, scene).length}
                </div>
              </div>
            </div>
          </div>
        </div>
        {/* PC 전용: 호버 시 버튼 */}
        {!isMobile && (
          <div className="absolute bottom-0 left-0 right-0 flex justify-center items-center gap-1.5 z-20 py-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            {renderButtons(true)}
          </div>
        )}
        {/* 모바일 전용: 하단 버튼 */}
        <div className={`w-full flex mt-auto justify-center items-center gap-1 p-1 ${isMobile ? '' : 'md:hidden'}`}>
          {renderButtons(false)}
        </div>
      </div>
    );
  },
);

// ===== SceneTrashView 컴포넌트 =====

interface SceneTrashViewProps {
  projectName: string;
  onClose: () => void;
}

const SceneTrashView = ({ projectName, onClose }: SceneTrashViewProps) => {
  const [deletedScenes, setDeletedScenes] = useState<
    { name: string; type: 'scene' | 'inpaint'; deletedAt: number }[]
  >([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const items = await trashService.getDeletedScenes(projectName);
      setDeletedScenes(items);
    } catch (e) {
      setDeletedScenes([]);
    }
    setLoading(false);
  }, [projectName]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const formatDate = (ts: number) => {
    if (!ts) return '알 수 없음';
    const d = new Date(ts);
    return (
      d.toLocaleDateString() +
      ' ' +
      d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    );
  };

  const handleRestore = async (item: {
    name: string;
    type: 'scene' | 'inpaint';
    deletedAt: number;
  }) => {
    try {
      await trashService.restoreScene(appState.curSession!, item.name);
      appState.pushMessage(`씬 "${item.name}"${josaIGa(item.name)} 복원되었습니다.`);
      await refresh();
    } catch (e: any) {
      appState.pushMessage(e.message || '씬 복원에 실패했습니다.');
    }
  };

  const handlePermanentDelete = async (item: {
    name: string;
    type: 'scene' | 'inpaint';
    deletedAt: number;
  }) => {
    appState.pushDialog({
      type: 'confirm',
      text: `씬 "${item.name}"${josaEulReul(item.name)} 영구 삭제하시겠습니까?`,
      callback: async () => {
        await trashService.permanentlyDeleteScene(
          projectName,
          item.name,
          item.type,
        );
        await refresh();
      },
    });
  };

  if (deletedScenes.length === 0 && !loading) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex-none p-3 border-b line-color flex items-center justify-between">
          <span className="font-bold text-lg text-default">🗑️ 씬 휴지통</span>
          <button className="round-button back-gray" onClick={onClose}>
            닫기
          </button>
        </div>
        <div className="flex-1 flex items-center justify-center text-gray-400 text-lg">
          휴지통이 비어있습니다
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-none p-3 border-b line-color flex items-center justify-between">
        <span className="font-bold text-lg text-default">🗑️ 씬 휴지통</span>
        <button className="round-button back-gray" onClick={onClose}>
          닫기
        </button>
      </div>
      <div className="flex-1 overflow-auto p-3">
        <div className="flex flex-col gap-2">
          {deletedScenes.map((item) => (
            <div
              key={item.name}
              className="flex items-center gap-3 p-3 border border-gray-300 dark:border-slate-500 rounded bg-white dark:bg-slate-800"
            >
              <div className="flex-1 min-w-0">
                <div className="font-bold text-default truncate">
                  {item.type === 'inpaint' ? '🎨 ' : '🖼️ '}
                  {item.name}
                </div>
                <div className="text-sm text-gray-400">
                  {item.type === 'inpaint' ? '인페인트' : '일반'} 씬 ·{' '}
                  {formatDate(item.deletedAt)}
                </div>
              </div>
              <button
                className="round-button back-green flex-none"
                onClick={() => handleRestore(item)}
              >
                <FaTrashRestore className="mr-1" />
                복원
              </button>
              <button
                className="round-button back-red flex-none"
                onClick={() => handlePermanentDelete(item)}
              >
                영구삭제
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

interface QueueControlProps {
  type: 'scene' | 'inpaint';
  filterFunc?: (scene: GenericScene) => boolean;
  onClose?: (x: number) => void;
  showPannel?: boolean;
  className?: string;
}

const QueueControl = observer(
  ({ type, className, showPannel, filterFunc, onClose }: QueueControlProps) => {
    const curSession = appState.curSession!;
    const [, rerender] = useState<{}>({});
    const [editingScene, setEditingScene] = useState<GenericScene | undefined>(
      undefined,
    );
    const [inpaintEditScene, setInpaintEditScene] = useState<
      InpaintScene | undefined
    >(undefined);
    const [displayScene, setDisplayScene] = useState<GenericScene | undefined>(
      undefined,
    );
    const [cellSize, setCellSize] = useState(1);
    const [focusedSceneIndex, setFocusedSceneIndex] = useState<number | null>(null);
    const gridContainerRef = useRef<HTMLDivElement>(null);
    const [sceneSearchQuery, setSceneSearchQuery] = useState('');
    const [showSceneSearch, setShowSceneSearch] = useState(false);
    const sceneSearchRef = useRef<HTMLInputElement>(null);

    // activeIndex번째 매칭(.syntax-search-hit)에 active 클래스 + 그 위치로 스크롤.
    // 매칭 DOM은 searchEnabled 칸(상위/하위/네거티브)에만 생기므로 전역 쿼리로 수집.
    const updateSearchActive = useCallback((idx: number) => {
      const hits = Array.from(
        document.querySelectorAll('.syntax-search-hit'),
      );
      hits.forEach((el, i) =>
        el.classList.toggle('syntax-search-hit-active', i === idx),
      );
      hits[idx]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, []);

    // 검색창 검색어 → 전역(appState.promptSearchQuery) 동기화 → 상위/하위/네거티브 칸이
    // 구독해 하이라이트. refresh 후(rAF) 매칭 개수 카운트 + 첫 매칭 active/스크롤.
    useEffect(() => {
      const q = showSceneSearch ? sceneSearchQuery : '';
      appState.promptSearchQuery = q;
      const id = requestAnimationFrame(() => {
        const count = q
          ? document.querySelectorAll('.syntax-search-hit').length
          : 0;
        appState.promptSearchMatchCount = count;
        appState.promptSearchActiveIndex = 0;
        if (count > 0) updateSearchActive(0);
      });
      return () => cancelAnimationFrame(id);
    }, [sceneSearchQuery, showSceneSearch, updateSearchActive]);

    // 다음/이전 매칭으로 이동 (순환).
    const gotoMatch = useCallback(
      (delta: number) => {
        const count = appState.promptSearchMatchCount;
        if (count === 0) return;
        const next =
          (appState.promptSearchActiveIndex + delta + count) % count;
        appState.promptSearchActiveIndex = next;
        updateSearchActive(next);
      },
      [updateSearchActive],
    );

    useEffect(() => {
      const onProgressUpdated = () => {
        rerender({});
      };
      taskQueueService.addEventListener('progress', onProgressUpdated);
      return () => {
        taskQueueService.removeEventListener('progress', onProgressUpdated);
      };
    }, []);
    useEffect(() => {
      imageService.refreshBatch(curSession!);
    }, [curSession]);

    const addAllToQueue = async () => {
      try {
        const scenes = curSession.getScenes(type);
        const allMissing: { library: string; piece: string }[] = [];
        for (const scene of scenes) {
          const missing = promptService.findMissingPieces(curSession, scene);
          for (const m of missing) {
            if (!allMissing.find((x) => x.library === m.library && x.piece === m.piece)) {
              allMissing.push(m);
            }
          }
        }
        const doQueue = async () => {
          const total = scenes.length;
          if (total === 0) return;
          const pid = appState.pushProgressDialog(
            `씬 큐 등록 중... 0/${total}`,
            total,
          );
          // fire-and-forget: dialog 즉시 닫고 백그라운드에서 진행 → 다른 작업 가능
          (async () => {
            // foreground-free batch 경로: 일반 SDImageGen + flag on일 때 클라는 prompt만
            // 만들어 단일 fetch로 전송하고 서버가 vibe/ref 인코딩+reserve+fill을 백그라운드로
            // 수행 → 등록 직후 bg로 가도 끝까지 등록됨. (이지모드/inpaint는 createPrompt에
            // 네트워크(lookupTag)가 있어 기존 씬별 경로 유지.)
            const useBatch =
              appState.useBatchEnqueue &&
              type === 'scene' &&
              curSession.selectedWorkflow?.workflowType === 'SDImageGen';
            if (useBatch) {
              taskQueueService.beginBatchCollect();
              let bFailed = 0;
              const bErrors: string[] = [];
              for (let i = 0; i < scenes.length; i++) {
                try {
                  await queueScene(curSession, scenes[i], appState.samples);
                } catch (e: any) {
                  bFailed++;
                  bErrors.push(`${scenes[i].name}: ${extractApiError(e)}`);
                }
                appState.updateProgressDialog(pid, {
                  done: i + 1,
                  text: `씬 프롬프트 생성 중... ${i + 1}/${total}`,
                });
              }
              appState.updateProgressDialog(pid, { text: '서버로 전송 중...' });
              try {
                await taskQueueService.flushBatchCollect(
                  (missCount) =>
                    new Promise<boolean>((resolve) => {
                      appState.pushDialog({
                        type: 'confirm',
                        text: `바이브 이미지 ${missCount}개를 새로 인코딩해요 (약 ${missCount * 2} Anlas 소비). 진행할까요?`,
                        callback: () => resolve(true),
                        onCancel: () => resolve(false),
                      });
                    }),
                );
              } catch (e: any) {
                bFailed = total;
                bErrors.push(extractApiError(e));
              }
              const bSuccess = total - bFailed;
              if (bFailed === 0) {
                appState.finishProgressDialog(pid, `✓ ${bSuccess}개 씬 큐 등록 완료`, true);
              } else {
                appState.finishProgressDialog(
                  pid,
                  `△ ${bSuccess}/${total} 성공 (${bFailed}건 실패)`,
                  false,
                );
                for (const msg of bErrors.slice(0, 5)) {
                  appState.pushMessage(`프롬프트 에러 (${msg})`);
                }
              }
              return;
            }
            // CHUNK=4: 씬당 addMirroredTask 내부에서 prepGenInput N번 → server batch
            // push 1회 RTT. 동시 4씬 = libuv/서버 부담 안전 마진.
            const CHUNK = 4;
            let failed = 0;
            const errors: string[] = [];
            for (let i = 0; i < scenes.length; i += CHUNK) {
              const chunk = scenes.slice(i, i + CHUNK);
              await Promise.all(
                chunk.map(async (scene) => {
                  try {
                    await queueScene(curSession, scene, appState.samples);
                  } catch (e: any) {
                    failed++;
                    errors.push(`${scene.name}: ${extractApiError(e)}`);
                  }
                }),
              );
              const done = Math.min(i + CHUNK, total);
              appState.updateProgressDialog(pid, {
                done,
                text: `씬 큐 등록 중... ${done}/${total}`,
              });
            }
            const success = total - failed;
            if (failed === 0) {
              appState.finishProgressDialog(
                pid,
                `✓ ${success}개 씬 큐 등록 완료`,
                true,
              );
            } else {
              appState.finishProgressDialog(
                pid,
                `△ ${success}/${total} 성공 (${failed}건 실패)`,
                false,
              );
              for (const msg of errors.slice(0, 5)) {
                appState.pushMessage(`프롬프트 에러 (${msg})`);
              }
            }
          })();
        };
        if (allMissing.length > 0) {
          const list = allMissing.map((m) => `<${m.library}.${m.piece}>`).join(', ');
          appState.pushDialog({
            type: 'confirm',
            text: `존재하지 않는 프롬프트조각이 발견되었습니다:\n${list}\n\n로컬 프롬프트조각으로 새로 만들까요?\n(빈 조각이 생성되며, 내용은 직접 채워주세요)`,
            callback: async () => {
              createMissingPiecesForSession(curSession, allMissing);
              await doQueue();
            },
          });
          return;
        }
        await doQueue();
      } catch (e: any) {
        appState.pushMessage('프롬프트 에러: ' + e.message);
      }
    };

    // 단축키에서 모든 씬 예약 이벤트 수신
    useEffect(() => {
      const handler = (e: Event) => {
        const action = (e as CustomEvent).detail?.action;
        if (action === 'queue-all-scenes') {
          addAllToQueue();
        } else if (action === 'scene-search') {
          setShowSceneSearch(true);
          setTimeout(() => sceneSearchRef.current?.focus(), 50);
        }
      };
      window.addEventListener('shortcut-action', handler);
      return () => window.removeEventListener('shortcut-action', handler);
    }, [curSession, type]);

    // --- 씬 카드 키보드 네비게이션 ---
    // 씬 목록 검색은 씬 이름만. (상위/하위/네거티브 프롬프트는 PreSetEditor 칸 안에서
    // 태그를 하이라이트하는 별개 기능 — 씬 목록 필터와 무관.)
    const getFilteredScenes = useCallback(() => {
      return curSession
        .getScenes(type)
        .filter((x) => !filterFunc || filterFunc(x))
        .filter(
          (x) =>
            !sceneSearchQuery ||
            x.name.toLowerCase().includes(sceneSearchQuery.toLowerCase()),
        );
    }, [curSession, type, filterFunc, sceneSearchQuery]);

    const getGridColumnCount = useCallback((): number => {
      if (!gridContainerRef.current) return 1;
      const style = window.getComputedStyle(gridContainerRef.current);
      const cols = style.gridTemplateColumns;
      if (!cols || cols === 'none') return 1;
      return cols.split(' ').length;
    }, []);

    useEffect(() => {
      if (isMobile) return;
      const sceneNavHandler = (e: Event) => {
        const action = (e as CustomEvent).detail?.action;
        if (!action || typeof action !== 'string') return;
        if (!action.startsWith('scene-') && action !== 'queue-run' && action !== 'queue-clear')
          return;
        // 비활성 탭의 QueueControl은 무시 (display:none이면 offsetParent가 null)
        if (
          !gridContainerRef.current ||
          gridContainerRef.current.offsetParent === null
        )
          return;
        const scenes = getFilteredScenes();
        if (scenes.length === 0) return;

        if (
          action === 'scene-left' ||
          action === 'scene-right' ||
          action === 'scene-up' ||
          action === 'scene-down'
        ) {
          let idx = focusedSceneIndex ?? -1;
          if (idx < 0 || idx >= scenes.length) {
            setFocusedSceneIndex(0);
            return;
          }
          const cols = getGridColumnCount();
          let next = idx;
          if (action === 'scene-left') next = Math.max(0, idx - 1);
          else if (action === 'scene-right')
            next = Math.min(scenes.length - 1, idx + 1);
          else if (action === 'scene-up') next = Math.max(0, idx - cols);
          else if (action === 'scene-down')
            next = Math.min(scenes.length - 1, idx + cols);
          setFocusedSceneIndex(next);
        } else if (action === 'scene-open-images') {
          if (focusedSceneIndex != null && focusedSceneIndex < scenes.length) {
            setDisplayScene(scenes[focusedSceneIndex]);
          }
        } else if (action === 'scene-open-editor') {
          if (focusedSceneIndex != null && focusedSceneIndex < scenes.length) {
            setEditingScene(scenes[focusedSceneIndex]);
          }
        } else if (action === 'scene-queue-add') {
          if (focusedSceneIndex != null && focusedSceneIndex < scenes.length) {
            const scene = scenes[focusedSceneIndex];
            queueScene(curSession, scene, appState.samples).catch((e: any) => {
              appState.pushMessage('프롬프트 에러: ' + e.message);
            });
          }
        } else if (action === 'scene-toggle-bookmark') {
          if (focusedSceneIndex != null && focusedSceneIndex < scenes.length) {
            const scene = scenes[focusedSceneIndex];
            sessionService.toggleSceneBookmark(
              curSession.name,
              scene.name,
              scene.type,
            );
          }
        } else if (action === 'queue-run') {
          taskQueueService.run();
        } else if (action === 'queue-clear') {
          taskQueueService.removeAllTasksWithConfirm();
        }
      };
      window.addEventListener('shortcut-action', sceneNavHandler);
      return () =>
        window.removeEventListener('shortcut-action', sceneNavHandler);
    }, [
      focusedSceneIndex,
      getFilteredScenes,
      getGridColumnCount,
      setDisplayScene,
      setEditingScene,
    ]);

    // 포커스된 씬 자동 스크롤
    useEffect(() => {
      if (focusedSceneIndex == null) return;
      const scenes = getFilteredScenes();
      const scene = scenes[focusedSceneIndex];
      if (!scene) return;
      const el = document.getElementById(
        `scene-cell-${scene.type}-${scene.name}`,
      );
      if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, [focusedSceneIndex, getFilteredScenes]);

    const addScene = () => {
      appState.pushDialog({
        type: 'textarea-confirm',
        text: '신규 씬 이름을 입력해주세요\n(줄바꿈으로 여러 씬을 동시에 추가할 수 있습니다)',
        inputValue: '씬 이름 (한 줄에 하나씩)',
        callback: async (inputValue) => {
          if (!inputValue) return;
          const names = inputValue
            .split('\n')
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
          if (names.length === 0) return;

          const scenes = curSession.getScenes(type);
          const existingNames = new Set(scenes.map((x) => x.name));
          const duplicates = names.filter((n) => existingNames.has(n));
          const seen = new Set<string>();
          const inputDups: string[] = [];
          for (const n of names) {
            if (seen.has(n)) inputDups.push(n);
            else seen.add(n);
          }
          if (duplicates.length > 0) {
            appState.pushMessage(
              '이미 존재하는 씬 이름: ' + duplicates.join(', '),
            );
            return;
          }
          if (inputDups.length > 0) {
            appState.pushMessage(
              '중복 입력된 이름: ' + [...new Set(inputDups)].join(', '),
            );
            return;
          }

          if (type === 'scene') {
            for (const name of names) {
              curSession.addScene(
                Scene.fromJSON({
                  type: 'scene',
                  name: name,
                  resolution: 'portrait',
                  slots: [
                    [
                      {
                        id: v4(),
                        prompt: '',
                        characterPrompts: [],
                        enabled: true,
                      },
                    ],
                  ],
                  mains: [],
                  imageMap: [],
                  meta: {},
                  round: undefined,
                  game: undefined,
                }),
              );
            }
          } else {
            const menu = await appState.pushDialogAsync({
              type: 'select',
              text: '이미지 변형 방법을 선택해주세요',
              items: workFlowService.i2iFlows.map((x) => ({
                text: (x.def.emoji ?? '') + x.def.title,
                value: x.getType(),
              })),
            });
            if (!menu) return;
            for (const name of names) {
              curSession.addScene(
                InpaintScene.fromJSON({
                  type: 'inpaint',
                  name: name,
                  resolution: 'portrait',
                  workflowType: menu,
                  preset: workFlowService.buildPreset(menu).toJSON(),
                  mains: [],
                  imageMap: [],
                  round: undefined,
                  game: undefined,
                }),
              );
            }
          }
        },
      });
    };

    // useCallback으로 reference stable. BatchItemSelector → ItemCard memo가
    // getImage prop reference 변경 시마다 무효화되어 모든 카드 re-render되던 문제 회피.
    // 초기 썸네일 크기는 Config.initialThumbSize 우선, 없으면 화면 폭으로 자동 결정
    // (본인 페인 P12 #8 — 인터넷 느린 환경에서 데스크탑 500 하드코딩이 무거움).
    const thumbSize = getInitialThumbSize(appState.initialThumbSize);
    const getImage = useCallback(async (scene: GenericScene) => {
      if (scene.type === 'scene') {
        const image = await getMainImage(curSession!, scene as Scene, thumbSize);
        if (!image) throw new Error('No image available');
        return image;
      } else {
        const imgPath = scene.preset?.image || (scene.workflowType === 'SDMirror' ? curSession?.mirrorImage : undefined);
        if (!imgPath) throw new Error('No image available');
        return await imageService.fetchVibeImage(
          curSession!,
          imgPath,
        );
      }
    }, [curSession, thumbSize]);

    const cellSizes = ['스몰뷰', '미디엄뷰', '라지뷰'];

    const favButton = {
      text: (path: string) => {
        return isMainImage(path) ? '즐겨찾기 해제' : '즐겨찾기 지정';
      },
      className: 'back-orange',
      onClick: async (scene: Scene, path: string, close: () => void) => {
        const filename = path.split('/').pop()!;
        if (isMainImage(path)) {
          scene.mains = scene.mains.filter((x) => x !== filename);
        } else {
          scene.mains.push(filename);
        }
      },
    };

    const createInpaintScene = async (
      scene: GenericScene,
      workflowType: string,
      path: string,
      close: () => void,
    ) => {
      let image = await imageService.fetchImage(path);
      image = dataUriToBase64(image!);
      let cnt = 0;
      const newName = () => scene.name + cnt.toString();
      while (curSession!.inpaints.has(newName())) {
        cnt++;
      }
      const name = newName();
      const job = await extractPromptDataFromBase64(image);
      const preset = job
        ? workFlowService.createPreset(workflowType, job)
        : workFlowService.buildPreset(workflowType);

      if (workflowType === 'SDMirror') {
        // 미러: 세션 레벨 이미지 저장 + 합성 캔버스 생성
        const storedPath = await imageService.storeVibeImage(curSession!, image);
        curSession!.mirrorImage = storedPath;
        const result = await prepareMirrorCanvas(image, curSession!.mirrorMode || 'blank');
        preset.image = await imageService.storeVibeImage(curSession!, result.canvas);
        preset.mask = await imageService.storeVibeImage(curSession!, result.mask);
        const newScene = InpaintScene.fromJSON({
          type: 'inpaint',
          name: name,
          workflowType: workflowType,
          preset,
          resolution: 'custom',
          resolutionWidth: result.width,
          resolutionHeight: result.height,
          mirrorCropX: result.cropX,
          sceneRef: scene.type === 'scene' ? scene.name : undefined,
          imageMap: [],
          mains: [],
          round: undefined,
          game: undefined,
        });
        if (newScene) {
          curSession!.addScene(newScene);
          close();
          setInpaintEditScene(newScene);
        }
      } else {
        preset.image = await imageService.storeVibeImage(curSession!, image);
        const newScene = InpaintScene.fromJSON({
          type: 'inpaint',
          name: name,
          workflowType: workflowType,
          preset,
          resolution: scene.resolution,
          sceneRef: scene.type === 'scene' ? scene.name : undefined,
          imageMap: [],
          mains: [],
          round: undefined,
          game: undefined,
        });
        if (newScene) {
          curSession!.addScene(newScene);
          close();
          setInpaintEditScene(newScene);
        }
      }
    };

    const buttons: any =
      type === 'scene'
        ? [
            favButton,
            {
              text: '인페인팅 씬 생성',
              className: 'back-green',
              onClick: async (
                scene: Scene,
                path: string,
                close: () => void,
              ) => {
                await createInpaintScene(scene, 'SDInpaint', path, close);
              },
            },
          ]
        : [
            favButton,
            {
              text: '해당 이미지로 인페인트',
              className: 'back-orange',
              onClick: async (
                scene: InpaintScene,
                path: string,
                close: () => void,
              ) => {
                let image = await imageService.fetchImage(path);
                image = dataUriToBase64(image!);
                await imageService.writeVibeImage(
                  curSession!,
                  scene.preset.image,
                  image,
                );
                close();
                setInpaintEditScene(scene as InpaintScene);
              },
            },
            {
              text: '원본 씬으로 이미지 복사',
              className: 'back-green',
              onClick: async (
                scene: InpaintScene,
                path: string,
                close: () => void,
              ) => {
                if (!scene.sceneRef) {
                  appState.pushMessage('원본 씬이 없습니다.');
                  return;
                }
                const orgScene = curSession!.scenes.get(scene.sceneRef);
                if (!orgScene) {
                  appState.pushMessage('원본 씬이 삭제되었거나 이동했습니다.');
                  return;
                }
                await backend.copyFile(
                  path,
                  imageService.getImageDir(curSession!, orgScene) +
                    '/' +
                    Date.now().toString() +
                    '.png',
                );
                imageService.refresh(curSession!, orgScene);
                setDisplayScene(undefined);
                if (onClose) onClose(0);
                close();
              },
            },
          ];
    buttons.push({
      text: '이미지 변형',
      className: 'back-gray',
      // @ts-ignore
      onClick: async (scene: Scene, path: string, close: () => void) => {
        // 예전 2단계 select(변형 방법 → 씬 생성용 i2i 방법) 평탄화.
        // 씬 생성 옵션은 i2i flow별로 펼쳐서 prefix 'create:', 일회용은 'once:' prefix로 구분.
        const items: { text: string; value: string }[] = [];
        for (const flow of workFlowService.i2iFlows) {
          items.push({
            text: '🪟 씬 생성: ' + (flow.def.emoji ?? '') + flow.def.title,
            value: 'create:' + flow.getType(),
          });
        }
        for (const x of oneTimeFlows) {
          items.push({ text: x.text, value: 'once:' + x.text });
        }
        const choice = await appState.pushDialogAsync({
          type: 'select',
          text: '이미지 변형 방법을 선택해주세요',
          items,
        });
        if (!choice) return;
        if (choice.startsWith('create:')) {
          const method = choice.slice('create:'.length);
          await createInpaintScene(scene, method, path, close);
        } else if (choice.startsWith('once:')) {
          const flowText = choice.slice('once:'.length);
          let image = await imageService.fetchImage(path);
          image = dataUriToBase64(image!);
          const job = await extractPromptDataFromBase64(image);
          const menuItem = oneTimeFlowMap.get(flowText)!;
          const input = menuItem.getInput
            ? await menuItem.getInput(curSession!)
            : undefined;
          menuItem.handler(curSession!, scene, image, undefined, job, input);
        }
      },
    });

    const [adding, setAdding] = useState<boolean>(false);
    const panel = useMemo(() => {
      if (type === 'scene') {
        return (
          <>
            {inpaintEditScene && (
              <FloatView
                priority={3}
                onEscape={() => setInpaintEditScene(undefined)}
              >
                <InPaintEditor
                  editingScene={inpaintEditScene}
                  onConfirm={() => {
                    if (resultViewerRef.current)
                      resultViewerRef.current.setInpaintTab();
                    setInpaintEditScene(undefined);
                  }}
                  onDelete={() => {}}
                />
              </FloatView>
            )}
            {editingScene && (
              <FloatView
                priority={2}
                onEscape={() => setEditingScene(undefined)}
              >
                <SceneEditor
                  scene={editingScene as Scene}
                  onClosed={() => {
                    setEditingScene(undefined);
                  }}
                  onDeleted={() => {
                    if (showPannel) {
                      setDisplayScene(undefined);
                    }
                  }}
                />
              </FloatView>
            )}
          </>
        );
      } else {
        return (
          <>
            {inpaintEditScene && (
              <FloatView
                priority={3}
                onEscape={() => setInpaintEditScene(undefined)}
              >
                <InPaintEditor
                  editingScene={inpaintEditScene}
                  onConfirm={() => {
                    setInpaintEditScene(undefined);
                  }}
                  onDelete={() => {}}
                />
              </FloatView>
            )}
            {(editingScene || adding) && (
              <FloatView
                priority={2}
                onEscape={() => {
                  setEditingScene(undefined);
                  setAdding(false);
                }}
              >
                <InPaintEditor
                  editingScene={editingScene as InpaintScene}
                  onConfirm={() => {
                    setEditingScene(undefined);
                    setAdding(false);
                  }}
                  onDelete={() => {
                    setDisplayScene(undefined);
                  }}
                />
              </FloatView>
            )}
          </>
        );
      }
    }, [editingScene, inpaintEditScene, adding]);

    const onEdit = async (scene: GenericScene) => {
      setEditingScene(scene);
    };

    const isMainImage = (path: string) => {
      const filename = path.split('/').pop()!;
      return !!(displayScene && displayScene.mains.includes(filename));
    };

    const onFilenameChange = (src: string, dst: string) => {
      if (type === 'scene') {
        const scene = displayScene as Scene;
        src = src.split('/').pop()!;
        dst = dst.split('/').pop()!;
        if (scene.mains.includes(src) && !scene.mains.includes(dst)) {
          scene.mains = scene.mains.map((x) => (x === src ? dst : x));
        } else if (!scene.mains.includes(src) && scene.mains.includes(dst)) {
          scene.mains = scene.mains.map((x) => (x === dst ? src : x));
        }
      }
    };

    const resultViewerRef = useRef<any>(null);
    const resultViewer = useMemo(() => {
      if (displayScene)
        return (
          <FloatView
            priority={2}
            showToolbar
            onEscape={() => {
              gameService.refreshList(curSession!, displayScene);
              setDisplayScene(undefined);
            }}
          >
            <ResultViewer
              ref={resultViewerRef}
              scene={displayScene}
              isMainImage={isMainImage}
              onFilenameChange={onFilenameChange}
              onEdit={onEdit}
              onClose={() => {
                gameService.refreshList(curSession!, displayScene);
                setDisplayScene(undefined);
              }}
              buttons={buttons}
              onSampleExtract={type === 'scene' ? (seeds: number[]) => {
                const sourceScene = displayScene;
                gameService.refreshList(curSession!, sourceScene);
                setDisplayScene(undefined);
                const allScenes = curSession!.getScenes('scene');
                const targetScenes = allScenes.filter((s) => s.name !== sourceScene.name);
                if (targetScenes.length === 0) {
                  appState.pushMessage('대상 씬이 없습니다.');
                  return;
                }
                setBatchPicker({
                  type: 'scene',
                  text: `🎲 샘플 뽑기 (${seeds.length}개 시드)`,
                  scenes: targetScenes,
                  callback: (selected) => {
                    setBatchPicker(undefined);
                    if (selected.length === 0) return;
                    appState.pushDialog({
                      type: 'confirm',
                      text: `${selected.length}개 씬에 ${seeds.length}개 시드로 각각 이미지를 생성하시겠습니까?\n(총 ${selected.length * seeds.length}장)`,
                      callback: async () => {
                        const workflow = curSession!.selectedWorkflow;
                        if (!workflow) {
                          appState.pushMessage('워크플로우가 선택되지 않았습니다.');
                          return;
                        }
                        const [, , shared] = curSession!.getCommonSetup(workflow);
                        const originalSeed = shared?.seed;
                        try {
                          for (const targetScene of selected) {
                            for (const seed of seeds) {
                              if (shared) shared.seed = seed;
                              await queueWorkflow(curSession!, workflow, targetScene, 1);
                            }
                          }
                          appState.pushMessage(`${selected.length * seeds.length}개 이미지 생성이 예약되었습니다.`);
                        } catch (e: any) {
                          appState.pushMessage('샘플 뽑기 오류: ' + e.message);
                        } finally {
                          if (shared) shared.seed = originalSeed;
                        }
                      },
                    });
                  },
                });
              } : undefined}
            />
          </FloatView>
        );
      return <></>;
    }, [displayScene]);

    const [batchPicker, setBatchPicker] = useState<BatchPickerItem | undefined>(
      undefined,
    );
    // models 'updated' 이벤트를 카운터로 변환해 BatchItemSelector에 prop으로
    // 내림 → 신규 컴포넌트는 models 모름.
    const [imageRev, setImageRev] = useState(0);
    useEffect(() => {
      const handler = () => setImageRev((r) => r + 1);
      gameService.addEventListener('updated', handler);
      imageService.addEventListener('updated', handler);
      return () => {
        gameService.removeEventListener('updated', handler);
        imageService.removeEventListener('updated', handler);
      };
    }, []);

    const [showSceneTrash, setShowSceneTrash] = useState(false);

    const [bmRev, setBmRev] = useState(0);
    useEffect(() => {
      const onBookmarkUpdated = () => setBmRev(r => r + 1);
      sessionService.addEventListener('bookmark-updated', onBookmarkUpdated);
      return () => sessionService.removeEventListener('bookmark-updated', onBookmarkUpdated);
    }, []);
    const sceneBookmark = sessionService.getSceneBookmark(curSession.name);

    const toggleSceneSearch = useCallback(() => {
      setShowSceneSearch((prev) => {
        if (prev) {
          setSceneSearchQuery('');
        } else {
          setTimeout(() => sceneSearchRef.current?.focus(), 50);
        }
        return !prev;
      });
    }, []);

    const [reorderMode, setReorderMode] = useState(false);
    const moveScene = (draggingScene: GenericScene, targetIndex: number) => {
      curSession!.moveScene(draggingScene, targetIndex);
    };

    return (
      <div className={'flex flex-col h-full ' + (className ?? '')}>
        {batchPicker && (
          <FloatView priority={0} onEscape={() => setBatchPicker(undefined)}>
            <BatchItemSelector<GenericScene>
              title={batchPicker.text}
              items={batchPicker.scenes ?? curSession!.getScenes(batchPicker.type)}
              getId={(s) => s.name}
              getLabel={(s) => s.name}
              getImage={getImage}
              imageRevision={imageRev}
              onConfirm={batchPicker.callback}
              onCancel={() => setBatchPicker(undefined)}
            />
          </FloatView>
        )}
        {resultViewer}
        {showSceneTrash && (
          <FloatView priority={1} onEscape={() => setShowSceneTrash(false)}>
            <SceneTrashView
              projectName={curSession.name}
              onClose={() => setShowSceneTrash(false)}
            />
          </FloatView>
        )}
        {panel}
        {!!showPannel && (
          <div className="flex flex-none pb-1.5 flex-wrap">
            <div className="flex gap-1 md:gap-1.5 flex-wrap items-center">
              <button className={`round-button back-sky`} onClick={addScene}>
                씬 추가
              </button>
              <button
                className={`round-button back-sky`}
                onClick={addAllToQueue}
              >
                모두 예약추가
              </button>
              <button
                className={`round-button`}
                style={{ background: '#ef4444', color: '#fff' }}
                onClick={() => {
                  appState.pushDialog({
                    type: 'confirm',
                    text: '이 프로젝트의 모든 예약(대기 + 준비 중)을 취소할까요?',
                    callback: () => taskQueueService.removeTasksFromProject(curSession),
                  });
                }}
              >
                모든 예약 취소
              </button>
              <button
                className={`round-button back-gray`}
                onClick={() => appState.exportPackage(type)}
              >
                {isMobile ? '' : '이미지 '}내보내기
              </button>
              <button
                className={`round-button back-gray`}
                onClick={() => {
                  appState.openBatchProcessMenu(type, setBatchPicker);
                }}
              >
                대량 작업
              </button>
              <button
                className={`round-button back-gray`}
                onClick={() => {
                  appState.openChangeResolutionMenu(type, setBatchPicker);
                }}
              >
                {isMobile ? '해상도' : '해상도 변경'}
              </button>
              <Tooltip content="이미지 프롬프트 추출">
              <button
                className={`round-button back-gray`}
                onClick={() => {
                  const input = document.createElement('input');
                  input.type = 'file';
                  input.accept = 'image/png';
                  input.onchange = (e: any) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      appState.handleFile(file);
                    }
                  };
                  input.click();
                }}
              >
                <FaFileImage size={18} />
              </button>
              </Tooltip>
              <Tooltip content="씬 검색">
              <button
                className={`round-button ${showSceneSearch ? 'back-sky' : 'back-gray'}`}
                onClick={toggleSceneSearch}
              >
                <FaSearch size={18} />
              </button>
              </Tooltip>
              <Tooltip content="북마크된 씬으로 이동">
              <button
                className={`round-button ${sceneBookmark ? 'back-orange' : 'back-gray'}`}
                onClick={() => {
                  if (!sceneBookmark) {
                    appState.pushMessage('북마크된 씬이 없습니다.');
                    return;
                  }
                  if (sceneBookmark.type !== type) {
                    appState.pushMessage('북마크된 씬은 ' + (sceneBookmark.type === 'scene' ? '일반' : '인페인트') + ' 탭에 있습니다.');
                    return;
                  }
                  const el = document.getElementById(`scene-cell-${type}-${sceneBookmark.name}`);
                  if (el) {
                    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  } else {
                    appState.pushMessage('북마크된 씬을 찾을 수 없습니다.');
                  }
                }}
              >
                <FaBookmark size={18} />
              </button>
              </Tooltip>
              <Tooltip content="씬 휴지통">
              <button
                className={`round-button back-gray`}
                onClick={() => setShowSceneTrash(true)}
              >
                <FaTrash size={18} />
              </button>
              </Tooltip>
              <Tooltip content="씬 순서 변경">
              <button
                className={`round-button ${reorderMode ? 'back-sky' : 'back-gray'}`}
                onClick={() => setReorderMode((v) => !v)}
              >
                <FaSort size={18} />
              </button>
              </Tooltip>
              <Tooltip content="모든 씬 내 삭제한 이미지 일괄 비우기">
              <button
                className={`round-button back-gray`}
                onClick={() => appState.emptyProjectImageTrashWithConfirm()}
              >
                <FaBroom size={18} />
              </button>
              </Tooltip>
              <Tooltip content="찾기 및 변환 (Ctrl+H)">
              <button
                className={`round-button back-gray`}
                onClick={() => appState.openFindReplace()}
              >
                <FaExchangeAlt size={18} />
              </button>
              </Tooltip>
            </div>
            <div className="ml-auto mr-2 hidden md:flex items-center gap-2">
              {!appState.classicSceneCard && (
                <select
                  className="gray-input text-sm py-1 px-2"
                  value={curSession.sceneCardStyle?.[type] ?? 'portrait'}
                  onChange={(e) => {
                    curSession.sceneCardStyle = {
                      ...curSession.sceneCardStyle,
                      [type]: e.target.value,
                    };
                    sessionService.dirty[curSession.name] = true;
                  }}
                >
                  <option value="portrait">세로 3:4</option>
                  <option value="square">정사각형</option>
                  <option value="landscape">가로 4:3</option>
                  <option value="fixedHeight">높이 고정</option>
                </select>
              )}
              <button
                onClick={() => setCellSize((cellSize + 1) % 3)}
                className={`round-button back-gray`}
              >
                {cellSizes[cellSize]}
              </button>
            </div>
          </div>
        )}
        {showSceneSearch && (
          <div className="flex flex-none items-center gap-2 pb-2 px-1">
            <FaSearch className="text-gray-400 flex-none" />
            <input
              ref={sceneSearchRef}
              type="text"
              className="flex-1 px-2 py-1 border border-gray-300 dark:border-slate-500 rounded bg-white dark:bg-slate-700 text-default outline-none focus:border-sky-500"
              placeholder="씬 이름·상위/하위/네거티브 검색..."
              value={sceneSearchQuery}
              onChange={(e) => setSceneSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setSceneSearchQuery('');
                  setShowSceneSearch(false);
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  gotoMatch(e.shiftKey ? -1 : 1); // Enter=다음, Shift+Enter=이전
                }
              }}
            />
            {sceneSearchQuery && (
              <span className="flex-none text-xs text-gray-500 dark:text-gray-400 tabular-nums select-none min-w-[2.5rem] text-center">
                {appState.promptSearchMatchCount > 0
                  ? `${appState.promptSearchActiveIndex + 1}/${appState.promptSearchMatchCount}`
                  : '0/0'}
              </span>
            )}
            <button
              className="round-button back-gray disabled:opacity-40"
              disabled={appState.promptSearchMatchCount === 0}
              onClick={() => gotoMatch(-1)}
              title="이전 매칭 (Shift+Enter)"
            >
              <FaChevronUp />
            </button>
            <button
              className="round-button back-gray disabled:opacity-40"
              disabled={appState.promptSearchMatchCount === 0}
              onClick={() => gotoMatch(1)}
              title="다음 매칭 (Enter)"
            >
              <FaChevronDown />
            </button>
            <button
              className="round-button back-gray"
              onClick={() => {
                setSceneSearchQuery('');
                setShowSceneSearch(false);
              }}
            >
              <FaTimes />
            </button>
          </div>
        )}
        <div className="flex flex-1 overflow-hidden">
          {(() => {
            const effectiveCellSize = showPannel || isMobile ? cellSize : 2;
            // 모바일은 화면 좁아서 별도 minWidth — 데스크탑 값 그대로면 medium에서 1컬밖에 안 나옴.
            const minWidths = isMobile
              ? ['125px', '160px', '260px']
              : ['180px', '240px', '320px'];
            // 본인 페인 (2026-05-16): 모바일도 grid로 통일해 가로 fill — flex-wrap fixed-width면
            // 오른쪽 빈 공간 컸음.
            const useGrid = true;
            const renderedScenes = getFilteredScenes();
            if (renderedScenes.length === 0) {
              const totalScenes = curSession.getScenes(type).length;
              return (
                <div className="flex flex-col items-center justify-center w-full py-12 text-gray-500 dark:text-gray-400 text-center select-none">
                  {totalScenes === 0 ? (
                    <>
                      <div className="text-sm mb-3">아직 씬이 없어요. 첫 씬을 추가해보세요.</div>
                      <button className="round-button back-sky" onClick={addScene}>씬 추가</button>
                    </>
                  ) : (
                    <div className="text-sm">검색 결과가 없어요</div>
                  )}
                </div>
              );
            }
            return (
              <div
                ref={gridContainerRef}
                className={useGrid ? 'overflow-auto w-full content-start' : 'flex flex-wrap overflow-auto justify-start items-start content-start'}
                style={useGrid ? {
                  display: 'grid',
                  gridTemplateColumns: `repeat(auto-fill, minmax(${minWidths[effectiveCellSize]}, 1fr))`,
                  alignItems: 'start',
                  alignContent: 'start',
                } : undefined}
              >
                {renderedScenes.map((scene, sceneIdx) => {
                    const allScenes = curSession.getScenes(scene.type);
                    const realIdx = allScenes.indexOf(scene);
                    return (
                    <SceneCell
                      cellSize={effectiveCellSize}
                      key={scene.name}
                      scene={scene}
                      getImage={getImage}
                      setDisplayScene={setDisplayScene}
                      setEditingScene={setEditingScene}
                      moveScene={reorderMode ? moveScene : undefined}
                      onMoveUp={reorderMode && realIdx > 0 ? () => moveScene(scene, realIdx - 1) : undefined}
                      onMoveDown={reorderMode && realIdx < allScenes.length - 1 ? () => moveScene(scene, realIdx + 1) : undefined}
                      curSession={curSession}
                      isBookmarked={sessionService.isSceneBookmarked(curSession.name, scene.name)}
                      onToggleBookmark={() => sessionService.toggleSceneBookmark(curSession.name, scene.name, scene.type)}
                      disableHover={!!(editingScene || displayScene)}
                      isFocused={focusedSceneIndex === sceneIdx}
                    />
                    );
                  })}
              </div>
            );
          })()}
        </div>
      </div>
    );
  },
);

export default QueueControl;
