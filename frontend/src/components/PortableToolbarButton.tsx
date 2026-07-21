import {
  FaArchive,
  FaBroom,
  FaExchangeAlt,
  FaFolderOpen,
  FaLayerGroup,
  FaPlus,
  FaPuzzlePiece,
  FaTrashAlt,
  FaUserAlt,
} from 'react-icons/fa';
import { appState } from '../models/AppService';
import { requestLocallyOwnedPortableAction } from '../models/portableToolbarActions';
import { TOOLBAR_VIEW_MAIN } from '../models/uiLayout';
import Tooltip from './Tooltip';

const ICONS: Record<string, React.ReactNode> = {
  'project-browser': <FaFolderOpen size={16} />,
  'add-session': <FaPlus size={16} />,
  'character-presets': <FaUserAlt size={16} />,
  'scene-template': <FaLayerGroup size={16} />,
  'backup-export': <FaArchive size={16} />,
  'delete-session': <FaTrashAlt size={16} />,
  'piece-editor': <FaPuzzlePiece size={16} />,
  'scene-trash': <FaTrashAlt size={16} />,
  'empty-image-trash': <FaBroom size={16} />,
  'find-replace': <FaExchangeAlt size={16} />,
};

const SESSION_REQUIRED = new Set([
  'character-presets',
  'backup-export',
  'delete-session',
  'scene-trash',
  'empty-image-trash',
  'find-replace',
]);

export const runPortableToolbarAction = (id: string) => {
  switch (id) {
    case 'project-browser':
      appState.openProjectDrawer();
      break;
    case 'add-session':
    case 'character-presets':
    case 'scene-template':
    case 'scene-trash':
      requestLocallyOwnedPortableAction(id);
      break;
    case 'backup-export':
      appState.projectBackupMenu();
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
        disabled={!appState.curSession && SESSION_REQUIRED.has(id)}
        onClick={() => runPortableToolbarAction(id)}
      >
        {ICONS[id]}
      </button>
    </Tooltip>
  );
};

export default PortableToolbarButton;
