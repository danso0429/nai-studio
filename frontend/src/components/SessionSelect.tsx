import * as React from 'react';
import { useRef, useState } from 'react';
import SessionTreePicker from './SessionTreePicker';
import { FaPlus, FaPuzzlePiece, FaTrashAlt, FaUserAlt, FaTimes, FaPen, FaShare, FaBookmark, FaRegBookmark } from 'react-icons/fa';
import Tooltip from './Tooltip';
import { sessionService, imageService, backend, zipService, workFlowService } from '../models';
import { appState } from '../models/AppService';
import { observer } from 'mobx-react-lite';
import { CharacterPresetFloatEditor } from './CharacterPresetEditor';
import { CharacterPreset, VibeItem, ReferenceItem } from '../models/types';
import { runInAction } from 'mobx';

const SessionSelect = observer(() => {
  const [showCharacterPresets, setShowCharacterPresets] = useState(false);
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
              appState.pushMessage('이미 존재하는 프로젝트 이름입니다.');
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
    appState.pushMessage(`프로젝트 "${name}" 로딩 중…`);
    sessionService
      .get(name)
      .then((session) => {
        // 도착 사이 다른 선택이 들어왔으면 이 결과는 버림.
        if (pendingSelectionRef.current !== name) return;
        pendingSelectionRef.current = null;
        if (session) {
          imageService.refreshBatch(session);
          appState.curSession = session;
        } else {
          appState.pushMessage(`프로젝트 "${name}" 로드 실패`);
        }
      })
      .catch((e) => {
        if (pendingSelectionRef.current === name) {
          pendingSelectionRef.current = null;
        }
        appState.pushMessage(
          `프로젝트 "${name}" 로드 오류: ${e?.message ?? e}`,
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
            
            // MobX runInAction으로 모든 변경사항을 한 번에 적용
            runInAction(() => {
              // 프리셋 값 적용
              // 바이브 트랜스퍼 적용
              if (preset.vibes && preset.vibes.length > 0) {
                shared.vibes = preset.vibes.map((v: VibeItem) => VibeItem.fromJSON(v.toJSON()));
              }
              
              // 캐릭터 레퍼런스 적용
              if (preset.characterReferences && preset.characterReferences.length > 0) {
                shared.characterReferences = preset.characterReferences.map((r: ReferenceItem) => ReferenceItem.fromJSON(r.toJSON()));
              }
              
              // SDImageGenEasy의 경우 characterPrompt와 backgroundPrompt 필드 적용
              if (workflowType === 'SDImageGenEasy') {
                // 캐릭터 관련 태그 적용
                if (preset.characterPrompt) {
                  shared.characterPrompt = preset.characterPrompt;
                }
                
                // 배경 관련 태그 적용
                if (preset.backgroundPrompt) {
                  shared.backgroundPrompt = preset.backgroundPrompt;
                }
                
                // 태그 밴 리스트 적용
                if (preset.characterUC) {
                  shared.uc = preset.characterUC;
                }
              }
              
              // 적용된 프리셋 이름 저장
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
      <Tooltip content="캐릭터 프리셋 관리">
      <button
        className={`icon-button nback-green mx-1`}
        onClick={() => {
          if (!appState.curSession) {
            appState.pushMessage('프로젝트를 먼저 선택해주세요');
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
      {/* round-button CSS가 display: inline-flex !important처럼 작동해서 Tailwind
          `hidden`이 무력화. wrapping div로 감싸 모바일에서 확실히 숨김 처리. */}
      <div className="hidden md:block">
        <button
          className="round-button back-green flex items-center gap-1 ml-1"
          onClick={() => appState.openPieceEditor()}
        >
          <FaPuzzlePiece size={18} />
          <span>프롬프트조각</span>
        </button>
      </div>
    </div>
  );
});

export default SessionSelect;
