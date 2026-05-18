import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
  sceneKey: string;
  sceneName: string;
  emoji: string;
  done: number;
  total: number;
  taskIds: string[];
  isPriority: boolean;
};
type ProjectNode = {
  name: string;
  scenes: SceneNode[]; // snapshot 살아있는 씬만 (vanish 끝난 씬은 빠짐)
  done: number;
  total: number;
  isProcessing: boolean;
  isPriority: boolean; // 자식 씬 중 하나라도 priority면 true (toggle 시 모든 active task 적용)
  allTaskIds: string[]; // 프로젝트 우선순위 toggle 시 보낼 모든 active task ID
};
type FolderNode = {
  name: string;
  hasFolder: boolean;
  projects: ProjectNode[];
  done: number;
  total: number;
  isProcessing: boolean;
};

const NO_FOLDER_KEY = '(폴더 없음)';
const VANISH_DELAY_MS = 2000;

// 본인 spec (2026-05-17 최종): 카운터 vanish는 task 단위 X, 레벨 단위 (씬/프로젝트/폴더).
// - 씬: done==originalTotal 도달 시 2초 후 씬 row 통째 사라짐. 그 사이 14/14 유지.
// - 프로젝트: 자식 씬이 사라져도 프로젝트의 originalTotal은 누적 유지. 프로젝트 자체가
//   done==originalTotal 도달 시 2초 후 프로젝트 통째 사라짐.
// - 폴더도 동일.
// 각 레벨 snapshot이 독립적 — 자식이 사라져도 부모 카운트 그대로.
//
// task 단위 메타는 TaskCommit에 sealed. 첫 등록 시 originalTotal/identity 박히고
// lifecycle 동안 maxDoneSeen(단조증가)과 priority/active만 갱신. snapshot은 매 sync마다
// commits로부터 derive (clear-and-rebuild) — completedAt만 영속해서 vanish 타이밍 유지.
// 옛 delta-only tracker 모델은 restoreMirroredState가 task.done=0 reset / task.total 변경
// 시키면 분자 음수 delta / 분모 불일치 발생 (본인 페인 2026-05-18). commit-based로 v1.7.1 교체.
type TaskCommit = {
  taskId: string;
  sceneKey: string;
  projectKey: string;
  folderKey: string;
  emoji: string;
  sceneName: string;
  projectName: string;
  folderName: string;
  hasFolder: boolean;
  originalTotal: number;   // 첫 등록 시 task.total. restore로 task object 교체돼도 불변.
  maxDoneSeen: number;     // 단조증가. task.done이 0 reset돼도 max로 보호.
  priority: boolean;       // 매 sync 최신화 (placeholder restore가 바꿔도 따라감).
  active: boolean;         // mirroredTasks/queue에 살아있나. priority toggle 대상 판별.
  // 각 레벨 합산 참여 여부 — vanish 시 해당만 false 박음 (다른 레벨엔 기여 유지).
  sceneVisible: boolean;
  projectVisible: boolean;
  folderVisible: boolean;
};
type SceneSnap = {
  sceneKey: string;
  sceneName: string;
  emoji: string;
  project: string;
  folder: string;
  hasFolder: boolean;
  originalTotal: number; // 모든 task original 합산, 누적만 (자식 사라져도 안 줄음)
  done: number;          // 완료 잡 누적, 누적만
  completedAt?: number;  // done >= originalTotal 도달 시각 (vanish 타이머 시작)
  taskIds: Set<string>;  // 우선순위 toggle 시 보낼 ID
  isPriority: boolean;
};
type ProjectSnap = {
  key: string;
  name: string;
  folder: string;
  hasFolder: boolean;
  originalTotal: number;
  done: number;
  completedAt?: number;
};
type FolderSnap = {
  key: string;
  name: string;
  hasFolder: boolean;
  // priority/normal 분리 누적. 같은 폴더 안 두 프로젝트가 priority 다를 때
  // 폴더 row 카운터가 트리별로 분리돼야 함 (예: 우선 0/8 + 일반 0/16).
  priorityTotal: number;
  priorityDone: number;
  normalTotal: number;
  normalDone: number;
  completedAt?: number;
};

