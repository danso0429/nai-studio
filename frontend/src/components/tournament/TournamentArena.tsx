import React, { useCallback } from 'react';
import { useContextMenu } from 'react-contexify';
import { ContextMenuType } from '../../models/types';
import { TournamentActions } from './useTournament';

interface Props {
  arenaURLs: [string, string];
  matchPlayerPaths: [string, string];
  outputDir: string;
  actions: TournamentActions;
  prefetchURLs: string[];
}

// 매치 아레나 — 두 이미지 좌/우(또는 상/하) 비교. 클릭 = 그 이미지 승리.
// 회귀: 기존 fetchImage(base64)를 getThumbURL(URL)로 교체해 모바일 메모리/디코드 비용 ↓ +
// hidden <img>로 다음 매치 이미지 prefetch — 결과 클릭 → 다음 매치 표시 빈 화면 없음.
const TournamentArena = React.memo(
  ({ arenaURLs, matchPlayerPaths, outputDir, actions, prefetchURLs }: Props) => {
    const { show } = useContextMenu({ id: ContextMenuType.Image });

    const makeContextHandler = useCallback(
      (filename: string) => (e: React.MouseEvent) => {
        show({
          event: e,
          props: { ctx: { type: 'image', path: `${outputDir}/${filename}` } },
        });
      },
      [show, outputDir],
    );

    return (
      <div className="flex-1 w-full overflow-hidden">
        <div className="flex h-full w-full overflow-hidden flex-col md:flex-row">
          <ArenaSide
            url={arenaURLs[0]}
            onClick={() => actions.applyMatchResult([true, false])}
            onContextMenu={makeContextHandler(matchPlayerPaths[0])}
          />
          <div className="bg-gray-300 dark:bg-slate-700 h-px w-full md:w-px md:h-full flex-none" />
          <ArenaSide
            url={arenaURLs[1]}
            onClick={() => actions.applyMatchResult([false, true])}
            onContextMenu={makeContextHandler(matchPlayerPaths[1])}
          />
        </div>
        {/* 다음 매치 이미지 prefetch — 0px hidden, 브라우저 캐시 채움. */}
        {prefetchURLs.map((u) => (
          <link key={u} rel="preload" as="image" href={u} />
        ))}
      </div>
    );
  },
);

interface ArenaSideProps {
  url: string;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

const ArenaSide = React.memo(({ url, onClick, onContextMenu }: ArenaSideProps) => (
  <div className="flex-1 justify-center items-center flex overflow-hidden">
    <img
      draggable={false}
      onClick={onClick}
      onContextMenu={onContextMenu}
      className="active:brightness-90 hover:brightness-95 cursor-pointer imageSmall"
      src={url}
      // alt 비어두면 broken image 아이콘 안 뜸. 토너먼트 이미지라 a11y 명칭 따로 없음.
      alt=""
    />
  </div>
));

export default TournamentArena;
