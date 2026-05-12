import { v4 } from 'uuid';
import {
  CharacterReference,
  convertResolution,
  ImageAugmentInput,
  ImageGenInput,
  Model,
  ModelVersion,
  NoiseSchedule,
  Resolution,
  Sampling,
} from '../backends/imageGen';
import { CircularQueue } from '../circularQueue';
import {
  backend,
  imageService,
  isMobile,
  localAIService,
  promptService,
  sessionService,
  taskQueueService,
  workFlowService,
} from '.';
import {
  AbstractJob,
  AugmentJob,
  GenericScene,
  InpaintScene,
  Job,
  PromptNode,
  Scene,
  SDAbstractJob,
  SDI2IJob,
  SDInpaintJob,
  SelectedWorkflow,
  Session,
} from './types';
import { sleep } from './util';
import { expandPieces, lowerPromptNode, toPARR } from './PromptService';
import { dataUriToBase64 } from './ImageService';
import { prepareMirrorCanvas } from './workflows/SDWorkFlow';
import { getImageDimensions } from '../componenets/BrushTool';
import { QueueJobMeta } from '../backend';

const FAST_TASK_TIME_ESTIMATOR_SAMPLE_COUNT = 16;
const TASK_TIME_ESTIMATOR_SAMPLE_COUNT = 128;
const TASK_DEFAULT_ESTIMATE = 22 * 1000;
const RANDOM_DELAY_BIAS = 6.0;
const RANDOM_DELAY_STD = 3.0;
const LARGE_RANDOM_DELAY_BIAS = RANDOM_DELAY_BIAS * 2;
const LARGE_RANDOM_DELAY_STD = RANDOM_DELAY_STD * 2;
const LARGE_WAIT_DELAY_BIAS = 5 * 60;
const LARGE_WAIT_DELAY_STD = 2.5 * 60;
const LARGE_WAIT_INTERVAL_BIAS = 500;
const LARGE_WAIT_INTERVAL_STD = 100;
const FAST_TASK_DEFAULT_ESTIMATE =
  TASK_DEFAULT_ESTIMATE -
  RANDOM_DELAY_BIAS * 1000 -
  (RANDOM_DELAY_STD * 1000) / 2 +
  1000;

export interface TaskParam {
  session: Session;
  job: Job;
  outputPath: string;
  scene: GenericScene;
  onComplete?: (path: string) => void;
  nodelay?: boolean;
}

export interface Task {
  id: string | undefined;
  cls: number;
  params: TaskParam;
  done: number;
  total: number;
}

function getRandomInt(min: number, max: number): number {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min)) + min;
}

const MOD = 2100000000;
function randomBaseSeed() {
  return getRandomInt(1, MOD);
}

function stepSeed(seed: number) {
  seed ^= seed << 13;
  seed ^= seed >> 17;
  seed ^= seed << 5;
  seed = (seed >>> 0) % MOD;
  return Math.max(1, seed);
}

// IP check function removed for performance optimization

interface TaskStats {
  done: number;
  total: number;
}

class TaskTimeEstimator {
  samples: (number | undefined)[];
  cursor: number;
  maxSamples: number;
  defaultEstimate: number;
  constructor(maxSamples: number, defaultEstimate: number) {
    this.samples = new Array(maxSamples);
    this.maxSamples = maxSamples;
    this.cursor = 0;
    this.defaultEstimate = defaultEstimate;
  }

  addSample(time: number) {
    this.samples[this.cursor] = time;
    this.cursor = (this.cursor + 1) % this.maxSamples;
  }

  estimateMedian() {
    const smp = this.samples.filter((x) => x != undefined);
    smp.sort();
    if (smp.length) return smp[smp.length >> 1]!;
    return this.defaultEstimate;
  }

  estimateMean() {
    const smp = this.samples.filter((x) => x != undefined);
    smp.sort();
    if (smp.length) return (smp.reduce((x, y) => x! + y!, 0) ?? 0) / smp.length;
    return this.defaultEstimate;
  }
}

interface TaskQueueRun {
  stopped: boolean;
  delayCnt: number;
  // 캐싱된 데이터 - 동일 세션/씬에서 재사용
  cachedVibes?: Map<string, { image: string; info: number; strength: number }>;
  cachedReferences?: Map<string, { image: string; info: number; strength: number; fidelity: number; referenceType: string; description: string }>;
  lastSessionName?: string;
}

export interface TaskInfo {
  name: string;
  emoji: string;
}

interface CostItem {
  scene: string;
  text: string;
}

interface TaskHandler {
  createTimeEstimator(): TaskTimeEstimator;
  checkTask(task: Task): boolean;
  handleTask(task: Task, run: TaskQueueRun): Promise<boolean>;
  getNumTries(task: Task): number;
  handleDelay(task: Task, numTry: number, delayTime: number): Promise<void>;
  getInfo(task: Task): TaskInfo;
  calculateCost(task: Task): CostItem[];
}

export const getSceneKey = (session: Session, scene: GenericScene) => {
  return session.name + '/' + scene.type + '/' + scene.name;
};

async function handleNAIDelay(
  numTry: number,
  fast: boolean,
  delayTime: number,
) {
  if (numTry === 0 && fast) {
    await sleep(delayTime);
  } else if (numTry <= 2 && fast) {
    await sleep((1 + Math.random() * RANDOM_DELAY_STD) * delayTime);
  } else {
    console.log('slow delay');
    if (numTry === 0 && Math.random() > 0.98) {
      await sleep(
        (Math.random() * LARGE_RANDOM_DELAY_STD + LARGE_RANDOM_DELAY_BIAS) *
          delayTime,
      );
    } else {
      await sleep(
        (Math.random() * RANDOM_DELAY_STD + RANDOM_DELAY_BIAS) * delayTime,
      );
    }
  }
  return;
}

type ImageTaskType = 'gen' | 'inpaint' | 'i2i';

const lowerResolution = (res: Resolution, width?: number, height?: number) => {
  if (res === Resolution.Custom) {
    return {
      width: width!,
      height: height!,
    };
  } else {
    return convertResolution(res);
  }
};

