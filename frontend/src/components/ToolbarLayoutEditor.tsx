import type { UiToolbarConfig } from '../main/config';
import {
  TOOLBAR_VIEW_MAIN,
  moveToolbarButton,
  resolveToolbarView,
} from '../models/uiLayout';

interface ToolbarLayoutEditorProps {
  value: UiToolbarConfig;
  onChange: (value: UiToolbarConfig) => void;
}

const ToolbarLayoutEditor = ({ value, onChange }: ToolbarLayoutEditorProps) => {
  const resolved = resolveToolbarView(TOOLBAR_VIEW_MAIN, value, false);

  const move = (
    id: string,
    homeArea: string,
    slot: 'inline' | 'menu' | 'hidden',
  ) => {
    onChange(
      moveToolbarButton(TOOLBAR_VIEW_MAIN, value, {
        id,
        toArea: homeArea,
        slot,
      }),
    );
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-default">툴바 구성</h3>
          <p className="text-xs text-sub mt-0.5">
            버튼을 바로 표시하거나 더보기로 보내고, 필요 없는 버튼을 숨길 수 있어요.
          </p>
        </div>
        <label className="flex items-center gap-1.5 text-xs text-sub flex-none">
          <input
            type="checkbox"
            checked={!!value.classic}
            onChange={(event) =>
              onChange({ ...value, classic: event.target.checked })
            }
          />
          전부 바로 표시
        </label>
      </div>
      {TOOLBAR_VIEW_MAIN.map(({ area, registry }) => {
        const areaResolved = resolved.find((entry) => entry.area === area);
        return (
          <div key={area} className="rounded-lg border line-color overflow-hidden">
            <div className="px-3 py-2 text-xs font-semibold bg-[var(--c-zone)] text-default">
              {area === 'scene' ? '씬 툴바' : '프로젝트 툴바'}
            </div>
            <div className="divide-y divide-gray-200 dark:divide-slate-600">
              {registry.map((button) => {
                const placement = areaResolved?.inline.includes(button.id)
                  ? 'inline'
                  : areaResolved?.menu.includes(button.id)
                    ? 'menu'
                    : 'hidden';
                return (
                  <label
                    key={button.id}
                    className="flex items-center gap-3 px-3 py-2 text-sm"
                  >
                    <span className="flex-1 min-w-0 truncate text-default">
                      {button.name}
                    </span>
                    <select
                      className="gray-input text-xs py-1"
                      value={value.classic ? 'inline' : placement}
                      disabled={!!value.classic}
                      onChange={(event) =>
                        move(
                          button.id,
                          area,
                          event.target.value as 'inline' | 'menu' | 'hidden',
                        )
                      }
                    >
                      <option value="inline">바로 표시</option>
                      <option value="menu">더보기</option>
                      <option value="hidden">숨김</option>
                    </select>
                  </label>
                );
              })}
            </div>
          </div>
        );
      })}
      <button
        type="button"
        className="w-full back-gray rounded py-2 text-sm"
        onClick={() => onChange({})}
      >
        툴바 배치 초기화
      </button>
    </section>
  );
};

export default ToolbarLayoutEditor;
