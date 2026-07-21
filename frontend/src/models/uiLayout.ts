import type {
  ToolbarButtonPlacement,
  UiToolbarAreaLayout,
  UiToolbarConfig,
} from '../main/config';

export type ToolbarTier =
  | 'primary'
  | 'secondary'
  | 'mobile-primary'
  | 'overflow';

export interface ToolbarButtonMeta {
  id: string;
  name: string;
  pcOnly?: boolean;
  tier: ToolbarTier;
  portable?: boolean;
}

export const sceneToolbarRegistry: ToolbarButtonMeta[] = [
  { id: 'add-scene', name: '씬 추가', tier: 'primary' },
  { id: 'queue-add', name: '예약 추가', tier: 'primary' },
  { id: 'cancel-project-queue', name: '모든 예약 취소', tier: 'primary' },
  { id: 'export-images', name: '이미지 내보내기', tier: 'primary' },
  { id: 'quick-export', name: '빠른 export', tier: 'primary' },
  { id: 'batch-process', name: '대량 작업', tier: 'primary' },
  { id: 'multi-select', name: '다중 선택', tier: 'primary' },
  { id: 'change-resolution', name: '해상도 변경', tier: 'primary' },
  { id: 'webp-convert', name: 'WebP 변환', tier: 'overflow' },
  { id: 'import-image', name: '이미지 프롬프트 추출', tier: 'primary' },
  {
    id: 'artist-tag',
    name: '아티스트 태깅',
    pcOnly: true,
    tier: 'overflow',
    portable: true,
  },
  { id: 'scene-search', name: '씬 검색', tier: 'primary' },
  { id: 'bookmark-jump', name: '북마크된 씬으로 이동', tier: 'primary' },
  { id: 'scene-trash', name: '씬 휴지통', tier: 'primary', portable: true },
  { id: 'reorder-scenes', name: '씬 순서 변경', tier: 'primary' },
  {
    id: 'empty-image-trash',
    name: '삭제 이미지 일괄 비우기',
    tier: 'primary',
    portable: true,
  },
  { id: 'find-replace', name: '찾기 및 변환', tier: 'primary', portable: true },
  { id: 'shortcut-help', name: '단축키 도움말', pcOnly: true, tier: 'overflow' },
];

export const projectToolbarRegistry: ToolbarButtonMeta[] = [
  { id: 'project-browser', name: '프로젝트 탐색', tier: 'primary', portable: true },
  { id: 'add-session', name: '신규 프로젝트', tier: 'primary', portable: true },
  {
    id: 'character-presets',
    name: '캐릭터 프리셋 관리',
    tier: 'primary',
    portable: true,
  },
  { id: 'rename-session', name: '프로젝트 이름 수정', tier: 'primary' },
  { id: 'scene-template', name: '씬 템플릿', tier: 'primary', portable: true },
  {
    id: 'backup-export',
    name: '프로젝트 백업/내보내기',
    tier: 'primary',
    portable: true,
  },
  { id: 'delete-session', name: '프로젝트 삭제', tier: 'primary', portable: true },
  { id: 'media-import', name: '백업·이미지 불러오기', tier: 'primary' },
  { id: 'project-trash', name: '프로젝트 휴지통', tier: 'primary', portable: true },
  { id: 'piece-editor', name: '프롬프트조각', tier: 'primary', portable: true },
  {
    id: 'new-window',
    name: '새 창',
    pcOnly: true,
    tier: 'primary',
    portable: true,
  },
];

export const MOBILE_PROJECT_TOPROW_IDS = ['project-browser', 'project-trash'];

export interface ToolbarRegistryEntry {
  area: string;
  registry: ToolbarButtonMeta[];
}

export const TOOLBAR_VIEW_MAIN: ToolbarRegistryEntry[] = [
  { area: 'scene', registry: sceneToolbarRegistry },
  { area: 'project', registry: projectToolbarRegistry },
];

export interface ToolbarAreaResolved {
  area: string;
  inline: string[];
  menu: string[];
}

export interface ToolbarMove {
  id: string;
  toArea: string;
  slot: 'inline' | 'menu' | 'hidden' | 'default';
  index?: number;
  anchor?: { id: string; side: 'before' | 'after' };
}

export function portableButtonIds(): string[] {
  return TOOLBAR_VIEW_MAIN.flatMap(({ registry }) =>
    registry.filter(({ portable }) => portable).map(({ id }) => id),
  );
}

