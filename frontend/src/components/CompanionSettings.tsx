import {
  COMPANION_BUTTON_IDS,
  COMPANION_HOST_LABELS,
  COMPANION_HOSTS,
  assignCompanion,
  companionOwnerOf,
  removeCompanion,
  type CompanionHost,
} from '../models/companionSlots';
import { TOOLBAR_VIEW_MAIN } from '../models/uiLayout';

interface CompanionSettingsProps {
  value: Record<string, string[]>;
  onChange: (value: Record<string, string[]>) => void;
}

const CompanionSettings = ({ value, onChange }: CompanionSettingsProps) => {
  const nameOf = (id: string) =>
    TOOLBAR_VIEW_MAIN.flatMap(({ registry }) => registry).find(
      (button) => button.id === id,
    )?.name ?? id;
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-default">프리셋 행 동반 버튼</h3>
        <p className="text-xs text-sub mt-0.5">
          전역 버튼을 프리셋 설정 행 옆으로 옮겨 바로 사용할 수 있어요.
        </p>
      </div>
      <div className="rounded-lg border line-color divide-y divide-gray-200 dark:divide-slate-600">
        {COMPANION_BUTTON_IDS.map((id) => (
          <label key={id} className="flex items-center gap-3 px-3 py-2 text-sm">
            <span className="flex-1 min-w-0 truncate text-default">{nameOf(id)}</span>
            <select
              className="gray-input text-xs py-1 max-w-48"
              value={companionOwnerOf(id, value) ?? ''}
              onChange={(event) => {
                const host = event.target.value as CompanionHost | '';
                onChange(
                  host ? assignCompanion(value, host, id) : removeCompanion(value, id),
                );
              }}
            >
              <option value="">툴바에 유지</option>
              {COMPANION_HOSTS.map((host) => (
                <option key={host} value={host}>{COMPANION_HOST_LABELS[host]}</option>
              ))}
            </select>
          </label>
        ))}
      </div>
    </section>
  );
};

export default CompanionSettings;
