import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { backend, gameService, imageService } from '../../models';
import { shuffleArray } from '../../models/GameService';
import { GenericScene, Player, Round } from '../../models/types';
import { appState } from '../../models/AppService';
import { getThumbURL } from '../../backends/serverBackend';

// 이상형 월드컵 한 라운드의 진행/액션을 한 hook으로 묶어 UI 컴포넌트가 game/network 신경
// 안 쓰게 격리. Tournament.tsx가 직접 useState + 매번 fetchImage(base64) 하던 구조 회피.
//
// 이미지 fetch는 모두 getThumbURL(URL) 직접 — BatchItemSelector 패턴과 동일. 모바일에서
// base64 디코드 비용 + 큰 메모리 사용 회피, 14배 다운로드량 감소(commit f0e7df2).
// 현재 매치 표시 동시에 다음 매치 이미지는 `prefetchURLs`로 hidden <img> 박아 브라우저
// 캐시 선반영 → 클릭 → 다음 매치 표시까지 빈 화면 없음.

export interface TournamentState {
  round: Round | undefined;
  // 현재 매치에서 보여줄 두 이미지 URL (썸네일 500_).
  arenaURLs: [string, string] | null;
  // 다음 매치 이미지 URL — hidden <img>로 prefetch. UI에 보일 필요 없음.
  prefetchURLs: string[];
  // 1위가 확정된 직후 — game 안에 rank=0인 player 존재.
  winnerPath: string | null;
  // Top 3 podium용 — rank 0/1/2 순. 길이 < 3 가능.
  podium: Player[];
  // 매치 진행 위치 X / Y (헤더 표시용). null이면 모든 순위 확정.
  matchPosition: { current: number; total: number; finalizingRank: number; stageLabel: string } | null;
  isLoading: boolean;
  isComplete: boolean;
  error: string | null;
}

export interface TournamentActions {
  // wins: [boolean, boolean] — 두 player 중 누가 이겼는지. [true, false] = 왼쪽만 이김.
  applyMatchResult(wins: [boolean, boolean]): void;
  undoLastMatch(): void;
  reroll(): void;
  reset(): void;
  openWinnerImage(): void;
}

interface UseTournamentResult {
  state: TournamentState;
  actions: TournamentActions;
  // 현재 매치 두 player path (Arena 컴포넌트의 onContextMenu에서 절대 경로 만들 때 사용).
  matchPlayerPaths: [string, string] | null;
  // 이미지 경로의 dir prefix (절대 경로 합성용).
  outputDir: string;
}

const ARENA_THUMB_SIZE = 500; // 200/400/500 prewarm. 500이 가장 또렷.
const PODIUM_THUMB_SIZE = 200;