class GenerateImageTaskHandler implements TaskHandler {
  type: ImageTaskType;
  fast: boolean;
  constructor(fast: boolean, type: ImageTaskType) {
    this.fast = fast;
    this.type = type;
  }

  createTimeEstimator() {
    if (this.fast)
      return new TaskTimeEstimator(
        FAST_TASK_TIME_ESTIMATOR_SAMPLE_COUNT,
        FAST_TASK_DEFAULT_ESTIMATE,
      );
    else
      return new TaskTimeEstimator(
        TASK_TIME_ESTIMATOR_SAMPLE_COUNT,
        TASK_DEFAULT_ESTIMATE,
      );
  }

  async handleDelay(
    task: Task,
    numTry: number,
    delayTime: number,
  ): Promise<void> {
    await handleNAIDelay(numTry, this.fast, delayTime);
  }

  checkTask(task: Task): boolean {
    if (task.params.job.type === 'sd' && this.type === 'gen') {
      return !!task.params.nodelay == !!this.fast;
    }
    if (task.params.job.type === 'sd_inpaint' && this.type === 'inpaint') {
      return !!task.params.nodelay == !!this.fast;
    }
    if (task.params.job.type === 'sd_i2i' && this.type === 'i2i') {
      return !!task.params.nodelay == !!this.fast;
    }
    return false;
  }

  // prep + execute 분리: server-mirror 모드에서 prep만 N번 호출해 batch push 가능.
  // outputFilePath는 prep 시점 unique 보장 위해 timestamp + uuid suffix.
  async prepGenInput(
    task: Task,
    run: TaskQueueRun,
  ): Promise<{ arg: ImageGenInput; outputFilePath: string }> {
    const job: SDAbstractJob<PromptNode> = task.params
      .job as SDAbstractJob<PromptNode>;
    const config = await backend.getConfig();
    let prompt = lowerPromptNode(job.prompt!);
    console.log('lowered prompt: ' + prompt);
    const outputFilePath =
      task.params.outputPath + '/' + Date.now().toString() + '_' + v4().slice(0, 8) + '.png';
    if (prompt === '') {
      prompt = '1girl';
    }
    if (config.furryMode) {
      prompt = 'fur dataset, ' + prompt;
    }

    // 세션이 변경되면 캐시 초기화
    const currentSessionName = task.params.session.name;
    if (run.lastSessionName !== currentSessionName) {
      run.cachedVibes = new Map();
      run.cachedReferences = new Map();
      run.lastSessionName = currentSessionName;
    }

    // 캐시 초기화 (없는 경우)
    if (!run.cachedVibes) run.cachedVibes = new Map();
    if (!run.cachedReferences) run.cachedReferences = new Map();

    // 바이브 이미지 처리 - 캐싱 적용
    const vibes = await Promise.all(
      job.vibes.map(async (vibe) => {
        const cacheKey = `${vibe.path}:${vibe.info}`;
        
        // 캐시에서 먼저 확인
        if (run.cachedVibes!.has(cacheKey)) {
          const cached = run.cachedVibes!.get(cacheKey)!;
          return {
            image: cached.image,
            info: vibe.info,
            strength: vibe.strength,
          };
        }

        // 캐시에 없으면 로딩
        const isEncoded = await imageService.checkEncodedVibeImage(
          task.params.session,
          vibe.path,
          vibe.info,
        );
        if (!isEncoded) {
          await imageService.encodeVibeImage(
            task.params.session,
            vibe.path,
            vibe.info,
          );
        }
        let encoded =
          (await imageService.fetchEncodedVibeImage(
            task.params.session,
            vibe.path,
            vibe.info,
          )) || '';
        encoded = dataUriToBase64(encoded);

        // 캐시에 저장
        run.cachedVibes!.set(cacheKey, {
          image: encoded,
          info: vibe.info,
          strength: vibe.strength,
        });

        return {
          image: encoded,
          info: vibe.info,
          strength: vibe.strength,
        };
      }),
    );

    // 캐릭터 레퍼런스 이미지 처리 - 캐싱 적용
    let references: CharacterReference[] = [];
    if (job.characterReferences?.length) {
      // Filter only enabled references before fetching images
      const enabledReferences = job.characterReferences.filter(
        (ref) => ref.enabled !== false && ref.path,
      );
      const allReferences = await Promise.all(
        enabledReferences.map(async (ref): Promise<CharacterReference | null> => {
          const cacheKey = ref.path;

          // 캐시에서 먼저 확인
          if (run.cachedReferences!.has(cacheKey)) {
            const cached = run.cachedReferences!.get(cacheKey)!;
            return {
              image: cached.image,
              info: ref.info,
              strength: ref.strength ?? 0.6,
              fidelity: ref.fidelity ?? 1.0,
              referenceType: (ref.referenceType || 'character') as CharacterReference['referenceType'],
              description: ref.referenceType || 'character',
            };
          }

          try {
            const imageData = await imageService.fetchReferenceImage(
              task.params.session,
              ref.path,
            );
            if (!imageData) {
              console.warn(`Failed to fetch reference image: ${ref.path}`);
              return null;
            }
            // fetchReferenceImage returns base64 data, but it may have data URI prefix
            const rawBase64 = imageData.includes(',')
              ? dataUriToBase64(imageData)
              : imageData;

            // NAI Precise Reference 스펙: 3채널 RGB(JPEG) 필요.
            // 이미 저장 시점에 JPEG로 저장된 경우 재인코딩해도 사실상 무손실에 가깝고,
            // 기존에 RGBA PNG로 저장된 레거시 레퍼런스도 이 단계에서 변환되어 호환됨.
            // 참고: sunanakgo/NAIS2 processCharacterImage, DNT-LAB/NAIA _letterbox
            const base64Image = await imageService.reencodeReferenceForApi(
              rawBase64,
            );

            // 캐시에 저장
            run.cachedReferences!.set(cacheKey, {
              image: base64Image,
              info: ref.info,
              strength: ref.strength ?? 0.6,
              fidelity: ref.fidelity ?? 1.0,
              referenceType: ref.referenceType || 'character',
              description: ref.referenceType || 'character',
            });

            return {
              image: base64Image,
              info: ref.info,
              strength: ref.strength ?? 0.6,
              fidelity: ref.fidelity ?? 1.0,
              referenceType: (ref.referenceType || 'character') as CharacterReference['referenceType'],
              description: ref.referenceType || 'character',
            };
          } catch (e) {
            console.warn(`Error fetching reference image ${ref.path}:`, e);
            return null;
          }
        }),
      );
      // Filter out references with empty or invalid image data to prevent 500 errors
      references = allReferences.filter(
        (ref): ref is CharacterReference => ref !== null && !!ref.image && ref.image.length > 0,
      );
    }
    const resol = job.overrideResolution
      ? job.overrideResolution
      : (task.params.scene!.resolution as Resolution);

    // 모델 버전에 따른 바이브/캐릭터 레퍼런스 필터링
    const appConfig = await backend.getConfig();
    const curModelVersion = appConfig.modelVersion ?? ModelVersion.V4_5;
    const isV4 = curModelVersion === ModelVersion.V4 || curModelVersion === ModelVersion.V4Curated;
    const isV4_5 = curModelVersion === ModelVersion.V4_5 || curModelVersion === ModelVersion.V4_5Curated;

    // v4: 캐릭터 레퍼런스 미지원 → 제거
    const finalReferences = isV4 ? [] : references;
    // v4.5: 캐릭터 레퍼런스가 있으면 바이브 비활성화
    const finalVibes = (isV4_5 && finalReferences.length > 0) ? [] : vibes;
    // Phase 7A: vibe가 실제로 비활성화될 때만 알림 이벤트 발행
    if (isV4_5 && finalReferences.length > 0 && vibes.length > 0) {
      taskQueueService.dispatchEvent(new CustomEvent('vibe-locked', {
        detail: { reason: 'v4.5_with_character_reference' }
      }));
    }

    const arg: ImageGenInput = {
      prompt: prompt,
      uc: expandPieces(job.uc, task.params.session, task.params.scene),
      model: Model.Anime,
      originalImage: true,
      resolution: lowerResolution(
        resol,
        task.params.scene!.resolutionWidth,
        task.params.scene!.resolutionHeight,
      ),
      sampling: job.sampling as Sampling,
      vibes: finalVibes,
      steps: job.steps,
      cfgRescale: job.cfgRescale,
      noiseSchedule: job.noiseSchedule as NoiseSchedule,
      promptGuidance: job.promptGuidance,
      characterPrompts: [],
      characterUCs: [],
      characterPositions: [],
      useCoords: job.useCoords,
      legacyPromptConditioning: job.legacyPromptConditioning,
      normalizeStrength: job.normalizeStrength,
      varietyPlus: job.varietyPlus,
      deliberateEulerAncestralBug: job.deliberateEulerAncestralBug,
      characterReferences: finalReferences,
      outputFilePath: outputFilePath,
      seed: job.seed,
    };
    if (job.characterPrompts?.length) {
      for (const character of job.characterPrompts) {
        arg.characterPrompts?.push(lowerPromptNode(character.prompt));
        arg.characterUCs?.push(
          expandPieces(
            character.uc,
            task.params.session,
            task.params.scene,
          ),
        );
        arg.characterPositions?.push(character.position);
      }
    }
    if (this.type === 'inpaint') {
      const inpaintJob = job as SDInpaintJob;
      arg.model = Model.Inpaint;
      arg.image = inpaintJob.image;
      arg.mask = inpaintJob.mask;
      arg.originalImage = inpaintJob.originalImage;
      arg.imageStrength = inpaintJob.strength;
      arg.noise = inpaintJob.noise;
    }
    if (this.type === 'i2i') {
      const i2iJob = job as SDI2IJob;
      arg.model = Model.I2I;
      arg.image = i2iJob.image;
      arg.noise = i2iJob.noise;
      arg.originalImage = true;
      arg.imageStrength = i2iJob.strength;
    }
    // prep 끝. 다음 prep을 위해 seed 갱신 (mirror 모드도 prep N번 돌릴 때 동일 동작).
    if (job.seed) {
      job.seed = stepSeed(job.seed);
    }
    return { arg, outputFilePath };
  }

