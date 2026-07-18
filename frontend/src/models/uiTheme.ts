import type { UiThemeConfig } from '../main/config';

const HEX6 = /^#[0-9a-fA-F]{6}$/;
export const isHex6 = (value: string | undefined): value is string =>
  !!value && HEX6.test(value);

function parseHex(hex: string): [number, number, number] | null {
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!match) return null;
  const value = parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function toHex(r: number, g: number, b: number): string {
  const channel = (value: number) => Math.max(0, Math.min(255, Math.round(value)))
    .toString(16).padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

export function mix(a: string, b: string, ratio: number): string {
  const ca = parseHex(a);
  const cb = parseHex(b);
  if (!ca || !cb) return a;
  return toHex(
    ca[0] + (cb[0] - ca[0]) * ratio,
    ca[1] + (cb[1] - ca[1]) * ratio,
    ca[2] + (cb[2] - ca[2]) * ratio,
  );
}

export function readableFg(hex: string): string {
  const color = parseHex(hex);
  if (!color) return '#ffffff';
  const luminance = 0.2126 * color[0] + 0.7152 * color[1] + 0.0722 * color[2];
  return luminance > 150 ? '#000000' : '#ffffff';
}

export function buildThemeVars(
  theme?: UiThemeConfig,
  baseIsLight = false,
): Record<string, string> {
  const vars: Record<string, string> = {};
  if (!theme) return vars;
  if (isHex6(theme.surface)) vars['--c-surface'] = theme.surface;
  if (isHex6(theme.surface2)) vars['--c-surface-2'] = theme.surface2;
  if (isHex6(theme.inputBg)) {
    vars['--c-input-bg'] = theme.inputBg;
    vars['--c-input-text'] = readableFg(theme.inputBg);
  }

  if (theme.textPattern) {
    const base = theme.textPattern === 'light' ? '#000000' : '#ffffff';
    const background = isHex6(theme.surface)
      ? theme.surface
      : theme.textPattern === 'light' ? '#ffffff' : '#0f172a';
    const scale = theme.textPattern === 'light' ? 1 : 0.7;
    vars['--c-text'] = base;
    vars['--c-text-sub'] = mix(base, background, 0.18 * scale);
    vars['--c-text-label'] = mix(base, background, 0.28 * scale);
    vars['--c-text-muted'] = mix(base, background, 0.5 * scale);
    vars['--c-text-faint'] = mix(base, background, 0.68 * scale);
    vars['--c-icon-text'] = mix(base, background, 0.42 * scale);
  }

  if (isHex6(theme.lineColor)) {
    vars['--c-line'] = theme.lineColor;
  } else if (theme.textPattern || isHex6(theme.surface)) {
    const light = theme.textPattern
      ? theme.textPattern === 'light'
      : readableFg(theme.surface!) === '#000000';
    const base = light ? '#000000' : '#ffffff';
    const background = isHex6(theme.surface)
      ? theme.surface
      : light ? '#ffffff' : '#0f172a';
    vars['--c-line'] = mix(base, background, light ? 0.8 : 0.85);
  }

  if (isHex6(theme.zoneBg)) vars['--c-zone'] = theme.zoneBg;
  else if (theme.textPattern) {
    vars['--c-zone'] = theme.textPattern === 'light' ? '#eceff4' : '#1e293b';
  }

  const lightButtons = theme.textPattern
    ? theme.textPattern === 'light'
    : isHex6(theme.surface)
      ? readableFg(theme.surface) === '#000000'
      : baseIsLight;
  const setButton = (name: string, color?: string) => {
    if (!isHex6(color)) return;
    const parsed = parseHex(color)!;
    vars[`--c-${name}-bg`] =
      `rgba(${parsed[0]}, ${parsed[1]}, ${parsed[2]}, ${lightButtons ? 0.2 : 0.25})`;
    vars[`--c-${name}-fg`] = lightButtons ? '#000000' : '#ffffff';
  };

  if (theme.unifyButtons) {
    const accent = isHex6(theme.accent) ? theme.accent : '#0ea5e9';
    const neutral = isHex6(theme.neutral) ? theme.neutral : '#6b7280';
    const danger = isHex6(theme.danger) ? theme.danger : '#ef4444';
    for (const name of ['green', 'sky', 'orange', 'yellow']) setButton(name, accent);
    setButton('gray', neutral);
    setButton('red', danger);
  } else {
    setButton('green', theme.buttons?.green);
    setButton('sky', theme.buttons?.sky);
    setButton('orange', theme.buttons?.orange);
    setButton('gray', theme.buttons?.gray);
    setButton('red', theme.buttons?.red);
  }
  return vars;
}
