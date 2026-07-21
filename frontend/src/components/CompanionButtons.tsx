import { observer } from 'mobx-react-lite';
import { appState } from '../models/AppService';
import { resolveCompanionButtons } from '../models/companionSlots';
import PortableToolbarButton from './PortableToolbarButton';

const CompanionButtons = observer(({ host }: { host: string }) => {
  const ids = resolveCompanionButtons(host, appState.uiCompanionSlots);
  if (ids.length === 0) return null;
  return (
    <div className="flex flex-none items-center gap-1 ml-1">
      {ids.map((id) => <PortableToolbarButton key={id} id={id} />)}
    </div>
  );
});

export default CompanionButtons;