  // 이미지 생성 완료 후 처리. legacy 모드는 generateImage 직후, mirror 모드는 WS event 시점에 호출.
  afterGenComplete(task: Task, outputFilePath: string) {
    if (task.params.onComplete) {
      task.params.onComplete(outputFilePath);
    }
    if (task.params.scene != null) {
      if (task.params.scene.type === 'inpaint') {
        imageService.onAddInPaint(
          task.params.session,
          task.params.scene.name,
          outputFilePath,
        );
      } else {
        imageService.onAddImage(
          task.params.session,
          task.params.scene.name,
          outputFilePath,
        );
      }
    }
  }

  async handleTask(task: Task, run: TaskQueueRun) {
    const { arg, outputFilePath } = await this.prepGenInput(task, run);
    await backend.generateImage(arg);
    this.afterGenComplete(task, outputFilePath);
    return true;
  }

  getInfo(task: Task) {
    const title = task.params.scene ? task.params.scene.name : '(none)';
    const emojis = {
      gen: '🎨',
      inpaint: '🖌️',
      i2i: '🔄',
    };
    return {
      name: title,
      emoji: emojis[this.type],
    };
  }

  getNumTries(task: Task) {
    return 40;
  }

  calculateCost(task: Task): CostItem[] {
    const res: CostItem[] = [];
    const job: SDAbstractJob<PromptNode> = task.params
      .job as SDAbstractJob<PromptNode>;
    const name = task.params.scene.name;
    if (job.steps > 28) {
      res.push({
        scene: name,
        text: '스탭 수 28개 초과',
      });
    }
    const resolution = job.overrideResolution
      ? job.overrideResolution
      : task.params.scene.resolution;
    if (
      resolution === Resolution.WallpaperLandscape ||
      resolution === Resolution.LargeLandscape ||
      resolution === Resolution.LargePortrait ||
      resolution === Resolution.LargeSquare ||
      resolution === Resolution.WallpaperPortrait
    ) {
      res.push({
        scene: name,
        text: '씬 해상도가 큼',
      });
    } else if (resolution === Resolution.Custom) {
      const totalPixels =
        (task.params.scene.resolutionWidth ?? 0) *
        (task.params.scene.resolutionHeight ?? 0);
      if (totalPixels > 1024 * 1024) {
        res.push({
          scene: name,
          text: '씬 해상도가 큼',
        });
      }
    }
    return res;
  }
}

