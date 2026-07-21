export interface BatchCharacterAxis {
  id: string;
  name: string;
}

export interface BatchCreateItem {
  name: string;
  charPresetId?: string;
  sceneTemplateName?: string;
  subfolder?: string;
}

export function buildBatchItemName(charName?: string, sceneName?: string): string {
  if (charName && sceneName) return `${charName}_${sceneName}`;
  return charName || sceneName || '';
}

export function buildBatchCombinations(
  characters: BatchCharacterAxis[],
  sceneTemplateNames: string[],
  subfolderByCharacter: boolean,
): BatchCreateItem[] {
  if (!characters.length && !sceneTemplateNames.length) return [];
  if (!characters.length) {
    return sceneTemplateNames.map((name) => ({
      name,
      sceneTemplateName: name,
    }));
  }
  const result: BatchCreateItem[] = [];
  for (const character of characters) {
    const subfolder = subfolderByCharacter ? character.name : undefined;
    if (!sceneTemplateNames.length) {
      result.push({
        name: character.name,
        charPresetId: character.id,
        subfolder,
      });
      continue;
    }
    for (const sceneName of sceneTemplateNames) {
      result.push({
        name: buildBatchItemName(character.name, sceneName),
        charPresetId: character.id,
        sceneTemplateName: sceneName,
        subfolder,
      });
    }
  }
  return result;
}

export function resolveBatchName(base: string, taken: Set<string>): string {
  let name = base;
  let index = 1;
  while (taken.has(name)) name = `${base}_${index++}`;
  taken.add(name);
  return name;
}