export function portableButtonMetas(): { id: string; name: string }[] {
  return TOOLBAR_VIEW_MAIN.flatMap(({ registry }) =>
    registry
      .filter(({ portable }) => portable)
      .map(({ id, name }) => ({ id, name })),
  );
}

function tierPlacement(
  meta: ToolbarButtonMeta,
  isMobile: boolean,
): 'inline' | 'menu' {
  return meta.tier === 'primary' ||
    (meta.tier === 'secondary' && !isMobile) ||
    (meta.tier === 'mobile-primary' && isMobile)
    ? 'inline'
    : 'menu';
}

export function resolveToolbar(
  registry: ToolbarButtonMeta[],
  overrides: UiToolbarConfig | undefined,
  isMobile: boolean,
): { inline: string[]; menu: string[] } {
  if (overrides?.classic) {
    return { inline: registry.map(({ id }) => id), menu: [] };
  }

  const inline: string[] = [];
  const menu: string[] = [];
  for (const meta of registry) {
    if (isMobile && meta.pcOnly) continue;
    const placement = overrides?.buttons?.[meta.id] ?? 'default';
    if (placement === 'hidden') continue;
    if (placement === 'pinned') inline.push(meta.id);
    else if (placement === 'menu') menu.push(meta.id);
    else (tierPlacement(meta, isMobile) === 'inline' ? inline : menu).push(meta.id);
  }
  return { inline, menu };
}

function indexRegistries(registries: ToolbarRegistryEntry[]) {
  const homeById = new Map<string, string>();
  const metaById = new Map<string, ToolbarButtonMeta>();
  for (const { area, registry } of registries) {
    for (const meta of registry) {
      if (metaById.has(meta.id)) continue;
      metaById.set(meta.id, meta);
      homeById.set(meta.id, area);
    }
  }
  return { homeById, metaById };
}

function assignedAreas(
  registries: ToolbarRegistryEntry[],
  overrides: UiToolbarConfig | undefined,
  homeById: Map<string, string>,
  metaById: Map<string, ToolbarButtonMeta>,
): Map<string, string> {
  const assigned = new Map<string, string>();
  for (const { area } of registries) {
    const layout = overrides?.areas?.[area];
    if (!layout) continue;
    for (const ids of [layout.inline, layout.menu, layout.hidden]) {
      for (const id of ids ?? []) {
        const meta = metaById.get(id);
        if (!meta || assigned.has(id)) continue;
        if (homeById.get(id) === area || meta.portable) assigned.set(id, area);
      }
    }
  }
  return assigned;
}

export function resolveToolbarView(
  registries: ToolbarRegistryEntry[],
  overrides: UiToolbarConfig | undefined,
  isMobile: boolean,
  excludeIds?: ReadonlySet<string>,
): ToolbarAreaResolved[] {
  const resolved = resolveToolbarViewBase(registries, overrides, isMobile);
  if (!excludeIds?.size) return resolved;
  return resolved.map(({ area, inline, menu }) => ({
    area,
    inline: inline.filter((id) => !excludeIds.has(id)),
    menu: menu.filter((id) => !excludeIds.has(id)),
  }));
}

function resolveToolbarViewBase(
  registries: ToolbarRegistryEntry[],
  overrides: UiToolbarConfig | undefined,
  isMobile: boolean,
): ToolbarAreaResolved[] {
  if (overrides?.classic) {
    return registries.map(({ area, registry }) => ({
      area,
      ...resolveToolbar(registry, overrides, isMobile),
    }));
  }

  const { homeById, metaById } = indexRegistries(registries);
  const assigned = assignedAreas(registries, overrides, homeById, metaById);

  return registries.map(({ area, registry }) => {
    const layout = overrides?.areas?.[area];
    if (!layout) {
      const fallback = resolveToolbar(registry, overrides, isMobile);
      const belongsHere = (id: string) => !assigned.has(id) || assigned.get(id) === area;
      return {
        area,
        inline: fallback.inline.filter(belongsHere),
        menu: fallback.menu.filter(belongsHere),
      };
    }

    const inline: string[] = [];
    const menu: string[] = [];
    const placed = new Set<string>();
    const hidden = new Set(layout.hidden ?? []);
    const take = (ids: string[] | undefined, target: string[]) => {
      for (const id of ids ?? []) {
        if (assigned.get(id) !== area || placed.has(id) || hidden.has(id)) continue;
        const meta = metaById.get(id)!;
        if (isMobile && meta.pcOnly) continue;
        target.push(id);
        placed.add(id);
      }
    };
    take(layout.inline, inline);
    take(layout.menu, menu);

    for (const meta of registry) {
      if (
        placed.has(meta.id) ||
        assigned.has(meta.id) ||
        hidden.has(meta.id) ||
        (isMobile && meta.pcOnly)
      ) {
        continue;
      }
      const placement = overrides?.buttons?.[meta.id];
      if (placement === 'hidden') continue;
      if (placement === 'pinned') inline.push(meta.id);
      else if (placement === 'menu') menu.push(meta.id);
      else (tierPlacement(meta, isMobile) === 'inline' ? inline : menu).push(meta.id);
      placed.add(meta.id);
    }
    return { area, inline, menu };
  });
}