class RemoveBgTaskHandler implements TaskHandler {
  createTimeEstimator() {
    return new TaskTimeEstimator(
      TASK_TIME_ESTIMATOR_SAMPLE_COUNT,
      TASK_DEFAULT_ESTIMATE,
    );
  }

  async handleDelay(
    task: Task,
    numTry: number,
    delayTime: number,
  ): Promise<void> {
    return;
  }

  async handleTask(task: Task, run: TaskQueueRun) {
    const outputFilePath =
      task.params.outputPath + '/' + Date.now().toString() + '.png';
    const job = task.params.job as AugmentJob;
    await localAIService.removeBg(job.image!, outputFilePath);
    if (task.params.onComplete) task.params.onComplete(outputFilePath);
    imageService.onAddImage(
      task.params.session,
      task.params.scene!.name,
      outputFilePath,
    );
    return true;
  }

  checkTask(task: Task): boolean {
    return (
      task.params.job.type === 'augment' &&
      task.params.job.backend.type === 'SD' &&
      task.params.job.method === 'bg-removal'
    );
  }

  getNumTries(task: Task) {
    return 1;
  }

  getInfo(task: Task) {
    const title = task.params.scene ? task.params.scene.name : '(none)';
    return {
      name: title,
      emoji: '🔪',
    };
  }

  calculateCost(task: Task): CostItem[] {
    return [];
  }
}

class AugmentTaskHandler implements TaskHandler {
  createTimeEstimator() {
    return new TaskTimeEstimator(
      TASK_TIME_ESTIMATOR_SAMPLE_COUNT,
      TASK_DEFAULT_ESTIMATE,
    );
  }

  async handleDelay(
    task: Task,
    numTry: number,
    delayTime: number,
  ): Promise<void> {
    await handleNAIDelay(numTry, false, delayTime);
  }

  async handleTask(task: Task, run: TaskQueueRun) {
    const outputFilePath =
      task.params.outputPath + '/' + Date.now().toString() + '.png';
    const job = task.params.job as AugmentJob;
    let prompt = lowerPromptNode(job.prompt!);
    const params: ImageAugmentInput = {
      method: job.method,
      outputFilePath: outputFilePath,
      prompt: prompt,
      emotion: job.emotion,
      weaken: job.weaken,
      image: job.image,
    };
    await backend.augmentImage(params);
    if (task.params.onComplete) task.params.onComplete(outputFilePath);
    if (task.params.scene.type === 'inpaint') {
      imageService.onAddInPaint(
        task.params.session,
        task.params.scene.name,
        outputFilePath,
      );
    } else {
      imageService.onAddImage(
        task.params.session,
        task.params.scene.name,
        outputFilePath,
      );
    }
    return true;
  }

  checkTask(task: Task): boolean {
    return (
      task.params.job.type === 'augment' &&
      task.params.job.backend.type === 'NAI'
    );
  }

  getNumTries(task: Task) {
    return 40;
  }

  getInfo(task: Task) {
    const title = task.params.scene ? task.params.scene.name : '(none)';
    return {
      name: title,
      emoji: '🪛',
    };
  }

  calculateCost(task: Task): CostItem[] {
    const res: CostItem[] = [];
    const name = task.params.scene.name;
    const job = task.params.job as AugmentJob;
    if (job.width > 1216 || job.height > 1216) {
      res.push({
        scene: name,
        text: '해상도가 큼',
      });
    }
    if (job.method === 'bg-removal') {
      res.push({
        scene: name,
        text: 'NAI 배경 제거 기능 사용',
      });
    }
    return res;
  }
}

export interface TaskLog {
  timestamp: number;
  level: 'info' | 'warn' | 'error';
  scene: string;
  message: string;
}

const MAX_TASK_LOGS = 500;

export class TaskQueueService extends EventTarget {
  queue: CircularQueue<Task>;
  handlers: TaskHandler[];
  timeEstimators: TaskTimeEstimator[];
  groupStats: TaskStats[];
  sceneStats: { [sceneKey: string]: TaskStats };
  currentRun: TaskQueueRun | undefined;
  taskSet: { [key: string]: boolean };
  taskLogs: TaskLog[] = [];
  // server-mirror: gen/inpaint/i2i task를 batch로 서버 큐에 push하고 WS event로 동기화.
  // queue에는 안 들어감 (queue는 augment/remove-bg 등 클라 처리 task 전용).
  mirroredTasks: Map<string, Task> = new Map();
  // jobId → { taskId, outputFilePath } 매핑. WS queue-job-complete 받을 때 task 찾기 + afterGenComplete용.
  mirroredJobs: Map<string, { taskId: string; outputFilePath: string }> = new Map();
  // mirror 도중 prep 시간 측정 시작점 (시간 추정 보정용)
  private mirrorRunStartTimes: Map<string, number> = new Map();
  constructor(handlers: TaskHandler[]) {
    super();
    this.handlers = handlers;
    this.sceneStats = {};
    this.timeEstimators = [];
    this.groupStats = [];
    for (const handler of this.handlers) {
      this.timeEstimators.push(handler.createTimeEstimator());
      this.groupStats.push({ done: 0, total: 0 });
    }
    this.queue = new CircularQueue();
    this.taskSet = {};

    // WS subscribe: server-mirror 진행 동기화
    backend.onQueueJobComplete((data) => this.handleMirroredComplete(data));
    backend.onQueueJobError((data) => this.handleMirroredError(data));

    // 페이지 로드 시 서버 큐 → mirror 복원 (다른 탭 또는 이전 세션의 작업)
    this.restoreMirroredState().catch((e) => {
      console.warn('[TaskQueue] restoreMirroredState failed:', e);
    });
  }

