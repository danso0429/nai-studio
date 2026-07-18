// ImageHistoryService가 AppService 모듈을 역참조하면 models/index 초기화 고리에
// AppService가 다시 들어간다. 히스토리에 필요한 최소 구조만 여기서 정의해 이 ref를
// 의존성 leaf로 유지한다.
export interface AppStateRefValue {
  curSession?: { name: string };
  pushMessage(message: string): void;
}

let appStateRef: AppStateRefValue | null = null;

export function setAppState(appState: AppStateRefValue): void {
  appStateRef = appState;
}

export function getAppState(): AppStateRefValue {
  if (!appStateRef) throw new Error('AppState has not been initialized');
  return appStateRef;
}
