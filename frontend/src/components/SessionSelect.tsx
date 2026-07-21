import { useState } from 'react';
import SessionTreePicker from './SessionTreePicker';
import { FaEllipsisH, FaPlus, FaPuzzlePiece, FaTrashAlt, FaUserAlt, FaTimes, FaPen, FaShare, FaBookmark, FaThLarge, FaFolder } from 'react-icons/fa';
import ProjectBrowser from './ProjectBrowser';
import Tooltip from './Tooltip';
import { sessionService, workFlowService, isMobile } from '../models';
import { appState } from '../models/AppService';
import { observer } from 'mobx-react-lite';
import { CharacterPresetFloatEditor } from './CharacterPresetEditor';
import { CharacterPreset, CharacterPrompt, VibeItem, ReferenceItem } from '../models/types';
import { v4 as uuidv4 } from 'uuid';
import { formatProjectNameConflict } from '../models/util';
import { runInAction } from 'mobx';
import { TOOLBAR_VIEW_MAIN, resolveToolbarView } from '../models/uiLayout';
import ToolbarOverflowMenu from './ToolbarOverflowMenu';

const SessionSelect = observer(() => {
  const [showCharacterPresets, setShowCharacterPresets] = useState(false);
  const [showProjectBrowser, setShowProjectBrowser] = useState(false);
  const [showProjectMenu, setShowProjectMenu] = useState(false);
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

  const deleteSession = () => {
    if (!appState.curSession) return;
    appState.deleteProjectBackground(appState.curSession.name);
  };

  const openCharacterPresets = () => {
    if (!appState.curSession) {
      appState.pushMessage('프로젝트를 먼저 선택해주세요');
      return;
    }
    if (isMobile && appState.appliedCharacterPreset) {
      appState.pushDialog({
        type: 'select',
        text: `"${appState.appliedCharacterPreset}" 프리셋이 적용 중입니다.`,
        items: [
          { text: '프리셋 해제', value: 'clear' },
          { text: '프리셋 관리 열기', value: 'manage' },
        ],
        callback: (value?: string) => {
          if (value === 'clear') appState.clearAppliedCharacterPreset();
          else if (value === 'manage') setShowCharacterPresets(true);
        },
      });
      return;
    }
    setShowCharacterPresets(true);
  };

  const projectToolbarNodes: Record<string, React.ReactNode> = {
    'add-session': (
      <button className="icon-button nback-sky mx-1" onClick={addSession}>
        <FaPlus size={18} />
      </button>
    ),
    'character-presets': (
      <Tooltip
        content={
          appState.appliedCharacterPreset
            ? `프리셋: ${appState.appliedCharacterPreset} (클릭하여 관리)`
            : '캐릭터 프리셋 관리'
        }
      >
        <button
          className={`icon-button mx-1 ${appState.appliedCharacterPreset ? 'back-green' : 'nback-green'}`}
          onClick={openCharacterPresets}
        >
          <FaUserAlt size={18} />
        </button>
      </Tooltip>
    ),
    'rename-session': (
      <Tooltip content="프로젝트 이름 수정">
        <button
          className="icon-button nback-orange mx-1 flex items-center gap-1"
          onClick={() => appState.projectRename()}
        >
          <FaPen size={14} />
          <span className="hidden md:inline text-sm">이름</span>
        </button>
      </Tooltip>
    ),
    'project-browser': (
      <Tooltip content="프로젝트 탐색 (카드 그리드 뷰)">
        <button
          className="icon-button nback-purple mx-1"
          onClick={() => setShowProjectBrowser(true)}
        >
          <FaThLarge size={14} />
        </button>
      </Tooltip>
    ),
    'media-import': (
      <Tooltip content="백업(.tar) 또는 이미지(.png) 불러오기">
        <button className="icon-button nback-teal mx-1" onClick={() => appState.mediaImport()}>
          <FaShare size={14} />
        </button>
      </Tooltip>
    ),
    'delete-session': (
      <Tooltip content="프로젝트 영구 삭제 (로컬 + Drive)">
        <button className="icon-button nback-red mx-1" onClick={deleteSession}>
          <FaTrashAlt size={18} />
        </button>
      </Tooltip>
    ),
    'piece-editor': (
      <Tooltip content="프롬프트조각 라이브러리">
        <button
          className="icon-button nback-green mx-1 flex items-center gap-1"
          onClick={() => appState.openPieceEditor()}
        >
          <FaPuzzlePiece size={18} />
          <span className="hidden md:inline text-sm">프롬프트조각</span>
        </button>
      </Tooltip>
    ),
  };
  const projectArea = resolveToolbarView(
    TOOLBAR_VIEW_MAIN,
    appState.uiToolbar,
    isMobile,
  ).find(({ area }) => area === 'project');
  const projectInline = (projectArea?.inline ?? []).filter((id) => projectToolbarNodes[id]);
  const projectMenu = (projectArea?.menu ?? []).filter((id) => projectToolbarNodes[id]);
  const projectButtonName = (id: string) =>
    TOOLBAR_VIEW_MAIN.flatMap(({ registry }) => registry).find((button) => button.id === id)?.name ?? id;

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
        {appState.useProjectDrawer ? (
          <button
            onClick={() => appState.openProjectDrawer()}
            className="w-full px-3 py-2 rounded-md text-left bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-default flex items-center gap-1.5"
          >
            {appState.curSession && sessionService.isFavorite(appState.curSession.name) && (
              <FaBookmark size={11} style={{ color: '#facc15' }} className="flex-none" />
            )}
            <span className="truncate flex-1">
              {appState.curSession?.name || '프로젝트 선택'}
            </span>
            {appState.curSession && sessionService.getFolderOf(appState.curSession.name) && (
              <span className="text-xs text-gray-400 flex items-center gap-0.5 flex-none">
                <FaFolder size={10} />
                <span className="max-w-[70px] truncate">
                  {sessionService.getFolderOf(appState.curSession.name)}
                </span>
              </span>
            )}
          </button>
        ) : (
          <SessionTreePicker
            selectedName={appState.curSession?.name}
            onSelect={(name) => appState.selectSession(name)}
          />
        )}
      </div>
      {projectInline.map((id) => <span key={id}>{projectToolbarNodes[id]}</span>)}
      {projectMenu.length > 0 && (
        <div className="relative">
          <Tooltip content="프로젝트 도구 더보기">
            <button
              className={`icon-button mx-1 ${showProjectMenu ? 'back-sky' : ''}`}
              onClick={() => setShowProjectMenu((open) => !open)}
            >
              <FaEllipsisH size={18} />
            </button>
          </Tooltip>
          <ToolbarOverflowMenu
            isOpen={showProjectMenu}
            onClose={() => setShowProjectMenu(false)}
            title="프로젝트 도구 더보기"
            dropUp
            items={projectMenu.map((id) => ({
              id,
              name: projectButtonName(id),
              node: projectToolbarNodes[id],
            }))}
          />
        </div>
      )}
      {showProjectBrowser && (
        <ProjectBrowser onClose={() => setShowProjectBrowser(false)} />
      )}
    </div>
  );
});

export default SessionSelect;
