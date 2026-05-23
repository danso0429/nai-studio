import { useEffect, useMemo, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { appState } from '../models/AppService';
import { DropdownSelect, Option } from './UtilComponents';
import { formatProjectNameConflict } from '../models/util';

// 4개 이하면 페이지 1개. 그 이상이면 4개씩 페이지 나뉨.
// 본인 spec (2026-05-17): 모바일 세로 + iOS 키보드 올라온 상태에서도 4개 입력칸 +
// 4개 원본 이름 라벨이 다 보이게.
const PAGE_SIZE = 4;

// 폴더 dropdown value 컨벤션:
//   undefined  → 미선택 (confirm 비활성)
//   ''         → 폴더없음(루트)
//   '<폴더명>' → 해당 폴더
const ROOT_VALUE = '';

const MultiImportNameDialog = observer(() => {
  const req = appState.multiImportRequest;

  const [names, setNames] = useState<string[]>([]);
  const [page, setPage] = useState(0);
  // 폴더 선택값 — 사용자 강제 선택 룰: undefined로 시작 → confirm 비활성.
  const [folder, setFolder] = useState<string | undefined>(undefined);

  // req 바뀌면 입력값을 default로 재초기화 + 페이지 0으로 이동.
  // 폴더도 매번 빈 칸으로 초기화 — 사용자가 매 임포트마다 명시 선택.
  useEffect(() => {
    if (req) {
      setNames(req.items.map((i) => i.defaultName));
      setPage(0);
      setFolder(undefined);
    }
  }, [req]);

  const totalPages = req ? Math.max(1, Math.ceil(req.items.length / PAGE_SIZE)) : 1;

  // 검증: 빈칸 / 기존 프로젝트 이름 중복 / 본 입력칸끼리 중복.
  // 페이지 밖에서도 잡히게 전체 names 기준.
  const errors = useMemo(() => {
    if (!req) return [];
    const existing = new Set(req.existingNames);
    const seen = new Map<string, number>();
    for (const n of names) {
      seen.set(n, (seen.get(n) || 0) + 1);
    }
    const folderMap = req.existingFolderMap || {};
    return names.map((n) => {
      const trimmed = n.trim();
      if (!trimmed) return '이름을 입력해주세요';
      if (existing.has(trimmed)) return formatProjectNameConflict(folderMap[trimmed] ?? null);
      if ((seen.get(n) || 0) > 1) return '다른 칸과 중복된 이름';
      return null;
    });
  }, [names, req]);

  // 폴더 옵션: 루트 가상 항목 + 기존 폴더들. 기존 폴더 0개여도 루트 한 항목은 항상 노출.
  const folderOptions = useMemo<Option<string>[]>(() => {
    if (!req) return [];
    return [
      { value: ROOT_VALUE, label: '📂 폴더없음 (루트)' },
      ...req.availableFolders.map((f) => ({ value: f, label: `📁 ${f}` })),
    ];
  }, [req]);

  if (!req) return null;

  const namesValid = errors.every((e) => !e);
  const folderValid = folder !== undefined;
  const valid = namesValid && folderValid;
  const start = page * PAGE_SIZE;
  const visible = req.items.slice(start, start + PAGE_SIZE);

  // 다른 페이지에 남아있는 오류 갯수 (현재 페이지 외)
  const otherPageErrorCount = errors.filter((e, idx) => {
    if (!e) return false;
    return idx < start || idx >= start + PAGE_SIZE;
  }).length;

  const handleConfirm = () => {
    if (!valid) return;
    // folder ROOT_VALUE('') → null (서비스 API 컨벤션)
    const folderArg = folder === ROOT_VALUE ? null : folder!;
    req.onConfirm(names.map((n) => n.trim()), folderArg);
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-center items-start pt-12 bg-black/40">
      <div className="m-4 p-4 rounded-md shadow-xl bg-white dark:bg-slate-800 text-default w-full max-w-md max-h-[90vh] flex flex-col">
        <div className="text-default font-medium mb-1">
          {req.items.length}개 프로젝트 새로 임포트
        </div>
        <div className="text-sm text-gray-500 dark:text-gray-300 mb-3">
          각 프로젝트의 새 이름을 입력해주세요. 기본값은 충돌이 없으면 원본 이름이에요.
        </div>
        <div className="mb-3">
          <div className="text-sm text-default mb-1">저장 폴더</div>
          <DropdownSelect
            selectedOption={folder}
            options={folderOptions}
            onSelect={(opt) => setFolder(opt.value)}
            menuPlacement="auto"
          />
          {!folderValid && (
            <div className="text-xs text-red-500 mt-1">
              ⚠ 폴더를 선택해주세요
            </div>
          )}
        </div>
        <div className="flex-1 overflow-auto flex flex-col gap-3">
          {visible.map((it, idx) => {
            const realIdx = start + idx;
            const err = errors[realIdx];
            return (
              <div key={realIdx} className="flex flex-col gap-1">
                <input
                  type="text"
                  value={names[realIdx] ?? ''}
                  onChange={(e) => {
                    const next = [...names];
                    next[realIdx] = e.target.value;
                    setNames(next);
                  }}
                  className={
                    'gray-input' + (err ? ' ring-2 ring-red-500' : '')
                  }
                  placeholder="새 프로젝트 이름"
                />
                <div className="text-xs text-gray-500 dark:text-gray-400 ml-1 flex flex-wrap gap-x-2">
                  <span>원본: {it.origName}</span>
                  {err && <span className="text-red-500">⚠ {err}</span>}
                </div>
              </div>
            );
          })}
        </div>
        {totalPages > 1 && (
          <div className="flex justify-between items-center mt-3">
            <button
              className="px-3 py-1 rounded back-gray clickable disabled:opacity-40"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              이전
            </button>
            <span className="text-sm text-gray-500 dark:text-gray-300">
              페이지 {page + 1} / {totalPages}
            </span>
            <button
              className="px-3 py-1 rounded back-gray clickable disabled:opacity-40"
              disabled={page >= totalPages - 1}
              onClick={() =>
                setPage((p) => Math.min(totalPages - 1, p + 1))
              }
            >
              다음
            </button>
          </div>
        )}
        {otherPageErrorCount > 0 && (
          <div className="text-xs text-red-500 mt-2 text-center">
            다른 페이지에 {otherPageErrorCount}개 오류가 있어요.
          </div>
        )}
        <div className="flex gap-2 mt-4">
          <button
            className="flex-1 px-4 py-2 rounded back-sky clickable disabled:opacity-40"
            disabled={!valid}
            onClick={handleConfirm}
          >
            임포트
          </button>
          <button
            className="flex-1 px-4 py-2 rounded back-gray clickable"
            onClick={() => req.onCancel()}
          >
            취소
          </button>
        </div>
      </div>
    </div>
  );
});

export default MultiImportNameDialog;
