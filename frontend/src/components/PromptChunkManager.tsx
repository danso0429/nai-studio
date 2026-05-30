import React, { useState } from 'react';
import { observer } from 'mobx-react-lite';
import {
  FaPlus,
  FaPen,
  FaTrash,
  FaFolderPlus,
  FaChevronRight,
  FaChevronDown,
} from 'react-icons/fa';
import ModalOverlay from './ModalOverlay';
import { promptChunkService } from '../models';
import {
  DEFAULT_CHUNK_COLOR,
  IPromptChunk,
  IPromptChunkFolder,
} from '../models/PromptChunkService';
import { appState } from '../models/AppService';
import { makeChunkToken } from '../models/PromptService';

// 1a: hex 입력 + 프리셋 색 팔레트. 2D/hue 슬라이더는 1b에서 고도화.
const PALETTE = [
  '#d4d4d8', // 연회색 (기본)
  '#f87171', // red
  '#fb923c', // orange
  '#fbbf24', // amber
  '#a3e635', // lime
  '#34d399', // emerald
  '#22d3ee', // cyan
  '#60a5fa', // blue
  '#a78bfa', // violet
  '#f472b6', // pink
];

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

// ─── color 변환 (HSV ↔ hex). picker용. ───
// h: 0~360, s: 0~1, v: 0~1
function hsvToHex(h: number, s: number, v: number): string {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0,
    g = 0,
    b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const to2 = (n: number) =>
    Math.round((n + m) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${to2(r)}${to2(g)}${to2(b)}`;
}

function hexToHsv(hex: string): { h: number; s: number; v: number } | null {
  if (!HEX_RE.test(hex)) return null;
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  return { h, s, v: max };
}

// 2D 채도/명도 슬라이더 + hue 슬라이더. 포인터 드래그 지원.
const ColorPicker2D = ({
  color,
  onChange,
}: {
  color: string;
  onChange: (hex: string) => void;
}) => {
  const hsv = hexToHsv(color) ?? { h: 0, s: 0, v: 0.83 };
  const svRef = React.useRef<HTMLDivElement>(null);
  const hueRef = React.useRef<HTMLDivElement>(null);

  const handleSV = (clientX: number, clientY: number) => {
    const el = svRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const s = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const v = Math.min(1, Math.max(0, 1 - (clientY - rect.top) / rect.height));
    onChange(hsvToHex(hsv.h, s, v));
  };
  const handleHue = (clientX: number) => {
    const el = hueRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const h = Math.min(360, Math.max(0, ((clientX - rect.left) / rect.width) * 360));
    onChange(hsvToHex(h, hsv.s, hsv.v));
  };
  // 포인터 다운 → 드래그 추적 (move/up). SV/hue 공용.
  const startDrag = (
    e: React.PointerEvent,
    move: (x: number, y: number) => void,
  ) => {
    e.preventDefault();
    move(e.clientX, e.clientY);
    const onMove = (ev: PointerEvent) => move(ev.clientX, ev.clientY);
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const hueColor = hsvToHex(hsv.h, 1, 1);

  return (
    <div className="flex flex-col gap-2">
      {/* 2D 채도/명도 */}
      <div
        ref={svRef}
        className="relative w-full h-32 rounded cursor-crosshair touch-none"
        style={{
          background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hueColor})`,
        }}
        onPointerDown={(e) => startDrag(e, handleSV)}
      >
        <div
          className="absolute w-3 h-3 rounded-full border-2 border-white shadow -translate-x-1/2 -translate-y-1/2 pointer-events-none"
          style={{
            left: `${hsv.s * 100}%`,
            top: `${(1 - hsv.v) * 100}%`,
            backgroundColor: color,
          }}
        />
      </div>
      {/* hue */}
      <div
        ref={hueRef}
        className="relative w-full h-4 rounded cursor-pointer touch-none"
        style={{
          background:
            'linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)',
        }}
        onPointerDown={(e) => startDrag(e, (x) => handleHue(x))}
      >
        <div
          className="absolute top-1/2 w-2 h-5 rounded border-2 border-white shadow -translate-x-1/2 -translate-y-1/2 pointer-events-none"
          style={{ left: `${(hsv.h / 360) * 100}%` }}
        />
      </div>
    </div>
  );
};

