import { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import {
  globalCharacterPresetService,
  globalPresetService,
  projectTemplateService,
  sessionService,
  templateService,
} from '../models';
import { appState } from '../models/AppService';
import ModalOverlay from './ModalOverlay';
import PromptEditTextArea from './PromptEditTextArea';
import BatchCreatePanel from './BatchCreatePanel';

type Tab = 'project' | 'scene' | 'batch';

function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

const TemplateManagerModal = observer(
  ({
    isOpen,
    onClose,
    initialTemplateId,
  }: {
    isOpen: boolean;
    onClose: () => void;
    initialTemplateId?: string | null;
  }) => {
    const [tab, setTab] = useState<Tab>('project');
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [revision, setRevision] = useState(0);

    useEffect(() => {
      if (!isOpen) return;
      if (initialTemplateId) setSelectedId(initialTemplateId);
      void Promise.all([
        projectTemplateService.loaded
          ? Promise.resolve()
          : projectTemplateService.load(),
        templateService.ensureLoaded(),
      ]).then(() => {
        if (!selectedId && projectTemplateService.listGlobal()[0]) {
          setSelectedId(projectTemplateService.listGlobal()[0].id);
        }
        setRevision((value) => value + 1);
      });
      const changed = () => setRevision((value) => value + 1);
      projectTemplateService.addEventListener('changed', changed);
      sessionService.addEventListener('listupdated', changed);
      return () => {
        projectTemplateService.removeEventListener('changed', changed);
        sessionService.removeEventListener('listupdated', changed);
      };
    }, [isOpen, selectedId, initialTemplateId]);

    const templates = projectTemplateService.listGlobal();
    const selected =
      projectTemplateService.get(selectedId || '') || templates[0];
    const displayedTemplates =
      selected?.folderLocal && !templates.some((entry) => entry.id === selected.id)
        ? [selected, ...templates]
        : templates;
    const sceneTemplates = templateService.listSceneTemplates();
    void revision;

    const createProjectTemplate = async () => {
      const name = await appState.pushDialogAsync({
        type: 'input-confirm',
        text: '새 프로젝트 템플릿 이름',
      });
      if (!name) return;
      const entry = projectTemplateService.create(name);
      setSelectedId(entry.id);
    };

    const renameProjectTemplate = async () => {
      if (!selected) return;
      const name = await appState.pushDialogAsync({
        type: 'input-confirm',
        text: `"${selected.name}"의 새 이름`,
      });
      if (!name) return;
      projectTemplateService.rename(selected.id, name);
    };

    const deleteProjectTemplate = () => {
      if (!selected) return;
      appState.pushDialog({
        type: 'confirm',
        text: `프로젝트 템플릿 "${selected.name}"을 삭제할까요?\n이미 적용된 프로젝트 내용은 유지됩니다.`,
        callback: async () => {
          await projectTemplateService.delete(selected.id);
          setSelectedId(projectTemplateService.listGlobal()[0]?.id ?? null);
        },
      });
    };

    const importGlobalStyle = async () => {
      if (!selected) return;
      const options = globalPresetService.list();
      if (!options.length) {
        appState.pushMessage('글로벌 스타일 프리셋이 없습니다.');
        return;
      }
      const id = await appState.pushDialogAsync({
        type: 'select',
        text: '불러올 글로벌 스타일 프리셋',
        items: options.map((entry) => ({ text: entry.name, value: entry.id })),
      });
      if (id) await projectTemplateService.importGlobalPreset(selected.id, id);
    };

    const importGlobalCharacter = async () => {
      if (!selected) return;
      const options = globalCharacterPresetService.list();
      if (!options.length) {
        appState.pushMessage('글로벌 캐릭터 프리셋이 없습니다.');
        return;
      }
      const id = await appState.pushDialogAsync({
        type: 'select',
        text: '추가할 글로벌 캐릭터 프리셋',
        items: options.map((entry) => ({ text: entry.name, value: entry.id })),
      });
      if (id) {
        await projectTemplateService.importGlobalCharacterPreset(selected.id, id);
      }
    };

    const importLocalCharacter = async () => {
      if (!selected || !appState.curSession) return;
      const options = appState.curSession.getCharacterPresets();
      if (!options.length) {
        appState.pushMessage('현재 프로젝트에 캐릭터 프리셋이 없습니다.');
        return;
      }
      const name = await appState.pushDialogAsync({
        type: 'select',
        text: '현재 프로젝트에서 추가할 캐릭터 프리셋',
        items: options.map((entry) => ({ text: entry.name, value: entry.name })),
      });
      const preset = options.find((entry) => entry.name === name);
      if (preset) {
        await projectTemplateService.importSessionCharacterPreset(
          selected.id,
          appState.curSession,
          preset,
        );
      }
    };

    const importScenes = async () => {
      if (!selected) return;
      const projects = sessionService.listVisible();
      if (!projects.length) return;
      const name = await appState.pushDialogAsync({
        type: 'select',
        text: '씬 구성을 가져올 프로젝트',
        items: projects.map((project) => ({ text: project, value: project })),
      });
      if (!name) return;
      const count = await projectTemplateService.importScenesFromProject(
        selected.id,
        name,
      );
      appState.pushMessage(`씬 ${count}개로 템플릿 구성을 교체했습니다.`);
    };

    const applyToCurrent = async () => {
      if (!selected || !appState.curSession) return;
      await templateService.applyProjectTemplate(appState.curSession, selected.id, {
        replaceExisting: true,
      });
      appState.pushMessage(`"${selected.name}" 구성을 현재 프로젝트에 적용했습니다.`);
    };

    const createSceneTemplate = async (empty: boolean) => {
      const name = await appState.pushDialogAsync({
        type: 'input-confirm',
        text: empty ? '빈 씬 템플릿 이름' : '현재 씬 구성으로 만들 템플릿 이름',
      });
      if (!name) return;
      const session = empty
        ? await templateService.createEmptySceneTemplate(name)
        : appState.curSession
          ? await templateService.createSceneTemplateFrom(appState.curSession, name)
          : null;
      if (session && empty) {
        appState.curSession = session;
        onClose();
      }
    };

    const importSceneTemplateFile = () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        try {
          const name = await templateService.importSceneTemplateFile(
            await file.text(),
          );
          appState.pushMessage(`씬 템플릿 "${name}"을 불러왔습니다.`);
        } catch (error: any) {
          appState.pushMessage(error?.message || '불러오기에 실패했습니다.');
        }
      };
      input.click();
    };

    return (
      <ModalOverlay
        isOpen={isOpen}
        onClose={onClose}
        title="템플릿 관리"
        width="max-w-6xl"
      >
        <div className="flex gap-2 mb-3">
          <button
            className={`round-button ${tab === 'project' ? 'back-sky' : 'back-gray'}`}
            onClick={() => setTab('project')}
          >
            프로젝트 템플릿
          </button>
          <button
            className={`round-button ${tab === 'scene' ? 'back-sky' : 'back-gray'}`}
            onClick={() => setTab('scene')}
          >
            씬 템플릿
          </button>
          <button
            className={`round-button ${tab === 'batch' ? 'back-sky' : 'back-gray'}`}
            disabled={!selected}
            onClick={() => setTab('batch')}
          >
            일괄 생성
          </button>
        </div>

        {tab === 'project' ? (
          <div className="grid md:grid-cols-[220px_1fr] gap-4 min-h-[55vh]">
            <div className="border line-color rounded-lg p-2 flex flex-col gap-2">
              <button className="round-button back-green" onClick={createProjectTemplate}>
                새 템플릿
              </button>
              {displayedTemplates.map((entry) => (
                <button
                  key={entry.id}
                  className={`text-left rounded px-2 py-2 ${selected?.id === entry.id ? 'back-sky' : 'back-gray'}`}
                  onClick={() => setSelectedId(entry.id)}
                >
                  {entry.name}{entry.folderLocal ? ' (폴더 전용)' : ''}
                </button>
              ))}
            </div>
            {selected ? (
              <div className="flex flex-col gap-4 min-w-0">
                <div className="flex flex-wrap gap-2">
                  <button className="round-button back-gray" onClick={renameProjectTemplate}>이름 변경</button>
                  <button
                    className="round-button back-gray"
                    onClick={async () => setSelectedId((await projectTemplateService.duplicate(selected.id)).id)}
                  >
                    복제
                  </button>
                  <button className="round-button back-red" onClick={deleteProjectTemplate}>삭제</button>
                  <button className="round-button back-green ml-auto" onClick={applyToCurrent}>현재 프로젝트에 적용</button>
                </div>
                <section className="r-card p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <h3 className="font-semibold">프롬프트·스타일</h3>
                    <button className="round-button back-gray ml-auto" onClick={importGlobalStyle}>글로벌 스타일 불러오기</button>
                  </div>
                  <div className="grid md:grid-cols-3 gap-2">
                    {[
                      ['frontPrompt', '상위 프롬프트'],
                      ['backPrompt', '하위 프롬프트'],
                      ['uc', '네거티브'],
                    ].map(([key, label]) => (
                      <label key={key} className="text-xs text-sub">
                        {label}
                        <div className="h-28 mt-1">
                          <PromptEditTextArea
                            value={selected.preset?.[key] || ''}
                            onChange={(value) => projectTemplateService.patchPreset(selected.id, { [key]: value })}
                          />
                        </div>
                      </label>
                    ))}
                  </div>
                </section>
                <section className="r-card p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold">캐릭터 프리셋 ({selected.characterPresets.length})</h3>
                    <button className="round-button back-gray ml-auto" onClick={importGlobalCharacter}>글로벌에서 추가</button>
                    <button className="round-button back-gray" onClick={importLocalCharacter}>현재 프로젝트에서 추가</button>
                  </div>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {selected.characterPresets.map((preset, index) => (
                      <span key={`${preset.name}-${index}`} className="rounded bg-[var(--c-surface-2)] px-2 py-1 text-sm">
                        {preset.name}
                        <button className="ml-2 text-red-500" onClick={() => projectTemplateService.removeCharacterPreset(selected.id, index)}>×</button>
                      </span>
                    ))}
                  </div>
                </section>
                <section className="r-card p-3">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold">씬 구성 ({selected.scenes.length})</h3>
                    <button className="round-button back-gray ml-auto" onClick={importScenes}>프로젝트에서 전체 교체</button>
                  </div>
                  <div className="text-sm text-sub mt-2">
                    {selected.scenes.map((scene) => scene.name).join(', ') || '지정된 씬이 없습니다.'}
                  </div>
                </section>
              </div>
            ) : (
              <div className="flex items-center justify-center text-sub">새 템플릿을 만들어주세요.</div>
            )}
          </div>
        ) : tab === 'scene' ? (
          <div className="flex flex-col gap-3 min-h-[45vh]">
            <div className="flex flex-wrap gap-2">
              <button className="round-button back-green" onClick={() => createSceneTemplate(true)}>빈 템플릿 만들기</button>
              <button className="round-button back-gray" disabled={!appState.curSession} onClick={() => createSceneTemplate(false)}>현재 씬 전체로 만들기</button>
              <button className="round-button back-gray" onClick={importSceneTemplateFile}>파일 불러오기</button>
            </div>
            {sceneTemplates.map((name) => (
              <div key={name} className="r-card p-3 flex flex-wrap items-center gap-2">
                <span className="font-semibold min-w-0 truncate">{name}</span>
                <button
                  className="round-button back-gray ml-auto"
                  onClick={async () => {
                    const session = await sessionService.get(name);
                    if (session) {
                      appState.curSession = session;
                      onClose();
                    }
                  }}
                >
                  열어 편집
                </button>
                <button
                  className="round-button back-gray"
                  disabled={!appState.curSession}
                  onClick={() => appState.curSession && templateService.promptForSceneTemplateImport(appState.curSession)}
                >
                  현재 프로젝트로 가져오기
                </button>
                <button
                  className="round-button back-gray"
                  onClick={async () => downloadText(`${name}.sdscene.json`, await templateService.exportSceneTemplateFile(name))}
                >
                  파일 저장
                </button>
                <button className="round-button back-red" onClick={() => appState.deleteProjectBackground(name)}>삭제</button>
              </div>
            ))}
          </div>
        ) : selected ? (
          <BatchCreatePanel templateId={selected.id} />
        ) : null}
      </ModalOverlay>
    );
  },
);

export default TemplateManagerModal;
