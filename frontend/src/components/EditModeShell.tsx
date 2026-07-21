import { observer } from 'mobx-react-lite';
import { appState } from '../models/AppService';

const EditModeShell = observer(() => (
  <div
    className="fixed top-2 left-1/2 -translate-x-1/2 flex items-center gap-3 px-4 py-2 rounded-full bg-[var(--c-surface-2)] border line-color shadow-lg select-none"
    style={{ zIndex: 'var(--z-edit-overlay)' }}
  >
    <span className="text-sm text-default">
      툴바 편집 — 버튼을 끌어 순서·영역을 바꾸거나 숨김 칸에 놓으세요
    </span>
    <button
      className="round-button back-sky text-sm !px-3 !py-1 !min-w-0 !min-h-0"
      onClick={() => {
        appState.editMode = false;
        appState.toolbarDragging = false;
      }}
    >
      완료
    </button>
  </div>
));

export default EditModeShell;
