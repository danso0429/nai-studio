import type { Backend } from '../../backend';
import type { ImageService } from '../ImageService';
import type { PromptService } from '../PromptService';
import type { SamplingPresetService } from '../SamplingPresetService';
import type { TaskQueueService } from '../TaskQueueService';
import type { GenericScene, Session } from '../types';
import type { WorkFlowService } from './WorkFlowService';

interface WorkflowRuntime {
  backend: Backend;
  imageService: ImageService;
  localAIService: { ready: boolean };
  promptService: PromptService;
  samplingPresetService: SamplingPresetService;
  taskQueueService: TaskQueueService;
  workFlowService: WorkFlowService;
  queueI2IWorkflow(
    session: Session,
    type: string,
    preset: any,
    scene: GenericScene,
    samples: number,
    onComplete?: (path: string) => void,
  ): Promise<void>;
}

let workflowRuntime: WorkflowRuntime | undefined;

export function installWorkflowRuntime(runtime: WorkflowRuntime): void {
  if (workflowRuntime && workflowRuntime !== runtime) {
    throw new Error('Workflow runtime is already installed');
  }
  workflowRuntime = runtime;
}

export function requireWorkflowRuntime(): WorkflowRuntime {
  if (!workflowRuntime) throw new Error('Workflow runtime is not installed');
  return workflowRuntime;
}
