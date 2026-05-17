import { useEffect, useMemo, useRef, useState } from 'react';
import { FaCaretLeft, FaCaretRight, FaPause, FaPlay, FaRegCalendarTimes, FaTimes, FaRegClock, FaStar, FaRegStar } from 'react-icons/fa';
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

// 폴더 → 프로젝트 → 씬 3단 트리. 기본 다 접힘, 본인이 필요할 때만 expand.
// 본인 spec (2026-05-17): 폴더로 먼저 감싸기, default expand 안 함.
// 카운터 spec (2026-05-17 후속): 분모는 "최초 큐 등록된 총 잡 수" 고정. 분자만 증가.
// 한 씬 잡 N개 다 완료되면 분모 그대로 둔 채 잠시(2초) 후 사라짐. 그 사이 상위 폴더/프로젝트
// 카운트는 그 씬의 원래 총 수를 유지 (씬이 사라져도 1/132 → 2/132 → ... 132/132 식 흐름).
type SceneNode = {
  sceneKey: string | null;
  sceneName: string;
  emoji: string;
  done: number;
  total: number; // 원래 큐 등록된 총 잡 수 (snapshot, 고정)
  taskIds: string[]; // 우선순위 toggle 시 서버에 보낼 task ID들
  isPriority: boolean; // 이 씬의 task 중 하나라도 priority면 true
};
type ProjectNode = {
  name: string;
  scenes: SceneNode[];
  done: number;
  total: number;
  isProcessing: boolean; // 자식 씬 중 현재 처리 중인 게 있으면 펄스
};
type FolderNode = {
  name: string;
  hasFolder: boolean; // '(폴더 없음)' 묶음 구분
  projects: ProjectNode[];
  done: number;
  total: number;
  isProcessing: boolean; // 자식 프로젝트 중 처리 중인 게 있으면 펄스
};

const NO_FOLDER_KEY = '(폴더 없음)';
const VANISH_DELAY_MS = 2000;

// 본인 spec: 큐에 한 번 잡힌 task의 originalTotal은 고정. task가 mirroredTasks에서 사라져도
// (잡 완료) 표시 측에서 일정 시간 유지 → 카운트가 갑자기 줄어들지 않음.
type SeenEntry = {
  taskId: string;
  sceneKey: string | null;
  sceneName: string;
  project: string;
  folder: string;
  hasFolder: boolean;
  emoji: string;
  originalTotal: number;
  done: number;
  priority: boolean;
  completedAt?: number; // task가 mirroredTasks에서 사라진 시점 (vanish 타이머 시작)
};

