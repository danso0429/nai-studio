import { useEffect, useState } from 'react';
import SessionTreePicker from './SessionTreePicker';
import { FaEllipsisH, FaPlus, FaPuzzlePiece, FaTrashAlt, FaUserAlt, FaTimes, FaPen, FaShare, FaBookmark, FaThLarge, FaFolder, FaLayerGroup } from 'react-icons/fa';
import ProjectBrowser from './ProjectBrowser';
import Tooltip from './Tooltip';
import { sessionService, templateService, isMobile } from '../models';
import { appState } from '../models/AppService';
import { observer } from 'mobx-react-lite';
import { CharacterPresetFloatEditor } from './CharacterPresetEditor';
import { CharacterPreset } from '../models/types';
import { formatProjectNameConflict } from '../models/util';
import { TOOLBAR_VIEW_MAIN, resolveToolbarView } from '../models/uiLayout';
import ToolbarOverflowMenu from './ToolbarOverflowMenu';
import { companionAssignedIds } from '../models/companionSlots';
import {
  DraggableToolbarButton,
  ToolbarHideZone,
  ToolbarSlotDropTarget,
} from './ToolbarDnd';
import TemplateManagerModal from './TemplateManagerModal';
import { PORTABLE_TOOLBAR_ACTION_EVENT } from '../models/portableToolbarActions';

