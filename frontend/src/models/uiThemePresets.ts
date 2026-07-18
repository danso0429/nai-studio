import type { UiThemeConfig, UiThemePreset } from '../main/config';

export function cloneUiTheme(theme: UiThemeConfig): UiThemeConfig {
  return JSON.parse(JSON.stringify(theme)) as UiThemeConfig;
}

export function normalizeUiThemePresets(raw: unknown): UiThemePreset[] {
  if (!Array.isArray(raw)) return [];
  const byName = new Map<string, UiThemePreset>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const source = item as Partial<UiThemePreset>;
    const name = typeof source.name === 'string' ? source.name.trim() : '';
    if (!name || typeof source.whiteMode !== 'boolean' || !source.theme ||
        typeof source.theme !== 'object' || Array.isArray(source.theme)) continue;
    byName.set(name, {
      name,
      whiteMode: source.whiteMode,
      trueDark: !source.whiteMode && source.trueDark ? true : undefined,
      theme: cloneUiTheme(source.theme),
    });
  }
  return [...byName.values()];
}

export function createUiThemePreset(
  name: string,
  whiteMode: boolean,
  trueDark: boolean,
  theme: UiThemeConfig,
): UiThemePreset | null {
  const normalizedName = name.trim();
  if (!normalizedName) return null;
  return {
    name: normalizedName,
    whiteMode,
    trueDark: !whiteMode && trueDark ? true : undefined,
    theme: cloneUiTheme(theme),
  };
}

export function upsertUiThemePreset(
  presets: UiThemePreset[],
  next: UiThemePreset,
): UiThemePreset[] {
  const index = presets.findIndex((preset) => preset.name === next.name);
  if (index < 0) return [...presets, next];
  const updated = [...presets];
  updated[index] = next;
  return updated;
}
