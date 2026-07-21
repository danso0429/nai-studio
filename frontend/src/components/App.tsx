import './App.css';
import './contexify.css';
import {
  Component,
  ReactNode,
  useEffect,
  useState,
  useRef,
} from 'react';
import { extractApiError, buildDanbooruSearchUrl } from '../models/util';
import SessionSelect from './SessionSelect';
import PreSetEditor from './PreSetEditor';
import { SceneCell, queueScene } from './SceneQueueControl';
import TaskQueueControl, { TaskQueueProgress, TaskQueueControls } from './TaskQueueControl';
import TobBar from './TobBar';
import AlertWindow from './AlertWindow';
import ProjectDrawer from './ProjectDrawer';
import DriveRetryWidget from './DriveRetryWidget';
import ExportPresetsDialog from './ExportPresetsDialog';
import ExportOptionsForm from './ExportOptionsForm';
import CustomResolutionDialog from './CustomResolutionDialog';
import SceneNameExportForm from './SceneNameExportForm';
import { DropdownSelect, TabComponent } from './UtilComponents';
import PieceEditor, { PieceCell } from './PieceEditor';
import PromptTooltip from './PromptTooltip';
import ConfirmWindow from './ConfirmWindow';
import MultiImportNameDialog from './MultiImportNameDialog';
import ProjectCopyDialog from './ProjectCopyDialog';
import FolderBackupImportDialog from './FolderBackupImportDialog';
import QueueControl from './SceneQueueControl';
import { FloatView, FloatViewProvider } from './FloatView';
import { observer } from 'mobx-react-lite';
import { FaBolt, FaImages, FaPenFancy, FaStar, FaPalette, FaSearch } from 'react-icons/fa';
import { GlobalPresetTab, GlobalPresetPickerOverlay } from './GlobalPresetTab';
import ArtistLibraryTab from './ArtistLibraryTab';
import TagSearchTab from './TagSearchTab';
import ModalOverlay from './ModalOverlay';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { TouchBackend } from 'react-dnd-touch-backend';
import { usePreview } from 'react-dnd-preview';

import React from 'react';
import { CellPreview } from './ResultViewer';
import { SlotPiece } from './SceneEditor';
import { StackFixed, StackGrow, VerticalStack } from './LayoutComponents';
import ProgressWindow from './ProgressWindow';
import ResizableSplitter from './ResizableSplitter';
import {
  taskQueueService,
  backend,
  sessionService,
  localAIService,
  imageService,
  isMobile,
  globalPieceService,
  globalPresetService,
  globalCharacterPresetService,
  artistLibraryService,
  promptChunkService,
  toggleGroupService,
  samplingPresetService,
} from '../models';
import { appState, LAST_PROJECT_KEY, LAST_TAB_KEY } from '../models/AppService';
import { keyboardShortcutService } from '../models/KeyboardShortcutService';
import { AppContextMenu } from './AppContextMenu';

import { configure } from 'mobx';
import { ExternalImageView } from './ExternalImageView';
import FindReplaceDialog from './FindReplaceDialog';
import SceneImporterDialog from './SceneImporterDialog';
import { BuildInfoBadge } from './BuildInfo';
import { ImageHistoryDrawer, ImageHistoryHandle, ImageHistoryPanel } from './ImageHistory';
import QuickModeTab from './QuickModeTab';
import { buildThemeVars } from '../models/uiTheme';
configure({
  enforceActions: 'never',
});

// React remount/StrictMode에서도 같은 store read 실패를 한 페이지에서 중복 안내하지 않는다.
const reportedGlobalStoreLoadFailures = new Set<string>();

interface ErrorBoundaryProps {
  children: ReactNode;
  onErr?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    if (this.props.onErr) {
      this.props.onErr(error, errorInfo);
    }
  }

  render() {
    return this.props.children;
  }
}

const DnDPreview = () => {
  const preview = usePreview();
  if (!preview.display) {
    return null;
  }
  const { itemType, item, style } = preview;
  style['rotate'] = '2deg';
  style['transformOrigin'] = 'center';
  let res: any = null;
  if (itemType === 'scene') {
    const { scene, curSession, getImage, cellSize } = item as any;
    res = (
      <SceneCell
        scene={scene}
        curSession={curSession}
        getImage={getImage}
        cellSize={cellSize}
        style={style}
      />
    );
  } else if (itemType === 'image') {
    const { path, cellSize, imageSize } = item as any;
    res = (
      <CellPreview
        path={path}
        cellSize={cellSize}
        imageSize={imageSize}
        style={style}
      />
    );
  } else if (itemType === 'piece') {
    res = <PieceCell {...(item as any)} style={style} />;
  } else if (itemType === 'slot') {
    res = <SlotPiece {...(item as any)} style={style} />;
  } else {
    return <></>;
  }
  return res;
};

