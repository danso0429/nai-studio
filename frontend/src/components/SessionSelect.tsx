import { useRef, useState } from 'react';
import SessionTreePicker from './SessionTreePicker';
import { FaPlus, FaPuzzlePiece, FaTrashAlt, FaUserAlt, FaTimes, FaPen, FaShare, FaBookmark, FaRegBookmark, FaThLarge } from 'react-icons/fa';
import ProjectBrowser, { pushRecentProject } from './ProjectBrowser';
import Tooltip from './Tooltip';
import { sessionService, imageService, workFlowService, isMobile } from '../models';
import { appState } from '../models/AppService';
import { observer } from 'mobx-react-lite';
import { CharacterPresetFloatEditor } from './CharacterPresetEditor';
import { CharacterPreset, CharacterPrompt, VibeItem, ReferenceItem } from '../models/types';
import { v4 as uuidv4 } from 'uuid';
import { formatProjectNameConflict } from '../models/util';
import { runInAction } from 'mobx';

const SessionSelect = observer(() => {
  const [showCharacterPresets, setShowCharacterPresets] = useState(false);
  const [showProjectBrowser, setShowProjectBrowser] = useState(false);
  // 진행 중인 선택 가드. 인터넷 느릴 때 사용자 연타로 race 방지.
  const pendingSelectionRef = useRef<string | null>(null);
  const addSession = () => {
    (async () => {
      appState.pushDialog({
        type: 'input-confirm',
        text: '신규 프로젝트 이름을 입력해주세요',
        callback: async (inputValue) => {
          if (inputValue) {
            if (sessionService.list().includes(inputValue)) {
              // basename 전역 unique 정책 — 다른 폴더에 있는 옛 프로젝트라 사용자가
              // 인지 못 한 경우 위치 명시해서 헷갈림 회피.
              appState.pushMessage(formatProjectNameConflict(sessionService.getFolderOf(inputValue)));
              return;
            }
            await sessionService.add(inputValue);
            const newSession = (await sessionService.get(inputValue))!;
            appState.curSession = newSession;
          }
        },
      });
    })();
  };

  const selectSession = (name: string) => {
    // 같은 프로젝트 재선택은 무시.
    if (appState.curSession?.name === name) return;
    // 같은 이름 fetch 진행 중이면 무시 (사용자 연타 가드).
    if (pendingSelectionRef.current === name) return;
    pendingSelectionRef.current = name;
    // 동기 await 제거. 클릭 핸들러를 막지 않고 즉시 토스트로 피드백 →
    // 인터넷 느릴 때 "무반응" 인상 해소. fetch 응답 도착 시 curSession set.
    // sticky 토스트 — 본인 페인 (P12 #8): 인터넷 느린 환경에서 자동 dismiss 후에도
    // 로드 진행 중이면 사용자가 "이미 끝났는데 안 들어간 줄" 오해. 완료/실패 시 명시 제거.
    const toastId = appState.pushMessage(`프로젝트 "${name}" 로딩 중…`, { sticky: true });
    sessionService
      .get(name, { throwOnError: true, retry: true })
      .then((session) => {
        appState.dismissMessage(toastId);
        // 도착 사이 다른 선택이 들어왔으면 이 결과는 버림.
        if (pendingSelectionRef.current !== name) return;
        pendingSelectionRef.current = null;
        if (session) {
          imageService.refreshBatch(session);
          appState.curSession = session;
          pushRecentProject(name);
        } else {
          // throwOnError로 실패 시 catch에서 처리됨. 여기 도달은 이론상
          // 캐시 hit 직후 resources[name]이 비어있는 race 정도.
          appState.pushMessage(`프로젝트 "${name}" 로드 실패`);
        }
      })
      .catch((e) => {
        appState.dismissMessage(toastId);
        if (pendingSelectionRef.current === name) {
          pendingSelectionRef.current = null;
        }
        appState.pushMessage(
          `프로젝트 "${name}" 로드 실패: ${e?.message ?? e}`,
        );
      });
  };

  const deleteSession = () => {
    if (!appState.curSession) return;
    appState.deleteProjectBackground(appState.curSession.name);
  };

  return (
    <div className="flex gap-2 items-center w-full flex-wrap">
      {showCharacterPresets && appState.curSession && (
        <CharacterPresetFloatEditor
          onClose={() => setShowCharacterPresets(false)}
          onApplyPreset={(preset: CharacterPreset) => {
            const curSession = appState.curSession;
            if (!curSession) return;
            
            // 현재 선택된 워크플로우 타입 가져오기
            const workflowType = curSession.selectedWorkflow?.workflowType;
            if (!workflowType) {
              appState.pushMessage('워크플로우를 먼저 선택해주세요');
              return;
            }
            
            // shared 설정 가져오기
            let shared = curSession.presetShareds.get(workflowType);
            if (!shared) {
              shared = workFlowService.buildShared(workflowType);
              curSession.presetShareds.set(workflowType, shared);
            }
            
            runInAction(() => {
              // 이전 프리셋에서 추가된 항목 제거 (사용자 직접 추가 항목은 유지)
              const prevVibes = (shared.vibes || []).filter((v: VibeItem) => !v.fromPreset);
              const prevRefs = (shared.characterReferences || []).filter((r: ReferenceItem) => !r.fromPreset);

              // 프리셋의 바이브/레퍼런스를 태그 붙여서 추가
              const presetVibes = (preset.vibes || []).map((v: VibeItem) => {
                const item = VibeItem.fromJSON(v.toJSON());
                item.fromPreset = preset.name;
                return item;
              });
              const presetRefs = (preset.characterReferences || []).map((r: ReferenceItem) => {
                const item = ReferenceItem.fromJSON(r.toJSON());
                item.fromPreset = preset.name;
                return item;
              });

              shared.vibes = [...prevVibes, ...presetVibes];
              shared.characterReferences = [...prevRefs, ...presetRefs];

              if (workflowType === 'SDImageGenEasy') {
                shared.characterPrompt = preset.characterPrompt || '';
                shared.backgroundPrompt = preset.backgroundPrompt || '';
                shared.uc = preset.characterUC || '';
              } else {
                // 이전 프리셋 캐릭터 프롬프트 제거 (사용자 항목 유지)
                const prevPrompts = (shared.characterPrompts || []).filter(
                  (cp: CharacterPrompt) => !cp.fromPreset
                );
                if (preset.characterPrompt || preset.characterUC) {
                  const newEntry: CharacterPrompt = {
                    id: uuidv4(),
                    prompt: preset.characterPrompt || '',
                    uc: preset.characterUC || '',
                    position: { x: 0.5, y: 0.5 },
                    enabled: true,
                    fromPreset: preset.name,
                  };
                  shared.characterPrompts = [...prevPrompts, newEntry];
                } else {
                  shared.characterPrompts = prevPrompts;
                }
              }

              appState.setAppliedCharacterPreset(preset.name);
            });

            setShowCharacterPresets(false);
            appState.pushMessage(`"${preset.name}" 프리셋이 적용되었습니다`);
          }}
        />
      )}
      
      {/* 현재 적용된 캐릭터 프리셋 표시 */}
      {appState.appliedCharacterPreset && (
        <div className="hidden md:flex items-center gap-1 px-2 py-1 bg-green-100 dark:bg-green-900 rounded-lg text-sm">
          <FaUserAlt className="text-green-600 dark:text-green-400" size={12} />
          <Tooltip content={appState.appliedCharacterPreset ?? ''}>
          <span className="text-green-700 dark:text-green-300 max-w-24 truncate">
            {appState.appliedCharacterPreset}
          </span>
          </Tooltip>
          <Tooltip content="캐릭터 프리셋 해제">
          <button
            className="ml-1 text-green-600 dark:text-green-400 hover:text-red-500 dark:hover:text-red-400"
            onClick={() => appState.clearAppliedCharacterPreset()}
          >
            <FaTimes size={12} />
          </button>
          </Tooltip>
        </div>
      )}
      
      <span className="hidden md:inline whitespace-nowrap text-sub">
        프로젝트:{' '}
      </span>
      <div className="md:max-w-80 flex-1 min-w-40">
        <SessionTreePicker
          selectedName={appState.curSession?.name}
          onSelect={selectSession}
        />
      </div>
      <button className={`icon-button nback-sky mx-1`} onClick={addSession}>
        <FaPlus size={18} />
      </button>
      <Tooltip content={appState.appliedCharacterPreset ? `프리셋: ${appState.appliedCharacterPreset} (클릭하여 관리)` : '캐릭터 프리셋 관리'}>
      <button
        className={`icon-button mx-1 ${appState.appliedCharacterPreset ? 'back-green' : 'nback-green'}`}
        onClick={() => {
          if (!appState.curSession) {
            appState.pushMessage('프로젝트를 먼저 선택해주세요');
            return;
          }
          // 모바일 + 프리셋 적용 중: 해제/관리 선택 dialog. 데스크탑은 옆에 [×]
          // clear chip이 보이므로 mobile-only. upstream SDStudio v4.8.2 patch port.
          if (isMobile && appState.appliedCharacterPreset) {
            appState.pushDialog({
              type: 'select',
              text: `"${appState.appliedCharacterPreset}" 프리셋이 적용 중입니다.`,
              items: [
                { text: '프리셋 해제', value: 'clear' },
                { text: '프리셋 관리 열기', value: 'manage' },
              ],
              callback: (value?: string) => {
                if (value === 'clear') {
                  appState.clearAppliedCharacterPreset();
                } else if (value === 'manage') {
                  setShowCharacterPresets(true);
                }
              },
            });
            return;
          }
          setShowCharacterPresets(true);
        }}
      >
        <FaUserAlt size={18} />
      </button>
      </Tooltip>
      <Tooltip content="프로젝트 이름 수정">
      <button
        className={`icon-button nback-orange mx-1 flex items-center gap-1`}
        onClick={() => appState.projectRename()}
      >
        <FaPen size={14} />
        <span className="hidden md:inline text-sm">이름</span>
      </button>
      </Tooltip>
      <Tooltip content="프로젝트 탐색 (카드 그리드 뷰)">
      <button
        className={`icon-button nback-purple mx-1`}
        onClick={() => setShowProjectBrowser(true)}
      >
        <FaThLarge size={14} />
      </button>
      </Tooltip>
      <Tooltip content="백업(.tar) 또는 이미지(.png) 불러오기">
      <button
        className={`icon-button nback-teal mx-1`}
        onClick={() => appState.mediaImport()}
      >
        <FaShare size={14} />
      </button>
      </Tooltip>
      <Tooltip content={appState.curSession && sessionService.isFavorite(appState.curSession.name) ? '즐겨찾기 해제' : '즐겨찾기 지정'}>
      <button
        className={`icon-button nback-yellow mx-1 flex items-center gap-1`}
        onClick={() => appState.projectToggleFavorite()}
      >
        {appState.curSession && sessionService.isFavorite(appState.curSession.name)
          ? <FaBookmark size={14} style={{ color: '#facc15' }} />
          : <FaRegBookmark size={14} style={{ color: '#9ca3af' }} />}
        <span className="hidden md:inline text-sm">즐겨찾기</span>
      </button>
      </Tooltip>
      <Tooltip content="프로젝트 영구 삭제 (로컬 + Drive)">
      <button className={`icon-button nback-red mx-1`} onClick={deleteSession}>
        <FaTrashAlt size={18} />{' '}
      </button>
      </Tooltip>
      <Tooltip content="프롬프트조각 라이브러리">
      <button
        className={`icon-button nback-green mx-1 flex items-center gap-1`}
        onClick={() => appState.openPieceEditor()}
      >
        <FaPuzzlePiece size={18} />
        <span className="hidden md:inline text-sm">프롬프트조각</span>
      </button>
      </Tooltip>
      {showProjectBrowser && (
        <ProjectBrowser onClose={() => setShowProjectBrowser(false)} />
      )}
    </div>
  );
});

export default SessionSelect;
