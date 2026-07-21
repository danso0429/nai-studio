'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('../frontend/node_modules/typescript');

const read = (relative) => fs.readFileSync(path.resolve(__dirname, '..', relative), 'utf8');

function loadModel() {
  const filename = path.resolve(__dirname, '../frontend/src/models/companionSlots.ts');
  const compiled = ts.transpileModule(read('frontend/src/models/companionSlots.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  }).outputText;
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded._compile(compiled, filename);
  return loaded.exports;
}

test('companion resolver enforces allowed ids, uniqueness, and first-host ownership', () => {
  const model = loadModel();
  const slots = {
    characterPrompts: ['piece-editor', 'stale', 'piece-editor'],
    vibes: ['piece-editor', 'find-replace'],
  };
  assert.deepEqual(model.resolveCompanionButtons('characterPrompts', slots), ['piece-editor']);
  assert.deepEqual(model.resolveCompanionButtons('vibes', slots), ['find-replace']);
  assert.deepEqual([...model.companionAssignedIds(slots)], ['piece-editor', 'find-replace']);
});

test('assignment moves one button between hosts without mutating input', () => {
  const model = loadModel();
  const original = { characterPrompts: ['piece-editor'], vibes: ['find-replace'] };
  const before = structuredClone(original);
  const moved = model.assignCompanion(original, 'characterReferences', 'piece-editor');
  assert.deepEqual(original, before);
  assert.equal(model.companionOwnerOf('piece-editor', moved), 'characterReferences');
  assert.deepEqual(model.removeCompanion(moved, 'piece-editor'), { vibes: ['find-replace'] });
  assert.equal(model.assignCompanion(original, 'vibes', 'stale'), original);
});

test('three persistent preset rows render companion buttons and toolbars exclude assignments', () => {
  const preset = read('frontend/src/components/PreSetEditor.tsx');
  const scene = read('frontend/src/components/SceneQueueControl.tsx');
  const project = read('frontend/src/components/SessionSelect.tsx');
  for (const host of ['characterPrompts', 'vibes', 'characterReferences']) {
    assert.ok(preset.includes(`host="${host}"`), host);
  }
  assert.match(scene, /companionAssignedIds\(appState\.uiCompanionSlots\)/);
  assert.match(project, /companionAssignedIds\(appState\.uiCompanionSlots\)/);
});
