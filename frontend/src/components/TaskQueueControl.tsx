import { useEffect, useRef, useState } from 'react';
import { FaCaretLeft, FaCaretRight, FaPause, FaPlay, FaRegCalendarTimes } from 'react-icons/fa';
import { FaTimes } from 'react-icons/fa';
import { FaRegClock } from 'react-icons/fa';
import { sessionService, taskQueueService, cyclingSessionService } from '../models';
import { getSceneKey, Task } from '../models/TaskQueueService';
import { appState } from '../models/AppService';
import { observer } from 'mobx-react-lite';

interface ProgressBarProps {
  duration: number;
  isError: boolean;
  isPaused?: boolean;
  text: string;
}

const ProgressBar = ({ duration, isError, isPaused, text }: ProgressBarProps) => {
  // paused 상태: 애니메이션 정지 + 회색 톤 + ⏸ 아이콘. 본인이 명확히 "큐 등록만 됨, 진행 X" 인지.
  const barColor = isError
    ? 'bg-red-500'
    : isPaused
      ? 'bg-gray-400 dark:bg-slate-500'
      : 'bg-sky-500 dark:bg-indigo-400';
  const effectiveDuration = isPaused ? 0 : duration;
  return (
    <div
      className="relative w-40 md:w-52 bg-gray-200 dark:bg-slate-700 rounded-full h-8"
    >
      <div className="top-0 left-0 w-40 md:w-52 h-8 absolute flex items-center justify-center text-gray-600 dark:text-white gap-2">
        {isPaused ? <FaPause size={16} /> : <FaRegClock size={20} />}
        <div className="w-28 md:w-40 text-xs md:text-sm text-center overflow-hidden text-nowrap">
          {text}
        </div>
      </div>
      {!isPaused && (
        <>
          <div
            className={
              'top-0 left-0 absolute w-40 md:w-52 progress-transition rounded-full h-8 progress-clip-animation ' +
              barColor
            }
            style={{ animationDuration: `${effectiveDuration}s` }}
          ></div>
          <div
            className="top-0 left-0 w-40 md:w-52 h-8 absolute flex items-center justify-center text-white gap-2 progress-clip-animation"
            style={{ animationDuration: `${effectiveDuration}s` }}
          >
            <FaRegClock size={20} />
            <div className="w-28 md:w-40 text-xs md:text-sm text-center overflow-hidden text-nowrap">
              {text}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

interface TaskProgressBarProps {
  fast?: boolean;
}
export const TaskProgressBar = observer(({ fast }: TaskProgressBarProps) => {
  const key = useRef<number>(0);
  const [duration, setDuration] = useState(0);
  const [isError, setIsError] = useState(false);
  const [error, setError] = useState<string>('');
  const [_, rerender] = useState<{}>({});
  const formatTime = (ms: number) => {
    const seconds = ms / 1000;
    const minutes = seconds / 60;
    const hours = minutes / 60;

    if (seconds < 60) {
      return `${Math.round(seconds)}초`;
    } else if (minutes < 60) {
      return `${Math.round(minutes)}분`;
    } else {
      return `${Math.round(hours)}시간`;
    }
  };
  // 서버 평균(영구 누적) 사용. 클라 timeEstimator는 ring 128 + 클래스별이라 큐 reset 시
  // 또는 추세 변동에 정확도 떨어짐. server recentAvgMs(최근 100건)이 더 안정적.
  const serverAvgMs = () => appState.serverQueueAvgMs;
  const getProgressText = () => {
    const stats = taskQueueService.statsAllTasks();
    const remain = stats.total - stats.done;
    const avg = serverAvgMs();
    const totalMs = avg > 0 ? avg * remain : taskQueueService.estimateTime('mean');
    return `${remain}개 남음 (예상 ${formatTime(totalMs)})`;
  };
  const topTaskDurationSec = () => {
    const avg = serverAvgMs();
    if (avg > 0) return avg / 1000;
    return taskQueueService.estimateTopTaskTime('mean') / 1000;
  };

  useEffect(() => {
    const nextKey = () => {
      key.current = key.current + 1;
      rerender({});
    };
    const onChange = () => {
      if (!taskQueueService.isRunning()) {
        nextKey();
        setDuration(0);
        setIsError(false);
        setError('');
      }
      rerender({});
    };
    const onComplete = () => {
      nextKey();
      setIsError(false);
      setError('');
      setDuration(topTaskDurationSec());
      if (!taskQueueService.isRunning()) {
        setDuration(0);
      }
    };
    const onStart = () => {
      nextKey();
      setIsError(false);
      setError('');
      setDuration(topTaskDurationSec());
      if (!taskQueueService.isRunning()) {
        setDuration(0);
      }
    };
    const onError = (e: any) => {
      if (e.detail.task.type === 'remove-bg') {
        appState.pushMessage('Error: ' + e.detail.error);
      }
      setError(e.detail.error);
      setIsError(true);
    };
    taskQueueService.addEventListener('start', onStart);
    taskQueueService.addEventListener('stop', onChange);
    taskQueueService.addEventListener('progress', onChange);
    taskQueueService.addEventListener('complete', onComplete);
    taskQueueService.addEventListener('error', onError);
    return () => {
      taskQueueService.removeEventListener('start', onStart);
      taskQueueService.removeEventListener('stop', onChange);
      taskQueueService.removeEventListener('progress', onChange);
      taskQueueService.removeEventListener('complete', onComplete);
      taskQueueService.removeEventListener('error', onError);
    };
  }, []);

  return (
    <div
      onClick={() => {
        if (error !== '') {
          appState.pushMessage('Error: ' + error);
        }
      }}
    >
      <ProgressBar
        key={key.current}
        isError={isError}
        isPaused={taskQueueService.mirrorPaused && !taskQueueService.currentRun}
        duration={duration}
        text={getProgressText()}
      />
    </div>
  );
});

// 태스크 1건의 sceneKey 추출 — placeholder restored task는 task.params.session이 없어서
// scene._sceneKey 또는 sceneKey 직접 보관 필드를 fallback으로 사용.
const taskSceneKey = (task: Task): string | null => {
  if (task.params?.session && task.params?.scene) {
    return getSceneKey(task.params.session, task.params.scene);
  }
  const sk = (task.params?.scene as any)?._sceneKey;
  return typeof sk === 'string' ? sk : null;
};

// 표시 분해: 폴더 / 프로젝트(=session) / 씬. 폴더는 sessionService.folderMap에서 조회.
// placeholder task는 sessionName을 sceneKey 첫 segment에서 파싱.
const taskDisplay = (task: Task) => {
  const sceneName = task.params?.scene?.name ?? '(none)';
  let projectName = task.params?.session?.name ?? null;
  if (!projectName) {
    const sk = (task.params?.scene as any)?._sceneKey;
    if (typeof sk === 'string' && sk.includes('/')) {
      projectName = sk.split('/')[0];
    }
  }
  const project = projectName ?? '(unknown)';
  const folder = projectName ? sessionService.folderMap[projectName] ?? '' : '';
  return { folder, project, scene: sceneName };
};

const TaskQueueList = observer(({ onClose }: { onClose?: () => void }) => {
  const [tasks, setTasks] = useState<any[]>([]);
  useEffect(() => {
    const onChange = () => {
      // 클라 큐 (augment/remove-bg) + server-mirror 큐 (gen/inpaint/i2i) 합쳐서 표시
      setTasks([
        ...taskQueueService.queue,
        ...Array.from(taskQueueService.mirroredTasks.values()),
      ]);
    };
    taskQueueService.addEventListener('start', onChange);
    taskQueueService.addEventListener('stop', onChange);
    taskQueueService.addEventListener('progress', onChange);
    taskQueueService.addEventListener('complete', onChange);
    taskQueueService.addEventListener('error', onChange);
    onChange();
    return () => {
      taskQueueService.removeEventListener('start', onChange);
      taskQueueService.removeEventListener('stop', onChange);
      taskQueueService.removeEventListener('progress', onChange);
      taskQueueService.removeEventListener('complete', onChange);
      taskQueueService.removeEventListener('error', onChange);
    };
  }, []);

  const getEmoji = (task: Task) => {
    return taskQueueService.getTaskInfo(task).emoji;
  };

  const currentKey = appState.currentProcessingSceneKey;

  // sceneKey 단위 그룹핑: 같은 씬을 여러 번 큐에 넣어도 row 1개. done/total은 누적 합산.
  // sceneKey 없는(=parsing 실패) task는 task.id로 fallback 그룹키.
  const grouped: Array<{ sceneKey: string | null; firstTask: any; done: number; total: number }> = [];
  const groupIndex = new Map<string, number>();
  for (const task of tasks) {
    const sk = taskSceneKey(task);
    const groupKey = sk ?? `__no_key__${task.id ?? ''}`;
    const idx = groupIndex.get(groupKey);
    if (idx === undefined) {
      groupIndex.set(groupKey, grouped.length);
      grouped.push({ sceneKey: sk, firstTask: task, done: task.done, total: task.total });
    } else {
      grouped[idx].done += task.done;
      grouped[idx].total += task.total;
    }
  }

  return (
    <div className="absolute bottom-0 mb-14 md:mb-20 bg-white dark:bg-slate-700 w-60 md:w-96 z-20 shadow-lg prog-list flex flex-col overflow-hidden">
      <button
        className="ml-auto mt-2 mr-2 text-gray-500 hover:text-gray-700 flex-none"
        onClick={() => {
          onClose?.();
        }}
      >
        <FaTimes size={20} />
      </button>
      <div className="flex-1 overflow-hidden pb-2">
        <div className="h-full overflow-auto">
          {grouped.map((g, i) => {
            const { folder, project, scene } = taskDisplay(g.firstTask);
            const isProcessing = !!currentKey && g.sceneKey === currentKey;
            const itemClass = isProcessing
              ? 'flex mt-2 items-center gap-2 p-2 mx-2 rounded-lg scene-processing-list'
              : 'flex mt-2 items-center gap-2 p-2 mx-2 rounded-lg border border-gray-300 dark:border-slate-500';
            return (
              <div key={i} className={itemClass}>
                <div className="flex-none">{getEmoji(g.firstTask)}</div>
                <div className="flex-1 truncate text-default text-sm leading-tight">
                  {folder && (
                    <>
                      {/* 모바일 세로: 폴더는 ... 으로 축약해 씬 이름 자리 확보. md 이상은 풀네임. */}
                      <span className="text-gray-500 dark:text-gray-300 md:hidden">… / </span>
                      <span className="text-gray-500 dark:text-gray-300 hidden md:inline">{folder} / </span>
                    </>
                  )}
                  <span className="text-gray-500 dark:text-gray-300">{project} / </span>
                  <span className="font-medium">{scene}</span>
                </div>
                <div className="flex-none ml-auto p-2 bg-gray-300 dark:bg-slate-500 dark:text-white rounded-lg font-medium text-sm text-gray-500">
                  {g.done}/{g.total}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
});

const TaskQueueControl = observer(({}) => {
  const [_, rerender] = useState<{}>({});
  const [showList, setShowList] = useState(false);
  useEffect(() => {
    const onChange = () => {
      rerender({});
    };
    taskQueueService.addEventListener('start', onChange);
    taskQueueService.addEventListener('stop', onChange);
    taskQueueService.addEventListener('progress', onChange);
    taskQueueService.addEventListener('complete', onChange);
    taskQueueService.addEventListener('error', onChange);
    return () => {
      taskQueueService.removeEventListener('start', onChange);
      taskQueueService.removeEventListener('stop', onChange);
      taskQueueService.removeEventListener('progress', onChange);
      taskQueueService.removeEventListener('complete', onChange);
      taskQueueService.removeEventListener('error', onChange);
    };
  }, []);

  const cyclingActive = cyclingSessionService.state === 'running' || cyclingSessionService.state === 'paused';

  return (
    <div className="flex gap-2 md:gap-4 items-center">
      {showList && (
        <TaskQueueList
          onClose={() => {
            setShowList(false);
          }}
        />
      )}
      {cyclingActive && (
        <div className="hidden md:flex items-center gap-1 px-2 py-1 bg-sky-100 dark:bg-sky-900/30 rounded-lg text-xs whitespace-nowrap">
          <span className="text-sky-600 dark:text-sky-400">🔄</span>
          <span className="text-sky-700 dark:text-sky-300">
            순차 ({cyclingSessionService.completedPresets + 1}/{cyclingSessionService.totalPresets})
          </span>
        </div>
      )}
      <div className="whitespace-nowrap flex items-center gap-1">
        <span className="whitespace-nowrap text-default">개수:</span>
        <button
          className="round-button back-gray px-1.5 h-7"
          onClick={() => { appState.samples = Math.max(1, appState.samples - 1); }}
        >
          <FaCaretLeft size={14} />
        </button>
        <input
          min={1}
          max={99}
          className={'p-1 w-10 md:w-12 text-center gray-input'}
          type="number"
          value={appState.samples}
          onChange={(e: any) => {
            try {
              const num = parseInt(e.currentTarget.value) ?? 0;
              appState.samples = Math.max(1, Math.min(99, num));
            } catch (e: any) {
              appState.samples = 1;
            }
          }}
        />
        <button
          className="round-button back-gray px-1.5 h-7"
          onClick={() => { appState.samples = Math.min(99, appState.samples + 1); }}
        >
          <FaCaretRight size={14} />
        </button>
      </div>
      <div
        className="relative cursor-pointer hover:brightness-95 active:brightness-90"
        onClick={() => {
          setShowList(!showList);
        }}
      >
        <TaskProgressBar />
      </div>
      <button
        className={`round-button back-gray px-2 h-8 md:px-6`}
        onClick={() => {
          taskQueueService.removeAllTasks();
        }}
      >
        <FaRegCalendarTimes size={18} />
      </button>
      {!taskQueueService.isRunning() ? (
        <button
          className={`round-button back-green px-2 h-8 md:px-6`}
          onClick={() => {
            (async () => {
              const costs = taskQueueService.calculateCost();
              const message = costs
                .map((x) => `${x.text} (씬: ${x.scene})`)
                .slice(0, 10)
                .join('\n');
              if (costs.length > 0) {
                appState.pushDialog({
                  type: 'confirm',
                  text:
                    'Anlas를 소모하는 유료 세팅입니다. 계속합니까?' +
                    '\n' +
                    message,
                  callback: () => {
                    taskQueueService.run();
                  },
                });
              } else {
                taskQueueService.run();
              }
            })();
          }}
        >
          <FaPlay size={15} />
        </button>
      ) : (
        <button
          className={`round-button back-red px-2 h-8 md:px-6`}
          onClick={() => {
            taskQueueService.stop();
          }}
        >
          <FaPause size={15} />
        </button>
      )}
    </div>
  );
});

// Mobile-only split components (rendered side-by-side in 2-row mobile layout).
// Each has its own event listeners so observer state updates correctly.
export const TaskQueueProgress = observer(({}) => {
  const [_, rerender] = useState<{}>({});
  const [showList, setShowList] = useState(false);
  useEffect(() => {
    const onChange = () => { rerender({}); };
    taskQueueService.addEventListener('start', onChange);
    taskQueueService.addEventListener('stop', onChange);
    taskQueueService.addEventListener('progress', onChange);
    taskQueueService.addEventListener('complete', onChange);
    taskQueueService.addEventListener('error', onChange);
    return () => {
      taskQueueService.removeEventListener('start', onChange);
      taskQueueService.removeEventListener('stop', onChange);
      taskQueueService.removeEventListener('progress', onChange);
      taskQueueService.removeEventListener('complete', onChange);
      taskQueueService.removeEventListener('error', onChange);
    };
  }, []);
  return (
    <>
      {showList && (
        <TaskQueueList onClose={() => { setShowList(false); }} />
      )}
      <div
        className="relative cursor-pointer hover:brightness-95 active:brightness-90"
        onClick={() => { setShowList(!showList); }}
      >
        <TaskProgressBar />
      </div>
    </>
  );
});

export const TaskQueueControls = observer(({}) => {
  const [_, rerender] = useState<{}>({});
  useEffect(() => {
    const onChange = () => { rerender({}); };
    taskQueueService.addEventListener('start', onChange);
    taskQueueService.addEventListener('stop', onChange);
    taskQueueService.addEventListener('complete', onChange);
    taskQueueService.addEventListener('error', onChange);
    return () => {
      taskQueueService.removeEventListener('start', onChange);
      taskQueueService.removeEventListener('stop', onChange);
      taskQueueService.removeEventListener('complete', onChange);
      taskQueueService.removeEventListener('error', onChange);
    };
  }, []);
  return (
    <div className="flex gap-2 items-center">
      <div className="whitespace-nowrap flex items-center gap-1">
        <span className="whitespace-nowrap text-default">개수:</span>
        <button
          className="round-button back-gray px-1.5 h-7"
          onClick={() => { appState.samples = Math.max(1, appState.samples - 1); }}
        >
          <FaCaretLeft size={14} />
        </button>
        <input
          min={1}
          max={99}
          className={'p-1 w-10 md:w-12 text-center gray-input'}
          type="number"
          value={appState.samples}
          onChange={(e: any) => {
            try {
              const num = parseInt(e.currentTarget.value) ?? 0;
              appState.samples = Math.max(1, Math.min(99, num));
            } catch (e: any) {
              appState.samples = 1;
            }
          }}
        />
        <button
          className="round-button back-gray px-1.5 h-7"
          onClick={() => { appState.samples = Math.min(99, appState.samples + 1); }}
        >
          <FaCaretRight size={14} />
        </button>
      </div>
      <button
        className={`round-button back-gray px-2 h-8 md:px-6`}
        onClick={() => { taskQueueService.removeAllTasks(); }}
      >
        <FaRegCalendarTimes size={18} />
      </button>
      {!taskQueueService.isRunning() ? (
        <button
          className={`round-button back-green px-2 h-8 md:px-6`}
          onClick={() => {
            (async () => {
              const costs = taskQueueService.calculateCost();
              const message = costs
                .map((x) => `${x.text} (씬: ${x.scene})`)
                .slice(0, 10)
                .join('\n');
              if (costs.length > 0) {
                appState.pushDialog({
                  type: 'confirm',
                  text:
                    'Anlas를 소모하는 유료 세팅입니다. 계속합니까?' +
                    '\n' +
                    message,
                  callback: () => { taskQueueService.run(); },
                });
              } else {
                taskQueueService.run();
              }
            })();
          }}
        >
          <FaPlay size={15} />
        </button>
      ) : (
        <button
          className={`round-button back-red px-2 h-8 md:px-6`}
          onClick={() => { taskQueueService.stop(); }}
        >
          <FaPause size={15} />
        </button>
      )}
    </div>
  );
});

export default TaskQueueControl;