const SessionSelect = observer(({
  variant = 'bar',
}: {
  variant?: 'bar' | 'sidebar';
}) => {
  const [showCharacterPresets, setShowCharacterPresets] = useState(false);
  const [showProjectBrowser, setShowProjectBrowser] = useState(false);
  const [showProjectMenu, setShowProjectMenu] = useState(false);
  const [showTemplateManager, setShowTemplateManager] = useState(false);
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
            const templateId = await templateService.pickForCreate();
            if (templateId === undefined) return;
            const newSession = await templateService.createProject(
              inputValue,
              null,
              templateId,
            );
            await appState.activateSession(newSession);
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
    if (isMobile && appState.appliedCharacterPresetNames.length > 0) {
      appState.pushDialog({
        type: 'select',
        text: `캐릭터 프리셋 ${appState.appliedCharacterPresetNames.length}개가 적용 중입니다.`,
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

  useEffect(() => {
    const onPortableAction = (event: Event) => {
      const action = (event as CustomEvent<{ action?: string }>).detail?.action;
      if (action === 'add-session') addSession();
      else if (action === 'character-presets') openCharacterPresets();
      else if (action === 'scene-template') setShowTemplateManager(true);
    };
    window.addEventListener(PORTABLE_TOOLBAR_ACTION_EVENT, onPortableAction);
    return () => window.removeEventListener(PORTABLE_TOOLBAR_ACTION_EVENT, onPortableAction);
  }, []);

  const projectToolbarNodes: Record<string, React.ReactNode> = {
    'add-session': (
      <button className="icon-button nback-sky mx-1" onClick={addSession}>
        <FaPlus size={18} />
      </button>
    ),
    'character-presets': (
      <Tooltip
        content={
          appState.appliedCharacterPresetNames.length
            ? `프리셋: ${appState.appliedCharacterPresetNames.join(', ')} (클릭하여 관리)`
            : '캐릭터 프리셋 관리'
        }
      >
        <button
          className={`icon-button mx-1 ${appState.appliedCharacterPresetNames.length ? 'back-green' : 'nback-green'}`}
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
          <span className={variant === 'sidebar' ? 'hidden' : 'hidden md:inline text-sm'}>이름</span>
        </button>
      </Tooltip>
    ),
    'scene-template': (
      <Tooltip content="프로젝트·씬 템플릿 관리">
        <button
          className="icon-button nback-purple mx-1"
          onClick={() => setShowTemplateManager(true)}
        >
          <FaLayerGroup size={16} />
        </button>
      </Tooltip>
    ),
    'backup-export': (
      <Tooltip content="프로젝트 백업/내보내기">
        <button
          className="icon-button nback-teal mx-1"
          onClick={() => appState.projectBackupMenu()}
        >
          <FaShare size={14} />
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
          <span className={variant === 'sidebar' ? 'hidden' : 'hidden md:inline text-sm'}>프롬프트조각</span>
        </button>
      </Tooltip>
    ),
  };
  const projectArea = resolveToolbarView(
    TOOLBAR_VIEW_MAIN,
    appState.uiToolbar,
    isMobile,
    companionAssignedIds(appState.uiCompanionSlots),
  ).find(({ area }) => area === 'project');
  const projectInline = (projectArea?.inline ?? []).filter((id) => projectToolbarNodes[id]);
  const projectMenu = (projectArea?.menu ?? []).filter((id) => projectToolbarNodes[id]);
  const projectButtonName = (id: string) =>
    TOOLBAR_VIEW_MAIN.flatMap(({ registry }) => registry).find((button) => button.id === id)?.name ?? id;

  return (
    <div className={variant === 'sidebar'
      ? 'w-14 h-full flex flex-col items-center gap-1.5 py-2 overflow-y-auto border-r line-color bg-[var(--c-surface-2)]'
      : 'flex gap-2 items-center w-full flex-wrap'}>
      {showCharacterPresets && appState.curSession && (
        <CharacterPresetFloatEditor
          onClose={() => setShowCharacterPresets(false)}
          onApplyPreset={(preset: CharacterPreset, mode) => {
            appState.applyCharacterPreset(preset, mode);
            setShowCharacterPresets(false);
          }}
        />
      )}
      {variant === 'sidebar' ? (
        <>
          <Tooltip content={appState.curSession?.name ?? '프로젝트 목록'}>
            <button
              className="icon-button nback-sky flex-none"
              onClick={() => appState.openProjectDrawer()}
            >
              <FaFolder size={18} />
            </button>
          </Tooltip>
          {projectInline.map((id, index) => (
            <DraggableToolbarButton
              key={id}
              group="project"
              id={id}
              name={projectButtonName(id)}
              index={index}
            >
              {projectToolbarNodes[id]}
            </DraggableToolbarButton>
          ))}
          {(projectMenu.length > 0 || appState.editMode) && (
            <div className="relative">
              <ToolbarSlotDropTarget group="project" slot="menu">
                <button
                  className={`icon-button ${showProjectMenu ? 'back-sky' : ''}`}
                  onClick={() => {
                    if (projectMenu.length > 0) setShowProjectMenu((open) => !open);
                  }}
                  title="프로젝트 도구 더보기"
                >
                  <FaEllipsisH size={18} />
                </button>
              </ToolbarSlotDropTarget>
              <ToolbarOverflowMenu
                isOpen={showProjectMenu}
                onClose={() => setShowProjectMenu(false)}
                title="프로젝트 도구 더보기"
                group="project"
                items={projectMenu.map((id) => ({
                  id,
                  name: projectButtonName(id),
                  node: projectToolbarNodes[id],
                }))}
              />
            </div>
          )}
          <ToolbarHideZone group="project" />
        </>
      ) : (
      <>
      
      {/* 현재 적용된 캐릭터 프리셋 표시 */}
      {appState.appliedCharacterPresetNames.length > 0 && (
        <div className="hidden md:flex items-center gap-1 px-2 py-1 bg-green-100 dark:bg-green-900 rounded-lg text-sm">
          <FaUserAlt className="text-green-600 dark:text-green-400" size={12} />
          <Tooltip content={appState.appliedCharacterPresetNames.join(', ')}>
          <span className="text-green-700 dark:text-green-300 max-w-24 truncate">
            {appState.appliedCharacterPresetNames.length === 1
              ? appState.appliedCharacterPresetNames[0]
              : `프리셋 ${appState.appliedCharacterPresetNames.length}개`}
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
      {projectInline.map((id, index) => (
        <DraggableToolbarButton
          key={id}
          group="project"
          id={id}
          name={projectButtonName(id)}
          index={index}
        >
          {projectToolbarNodes[id]}
        </DraggableToolbarButton>
      ))}
      {(projectMenu.length > 0 || appState.editMode) && (
        <div className="relative">
          <ToolbarSlotDropTarget group="project" slot="menu">
            <Tooltip content="프로젝트 도구 더보기">
              <button
                className={`icon-button mx-1 ${showProjectMenu ? 'back-sky' : ''}`}
                onClick={() => {
                  if (projectMenu.length > 0) setShowProjectMenu((open) => !open);
                }}
              >
                <FaEllipsisH size={18} />
              </button>
            </Tooltip>
          </ToolbarSlotDropTarget>
          <ToolbarOverflowMenu
            isOpen={showProjectMenu}
            onClose={() => setShowProjectMenu(false)}
            title="프로젝트 도구 더보기"
            group="project"
            dropUp
            items={projectMenu.map((id) => ({
              id,
              name: projectButtonName(id),
              node: projectToolbarNodes[id],
            }))}
          />
        </div>
      )}
      <ToolbarHideZone group="project" />
      </>
      )}
      {showProjectBrowser && (
        <ProjectBrowser onClose={() => setShowProjectBrowser(false)} />
      )}
      <TemplateManagerModal
        isOpen={showTemplateManager}
        onClose={() => setShowTemplateManager(false)}
      />
    </div>
  );
});

export default SessionSelect;
