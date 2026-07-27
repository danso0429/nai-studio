import { useEffect, useMemo, useRef, useState } from 'react';
import { backend } from '../models';
import { appState } from '../models/AppService';
import { StorageStatus } from '../backend';
import { extractApiError } from '../models/util';
import {
  createStorageMigrationReloadTracker,
  noteStorageMigrationStarted,
  observeStorageMigrationStatus,
  resetStorageMigrationReload,
} from '../models/storageMigrationReload.mjs';

function formatBytes(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '확인 불가';
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let amount = value;
  let unit = -1;
  do {
    amount /= 1024;
    unit++;
  } while (amount >= 1024 && unit < units.length - 1);
  return `${amount.toFixed(amount >= 10 ? 1 : 2)} ${units[unit]}`;
}

const blockerLabels: Record<string, string> = {
  'generation-queue': '생성 큐 또는 예약이 남아 있음',
  'export-queue': '이미지 내보내기가 진행 중임',
  'project-leases': '이 탭 또는 다른 탭에서 프로젝트를 열고 있음',
};

export default function StorageMigrationGate() {
  const [status, setStatus] = useState<StorageStatus | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const reloadTracker = useRef(createStorageMigrationReloadTracker());

  const reloadAfterMigration = async () => {
    try {
      // 마지막 프로젝트 자동 복원과 reload가 겹치더라도 기존 client lease를
      // 먼저 저장·해제해 새 client가 읽기 전용 미러로 떨어지지 않게 한다.
      await appState.closeCurrentSession();
      await backend.flushAllFileWrites();
      window.location.reload();
    } catch (cause) {
      resetStorageMigrationReload(reloadTracker.current);
      setError(`저장소 전환 후 새로고침 준비 실패: ${extractApiError(cause)}`);
    }
  };

  const refresh = async () => {
    try {
      const next = await backend.getStorageStatus();
      const shouldReload = observeStorageMigrationStatus(reloadTracker.current, next);
      setStatus(next);
      if (shouldReload) await reloadAfterMigration();
    } catch (cause) {
      setError(extractApiError(cause));
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (!status) return;
    const needsPolling =
      status.runtime.running ||
      status.runtime.phase === 'failed' ||
      status.migration?.state === 'partial' ||
      !!status.migrationLedgerError ||
      (!status.optedOut &&
        (status.detection === 'legacy' || status.detection === 'recovery-required'));
    if (!needsPolling) return;
    const timer = window.setInterval(() => void refresh(), 1500);
    return () => window.clearInterval(timer);
  }, [
    status?.runtime.running,
    status?.runtime.phase,
    status?.migration?.state,
    status?.migrationLedgerError,
    status?.optedOut,
    status?.detection,
  ]);

  const failures = useMemo(
    () => status?.migration?.projects.filter((project) => project.state === 'failed') ?? [],
    [status],
  );
  if (!status || dismissed) return null;
  if (
    status.optedOut && !status.runtime.running &&
    status.migration?.state !== 'partial' && !status.migrationLedgerError
  ) return null;
  const needsGate = status.detection === 'legacy' || status.detection === 'recovery-required' || status.runtime.running ||
    status.runtime.phase === 'failed' || status.migration?.state === 'partial' || !!status.migrationLedgerError;
  if (!needsGate) return null;

  const hardBlockers = status.blockers.filter((blocker) => blocker !== 'project-leases');
  const backupFits = status.freeBytes != null && status.estimatedBytes > 0 &&
    status.freeBytes >= status.estimatedBytes * 1.2;

  const start = async (backup: boolean) => {
    const warning = backup
      ? '전체 프로젝트 데이터를 백업한 뒤 저장소 v2로 물리 이동해요. 이동 중에는 앱을 사용할 수 없고, 구 저장소 정리는 별도 승인 전 실행하지 않아요. 계속할까요?'
      : '백업 없이 프로젝트 데이터를 저장소 v2로 물리 이동해요. 중단되면 원장으로 재개하지만 별도 복구 사본은 만들지 않아요. 계속할까요?';
    if (!window.confirm(warning)) return;
    if (!backup && !window.confirm('마지막 확인이에요. 복구용 백업을 만들지 않고 실제 프로젝트 데이터를 이동할까요?')) return;
    setStarting(true);
    setError('');
    try {
      noteStorageMigrationStarted(reloadTracker.current);
      await appState.closeCurrentSession();
      await backend.flushAllFileWrites();
      await backend.startStorageMigration(backup);
      await refresh();
    } catch (cause) {
      setError(extractApiError(cause));
      await refresh();
    } finally {
      setStarting(false);
    }
  };

  const dismissPermanently = async () => {
    if (!window.confirm('이 서버에서는 저장소 v2 전환 안내를 다시 표시하지 않아요. 환경설정에서 언제든 다시 켤 수 있어요. 계속할까요?')) return;
    setStarting(true);
    setError('');
    try {
      await backend.setStorageMigrationOptOut(true);
      setDismissed(true);
    } catch (cause) {
      setError(extractApiError(cause));
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[var(--z-blocking-modal)] flex items-center justify-center p-4 bg-black/70">
      <div className="w-full max-w-xl max-h-[90dvh] overflow-y-auto rounded-xl border line-color bg-[var(--c-surface-1)] p-5 shadow-2xl">
        <h2 className="text-lg font-bold">저장소 v2 전환</h2>
        {status.runtime.running ? (
          <div className="mt-4 space-y-3">
            <p>{status.runtime.phase === 'backing-up' ? '이동 전 백업을 만들고 있어요.' : '프로젝트 데이터를 이동하고 있어요.'}</p>
            {status.runtime.total > 0 && (
              <p className="text-sm text-[var(--c-text-muted)]">
                {status.runtime.current} / {status.runtime.total} · {status.runtime.name || '준비 중'}
              </p>
            )}
            <div className="h-2 overflow-hidden rounded bg-[var(--c-surface-3)]">
              <div
                className="h-full bg-sky-500 transition-[width]"
                style={{ width: status.runtime.total > 0 ? `${Math.min(100, status.runtime.current / status.runtime.total * 100)}%` : '8%' }}
              />
            </div>
            <p className="text-sm text-amber-500">이 화면을 닫거나 다른 탭에서 프로젝트를 편집하지 마세요.</p>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <p>
              {status.detection === 'recovery-required'
                ? '저장소 v2 마커 없이 기존 workspace 데이터가 발견됐어요. 자동 활성화하지 않고 백업 여부와 채택을 확인해요.'
                : '프로젝트별 JSON과 이미지를 한 폴더에 모아 이름 변경·삭제·스캔을 더 안전하게 처리해요. 기존 데이터는 선택 전까지 현재 위치에 그대로 있어요.'}
            </p>
            <div className="rounded-lg bg-[var(--c-surface-2)] p-3 text-sm space-y-1">
              <p>기존 프로젝트: {status.legacyProjects}개</p>
              {status.workspaceProjects > 0 && <p>기존 workspace 프로젝트: {status.workspaceProjects}개</p>}
              <p>이동 대상 크기: {formatBytes(status.estimatedBytes)}</p>
              <p>서버 여유 공간: {formatBytes(status.freeBytes)}</p>
              {status.estimatedBytes > 0 && !backupFits && (
                <p className="text-amber-500">백업용 여유 공간 20%를 확인하지 못했어요.</p>
              )}
            </div>
            {status.blockers.length > 0 && (
              <div className="rounded-lg border border-amber-500/50 p-3 text-sm">
                {status.blockers.map((blocker) => (
                  <p key={blocker}>• {blockerLabels[blocker] || blocker}</p>
                ))}
              </div>
            )}
            {failures.length > 0 && (
              <div className="rounded-lg border border-red-500/50 p-3 text-sm">
                <p className="font-semibold">이동하지 못한 프로젝트</p>
                {failures.map((project) => <p key={project.name}>• {project.name}: {project.error}</p>)}
              </div>
            )}
            {status.scanWarnings.length > 0 && (
              <div className="rounded-lg border border-red-500/50 p-3 text-sm">
                <p className="font-semibold">읽을 수 없는 workspace 항목</p>
                {status.scanWarnings.map((warning) => <p key={warning.dir}>• {warning.dir}: {warning.error}</p>)}
              </div>
            )}
            {status.migrationLedgerError && (
              <div className="rounded-lg border border-red-500/50 p-3 text-sm">
                <p className="font-semibold">마이그레이션 원장을 읽을 수 없음</p>
                <p>{status.migrationLedgerError}</p>
              </div>
            )}
            {(error || status.runtime.error) && (
              <p className="text-sm text-red-500">{error || status.runtime.error}</p>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <button className="btn-ghost rounded-md px-3 py-2" disabled={starting} onClick={() => setDismissed(true)}>
                나중에 하기
              </button>
              <button className="btn-ghost rounded-md px-3 py-2" disabled={starting} onClick={() => void dismissPermanently()}>
                다시 알리지 않음
              </button>
              <button
                className="btn-ghost rounded-md px-3 py-2"
                disabled={starting || hardBlockers.length > 0 || status.scanWarnings.length > 0 || !!status.migrationLedgerError}
                onClick={() => void start(false)}
              >
                백업 없이 전환
              </button>
              <button
                className="btn btn-solid-sky rounded-md px-3 py-2"
                disabled={starting || hardBlockers.length > 0 || !backupFits || status.scanWarnings.length > 0 || !!status.migrationLedgerError}
                onClick={() => void start(true)}
              >
                {starting ? '준비 중…' : '백업 후 전환'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
