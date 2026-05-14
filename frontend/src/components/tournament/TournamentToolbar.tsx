import React from 'react';
import { FaFolderOpen, FaRedo, FaUndo, FaRandom, FaTimes, FaCheckDouble } from 'react-icons/fa';
import { TournamentActions, TournamentState } from './useTournament';

interface Props {
  actions: TournamentActions;
  state: TournamentState;
}

// 툴바 — 6개 액션 버튼 한 묶음. 모바일 narrow에서 줄바꿈되도록 flex-wrap.
// 기존 inline button 6개가 Tournament.tsx에 흩어져 있던 걸 한 곳에 모음 (확장성).
// 회귀: "결과 폴더 열기" 이름이 모호하다는 본인 지적 → "1위 이미지 폴더 열기" 명확화.
const TournamentToolbar = React.memo(({ actions, state }: Props) => {
  const canInteract = !!state.matchPosition; // 매치 진행 중일 때만 매치 관련 액션 활성
  const canUndo = canInteract && !!state.round && state.round.curPlayer > 0;
  return (
    <div className="px-2 pb-2 md:px-4 md:pb-3 flex flex-none gap-2 w-full border-b line-color flex-wrap">
      <button className="round-button back-sky inline-flex items-center gap-1.5" onClick={actions.openWinnerFolder}>
        <FaFolderOpen size={12} /> 1위 이미지 폴더 열기
      </button>
      <button className="round-button back-red inline-flex items-center gap-1.5" onClick={actions.reset}>
        <FaRedo size={12} /> 순위 초기화
      </button>
      <button
        className="round-button back-gray inline-flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
        onClick={actions.undoLastMatch}
        disabled={!canUndo}
      >
        <FaUndo size={12} /> 실행취소
      </button>
      <button
        className="round-button back-orange inline-flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
        onClick={actions.reroll}
        disabled={!canInteract}
      >
        <FaRandom size={12} /> 대진 리롤
      </button>
      <button
        className="round-button back-orange inline-flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
        onClick={() => actions.applyMatchResult([false, false])}
        disabled={!canInteract}
      >
        <FaTimes size={12} /> 둘다 패배
      </button>
      <button
        className="round-button back-orange inline-flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
        onClick={() => actions.applyMatchResult([true, true])}
        disabled={!canInteract}
      >
        <FaCheckDouble size={12} /> 둘다 승리
      </button>
    </div>
  );
});

export default TournamentToolbar;
