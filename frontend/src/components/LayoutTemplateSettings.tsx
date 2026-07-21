import { layoutTemplates } from '../models/layoutTemplates';
import type { UiLayoutSlots } from '../main/config';

const LayoutTemplateSettings = ({
  value,
  onChange,
  slots,
  onSlotsChange,
}: {
  value: string;
  onChange: (value: string) => void;
  slots: UiLayoutSlots;
  onSlotsChange: (value: UiLayoutSlots) => void;
}) => (
  <section className="space-y-3">
    <div>
      <h3 className="text-sm font-semibold text-default">화면 배치</h3>
      <p className="text-xs text-sub mt-0.5">모바일은 안정적인 클래식 배치를 항상 유지해요.</p>
    </div>
    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
      {layoutTemplates.map((template) => (
        <button
          key={template.id}
          type="button"
          className={`rounded-lg border p-3 text-left ${value === template.id ? 'border-sky-500 ring-1 ring-sky-500 bg-sky-500/10' : 'line-color bg-[var(--c-zone)]'}`}
          onClick={() => onChange(template.id)}
        >
          <span className="block text-sm font-semibold text-default">{template.name}</span>
          <span className="block text-xs text-sub mt-1">{template.description}</span>
        </button>
      ))}
    </div>
    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
      <label className="text-xs text-sub">
        프리셋 패널
        <select
          className="gray-input block w-full mt-1"
          value={slots.presetSide ?? 'left'}
          onChange={(event) =>
            onSlotsChange({ ...slots, presetSide: event.target.value as 'left' | 'right' })
          }
        >
          <option value="left">왼쪽</option>
          <option value="right">오른쪽</option>
        </select>
      </label>
      <label className="text-xs text-sub">
        히스토리 패널
        <select
          className="gray-input block w-full mt-1"
          value={slots.historySide ?? 'right'}
          onChange={(event) =>
            onSlotsChange({ ...slots, historySide: event.target.value as 'left' | 'right' })
          }
        >
          <option value="left">왼쪽</option>
          <option value="right">오른쪽</option>
        </select>
      </label>
      <label className="text-xs text-sub">
        생성 컨트롤
        <select
          className="gray-input block w-full mt-1"
          value={value !== 'classic' ? 'floating' : (slots.genControl ?? 'docked')}
          disabled={value !== 'classic'}
          onChange={(event) =>
            onSlotsChange({
              ...slots,
              genControl: event.target.value as 'docked' | 'floating',
            })
          }
        >
          <option value="docked">하단 도크</option>
          <option value="floating">플로팅</option>
        </select>
      </label>
    </div>
  </section>
);

export default LayoutTemplateSettings;