export function useTournament(scene: GenericScene, path: string): UseTournamentResult {
  const { curSession } = appState;
  // MobX scene.round/game을 mutate하는데 React가 알아채게 강제 re-render용 카운터.
  const [tick, setTick] = useState(0);
  const bump = useCallback(() => setTick((t) => t + 1), []);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // race lock — 매치 결정 후 다음 매치 set 사이에 빠른 더블탭 방지.
  const lock = useRef(false);

  const outputDir = curSession ? imageService.getOutputDir(curSession, scene) : '';
  const toURL = useCallback(
    (filename: string, size: number) => getThumbURL(`${outputDir}/${filename}`, size),
    [outputDir],
  );

  // ── 초기 로드: game 없으면 createGame, files vs game.length 검증, 첫 round 진입 ──
  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    (async () => {
      try {
        if (!scene.game) {
          scene.game = await gameService.createGame(path);
        }
        let files = await backend.listFiles(path);
        files = files.filter((f: string) => f.endsWith('.png'));
        if (scene.game!.length !== files.length) {
          appState.pushDialog({
            type: 'yes-only',
            text: '새로운 이미지가 추가되었습니다. 순위를 초기화 해주세요.',
          });
        }
        // round 없으면 첫 라운드 setup. 있으면 그대로 (멈췄던 위치 이어 진행).
        if (!scene.round) {
          const [, newRound] = gameService.nextRound(scene.game!);
          if (newRound) scene.round = newRound;
        }
        if (!cancelled) {
          setIsLoading(false);
          bump();
        }
      } catch (e: any) {
        if (!cancelled) {
          setError(e.message || String(e));
          setIsLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // scene 객체 자체가 바뀔 때만 재진입. tick 의존성 X.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, path]);

  // ── 매치 결과 적용 → 다음 매치로 이동 ──
  const advanceAfterResult = useCallback(() => {
    const round = scene.round;
    if (!round) return;
    round.curPlayer += 2;
    if (round.curPlayer + 1 >= round.players.length) {
      // 라운드 종료. winMask 기반으로 rank 갱신.
      finalizeRound(scene);
      const [, newRound] = gameService.nextRound(scene.game!);
      scene.round = newRound;
      gameService.gameUpdated(appState.curSession!, scene);
      // 1위(rank=0) 도달 안내.
      const winner = scene.game!.find((p) => p.rank === 0);
      if (winner) {
        appState.pushDialog({
          type: 'yes-only',
          text: '1위가 결정되었습니다. 여기서 멈춰도 됩니다.',
        });
      }
    } else {
    }
    bump();
    lock.current = false;
  }, [scene, bump]);

  const applyMatchResult = useCallback(
    (wins: [boolean, boolean]) => {
      const round = scene.round;
      if (!round || lock.current) return;
      lock.current = true;
      round.winMask[round.curPlayer] = wins[0];
      round.winMask[round.curPlayer + 1] = wins[1];
      advanceAfterResult();
    },
    [scene, advanceAfterResult],
  );

  const undoLastMatch = useCallback(() => {
    const round = scene.round;
    if (!round || lock.current || round.curPlayer === 0) return;
    round.curPlayer -= 2;
    bump();
  }, [scene, bump]);

  const reroll = useCallback(() => {
    const round = scene.round;
    if (!round || lock.current) return;
    if (round.players.length <= 1) return;
    const remaining = round.players.slice(round.curPlayer);
    shuffleArray(remaining);
    round.players = round.players.slice(0, round.curPlayer).concat(remaining);
    bump();
  }, [scene, bump]);

  const reset = useCallback(() => {
    appState.pushDialog({
      type: 'confirm',
      text: '정말로 순위를 초기화하시겠습니까?',
      callback: async () => {
        try {
          scene.game = await gameService.createGame(path);
          scene.round = undefined;
          const [, newRound] = gameService.nextRound(scene.game!);
          if (newRound) scene.round = newRound;
              gameService.gameUpdated(appState.curSession!, scene);
          bump();
        } catch (e: any) {
          appState.pushMessage('Error: ' + e.message);
        }
      },
    });
  }, [scene, path, bump]);

  // "1위 이미지 보기" — 본인 지적(2026-05-14): 기존 "결과 폴더 열기"가 디렉토리 path를
  // /api/fs/show로 넘겨서 sendFile 실패 → SPA fallback에서 "Frontend not built" 표시
  // 회귀. 원본 Tournament도 같은 버그였음 (드물게 트리거되어 발견 안 됨).
  //
  // /api/fs/show가 res.sendFile 기반이라 단일 파일만 지원. 1위가 결정됐을 때만 그
  // 이미지 파일을 새 탭으로 여는 게 안전 + 사용자 표현 "1위 결과 파일보기"에 부합.
  // 1위 미확정 시 toolbar 버튼은 disabled — 액션 자체는 no-op.
  const openWinnerImage = useCallback(async () => {
    if (!scene.game) return;
    const winner = scene.game.find((p) => p.rank === 0);
    if (!winner) return;
    await backend.showFile(`${outputDir}/${winner.path}`);
  }, [scene, outputDir]);

  // ── 파생 상태 계산 (tick으로 강제 재계산) ──
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const derived = useMemo(() => {
    const round = scene.round;
    const game = scene.game;

    let matchPlayerPaths: [string, string] | null = null;
    let arenaURLs: [string, string] | null = null;
    let prefetchURLs: string[] = [];
    let matchPosition: TournamentState['matchPosition'] = null;

    if (round && round.curPlayer + 1 < round.players.length) {
      const p0 = round.players[round.curPlayer];
      const p1 = round.players[round.curPlayer + 1];
      matchPlayerPaths = [p0, p1];
      arenaURLs = [toURL(p0, ARENA_THUMB_SIZE), toURL(p1, ARENA_THUMB_SIZE)];
      // 다음 매치 prefetch (있으면).
      if (round.curPlayer + 3 < round.players.length) {
        prefetchURLs = [
          toURL(round.players[round.curPlayer + 2], ARENA_THUMB_SIZE),
          toURL(round.players[round.curPlayer + 3], ARENA_THUMB_SIZE),
        ];
      }
      const totalMatches = Math.floor(round.players.length / 2);
      const currentMatch = Math.floor(round.curPlayer / 2) + 1;
      matchPosition = {
        current: currentMatch,
        total: totalMatches,
        finalizingRank: computeFinalizingRank(game),
        stageLabel: stageLabel(round.players.length),
      };
    }

    // 1위 / podium 계산.
    let winnerPath: string | null = null;
    let podium: Player[] = [];
    if (game) {
      const sorted = [...game].sort((a, b) => a.rank - b.rank);
      podium = sorted.filter((p) => p.rank <= 2).slice(0, 3);
      const first = sorted.find((p) => p.rank === 0);
      if (first) winnerPath = first.path;
    }

    const isComplete = !round || round.curPlayer + 1 >= round.players.length;

    return { matchPlayerPaths, arenaURLs, prefetchURLs, matchPosition, winnerPath, podium, isComplete };
    // tick으로 round/game mutation 따라잡음.
  }, [tick, scene, toURL]);

  const state: TournamentState = {
    round: scene.round,
    arenaURLs: derived.arenaURLs,
    prefetchURLs: derived.prefetchURLs,
    winnerPath: derived.winnerPath,
    podium: derived.podium,
    matchPosition: derived.matchPosition,
    isLoading,
    isComplete: derived.isComplete,
    error,
  };

  const actions: TournamentActions = {
    applyMatchResult,
    undoLastMatch,
    reroll,
    reset,
    openWinnerImage,
  };

  return { state, actions, matchPlayerPaths: derived.matchPlayerPaths, outputDir };
}

// 한 라운드의 winMask를 game.rank에 반영. 홀수 player 마지막은 부전승.
function finalizeRound(scene: GenericScene) {
  const round = scene.round!;
  if (round.players.length % 2 === 1) {
    round.winMask[round.players.length - 1] = true;
  }
  let loses = 0;
  for (let i = 0; i < round.players.length; i++) {
    if (!round.winMask[i]) loses++;
  }
  const cvt = new Map<string, Player>();
  for (const p of scene.game!) cvt.set(p.path, p);
  const roundRank = cvt.get(round.players[0])!.rank;
  const winRank = roundRank - loses;
  for (let i = 0; i < round.players.length; i++) {
    if (round.winMask[i]) cvt.get(round.players[i])!.rank = winRank;
  }
}

// 현재 라운드가 끝나면 어느 rank가 확정되는지 — 헤더의 "X위 결정" 표시용.
function computeFinalizingRank(game: any): number {
  if (!game || !game.length) return 0;
  // nextRound가 sortGame 후 첫 동일 rank를 찾음. 그 rank가 이번 round에 다툴 rank.
  // 그러나 nextRound는 mutate 부작용 있으니 여기선 직접 계산.
  const sorted = [...game].sort((a, b) => a.rank - b.rank);
  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i].rank === sorted[i + 1].rank) return sorted[i].rank;
  }
  return 0;
}

function stageLabel(playerCount: number): string {
  if (playerCount === 2) return '결승전';
  if (playerCount <= 5) return '준결승전';
  return `${Math.floor(playerCount / 2)}강`;
}
