import { observer } from 'mobx-react-lite';
import { appState } from '../models/AppService';
import {
  resolveCompanionButtons,
  type CompanionHost,
} from '../models/companionSlots';
import PortableToolbarButton from './PortableToolbarButton';
import { CompanionDropTarget, DraggableCompanionButton } from './ToolbarDnd';

const CompanionButtons = observer(({ host }: { host: CompanionHost }) => {
  const ids = resolveCompanionButtons(host, appState.uiCompanionSlots);
  if (ids.length === 0 && !appState.editMode) return null;
  return (
    <CompanionDropTarget host={host}>
      <div className="flex flex-none items-center gap-1 ml-1">
        {ids.map((id) => (
          <DraggableCompanionButton key={id} id={id}>
            <PortableToolbarButton id={id} />
          </DraggableCompanionButton>
        ))}
      </div>
    </CompanionDropTarget>
  );
});

export default CompanionButtons;
