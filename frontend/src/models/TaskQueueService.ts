import { v4 } from 'uuid';
import { getAppState } from './appStateRef';
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
import { startVisibleInterval } from '../visibleInterval';
import type { ServerBackend } from '../backends/serverBackend';
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
import { dataUriToBase64, type ImageService } from './ImageService';
import type { WorkFlowService } from './workflows/WorkFlowService';
import { prepareMirrorCanvas } from './workflows/SDWorkFlow';
import { getImageDimensions } from '../components/BrushTool';
import { QueueJobMeta } from '../backend';

interface TaskQueueRuntime {
  backend: ServerBackend;
  imageService: ImageService;
  localAIService: { removeBg(image: string, outputPath: string): Promise<void> };
  taskQueueService: TaskQueueService;
  workFlowService: WorkFlowService;
}

let taskQueueRuntime: TaskQueueRuntime | undefined;

export function installTaskQueueRuntime(runtime: TaskQueueRuntime): void {
  if (taskQueueRuntime && taskQueueRuntime !== runtime) {
    throw new Error('Task queue runtime is already installed');
  }
  taskQueueRuntime = runtime;
}

function requireTaskQueueRuntime(): TaskQueueRuntime {
  if (!taskQueueRuntime) throw new Error('Task queue runtime is not installed');
  return taskQueueRuntime;
}

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
  priority?: boolean; // 우선순위 큐. 서버 측 jobs[i].priority 기반으로 restore 시 set.
  // 한 씬의 *모든 조합 × samples* 묶음 정보. queueWorkflow가 prompts loop 진입 *전*에
  // sceneJobTotal=prompts.length*samples 계산해서 모든 task에 동일 박음.
  // sceneJobStartIndex는 task별 (i-th prompt → i*samples+1). 각 task 안 j-th job은
  // sceneJobStartIndex + j-1 표시 = 씬 내 N번째.
  sceneGroup?: { sceneJobTotal: number; sceneJobStartIndex: number };
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
    smp.sort((a, b) => a! - b!);
    if (smp.length) return smp[smp.length >> 1]!;
    return this.defaultEstimate;
  }

  estimateMean() {
    const smp = this.samples.filter((x) => x != undefined);
    if (smp.length) return smp.reduce((x, y) => x! + y!, 0) / smp.length;
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
  // 한 task 내 prepGenInput N번 모두 backend.getConfig() 동일 응답 가정. N장 task에서
  // iteration당 2회 fetch (line 259, 410) = 2N HTTP roundtrip → 226 vs 175 lag 동인.
  // 첫 prep에서 1회만 fetch, 이후 cache 재사용.
  cachedConfig?: any;
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
    if (!run.cachedConfig) run.cachedConfig = await requireTaskQueueRuntime().backend.getConfig();
    const config = run.cachedConfig;
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

    // 바이브 이미지 처리 - 캐싱 적용 + 손상 시 건너뛰기
    const allVibes = await Promise.all(
      job.vibes.map(async (vibe) => {
        try {
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
          const isEncoded = await requireTaskQueueRuntime().imageService.checkEncodedVibeImage(
            task.params.session,
            vibe.path,
            vibe.info,
          );
          if (!isEncoded) {
            await requireTaskQueueRuntime().imageService.encodeVibeImage(
              task.params.session,
              vibe.path,
              vibe.info,
            );
          }
          let encoded =
            (await requireTaskQueueRuntime().imageService.fetchEncodedVibeImage(
              task.params.session,
              vibe.path,
              vibe.info,
            )) || '';
          if (!encoded) {
            console.warn('[prepGenInput] 바이브 이미지 인코딩 실패 (파일 손상 가능):', vibe.path);
            getAppState().pushMessage(`바이브 이미지를 불러올 수 없습니다 (${vibe.path}). 이미지를 다시 첨부해주세요.`);
            return null;
          }
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
        } catch (e) {
          console.warn('[prepGenInput] 바이브 이미지 처리 실패, 건너뜀:', vibe.path, e);
          return null;
        }
      }),
    );
    const vibes = allVibes.filter(
      (v): v is NonNullable<typeof v> => v !== null && !!v.image && v.image.length > 0,
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
            const imageData = await requireTaskQueueRuntime().imageService.fetchReferenceImage(
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
            const base64Image = await requireTaskQueueRuntime().imageService.reencodeReferenceForApi(
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
    const appConfig = run.cachedConfig;
    const curModelVersion = appConfig.modelVersion ?? ModelVersion.V4_5;
    const isV4 = curModelVersion === ModelVersion.V4 || curModelVersion === ModelVersion.V4Curated;
    const isV4_5 = curModelVersion === ModelVersion.V4_5 || curModelVersion === ModelVersion.V4_5Curated;

    // v4: 캐릭터 레퍼런스 미지원 → 제거
    const finalReferences = isV4 ? [] : references;
    // v4.5: 캐릭터 레퍼런스가 있으면 바이브 비활성화
    const finalVibes = (isV4_5 && finalReferences.length > 0) ? [] : vibes;
    // Phase 7A: vibe가 실제로 비활성화될 때만 알림 이벤트 발행
    if (isV4_5 && finalReferences.length > 0 && vibes.length > 0) {
      requireTaskQueueRuntime().taskQueueService.dispatchEvent(new CustomEvent('vibe-locked', {
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
        requireTaskQueueRuntime().imageService.onAddInPaint(
          task.params.session,
          task.params.scene.name,
          outputFilePath,
        );
      } else {
        requireTaskQueueRuntime().imageService.onAddImage(
          task.params.session,
          task.params.scene.name,
          outputFilePath,
        );
      }
    }
  }

  async handleTask(task: Task, run: TaskQueueRun) {
    const { arg, outputFilePath } = await this.prepGenInput(task, run);
    await requireTaskQueueRuntime().backend.generateImage(arg);
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
        text: '스텝 수 28개 초과',
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
    await requireTaskQueueRuntime().localAIService.removeBg(job.image!, outputFilePath);
    if (task.params.onComplete) task.params.onComplete(outputFilePath);
    requireTaskQueueRuntime().imageService.onAddImage(
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
    await requireTaskQueueRuntime().backend.augmentImage(params);
    if (task.params.onComplete) task.params.onComplete(outputFilePath);
    if (task.params.scene.type === 'inpaint') {
      requireTaskQueueRuntime().imageService.onAddInPaint(
        task.params.session,
        task.params.scene.name,
        outputFilePath,
      );
    } else {
      requireTaskQueueRuntime().imageService.onAddImage(
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
  // 레이아웃 전환으로 진행 위젯이 재마운트돼도 현재 사이클 애니메이션을 이어 그린다.
  progressCycleStartedAt = 0;
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
  // mirror 큐 paused 상태 추적 (server backend.pauseQueue/resumeQueue와 sync). 알약/UI 표시용.
  mirrorPaused: boolean = false;
  // jobId → { taskId, outputFilePath } 매핑. WS queue-job-complete 받을 때 task 찾기 + afterGenComplete용.
  mirroredJobs: Map<string, { taskId: string; outputFilePath: string }> = new Map();
  // mirror 도중 prep 시간 측정 시작점 (시간 추정 보정용)
  private mirrorRunStartTimes: Map<string, number> = new Map();
  // queueAddBatch를 호출 순서대로 직렬화하는 promise chain. 본인 페인 (2026-05-16):
  // addAllToQueue가 CHUNK=4 Promise.all 병렬로 addMirroredTask 호출 → 각 scene의 prep이
  // 동시 진행 → 누가 먼저 끝나서 server push하느냐 race → server 큐에 scene 순서 어긋남.
  // 해결: prep은 병렬 유지 + queueAddBatch만 chain 직렬화 → push는 항상 호출 순서.
  // A(직렬 fill 체인 제거): 옛 addBatchChain은 (1) fill 직렬화 (2) 진행 중 add 완료 대기
  // 두 역할을 겸했음. 직렬화는 폐지(각 씬 병렬 fill = wait 누적 제거), 완료 대기만 이 Set으로
  // 보존(waitForPendingFills / restoreMirroredState C-mini lock이 의존).
  private pendingAdds: Set<Promise<void>> = new Set();
  // foreground-free 일괄 등록 (batch-enqueue) 수집 버퍼. addAllToQueue(일반 SDImageGen + flag)가
  // beginBatchCollect()로 켜면 addTask가 서버 전송(reserve/prep/fill) 대신 명세만 batchBuffer에 모음.
  // flushBatchCollect()가 vibe 사전체크 → batch-enqueue 단일 전송 → 응답으로 mirror 매핑.
  private batchCollecting = false;
  private batchBuffer: Array<{ task: Task; spec: any }> = [];
  // mirror task의 sceneKey 보존 (placeholder restored task는 task.params.session 없어서 getSceneKey로 추출 불가).
  // removeAllTasks/removeTasksFromScene에서 정확한 stats unwind에 사용.
  private mirrorTaskSceneKeys: Map<string, string> = new Map();
  // restoreMirroredState single-flight 가드. 호출처 3곳(생성자, WS reconnect, 30s 폴링)이
  // 백그라운드 복귀 시 거의 동시에 깨어나면 concurrent unwind+rebuild가 groupStats를
  // 중복 누적시켜 숫자 부풀림. 본인 보고 (2026-05-17): 246 → 90 → 146으로 증가, queue.html과 불일치.
  // 진행 중이면 새 호출은 같은 promise를 await — 중복 fetch + 중복 누적 둘 다 차단.
  private restoreInFlight: Promise<void> | null = null;
  // 이 client 인스턴스의 고유 식별자 — 예약 소유권 표시(reserve에 전달) + heartbeat 매칭.
  // orphan(주인 사라진 예약) 판정 기준: 서버는 ownerId의 lastHeartbeat가 끊긴 예약을 orphan으로 봄.
  private readonly ownerId: string = v4();
  // 아직 fill 안 된(=내가 책임지는) 예약을 가진 taskId 집합. 비어있으면 heartbeat skip(모바일 누수 차단).
  // taskId 기준 — 취소(removeAllTasks/removeTasksFromScene/Project)가 taskId로 정리하므로 leak 0
  // (L2.5: reservationId-keyed면 cancel-mid-prep 시 entry가 안 지워져 영구 no-op heartbeat 발생).
  private outstandingReservations: Set<string> = new Set();
  constructor(handlers: TaskHandler[], private readonly backend: ServerBackend) {
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
    this.backend.onQueueJobComplete((data) => this.handleMirroredComplete(data));
    this.backend.onQueueJobError((data) => this.handleMirroredError(data));

    // 페이지 로드 시 서버 큐 → mirror 복원 (다른 탭 또는 이전 세션의 작업)
    this.restoreMirroredState().catch((e) => {
      console.warn('[TaskQueue] restoreMirroredState failed:', e);
    });

    // 자동 재동기화: WS reconnect 즉시 + 30초 주기 polling.
    // WS 끊긴 사이 놓친 queue-job-complete 회복.
    // visibility 게이트 — 백그라운드 시 timer 정지 (모바일 발열·배터리 누수 차단).
    // 포그라운드 복귀 시 ws-reconnect 또는 자연 tick으로 회복.
    this.backend.onWsReconnect(() => {
      this.restoreMirroredState().catch((e) => {
        console.warn('[TaskQueue] restoreMirroredState (ws-reconnect) failed:', e);
      });
    });
    startVisibleInterval(() => {
      // 게이트 — 큐가 idle이면 폴링 자체 skip. 모바일 발열·배터리 누수 차단 (P15 #18).
      // mirroredTasks 비어있고 pause 상태도 아니면 server 측 변화 동기화할 게 없음.
      // ws-reconnect 콜백은 별도로 등록돼 있어서, WS 끊긴 사이 task 새로 들어오면 그때 회복.
      if (this.mirroredTasks.size === 0 && !this.mirrorPaused) return;
      this.restoreMirroredState().catch((e) => {
        console.warn('[TaskQueue] restoreMirroredState (polling) failed:', e);
      });
    }, 30000);

    // 예약 heartbeat — 미fill 예약이 있는 동안만 30s ping. 서버가 ownerId로 매칭해 lastHeartbeat
    // 갱신 → orphan sweep이 *살아있는 주인*의 예약을 orphan으로 오판 안 함. visibility 게이트로
    // 백그라운드 정지(모바일 누수 차단). 미fill 예약 0이면 skip(idle 시 네트워크 0).
    startVisibleInterval(() => {
      if (this.outstandingReservations.size === 0) return;
      this.backend.reservationHeartbeat(this.ownerId).catch((e) =>
        console.warn('[TaskQueue] reservationHeartbeat failed:', e));
    }, 30000);
  }

  addLog(level: TaskLog['level'], scene: string, message: string) {
    this.taskLogs.push({ timestamp: Date.now(), level, scene, message });
    // audit H13 — 옛: splice(0, k)는 O(N). 1000 task 처리 + 매 task가 1~2 log 던지면
    // 매 addLog마다 O(MAX) 복사 = O(N²) 누적. 429 retry storm 시 ms 단위 main thread
    // 블록 + GC 압박.
    // 새: 2× capacity 도달 시 slice(-MAX). MAX 번에 한 번 O(MAX) → amortized O(1) per add.
    // MobX reactivity는 배열 재할당으로 트리거. consumer는 동일 ordering (insertion order).
    if (this.taskLogs.length > MAX_TASK_LOGS * 2) {
      this.taskLogs = this.taskLogs.slice(-MAX_TASK_LOGS);
    }
  }

  clearLogs() {
    this.taskLogs = [];
  }

  // 우선순위 toggle — 서버에 호출 + 로컬 task.priority 즉시 갱신 (optimistic) + 재동기화 트리거.
  // 본인 spec (2026-05-17): 처리 중 잡 외 priority=true 잡들이 큐 앞으로. FIFO within 우선순위.
  async prioritizeTasks(taskIds: string[], priority: boolean) {
    // 옵티미스틱: 로컬 mirroredTasks의 task.priority를 즉시 set → UI 즉각 반영.
    for (const id of taskIds) {
      const task = this.mirroredTasks.get(id);
      if (task) task.priority = priority;
    }
    this.dispatchProgress();
    try {
      await this.backend.queuePrioritize(taskIds, priority);
    } catch (e) {
      console.warn('[TaskQueue] prioritize failed:', e);
      // 실패 시 서버 상태로 되돌리기 위해 재동기화. dispatchProgress로 UI도 보정됨.
      this.restoreMirroredState().catch(() => {});
      throw e;
    }
    // 성공해도 서버 측 정렬이 적용된 최신 상태를 가져옴 (다른 탭 sync + 안전망).
    this.restoreMirroredState().catch(() => {});
  }

  removeAllTasks() {
    while (!this.queue.isEmpty()) {
      const task = this.queue.peek();
      this.removeTaskInternal(task);
      this.queue.dequeue();
    }
    // mirror task: 서버 큐 cancel + 클라 측 mirror state 비우기 + stats 완전 unwind
    if (this.mirroredTasks.size > 0) {
      this.backend.cancelQueue().catch((e) => console.warn('[TaskQueue] cancelQueue failed:', e));
      for (const [taskId, task] of this.mirroredTasks) {
        // groupStats 완전 unwind (total + done 둘 다 — mirror 기여분 제거)
        this.groupStats[task.cls].total -= task.total;
        this.groupStats[task.cls].done -= task.done;
        // sceneStats unwind (mirrorTaskSceneKeys에서 sceneKey 조회)
        const sceneKey = this.mirrorTaskSceneKeys.get(taskId);
        if (sceneKey && sceneKey in this.sceneStats) {
          this.sceneStats[sceneKey].total -= task.total;
          this.sceneStats[sceneKey].done -= task.done;
          // 0 이하면 entry 제거 (씬 카드에 0/0 안 보이게)
          if (this.sceneStats[sceneKey].total <= 0 && this.sceneStats[sceneKey].done <= 0) {
            delete this.sceneStats[sceneKey];
          }
        }
        delete this.taskSet[taskId];
      }
      this.mirroredTasks.clear();
      this.mirroredJobs.clear();
      this.mirrorRunStartTimes.clear();
      this.mirrorTaskSceneKeys.clear();
      this.outstandingReservations.clear(); // cancelQueue가 reserved 포함 전체 취소 → heartbeat 대상 0
      this.mirrorPaused = false;
    }
    this.dispatchProgress();
    this.dispatchEvent(new CustomEvent('stop', {}));
  }

  // audit D1 — 전체 큐 취소(removeAllTasks)는 영속화로도 복구 불가라, 1클릭 즉시 실행은
  // 실수 한 번에 대기 큐 전체 손실(905개 손실 트라우마와 결). confirm 게이트 래퍼.
  // 비어있으면 묻지 않고 no-op. UI 버튼들은 removeAllTasks 직접 대신 이 래퍼를 호출.
  // afterConfirm: "중지" 버튼처럼 취소 직후 stop() 등 후속이 필요한 호출부용. 큐가 비어
  // 취소할 게 없으면 confirm 없이 afterConfirm만 실행(데이터 손실 없으니 묻지 않음).
  removeAllTasksWithConfirm(afterConfirm?: () => void) {
    if (this.queue.isEmpty() && this.mirroredTasks.size === 0) {
      afterConfirm?.();
      return;
    }
    getAppState().pushDialog({
      type: 'confirm',
      text: '대기 중인 큐 전체를 취소할까요? 복구할 수 없어요.',
      callback: () => {
        this.removeAllTasks();
        afterConfirm?.();
      },
    });
  }

  removeTasksFromScene(session: Session, scene: GenericScene) {
    // legacy queue: scene 매칭 task 제거 (reference equality라 cross-project 안전)
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
    // mirror: sceneKey(session.name + scene.type + scene.name) 매칭. name + type만 비교하면
    // 다른 프로젝트의 같은 이름 씬도 같이 cancel되는 버그가 있어 sceneKey 사용.
    const targetKey = getSceneKey(session, scene);
    const matchedTaskIds: string[] = [];
    for (const taskId of this.mirroredTasks.keys()) {
      if (this.mirrorTaskSceneKeys.get(taskId) === targetKey) {
        matchedTaskIds.push(taskId);
      }
    }
    const serverCancel = matchedTaskIds.length > 0
      ? this.backend.cancelQueueByTaskIds(matchedTaskIds).then(
          () => true,
          (e) => {
            console.warn('[TaskQueue] cancelQueueByTaskIds failed:', e);
            return false;
          },
        )
      : Promise.resolve(true);
    if (matchedTaskIds.length > 0) {
      for (const taskId of matchedTaskIds) {
        const mtask = this.mirroredTasks.get(taskId)!;
        this.groupStats[mtask.cls].total -= mtask.total;
        this.groupStats[mtask.cls].done -= mtask.done;
        const sceneKey = this.mirrorTaskSceneKeys.get(taskId);
        if (sceneKey && sceneKey in this.sceneStats) {
          this.sceneStats[sceneKey].total -= mtask.total;
          this.sceneStats[sceneKey].done -= mtask.done;
          if (this.sceneStats[sceneKey].total <= 0 && this.sceneStats[sceneKey].done <= 0) {
            delete this.sceneStats[sceneKey];
          }
        }
        // 이 task 소속 jobIds 제거
        for (const [jobId, jobInfo] of this.mirroredJobs) {
          if (jobInfo.taskId === taskId) {
            this.mirroredJobs.delete(jobId);
          }
        }
        this.mirroredTasks.delete(taskId);
        this.mirrorTaskSceneKeys.delete(taskId);
        this.mirrorRunStartTimes.delete(taskId);
        this.outstandingReservations.delete(taskId); // 취소된 task의 미fill 예약 — heartbeat 대상 제거
        delete this.taskSet[taskId];
      }
    }
    this.dispatchProgress();
    // 기존 호출부는 반환값을 무시해 즉시 취소 동작을 유지한다. 모드 전환처럼 이전
    // 서버 작업이 확실히 닫힌 뒤 다음 작업을 넣어야 하는 호출부만 결과를 await한다.
    return serverCancel;
  }

  waitForPendingFills(): Promise<void> {
    // A: 옛 addBatchChain(직렬 체인 마지막 슬롯) 대신 진행 중 add 전부 대기.
    return Promise.allSettled([...this.pendingAdds]).then(() => {});
  }

  removeTasksFromProject(session: Session) {
    const prefix = session.name + '/';
    // legacy queue
    const oldQueue = this.queue;
    this.queue = new CircularQueue<Task>();
    while (!oldQueue.isEmpty()) {
      const task = oldQueue.peek();
      oldQueue.dequeue();
      this.removeTaskInternal(task);
      if (task.params.session !== session) {
        this.addTaskInternal(task);
      }
    }
    // mirror: sceneKey prefix 매칭
    const matchedTaskIds: string[] = [];
    for (const taskId of this.mirroredTasks.keys()) {
      const sk = this.mirrorTaskSceneKeys.get(taskId) ?? '';
      if (sk.startsWith(prefix)) {
        matchedTaskIds.push(taskId);
      }
    }
    if (matchedTaskIds.length > 0) {
      this.backend.cancelQueueByTaskIds(matchedTaskIds).catch((e) =>
        console.warn('[TaskQueue] cancelQueueByTaskIds failed:', e),
      );
      for (const taskId of matchedTaskIds) {
        const mtask = this.mirroredTasks.get(taskId)!;
        this.groupStats[mtask.cls].total -= mtask.total;
        this.groupStats[mtask.cls].done -= mtask.done;
        const sceneKey = this.mirrorTaskSceneKeys.get(taskId);
        if (sceneKey && sceneKey in this.sceneStats) {
          this.sceneStats[sceneKey].total -= mtask.total;
          this.sceneStats[sceneKey].done -= mtask.done;
          if (this.sceneStats[sceneKey].total <= 0 && this.sceneStats[sceneKey].done <= 0) {
            delete this.sceneStats[sceneKey];
          }
        }
        for (const [jobId, jobInfo] of this.mirroredJobs) {
          if (jobInfo.taskId === taskId) {
            this.mirroredJobs.delete(jobId);
          }
        }
        this.mirroredTasks.delete(taskId);
        this.mirrorTaskSceneKeys.delete(taskId);
        this.mirrorRunStartTimes.delete(taskId);
        this.outstandingReservations.delete(taskId); // 취소된 task의 미fill 예약 — heartbeat 대상 제거
        delete this.taskSet[taskId];
      }
    }
    this.dispatchProgress();
  }

  // sync void 반환 — caller 즉시 return + addMirroredTask는 background.
  // sync block(line 968-997)의 stats += task.total + dispatchProgress는 동기적으로
  // 즉시 fire이라 UI 카운터 instant 점프 보존. prep + queueAddBatch는 background.
  // a1bfdde에서 async + await로 바꿨는데 caller(queueWorkflow / addAllToQueue chunk)가
  // prep + queueAddBatch 끝까지 대기하는 부작용으로 "모두 예약추가" 로딩 회귀.
  // P15(큐 등록 실패 사용자 인지) fix는 'error' event dispatch는 그대로 유지 + App
  // 레벨 글로벌 listener에서 toast (TaskQueueControl unmount된 상태도 toast 보장).
  addTask(params: TaskParam, numExec: number, sceneGroup?: Task['sceneGroup']): void {
    const task: Task = {
      id: v4(),
      cls: -1,
      params: params,
      done: 0,
      total: numExec,
      sceneGroup,
    };
    task.cls = this.getTaskCls(task);
    const handler = this.handlers[task.cls];
    // gen/inpaint/i2i = server-mirror로. 클라 닫혀도 서버가 진행.
    if (handler instanceof GenerateImageTaskHandler) {
      // batch 수집은 일반 SDImageGen 씬(job.type='sd' + scene)만. batchCollecting 중
      // 끼어든 inpaint/augment 등 다른 타입은 기존 경로로 (toBatchSpec은 SDJob 전용이라
      // 다른 job에 부적합 — 전역 플래그 race 가드).
      const collectJob: any = task.params.job;
      if (
        this.batchCollecting &&
        collectJob?.type === 'sd' &&
        task.params.scene?.type === 'scene'
      ) {
        // batch 수집 모드: 서버 전송(reserve/prep/fill) 대신 명세만 모음 + mirror 낙관적 등록.
        this.registerMirroredTaskOptimistic(task);
        try {
          this.batchBuffer.push({ task, spec: this.toBatchSpec(task) });
        } catch (e: any) {
          // 명세 생성 실패(프롬프트 에러 등) → 낙관적 등록 unwind + error event.
          const sceneKey = task.params.scene
            ? getSceneKey(task.params.session, task.params.scene)
            : '';
          this.unwindMirrorTask(task.id!, task, sceneKey);
          this.dispatchProgress();
          this.dispatchEvent(
            new CustomEvent('error', {
              detail: { error: e?.message || String(e), task },
            }),
          );
        }
        return;
      }
      // A: 진행 중 add를 pendingAdds로 추적 (옛 addBatchChain 완료대기 역할 대체).
      // restoreMirroredState/waitForPendingFills가 이 Set으로 "add 진행 중"을 판정.
      const p = this.addMirroredTask(task).catch((e: any) => {
        console.error('[TaskQueue] addMirroredTask failed:', e);
        this.dispatchEvent(
          new CustomEvent('error', {
            detail: { error: e?.message || String(e), task },
          }),
        );
      });
      this.pendingAdds.add(p);
      p.finally(() => this.pendingAdds.delete(p));
      return;
    }
    // 그 외 (augment, remove-bg) 는 기존 클라 큐
    this.addTaskInternal(task);
  }

  // mirror task 낙관적 등록 (UI 카운터 instant 점프). addMirroredTask + batch 수집 공통.
  // mirroredTasks/stats/taskSet 등록 + 첫 task면 paused. reserve/prep/fill은 호출부 담당.
  private registerMirroredTaskOptimistic(task: Task): string {
    const taskId = task.id!;
    const sceneKey = task.params.scene
      ? getSceneKey(task.params.session, task.params.scene)
      : '';
    const wasEmpty = this.mirroredTasks.size === 0 && !this.currentRun;
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
    this.mirrorTaskSceneKeys.set(taskId, sceneKey);
    if (wasEmpty) {
      this.mirrorPaused = true;
      this.backend.pauseQueue().catch((e) => console.warn('[TaskQueue] pauseQueue (initial) failed:', e));
    }
    this.dispatchProgress();
    return sceneKey;
  }

  // ─── batch 수집 모드 (foreground-free 일괄 등록) ───────────────────
  // addAllToQueue(일반 SDImageGen + flag)가 등록 직전 호출 → addTask가 명세만 모음.
  beginBatchCollect() {
    this.batchCollecting = true;
    this.batchBuffer = [];
  }

  // job(SDJob) → 서버 전송 명세. 텍스트(prompt/uc/캐릭터)는 클라가 lower/expand,
  // vibe/ref는 path 참조만 (서버가 인코딩). prepGenInput의 이미지 외 변환과 등가.
  private toBatchSpec(task: Task): any {
    const job: any = task.params.job;
    const session = task.params.session;
    const scene = task.params.scene!;
    const resol = job.overrideResolution
      ? job.overrideResolution
      : (scene.resolution as Resolution);
    const cps: any[] = job.characterPrompts || [];
    return {
      taskId: task.id,
      cls: task.cls,
      sceneKey: getSceneKey(session, scene),
      sceneName: scene.name,
      sceneType: scene.type,
      sessionName: session.name,
      outputPath: task.params.outputPath,
      samples: task.total,
      ...(task.sceneGroup
        ? {
            sceneJobStartIndex: task.sceneGroup.sceneJobStartIndex,
            sceneJobTotal: task.sceneGroup.sceneJobTotal,
          }
        : {}),
      prompt: lowerPromptNode(job.prompt),
      uc: expandPieces(job.uc, session, scene),
      characterPrompts: cps.map((c) => lowerPromptNode(c.prompt)),
      characterUCs: cps.map((c) => expandPieces(c.uc, session, scene)),
      characterPositions: cps.map((c) => c.position),
      vibes: (job.vibes || []).map((v: any) => ({
        name: v.path,
        info: v.info,
        strength: v.strength,
      })),
      references: (job.characterReferences || [])
        .filter((r: any) => r.enabled !== false && r.path)
        .map((r: any) => ({
          name: r.path,
          info: r.info,
          strength: r.strength,
          fidelity: r.fidelity,
          referenceType: r.referenceType,
        })),
      resolution: lowerResolution(resol, scene.resolutionWidth, scene.resolutionHeight),
      sampling: job.sampling,
      steps: job.steps,
      cfgRescale: job.cfgRescale,
      noiseSchedule: job.noiseSchedule,
      promptGuidance: job.promptGuidance,
      seed: job.seed,
      useCoords: job.useCoords,
      legacyPromptConditioning: job.legacyPromptConditioning,
      normalizeStrength: job.normalizeStrength,
      varietyPlus: job.varietyPlus,
      deliberateEulerAncestralBug: job.deliberateEulerAncestralBug,
      model: 'anime',
    };
  }

  // 수집된 batch 전송: vibe miss 사전체크 → (동의 콜백) → batch-enqueue → mirror 매핑.
  // onVibeConsent: miss>0일 때 호출, false면 등록 취소(낙관적 등록 unwind). 미설정이면 진행.
  async flushBatchCollect(
    onVibeConsent?: (missCount: number) => Promise<boolean>,
  ): Promise<void> {
    this.batchCollecting = false;
    const buffered = this.batchBuffer;
    this.batchBuffer = [];
    if (buffered.length === 0) return;

    // vibe miss 사전체크 (Anlas 동의). 단일 세션 가정 (addAllToQueue = curSession).
    const sessionName = buffered[0].spec.sessionName;
    const vibeKey = new Map<string, { name: string; info: number }>();
    for (const b of buffered) {
      for (const v of b.spec.vibes || []) {
        vibeKey.set(`${v.name}&info=${v.info}`, { name: v.name, info: v.info });
      }
    }
    if (vibeKey.size > 0) {
      try {
        const { missing } = await this.backend.vibeCachePrecheck(
          sessionName,
          Array.from(vibeKey.values()),
        );
        if (missing.length > 0 && onVibeConsent) {
          const ok = await onVibeConsent(missing.length);
          if (!ok) {
            for (const b of buffered)
              this.unwindMirrorTaskIfPresent(b.task.id!, b.task, b.spec.sceneKey);
            this.dispatchProgress();
            return;
          }
        }
      } catch (e: any) {
        console.warn('[TaskQueue] vibe 사전체크 실패 (진행):', e?.message || e);
      }
    }

    // batch-enqueue 단일 전송.
    const specs = buffered.map((b) => b.spec);
    let reservations: Array<{
      taskId: string;
      reservationId: string | null;
      jobIds: string[];
      rejected: number;
    }>;
    try {
      ({ reservations } = await this.backend.batchEnqueue(specs, this.ownerId));
    } catch (e) {
      for (const b of buffered)
        this.unwindMirrorTaskIfPresent(b.task.id!, b.task, b.spec.sceneKey);
      this.dispatchProgress();
      throw e;
    }

    // 응답으로 mirror 매핑: jobIds → mirroredJobs, outstandingReservations, rejected 차감.
    const byTaskId = new Map(reservations.map((r) => [r.taskId, r]));
    for (const b of buffered) {
      const task = b.task;
      const taskId = task.id!;
      // flush await 사이 취소된 task는 매핑/unwind 스킵 (이미 정리됨 — 이중 처리 방지).
      if (!this.mirroredTasks.has(taskId)) continue;
      const r = byTaskId.get(taskId);
      if (!r || !r.reservationId) {
        // 전부 rejected(큐 가득) 또는 누락 → 이 task unwind.
        this.unwindMirrorTask(taskId, task, b.spec.sceneKey);
        continue;
      }
      if (r.rejected > 0) {
        this.groupStats[task.cls].total -= r.rejected;
        if (b.spec.sceneKey && b.spec.sceneKey in this.sceneStats) {
          this.sceneStats[b.spec.sceneKey].total -= r.rejected;
        }
        task.total -= r.rejected;
      }
      for (const jobId of r.jobIds) {
        this.mirroredJobs.set(jobId, { taskId, outputFilePath: '' });
      }
      // batch 예약은 outstandingReservations에 넣지 않음 (진단 Med-6). fill은 서버 bg가
      // 수행하므로 heartbeat 소유권도 서버 fill 루프에 있음(작업 중 bump). 클라가 넣으면
      // ① delete 경로가 없어 영구 잔존 → idle에도 30s heartbeat 영구 발화
      // ② 서버 fill 실패로 남은 예약을 살아있는 클라가 계속 bump → orphan 마킹 차단
      //    → 자동복구가 클라 종료 전까지 발동 불가.
    }
    this.dispatchProgress();
  }

  // gen/inpaint/i2i task를 server-mirror로 등록. prep N번 → batch push → WS event로 done 동기화.
  async addMirroredTask(task: Task) {
    const handler = this.handlers[task.cls] as GenerateImageTaskHandler;
    const taskId = task.id!;
    // mirror 낙관적 등록 (UI 카운터 instant + 첫 task면 paused). batch 수집과 공통 helper.
    const sceneKey = this.registerMirroredTaskOptimistic(task);

    const items: Array<{ params: ImageGenInput; meta: QueueJobMeta }> = [];
    const localOutputs: string[] = [];
    let reservationId: string | null = null;
    try {
      // 1단계: 서버에 예약(placeholder) 즉시 생성 — prep 전에 영속화돼서 새로고침해도 안 사라짐.
      const metas: QueueJobMeta[] = [];
      for (let i = 0; i < task.total; i++) {
        metas.push({
          taskId,
          cls: task.cls,
          sceneKey,
          sceneName: task.params.scene?.name,
          taskType: task.params.scene?.type,
          jobIndex: i + 1,
          jobTotal: task.total,
          ...(task.sceneGroup ? {
            sceneJobIndex: task.sceneGroup.sceneJobStartIndex + i,
            sceneJobTotal: task.sceneGroup.sceneJobTotal,
          } : {}),
        });
      }
      const reservation = await this.backend.queueReserve(metas, this.ownerId);
      reservationId = reservation.reservationId;
      if (reservationId) this.outstandingReservations.add(taskId);
      if (reservation.rejected > 0) {
        console.warn(`[TaskQueue] reserve rejected ${reservation.rejected} of ${task.total} (큐 가득 참)`);
        this.groupStats[task.cls].total -= reservation.rejected;
        if (sceneKey && (sceneKey in this.sceneStats)) {
          this.sceneStats[sceneKey].total -= reservation.rejected;
        }
        task.total -= reservation.rejected;
      }
      // jobId 매핑 (WS complete 이벤트 수신용)
      for (let i = 0; i < reservation.jobIds.length; i++) {
        this.mirroredJobs.set(reservation.jobIds[i], { taskId, outputFilePath: '' });
      }
      this.dispatchProgress();

      // 2단계: prep — vibe/ref 인코딩 (시간 소요). 이 사이 새로고침해도 서버에 예약이 남아있음.
      const run: TaskQueueRun = { stopped: false, delayCnt: 0 };
      for (let i = 0; i < task.total; i++) {
        const { arg, outputFilePath } = await handler.prepGenInput(task, run);
        localOutputs.push(outputFilePath);
        items.push({ params: arg, meta: metas[i] });
      }
      // outputFilePath 매핑 갱신 (prep 후에야 실제 경로 확정)
      for (let i = 0; i < reservation.jobIds.length && i < localOutputs.length; i++) {
        this.mirroredJobs.set(reservation.jobIds[i], { taskId, outputFilePath: localOutputs[i] });
      }

      // 3단계 폐지 (A): 직렬 체인 제거 — 각 씬이 독립 병렬로 fill(wait 누적 제거). 큐 순서는
      // 비보장(본인 무관). 미래에 순서 필요 시: 클라 병렬 유지 + 서버가 위 metas의
      // jobIndex/sceneJobIndex 순으로 genQueue 정렬(이 메타는 reserve 시 그대로 보존됨).

      // 4단계: fill — 예약에 실제 params를 채워 genQueue로 이동.
      try {
        await this.backend.queueFill(reservationId, items);
        this.outstandingReservations.delete(taskId);
        reservationId = null; // fill 성공
        this.dispatchProgress();
      } catch (fillErr: any) {
        if (this.isReservationGone(fillErr)) {
          // 404 = 서버가 이미 fill했는데 응답만 유실 (fill 시점은 tight라 2h 만료 아님).
          // 재예약하면 이중 enqueue·이중 Anlas → 성공으로 간주하고 중단.
          this.outstandingReservations.delete(taskId);
          reservationId = null;
          this.dispatchProgress();
        } else {
          // transient fill 실패(timeout/5xx 잔여). 이 씬만 백그라운드로 같은 reservationId
          // 재시도(prep 재실행 X = vibe 재인코딩 0 = Anlas 0). (A: 체인 없어 슬롯 release 불필요.)
          const retryReservationId = reservationId;
          const retryItems = items.slice();
          reservationId = null; // 소유권 백그라운드 이관 — outer catch/finally 중복 처리 방지
          this.retryFillBackground(retryReservationId, retryItems, taskId, sceneKey, task)
            .catch((e) => console.error('[TaskQueue] retryFillBackground crashed:', e));
        }
      }
    } catch (e: any) {
      // reserve/prep 단계 실패 (fill 실패는 위 inner catch에서 처리).
      // removeAllTasks / removeTasksFromScene가 이미 이 task를 정리했으면
      // stats가 이미 unwind된 상태 — 이중 차감하면 음수 카운트 발생.
      if (this.mirroredTasks.has(taskId)) {
        console.error(
          `[TaskQueue] addMirroredTask threw — stats unwound (sceneKey=${sceneKey || '(none)'} total=${task.total}):`,
          e?.message || e,
        );
        // reserve는 됐는데 prep이 throw → 서버 예약을 닫아 orphan(2h stuck) 방지.
        // (①prep throw는 같은 에러 무한 재시도 루프 방지 위해 자동 재예약 대상 아님 — 닫고 종료.)
        if (reservationId) { this.closeReservation(taskId); this.outstandingReservations.delete(taskId); }
        this.unwindMirrorTask(taskId, task, sceneKey);
        this.dispatchProgress();
        throw e;
      }
      this.dispatchProgress();
    } finally {
      items.length = 0;
      localOutputs.length = 0;
    }
  }

  private isReservationGone(e: any): boolean {
    // queueFill이 404를 받으면 api()가 'API error 404: ...' 메시지로 throw.
    return /API error 404\b/.test(String(e?.message || ''));
  }

  // 실패한 예약을 서버에서 targeted 정리(전체 nuke 아님) — orphan 방지. cancel-by-task-ids는
  // reserved + genQueue 양쪽에서 taskId 잡 제거. fill 전이라 genQueue엔 이 task 잡이 없어
  // reserved만 정리됨. mirroredJobs의 stale 매핑도 같이 청소.
  private closeReservation(taskId: string) {
    this.backend.cancelQueueByTaskIds([taskId]).catch((e) =>
      console.warn('[TaskQueue] closeReservation failed:', e?.message || e));
    for (const [jobId, j] of this.mirroredJobs) {
      if (j.taskId === taskId) this.mirroredJobs.delete(jobId);
    }
  }

  // mirror task의 stats/등록 정보 unwind (실패 공통 경로).
  private unwindMirrorTask(taskId: string, task: Task, sceneKey: string) {
    this.groupStats[task.cls].total -= task.total;
    if (sceneKey && sceneKey in this.sceneStats) {
      this.sceneStats[sceneKey].total -= task.total;
      if (this.sceneStats[sceneKey].total <= 0 && this.sceneStats[sceneKey].done <= 0) {
        delete this.sceneStats[sceneKey];
      }
    }
    this.mirroredTasks.delete(taskId);
    this.mirrorTaskSceneKeys.delete(taskId);
    this.mirrorRunStartTimes.delete(taskId);
    delete this.taskSet[taskId];
  }

  // mirror에 아직 살아있을 때만 unwind (이중 차감=stats 음수 방지). flush await 사이에
  // 사용자 취소(removeAllTasks)가 같은 task를 이미 unwind했을 수 있어 가드.
  private unwindMirrorTaskIfPresent(taskId: string, task: Task, sceneKey: string) {
    if (this.mirroredTasks.has(taskId)) this.unwindMirrorTask(taskId, task, sceneKey);
  }

  // fill만 백그라운드 재시도 (prep 재실행 X = Anlas 0, 같은 reservationId = 이중 enqueue 방지).
  // 5s → 15s → 30s 3회. 소진 시 예약 닫고 에러 토스트. 사용자가 그 사이 취소하면 조용히 중단.
  private async retryFillBackground(
    reservationId: string,
    items: Array<{ params: ImageGenInput; meta: QueueJobMeta }>,
    taskId: string,
    sceneKey: string,
    task: Task,
  ) {
    const backoffs = [5000, 15000, 30000];
    for (let i = 0; i < backoffs.length; i++) {
      await new Promise((r) => setTimeout(r, backoffs[i]));
      try {
        await this.backend.queueFill(reservationId, items);
        this.outstandingReservations.delete(taskId);
        this.dispatchProgress();
        return; // 성공 → 대기로 이동 완료
      } catch (e: any) {
        // 404 = 서버 예약이 사라짐 = (a) 사용자 취소(cancelQueue/cancelQueueByTaskIds가
        // reserved 제거) 또는 (b) 이미 fill됨. 둘 다 재예약하면 안 됨 → 중단. 클라
        // mirroredTasks 상태가 아니라 서버 truth(404)로 판정 — 30s 폴링 restore가
        // mirroredTasks에서 task를 빼도(restore는 reserved 재구축 X) 예약은 서버에
        // 살아있어 계속 재시도/정리 가능.
        if (this.isReservationGone(e)) { this.outstandingReservations.delete(taskId); return; }
        console.warn(`[TaskQueue] fill 재시도 ${i + 1}/${backoffs.length} 실패 (taskId=${taskId}):`, e?.message || e);
      }
    }
    // 재시도 소진 → 슬림 B 꼬리: 닫지 않고 *남겨서* orphan 자동복구에 인계. heartbeat 중단(아래 delete)으로
    // 예약이 stale → sweep이 orphan 마킹 → 자동복구가 재예약(reuse, Anlas 0). 무한 루프는 자동복구
    // (App.tsx)의 sceneKey별 재예약 횟수 캡으로 차단. 클라 task는 unwind(재예약이 fresh task 생성).
    this.outstandingReservations.delete(taskId);
    if (this.mirroredTasks.has(taskId)) {
      this.unwindMirrorTask(taskId, task, sceneKey);
      getAppState().pushMessage('큐 등록이 지연돼 자동 복구 대기 중이에요 (곧 다시 시도).');
      this.dispatchProgress();
    }
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
    } else if (sceneKey) {
      // restored mirror task — task.params 빈 placeholder라 afterGenComplete 스킵됨.
      // 본인 2회 보고 "씬 들어간 동안 큐 완성 이미지 안 보임"의 break 지점 — ResultViewer가
      // sceneKey 받아 imageService.refresh 직접 트리거할 수 있게 통보. (이전엔 2.5초 disk
      // polling으로 안전망 잡았는데 모바일 발열 원인이라 reactive 이벤트로 대체.)
      this.dispatchEvent(
        new CustomEvent('scene-job-complete', { detail: { sceneKey } }),
      );
    }
    this.mirroredJobs.delete(data.jobId);
    this.progressCycleStartedAt = Date.now();
    this.dispatchEvent(new CustomEvent('complete', {}));
    this.dispatchProgress();
    if (task.done >= task.total) {
      this.mirroredTasks.delete(job.taskId);
      this.mirrorTaskSceneKeys.delete(job.taskId);
      delete this.taskSet[job.taskId];
      if (this.mirroredTasks.size === 0) {
        this.mirrorPaused = false;
        if (!this.currentRun) this.dispatchEvent(new CustomEvent('stop', {}));
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
      this.mirrorTaskSceneKeys.delete(job.taskId);
      delete this.taskSet[job.taskId];
      if (this.mirroredTasks.size === 0) {
        this.mirrorPaused = false;
        if (!this.currentRun) this.dispatchEvent(new CustomEvent('stop', {}));
      }
    }
  }

  // 페이지 로드 / WS reconnect / 30s polling 시: 서버 큐의 jobs를 meta.taskId로 그룹화하고
  // mirroredTasks 전체 재구성. idempotent — 매번 기존 mirror state unwind 후 재구축.
  // task.params는 서버에 저장 안 됨 → 빈 placeholder. 알약/리스트 표시만 가능, imageService 갱신 X.
  async restoreMirroredState() {
    // single-flight: 진행 중이면 같은 promise를 반환 (concurrent unwind+rebuild의 중복 누적 차단).
    if (this.restoreInFlight) return this.restoreInFlight;
    this.restoreInFlight = (async () => {
      // C-mini lock: addMirroredTask가 fill await 중이면 그 사이 mirroredTasks.clear()로
      // 방금 add한 task가 wipe됨 — 본인 페인 (2026-05-18): "예약 배지 안 뜨다가 큐 목록엔
      // 있음, 이중 등록 위험". (A: 직렬 체인 폐지 → 진행 중 add 전부 대기로 동등 보존.)
      await Promise.allSettled([...this.pendingAdds]);
      await this._doRestoreMirroredState();
    })().finally(() => {
      this.restoreInFlight = null;
    });
    return this.restoreInFlight;
  }

  private async _doRestoreMirroredState() {
    const full = await this.backend.queueGetFullState();

    // 옛 mirror state snapshot — taskId → {done, total}. 폴링/reconnect 시점에 옛 mirror
    // task가 server jobs에도 남아있으면 done + total 보존. 본인 페인 (P21 F2): "씬 숫자
    // 0에서 안 바뀌고" — 옛 흐름은 같은 taskId 재구축 시 done=0, total=jobs.length로
    // reset → 매 30s 폴링마다 카운터 0 reset 부수효과. 새 흐름은 옛 done 그대로,
    // total은 max(옛_total, 옛_done + jobs.length)로 단조 유지.
    const prev = new Map<string, { done: number; total: number }>();
    for (const [taskId, task] of this.mirroredTasks) {
      prev.set(taskId, { done: task.done, total: task.total });
    }

    // 기존 mirror state 전체 unwind (groupStats/sceneStats 정확히 빼기)
    for (const [taskId, task] of this.mirroredTasks) {
      this.groupStats[task.cls].total -= task.total;
      this.groupStats[task.cls].done -= task.done;
      const sk = this.mirrorTaskSceneKeys.get(taskId);
      if (sk && sk in this.sceneStats) {
        this.sceneStats[sk].total -= task.total;
        this.sceneStats[sk].done -= task.done;
        if (this.sceneStats[sk].total <= 0 && this.sceneStats[sk].done <= 0) {
          delete this.sceneStats[sk];
        }
      }
      delete this.taskSet[taskId];
    }
    this.mirroredTasks.clear();
    this.mirroredJobs.clear();
    this.mirrorRunStartTimes.clear();
    this.mirrorTaskSceneKeys.clear();

    // server paused 상태 sync
    this.mirrorPaused = !!(full.paused || full.pauseRequested);

    const groups = new Map<string, Array<{ jobId: string; meta: QueueJobMeta; outputFilePath?: string }>>();
    for (const j of full.jobs) {
      if (!j.meta || !j.meta.taskId) continue; // legacy job (meta 없음) 스킵
      if (!groups.has(j.meta.taskId)) groups.set(j.meta.taskId, []);
      groups.get(j.meta.taskId)!.push(j);
    }
    if (groups.size === 0) {
      this.mirrorPaused = false; // 큐 비면 paused 의미 없음
      this.dispatchProgress();
      return;
    }
    for (const [taskId, jobs] of groups) {
      const meta = jobs[0].meta;
      const cls = meta.cls ?? 0;
      // params는 placeholder. scene은 meta.sceneName/taskType으로 fake 객체 — getInfo에서 name 표시용.
      // session/job는 없음. handleMirroredComplete에서 task.params.session 체크해서 afterGenComplete 스킵.
      const placeholderScene = meta.sceneName
        ? ({ name: meta.sceneName, type: meta.taskType || 'scene', _sceneKey: meta.sceneKey } as any)
        : (undefined as any);
      // task 단위 priority — 한 task의 어떤 job이라도 priority면 task 통째로 priority 취급.
      // 서버는 task의 모든 jobs를 한 묶음으로 prioritize하니 보통 일치하지만 race 시 보호용.
      const hasPriority = jobs.some((j: any) => !!j.priority);
      // 같은 taskId가 옛 mirror에도 있으면 옛 done + total 보존(단조 유지). 본인 페인 (P21 F2)
      // 카운터 0 reset 차단. 옛 mirror에 없는 신규(or page reload 후) task는 server meta의
      // jobTotal로 originalTotal 복구 — meta.jobTotal은 task 첫 등록 시 task.total로 sealed돼
      // 큐에 남아있는 jobs N개 모두 동일 값 보유. P22 F1 (2026-05-22 본인 페인): F5/Ctrl+Shift+R
      // 새로고침 시 taskCommitsRef + prev mirror state 둘 다 휘발 → 분모가 jobs.length(=남은 잡)로
      // sealed돼 deflate. 처방: prev 없으면 meta.jobTotal로 분모 복구 + done = jobTotal - 남은 잡 추정.
      const metaTaskTotal = jobs[0].meta?.jobTotal;
      const hasMetaTotal = typeof metaTaskTotal === 'number' && metaTaskTotal > 0;
      const prevTask = prev.get(taskId);
      let restoredDone: number;
      let restoredTotal: number;
      if (prevTask) {
        restoredDone = prevTask.done;
        restoredTotal = Math.max(prevTask.total, hasMetaTotal ? metaTaskTotal! : restoredDone + jobs.length);
      } else if (hasMetaTotal) {
        restoredTotal = metaTaskTotal!;
        restoredDone = Math.max(0, metaTaskTotal! - jobs.length);
      } else {
        // legacy meta(jobTotal 없음)의 큐 — 옛 동작 그대로
        restoredTotal = jobs.length;
        restoredDone = 0;
      }
      const restoredTask: Task = {
        id: taskId,
        cls,
        params: {
          session: undefined as any,
          job: undefined as any,
          outputPath: '',
          scene: placeholderScene,
        },
        done: restoredDone,
        total: restoredTotal,
        priority: hasPriority,
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
        this.groupStats[cls].total += restoredTotal;
        this.groupStats[cls].done += restoredDone;
      }
      if (meta.sceneKey) {
        if (!(meta.sceneKey in this.sceneStats)) {
          this.sceneStats[meta.sceneKey] = { done: 0, total: 0 };
        }
        this.sceneStats[meta.sceneKey].total += restoredTotal;
        this.sceneStats[meta.sceneKey].done += restoredDone;
      }
      this.mirrorTaskSceneKeys.set(taskId, meta.sceneKey || '');
    }
    this.dispatchProgress();
    this.progressCycleStartedAt = Date.now();
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
    // mirrorPaused는 stop()으로 server 큐 pause + mirroredTasks 보존 상태. paused면 isRunning=false로
    // 처리해서 버튼이 ▶ (resume)으로 전환되게. 본인 페인 (2026-05-15): "일시정지 다시 눌러도
    // 시작으로 안 바뀌고 큐가 안 들어감" — 옛 isRunning은 mirroredTasks.size만 봐서 paused 상태에서도
    // true 반환 → 버튼이 ⏸로 고정 → 재클릭 시 또 stop() 호출로 무동작 chain.
    if (this.currentRun != undefined) return true;
    if (this.mirroredTasks.size > 0 && !this.mirrorPaused) return true;
    return false;
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
      this.backend.pauseQueue().catch((e) => console.warn('[TaskQueue] pauseQueue failed:', e));
      this.mirrorPaused = true;
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
      this.backend.resumeQueue().catch((e) => console.warn('[TaskQueue] resumeQueue failed:', e));
      this.mirrorPaused = false;
    }
    if (!this.currentRun && !this.queue.isEmpty()) {
      this.currentRun = {
        stopped: false,
        delayCnt: this.getDelayCnt(),
      };
      this.runInternal(this.currentRun);
    }
    if (this.currentRun || this.mirroredTasks.size > 0) {
      this.progressCycleStartedAt = Date.now();
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
    if (retryIndex < 10) return 120 * 1000;
    return 180 * 1000;
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
    const config = await this.backend.getConfig();
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
          this.progressCycleStartedAt = Date.now();
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
            // Models M: abortable 60s sleep — 500ms tick으로 cur.stopped 체크. 옛 코드는
            // 사용자 stop/pause를 60초 후에야 인지. server M1 (interruptibleSleep) 패턴과 결.
            const sleepStart = Date.now();
            while (Date.now() - sleepStart < 60_000) {
              if (cur.stopped) break;
              await sleep(Math.min(500, 60_000 - (Date.now() - sleepStart)));
            }
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
  // 씬 그룹 총 jobs = prompts.length(조합 수) × samples. 각 task의 sceneJobStartIndex는
  // (i-th prompt → i*samples+1). queue.html이 'sceneName N/M' 표시할 때 N = M 중 진행 위치.
  const sceneJobTotal = prompts.length * samples;
  for (let i = 0; i < prompts.length; i++) {
    await def.handler(
      session,
      scene,
      prompts[i].prompt,
      characterPrompts[i],
      preset,
      shared,
      samples,
      scene_.meta.get(type),
      undefined,
      undefined,
      prompts[i].uc,
      { sceneJobTotal, sceneJobStartIndex: i * samples + 1 },
    );
  }
};

const copyQuickAssetIfMissing = async (src: string, dest: string) => {
  const { backend } = requireTaskQueueRuntime();
  try {
    if (await backend.existFile(dest)) return;
    if (!(await backend.existFile(src))) return;
    await backend.copyFile(src, dest);
  } catch (error) {
    console.warn('[Quick] preset asset copy failed:', src, error);
  }
};

async function copyQuickPresetAssets(from: Session, to: Session, shared: any) {
  const { imageService } = requireTaskQueueRuntime();
  for (const vibe of shared?.vibes ?? []) {
    if (!vibe?.path) continue;
    await copyQuickAssetIfMissing(
      imageService.getVibeImagePath(from, vibe.path),
      imageService.getVibeImagePath(to, vibe.path),
    );
    await copyQuickAssetIfMissing(
      imageService.getEncodedVibeImagePath(from, vibe.path, vibe.info),
      imageService.getEncodedVibeImagePath(to, vibe.path, vibe.info),
    );
  }
  for (const reference of shared?.characterReferences ?? []) {
    if (reference?.enabled === false || !reference?.path) continue;
    await copyQuickAssetIfMissing(
      imageService.getReferenceImagePath(from, reference.path),
      imageService.getReferenceImagePath(to, reference.path),
    );
  }
}

// Quick은 현재 프로젝트의 프롬프트/프리셋을 해석하되, 생성 task와 결과는 전용
// 숨김 프로젝트에 귀속한다. 두 Session 인자를 하나로 합치면 출력 경로나 설정 중
// 한쪽이 바뀌므로 의도적으로 분리한다.
export const queueQuickWorkflow = async (
  promptSession: Session,
  outputSession: Session,
  scene: Scene,
  samples: number,
) => {
  const workflow = promptSession.selectedWorkflow;
  if (!workflow) throw new Error('워크플로우를 먼저 선택해주세요');
  const [type, preset, shared, def] = promptSession.getCommonSetup(workflow);
  const prompts = await def.createPrompt!(promptSession, scene, preset, shared);
  const characterPrompts = await def.createCharacterPrompts!(
    promptSession,
    scene,
    preset,
    shared,
  );
  await copyQuickPresetAssets(promptSession, outputSession, shared);
  const sceneJobTotal = prompts.length * samples;
  for (let index = 0; index < prompts.length; index += 1) {
    await def.handler(
      outputSession,
      scene,
      prompts[index].prompt,
      characterPrompts[index],
      preset,
      shared,
      samples,
      scene.meta.get(type),
      undefined,
      undefined,
      prompts[index].uc,
      { sceneJobTotal, sceneJobStartIndex: index * samples + 1 },
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
  const { workFlowService } = requireTaskQueueRuntime();
  const def = workFlowService.getDef(type);
  // 1차 가드: 마스크 필수 워크플로우(인페인트)인데 마스크가 비어있으면 큐 등록 차단.
  // 빈 마스크면 nai-client가 mask 필드를 빼고 NAI에 보내 NAI가 500을 돌려주고,
  // retry 10번 모두 실패 → 사용자 페인 (JOURNAL P20 #9, P28 재발). 모든 인페인트
  // 등록 경로(queueScene / InPaintEditor / ResultViewer / SceneQueueControl)가
  // 이 함수를 공통 통로로 거치므로 여기 한 곳에 두면 우회 경로가 없음.
  if (def?.hasMask && !preset.mask) {
    getAppState().pushMessage('마스크를 먼저 그려주세요. 인페인트는 마스크 없이 생성할 수 없어요.');
    throw new Error('인페인트 마스크가 없어 큐에 등록하지 않았어요.');
  }
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
  const { imageService, workFlowService } = requireTaskQueueRuntime();
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
    preset.image = await imageService.storeGenerationVibeImage(session, result.canvas);
    preset.mask = await imageService.storeGenerationVibeImage(session, result.mask);
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
