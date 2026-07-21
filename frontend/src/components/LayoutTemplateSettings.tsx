import { layoutTemplates } from '../models/layoutTemplates';

const LayoutTemplateSettings = ({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) => (
  <section className="space-y-3">
    <div>
      <h3 className="text-sm font-semibold text-default">화면 배치</h3>
      <p className="text-xs text-sub mt-0.5">모바일은 안정적인 클래식 배치를 항상 유지해요.</p>
    </div>
    <div className="grid grid-cols-2 gap-2">
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
  </section>
);

export default LayoutTemplateSettings;