  addLog(level: TaskLog['level'], scene: string, message: string) {
    this.taskLogs.push({ timestamp: Date.now(), level, scene, message });
    if (this.taskLogs.length > MAX_TASK_LOGS) {
      this.taskLogs.splice(0, this.taskLogs.length - MAX_TASK_LOGS);
    }
  }

  clearLogs() {
    this.taskLogs = [];
  }

  removeAllTasks() {
    while (!this.queue.isEmpty()) {
      const task = this.queue.peek();
      this.removeTaskInternal(task);
      this.queue.dequeue();
    }
    // mirror task: 서버 큐 cancel + 클라 측 mirror state 비우기
    if (this.mirroredTasks.size > 0) {
      backend.cancelQueue().catch((e) => console.warn('[TaskQueue] cancelQueue failed:', e));
      // mirror task별 stats 보정 — 남은 done/total 차이만큼 빼기 (이미 done은 ws event로 갱신된 상태)
      for (const [taskId, task] of this.mirroredTasks) {
        const remain = task.total - task.done;
        this.groupStats[task.cls].total -= remain;
        // sceneKey는 task.params에서 또는 mirroredJobs entry의 meta? — 저장 안 해서 여기선 스킵
        // sceneStats는 다음 렌더에서 음수 안 되게 정리 필요. 일단 단순 처리.
        delete this.taskSet[taskId];
      }
      this.mirroredTasks.clear();
      this.mirroredJobs.clear();
      this.mirrorRunStartTimes.clear();
    }
    this.dispatchProgress();
    this.dispatchEvent(new CustomEvent('stop', {}));
  }

  removeTasksFromScene(scene: GenericScene) {
    const oldQueue = this.queue;
    this.queue = new CircularQueue<Task>();
    while (!oldQueue.isEmpty()) {
      const task = oldQueue.peek();
      oldQueue.dequeue();
      this.removeTaskInternal(task);
      if (task.params.scene !== scene) {
        this.addTaskInternal(task);
      }
    }
    this.dispatchProgress();
  }

  addTask(params: TaskParam, numExec: number) {
    const task: Task = {
      id: v4(),
      cls: -1,
      params: params,
      done: 0,
      total: numExec,
    };
    task.cls = this.getTaskCls(task);
    const handler = this.handlers[task.cls];
    // gen/inpaint/i2i = server-mirror로. 클라 닫혀도 서버가 진행.
    if (handler instanceof GenerateImageTaskHandler) {
      this.addMirroredTask(task).catch((e) => {
        console.error('[TaskQueue] addMirroredTask failed:', e);
        this.dispatchEvent(
          new CustomEvent('error', {
            detail: { error: e?.message || String(e), task },
          }),
        );
      });
      return;
    }
    // 그 외 (augment, remove-bg) 는 기존 클라 큐
    this.addTaskInternal(task);
  }

  // gen/inpaint/i2i task를 server-mirror로 등록. prep N번 → batch push → WS event로 done 동기화.
  async addMirroredTask(task: Task) {
    const handler = this.handlers[task.cls] as GenerateImageTaskHandler;
    const taskId = task.id!;
    const sceneKey = task.params.scene
      ? getSceneKey(task.params.session, task.params.scene)
      : '';

    // 새 큐 시작이면 paused 상태로 push (사용자 run 눌러야 진행). 이미 mirror 진행 중이면
    // 그대로 추가 (기존 처리 흐름에 합류). stop 누른 후 추가도 paused 유지 (이미 paused).
    const wasEmpty = this.mirroredTasks.size === 0 && !this.currentRun;

    // mirroredTasks에 등록 + stats total 증가 (done은 WS event로 갱신)
    this.mirroredTasks.set(taskId, task);
    this.groupStats[task.cls].total += task.total;
    if (sceneKey) {
      if (!(sceneKey in this.sceneStats)) {
        this.sceneStats[sceneKey] = { done: 0, total: 0 };
      }
      this.sceneStats[sceneKey].total += task.total;
    }
    this.taskSet[taskId] = true;
    this.mirrorRunStartTimes.set(taskId, Date.now());
    this.dispatchProgress();

    if (wasEmpty) {
      // push 전에 pause — 서버가 자동 처리 시작하지 않게.
      try {
        await backend.pauseQueue();
      } catch (e) {
        console.warn('[TaskQueue] pauseQueue (initial) failed:', e);
      }
    }

    // prep N번. 같은 run 객체 전달 → cachedVibes/Refs 재사용 (같은 task의 N장은 vibes 동일).
    const run: TaskQueueRun = { stopped: false, delayCnt: 0 };
    const items: Array<{ params: ImageGenInput; meta: QueueJobMeta }> = [];
    const localOutputs: string[] = [];
    for (let i = 0; i < task.total; i++) {
      const { arg, outputFilePath } = await handler.prepGenInput(task, run);
      localOutputs.push(outputFilePath);
      items.push({
        params: arg,
        meta: {
          taskId,
          cls: task.cls,
          sceneKey,
          sceneName: task.params.scene?.name,
          taskType: task.params.scene?.type,
        },
      });
    }

    // 서버 batch push
    const result = await backend.queueAddBatch(items);
    for (let i = 0; i < result.jobIds.length; i++) {
      this.mirroredJobs.set(result.jobIds[i], {
        taskId,
        outputFilePath: localOutputs[i],
      });
    }
    if (result.rejected > 0) {
      console.warn(`[TaskQueue] queueAddBatch rejected ${result.rejected} of ${task.total} (큐 가득 참)`);
      // 등록 실패한 만큼 stats 보정
      this.groupStats[task.cls].total -= result.rejected;
      if (sceneKey && (sceneKey in this.sceneStats)) {
        this.sceneStats[sceneKey].total -= result.rejected;
      }
      task.total -= result.rejected;
    }
    this.dispatchProgress();
  }

