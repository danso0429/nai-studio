export const COMPANION_HOSTS = [
  'presetTop',
  'sampling',
  'characterPrompts',
  'vibes',
  'characterReferences',
] as const;

export type CompanionHost = (typeof COMPANION_HOSTS)[number];

export const COMPANION_HOST_LABELS: Record<CompanionHost, string> = {
  presetTop: '프리셋 상단 행',
  sampling: '샘플링 프리셋 행',
  characterPrompts: '캐릭터 프롬프트 행',
  vibes: '바이브 설정 행',
  characterReferences: '캐릭터 레퍼런스 행',
};

// Remote에서 실제 전역 콜백을 가진 portable 버튼만 허용한다. 렌더러가 없는 id를
// 배정해 툴바와 호스트 양쪽에서 사라지게 하지 않는 것이 우선이다.
export const COMPANION_BUTTON_IDS = [
  'project-browser',
  'add-session',
  'character-presets',
  'scene-template',
  'backup-export',
  'delete-session',
  'piece-editor',
  'scene-trash',
  'empty-image-trash',
  'find-replace',
] as const;

const allowed = new Set<string>(COMPANION_BUTTON_IDS);

export function isCompanionButtonId(id: string): boolean {
  return allowed.has(id);
}

function assignment(slots?: Record<string, string[]>): Map<string, CompanionHost> {
  const result = new Map<string, CompanionHost>();
  for (const host of COMPANION_HOSTS) {
    for (const id of slots?.[host] ?? []) {
      if (!allowed.has(id) || result.has(id)) continue;
      result.set(id, host);
    }
  }
  return result;
}

export function resolveCompanionButtons(
  host: string,
  slots?: Record<string, string[]>,
): string[] {
  if (!COMPANION_HOSTS.includes(host as CompanionHost)) return [];
  const owner = assignment(slots);
  const seen = new Set<string>();
  return (slots?.[host] ?? []).filter((id) => {
    if (seen.has(id) || owner.get(id) !== host) return false;
    seen.add(id);
    return true;
  });
}

export function companionAssignedIds(slots?: Record<string, string[]>): Set<string> {
  return new Set(assignment(slots).keys());
}

export function companionOwnerOf(
  id: string,
  slots?: Record<string, string[]>,
): CompanionHost | undefined {
  return assignment(slots).get(id);
}

export function assignCompanion(
  slots: Record<string, string[]> | undefined,
  host: CompanionHost,
  id: string,
): Record<string, string[]> {
  if (!allowed.has(id)) return slots ?? {};
  const next: Record<string, string[]> = {};
  for (const key of COMPANION_HOSTS) {
    const values = (slots?.[key] ?? []).filter((value) => value !== id);
    if (values.length > 0) next[key] = values;
  }
  next[host] = [...(next[host] ?? []), id];
  return next;
}

export function removeCompanion(
  slots: Record<string, string[]> | undefined,
  id: string,
): Record<string, string[]> {
  const next: Record<string, string[]> = {};
  for (const key of COMPANION_HOSTS) {
    const values = (slots?.[key] ?? []).filter((value) => value !== id);
    if (values.length > 0) next[key] = values;
  }
  return next;
}