function canonicalizeView(
  registries: ToolbarRegistryEntry[],
  overrides: UiToolbarConfig | undefined,
): Map<string, Required<UiToolbarAreaLayout>> {
  const { homeById, metaById } = indexRegistries(registries);
  const assigned = assignedAreas(registries, overrides, homeById, metaById);
  const result = new Map<string, Required<UiToolbarAreaLayout>>();
  const placed = new Set<string>();

  for (const { area } of registries) {
    const lists = { inline: [] as string[], menu: [] as string[], hidden: [] as string[] };
    const layout = overrides?.areas?.[area];
    const take = (ids: string[] | undefined, target: string[]) => {
      for (const id of ids ?? []) {
        if (assigned.get(id) !== area || placed.has(id)) continue;
        target.push(id);
        placed.add(id);
      }
    };
    take(layout?.inline, lists.inline);
    take(layout?.menu, lists.menu);
    take(layout?.hidden, lists.hidden);
    result.set(area, lists);
  }

  for (const { area, registry } of registries) {
    const lists = result.get(area)!;
    for (const meta of registry) {
      if (placed.has(meta.id) || assigned.has(meta.id) || homeById.get(meta.id) !== area) continue;
      const placement = overrides?.buttons?.[meta.id];
      if (placement === 'hidden') lists.hidden.push(meta.id);
      else if (placement === 'pinned') lists.inline.push(meta.id);
      else if (placement === 'menu') lists.menu.push(meta.id);
      else lists[tierPlacement(meta, false)].push(meta.id);
      placed.add(meta.id);
    }
  }
  return result;
}

export function moveToolbarButton(
  registries: ToolbarRegistryEntry[],
  overrides: UiToolbarConfig | undefined,
  move: ToolbarMove,
): UiToolbarConfig {
  const { homeById, metaById } = indexRegistries(registries);
  const meta = metaById.get(move.id);
  const homeArea = homeById.get(move.id);
  if (!meta || homeArea === undefined) return overrides ?? {};
  if (move.toArea !== homeArea && !meta.portable) return overrides ?? {};

  const canonical = canonicalizeView(registries, overrides);
  for (const lists of canonical.values()) {
    lists.inline = lists.inline.filter((id) => id !== move.id);
    lists.menu = lists.menu.filter((id) => id !== move.id);
    lists.hidden = lists.hidden.filter((id) => id !== move.id);
  }

  if (move.slot !== 'default') {
    const target = canonical.get(move.toArea);
    if (target) {
      const list = target[move.slot];
      const anchorIndex = move.anchor ? list.indexOf(move.anchor.id) : -1;
      const index = move.anchor
        ? anchorIndex < 0
          ? list.length
          : anchorIndex + (move.anchor.side === 'after' ? 1 : 0)
        : move.index === undefined || move.index < 0 || move.index > list.length
          ? list.length
          : move.index;
      list.splice(index, 0, move.id);
    }
  }

  const areas: Record<string, UiToolbarAreaLayout> = {};
  for (const [area, lists] of canonical) {
    areas[area] = {
      inline: lists.inline,
      menu: lists.menu,
      hidden: lists.hidden,
    };
  }

  const buttons: Record<string, ToolbarButtonPlacement> = {
    ...(overrides?.buttons ?? {}),
  };
  if (move.slot === 'default') delete buttons[move.id];
  else if (move.slot === 'inline') buttons[move.id] = 'pinned';
  else buttons[move.id] = move.slot;

  return { ...(overrides ?? {}), buttons, areas, schema: 2 };
}
