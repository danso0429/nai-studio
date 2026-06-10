import { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { appState, ExportPreset } from '../models/AppService';
import { PresetForm } from './ExportPresetsDialog';
import ModalOverlayCountMarker from './ModalOverlayCountMarker';

// 일회용 내보내기 옵션 폼. 프리셋 저장 안 하고 모든 옵션을 한 페이지에서 입력 →
// submit 시 ExportPreset 객체 resolve. exportPackage / exportFolder 둘 다 사용.
const ExportOptionsForm = observer(() => {
  const [draft, setDraft] = useState<ExportPreset | null>(null);

  useEffect(() => {
    if (appState.exportOptionsFormOpen && appState.exportOptionsFormDefaults) {
      setDraft({ ...appState.exportOptionsFormDefaults });
    } else if (!appState.exportOptionsFormOpen) {
      setDraft(null);
    }
  }, [appState.exportOptionsFormOpen]);

  if (!appState.exportOptionsFormOpen || !draft) return null;

  const onSubmit = () => {
    appState.closeExportOptionsForm(draft);
  };
  const onCancel = () => {
    appState.closeExportOptionsForm(undefined);
  };

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ zIndex: 5500, backgroundColor: 'rgba(0,0,0,0.7)' }}
      onClick={onCancel}
    >
      <ModalOverlayCountMarker />
      <div
        className="bg-white dark:bg-slate-800 text-black dark:text-white rounded-md shadow-xl p-4 max-w-2xl w-[92vw] max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-3">
          <h2 className="text-lg font-bold">내보내기 옵션</h2>
          <button onClick={onCancel} className="text-2xl leading-none px-2">
            ×
          </button>
        </div>
        <PresetForm
          preset={draft}
          onChange={setDraft}
          onSave={onSubmit}
          onCancel={onCancel}
          hideName
          saveLabel="내보내기"
        />
      </div>
    </div>
  );
});

export default ExportOptionsForm;
