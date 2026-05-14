import React from 'react';
import { TournamentState } from './useTournament';

interface Props {
  matchPosition: TournamentState['matchPosition'];
}

// 헤더 — 현재 라운드의 "X위 결정 / 결승전·N강 / 매치 i/total" + progress bar.
// 회귀: 기존엔 텍스트만이라 진행 정도 한 눈에 안 보임. 이번 phase C에서 시각적 bar 추가.
const TournamentHeader = React.memo(({ matchPosition }: Props) => {
  if (!matchPosition) {
    return (
      <div className="px-2 py-3 md:px-4 md:py-4 flex-none text-default border-b line-color">
        <span className="font-bold text-xl">모든 순위가 확정되었습니다</span>
      </div>
    );
  }
  const { current, total, finalizingRank, stageLabel } = matchPosition;
  const percent = total > 0 ? Math.min(100, ((current - 1) / total) * 100) : 0;
  return (
    <div className="px-2 pt-3 pb-2 md:px-4 md:pt-4 md:pb-3 flex-none text-default border-b line-color">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-bold text-lg md:text-xl">
          {finalizingRank + 1}위 결정전 · {stageLabel}
        </span>
        <span className="text-sm text-gray-500 dark:text-gray-400">
          {current} / {total}
        </span>
      </div>
      <div className="mt-2 h-1.5 rounded-full bg-gray-200 dark:bg-slate-700 overflow-hidden">
        <div
          className="h-full bg-sky-500 transition-[width] duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
});

export default TournamentHeader;
