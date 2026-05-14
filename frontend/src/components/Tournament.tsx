import { useCallback, useMemo, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Scene, InpaintScene } from '../models/types';
import { useTournament } from './tournament/useTournament';
import type { TournamentActions } from './tournament/useTournament';
import TournamentHeader from './tournament/TournamentHeader';
import TournamentToolbar from './tournament/TournamentToolbar';
import TournamentArena from './tournament/TournamentArena';
import TournamentPodium from './tournament/TournamentPodium';
import { FloatView } from './FloatView';
import { getImageURL } from '../backends/serverBackend';

interface TournamentProps {
  scene: Scene | InpaintScene;
  path: string;
}

// 이상형 월드컵 — 본 Tournament.tsx는 layout + 컴포넌트 컴포지션만 담당하는 얇은 wrapper.
// 게임 로직/네트워크/이미지 로딩은 useTournament hook으로 격리, UI는 tournament/* 4개
// 서브컴포넌트로 분리해 추후 기능 추가/제거 시 영향 범위 격리.
//
// "1위 이미지 보기" — 본인 페인(P12 세션 #7): 기존 window.open 새 탭은 모바일 Safari에서
// 뒤로 가기 불가. 인라인 FloatView로 띄워서 FloatView 자체의 X 버튼 + Escape로 닫기 가능.
const Tournament = observer(({ scene, path }: TournamentProps) => {
  const { state, actions: gameActions, matchPlayerPaths, outputDir } = useTournament(scene, path);
  const [winnerViewerOpen, setWinnerViewerOpen] = useState(false);

  const openWinnerImage = useCallback(() => {
    if (!state.winnerPath) return;
    setWinnerViewerOpen(true);
  }, [state.winnerPath]);

  const actions: TournamentActions = useMemo(
    () => ({ ...gameActions, openWinnerImage }),
    [gameActions, openWinnerImage],
  );

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
      {winnerViewerOpen && state.winnerPath && (
        <FloatView priority={3} onEscape={() => setWinnerViewerOpen(false)}>
          <div className="w-full h-full flex items-center justify-center bg-black/95">
            <img
              className="max-w-full max-h-full object-contain"
              src={getImageURL(`${outputDir}/${state.winnerPath}`)}
              draggable={false}
              alt="1위 이미지"
            />
          </div>
        </FloatView>
      )}
    </div>
  );
});

export default Tournament;
