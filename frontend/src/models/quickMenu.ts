export interface QuickMenuActionMeta {
  id: string;
  name: string;
  needsProject?: boolean;
}

export const QUICK_MENU_ACTIONS: QuickMenuActionMeta[] = [
  { id: 'project-browser', name: '프로젝트 목록' },
  { id: 'piece-editor', name: '프롬프트조각', needsProject: true },
  { id: 'find-replace', name: '찾기 및 변환', needsProject: true },
  { id: 'media-import', name: '백업·이미지 불러오기' },
  { id: 'scene-importer', name: '씬 일괄 임포트', needsProject: true },
  { id: 'history', name: '이미지 히스토리' },
  { id: 'empty-image-trash', name: '삭제 이미지 일괄 비우기', needsProject: true },
  { id: 'delete-session', name: '프로젝트 삭제', needsProject: true },
];

export const DEFAULT_QUICK_MENU = [
  'project-browser',
  'piece-editor',
  'find-replace',
  'media-import',
  'history',
];

export function normalizeQuickMenu(value: unknown): string[] {
  if (!Array.isArray(value)) return [...DEFAULT_QUICK_MENU];
  const allowed = new Set(QUICK_MENU_ACTIONS.map(({ id }) => id));
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || !allowed.has(item) || seen.has(item)) continue;
    seen.add(item);
    result.push(item);
  }
  return result;
}