  // WS queue-job-complete handler. mirror task만 처리 (다른 jobId는 무시).
  handleMirroredComplete(data: { jobId: string; outputFilePath?: string; meta: QueueJobMeta }) {
    const job = this.mirroredJobs.get(data.jobId);
    if (!job) return;
    const task = this.mirroredTasks.get(job.taskId);
    if (!task) {
      this.mirroredJobs.delete(data.jobId);
      return;
    }
    const outputFilePath = data.outputFilePath || job.outputFilePath;
    task.done++;
    this.groupStats[task.cls].done++;
    const sceneKey = data.meta?.sceneKey;
    if (sceneKey && sceneKey in this.sceneStats) {
      this.sceneStats[sceneKey].done++;
    }
    // task.params 살아있을 때만 imageService 갱신 (이 클라가 등록한 task)
    if (task.params && task.params.session && task.params.scene) {
      const startTs = this.mirrorRunStartTimes.get(job.taskId);
      if (startTs) {
        // 첫 완료 = task 시작 시점 ~ 첫 완료까지의 시간을 1장 추정치로 사용 (대략적)
        this.timeEstimators[task.cls].addSample(Date.now() - startTs);
        this.mirrorRunStartTimes.delete(job.taskId);
      }
      const handler = this.handlers[task.cls];
      if (handler instanceof GenerateImageTaskHandler) {
        try {
          handler.afterGenComplete(task, outputFilePath);
        } catch (e) {
          console.error('[TaskQueue] afterGenComplete threw:', e);
        }
      }
    }
    this.mirroredJobs.delete(data.jobId);
    this.dispatchEvent(new CustomEvent('complete', {}));
    this.dispatchProgress();
    if (task.done >= task.total) {
      this.mirroredTasks.delete(job.taskId);
      delete this.taskSet[job.taskId];
      if (this.mirroredTasks.size === 0 && !this.currentRun) {
        this.dispatchEvent(new CustomEvent('stop', {}));
      }
    }
  }

  handleMirroredError(data: { jobId: string; error: string; meta: QueueJobMeta }) {
    const job = this.mirroredJobs.get(data.jobId);
    if (!job) return;
    const task = this.mirroredTasks.get(job.taskId);
    if (!task) {
      this.mirroredJobs.delete(data.jobId);
      return;
    }
    // 서버가 이미 429 retry 끝까지 시도. 도달 = 진짜 실패. task.done++ (skip 처리)
    task.done++;
    this.groupStats[task.cls].done++;
    const sceneKey = data.meta?.sceneKey;
    if (sceneKey && sceneKey in this.sceneStats) {
      this.sceneStats[sceneKey].done++;
    }
    this.mirroredJobs.delete(data.jobId);
    this.dispatchEvent(
      new CustomEvent('error', { detail: { error: data.error, task } }),
    );
    this.dispatchProgress();
    if (task.done >= task.total) {
      this.mirroredTasks.delete(job.taskId);
      delete this.taskSet[job.taskId];
      if (this.mirroredTasks.size === 0 && !this.currentRun) {
        this.dispatchEvent(new CustomEvent('stop', {}));
      }
    }
  }

  // 페이지 로드 시: 서버 큐의 jobs를 meta.taskId로 그룹화하고 mirroredTasks 재구성.
  // task.params는 서버에 저장 안 됨 → 빈 placeholder. 알약/리스트 표시만 가능, imageService 갱신 X.
  async restoreMirroredState() {
    const full = await backend.queueGetFullState();
    const groups = new Map<string, Array<{ jobId: string; meta: QueueJobMeta; outputFilePath?: string }>>();
    for (const j of full.jobs) {
      if (!j.meta || !j.meta.taskId) continue; // legacy job (meta 없음) 스킵
      if (!groups.has(j.meta.taskId)) groups.set(j.meta.taskId, []);
      groups.get(j.meta.taskId)!.push(j);
    }
    if (groups.size === 0) return;
    for (const [taskId, jobs] of groups) {
      const meta = jobs[0].meta;
      const cls = meta.cls ?? 0;
      // params는 placeholder. scene은 meta.sceneName/taskType으로 fake 객체 — getInfo에서 name 표시용.
      // session/job는 없음. handleMirroredComplete에서 task.params.session 체크해서 afterGenComplete 스킵.
      const placeholderScene = meta.sceneName
        ? ({ name: meta.sceneName, type: meta.taskType || 'scene' } as any)
        : (undefined as any);
      const restoredTask: Task = {
        id: taskId,
        cls,
        params: {
          session: undefined as any,
          job: undefined as any,
          outputPath: '',
          scene: placeholderScene,
        },
        done: 0,
        total: jobs.length,
      };
      this.mirroredTasks.set(taskId, restoredTask);
      this.taskSet[taskId] = true;
      for (const j of jobs) {
        this.mirroredJobs.set(j.jobId, {
          taskId,
          outputFilePath: j.outputFilePath || '',
        });
      }
      if (this.groupStats[cls]) {
        this.groupStats[cls].total += jobs.length;
      }
      if (meta.sceneKey) {
        if (!(meta.sceneKey in this.sceneStats)) {
          this.sceneStats[meta.sceneKey] = { done: 0, total: 0 };
        }
        this.sceneStats[meta.sceneKey].total += jobs.length;
      }
    }
    this.dispatchProgress();
    this.dispatchEvent(new CustomEvent('start', {}));
  }

  addTaskInternal(task: Task) {
    this.queue.enqueue(task);
    this.taskSet[task.id!] = true;
    this.groupStats[task.cls].total += task.total;
    this.groupStats[task.cls].done += task.done;
    const sceneKey = task.params.scene
      ? getSceneKey(task.params.session, task.params.scene)
      : '';
    if (!(sceneKey in this.sceneStats)) {
      this.sceneStats[sceneKey] = { done: 0, total: 0 };
    }
    this.sceneStats[sceneKey].done += task.done;
    this.sceneStats[sceneKey].total += task.total;
    this.dispatchProgress();
  }

  getTaskCls(task: Task) {
    for (let i = 0; i < this.handlers.length; i++) {
      if (this.handlers[i].checkTask(task)) {
        return i;
      }
    }
    throw new Error('No task handler found');
  }

