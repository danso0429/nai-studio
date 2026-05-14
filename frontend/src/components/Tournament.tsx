import { observer } from 'mobx-react-lite';
import { Scene, InpaintScene } from '../models/types';
import { useTournament } from './tournament/useTournament';
import TournamentHeader from './tournament/TournamentHeader';
import TournamentToolbar from './tournament/TournamentToolbar';
import TournamentArena from './tournament/TournamentArena';
import TournamentPodium from './tournament/TournamentPodium';

interface TournamentProps {
  scene: Scene | InpaintScene;
  path: string;
}

// 이상형 월드컵 — 본 Tournament.tsx는 layout + 컴포넌트 컴포지션만 담당하는 얇은 wrapper.
// 게임 로직/네트워크/이미지 로딩은 useTournament hook으로 격리, UI는 tournament/* 4개
// 서브컴포넌트로 분리해 추후 기능 추가/제거 시 영향 범위 격리.
//
// 기존 단일 353줄 파일에서 phase A+B+C로 재제작 (2026-05-14 본인 요청):
// - Phase A 성능: imageService.fetchImage(base64) → getThumbURL(URL) + 다음 매치 prefetch
// - Phase B 모듈화: useTournament hook + TournamentHeader/Toolbar/Arena/Podium 분리
// - Phase C UI: 진행률 bar, 1~3위 podium, "1위 이미지 폴더 열기" 명확화 + 아이콘
const Tournament = observer(({ scene, path }: TournamentProps) => {
  const { state, actions, matchPlayerPaths, outputDir } = useTournament(scene, path);

  return (
    <div className="flex flex-col w-full h-full">
      <TournamentHeader matchPosition={state.matchPosition} />
      <TournamentToolbar actions={actions} state={state} />
      {state.error ? (
        <div className="flex-1 flex items-center justify-center text-red-500 px-4 text-center">
          {state.error}
        </div>
      ) : state.isLoading ? (
        <div className="flex-1 flex items-center justify-center text-gray-500 dark:text-gray-400">
          로딩 중...
        </div>
      ) : state.arenaURLs && matchPlayerPaths ? (
        <TournamentArena
          arenaURLs={state.arenaURLs}
          matchPlayerPaths={matchPlayerPaths}
          outputDir={outputDir}
          actions={actions}
          prefetchURLs={state.prefetchURLs}
        />
      ) : (
        <TournamentPodium podium={state.podium} outputDir={outputDir} />
      )}
    </div>
  );
});

export default Tournament;
