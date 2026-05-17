import React, { useEffect, useMemo, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { appState } from '../models/AppService';
import { sessionService } from '../models';
import { apiUrl, extractApiError } from '../models/util';
import ModalOverlay from './ModalOverlay';
import { FaCopy, FaPlay, FaCheck } from 'react-icons/fa';

type Action = 'overwrite' | 'skip';
interface PlanScene {
  name: string;
  currentSlots?: number[];
  currentCombos?: number;
  newSlots: number[];
  newCombos: number;
  action?: Action;
}
interface Plan {
  new: PlanScene[];
  conflicts: PlanScene[];
  applied?: { name: string; action: string }[];
  skipped?: string[];
}

const SceneImporterDialog = observer(() => {
  const [projects, setProjects] = useState<string[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>('');
  const [jsonText, setJsonText] = useState<string>('');
  const [plan, setPlan] = useState<Plan | null>(null);
  const [policy, setPolicy] = useState<Record<string, Action>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [resultMsg, setResultMsg] = useState<string>('');
  const [copied, setCopied] = useState(false);

  const isOpen = appState.sceneImporterOpen;

  // 프로젝트 목록 로드 (다이얼로그 열릴 때 1회)
  useEffect(() => {
    if (!isOpen) return;
    (async () => {
      try {
        const r = await fetch(apiUrl('/api/fs/list-recursive?path=projects'));
        const d = await r.json();
        const names = new Set<string>();
        for (const f of d.files || []) {
          if (!f.endsWith('.json')) continue;
          if (/\.bak[-.]/.test(f)) continue;
          const base = f.includes('/') ? f.split('/').pop()! : f;
          names.add(base.replace(/\.json$/, ''));
        }
        const list = Array.from(names).sort();
        setProjects(list);
        // 현재 세션이 있으면 그것을 기본 선택
        if (appState.curSession && list.includes(appState.curSession.name)) {
          setSelectedProject(appState.curSession.name);
        } else if (list.length > 0) {
          setSelectedProject(list[0]);
        }
      } catch (e: any) {
        setError('프로젝트 목록을 불러올 수 없어요: ' + e.message);
      }
    })();
  }, [isOpen]);

  // 다이얼로그 닫을 때 상태 초기화
  useEffect(() => {
    if (!isOpen) {
      setJsonText('');
      setPlan(null);
      setPolicy({});
      setError('');
      setResultMsg('');
      setCopied(false);
    }
  }, [isOpen]);

  // 텍스트 바뀌면 plan 초기화 (다시 미리보기 해야 함)
  useEffect(() => {
    setPlan(null);
    setPolicy({});
    setError('');
  }, [jsonText, selectedProject]);

  const copySchema = async () => {
    try {
      const r = await fetch(apiUrl('/api/import-schema/scenes'));
      const d = await r.json();
      await navigator.clipboard.writeText(JSON.stringify(d, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e: any) {
      setError('스키마 복사 실패: ' + e.message);
    }
  };

  const runDryRun = async () => {
    setError('');
    setResultMsg('');
    if (!selectedProject) {
      setError('프로젝트를 선택하세요');
      return;
    }
    let parsed: any;
    try {
      parsed = JSON.parse(jsonText);
    } catch (e: any) {
      setError('JSON 파싱 실패: ' + e.message);
      return;
    }
    setLoading(true);
    try {
      const body = {
        ...parsed,
        projectName: selectedProject,
        dryRun: true,
      };
      const r = await fetch(apiUrl('/api/projects/import-scenes'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!d.ok) {
        setError(d.error || '미리보기 실패');
        setPlan(null);
        return;
      }
      const newPolicy: Record<string, Action> = {};
      for (const c of d.plan.conflicts) {
        newPolicy[c.name] = 'skip';
      }
      setPolicy(newPolicy);
      setPlan(d.plan);
    } catch (e: any) {
      setError(extractApiError(e));
    } finally {
      setLoading(false);
    }
  };

  const apply = async () => {
    if (!plan || !selectedProject) return;
    setError('');
    setResultMsg('');
    let parsed: any;
    try {
      parsed = JSON.parse(jsonText);
    } catch (e: any) {
      setError('JSON 파싱 실패: ' + e.message);
      return;
    }
    // 본인 페인 (P13 #6): "전송이 보고만 있어야 + 다른 조작 통제". apply는
    // dialog 닫고 sticky 토스트 + 백그라운드 fetch + 결과 toast 패턴으로 전환
    // (SessionSelect 로딩 토스트 패턴과 동일).
    const body = {
      ...parsed,
      projectName: selectedProject,
      policy,
    };
    const targetProject = selectedProject;
    appState.closeSceneImporter();
    const toastId = appState.pushMessage(
      `씬 임포트 적용 중… (프로젝트 "${targetProject}")`,
      { sticky: true },
    );
    try {
      const r = await fetch(apiUrl('/api/projects/import-scenes'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      appState.dismissMessage(toastId);
      if (!d.ok) {
        appState.pushMessage(
          '✗ 씬 임포트 실패: ' + (d.error || '알 수 없는 오류'),
        );
        return;
      }
      const appliedCount = d.plan?.applied?.length ?? 0;
      const skippedCount = d.plan?.skipped?.length ?? 0;
      appState.pushMessage(
        `✓ 씬 임포트 완료 — 적용 ${appliedCount}개 / 건너뜀 ${skippedCount}개 (백업: ${d.backup})`,
      );
      // 현재 세션과 같은 프로젝트면 메모리 캐시 invalidate 후 재로딩
      if (appState.curSession?.name === targetProject) {
        delete sessionService.resources[targetProject];
        const fresh = await sessionService.get(targetProject);
        if (fresh) appState.curSession = fresh;
      } else {
        // 다른 프로젝트 캐시만 invalidate (다음 열 때 fresh)
        delete sessionService.resources[targetProject];
      }
    } catch (e: any) {
      appState.dismissMessage(toastId);
      appState.pushMessage('✗ 씬 임포트 실패: ' + extractApiError(e));
    }
  };

  const togglePolicy = (name: string) => {
    setPolicy((p) => ({
      ...p,
      [name]: p[name] === 'overwrite' ? 'skip' : 'overwrite',
    }));
  };

  const setAllOverwrite = (val: Action) => {
    if (!plan) return;
    const np: Record<string, Action> = {};
    for (const c of plan.conflicts) np[c.name] = val;
    setPolicy(np);
  };

  const summary = useMemo(() => {
    if (!plan) return '';
    const overwriteCount = plan.conflicts.filter(
      (c) => policy[c.name] === 'overwrite',
    ).length;
    const skipCount = plan.conflicts.length - overwriteCount;
    return `새 씬 ${plan.new.length} · overwrite ${overwriteCount} · skip ${skipCount}`;
  }, [plan, policy]);

  if (!isOpen) return null;

  return (
    <ModalOverlay
      isOpen={true}
      onClose={() => appState.closeSceneImporter()}
      title="씬 일괄 임포트"
      width="max-w-3xl"
    >
      <div className="flex flex-col gap-4 text-sm">
        {/* 1. 프로젝트 선택 */}
        <div>
          <label className="block font-medium text-gray-700 dark:text-gray-300 mb-1">
            1. 대상 프로젝트
          </label>
          <select
            value={selectedProject}
            onChange={(e) => setSelectedProject(e.target.value)}
            className="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-gray-100"
          >
            {projects.length === 0 && <option value="">로딩 중...</option>}
            {projects.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>

        {/* 2. 스키마 안내 */}
        <div className="rounded border border-gray-200 dark:border-slate-600 p-3 bg-gray-50 dark:bg-slate-700/40">
          <div className="flex items-start justify-between gap-3">
            <div className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
              2. <b>스키마를 복사</b>해서 외부 LLM에 보내요. LLM이 같은 형식의
              JSON을 생성하면, 그 결과를 아래 텍스트 영역에 붙여넣어요.
            </div>
            <button
              onClick={copySchema}
              className="flex-none px-3 py-1.5 rounded bg-sky-500 hover:bg-sky-600 text-white text-xs flex items-center gap-1.5"
            >
              {copied ? <FaCheck size={11} /> : <FaCopy size={11} />}
              {copied ? '복사됨' : '스키마 복사'}
            </button>
          </div>
        </div>

        {/* 3. JSON paste */}
        <div>
          <label className="block font-medium text-gray-700 dark:text-gray-300 mb-1">
            3. JSON 붙여넣기
          </label>
          <textarea
            value={jsonText}
            onChange={(e) => setJsonText(e.target.value)}
            placeholder='{"format": "sdstudio-scene-import-v1", "scenes": {...}}'
            rows={8}
            className="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-gray-100 text-xs font-mono"
          />
        </div>

        {/* 4. 미리보기 */}
        <div className="flex items-center gap-2">
          <button
            onClick={runDryRun}
            disabled={loading || !jsonText.trim()}
            className="px-4 py-2 rounded bg-gray-500 hover:bg-gray-600 text-white disabled:opacity-50 flex items-center gap-1.5"
          >
            <FaPlay size={11} />
            미리보기
          </button>
          {plan && (
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {summary}
            </span>
          )}
        </div>

        {error && (
          <div className="rounded border border-red-400 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 px-3 py-2 text-xs">
            {error}
          </div>
        )}

        {resultMsg && (
          <div className="rounded border border-green-400 bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300 px-3 py-2 text-xs">
            {resultMsg}
          </div>
        )}

        {/* 5. Plan 결과 */}
        {plan && (
          <div className="rounded border border-gray-200 dark:border-slate-600 max-h-[40vh] overflow-auto">
            {plan.new.length > 0 && (
              <div>
                <div className="px-3 py-2 text-xs font-medium bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300 border-b border-gray-200 dark:border-slate-600">
                  새 씬 ({plan.new.length})
                </div>
                {plan.new.map((s) => (
                  <div
                    key={s.name}
                    className="px-3 py-1.5 flex justify-between border-b border-gray-100 dark:border-slate-700 last:border-b-0"
                  >
                    <span className="truncate text-gray-700 dark:text-gray-300">
                      {s.name}
                    </span>
                    <span className="text-xs text-gray-400 flex-none ml-2">
                      [{s.newSlots.join(',')}] = {s.newCombos}장
                    </span>
                  </div>
                ))}
              </div>
            )}
            {plan.conflicts.length > 0 && (
              <div>
                <div className="px-3 py-2 text-xs font-medium bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border-b border-gray-200 dark:border-slate-600 flex items-center justify-between">
                  <span>충돌 ({plan.conflicts.length})</span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setAllOverwrite('overwrite')}
                      className="text-xs px-2 py-0.5 rounded bg-amber-500 hover:bg-amber-600 text-white"
                    >
                      모두 덮어쓰기
                    </button>
                    <button
                      onClick={() => setAllOverwrite('skip')}
                      className="text-xs px-2 py-0.5 rounded bg-gray-400 hover:bg-gray-500 text-white"
                    >
                      모두 건너뛰기
                    </button>
                  </div>
                </div>
                {plan.conflicts.map((c) => {
                  const action = policy[c.name] || 'skip';
                  return (
                    <div
                      key={c.name}
                      className="px-3 py-1.5 flex items-center justify-between gap-2 border-b border-gray-100 dark:border-slate-700 last:border-b-0"
                    >
                      <span className="truncate text-gray-700 dark:text-gray-300 flex-1">
                        {c.name}
                      </span>
                      <span className="text-xs text-gray-400 flex-none">
                        {c.currentCombos}장 → {c.newCombos}장
                      </span>
                      <button
                        onClick={() => togglePolicy(c.name)}
                        className={`flex-none text-xs px-2 py-0.5 rounded ${
                          action === 'overwrite'
                            ? 'bg-amber-500 hover:bg-amber-600 text-white'
                            : 'bg-gray-300 dark:bg-slate-600 hover:bg-gray-400 dark:hover:bg-slate-500 text-gray-700 dark:text-gray-300'
                        }`}
                      >
                        {action === 'overwrite' ? '덮어쓰기' : '건너뛰기'}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            {plan.new.length === 0 && plan.conflicts.length === 0 && (
              <div className="px-3 py-4 text-center text-xs text-gray-400">
                변경할 씬이 없어요.
              </div>
            )}
          </div>
        )}

        {/* 6. Apply */}
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={() => appState.closeSceneImporter()}
            className="px-4 py-2 rounded bg-gray-300 dark:bg-slate-600 hover:bg-gray-400 dark:hover:bg-slate-500 text-gray-700 dark:text-gray-200"
          >
            닫기
          </button>
          <button
            onClick={apply}
            disabled={
              loading ||
              !plan ||
              (plan.new.length === 0 && plan.conflicts.length === 0)
            }
            className="px-4 py-2 rounded bg-sky-500 hover:bg-sky-600 text-white disabled:opacity-50"
          >
            {loading ? '진행 중...' : '적용 (백업 후)'}
          </button>
        </div>
      </div>
    </ModalOverlay>
  );
});

export default SceneImporterDialog;
