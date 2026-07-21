import { FaArrowDown, FaArrowUp } from 'react-icons/fa';
import {
  DEFAULT_QUICK_MENU,
  QUICK_MENU_ACTIONS,
  normalizeQuickMenu,
} from '../models/quickMenu';

interface QuickMenuSettingsProps {
  value: string[];
  onChange: (value: string[]) => void;
  showButton: boolean;
  onShowButtonChange: (value: boolean) => void;
}

const QuickMenuSettings = ({
  value,
  onChange,
  showButton,
  onShowButtonChange,
}: QuickMenuSettingsProps) => {
  const selected = normalizeQuickMenu(value);
  const move = (id: string, delta: -1 | 1) => {
    const index = selected.indexOf(id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= selected.length) return;
    const next = [...selected];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-default">퀵 메뉴</h3>
        <p className="text-xs text-sub mt-0.5">
          PC에서는 Ctrl+K로 열 수 있고, 선택하면 화면에 플로팅 버튼도 표시해요.
        </p>
      </div>
      <label className="flex items-center gap-2 text-sm text-default">
        <input
          type="checkbox"
          checked={showButton}
          onChange={(event) => onShowButtonChange(event.target.checked)}
        />
        퀵 메뉴 플로팅 버튼 표시
      </label>
      <div className="rounded-lg border line-color divide-y divide-gray-200 dark:divide-slate-600">
        {QUICK_MENU_ACTIONS.map((action) => {
          const index = selected.indexOf(action.id);
          const checked = index >= 0;
          return (
            <div key={action.id} className="flex items-center gap-2 px-3 py-2">
              <label className="flex flex-1 min-w-0 items-center gap-2 text-sm text-default">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => {
                    onChange(
                      event.target.checked
                        ? [...selected, action.id]
                        : selected.filter((id) => id !== action.id),
                    );
                  }}
                />
                <span className="truncate">{action.name}</span>
              </label>
              {checked && (
                <>
                  <button
                    type="button"
                    className="icon-button"
                    disabled={index === 0}
                    onClick={() => move(action.id, -1)}
                    title="위로"
                  >
                    <FaArrowUp size={11} />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    disabled={index === selected.length - 1}
                    onClick={() => move(action.id, 1)}
                    title="아래로"
                  >
                    <FaArrowDown size={11} />
                  </button>
                </>
              )}
            </div>
          );
        })}
      </div>
      <button
        type="button"
        className="w-full back-gray rounded py-2 text-sm"
        onClick={() => onChange([...DEFAULT_QUICK_MENU])}
      >
        추천 구성으로 초기화
      </button>
    </section>
  );
};

export default QuickMenuSettings;
