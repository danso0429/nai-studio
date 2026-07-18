import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { runInAction } from 'mobx';
import { v4 as uuidv4 } from 'uuid';
import { FaPuzzlePiece, FaTimes } from 'react-icons/fa';
import ModalOverlay from './ModalOverlay';
import ModalOverlayCountMarker from './ModalOverlayCountMarker';
import PromptEditTextArea from './PromptEditTextArea';
import { FloatView } from './FloatView';
import { SlotEditor } from './SceneEditor';
import Tooltip from './Tooltip';
import { isMobile } from '../models';
import { PromptPiece, Scene } from '../models/types';
import { positionAnchoredPanel } from '../models/viewportPopup';

interface SceneQuickPromptModalProps {
  scene: Scene;
  onClose: () => void;
  anchor?: DOMRect;
}

const SceneQuickPromptModal = observer(
  ({ scene, onClose, anchor }: SceneQuickPromptModalProps) => {
    const [showFull, setShowFull] = useState(false);
    const usePopover = !isMobile && !!anchor;
    const panelRef = useRef<HTMLDivElement>(null);
    const mouseDownOnBackdrop = useRef(false);
    const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

    useEffect(() => {
      if (scene.slots.length > 0 && scene.slots[0].length > 0) return;
      runInAction(() => {
        scene.slots = [[PromptPiece.fromJSON({
          prompt: '',
          characterPrompts: [],
          id: uuidv4(),
        })]];
      });
    }, [scene]);

    useLayoutEffect(() => {
      if (!usePopover || showFull || !panelRef.current || !anchor) return;
      const panel = panelRef.current.getBoundingClientRect();
      const vv = window.visualViewport;
      setPos(positionAnchoredPanel(
        anchor,
        panel,
        {
          top: vv?.offsetTop ?? 0,
          height: vv?.height ?? window.innerHeight,
          width: vv?.width ?? window.innerWidth,
        },
      ));
    }, [anchor, showFull, usePopover]);

    useEffect(() => {
      if (!usePopover || showFull) return;
      const handleEscape = (event: KeyboardEvent) => {
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        onClose();
      };
      window.addEventListener('keydown', handleEscape, true);
      return () => window.removeEventListener('keydown', handleEscape, true);
    }, [onClose, showFull, usePopover]);

    const piece = scene.slots[0]?.[0];
    const pieceCount = scene.slots.reduce((count, slot) => count + slot.length, 0);

    if (showFull) {
      return (
        <FloatView priority={2} onEscape={() => setShowFull(false)}>
          <div className="w-full h-full flex flex-col overflow-hidden">
            <div className="flex-none px-3 py-2 border-b line-color font-bold text-default">
              🧩 씬 {scene.name} — 조합 에디터
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              <SlotEditor scene={scene} />
            </div>
          </div>
        </FloatView>
      );
    }

    const editor = piece ? (
      <PromptEditTextArea
        value={piece.prompt}
        onChange={(value: string) => {
          piece.prompt = value;
        }}
      />
    ) : null;

    if (usePopover && anchor) {
      return (
        <div
          className="fixed inset-0"
          style={{ zIndex: 'var(--z-modal)' }}
          onMouseDown={(event) => {
            mouseDownOnBackdrop.current = event.target === event.currentTarget;
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget && mouseDownOnBackdrop.current) {
              onClose();
            }
            mouseDownOnBackdrop.current = false;
          }}
        >
          <ModalOverlayCountMarker />
          <div
            ref={panelRef}
            className="absolute w-[26rem] max-w-[90vw] bg-[var(--c-zone)] rounded-lg shadow-xl border line-color flex flex-col overflow-hidden"
            style={{
              left: pos?.left ?? anchor.left,
              top: pos?.top ?? anchor.top,
              visibility: pos ? 'visible' : 'hidden',
            }}
          >
            <div className="flex-none flex items-center gap-1 px-2.5 py-1.5 border-b line-color">
              <span className="text-sm font-semibold text-default truncate">✏️ {scene.name}</span>
              <span className="ml-auto flex-none flex items-center gap-0.5">
                <Tooltip content={pieceCount > 1 ? `전체 조합 에디터 열기 (조각 ${pieceCount}개)` : '전체 조합 에디터 열기'}>
                  <button
                    className="p-1.5 rounded hover:bg-gray-200 dark:hover:bg-slate-600 text-muted transition-colors"
                    onClick={() => setShowFull(true)}
                    aria-label="전체 조합 에디터 열기"
                  >
                    <FaPuzzlePiece size={13} />
                  </button>
                </Tooltip>
                <Tooltip content="닫기 (ESC)">
                  <button
                    className="p-1.5 rounded hover:bg-gray-200 dark:hover:bg-slate-600 text-muted transition-colors"
                    onClick={onClose}
                    aria-label="프롬프트 퀵 수정 닫기"
                  >
                    <FaTimes size={13} />
                  </button>
                </Tooltip>
              </span>
            </div>
            <div className="h-36 p-1.5 overflow-hidden">{editor}</div>
          </div>
        </div>
      );
    }

    return (
      <ModalOverlay isOpen onClose={onClose} title={`✏️ ${scene.name} — 중간 프롬프트 (1-1)`}>
        <div className="flex flex-col gap-3">
          {pieceCount > 1 && (
            <div className="text-xs text-muted">
              이 씬은 조합 조각이 {pieceCount}개예요. 여기서는 첫 번째(1-1) 조각만 수정해요.
            </div>
          )}
          <div className="h-40 md:h-52 overflow-hidden">{editor}</div>
          <div className="flex justify-end gap-2">
            <button className="round-button back-gray" onClick={() => setShowFull(true)}>
              자세히 보기 (조합 에디터)
            </button>
            <button className="round-button back-sky" onClick={onClose}>완료</button>
          </div>
        </div>
      </ModalOverlay>
    );
  },
);

export default SceneQuickPromptModal;
