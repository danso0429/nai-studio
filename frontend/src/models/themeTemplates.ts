import type { UiThemeConfig } from '../main/config';
import { mix } from './uiTheme';

export interface ThemeTemplate {
  name: string;
  emoji: string;
  light: UiThemeConfig;
  dark: UiThemeConfig;
}

const variant = (
  textPattern: 'light' | 'dark',
  surface: string,
  surface2: string,
  inputTint: string,
  accent: string,
  neutral: string,
  danger: string,
): UiThemeConfig => ({
  surface,
  surface2,
  inputBg: mix(textPattern === 'light' ? '#e5e7eb' : '#334155', inputTint, 0.25),
  textPattern,
  accent,
  neutral,
  danger,
});

export const themeTemplates: ThemeTemplate[] = [
  { name: '체리 블로섬', emoji: '🌸',
    light: variant('light', '#fdf2f8', '#fce7f3', '#f6d5e5', '#ec4899', '#9d7a8c', '#e11d48'),
    dark: variant('dark', '#241820', '#2e1f29', '#3a2833', '#f472b6', '#705a66', '#fb7185') },
  { name: '포레스트 그린', emoji: '🌿',
    light: variant('light', '#f0fdf4', '#dcfce7', '#ddf0e2', '#16a34a', '#78907f', '#dc2626'),
    dark: variant('dark', '#14201a', '#1b2b22', '#24382c', '#34d399', '#4b6354', '#f87171') },
  { name: '베이지 & 라떼', emoji: '☕',
    light: variant('light', '#f7f1e6', '#efe5d3', '#e8dcc6', '#b45309', '#8a7a63', '#dc2626'),
    dark: variant('dark', '#241d15', '#2e251b', '#3a2f22', '#d4a373', '#5f5140', '#f87171') },
  { name: '쿠키 & 크림', emoji: '🍪',
    light: variant('light', '#faf7f2', '#f1ece2', '#e9e2d4', '#8b5e34', '#857c6e', '#dc2626'),
    dark: variant('dark', '#1f1a14', '#29221a', '#342b20', '#e7d3b3', '#55493a', '#f87171') },
  { name: '오션 블루', emoji: '🌊',
    light: variant('light', '#eff6ff', '#dbeafe', '#d3e4f5', '#0284c7', '#64748b', '#dc2626'),
    dark: variant('dark', '#0f1b2a', '#16283c', '#1e3450', '#38bdf8', '#3e5468', '#f87171') },
  { name: '라벤더', emoji: '💜',
    light: variant('light', '#f5f3ff', '#ede9fe', '#e2dcf5', '#7c3aed', '#8b81a3', '#dc2626'),
    dark: variant('dark', '#1d1830', '#262040', '#322a52', '#a78bfa', '#4e4568', '#f87171') },
];
