import {
  FaBroom,
  FaExchangeAlt,
  FaFolderOpen,
  FaPuzzlePiece,
  FaTrashAlt,
} from 'react-icons/fa';
import { appState } from '../models/AppService';
import { TOOLBAR_VIEW_MAIN } from '../models/uiLayout';
import Tooltip from './Tooltip';

const ICONS: Record<string, React.ReactNode> = {
  'project-browser': <FaFolderOpen size={16} />,
  'delete-session': <FaTrashAlt size={16} />,
  'piece-editor': <FaPuzzlePiece size={16} />,
  'empty-image-trash': <FaBroom size={16} />,
  'find-replace': <FaExchangeAlt size={16} />,
};

export const runPortableToolbarAction = (id: string) => {
  switch (id) {
    case 'project-browser':
      appState.openProjectDrawer();
      break;
    case 'delete-session':
      if (appState.curSession) appState.deleteProjectBackground(appState.curSession.name);
      break;
    case 'piece-editor':
      appState.openPieceEditor();
      break;
    case 'empty-image-trash':
      appState.emptyProjectImageTrashWithConfirm();
      break;
    case 'find-replace':
      appState.openFindReplace();
      break;
  }
};

const PortableToolbarButton = ({ id }: { id: string }) => {
  const name = TOOLBAR_VIEW_MAIN.flatMap(({ registry }) => registry).find(
    (button) => button.id === id,
  )?.name ?? id;
  return (
    <Tooltip content={name}>
      <button
        className="icon-button back-gray flex-none"
        disabled={!appState.curSession && id !== 'project-browser'}
        onClick={() => runPortableToolbarAction(id)}
      >
        {ICONS[id]}
      </button>
    </Tooltip>
  );
};

export default PortableToolbarButton;
