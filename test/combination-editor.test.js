'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (relative) =>
  fs.readFileSync(path.resolve(__dirname, '..', relative), 'utf8');

test('combination helpers share the Remote empty-column and enabled-piece contract', () => {
  const service = read('frontend/src/models/PromptService.ts');
  assert.match(service, /export function enumerateCombinations/);
  assert.match(service, /scene\.slots\.filter\(\(slot\) => slot\.length > 0\)/);
  assert.match(service, /piece\.enabled === undefined \|\| piece\.enabled/);
  assert.match(service, /export function combinationCount/);
  assert.match(service, /export function combinationMiddlePrompt/);
});

test('combination names round-trip and the editor renders capped previews', () => {
  const types = read('frontend/src/models/types.ts');
  const editor = read('frontend/src/components/SceneEditor.tsx');
  const list = read('frontend/src/components/CombinationList.tsx');
  assert.match(types, /name\?: string/);
  assert.match(types, /\.\.\.\(this\.name \? \{ name: this\.name \} : \{\}\)/);
  assert.match(editor, /piece\.name = nameDraft\.trim\(\) \|\| undefined/);
  assert.match(editor, /<CombinationList scene=\{scene\}/);
  assert.match(list, /PREVIEW_RENDER_CAP = 100/);
  assert.match(list, /앞 \{PREVIEW_RENDER_CAP\}종만 표시합니다/);
});
