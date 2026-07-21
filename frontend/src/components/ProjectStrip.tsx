import { useState } from 'react';
import { FaEllipsisH, FaFolderOpen } from 'react-icons/fa';
import { appState } from '../models/AppService';
import ModalOverlay from './ModalOverlay';
import SessionSelect from './SessionSelect';
import Tooltip from './Tooltip';

const ProjectStrip = ({ side }: { side: 'left' | 'right' }) => {
  const [showActions, setShowActions] = useState(false);
  return (
    <>
      <div
        className={`w-10 h-full flex flex-col items-center gap-2 py-2 bg-[var(--c-surface-2)] ${side === 'left' ? 'border-r' : 'border-l'} line-color`}
      >
        <Tooltip content={appState.curSession?.name ?? '프로젝트 목록'}>
          <button className="icon-button" onClick={() => appState.openProjectDrawer()}>
            <FaFolderOpen size={17} />
          </button>
        </Tooltip>
        <Tooltip content="프로젝트 도구">
          <button className="icon-button" onClick={() => setShowActions(true)}>
            <FaEllipsisH size={17} />
          </button>
        </Tooltip>
      </div>
      <ModalOverlay
        isOpen={showActions}
        onClose={() => setShowActions(false)}
        title="프로젝트 도구"
        width="max-w-4xl"
      >
        <SessionSelect />
      </ModalOverlay>
    </>
  );
};

export default ProjectStrip;