  isEmpty() {
    return this.queue.isEmpty() && this.mirroredTasks.size === 0;
  }

  isRunning() {
    return this.currentRun != undefined || this.mirroredTasks.size > 0;
  }

  stop() {
    let didStop = false;
    if (this.currentRun) {
      this.currentRun.stopped = true;
      this.currentRun = undefined;
      didStop = true;
    }
    // mirror task 진행 중이면 server 큐 pause (in-flight 완료 후 다음 job 안 시작)
    if (this.mirroredTasks.size > 0) {
      backend.pauseQueue().catch((e) => console.warn('[TaskQueue] pauseQueue failed:', e));
      didStop = true;
    }
    if (didStop) {
      this.dispatchEvent(new CustomEvent('stop', {}));
    }
  }

  getDelayCnt() {
    return Math.floor(
      LARGE_WAIT_INTERVAL_BIAS + Math.random() * LARGE_WAIT_INTERVAL_STD,
    );
  }

  run() {
    // mirror task 일시정지 상태 → resume
    if (this.mirroredTasks.size > 0) {
      backend.resumeQueue().catch((e) => console.warn('[TaskQueue] resumeQueue failed:', e));
    }
    if (!this.currentRun && !this.queue.isEmpty()) {
      this.currentRun = {
        stopped: false,
        delayCnt: this.getDelayCnt(),
      };
      this.runInternal(this.currentRun);
    }
    if (this.currentRun || this.mirroredTasks.size > 0) {
      this.dispatchEvent(new CustomEvent('start', {}));
    }
  }

  calculateCost(): CostItem[] {
    const res: CostItem[] = [];
    for (const task of this.queue) {
      const handler = this.handlers[task!.cls];
      const costs = handler.calculateCost(task!);
      res.push(...costs);
    }
    return res;
  }

  statsAllTasks(): TaskStats {
    let done = 0;
    let total = 0;
    for (let i = 0; i < this.handlers.length; i++) {
      done += this.groupStats[i].done;
      total += this.groupStats[i].total;
    }
    return { done, total };
  }

  estimateTopTaskTime(type: 'median' | 'mean'): number {
    // legacy 큐 우선 (실행 순서상 먼저). 비어있으면 mirror 큐 첫 task.
    let cls: number | null = null;
    if (!this.queue.isEmpty()) {
      cls = this.queue.peek().cls;
    } else if (this.mirroredTasks.size > 0) {
      const first = this.mirroredTasks.values().next().value as Task | undefined;
      if (first) cls = first.cls;
    }
    if (cls === null) return 0;
    if (type === 'mean') {
      return this.timeEstimators[cls].estimateMean();
    }
    return this.timeEstimators[cls].estimateMedian();
  }

  estimateTime(type: 'median' | 'mean'): number {
    let res = 0;
    for (let i = 0; i < this.handlers.length; i++) {
      if (type === 'mean') {
        res +=
          this.timeEstimators[i].estimateMean() *
          (this.groupStats[i].total - this.groupStats[i].done);
      } else {
        res +=
          this.timeEstimators[i].estimateMedian() *
          (this.groupStats[i].total - this.groupStats[i].done);
      }
    }
    return res;
  }

  statsTasksFromScene(session: Session, scene: GenericScene): TaskStats {
    let done = 0;
    let total = 0;
    const sceneKey = getSceneKey(session, scene);
    if (sceneKey in this.sceneStats) {
      done += this.sceneStats[sceneKey].done;
      total += this.sceneStats[sceneKey].total;
    }
    return { done, total };
  }

  dispatchProgress() {
    this.dispatchEvent(new CustomEvent('progress', {}));
  }

  removeTaskInternal(task: Task) {
    this.groupStats[task.cls].done -= task.done;
    this.groupStats[task.cls].total -= task.total;
    const sceneKey = task.params.scene
      ? getSceneKey(task.params.session, task.params.scene)
      : '';
    if (sceneKey in this.sceneStats) {
      this.sceneStats[sceneKey].done -= task.done;
      this.sceneStats[sceneKey].total -= task.total;
    }
    delete this.taskSet[task.id!];
  }

  private getRetryTimeoutMs(retryIndex: number): number {
    if (retryIndex < 10) return 60 * 1000;
    return 120 * 1000;
  }

