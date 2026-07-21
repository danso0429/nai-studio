'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (relative) =>
  fs.readFileSync(path.resolve(__dirname, '..', relative), 'utf8');

test('global character folders preserve empty folders and normalize assignments', () => {
  const service = read('frontend/src/models/GlobalCharacterPresetService.ts');
  assert.match(service, /folders\?: string\[\]/);
  assert.match(service, /listFolders\(\)/);
  assert.match(service, /createFolder\(name: string\)/);
  assert.match(service, /setFolder\(id: string, folder: string \| null\)/);
  assert.match(service, /renameFolder\(oldName: string, newName: string\)/);
  assert.match(service, /deleteFolder\(name: string\)/);
});

test('global character file transfer embeds and restores image payloads', () => {
  const service = read('frontend/src/models/GlobalCharacterPresetService.ts');
  assert.match(service, /exportToFileData/);
  assert.match(service, /vibeImages/);
  assert.match(service, /referenceImages/);
  assert.match(service, /representativeImageData/);
  assert.match(service, /importFromFileData/);
  assert.match(service, /globalFolder/);
});

test('multi-character application is additive by provenance and individually removable', () => {
  const app = read('frontend/src/models/AppService.ts');
  const editor = read('frontend/src/components/CharacterPresetEditor.tsx');
  const dialog = read('frontend/src/components/GlobalCharacterPresetDialog.tsx');
  assert.match(app, /get appliedCharacterPresetNames\(\)/);
  assert.match(app, /item\.fromPreset !== preset\.name/);
  assert.match(app, /applyCharacterPresets\(presets: CharacterPreset\[\]\)/);
  assert.match(app, /removeAppliedCharacterPreset\(name: string\)/);
  assert.match(editor, /선택 적용/);
  assert.match(dialog, /applyCharacterPresets\(locals\)/);
  assert.match(dialog, /폴더 이동/);
});