export const App = observer(() => {
  // 하단 바(SessionSelect 버튼 + 큐 컨트롤)는 버튼이 많으면 2~3행으로 줄바꿈돼 높이가
  // 가변. ResultViewer 이미지 뷰어(FloatView .show-toolbar)는 화면 바닥에서 하단 바
  // 높이만큼 비워야 가리지 않는데, 옛 CSS는 57px(1행) 하드코딩이라 3행이면 하단 바
  // 위쪽을 덮었음 (JOURNAL P28). 실제 높이를 측정해 --bottombar-h로 노출 → CSS가 사용.
  const bottomBarRef = useRef<HTMLDivElement>(null);
  // 작가 라이브러리 카드/프롬프트에서 보낸 danbooru 검색 요청 → 새 탭으로 열기.
  // 우리는 EmbeddedBrowser(PC 앱내 웹탭)가 없어 PC/모바일 모두 window.open. (SDStudio 4.13 389d6fb)
  useEffect(() => {
    const handleRequest = (e: Event) => {
      const text = (e as CustomEvent).detail?.text;
      if (!text) return;
      const url = buildDanbooruSearchUrl(text);
      if (url) window.open(url, '_blank');
    };
    window.addEventListener('danbooru-search-request', handleRequest);
    return () => window.removeEventListener('danbooru-search-request', handleRequest);
  }, []);
  useEffect(() => {
    const el = bottomBarRef.current;
    if (!el) return;
    const update = () => {
      document.documentElement.style.setProperty('--bottombar-h', el.offsetHeight + 'px');
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    return () => {
      taskQueueService.stop();
    };
  }, []);

  // 단축키 이벤트 수신
  useEffect(() => {
    const handler = (e: Event) => {
      const action = (e as CustomEvent).detail?.action;
      switch (action) {
        case 'toggle-left-panel':
          appState.toggleLeftPanel();
          break;
        case 'toggle-project-favorite':
          if (appState.curSession) {
            sessionService.toggleFavorite(appState.curSession.name).then(() => {
              const isFav = sessionService.isFavorite(appState.curSession!.name);
              appState.pushMessage(isFav ? '즐겨찾기에 추가되었습니다' : '즐겨찾기에서 제거되었습니다');
            });
          }
          break;
        case 'open-piece-editor':
          if (appState.curSession) {
            appState.openPieceEditor();
          }
          break;
        case 'find-replace':
          if (appState.curSession) {
            appState.openFindReplace();
          }
          break;
        case 'toggle-history-panel':
          if (isMobile) appState.toggleHistoryDrawer();
          else appState.toggleHistoryPanel();
          break;
      }
    };
    window.addEventListener('shortcut-action', handler);
    return () => window.removeEventListener('shortcut-action', handler);
  }, []);

  const [darkMode, setDarkMode] = useState(false);
  const [trueDark, setTrueDark] = useState(false);
  const [themeVars, setThemeVars] = useState<Record<string, string>>({});
  // portal로 document.body에 렌더되는 자식(TaskQueueList, Tooltip 등)은 App inner div의
  // dark 클래스 ancestor 범위 밖이라 Tailwind `dark:` variant가 안 먹는다. documentElement에
  // 같이 토글해서 portal까지 ancestor 매칭이 닿게 한다.
  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    document.documentElement.classList.toggle('true-dark', darkMode && trueDark);
  }, [darkMode, trueDark]);
  useEffect(() => {
    document.documentElement.classList.toggle(
      'custom-theme',
      Object.keys(themeVars).length > 0,
    );
    for (const [name, value] of Object.entries(themeVars)) {
      document.documentElement.style.setProperty(name, value);
    }
    return () => {
      document.documentElement.classList.remove('custom-theme');
      for (const name of Object.keys(themeVars)) {
        document.documentElement.style.removeProperty(name);
      }
    };
  }, [themeVars]);
  // 폴더 삭제(백그라운드 fire-and-forget) 진행도 — App.tsx 최상위 글로벌 구독이라
  // SessionTreePicker가 닫혀도 진행/완료가 끊기지 않음. jobId로 진행도 토스트 매칭.
  useEffect(() => {
    const pid = (jobId: string) => 'delete-folder-' + jobId;
    const unsubStart = backend.onDeleteFolderStart((d) => {
      void sessionService.observeFolderDeletionStart(d.folder).catch((e) => {
        console.error('[folder-delete] failed to acquire resource lease:', e);
      });
      appState.pushPinnedProgress(
        pid(d.jobId),
        `"${d.folder}" 폴더 삭제 중… (0/${d.total})`,
        Math.max(1, d.total),
      );
    });
    const unsubProgress = backend.onDeleteFolderProgress((d) => {
      appState.updatePinnedProgress(pid(d.jobId), {
        text: `"${d.folder}" 폴더 삭제 중… (${d.done}/${d.total})` +
          (d.errors > 0 ? ` · 오류 ${d.errors}` : ''),
        done: d.done,
      });
    });
    const unsubDone = backend.onDeleteFolderDone((d) => {
      appState.finishPinnedProgress(
        pid(d.jobId),
        `✓ "${d.folder}" 폴더 삭제 완료 — 프로젝트 ${d.deletedProjects}개` +
          (d.errors.length > 0 ? ` · 오류 ${d.errors.length}건` : ''),
        d.errors.length === 0,
        5000,
      );
      void sessionService.finishFolderDeletion(d.folder, true).catch((e) => {
        console.error('[folder-delete] completion reconcile failed:', e);
      });
    });
    const unsubError = backend.onDeleteFolderError((d) => {
      appState.finishPinnedProgress(
        pid(d.jobId),
        `✗ "${d.folder}" 폴더 삭제 실패: ${d.error}`,
        false,
        7000,
      );
      void sessionService.finishFolderDeletion(d.folder, false).catch((e) => {
        console.error('[folder-delete] error reconcile failed:', e);
      });
    });
    return () => {
      unsubStart();
      unsubProgress();
      unsubDone();
      unsubError();
    };
  }, []);
  // 이미지 일괄 삭제(백그라운드 fire-and-forget) 진행도 — 폴더 삭제와 동일하게 App.tsx
  // 글로벌 구독이라 씬 picker가 닫혀도·다른 프로젝트로 가도 진행/완료가 끊기지 않음.
  useEffect(() => {
    const pid = (jobId: string) => 'image-delete-' + jobId;
    const unsubStart = backend.onImageDeleteStart((d) => {
      appState.pushPinnedProgress(
        pid(d.jobId),
        `이미지 삭제 중… (0/${d.total})`,
        Math.max(1, d.total),
      );
    });
    const unsubProgress = backend.onImageDeleteProgress((d) => {
      appState.updatePinnedProgress(pid(d.jobId), {
        text:
          `이미지 삭제 중… (${d.done}/${d.total})` +
          (d.errors > 0 ? ` · 오류 ${d.errors}` : ''),
        done: d.done,
      });
    });
    const unsubDone = backend.onImageDeleteDone((d) => {
      appState.handleImageDeleteDone(d.jobId);
      appState.finishPinnedProgress(
        pid(d.jobId),
        `✓ 이미지 삭제 완료 (${d.done}/${d.total}개 씬)` +
          (d.errors > 0 ? ` · 오류 ${d.errors}건` : ''),
        d.errors === 0,
        5000,
      );
    });
    const unsubError = backend.onImageDeleteError((d) => {
      appState.finishPinnedProgress(
        pid(d.jobId),
        `✗ 이미지 삭제 실패: ${d.error}`,
        false,
        7000,
      );
    });
    return () => {
      unsubStart();
      unsubProgress();
      unsubDone();
      unsubError();
    };
  }, []);
  useEffect(() => {
    const refreshDarkMode = async () => {
      const conf = await backend.getConfig();
      setDarkMode(!conf.whiteMode);
      setTrueDark(conf.trueDark ?? false);
      setThemeVars(buildThemeVars(conf.uiTheme, conf.whiteMode ?? false));
      appState.classicSceneCard = conf.classicSceneCard ?? false;
      appState.uiToolbar = conf.uiToolbar ?? {};
      appState.initialThumbSize = conf.initialThumbSize;
      appState.historyThumbnailPercent = Math.max(
        60,
        Math.min(100, conf.historyThumbnailPercent ?? 100),
      );
      appState.globalSamplingPresetId = conf.samplingPresetId;
      appState.useProjectDrawer = conf.useProjectDrawer ?? true;
      appState.useBatchEnqueue = conf.useBatchEnqueue ?? false;
    };
    refreshDarkMode();
    sessionService.addEventListener('config-changed', refreshDarkMode);
    return () => {
      sessionService.removeEventListener('config-changed', refreshDarkMode);
    };
  }, []);
  // (electron 잔재 정리) appUpdateNoticeService 'updated' 리스너 제거 — 웹 stub은
  // 이벤트를 절대 dispatch하지 않아 미발화 죽은 경로였음. 실제 업데이트 알림은
  // BuildInfo 배지(/api/version-check)가 담당.
  useEffect(() => {
    const removeDownloadProgressListener = backend.onDownloadProgress(
      (progress: any) => {
        localAIService.notifyDownloadProgress(progress.percent);
      },
    );
    const removeZipProgressListener = backend.onZipProgress((progress: any) => {
      appState.setProgressDialog({
        text: '압축파일 생성 중..',
        done: progress.done,
        total: progress.total,
      });
    });
    const removeImageChangedListener = backend.onImageChanged(
      async (path: string) => {
        imageService.invalidateCache(path);
      },
    );
    const handleIPCheckFail = () => {
      appState.pushDialog({
        type: 'yes-only',
        text: '네트워크 변경을 감지하고 작업을 중단했습니다. 잦은 네트워크 변경은 계정 공유로 취급되어 밴의 위험이 있습니다. 이를 무시하고 싶으면 환경설정에서 "IP 체크 끄기"를 켜주세요.',
      });
    };
    // 큐 등록/처리 실패 글로벌 toast — TaskQueueControl 패널 unmount된 상태도 인지 보장
    // (P15 큐 905개 incident class). addTask는 fire-and-forget이라 caller에 throw 안 함.
    const handleQueueError = (e: any) => {
      const msg = e?.detail?.error;
      if (msg) appState.pushMessage(`큐 등록 실패: ${msg}`);
    };
    taskQueueService.addEventListener('ip-check-fail', handleIPCheckFail);
    taskQueueService.addEventListener('error', handleQueueError);
    return () => {
      removeDownloadProgressListener();
      removeImageChangedListener();
      removeZipProgressListener();
      taskQueueService.removeEventListener('ip-check-fail', handleIPCheckFail);
      taskQueueService.removeEventListener('error', handleQueueError);
    };
  }, [appState.curSession]);

  const [dragOverlay, setDragOverlay] = useState<string | null>(null);
  const dragCounter = useRef(0);
  useEffect(() => {
    const getDropDescription = (dataTransfer: DataTransfer): string | null => {
      const items = dataTransfer.items;
      if (!items || items.length === 0) return null;
      const item = items[0];
      if (item.kind !== 'file') return null;
      const type = item.type;
      if (type === 'image/png' || type === 'image/jpeg' || type === 'image/webp') {
        return '이미지에서 프롬프트 메타데이터를 추출합니다';
      }
      if (type === 'application/json') {
        if (items.length >= 2) {
          return `${items.length}개 프로젝트를 한 번에 임포트합니다`;
        }
        return '프로젝트 또는 프롬프트조각을 임포트합니다';
      }
      // type이 빈 문자열일 수 있음 — 파일 이름 확장자로 추정
      return null;
    };

    const handleDragEnter = (event: any) => {
      event.preventDefault();
      dragCounter.current++;
      if (dragCounter.current === 1) {
        // 모달 오버레이 열려 있으면 메타 D&D 안내 표시 안 함
        if (appState.modalOverlayCount > 0) return;
        const desc = getDropDescription(event.dataTransfer);
        if (desc) {
          setDragOverlay(desc);
        }
      }
    };

    const handleDragOver = (event: any) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
    };

    const handleDragLeave = (event: any) => {
      event.preventDefault();
      dragCounter.current--;
      if (dragCounter.current <= 0) {
        dragCounter.current = 0;
        setDragOverlay(null);
      }
    };

    const handleDrop = (event: any) => {
      event.preventDefault();
      event.stopPropagation();
      dragCounter.current = 0;
      setDragOverlay(null);
      // 모달 오버레이 열려 있으면 메타 처리 차단
      if (appState.modalOverlayCount > 0) return;
      const files = event.dataTransfer.files;
      if (files && files.length > 0) {
        // ≥2 JSON 파일이면 다중 임포트 흐름으로 자동 분기, 단일은 기존 흐름.
        appState.handleFiles(files);
      }
    };
    window.addEventListener('dragenter', handleDragEnter);
    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('drop', handleDrop);

    return () => {
      window.removeEventListener('dragenter', handleDragEnter);
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('drop', handleDrop);
    };
  }, [appState.curSession, appState.dialogs, appState.messages]);

  useEffect(() => {
    window.curSession = appState.curSession;
    if (appState.curSession) {
      sessionService.reloadPieceLibraryDB(appState.curSession);
      imageService.refreshBatch(appState.curSession);
      appState.cleanupOrphanedPresetApplication();
      appState.resolveSamplingPreset();
    } else {
      appState.appliedSamplingPreset = undefined;
    }
    return () => {
      window.curSession = undefined;
    };
  }, [appState.curSession]);

  // WS 재연결 시 이미지 cache + 씬 image list refresh. server pm2 restart로 WS
  // 끊긴 사이 발생한 `image-changed` broadcast는 replay 안 됨 — 클라이언트는 옛
  // cache 상태로 stuck. 재연결 시 refreshBatch로 모든 씬의 image list refetch +
  // cache 갱신. P19 #14 fix.
  useEffect(() => {
    const off = backend.onWsReconnect(() => {
      if (appState.curSession) {
        imageService.refreshBatch(appState.curSession);
      }
    });
    return off;
  }, []);

  // 'scene-job-complete' broadcast 흡수. restored mirror task가 complete될 때 task.params
  // 빈 placeholder라 afterGenComplete 스킵됨 → imageService.onAddImage 안 불림 → 옛엔
  // ResultViewer.tsx:1317의 sceneKey-scoped listener만 작동 (본인이 결과 viewer 안에
  // 있을 때만 imageMap 갱신). SceneQueueControl 카드 list view는 listener 없어서
  // imageMap 영원히 stale (큐 끝나도 카드의 카운터 0, 썸네일 X). App.tsx에서 받아서
  // 그 씬 한정 refresh — 본인 보던 화면 무관하게 always cover.
  //
  // sceneKey-scoped debounce 1000ms — 같은 씬에 burst complete (예: 100 잡 동시 끝)
  // 시 100회 listFiles refresh 누적 → 모바일 발열 직접 동인. burst를 1회로 압축.
  useEffect(() => {
    const DEBOUNCE_MS = 1000;
    const pendingRefresh = new Map<string, ReturnType<typeof setTimeout>>();
    const onSceneJobComplete = (e: any) => {
      const sceneKey = e?.detail?.sceneKey;
      if (!sceneKey || !appState.curSession) return;
      const parts = sceneKey.split('/');
      if (parts.length < 3) return;
      const [sName, sType] = [parts[0], parts[1]];
      const sceneName = parts.slice(2).join('/');
      if (sName !== appState.curSession.name) return;
      const existing = pendingRefresh.get(sceneKey);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        pendingRefresh.delete(sceneKey);
        // timer fire 시점에 session 변경됐을 수 있음 — re-verify.
        if (!appState.curSession || appState.curSession.name !== sName) return;
        const scene = sType === 'inpaint'
          ? appState.curSession.inpaints.get(sceneName)
          : appState.curSession.scenes.get(sceneName);
        if (!scene) return;
        imageService.refresh(appState.curSession, scene);
      }, DEBOUNCE_MS);
      pendingRefresh.set(sceneKey, timer);
    };
    taskQueueService.addEventListener('scene-job-complete', onSceneJobComplete);
    return () => {
      taskQueueService.removeEventListener('scene-job-complete', onSceneJobComplete);
      for (const timer of pendingRefresh.values()) clearTimeout(timer);
      pendingRefresh.clear();
    };
  }, []);

  // PWA 콜드 리로드 복구 — 부팅 시 마지막 프로젝트 자동 복원. iOS가 홈화면 PWA를
  // 백그라운드에서 kill하면 복귀 시 완전 리로드되어 프로젝트 선택 화면으로 튕겨나가는데,
  // 마지막으로 열려있던 프로젝트를 다시 열어 "하던 자리"로 되돌림. 탭 복원은 TabComponent
  // persistKey가 담당(부팅 첫 마운트 1회). 저장 프로젝트가 삭제됐으면 조용히 선택 화면 유지.
  useEffect(() => {
    if (appState.curSession) return; // 이미 프로젝트 열림(정상 부팅선 없음)
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(LAST_PROJECT_KEY);
    } catch {
      // localStorage 불가 — 복원 skip.
    }
    if (!saved) return;
    let done = false;
    const tryRestore = () => {
      if (done || appState.curSession) return;
      // list()가 아직 안 채워졌거나 프로젝트가 삭제됐으면 대기/무시(조용히 선택 화면 유지).
      if (!sessionService.listVisible().includes(saved!)) return;
      done = true;
      sessionService.removeEventListener('listupdated', tryRestore);
      appState.selectSession(saved!);
    };
    tryRestore(); // 목록이 이미 준비됐을 수 있음
    sessionService.addEventListener('listupdated', tryRestore);
    // 안전망: 일정 시간 뒤 리스너 정리(목록이 끝내 안 오거나 프로젝트 부재 시 무한 대기 방지).
    const cleanupTimer = setTimeout(() => {
      done = true;
      sessionService.removeEventListener('listupdated', tryRestore);
    }, 15000);
    return () => {
      clearTimeout(cleanupTimer);
      sessionService.removeEventListener('listupdated', tryRestore);
    };
  }, []);

  // 큐 완전 종료(mirroredTasks 비어짐) 시점 안전망 — 누락된 scene refresh 일괄 cover.
  // restored mirror task가 진행 중에 끊어진 broadcast 다수 + scene-job-complete listener
  // 미설치 시점이 겹치면 카운터/썸네일 영구 stale. 'stop' event 시 refreshBatch.
  useEffect(() => {
    const onStop = () => {
      if (appState.curSession) {
        imageService.refreshBatch(appState.curSession);
      }
    };
    taskQueueService.addEventListener('stop', onStop);
    return () => taskQueueService.removeEventListener('stop', onStop);
  }, []);

  // visibility 복귀 시 refreshBatch. 모바일 백그라운드 시 iOS는 WS 연결 자체는
  // 유지하지만 idle 상태라 broadcast 처리가 deferred. ws-reconnect 이벤트는
  // *연결이 끊긴 경우*에만 발생 — 끊기지 않고 idle만 됐다 돌아온 경우는 ws-reconnect
  // 미발생. 본인 페인 (P19 #14): "다른 앱 갔다 돌아오니 씬 이미지 0, 썸네일 X,
  // 씬 들어가면 그제야 후다닥". visibilitychange visible 시 명시적 refreshBatch.
  //
  // hidden duration 가드 — 5초 이상 백그라운드였을 때만 refresh. 짧은 탭 swap
  // (모달 진입·알림 확인 등)은 refresh 불필요 — 매번 50+씬 refetch 비용 회피.
  // 본인 페인 "더 느려졌어"에 대응.
  useEffect(() => {
    let hiddenAt: number | null = null;
    const MIN_HIDDEN_MS = 5000;
    const onVisChange = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
        return;
      }
      // visible 복귀
      const duration = hiddenAt ? Date.now() - hiddenAt : 0;
      hiddenAt = null;
      if (duration < MIN_HIDDEN_MS) return;
      if (appState.curSession) {
        imageService.refreshBatch(appState.curSession);
      }
    };
    document.addEventListener('visibilitychange', onVisChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisChange);
    };
  }, []);

  // orphan(주인 사라진 예약) 자동 복구 — 다이얼로그 없이 자동 재예약. (옛 mount-only "재예약할까요?"
  // 다이얼로그 대체.) 트리거: load + reservation-orphaned broadcast + WS 재연결. Anlas-0 보장 위해
  // 재예약 전 그 씬 vibe가 전부 캐시됐는지 pre-check — 전부 캐시면 무음 자동, 캐시miss면 확인 다이얼로그.
  useEffect(() => {
    let cancelled = false;
    let inFlight = false;

    // 씬이 쓰는 vibe 소스 — 핸들러가 job.vibes에 넣는 바로 그 소스(gen=shared.vibes / inpaint=preset.vibes).
    // 열거가 *불확실*하면(워크플로우 미상 / getCommonSetup throw) null 반환 → 호출부가 안전하게
    // "자동 X(consent 경로)"로 처리. []는 "vibe 없음"(안전하게 캐시됨 취급)과 구분.
    const getSceneVibes = (session: any, scene: any): Array<{ path: string; info: number }> | null => {
      try {
        if (scene.type === 'scene') {
          if (!session.selectedWorkflow) return null;
          const [, , shared] = session.getCommonSetup(session.selectedWorkflow);
          return shared?.vibes || [];
        }
        return scene?.preset?.vibes || [];
      } catch {
        return null;
      }
    };

    // Anlas-0 게이트 — vibe가 하나라도 캐시 안 됐거나 *열거 불확실*이면 false(자동 재예약 X = Anlas 위험 회피).
    const areAllVibesCached = async (session: any, scene: any): Promise<boolean> => {
      const vibes = getSceneVibes(session, scene);
      if (vibes === null) return false; // 열거 불확실 → 인코딩(Anlas) 위험 회피, consent 경로로
      for (const v of vibes) {
        if (!v?.path) continue;
        const ok = await imageService
          .checkEncodedVibeImage(session, v.path, v.info)
          .catch(() => false);
        if (!ok) return false;
      }
      return true;
    };

    const lookupScene = async (sceneKey: string, meta: any) => {
      const session = await sessionService.get(sceneKey.split('/')[0]).catch(() => null);
      if (!session) return null;
      const sceneType = meta?.taskType || sceneKey.split('/')[1];
      const sceneName = meta?.sceneName || sceneKey.split('/')[2];
      const scene = (session.getScenes(sceneType) || []).find((s: any) => s.name === sceneName);
      return scene ? { session, scene } : null;
    };

    // samplesCount(samples→task수) 만큼 씬 재예약 — 옛 다이얼로그 로직 재사용(createPrompt 기반 numCalls).
    const requeueScene = async (session: any, scene: any, samplesCount: Map<number, number>) => {
      let tasksPerCall = 1;
      if (scene.type === 'scene' && session.selectedWorkflow) {
        try {
          const [, preset, shared, def] = session.getCommonSetup(session.selectedWorkflow);
          if (def.createPrompt) {
            const prompts = await def.createPrompt(session, scene, preset, shared);
            tasksPerCall = prompts.length || 1;
          }
        } catch { /* fallback 1 */ }
      }
      for (const [samples, taskCount] of samplesCount) {
        const numCalls = Math.max(1, Math.ceil(taskCount / tasksPerCall));
        for (let i = 0; i < numCalls; i++) {
          await queueScene(session, scene, samples).catch((e: any) =>
            console.warn('[orphan-recover] queueScene failed:', e));
        }
        await taskQueueService.waitForPendingFills();
      }
    };

    // 무한 루프 방지 — 같은 씬이 RECOVER_WINDOW_MS 안에 RECOVER_MAX회 넘게 자동 재예약되면 지속 실패
    // 루프(orphan→재예약→실패→orphan). 캡 넘으면 자동 중단 + park(needsConsent) + 토스트. 재예약마다
    // 새 task/예약이라 클라/서버 카운터 스레딩 불가 → *재예약이 거쳐가는 한 곳*(여기)서 sceneKey 기준 셈.
    const RECOVER_MAX = 3;
    const RECOVER_WINDOW_MS = 10 * 60 * 1000;
    const requeueWindow = new Map<string, { count: number; firstAt: number }>();

    const recover = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        const { orphans } = await backend.getOrphanReservations();
        if (cancelled || !orphans || orphans.length === 0) return;
        // sceneKey별 그룹 — reservationIds + taskIds + samplesCount(jobTotal=samples별 count)
        const groups = new Map<
          string,
          { meta: any; reservationIds: string[]; taskIds: string[]; samplesCount: Map<number, number> }
        >();
        for (const o of orphans) {
          const sk = o.meta?.sceneKey;
          if (!sk) continue;
          if (!groups.has(sk)) groups.set(sk, { meta: o.meta, reservationIds: [], taskIds: [], samplesCount: new Map() });
          const g = groups.get(sk)!;
          g.reservationIds.push(o.reservationId);
          if (o.meta?.taskId && !g.taskIds.includes(o.meta.taskId)) g.taskIds.push(o.meta.taskId);
          g.samplesCount.set(o.jobTotal, (g.samplesCount.get(o.jobTotal) || 0) + 1);
        }
        const pendingConsent: Array<{
          sceneKey: string; meta: any; taskIds: string[]; samplesCount: Map<number, number>; jobs: number;
        }> = [];
        let consentTotal = 0;
        let gaveUp = 0;
        for (const [sceneKey, g] of groups) {
          if (cancelled) return;
          const found = await lookupScene(sceneKey, g.meta);
          if (!found) { await backend.claimOrphans(g.reservationIds).catch(() => {}); continue; } // 씬/프로젝트 없음 → consume+skip
          const cached = await areAllVibesCached(found.session, found.scene);
          if (!cached) {
            // 캐시miss → park(needsConsent — orphan 풀에서 제외 = 재알림 0) + 모아서 확인 다이얼로그
            for (const rid of g.reservationIds) await backend.markReservationConsent(rid).catch(() => {});
            const jobs = [...g.samplesCount.entries()].reduce((a, [s, c]) => a + s * c, 0);
            pendingConsent.push({ sceneKey, meta: g.meta, taskIds: g.taskIds, samplesCount: g.samplesCount, jobs });
            consentTotal += jobs;
            continue;
          }
          // 무한 루프 방지 — sceneKey별 재예약 횟수 캡(시간창). 캡 초과 = 지속 실패 루프 → park + 포기.
          const now = Date.now();
          const w = requeueWindow.get(sceneKey);
          if (w && now - w.firstAt < RECOVER_WINDOW_MS) {
            if (w.count >= RECOVER_MAX) {
              for (const rid of g.reservationIds) await backend.markReservationConsent(rid).catch(() => {});
              gaveUp++;
              continue;
            }
            w.count++;
          } else {
            requeueWindow.set(sceneKey, { count: 1, firstAt: now });
          }
          // 전부 캐시 → 무음 자동 재예약(prep이 encodeVibeImage 안 함 = Anlas 0) *후* claim(consume).
          // requeue-first → 재예약 실패해도 orphan이 남아 다음 pickup서 재시도(데이터 손실 회피).
          await requeueScene(found.session, found.scene, g.samplesCount);
          await backend.claimOrphans(g.reservationIds).catch(() => {});
        }
        if (gaveUp > 0) {
          appState.pushMessage(`${gaveUp}개 씬은 자동 복구가 ${RECOVER_MAX}회 실패해 보류했어요 (큐 페이지에서 확인/취소).`);
        }
        // 캐시miss 묶음 → 확인 다이얼로그 1회. park돼 풀에서 빠졌으니 재진입해도 중복 알림 X.
        if (!cancelled && pendingConsent.length > 0) {
          appState.pushDialog({
            type: 'confirm',
            text:
              `${consentTotal}개 항목은 vibe 재인코딩이 필요해 자동 복구를 멈췄어요 (Anlas 소비).\n` +
              `진행할까요? (취소하면 그대로 보류돼요 — 큐 페이지에서 취소 가능)`,
            callback: async () => {
              for (const p of pendingConsent) {
                const found = await lookupScene(p.sceneKey, p.meta);
                if (found) await requeueScene(found.session, found.scene, p.samplesCount); // 정상 재예약(인코딩 허용=Anlas, 동의)
                // park된 옛 예약 제거(새 task는 별도 id라 무관). requeue-first → 실패 시 park 잔존(재시도 가능).
                if (p.taskIds.length > 0) await backend.cancelQueueByTaskIds(p.taskIds).catch(() => {});
              }
              appState.pushMessage('✓ 재예약 진행');
            },
          });
        }
      } catch (e) {
        console.warn('[orphan-recover] failed:', e);
      } finally {
        inFlight = false;
      }
    };

    const t = setTimeout(() => recover(), 1500); // 초기 로드 — 끊긴 사이 쌓인 orphan 회복
    const offOrphan = backend.onReservationOrphaned(() => recover());
    const offReconnect = backend.onWsReconnect(() => recover());
    return () => {
      cancelled = true;
      clearTimeout(t);
      offOrphan();
      offReconnect();
    };
  }, []);

  // 전역 JSON store read 실패: 404가 아닌 network/timeout/5xx에서는 store가 fail-closed로
  // 쓰기를 막는다. 여러 파일이 같은 서버 장애로 함께 실패하면 한 안내로 묶는다.
  useEffect(() => {
    const stores: Array<{
      service: EventTarget & { loadError: string | null };
      file: string;
      label: string;
    }> = [
      { service: globalPieceService, file: 'global_pieces.json', label: '글로벌 조각' },
      { service: globalPresetService, file: 'global_presets.json', label: '글로벌 프리셋' },
      { service: globalCharacterPresetService, file: 'global_character_presets.json', label: '글로벌 캐릭터 프리셋' },
      { service: artistLibraryService, file: 'artist_library.json', label: '작가 라이브러리' },
      { service: promptChunkService, file: 'prompt_chunks.json', label: '프롬프트 청크' },
      { service: toggleGroupService, file: 'toggle_groups.json', label: '토글 그룹' },
      { service: samplingPresetService, file: 'sampling_presets.json', label: '샘플링 프리셋' },
    ];
    const pending = new Map<string, string>();
    let notifyTimer: ReturnType<typeof setTimeout> | null = null;

    const flushNotice = () => {
      notifyTimer = null;
      const failures = Array.from(pending.entries()).filter(
        ([file]) => !reportedGlobalStoreLoadFailures.has(file),
      );
      pending.clear();
      if (failures.length === 0) return;
      for (const [file] of failures) reportedGlobalStoreLoadFailures.add(file);
      appState.pushDialog({
        type: 'yes-only',
        text:
          '전역 데이터를 불러오지 못했어요.\n\n' +
          failures.map(([, label]) => `• ${label}`).join('\n') +
          '\n\n기존 파일 보호를 위해 이 항목들의 저장을 차단했어요.' +
          '\n현재 변경은 저장되지 않으니 연결을 확인한 뒤 앱을 새로고침해 주세요.',
      });
    };
    const queueNotice = (file: string, label: string) => {
      if (reportedGlobalStoreLoadFailures.has(file)) return;
      pending.set(file, label);
      if (notifyTimer) clearTimeout(notifyTimer);
      notifyTimer = setTimeout(flushNotice, 100);
    };

    const subscriptions = stores.map(({ service, file, label }) => {
      const handler = () => queueNotice(file, label);
      service.addEventListener('load-failed', handler);
      // models/index의 module-level load가 App effect보다 먼저 실패한 경우도 회수한다.
      if (service.loadError) queueNotice(file, label);
      return () => service.removeEventListener('load-failed', handler);
    });
    return () => {
      if (notifyTimer) clearTimeout(notifyTimer);
      for (const unsubscribe of subscriptions) unsubscribe();
    };
  }, []);

  // 글로벌 프리셋 손상 복구 알림
  useEffect(() => {
    const handler = (e: any) => {
      const backupName = e.detail?.backupName;
      appState.pushDialog({
        type: 'yes-only',
        text:
          '글로벌 프리셋 파일이 손상되어 빈 상태로 초기화되었습니다.' +
          (backupName ? `\n\n백업: ${backupName}` : ''),
      });
    };
    window.globalPresetService?.addEventListener('corrupted', handler);
    return () => {
      window.globalPresetService?.removeEventListener('corrupted', handler);
    };
  }, []);

  // 글로벌 프리셋 통합 마이그레이션 — 백업 실패로 보류됐을 때 알림 (원본은 안전)
  useEffect(() => {
    const handler = () => {
      appState.pushDialog({
        type: 'yes-only',
        text:
          '글로벌 프리셋 통합을 위한 백업에 실패해 통합을 보류했어요.\n원본은 그대로 유지되며, 다음 실행 때 다시 시도해요.',
      });
    };
    window.globalPresetService?.addEventListener('unify-backup-failed', handler);
    return () => {
      window.globalPresetService?.removeEventListener('unify-backup-failed', handler);
    };
  }, []);

  const tabs = [
    {
      label: '이미지생성',
      shortLabel: '생성',
      content: <QueueControl type="scene" showPannel />,
      emoji: <FaImages />,
    },
    {
      label: '이미지변형',
      shortLabel: '변형',
      content: <QueueControl type="inpaint" showPannel />,
      emoji: <FaPenFancy />,
    },
    {
      label: '글로벌 프리셋',
      shortLabel: '프리셋',
      content: <GlobalPresetTab />,
      emoji: <FaStar />,
      banToggle: true,
    },
    {
      label: '작가 라이브러리',
      shortLabel: '작가',
      content: <ArtistLibraryTab />,
      emoji: <FaPalette />,
      banToggle: true,
    },
    {
      label: '태그 검색',
      shortLabel: '태그 검색',
      content: <TagSearchTab />,
      emoji: <FaSearch />,
      banToggle: true,
    },
    {
      label: '퀵 생성',
      shortLabel: '퀵 생성',
      content: <QuickModeTab />,
      emoji: <FaBolt />,
    },
  ];
  return (
    <DndProvider
      backend={isMobile ? TouchBackend : HTML5Backend}
      options={{
        enableTouchEvents: true,
        enableMouseEvents: false,
        delayTouchStart: 400,
      }}
    >
      <div
        className={
          'flex flex-col relative h-full w-full ' +
          (darkMode ? 'dark' : '') +
          (darkMode && trueDark ? ' true-dark' : '') +
          (Object.keys(themeVars).length > 0 ? ' custom-theme' : '')
        }
        style={{
          ...themeVars,
          backgroundColor: 'var(--c-surface)',
          color: 'var(--c-text-label)',
        } as React.CSSProperties}
      >
        <div className="z-[var(--z-feature-modal)]">
          <DnDPreview />
        </div>
        <ErrorBoundary
          onErr={(error, errorInfo) => {
            appState.pushMessage(extractApiError(error));
          }}
        >
          <VerticalStack>
            {!isMobile && (
              <StackFixed>
                <TobBar />
              </StackFixed>
            )}
            <StackGrow className="relative flex">
              <div className="relative flex-1 min-w-0 h-full">
              <FloatViewProvider>
                <AppContextMenu />
                {isMobile && <ImageHistoryDrawer />}
                {isMobile && <ImageHistoryHandle />}
                <div className="h-full w-full flex flex-col overflow-hidden">
                  {isMobile && <div className="flex-none"><TobBar /></div>}
                  <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                    <StackGrow className="flex">
                      {appState.curSession && (
                        <>
                          {!appState.leftPanelCollapsed && (
                            <div
                              style={{ width: appState.leftPanelWidth, minWidth: 250 }}
                              className="flex-none overflow-hidden hidden md:block h-full"
                            >
                              <div className="h-full w-full overflow-hidden">
                                <PreSetEditor
                                  key={appState.curSession.name}
                                  middlePromptMode={false}
                                />
                              </div>
                            </div>
                          )}
                          <div className="flex-none hidden md:flex">
                            <ResizableSplitter />
                          </div>
                          <StackGrow>
                            <TabComponent
                              key={appState.curSession.name}
                              persistKey={LAST_TAB_KEY}
                              tabs={tabs}
                              toggleView={
                                <PreSetEditor
                                  key={appState.curSession.name + '2'}
                                  middlePromptMode={false}
                                />
                              }
                            />
                          </StackGrow>
                        </>
                      )}
                    </StackGrow>
                    <StackFixed>
                      <div ref={bottomBarRef} className="px-3 py-2 border-t line-color">
                        {/* Desktop: single-row layout */}
                        <div className="hidden md:flex gap-3 items-center">
                          <div className="flex-1">
                            <SessionSelect />
                          </div>
                          <div className="flex flex-none gap-4 ml-auto">
                            <TaskQueueControl />
                          </div>
                        </div>
                        {/* Mobile: two-row layout (alpha split: pills row / controls row) */}
                        <div className="flex md:hidden flex-col gap-2">
                          <div className="flex gap-3 items-center justify-end">
                            <TaskQueueProgress />
                            <BuildInfoBadge variant="mobile" />
                          </div>
                          <div className="flex gap-2 items-center justify-end">
                            <TaskQueueControls />
                          </div>
                        </div>
                      </div>
                    </StackFixed>
                  </div>
                </div>
                {appState.externalImage && (
                  <FloatView
                    onEscape={() => {
                      appState.closeExternalImage();
                    }}
                    priority={1}
                  >
                    <ExternalImageView
                      image={appState.externalImage}
                      onClose={() => {
                        appState.closeExternalImage();
                      }}
                    />
                  </FloatView>
                )}
              </FloatViewProvider>
              </div>
              <ImageHistoryPanel />
            </StackGrow>
          </VerticalStack>
        </ErrorBoundary>
        <AlertWindow />
        <ConfirmWindow />
        <ProjectDrawer />
        <MultiImportNameDialog />
        <ProjectCopyDialog />
        <FolderBackupImportDialog />
        <GlobalPresetPickerOverlay />
        <ProgressWindow
          dialogs={appState.progressDialogs}
          messagesCount={appState.messages.length}
        />
        <ProgressWindow
          dialogs={appState.pinnedProgressDialogs}
          messagesCount={appState.messages.length}
          pinned
          topOffset={appState.progressDialogs.length > 0 ? 48 : 0}
        />
        <DriveRetryWidget />
        <ExportPresetsDialog />
        <ExportOptionsForm />
        <CustomResolutionDialog />
        <SceneNameExportForm />
        <PromptTooltip />
        <ModalOverlay
          isOpen={appState.pieceEditorOpen}
          onClose={() => appState.closePieceEditor()}
          title="프롬프트조각"
          width="max-w-3xl"
        >
          {appState.curSession && <PieceEditor />}
        </ModalOverlay>
        <FindReplaceDialog />
        <SceneImporterDialog />
        {dragOverlay && (
          <div
            className="fixed inset-0 z-[var(--z-drag-overlay)] flex items-center justify-center pointer-events-none"
            style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }}
          >
            <div className="bg-[var(--c-surface-2)] rounded-2xl px-8 py-6 shadow-2xl border-2 border-dashed border-sky-400 dark:border-sky-500 flex flex-col items-center gap-3">
              <svg className="w-12 h-12 text-sky-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v12m0 0l-4-4m4 4l4-4M4 18h16" />
              </svg>
              <p className="text-lg font-semibold text-gray-800 dark:text-gray-100">
                여기에 드랍하세요
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {dragOverlay}
              </p>
            </div>
          </div>
        )}
      </div>
    </DndProvider>
  );
});
