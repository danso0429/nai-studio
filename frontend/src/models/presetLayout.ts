import { WFIElement, WFIStack, wfiElementKey } from './workflows/WorkFlow';

export const PRESET_LAYOUT_ANCHORS = new Set([
  'preset-select',
  'profile-preset-select',
]);

export function presetLayoutSlotKey(type: string, inner: boolean): string {
  return inner ? `${type}@inner` : type;
}

export function resolvePresetOrder(definition: string[], override?: string[]): string[] {
  if (!override?.length) return definition.slice();
  const valid = new Set(definition);
  const result: string[] = [];
  for (const key of override) {
    if (valid.has(key) && !result.includes(key)) result.push(key);
  }
  let insertAt = 0;
  for (const key of definition) {
    const current = result.indexOf(key);
    if (current >= 0) insertAt = current + 1;
    else result.splice(insertAt++, 0, key);
  }
  return result;
}

export function resolvePresetInputs(stack: WFIStack, override?: string[]): WFIElement[] {
  if (!override?.length) return stack.inputs;
  const keys = stack.inputs.map(wfiElementKey);
  if (keys.some((key) => !key) || new Set(keys).size !== keys.length) return stack.inputs;
  const byKey = new Map(keys.map((key, index) => [key!, stack.inputs[index]]));
  return resolvePresetOrder(keys as string[], override).map((key) => byKey.get(key)!);
}

export function movePresetInput(order: string[], from: string, before?: string): string[] {
  if (PRESET_LAYOUT_ANCHORS.has(from) || !order.includes(from)) return order.slice();
  const next = order.filter((key) => key !== from);
  let index = before ? next.indexOf(before) : next.length;
  if (index < 0) index = next.length;
  let floor = 0;
  while (floor < next.length && PRESET_LAYOUT_ANCHORS.has(next[floor])) floor++;
  next.splice(Math.max(floor, index), 0, from);
  return next;
}
