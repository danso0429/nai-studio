import { ModelVersion } from '../backends/imageGen';

export type ImageEditor = 'photoshop' | 'gimp' | 'mspaint';

export type ModelType = 'fast' | 'quality';

export type RemoveBgQuality =
  | 'low'
  | 'normal'
  | 'high'
  | 'veryhigh'
  | 'veryveryhigh';

export interface DownloadSettings {
  lastSavePath?: string;
  defaultPrefix?: string;
  defaultSuffix?: string;
  autoNumbering?: boolean;
  overwriteExisting?: boolean;
  includeTimestamp?: boolean;
}

export interface ImageSaveSettings {
  autoSaveEnabled?: boolean; // 자동 저장 활성화 여부 (기본값: true - 하위 호환성)
  saveToHistory?: boolean; // 히스토리에 저장 (기본값: true)
}

export interface Config {
  imageEditor?: ImageEditor;
  modelType?: ModelType;
  removeBgQuality?: RemoveBgQuality;
  useLocalBgRemoval?: boolean;
  useCUDA?: boolean;
  saveLocation?: string;
  noIpCheck?: boolean;
  refreshImage?: boolean;
  uuid?: string;
  whiteMode?: boolean;
  disableQuality?: boolean;
  modelVersion?: ModelVersion;
  delayTime?: number;
  furryMode?: boolean;
  downloadSettings?: DownloadSettings;
  imageSaveSettings?: ImageSaveSettings;
  classicSceneCard?: boolean;
  // 씬 카드(프로젝트 그리드) 초기 썸네일 크기. undefined면 화면 폭으로 자동 결정.
  // 본인 페인 (P12 #8, 인터넷 느린 환경): 옛 흐름은 모바일 200 / 데스크탑 500
  // 하드코딩이라 인터넷 느릴 때 초기 로드 무거움. 작은 폭 화면에서는 더 작은
  // 크기로 출발 + 데스크탑 큰 화면 PC는 그대로 유지. 자동 override는 ConfigScreen.
  // 후보 값: 80 / 200 / 400 / 500.
  initialThumbSize?: number;
  promptPresetId?: string;
  samplingPresetId?: string;
  trueDark?: boolean;
  exportConcurrency?: number;
}
