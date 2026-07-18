export type HiddenProjectRole = 'quick-generation' | 'scene-template';

export interface ProjectRolesData {
  version: 1;
  roles: Record<string, HiddenProjectRole>;
}

export function normalizeProjectRoles(raw: unknown): ProjectRolesData {
  const roles: Record<string, HiddenProjectRole> = {};
  const source = raw && typeof raw === 'object' &&
    (raw as { roles?: unknown }).roles &&
    typeof (raw as { roles?: unknown }).roles === 'object'
    ? (raw as { roles: Record<string, unknown> }).roles
    : {};
  let hasQuick = false;
  for (const [name, role] of Object.entries(source)) {
    if (!name || (role !== 'quick-generation' && role !== 'scene-template')) continue;
    if (role === 'quick-generation') {
      if (hasQuick) continue;
      hasQuick = true;
    }
    roles[name] = role;
  }
  return { version: 1, roles };
}

export function visibleProjectNames(
  names: string[],
  roles: Record<string, HiddenProjectRole>,
): string[] {
  return names.filter((name) => !roles[name]);
}

export function nextQuickProjectName(names: string[]): string {
  const existing = new Set(names);
  if (!existing.has('퀵 생성')) return '퀵 생성';
  let index = 2;
  while (existing.has(`퀵 생성 (${index})`)) index += 1;
  return `퀵 생성 (${index})`;
}
