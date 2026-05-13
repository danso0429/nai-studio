import { useContext, useEffect, useRef, useState } from 'react';
import { FaSpinner } from 'react-icons/fa';
import { FaCaretLeft, FaCaretRight, FaPause, FaPlay, FaRegCalendarTimes } from 'react-icons/fa';
import { FaTimes } from 'react-icons/fa';
import { FaRegClock } from 'react-icons/fa';
import { taskQueueService } from '../models';
import { Task } from '../models/TaskQueueService';
import { appState } from '../models/AppService';
import { observer } from 'mobx-react-lite';

interface ProgressBarProps {
  duration: number;
  isError: boolean;
  isPaused?: boolean;
  text: string;
  key: number;
}

const ProgressBar = ({ duration, isError, isPaused, text, key }: ProgressBarProps) => {
  // paused 상태: 애니메이션 정지 + 회색 톤 + ⏸ 아이콘. 본인이 명확히 "큐 등록만 됨, 진행 X" 인지.
  const barColor = isError
    ? 'bg-red-500'
    : isPaused
      ? 'bg-gray-400 dark:bg-slate-500'
      : 'bg-sky-500 dark:bg-indigo-400';
  const effectiveDuration = isPaused ? 0 : duration;
  return (
    <div
      key={key}
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

const TaskQueueList = ({ onClose }: { onClose?: () => void }) => {
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

  const getTaskText = (task: Task) => {
    return taskQueueService.getTaskInfo(task).name;
  };

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
          {tasks.map((task, i) => (
            <div
              key={i}
              className="flex mt-2 items-center gap-2 p-2 border-gray-300 dark:border-slate-500 border mx-2 rounded-lg"
            >
              <div className="flex-none ">{getEmoji(task)}</div>
              <div className="flex-1 truncate text-default">
                {getTaskText(task)}
              </div>
              <div className="flex-none ml-auto p-2 bg-gray-300 dark:bg-slate-500 dark:text-white rounded-lg font-medium text-sm text-gray-500">
                {task!.done}/{task!.total}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

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

  return (
    <div className="flex gap-2 md:gap-4 items-center">
      {showList && (
        <TaskQueueList
          onClose={() => {
            setShowList(false);
          }}
        />
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