// anchor: pill DOM. 옛 popup은 pill의 relative 안 absolute였는데, FloatView(scene/image)
// 와 stacking context 충돌로 X 클릭이 안 먹는 회귀 — 본인 보고 (2026-05-17).
// 해결: popup을 portal로 document.body에 직접 렌더 + position: fixed + pill rect 기반 좌표.
const TaskQueueList = observer(({ onClose, anchor }: { onClose?: () => void; anchor: HTMLElement | null }) => {
  const taskCommitsRef = useRef<Map<string, TaskCommit>>(new Map());
  const sceneSnapsRef = useRef<Map<string, SceneSnap>>(new Map());
  const projectSnapsRef = useRef<Map<string, ProjectSnap>>(new Map());
  const folderSnapsRef = useRef<Map<string, FolderSnap>>(new Map());
  // expand 상태: 폴더는 `f:{name}`, 프로젝트는 `p:{name}`. 본인이 직접 toggle.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // 렌더 강제 트리거용 카운터.
  const [tick, rerender] = useState(0);

  const projKey = (folder: string, project: string) => folder + '\0' + project;

  const syncFromService = () => {
    const commits = taskCommitsRef.current;
    const scenes = sceneSnapsRef.current;
    const projects = projectSnapsRef.current;
    const folders = folderSnapsRef.current;
    const current = new Map<string, Task>();
    for (const t of taskQueueService.queue) {
      if (t && t.id) current.set(t.id, t);
    }
    for (const [id, t] of taskQueueService.mirroredTasks) {
      current.set(id, t);
    }

    // 1) commit 갱신 — 새 task는 sealed로 박고, 기존은 maxDoneSeen 단조증가 + priority/active 최신화.
    for (const [taskId, task] of current) {
      let commit = commits.get(taskId);
      if (!commit) {
        const { folder, project, scene } = taskDisplay(task);
        const sk = taskSceneKey(task) ?? `__no_key__${taskId}`;
        const fKey = folder || NO_FOLDER_KEY;
        const pKey = projKey(fKey, project);
        commit = {
          taskId,
          sceneKey: sk,
          projectKey: pKey,
          folderKey: fKey,
          emoji: taskQueueService.getTaskInfo(task).emoji,
          sceneName: scene,
          projectName: project,
          folderName: fKey,
          hasFolder: !!folder,
          originalTotal: task.total,
          maxDoneSeen: task.done,
          priority: !!task.priority,
          active: true,
          sceneVisible: true,
          projectVisible: true,
          folderVisible: true,
        };
        commits.set(taskId, commit);
      } else {
        if (task.done > commit.maxDoneSeen) commit.maxDoneSeen = task.done;
        commit.priority = !!task.priority;
        commit.active = true;
        // rejection 보정: 첫 등록 직후 queueAddBatch에서 일부 rejected (큐 1000잡 한계 초과)
        // 되면 task.total -= rejected. originalTotal은 보통 sealed이지만 이 경우만 down-adjust.
        // restore placeholder의 task.total=jobs.length(잡 완료된 task)와 구별:
        //   rejection은 maxDoneSeen=0 시점에 일어남, restore는 maxDoneSeen>task.total 가능.
        if (task.total < commit.originalTotal && commit.maxDoneSeen <= task.total) {
          commit.originalTotal = task.total;
        }
      }
    }

    // 2) current에 없는 commit — task가 큐에서 사라졌으니 active 해제 + 남은 잡 done 자동 마이그.
    //    vanish 처리는 별도 (snap completedAt → vanishTimer). 여기선 카운트 단조성만 보장.
    for (const commit of commits.values()) {
      if (!current.has(commit.taskId) && commit.active) {
        commit.active = false;
        commit.maxDoneSeen = commit.originalTotal;
      }
    }

    // 3) snap rebuild — completedAt만 기존 값 보존, 나머지 commits로 derive (clear-and-rebuild).
    //    *Visible=true commit만 해당 레벨 합산에 참여 — vanish poll에서 레벨별 false 박음.
    const oldScenes = new Map(scenes);
    const oldProjects = new Map(projects);
    const oldFolders = new Map(folders);
    scenes.clear();
    projects.clear();
    folders.clear();

    for (const commit of commits.values()) {
      if (commit.sceneVisible) {
        let sc = scenes.get(commit.sceneKey);
        if (!sc) {
          const old = oldScenes.get(commit.sceneKey);
          sc = {
            sceneKey: commit.sceneKey,
            sceneName: commit.sceneName,
            emoji: commit.emoji,
            project: commit.projectName,
            folder: commit.folderName === NO_FOLDER_KEY ? '' : commit.folderName,
            hasFolder: commit.hasFolder,
            originalTotal: 0,
            done: 0,
            completedAt: old?.completedAt,
            taskIds: new Set<string>(),
            isPriority: false,
          };
          scenes.set(commit.sceneKey, sc);
        }
        sc.originalTotal += commit.originalTotal;
        sc.done += commit.maxDoneSeen;
        // priority toggle 대상은 active commit만. vanished/inactive는 의미 없음.
        if (commit.active) {
          sc.taskIds.add(commit.taskId);
          if (commit.priority) sc.isPriority = true;
        }
      }
      if (commit.projectVisible) {
        let pr = projects.get(commit.projectKey);
        if (!pr) {
          const old = oldProjects.get(commit.projectKey);
          pr = {
            key: commit.projectKey,
            name: commit.projectName,
            folder: commit.folderName === NO_FOLDER_KEY ? '' : commit.folderName,
            hasFolder: commit.hasFolder,
            originalTotal: 0,
            done: 0,
            completedAt: old?.completedAt,
          };
          projects.set(commit.projectKey, pr);
        }
        pr.originalTotal += commit.originalTotal;
        pr.done += commit.maxDoneSeen;
      }
      if (commit.folderVisible) {
        let fo = folders.get(commit.folderKey);
        if (!fo) {
          const old = oldFolders.get(commit.folderKey);
          fo = {
            key: commit.folderKey,
            name: commit.folderName,
            hasFolder: commit.hasFolder,
            priorityTotal: 0,
            priorityDone: 0,
            normalTotal: 0,
            normalDone: 0,
            completedAt: old?.completedAt,
          };
          folders.set(commit.folderKey, fo);
        }
        // priority/normal slot 분기는 commit.priority 기준 — 매 rebuild라 toggle 자동 반영.
        if (commit.priority) {
          fo.priorityTotal += commit.originalTotal;
          fo.priorityDone += commit.maxDoneSeen;
        } else {
          fo.normalTotal += commit.originalTotal;
          fo.normalDone += commit.maxDoneSeen;
        }
      }
    }

    // 4) completedAt 마킹/부활. done>=total 도달 시 now 박고, 부활 시 무효화.
    const now = Date.now();
    for (const sc of scenes.values()) {
      if (sc.done >= sc.originalTotal && !sc.completedAt) sc.completedAt = now;
      else if (sc.done < sc.originalTotal && sc.completedAt) sc.completedAt = undefined;
    }
    for (const pr of projects.values()) {
      if (pr.done >= pr.originalTotal && !pr.completedAt) pr.completedAt = now;
      else if (pr.done < pr.originalTotal && pr.completedAt) pr.completedAt = undefined;
    }
    for (const fo of folders.values()) {
      const done = fo.priorityDone >= fo.priorityTotal && fo.normalDone >= fo.normalTotal;
      if (done && !fo.completedAt) fo.completedAt = now;
      else if (!done && fo.completedAt) fo.completedAt = undefined;
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
    // vanish 타이머 — 각 레벨 별로 completedAt + delay 지나면 snap 제거 +
    // commit의 그 레벨 visibility 해제. 다른 레벨 합산엔 commit이 그대로 기여 (씬 vanish해도
    // 프로젝트/폴더 카운트 유지 spec). 모든 visibility false면 commit 자체 정리 (메모리).
    const vanishTimer = setInterval(() => {
      const now = Date.now();
      const commits = taskCommitsRef.current;
      let changed = false;
      for (const [k, sc] of sceneSnapsRef.current) {
        if (sc.completedAt && now - sc.completedAt > VANISH_DELAY_MS) {
          sceneSnapsRef.current.delete(k);
          for (const c of commits.values()) if (c.sceneKey === k) c.sceneVisible = false;
          changed = true;
        }
      }
      for (const [k, pr] of projectSnapsRef.current) {
        if (pr.completedAt && now - pr.completedAt > VANISH_DELAY_MS) {
          projectSnapsRef.current.delete(k);
          for (const c of commits.values()) if (c.projectKey === k) c.projectVisible = false;
          changed = true;
        }
      }
      for (const [k, fo] of folderSnapsRef.current) {
        if (fo.completedAt && now - fo.completedAt > VANISH_DELAY_MS) {
          folderSnapsRef.current.delete(k);
          for (const c of commits.values()) if (c.folderKey === k) c.folderVisible = false;
          changed = true;
        }
      }
      if (changed) {
        for (const [tid, c] of Array.from(commits)) {
          if (!c.sceneVisible && !c.projectVisible && !c.folderVisible) commits.delete(tid);
        }
        rerender((n) => n + 1);
      }
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

  // 트리 빌드 — snapshot Map에서 직접 빌드. 씬/프로젝트/폴더 카운트는 각자 snapshot 사용
  // (자식이 사라져도 부모 카운트 유지). priority 필터에 따라 두 트리 분리.
  const buildTree = (priorityFilter: boolean): FolderNode[] => {
    const folderProjects = new Map<string, ProjectNode[]>();
    // 모든 살아있는 씬 → 자기 프로젝트 묶음에. priority 필터로 분리.
    const scenesByProjKey = new Map<string, SceneSnap[]>();
    for (const sc of sceneSnapsRef.current.values()) {
      if (sc.isPriority !== priorityFilter) continue;
      const pkey = (sc.folder || NO_FOLDER_KEY) + '\0' + sc.project;
      if (!scenesByProjKey.has(pkey)) scenesByProjKey.set(pkey, []);
      scenesByProjKey.get(pkey)!.push(sc);
    }
    // 프로젝트별 우선순위 toggle용 — 활성 task ID 모음 (모든 자식 씬의 active tasks).
    // 자식 씬이 vanish해도 task는 이미 끝났으니 toggle 의미 없음 → 살아있는 씬 기준.
    for (const pr of projectSnapsRef.current.values()) {
      const pkey = (pr.folder || NO_FOLDER_KEY) + '\0' + pr.name;
      const scenes = scenesByProjKey.get(pkey) ?? [];
      if (scenes.length === 0 && !pr.completedAt) continue; // 자식 살아있는 씬 없고 프로젝트만 남으면 priorityFilter 분리 의미 없음 (어느 쪽?). 일단 normal로 떨어짐.
      // 프로젝트가 어느 섹션에 갈지 — 자식 씬 priority에 따라
      const anyPri = scenes.some((s) => s.isPriority);
      // 이 트리는 priorityFilter 섹션 — 자식 매칭 안 되면 skip
      if (anyPri !== priorityFilter && scenes.length > 0) continue;
      if (scenes.length === 0) {
        // 자식 씬 다 vanish됐는데 프로젝트는 살아있음. priorityFilter 둘 다 안 매칭 → normal에만 보임.
        if (priorityFilter) continue;
      }
      // 자식 활성 task IDs 수집
      const allTaskIds: string[] = [];
      for (const sc of scenes) {
        for (const tid of sc.taskIds) allTaskIds.push(tid);
      }
      let projProcessing = false;
      const sceneNodes: SceneNode[] = scenes.map((sc) => {
        const proc = !!currentKey && sc.sceneKey === currentKey;
        if (proc) projProcessing = true;
        return {
          sceneKey: sc.sceneKey,
          sceneName: sc.sceneName,
          emoji: sc.emoji,
          done: sc.done,
          total: sc.originalTotal,
          taskIds: Array.from(sc.taskIds),
          isPriority: sc.isPriority,
        };
      });
      const fKey = pr.folder || NO_FOLDER_KEY;
      if (!folderProjects.has(fKey)) folderProjects.set(fKey, []);
      folderProjects.get(fKey)!.push({
        name: pr.name,
        scenes: sceneNodes,
        done: pr.done,
        total: pr.originalTotal,
        isProcessing: projProcessing,
        isPriority: anyPri,
        allTaskIds,
      });
    }
    // 폴더 빌드. 카운터는 priorityFilter 슬롯 사용 — 같은 폴더 안 두 프로젝트가
    // priority 다를 때 우선/일반 트리에 각각 분리 카운터 (예: 우선 0/8 / 일반 0/16).
    const result: FolderNode[] = [];
    for (const fo of folderSnapsRef.current.values()) {
      const projs = folderProjects.get(fo.key) ?? [];
      const folderDone = priorityFilter ? fo.priorityDone : fo.normalDone;
      const folderTotal = priorityFilter ? fo.priorityTotal : fo.normalTotal;
      // 이 트리 슬롯에 누적 0이면 폴더 자체를 표시 X
      if (folderTotal === 0) continue;
      // 자식 프로젝트가 priorityFilter 섹션에 매칭 안 되면 폴더도 skip
      if (projs.length === 0) {
        // 폴더 snapshot만 살아있고 자식이 다 vanish — normal에만 표시
        if (priorityFilter) continue;
      }
      result.push({
        name: fo.name,
        hasFolder: fo.hasFolder,
        projects: projs,
        done: folderDone,
        total: folderTotal,
        isProcessing: projs.some((p) => p.isProcessing),
      });
    }
    // 폴더 없음 묶음은 마지막에 배치
    result.sort((a, b) => {
      if (a.hasFolder !== b.hasFolder) return a.hasFolder ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return result;
  };

  const { priorityTree, normalTree } = useMemo(() => {
    return {
      priorityTree: buildTree(true),
      normalTree: buildTree(false),
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
                      {proj.allTaskIds.length > 0 && (
                        <button
                          className="flex-none ml-1 p-0.5 text-amber-500 dark:text-amber-400 hover:scale-110 transition-transform"
                          onClick={(e) => {
                            e.stopPropagation();
                            onTogglePriority(proj.allTaskIds, !proj.isPriority);
                          }}
                          title={proj.isPriority ? '프로젝트 우선순위 해제' : '프로젝트 우선순위로 이동'}
                        >
                          {proj.isPriority ? <FaStar size={12} /> : <FaRegStar size={12} />}
                        </button>
                      )}
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

  // anchor(pill) rect 추적해 fixed 좌표 갱신. window resize/scroll/visible 변화 대응.
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  useLayoutEffect(() => {
    if (!anchor) {
      setAnchorRect(null);
      return;
    }
    const update = () => setAnchorRect(anchor.getBoundingClientRect());
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    const ro = new ResizeObserver(update);
    ro.observe(anchor);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      ro.disconnect();
    };
  }, [anchor]);

  if (!anchorRect) return null;
  const styleFixed: React.CSSProperties = {
    position: 'fixed',
    bottom: window.innerHeight - anchorRect.top + 8,
    right: window.innerWidth - anchorRect.right,
    zIndex: 100,
  };

  return createPortal(
    <div
      className="bg-white dark:bg-slate-700 w-60 md:w-96 shadow-lg rounded-xl flex flex-col overflow-hidden max-h-[260px] md:max-h-[320px]"
      style={styleFixed}
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
    </div>,
    document.body,
  );
});

const TaskQueueControl = observer(() => {
  const [_, rerender] = useState<{}>({});
  const [showList, setShowList] = useState(false);
  const pillRef = useRef<HTMLDivElement>(null);
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
        ref={pillRef}
        className="relative cursor-pointer hover:brightness-95 active:brightness-90"
        onClick={() => {
          setShowList(!showList);
        }}
      >
        {showList && (
          <TaskQueueList
            anchor={pillRef.current}
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
  const pillRef = useRef<HTMLDivElement>(null);
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
      ref={pillRef}
      className="relative cursor-pointer hover:brightness-95 active:brightness-90"
      onClick={() => { setShowList(!showList); }}
    >
      {showList && (
        <TaskQueueList anchor={pillRef.current} onClose={() => { setShowList(false); }} />
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
