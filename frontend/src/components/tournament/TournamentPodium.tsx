import React from 'react';
import { Player } from '../../models/types';
import { getThumbURL } from '../../backends/serverBackend';

interface Props {
  podium: Player[];
  outputDir: string;
}

// 모든 라운드 종료 후 1~3위 podium. 기존엔 1위 이미지 1장만 표시했음.
// 1위 가운데(가장 큼) + 2위 왼쪽 + 3위 오른쪽 배치. 모바일 좁으면 세로 stack.
const PODIUM_THUMB = 400;

const TournamentPodium = React.memo(({ podium, outputDir }: Props) => {
  if (!podium.length) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500 dark:text-gray-400">
        결과가 없어요
      </div>
    );
  }
  const first = podium.find((p) => p.rank === 0);
  const second = podium.find((p) => p.rank === 1);
  const third = podium.find((p) => p.rank === 2);

  return (
    <div className="flex-1 w-full overflow-auto p-3 md:p-6">
      <div className="flex flex-col md:flex-row items-stretch md:items-end justify-center gap-3 md:gap-6 max-w-4xl mx-auto h-full">
        {second && <PodiumSlot rank={2} player={second} outputDir={outputDir} heightClass="md:h-3/4" />}
        {first && <PodiumSlot rank={1} player={first} outputDir={outputDir} heightClass="md:h-full" highlight />}
        {third && <PodiumSlot rank={3} player={third} outputDir={outputDir} heightClass="md:h-2/3" />}
      </div>
    </div>
  );
});

interface SlotProps {
  rank: number; // 1/2/3
  player: Player;
  outputDir: string;
  heightClass: string;
  highlight?: boolean;
}

const PodiumSlot = React.memo(({ rank, player, outputDir, heightClass, highlight }: SlotProps) => {
  const url = getThumbURL(`${outputDir}/${player.path}`, PODIUM_THUMB);
  const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : '🥉';
  return (
    <div
      className={
        `flex-1 flex flex-col items-center gap-2 ${heightClass} ` +
        (highlight ? 'order-first md:order-none' : '')
      }
    >
      <div
        className={
          'w-full flex-1 flex items-center justify-center overflow-hidden rounded-lg ' +
          (highlight
            ? 'ring-4 ring-yellow-400 dark:ring-yellow-500 shadow-lg'
            : 'ring-1 ring-gray-300 dark:ring-slate-600')
        }
      >
        <img
          className="w-full h-full object-contain"
          src={url}
          draggable={false}
          alt={`${rank}위`}
        />
      </div>
      <div className="flex items-center gap-1.5 text-default">
        <span className="text-xl md:text-2xl">{medal}</span>
        <span className={'font-semibold ' + (highlight ? 'text-lg md:text-xl' : 'text-sm md:text-base')}>
          {rank}위
        </span>
      </div>
    </div>
  );
});

export default TournamentPodium;
