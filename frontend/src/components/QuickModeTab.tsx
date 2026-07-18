import { useCallback, useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useContextMenu } from 'react-contexify';
import { v4 } from 'uuid';
import {
  cyclingSessionService,
  gameService,
  imageService,
  sessionService,
  taskQueueService,
} from '../models';
import { appState } from '../models/AppService';
import { ContextMenuType, Scene, Session } from '../models/types';
import { queueScene } from './SceneQueueControl';
import { useLongPress } from './useLongPress';

const DEFAULT_SCENE = 'default';
type QuickMode = 'idle' | 'single' | 'auto' | 'switching';

function ensureDefaultScene(session: Session): Scene {
  let scene = session.scenes.get(DEFAULT_SCENE);
  if (scene) return scene;
  session.addScene(Scene.fromJSON({
    type: 'scene',
    name: DEFAULT_SCENE,
    resolution: 'portrait',
    slots: [[{
      id: v4(),
      prompt: '',
      characterPrompts: [],
      enabled: true,
    }]],
    mains: [],
    imageMap: [],
    meta: {},
    round: undefined,
    game: undefined,
  }));
  sessionService.markDirty(session.name);
  scene = session.scenes.get(DEFAULT_SCENE)!;
  return scene;
}

const QuickModeTab = observer(() => {
  const session = appState.curSession!;
  const [latestPath, setLatestPath] = useState<string>();
  const [image, setImage] = useState<string>();
  const [sceneStats, setSceneStats] = useState({ done: 0, total: 0 });
  const [mode, setMode] = useState<QuickMode>('idle');
  const modeRef = useRef<QuickMode>('idle');
  const commandRef = useRef(0);
  const enqueueingRef = useRef(false);
  const producedRef = useRef(false);
  const producedBaselineRef = useRef(0);

  const updateMode = (next: QuickMode) => {
    modeRef.current = next;
    setMode(next);
  };

  const refreshLatest = useCallback(() => {
    const scene = session.scenes.get(DEFAULT_SCENE);
    if (!scene) return setLatestPath(undefined);
    const outputs = gameService.getOutputs(session, scene);
    setLatestPath(outputs.length
      ? imageService.getOutputDir(session, scene) + '/' + outputs[0]
      : undefined);
  }, [session]);

  useEffect(() => {
    void (async () => {
      const scene = session.scenes.get(DEFAULT_SCENE);
      if (scene) await imageService.refresh(session, scene);
      refreshLatest();
    })();
    const onAdded = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.session?.name === session.name &&
          detail.sceneType === 'scene' && detail.sceneName === DEFAULT_SCENE) {
        setLatestPath(detail.path);
      }
    };
    const onUpdated = () => refreshLatest();
    imageService.addEventListener('image-added', onAdded);
    imageService.addEventListener('updated', onUpdated);
    return () => {
      imageService.removeEventListener('image-added', onAdded);
      imageService.removeEventListener('updated', onUpdated);
    };
  }, [session, refreshLatest]);

  useEffect(() => {
    let canceled = false;
    if (!latestPath) {
      setImage(undefined);
      return;
    }
    imageService.fetchImage(latestPath).then((base64) => {
      if (!canceled) setImage(base64 ?? undefined);
    }).catch(() => {});
    return () => { canceled = true; };
  }, [latestPath]);

  useEffect(() => {
    const update = () => {
      const scene = session.scenes.get(DEFAULT_SCENE);
      const stats = scene
        ? taskQueueService.statsTasksFromScene(session, scene)
        : { done: 0, total: 0 };
      setSceneStats(stats);
      // 탭/앱이 다시 마운트됐을 때 이미 복원된 퀵 작업은 1장 생성으로 표시한다.
      // 자동 반복 여부는 메모리에만 존재하므로 부팅을 넘겨 추측하지 않는다.
      if (modeRef.current === 'idle' && stats.done < stats.total) updateMode('single');
    };
    update();
    const events = ['start', 'stop', 'progress', 'complete', 'error'];
    for (const event of events) taskQueueService.addEventListener(event, update);
    return () => {
      for (const event of events) taskQueueService.removeEventListener(event, update);
    };
  }, [session]);

  const enqueueOnce = async () => {
    const scene = ensureDefaultScene(session);
    producedBaselineRef.current = taskQueueService.statsTasksFromScene(session, scene).done;
    enqueueingRef.current = true;
    try {
      await queueScene(session, scene, 1);
      taskQueueService.run();
    } finally {
      enqueueingRef.current = false;
    }
  };

  useEffect(() => {
    const onComplete = () => {
      const scene = session.scenes.get(DEFAULT_SCENE);
      if (!scene) return;
      const stats = taskQueueService.statsTasksFromScene(session, scene);
      if (stats.done > producedBaselineRef.current) producedRef.current = true;
    };
    const onStop = () => {
      if (enqueueingRef.current) return;
      if (modeRef.current === 'single') {
        updateMode('idle');
        return;
      }
      if (modeRef.current !== 'auto' || !taskQueueService.isEmpty()) return;
      if (!producedRef.current) {
        updateMode('idle');
        appState.pushMessage('생성이 계속 실패하여 자동 생성을 중지했습니다');
        return;
      }
      producedRef.current = false;
      const command = commandRef.current;
      void enqueueOnce().catch((error: any) => {
        if (command !== commandRef.current || modeRef.current !== 'auto') return;
        updateMode('idle');
        appState.pushMessage(`자동 생성 중단: ${error.message}`);
      });
    };
    taskQueueService.addEventListener('complete', onComplete);
    taskQueueService.addEventListener('stop', onStop);
    return () => {
      taskQueueService.removeEventListener('complete', onComplete);
      taskQueueService.removeEventListener('stop', onStop);
      commandRef.current += 1;
      modeRef.current = 'idle';
    };
  }, [session]);

  const guardCycling = () => {
    if (cyclingSessionService.state !== 'running') return true;
    appState.pushMessage('사이클링 생성이 진행 중입니다. 완료 후 사용해주세요');
    return false;
  };

  const start = async (nextMode: 'single' | 'auto') => {
    if (!guardCycling()) return;
    const command = ++commandRef.current;
    updateMode(nextMode);
    producedRef.current = false;
    try {
      await enqueueOnce();
      if (command !== commandRef.current) return;
    } catch (error: any) {
      if (command !== commandRef.current) return;
      updateMode('idle');
      appState.pushMessage(
        nextMode === 'auto'
          ? `자동 생성 시작 실패: ${error.message}`
          : `프롬프트 에러: ${error.message}`,
      );
    }
  };

  const cancelOrSwitch = async (nextMode?: 'single' | 'auto') => {
    // 취소는 사이클링 상태와 무관하게 항상 가능해야 한다. 새 모드로 전환할 때만
    // 기존 상호배제 가드를 적용한다.
    if (nextMode && !guardCycling()) return;
    const command = ++commandRef.current;
    updateMode('switching');
    producedRef.current = false;
    const scene = session.scenes.get(DEFAULT_SCENE);
    if (scene) {
      // queueScene의 reserve/prep가 아직 끝나지 않았을 수 있어 현재 등록분을 먼저
      // 취소하고 pending add가 정착한 뒤 한 번 더 targeted cancel한다.
      const firstCanceled = await taskQueueService.removeTasksFromScene(session, scene);
      await taskQueueService.waitForPendingFills();
      const lateCanceled = await taskQueueService.removeTasksFromScene(session, scene);
      if (!firstCanceled || !lateCanceled) {
        if (command === commandRef.current) {
          updateMode('idle');
          appState.pushMessage('기존 퀵 생성을 서버에서 취소하지 못해 모드 전환을 중단했습니다');
        }
        return;
      }
    }
    if (command !== commandRef.current) return;
    if (!nextMode) {
      updateMode('idle');
      return;
    }
    updateMode(nextMode);
    try {
      await enqueueOnce();
    } catch (error: any) {
      if (command !== commandRef.current) return;
      updateMode('idle');
      appState.pushMessage(`${nextMode === 'auto' ? '자동' : '1장'} 생성 전환 실패: ${error.message}`);
    }
  };

  const busy = mode !== 'idle' || sceneStats.done < sceneStats.total;

  const { show } = useContextMenu({ id: ContextMenuType.HistoryImage });
  const showImageMenu = (event: React.MouseEvent | React.TouchEvent, position?: { x: number; y: number }) => {
    if (!latestPath) return;
    const entry = {
      id: latestPath,
      sessionName: session.name,
      sceneType: 'scene' as const,
      sceneName: DEFAULT_SCENE,
      filename: latestPath.split('/').pop()!,
      path: latestPath,
      createdAt: 0,
    };
    show({ event, position, props: { ctx: { type: 'history_image', entry } } });
  };
  const imageLongPress = useLongPress({
    onLongPress: (event, position) => showImageMenu(event, position),
  });

  const progress = sceneStats.total > 0 ? `${sceneStats.done}/${sceneStats.total}` : '';
  return (
    <div className="h-full w-full flex flex-col">
      <div
        className="flex-1 min-h-0 relative flex items-center justify-center p-2"
        onContextMenu={(event) => {
          event.preventDefault();
          showImageMenu(event);
        }}
        {...imageLongPress.handlers}
      >
        {image ? (
          <img
            src={image}
            draggable={false}
            className="max-w-full max-h-full object-contain rounded select-none"
            style={imageLongPress.callout}
          />
        ) : (
          <div className="text-faint text-sm text-center px-6">
            아직 생성된 이미지가 없습니다<br />
            프롬프트를 입력하고 아래 버튼으로 바로 생성해보세요
          </div>
        )}
        {busy && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full border line-color bg-[var(--c-surface-2)]">
            <span className="text-body text-xs">
              {mode === 'switching'
                ? '생성 모드 전환 중…'
                : `${mode === 'auto' ? '자동 생성 중' : '생성 중'}${progress ? ` ${progress}` : ''}…`}
            </span>
          </div>
        )}
      </div>
      <div className="flex-none grid grid-cols-2 gap-2 px-3 pb-3 pt-1">
        <button
          className={'round-button font-semibold text-sm !py-2.5 w-full select-none ' +
            (mode === 'single' ? 'back-red' : mode === 'switching' ? 'back-gray' : 'back-sky')}
          disabled={mode === 'switching'}
          onClick={() => {
            const current = modeRef.current;
            if (current === 'idle') void start('single');
            else if (current === 'single') void cancelOrSwitch();
            else if (current === 'auto') void cancelOrSwitch('single');
          }}
        >
          {mode === 'single'
            ? `1장 생성 취소${progress ? ` ${progress}` : ''}`
            : mode === 'switching'
              ? '전환 중…'
              : mode === 'auto'
                ? '1장으로 전환'
                : '1장 생성'}
        </button>
        <button
          className={'round-button font-semibold text-sm !py-2.5 w-full select-none ' +
            (mode === 'auto' ? 'back-red' : mode === 'switching' ? 'back-gray' : 'back-green')}
          disabled={mode === 'switching'}
          onClick={() => {
            const current = modeRef.current;
            if (current === 'idle') void start('auto');
            else if (current === 'auto') void cancelOrSwitch();
            else if (current === 'single') void cancelOrSwitch('auto');
          }}
        >
          {mode === 'auto'
            ? `자동 생성 취소${progress ? ` ${progress}` : ''}`
            : mode === 'switching'
              ? '전환 중…'
              : mode === 'single'
                ? '자동으로 전환'
                : '자동 생성'}
        </button>
      </div>
    </div>
  );
});

export default QuickModeTab;