const TaskQueueList = observer(({ onClose }: { onClose?: () => void }) => {
  // 표시 source of truth — TaskQueueService의 mirroredTasks를 mirror해 snapshot 유지.
  // task가 사라져도 entry 보존 + completedAt 찍어 2초 후 자연 제거.
  const seenTasksRef = useRef<Map<string, SeenEntry>>(new Map());
  // expand 상태: 폴더는 `f:{name}`, 프로젝트는 `p:{name}`. 본인이 직접 toggle.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // 렌더 강제 트리거용 카운터 (seenTasksRef는 ref라 mutation만으론 re-render 안 함).
  // useMemo의 dep에도 사용 — counter 바뀌면 트리 재빌드.
  const [tick, rerender] = useState(0);

  const syncFromService = () => {
    const seen = seenTasksRef.current;
    const current = new Map<string, Task>();
    for (const t of taskQueueService.queue) {
      if (t && t.id) current.set(t.id, t);
    }
    for (const [id, t] of taskQueueService.mirroredTasks) {
      current.set(id, t);
    }
    // 새 task 추가 + 기존 task done 갱신
    for (const [taskId, task] of current) {
      const existing = seen.get(taskId);
      if (!existing) {
        const { folder, project, scene } = taskDisplay(task);
        const sk = taskSceneKey(task);
        seen.set(taskId, {
          taskId,
          sceneKey: sk,
          sceneName: scene,
          project,
          folder: folder || '',
          hasFolder: !!folder,
          emoji: taskQueueService.getTaskInfo(task).emoji,
          originalTotal: task.total,
          done: task.done,
          priority: !!task.priority,
        });
      } else {
        // task가 살아있는 동안 done/priority 갱신.
        existing.done = task.done;
        existing.priority = !!task.priority;
        if (task.total > existing.originalTotal) {
          existing.originalTotal = task.total;
        }
      }
    }
    // 사라진 task에 completedAt 찍기 + done = originalTotal (4/4 정확히 보이게)
    const now = Date.now();
    for (const [taskId, entry] of seen) {
      if (!current.has(taskId) && !entry.completedAt) {
        entry.done = entry.originalTotal;
        entry.completedAt = now;
      }
    }
    rerender((n) => n + 1);
  };

  useEffect(() => {
    syncFromService();
    const onChange = () => syncFromService();
    taskQueueService.addEventListener('start', onChange);
    taskQueueService.addEventListener('stop', onChange);
    taskQueueService.addEventListener('progress', onChange);
    taskQueueService.addEventListener('complete', onChange);
    taskQueueService.addEventListener('error', onChange);
    // vanish 타이머 — completedAt + VANISH_DELAY_MS 지난 entry 정리.
    const vanishTimer = setInterval(() => {
      const seen = seenTasksRef.current;
      const now = Date.now();
      let changed = false;
      for (const [taskId, entry] of seen) {
        if (entry.completedAt && now - entry.completedAt > VANISH_DELAY_MS) {
          seen.delete(taskId);
          changed = true;
        }
      }
      if (changed) rerender((n) => n + 1);
    }, 500);
    return () => {
      taskQueueService.removeEventListener('start', onChange);
      taskQueueService.removeEventListener('stop', onChange);
      taskQueueService.removeEventListener('progress', onChange);
      taskQueueService.removeEventListener('complete', onChange);
      taskQueueService.removeEventListener('error', onChange);
      clearInterval(vanishTimer);
    };
  }, []);

  const currentKey = appState.currentProcessingSceneKey;

  // 트리 빌드 헬퍼 — entries 필터(priority/normal)별로 분리해 두 트리 생성. seenTasksRef snapshot
  // 기준이라 task 사라져도 (vanish delay 동안) 카운트 유지.
  const buildTree = (entries: SeenEntry[]): FolderNode[] => {
    const folders = new Map<string, Map<string, Map<string, SceneNode>>>();
    const folderMeta = new Map<string, { hasFolder: boolean }>();
    for (const entry of entries) {
      const folderKey = entry.folder || NO_FOLDER_KEY;
      if (!folders.has(folderKey)) {
        folders.set(folderKey, new Map());
        folderMeta.set(folderKey, { hasFolder: entry.hasFolder });
      }
      const projMap = folders.get(folderKey)!;
      if (!projMap.has(entry.project)) projMap.set(entry.project, new Map());
      const sceneMap = projMap.get(entry.project)!;
      const sceneId = entry.sceneKey ?? `__no_key__${entry.taskId}`;
      const existing = sceneMap.get(sceneId);
      if (existing) {
        existing.done += entry.done;
        existing.total += entry.originalTotal;
        existing.taskIds.push(entry.taskId);
        if (entry.priority) existing.isPriority = true;
      } else {
        sceneMap.set(sceneId, {
          sceneKey: entry.sceneKey,
          sceneName: entry.sceneName,
          emoji: entry.emoji,
          done: entry.done,
          total: entry.originalTotal,
          taskIds: [entry.taskId],
          isPriority: entry.priority,
        });
      }
    }
    const result: FolderNode[] = [];
    for (const [folderKey, projMap] of folders) {
      const projects: ProjectNode[] = [];
      let folderDone = 0;
      let folderTotal = 0;
      let folderProcessing = false;
      for (const [projName, sceneMap] of projMap) {
        const scenes = Array.from(sceneMap.values());
        let projDone = 0;
        let projTotal = 0;
        let projProcessing = false;
        for (const s of scenes) {
          projDone += s.done;
          projTotal += s.total;
          if (currentKey && s.sceneKey === currentKey) projProcessing = true;
        }
        projects.push({
          name: projName,
          scenes,
          done: projDone,
          total: projTotal,
          isProcessing: projProcessing,
        });
        folderDone += projDone;
        folderTotal += projTotal;
        if (projProcessing) folderProcessing = true;
      }
      result.push({
        name: folderKey,
        hasFolder: folderMeta.get(folderKey)!.hasFolder,
        projects,
        done: folderDone,
        total: folderTotal,
        isProcessing: folderProcessing,
      });
    }
    // 폴더 없음 묶음은 마지막에 배치 (시각적 구분)
    result.sort((a, b) => {
      if (a.hasFolder !== b.hasFolder) return a.hasFolder ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return result;
  };

  // 우선순위 vs 일반 두 섹션 — 한 씬에 같은 task가 두 priority 모두면 (드물지만) 두 섹션 모두 표시.
  // task 단위 priority라 entry 단위 분리 자연스러움.
  const { priorityTree, normalTree } = useMemo(() => {
    const entries = Array.from(seenTasksRef.current.values());
    const pri = entries.filter((e) => e.priority);
    const nor = entries.filter((e) => !e.priority);
    return {
      priorityTree: buildTree(pri),
      normalTree: buildTree(nor),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, currentKey]);

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const chevron = (open: boolean) => (
    <span className="flex-none text-xs text-gray-500 dark:text-gray-300 w-3 inline-block">
      {open ? '▼' : '▶'}
    </span>
  );

  const onTogglePriority = (taskIds: string[], next: boolean) => {
    taskQueueService.prioritizeTasks(taskIds, next).catch(() => {
      // 실패는 prioritizeTasks 내부에서 restoreMirroredState로 복원. 토스트는 안 띄움.
    });
  };

  // 트리 한 섹션 렌더. priority/normal 두 번 호출되니 keyPrefix로 expand state 충돌 회피.
  const renderTree = (treeNodes: FolderNode[], keyPrefix: string) =>
    treeNodes.map((folder) => {
      const fKey = `${keyPrefix}f:${folder.name}`;
      const fOpen = expanded.has(fKey);
      return (
        <div key={fKey} className="min-w-0">
          <div
            className={
              'flex items-center gap-2 px-2.5 py-2 mx-1 mt-1 rounded-md cursor-pointer min-w-0 ' +
              (folder.isProcessing
                ? 'scene-processing-list'
                : 'border border-gray-300 dark:border-slate-500')
            }
            onClick={() => toggle(fKey)}
          >
            {chevron(fOpen)}
            <div className="flex-none text-base">📁</div>
            <div className="flex-1 min-w-0 truncate text-default text-sm md:text-base leading-tight font-medium">
              {folder.name}
            </div>
            <div className="flex-none ml-auto px-2 py-0.5 bg-gray-300/70 dark:bg-slate-500/70 dark:text-white rounded font-medium text-xs md:text-sm text-gray-700 dark:text-gray-100">
              {folder.done}/{folder.total}
            </div>
          </div>
          {fOpen &&
            folder.projects.map((proj, pIdx) => {
              const pKey = `${keyPrefix}p:${folder.name}/${proj.name}`;
              const pOpen = expanded.has(pKey);
              const isPLast = pIdx === folder.projects.length - 1;
              return (
                <div key={pKey} className="min-w-0">
                  <div className="flex items-center gap-0 mt-0.5 ml-3 min-w-0">
                    <span className="flex-none text-gray-400 dark:text-gray-500 text-sm font-mono w-3.5 inline-block">
                      {isPLast ? '└' : '├'}
                    </span>
                    <div
                      className={
                        'flex flex-1 min-w-0 items-center gap-1.5 px-2 py-1.5 mr-1 rounded-md cursor-pointer ' +
                        (proj.isProcessing
                          ? 'scene-processing-list'
                          : 'border border-gray-200 dark:border-slate-600')
                      }
                      onClick={() => toggle(pKey)}
                    >
                      {chevron(pOpen)}
                      <div className="flex-1 min-w-0 truncate text-default text-sm leading-tight">
                        {proj.name}
                      </div>
                      <div className="flex-none ml-auto px-2 py-0.5 bg-gray-200/70 dark:bg-slate-600/70 dark:text-white rounded font-medium text-xs text-gray-700 dark:text-gray-100">
                        {proj.done}/{proj.total}
                      </div>
                    </div>
                  </div>
                  {pOpen &&
                    proj.scenes.map((s, sIdx) => {
                      const isSLast = sIdx === proj.scenes.length - 1;
                      const isProcessing =
                        !!currentKey && s.sceneKey === currentKey;
                      const sceneBoxClass = isProcessing
                        ? 'flex flex-1 min-w-0 items-center gap-1.5 px-2 py-1.5 mr-1 rounded-md scene-processing-list'
                        : 'flex flex-1 min-w-0 items-center gap-1.5 px-2 py-1.5 mr-1 rounded-md border border-gray-200 dark:border-slate-600';
                      return (
                        <div
                          key={sIdx}
                          className="flex items-center gap-0 mt-0.5 ml-7 min-w-0"
                        >
                          <span className="flex-none text-gray-400 dark:text-gray-500 text-sm font-mono w-3.5 inline-block">
                            {isSLast ? '└' : '├'}
                          </span>
                          <div className={sceneBoxClass}>
                            <div className="flex-none text-sm">{s.emoji}</div>
                            <div className="flex-1 min-w-0 truncate text-default text-sm leading-tight">
                              <span className="font-medium">{s.sceneName}</span>
                            </div>
                            <button
                              className="flex-none ml-1 p-0.5 text-amber-500 dark:text-amber-400 hover:scale-110 transition-transform"
                              onClick={(e) => {
                                e.stopPropagation();
                                onTogglePriority(s.taskIds, !s.isPriority);
                              }}
                              title={s.isPriority ? '우선순위 해제' : '우선순위로 이동'}
                            >
                              {s.isPriority ? <FaStar size={12} /> : <FaRegStar size={12} />}
                            </button>
                            <div className="flex-none ml-auto px-2 py-0.5 bg-gray-200/70 dark:bg-slate-600/70 dark:text-white rounded font-medium text-xs text-gray-700 dark:text-gray-100">
                              {s.done}/{s.total}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                </div>
              );
            })}
        </div>
      );
    });

  return (
    // 하단바 위에 정확히 붙음 — bottom-full로 부모(pill) 바로 위. 부모는 relative 필수.
    // 클릭 stopPropagation으로 펴고 접기 안에서 toggle close 안 되게 차단.
    // 본인 페인 (2026-05-17): UI 너무 컸음 → 폴더 row 컴팩트 + 4개 정도 default 보임 + 세로 스크롤.
    //   반투명 + rounded. 트리 연결은 ㄴ unicode 사용.
    <div
      className="absolute bottom-full right-0 mb-2 bg-white/65 dark:bg-slate-700/65 backdrop-blur-md w-60 md:w-96 z-20 shadow-lg rounded-xl flex flex-col overflow-hidden max-h-[260px] md:max-h-[320px]"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        className="ml-auto mt-1 mr-1.5 text-gray-500 hover:text-gray-700 flex-none"
        onClick={() => {
          onClose?.();
        }}
      >
        <FaTimes size={18} />
      </button>
      {/* scroll fix: 옛 'flex-1 overflow-hidden > h-full overflow-y-auto' 조합은
          flex item 자체에 h 없어서 grandchild의 h-full이 ignored → scroll 안 됨.
          한 단계 합쳐 flex-1 자체에 overflow-y-auto. */}
      {/* overflow-x-hidden + 자식 truncate flex item에 min-w-0 필수 — flex 기본
          min-width:auto면 intrinsic content가 row 폭을 밀어내서 가로 스크롤 발생. */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain pb-2 px-1 min-h-0">
        {priorityTree.length > 0 && (
          <>
            <div className="flex items-center gap-2 mt-1 px-2">
              <FaStar size={11} className="text-amber-500 dark:text-amber-400 flex-none" />
              <span className="text-xs font-semibold text-amber-700 dark:text-amber-300 flex-none">
                우선순위 큐
              </span>
              <span className="flex-1 border-t border-amber-400/60 dark:border-amber-500/50 ml-1" />
            </div>
            {renderTree(priorityTree, 'pri:')}
            <div className="flex items-center gap-2 mt-3 px-2">
              <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 flex-none">
                일반 큐
              </span>
              <span className="flex-1 border-t border-gray-400/60 dark:border-slate-500 ml-1" />
            </div>
          </>
        )}
        {renderTree(normalTree, 'nor:')}
      </div>
    </div>
  );
});

const TaskQueueControl = observer(() => {
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
        {showList && (
          <TaskQueueList
            onClose={() => {
              setShowList(false);
            }}
          />
        )}
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
export const TaskQueueProgress = observer(() => {
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
    <div
      className="relative cursor-pointer hover:brightness-95 active:brightness-90"
      onClick={() => { setShowList(!showList); }}
    >
      {showList && (
        <TaskQueueList onClose={() => { setShowList(false); }} />
      )}
      <TaskProgressBar />
    </div>
  );
});

export const TaskQueueControls = observer(() => {
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
