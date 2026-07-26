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
  // 새 폴더 드로어 UI 사용 여부 (off면 옛 SessionTreePicker 모달). 기본 true.
  useProjectDrawer?: boolean;
  // foreground-free 일괄 등록 (batch-enqueue) — 일반 SDImageGen 씬 일괄 예약 시 클라가
  // prompt만 만들어 단일 fetch로 보내고 서버가 vibe/ref 인코딩+reserve+fill. 기본 false.
  useBatchEnqueue?: boolean;
  // 씬 카드(프로젝트 그리드) 초기 썸네일 크기. undefined면 화면 폭으로 자동 결정.
  // 본인 페인 (P12 #8, 인터넷 느린 환경): 옛 흐름은 모바일 200 / 데스크탑 500
  // 하드코딩이라 인터넷 느릴 때 초기 로드 무거움. 작은 폭 화면에서는 더 작은
  // 크기로 출발 + 데스크탑 큰 화면 PC는 그대로 유지. 자동 override는 ConfigScreen.
  // 후보 값: 80 / 200 / 400 / 500.
  initialThumbSize?: number;
  // 최근 생성 히스토리 썸네일/패널 크기 비율. 100이 기존 크기, 허용 범위 60~100.
  historyThumbnailPercent?: number;
  samplingPresetId?: string;
  trueDark?: boolean;
  exportConcurrency?: number;
  autoConvertWebp?: boolean;
  autoConvertWebpQuality?: number;
  uiTheme?: UiThemeConfig;
  uiThemePresets?: UiThemePreset[];
  uiToolbar?: UiToolbarConfig;
  quickMenu?: string[];
  quickMenuButton?: boolean;
  uiCompanionSlots?: Record<string, string[]>;
  uiLayoutTemplate?: string;
  uiLayoutSlots?: UiLayoutSlots;
  genWidget?: GenWidgetConfig;
  // Remote는 기존 Noto Sans KR 웹폰트와 OS 시스템 글꼴을 선택한다.
  uiFont?: 'noto' | 'system';
  uiClassicFinish?: boolean;
  // false(기본)=씬의 중간/네거티브 입력을 먼저 표시, true=기존 전체 프리셋 폼.
  legacySceneEditor?: boolean;
  uiPresetLayout?: Record<string, string[]>;
  legacyWorkflowMode?: boolean;
  uiFloatViewMode?: 'cover' | 'center';
}

export type ToolbarButtonPlacement = 'default' | 'pinned' | 'menu' | 'hidden';

export interface UiToolbarAreaLayout {
  inline?: string[];
  menu?: string[];
  hidden?: string[];
}

export interface UiToolbarConfig {
  classic?: boolean;
  buttons?: Record<string, ToolbarButtonPlacement>;
  areas?: Record<string, UiToolbarAreaLayout>;
  schema?: 2;
}

export interface UiLayoutSlots {
  presetSide?: 'left' | 'right';
  historySide?: 'left' | 'right';
  projectSide?: 'left' | 'right';
  genControl?: 'docked' | 'floating';
}

export interface GenWidgetConfig {
  x?: number;
  y?: number;
}

export interface UiThemePreset {
  name: string;
  whiteMode: boolean;
  trueDark?: boolean;
  theme: UiThemeConfig;
}

export interface UiThemeConfig {
  surface?: string;
  surface2?: string;
  inputBg?: string;
  zoneBg?: string;
  lineColor?: string;
  textPattern?: 'light' | 'dark';
  unifyButtons?: boolean;
  accent?: string;
  neutral?: string;
  danger?: string;
  buttons?: {
    green?: string;
    sky?: string;
    orange?: string;
    gray?: string;
    red?: string;
  };
}
