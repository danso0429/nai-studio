import { observer } from 'mobx-react-lite';
import {
  combinationCount,
  enumerateCombinations,
} from '../models/PromptService';
import { PromptPiece, PromptPieceSlot } from '../models/types';

export const sceneCharColors = [
  '#38bdf8',
  '#f472b6',
  '#a78bfa',
  '#fb923c',
  '#4ade80',
  '#facc15',
  '#f87171',
  '#94a3b8',
];

export const columnColor = (index: number): string =>
  sceneCharColors[index % sceneCharColors.length];

export const pieceDefaultName = (column: number, row: number): string =>
  `${column + 1}-${row + 1}`;

export const pieceLabel = (
  piece: PromptPiece,
  column: number,
  row: number,
): string => piece.name?.trim() || pieceDefaultName(column, row);

export const PREVIEW_RENDER_CAP = 100;

export const CombinationList = observer(
  ({
    scene,
    detailed,
  }: {
    scene: { slots: PromptPieceSlot[] };
    detailed: boolean;
  }) => {
    const total = combinationCount(scene);
    const combinations = enumerateCombinations(scene, PREVIEW_RENDER_CAP);
    return (
      <div className="flex flex-col gap-1 text-body">
        <div className="px-2 pt-1">
          {total === 0 ? (
            <span className="text-xs text-red-500">
              활성 조각이 없는 열이 있어 생성되지 않습니다
            </span>
          ) : (
            <span className="text-sm font-bold">총 {total}종</span>
          )}
        </div>
        {total > PREVIEW_RENDER_CAP && (
          <div className="px-2 text-xs text-sub">
            앞 {PREVIEW_RENDER_CAP}종만 표시합니다.
          </div>
        )}
        {combinations.map((combination, index) => (
          <div key={index} className="px-2 py-1.5 border-b line-color">
            {detailed ? (
              <div className="text-xs break-words">
                {combination.map((segment, segmentIndex) => (
                  <span key={segmentIndex}>
                    {segmentIndex > 0 && ', '}
                    <span
                      className="rounded px-0.5"
                      style={{
                        backgroundColor:
                          columnColor(segment.columnIndex) + '2e',
                      }}
                    >
                      {segment.piece.prompt || '(빈 프롬프트)'}
                    </span>
                  </span>
                ))}
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-1">
                {combination.map((segment, segmentIndex) => {
                  const row = scene.slots[segment.columnIndex]?.indexOf(
                    segment.piece,
                  ) ?? 0;
                  return (
                    <span key={segmentIndex} className="flex items-center gap-1">
                      {segmentIndex > 0 && <span className="text-sub">+</span>}
                      <span
                        className="rounded px-1.5 py-0.5 text-xs text-white"
                        style={{ backgroundColor: columnColor(segment.columnIndex) }}
                      >
                        {pieceLabel(
                          segment.piece,
                          segment.columnIndex,
                          row,
                        )}
                      </span>
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    );
  },
);
