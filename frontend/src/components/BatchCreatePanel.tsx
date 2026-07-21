import { useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { FaPlay, FaStop } from 'react-icons/fa';
import {
  globalCharacterPresetService,
  sessionService,
  templateService,
} from '../models';
import { appState } from '../models/AppService';
import {
  buildBatchCombinations,
  resolveBatchName,
} from '../models/batchCreatePlan';
import { queueProjectsForGeneration } from '../models/sceneQueueActions';

const BatchCreatePanel = observer(({ templateId }: { templateId: string }) => {
  const [selectedCharacters, setSelectedCharacters] = useState<Set<string>>(new Set());
  const [selectedScenes, setSelectedScenes] = useState<Set<string>>(new Set());
  const [folder, setFolder] = useState('');
  const [subfolders, setSubfolders] = useState(true);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; current: string } | null>(null);
  const [result, setResult] = useState<{
    created: string[];
    failed: { name: string; error: string }[];
    cancelled: boolean;
  } | null>(null);
  const cancelRef = useRef(false);

  const characters = globalCharacterPresetService.list();
  const sceneTemplates = templateService.listSceneTemplates();
  const combinations = useMemo(
    () =>
      buildBatchCombinations(
        characters
          .filter((entry) => selectedCharacters.has(entry.id))
          .map((entry) => ({ id: entry.id, name: entry.name })),
        sceneTemplates.filter((name) => selectedScenes.has(name)),
        subfolders,
      ),
    [characters, sceneTemplates, selectedCharacters, selectedScenes, subfolders],
  );
  const preview = useMemo(() => {
    const taken = new Set(sessionService.list());
    return combinations.map((item) => resolveBatchName(item.name, taken));
  }, [combinations]);

  const toggle = (set: Set<string>, value: string, update: (next: Set<string>) => void) => {
    const next = new Set(set);
    next.has(value) ? next.delete(value) : next.add(value);
    update(next);
  };

  const run = async () => {
    setRunning(true);
    setResult(null);
    cancelRef.current = false;
    try {
      const next = await templateService.batchCreateFromTemplate({
        templateId,
        folder: folder.trim(),
        items: combinations,
        shouldCancel: () => cancelRef.current,
        onProgress: (done, total, current) => setProgress({ done, total, current }),
      });
      setResult(next);
      appState.pushMessage(
        `일괄 생성 완료 — 성공 ${next.created.length}개${next.failed.length ? ` · 실패 ${next.failed.length}개` : ''}`,
      );
    } finally {
      setRunning(false);
      setProgress(null);
    }
  };

  const execute = () => {
    if (!folder.trim()) {
      appState.pushMessage('대상 폴더 이름을 입력해주세요.');
      return;
    }
    if (!combinations.length) return;
    const template = (async () => {
      const { projectTemplateService } = await import('../models');
      return projectTemplateService.get(templateId);
    })();
    const confirmCount = () => {
      if (combinations.length >= 50) {
        appState.pushDialog({
          type: 'confirm',
          text: `프로젝트 ${combinations.length}개를 생성할까요?`,
          callback: run,
        });
      } else {
        void run();
      }
    };
    void template.then((entry) => {
      const hasPrompt = Boolean(
        entry?.preset?.frontPrompt?.trim() || entry?.preset?.backPrompt?.trim(),
      );
      if (!hasPrompt) {
        appState.pushDialog({
          type: 'confirm',
          text: '베이스 템플릿의 상위·하위 프롬프트가 비어 있습니다. 그래도 생성할까요?',
          callback: confirmCount,
        });
      } else {
        confirmCount();
      }
    });
  };

  const reserveCreated = () => {
    if (!result?.created.length) return;
    appState.pushDialog({
      type: 'confirm',
      text: `방금 만든 프로젝트 ${result.created.length}개의 모든 씬을 각 ${appState.samples}장씩 예약 등록할까요?`,
      callback: async () => {
        const queued = await queueProjectsForGeneration(
          result.created,
          appState.samples,
          (done, total, current) => setProgress({ done, total, current }),
        );
        setProgress(null);
        appState.pushMessage(
          `일괄 예약 등록 완료 — 씬 ${queued.queuedScenes}개${queued.failedProjects.length ? ` · 문제 프로젝트 ${queued.failedProjects.length}개` : ''}`,
        );
      },
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-sub">
        선택한 캐릭터 프리셋 × 씬 템플릿 조합마다 베이스 템플릿을 상속한 프로젝트를 만듭니다.
      </p>
      <label className="r-card p-3 text-sm">
        대상 폴더
        <input
          className="gray-input w-full mt-1"
          value={folder}
          disabled={running}
          placeholder="예: 캐릭터 CG"
          onChange={(event) => setFolder(event.currentTarget.value)}
        />
      </label>
      <section className="r-card p-3">
        <div className="font-semibold mb-2">캐릭터 축 ({selectedCharacters.size}개)</div>
        <div className="max-h-44 overflow-y-auto grid md:grid-cols-2 gap-1">
          {characters.map((entry) => (
            <label key={entry.id} className="flex items-center gap-2 text-sm p-1 rounded hover:bg-[var(--c-surface-2)]">
              <input
                type="checkbox"
                checked={selectedCharacters.has(entry.id)}
                onChange={() => toggle(selectedCharacters, entry.id, setSelectedCharacters)}
              />
              <span className="truncate">{entry.name}{entry.folder ? ` · 📁${entry.folder}` : ''}</span>
            </label>
          ))}
        </div>
      </section>
      <section className="r-card p-3">
        <div className="font-semibold mb-2">씬 축 ({selectedScenes.size}개)</div>
        <div className="max-h-36 overflow-y-auto grid md:grid-cols-2 gap-1">
          {sceneTemplates.map((name) => (
            <label key={name} className="flex items-center gap-2 text-sm p-1 rounded hover:bg-[var(--c-surface-2)]">
              <input type="checkbox" checked={selectedScenes.has(name)} onChange={() => toggle(selectedScenes, name, setSelectedScenes)} />
              <span className="truncate">{name}</span>
            </label>
          ))}
        </div>
      </section>
      {selectedCharacters.size > 0 && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={subfolders} onChange={(event) => setSubfolders(event.currentTarget.checked)} />
          캐릭터별 서브폴더로 묶기
        </label>
      )}
      <section className="r-card p-3">
        <div className="font-semibold">미리보기 — {combinations.length}개</div>
        <div className="max-h-32 overflow-y-auto text-xs text-sub mt-2">
          {preview.map((name, index) => (
            <div key={`${name}-${index}`}>
              {combinations[index].subfolder ? `${combinations[index].subfolder}/` : ''}{name}
            </div>
          ))}
        </div>
      </section>
      {progress && (
        <div className="r-card p-3 text-sm">
          {progress.done}/{progress.total} — {progress.current}
        </div>
      )}
      {result && (
        <div className="r-card p-3 text-sm">
          성공 {result.created.length}개 · 실패 {result.failed.length}개{result.cancelled ? ' · 취소됨' : ''}
          {result.failed.map((failure) => <div key={failure.name} className="text-red-500 text-xs">{failure.name}: {failure.error}</div>)}
        </div>
      )}
      <div className="flex justify-end gap-2">
        {running ? (
          <button className="round-button back-red" onClick={() => { cancelRef.current = true; }}><FaStop className="inline mr-1" />현재 항목 뒤 중단</button>
        ) : (
          <>
            {result?.created.length ? <button className="round-button back-green" onClick={reserveCreated}>생성한 프로젝트 예약 등록</button> : null}
            <button className="round-button back-purple" disabled={!combinations.length || !folder.trim()} onClick={execute}><FaPlay className="inline mr-1" />{combinations.length}개 생성</button>
          </>
        )}
      </div>
    </div>
  );
});

export default BatchCreatePanel;
