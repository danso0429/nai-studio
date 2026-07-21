import { appState } from './AppService';
import { sessionService, taskQueueService } from '.';
import {
  queueI2IWorkflow,
  queueMirrorWorkflow,
  queueWorkflow,
} from './TaskQueueService';
import { GenericScene, InpaintScene, Session } from './types';

export async function queueScene(
  session: Session,
  scene: GenericScene,
  samples: number,
): Promise<void> {
  if (scene.type === 'scene') {
    await queueWorkflow(session, session.selectedWorkflow!, scene, samples);
    return;
  }
  const inpaint = scene as InpaintScene;
  if (inpaint.workflowType === 'SDMirror') {
    await queueMirrorWorkflow(
      session,
      inpaint.workflowType,
      inpaint.preset,
      inpaint,
      samples,
    );
  } else {
    await queueI2IWorkflow(
      session,
      inpaint.workflowType,
      inpaint.preset,
      inpaint,
      samples,
    );
  }
}

async function askVibeEncoding(missCount: number): Promise<boolean> {
  return new Promise((resolve) => {
    appState.pushDialog({
      type: 'confirm',
      text: `예약 등록 과정에서 바이브 이미지 ${missCount}개를 새로 인코딩합니다. 계속할까요?`,
      callback: () => resolve(true),
      onCancel: () => resolve(false),
    });
  });
}

export async function queueProjectsForGeneration(
  projectNames: string[],
  samples: number,
  onProgress?: (done: number, total: number, current: string) => void,
): Promise<{ queuedScenes: number; failedProjects: string[] }> {
  let queuedScenes = 0;
  const failedProjects: string[] = [];
  let done = 0;
  for (const name of projectNames) {
    onProgress?.(done, projectNames.length, name);
    try {
      const session = await sessionService.get(name);
      if (!session) throw new Error('프로젝트를 불러올 수 없습니다.');
      const scenes = session.getScenes('scene');
      const useBatch =
        appState.useBatchEnqueue &&
        session.selectedWorkflow?.workflowType === 'SDImageGen';
      if (useBatch) taskQueueService.beginBatchCollect();
      let failed = false;
      for (const scene of scenes) {
        try {
          await queueScene(session, scene, samples);
          queuedScenes += 1;
        } catch {
          failed = true;
        }
      }
      if (useBatch) {
        try {
          await taskQueueService.flushBatchCollect(askVibeEncoding);
        } catch {
          failed = true;
        }
      }
      if (failed) failedProjects.push(name);
    } catch {
      failedProjects.push(name);
    }
    done += 1;
    onProgress?.(done, projectNames.length, name);
  }
  return { queuedScenes, failedProjects };
}