  private withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout')), timeoutMs);
      promise.then(
        (v) => { clearTimeout(timer); resolve(v); },
        (e) => { clearTimeout(timer); reject(e); },
      );
    });
  }

  async runInternal(cur: TaskQueueRun) {
    this.dispatchProgress();
    const config = await backend.getConfig();
    const delayTime = config.delayTime ?? 0;
    while (!this.queue.isEmpty()) {
      const task = this.queue.peek();
      if (task.done >= task.total) {
        this.removeTaskInternal(task);
        this.queue.dequeue();
        continue;
      }
      let done = false;
      const before = Date.now();
      const handler = this.handlers[task.cls];
      const numTries = handler.getNumTries(task);
      for (let i = 0; i < numTries; i++) {
        if (cur.stopped) {
          this.dispatchProgress();
          return;
        }
        try {
          await handler.handleDelay(task, i, delayTime);
          const timeoutMs = this.getRetryTimeoutMs(i);
          await this.withTimeout(handler.handleTask(task, cur), timeoutMs);
          const after = Date.now();
          this.timeEstimators[task.cls].addSample(after - before);
          done = true;
          cur.delayCnt--;
          if (cur.delayCnt === 0) {
            await sleep(
              (Math.random() * LARGE_WAIT_DELAY_STD + LARGE_WAIT_DELAY_BIAS) *
                delayTime,
            );
            cur.delayCnt = this.getDelayCnt();
          }
          if (!cur.stopped) {
            task.done++;
            if (task.id! in this.taskSet) {
              this.groupStats[task.cls].done++;
              const sceneKey = task.params.scene
                ? getSceneKey(task.params.session, task.params.scene)
                : '';
              this.sceneStats[sceneKey].done++;
            }
          }
          this.dispatchEvent(new CustomEvent('complete', {}));
          this.dispatchProgress();
        } catch (e: any) {
          const sceneName = task.params.scene?.name ?? '(unknown)';
          if (e.message === 'IP') {
            this.addLog('error', sceneName, 'IP 변경 감지로 중단');
            this.dispatchEvent(new CustomEvent('ip-check-fail', {}));
            this.stop();
            return;
          }
          // 429 rate limit: 60초 대기 후 재시도
          if (e.message && e.message.includes('429')) {
            this.addLog('warn', sceneName, `요청 제한 (429) - 60초 대기 후 재시도 [${i + 1}/${numTries}]`);
            console.log('Rate limited (429), waiting 60s before retry...');
            this.dispatchEvent(
              new CustomEvent('error', {
                detail: { error: '요청 제한 (429) - 60초 대기 후 재시도', task: task },
              }),
            );
            await sleep(60 * 1000);
          } else {
            this.addLog('error', sceneName, `${e.message} [${i + 1}/${numTries}]`);
            this.dispatchEvent(
              new CustomEvent('error', {
                detail: { error: e.message, task: task },
              }),
            );
          }
          console.error(e);
        }
        if (done) {
          break;
        }
      }
      if (!done) {
        // 실패한 태스크를 건너뛰고 다음 태스크로 진행
        const sceneName = task.params.scene?.name ?? '(unknown)';
        this.addLog('error', sceneName, `${numTries}회 재시도 실패 - 건너뜀`);
        console.log('SKIPPING FAILED TASK:', task.params.scene?.name);
        this.dispatchEvent(
          new CustomEvent('error', {
            detail: { error: '재시도 초과로 건너뜀', task: task },
          }),
        );
        this.removeTaskInternal(task);
        this.queue.dequeue();
        this.dispatchProgress();
        continue;
      }
    }
    if (cur == this.currentRun) {
      this.dispatchEvent(new CustomEvent('stop', {}));
      this.currentRun = undefined;
    }
    this.dispatchProgress();
  }

  getTaskInfo(task: Task) {
    return this.handlers[task.cls].getInfo(task);
  }
}

export const taskHandlers = [
  new GenerateImageTaskHandler(false, 'gen'),
  new GenerateImageTaskHandler(true, 'gen'),
  new GenerateImageTaskHandler(false, 'i2i'),
  new GenerateImageTaskHandler(true, 'i2i'),
  new GenerateImageTaskHandler(false, 'inpaint'),
  new GenerateImageTaskHandler(true, 'inpaint'),
  new AugmentTaskHandler(),
  new RemoveBgTaskHandler(),
];

export const queueWorkflow = async (
  session: Session,
  workflow: SelectedWorkflow,
  scene: GenericScene,
  samples: number,
) => {
  const [type, preset, shared, def] = session.getCommonSetup(workflow);
  const prompts = await def.createPrompt!(session, scene, preset, shared);
  const characterPrompts = await def.createCharacterPrompts!(
    session,
    scene,
    preset,
    shared,
  );
  const scene_ = scene as Scene;
  for (let i = 0; i < prompts.length; i++) {
    await def.handler(
      session,
      scene,
      prompts[i],
      characterPrompts[i],
      preset,
      shared,
      samples,
      scene_.meta.get(type),
    );
  }
};

export const queueI2IWorkflow = async (
  session: Session,
  type: string,
  preset: any,
  scene: GenericScene,
  samples: number,
  onComplete?: (path: string) => void,
) => {
  const def = workFlowService.getDef(type);
  console.log('queueI2IWorkflow', type, preset, scene, samples, onComplete);
  await def.handler(
    session,
    scene,
    { type: 'text', text: '' },
    [],
    preset,
    undefined,
    samples,
    undefined,
    onComplete,
  );
};

export const queueMirrorWorkflow = async (
  session: Session,
  type: string,
  preset: any,
  scene: InpaintScene,
  samples: number,
  onComplete?: (path: string) => void,
) => {
  const def = workFlowService.getDef(type);

  // 미러 이미지가 씬에 아직 설정되지 않았으면 세션 미러 이미지로 자동 생성
  if (!preset.image) {
    if (!session.mirrorImage) {
      throw new Error('미러 이미지를 먼저 업로드해주세요.');
    }
    const srcData = await imageService.fetchVibeImage(
      session,
      session.mirrorImage,
    );
    if (!srcData) {
      throw new Error('미러 이미지를 불러올 수 없습니다.');
    }
    const srcBase64 = dataUriToBase64(srcData);
    const result = await prepareMirrorCanvas(srcBase64, session.mirrorMode || 'blank');
    preset.image = await imageService.storeVibeImage(session, result.canvas);
    preset.mask = await imageService.storeVibeImage(session, result.mask);
    scene.resolution = 'custom';
    scene.resolutionWidth = result.width;
    scene.resolutionHeight = result.height;
    scene.mirrorCropX = result.cropX;
  }

  if (scene.slots.length === 0) {
    await def!.handler(
      session,
      scene,
      { type: 'text', text: '' },
      [],
      preset,
      undefined,
      samples,
      undefined,
      onComplete,
    );
    return;
  }

  const combinations: string[][] = [];
  const current: string[] = [];
  const traverse = () => {
    if (current.length === scene.slots.length) {
      combinations.push([...current]);
      return;
    }
    const level = current.length;
    let hasEnabled = false;
    for (const piece of scene.slots[level]) {
      if (piece.enabled === undefined || piece.enabled) {
        hasEnabled = true;
        current.push(piece.prompt);
        traverse();
        current.pop();
      }
    }
    if (!hasEnabled) {
      current.push('');
      traverse();
      current.pop();
    }
  };
  traverse();

  for (const combo of combinations) {
    const middlePrompt = combo.filter(Boolean).join(', ');
    const mergedPreset = { ...preset, prompt: middlePrompt };
    await def!.handler(
      session,
      scene,
      { type: 'text', text: '' },
      [],
      mergedPreset,
      undefined,
      samples,
      undefined,
      onComplete,
    );
  }
};