// chunk/폴더 추가·수정 폼.
const ChunkForm = observer(
  ({
    mode,
    onClose,
  }: {
    mode:
      | { kind: 'add-chunk' }
      | { kind: 'edit-chunk'; chunk: IPromptChunk }
      | { kind: 'add-folder' }
      | { kind: 'edit-folder'; folder: IPromptChunkFolder };
    onClose: () => void;
  }) => {
    const isChunk = mode.kind === 'add-chunk' || mode.kind === 'edit-chunk';
    const editing =
      mode.kind === 'edit-chunk'
        ? mode.chunk
        : mode.kind === 'edit-folder'
          ? mode.folder
          : null;
    const [name, setName] = useState(editing?.name ?? '');
    const [content, setContent] = useState(
      mode.kind === 'edit-chunk' ? mode.chunk.content : '',
    );
    const [category, setCategory] = useState<string | null>(
      mode.kind === 'edit-chunk' ? mode.chunk.category : null,
    );
    const [color, setColor] = useState(editing?.color ?? DEFAULT_CHUNK_COLOR);

    const folders = promptChunkService.listFolders();
    const colorValid = HEX_RE.test(color);

    const save = () => {
      const nm = name.trim();
      if (!nm) {
        appState.pushMessage('이름을 입력해 주세요');
        return;
      }
      const col = colorValid ? color : DEFAULT_CHUNK_COLOR;
      try {
        if (mode.kind === 'add-chunk') {
          promptChunkService.add(nm, content, category, col);
        } else if (mode.kind === 'edit-chunk') {
          promptChunkService.update(mode.chunk.id, {
            name: nm,
            content,
            category,
            color: col,
          });
        } else if (mode.kind === 'add-folder') {
          promptChunkService.addFolder(nm, col);
        } else if (mode.kind === 'edit-folder') {
          promptChunkService.updateFolder(mode.folder.id, { name: nm, color: col });
        }
        onClose();
      } catch (e: any) {
        appState.pushMessage(e?.message || String(e));
      }
    };

    const del = () => {
      if (mode.kind === 'edit-chunk') {
        appState.pushDialog({
          type: 'confirm',
          text: `chunk "${mode.chunk.name}"를 삭제할까요?`,
          callback: () => {
            promptChunkService.remove(mode.chunk.id);
            onClose();
          },
        });
      } else if (mode.kind === 'edit-folder') {
        appState.pushDialog({
          type: 'confirm',
          text: `폴더 "${mode.folder.name}"를 삭제할까요? 안의 chunk는 미분류로 이동돼요.`,
          callback: () => {
            promptChunkService.removeFolder(mode.folder.id);
            onClose();
          },
        });
      }
    };

    const title =
      mode.kind === 'add-chunk'
        ? 'chunk 추가'
        : mode.kind === 'edit-chunk'
          ? 'chunk 수정'
          : mode.kind === 'add-folder'
            ? '폴더 추가'
            : '폴더 수정';

    return (
      <ModalOverlay isOpen={true} onClose={onClose} title={title}>
        <div className="text-default flex flex-col gap-4">
          {/* 이름 */}
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
              이름
            </label>
            <input
              type="text"
              className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>

          {/* content (chunk만) */}
          {isChunk && (
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                태그 (content)
              </label>
              <textarea
                className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400 min-h-24 resize-y"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="예: 1girl, masterpiece, best quality"
              />
            </div>
          )}

          {/* category (chunk만) */}
          {isChunk && (
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                폴더
              </label>
              <select
                className="px-2 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100 text-sm"
                value={category ?? ''}
                onChange={(e) => setCategory(e.target.value || null)}
              >
                <option value="">미분류</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* color (2D/hue 슬라이더 + hex + 팔레트) */}
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
              색
            </label>
            <ColorPicker2D
              color={colorValid ? color : DEFAULT_CHUNK_COLOR}
              onChange={setColor}
            />
            <div className="flex items-center gap-2">
              <span
                className="w-8 h-8 rounded border border-gray-300 dark:border-gray-600 flex-none"
                style={{ backgroundColor: colorValid ? color : DEFAULT_CHUNK_COLOR }}
              />
              {/* hex 입력 — # 없이 0-9/a-f 6자리만. 6자리 되면 자동 적용. */}
              <div className="flex-1 flex items-center rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-700 focus-within:ring-2 focus-within:ring-sky-400 overflow-hidden">
                <span className="pl-3 text-gray-400 dark:text-gray-500 text-sm select-none">
                  #
                </span>
                <input
                  type="text"
                  inputMode="text"
                  maxLength={6}
                  className="flex-1 min-w-0 pl-1 pr-3 py-2 bg-transparent text-gray-900 dark:text-slate-100 text-sm focus:outline-none font-mono"
                  value={color.replace(/^#/, '')}
                  onChange={(e) => {
                    // 0-9/a-f만 남기고 소문자 + 6자 cap.
                    const hx = e.target.value
                      .toLowerCase()
                      .replace(/[^0-9a-f]/g, '')
                      .slice(0, 6);
                    if (hx.length === 6) setColor('#' + hx);
                    else setColor(hx ? '#' + hx : ''); // 미완성은 # + 부분 (invalid 표시)
                  }}
                  placeholder="d4d4d8"
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {PALETTE.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={
                    'w-7 h-7 rounded border-2 ' +
                    (color.toLowerCase() === c.toLowerCase()
                      ? 'border-sky-500'
                      : 'border-transparent')
                  }
                  style={{ backgroundColor: c }}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>
          </div>

          {/* 버튼 */}
          <div className="flex gap-2">
            {editing && (
              <button
                className="px-4 py-2 rounded-lg bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors"
                onClick={del}
              >
                삭제
              </button>
            )}
            <button
              className="px-4 py-2 rounded-lg bg-gray-200 dark:bg-slate-600 hover:bg-gray-300 dark:hover:bg-slate-500 text-gray-700 dark:text-gray-200 text-sm font-medium transition-colors ml-auto"
              onClick={onClose}
            >
              취소
            </button>
            <button
              className="px-4 py-2 rounded-lg bg-sky-500 hover:bg-sky-600 text-white text-sm font-medium transition-colors"
              onClick={save}
            >
              저장
            </button>
          </div>
        </div>
      </ModalOverlay>
    );
  },
);

// chunk 1개 칩 (목록). NovelAI처럼 이름+수정버튼 크기만 — 내용에 맞게 inline.
// 이름 클릭 = 프롬프트 칸에 삽입(NovelAI 흐름), 연필 = 수정.
const ChunkRow = observer(
  ({
    chunk,
    onEdit,
    onInsert,
  }: {
    chunk: IPromptChunk;
    onEdit: () => void;
    onInsert: () => void;
  }) => (
    <div
      className="inline-flex items-center gap-1 pl-1 pr-1 py-0.5 rounded border max-w-full"
      style={{
        backgroundColor: chunk.color + '33', // 배경 옅게
        borderColor: chunk.color,
      }}
    >
      <button
        className="text-sm text-gray-900 dark:text-slate-100 truncate px-1 hover:opacity-70"
        onClick={onInsert}
        title="프롬프트 칸에 삽입"
      >
        {chunk.name}
      </button>
      <button
        className="p-0.5 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 flex-none"
        onClick={onEdit}
        title="수정"
      >
        <FaPen size={11} />
      </button>
    </div>
  ),
);

const PromptChunkManager = observer(
  ({ onClose }: { onClose: () => void }) => {
    const [formMode, setFormMode] = useState<any>(null);
    const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

    const chunks = promptChunkService.list();
    const folders = promptChunkService
      .listFolders()
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name));
    const uncategorized = chunks.filter((c) => !c.category);

    const toggleFolder = (id: string) =>
      setCollapsed((s) => {
        const n = new Set(s);
        if (n.has(id)) n.delete(id);
        else n.add(id);
        return n;
      });

    // chunk 클릭 → 포커스됐던 프롬프트 칸에 토큰 삽입 + 모달 닫기.
    const insertChunk = (id: string) => {
      const target = appState.chunkInsertTarget;
      if (!target) {
        appState.pushMessage(
          '먼저 프롬프트 칸을 한 번 누른 뒤 chunk를 선택해 주세요.',
        );
        return;
      }
      target(makeChunkToken(id));
      onClose();
    };

    return (
      <>
        <ModalOverlay
          isOpen={true}
          onClose={onClose}
          title="프롬프트 chunk"
          width="max-w-2xl"
        >
          <div className="text-default flex flex-col gap-3">
            {/* 상단 액션 */}
            <div className="flex gap-2">
              <button
                className="px-3 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-600 text-white text-sm font-medium flex items-center gap-1.5"
                onClick={() => setFormMode({ kind: 'add-chunk' })}
              >
                <FaPlus size={11} /> chunk 추가
              </button>
              <button
                className="px-3 py-1.5 rounded-lg bg-gray-200 dark:bg-slate-600 hover:bg-gray-300 dark:hover:bg-slate-500 text-gray-700 dark:text-gray-200 text-sm font-medium flex items-center gap-1.5"
                onClick={() => setFormMode({ kind: 'add-folder' })}
              >
                <FaFolderPlus size={11} /> 폴더 추가
              </button>
            </div>

            {chunks.length === 0 && folders.length === 0 ? (
              <div className="text-center py-8 text-gray-500 dark:text-gray-400 text-sm">
                저장된 chunk가 없어요. chunk를 추가해보세요.
              </div>
            ) : (
              <div className="flex flex-col gap-3 max-h-[55vh] overflow-y-auto">
                {/* 폴더별 */}
                {folders.map((f) => {
                  const inFolder = chunks.filter((c) => c.category === f.id);
                  const isCollapsed = collapsed.has(f.id);
                  return (
                    <div key={f.id} className="flex flex-col gap-1">
                      <div
                        className="flex items-center gap-2 px-2 py-1 rounded"
                        style={{ backgroundColor: f.color + '33' }}
                      >
                        <button
                          className="text-gray-600 dark:text-gray-300"
                          onClick={() => toggleFolder(f.id)}
                        >
                          {isCollapsed ? (
                            <FaChevronRight size={11} />
                          ) : (
                            <FaChevronDown size={11} />
                          )}
                        </button>
                        <span className="text-sm font-medium text-gray-800 dark:text-gray-100 flex-1 truncate">
                          {f.name}
                        </span>
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          {inFolder.length}
                        </span>
                        <button
                          className="p-1 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                          onClick={() =>
                            setFormMode({ kind: 'edit-folder', folder: f })
                          }
                        >
                          <FaPen size={11} />
                        </button>
                      </div>
                      {!isCollapsed && (
                        <div className="flex flex-wrap gap-1.5 pl-5">
                          {inFolder.length === 0 ? (
                            <div className="text-xs text-gray-400 dark:text-gray-500 py-1">
                              비어 있음
                            </div>
                          ) : (
                            inFolder.map((c) => (
                              <ChunkRow
                                key={c.id}
                                chunk={c}
                                onEdit={() =>
                                  setFormMode({ kind: 'edit-chunk', chunk: c })
                                }
                                onInsert={() => insertChunk(c.id)}
                              />
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* 미분류 */}
                {uncategorized.length > 0 && (
                  <div className="flex flex-col gap-1">
                    {folders.length > 0 && (
                      <div className="text-xs text-gray-500 dark:text-gray-400 px-2">
                        미분류
                      </div>
                    )}
                    <div className="flex flex-wrap gap-1.5">
                      {uncategorized.map((c) => (
                        <ChunkRow
                          key={c.id}
                          chunk={c}
                          onEdit={() =>
                            setFormMode({ kind: 'edit-chunk', chunk: c })
                          }
                          onInsert={() => insertChunk(c.id)}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 전체 삭제 */}
            {(chunks.length > 0 || folders.length > 0) && (
              <button
                className="text-xs text-red-500 hover:text-red-600 self-start mt-1"
                onClick={() =>
                  appState.pushDialog({
                    type: 'confirm',
                    text: '모든 chunk와 폴더를 삭제할까요? (되돌릴 수 없어요)',
                    callback: () => promptChunkService.clearAll(),
                  })
                }
              >
                전체 삭제
              </button>
            )}
          </div>
        </ModalOverlay>

        {formMode && (
          <ChunkForm mode={formMode} onClose={() => setFormMode(null)} />
        )}
      </>
    );
  },
);

export default PromptChunkManager;
