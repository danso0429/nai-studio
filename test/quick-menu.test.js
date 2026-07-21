'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('../frontend/node_modules/typescript');

const read = (relative) => fs.readFileSync(path.resolve(__dirname, '..', relative), 'utf8');

function loadQuickMenuModel() {
  const filename = path.resolve(__dirname, '../frontend/src/models/quickMenu.ts');
  const compiled = ts.transpileModule(read('frontend/src/models/quickMenu.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  }).outputText;
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded._compile(compiled, filename);
  return loaded.exports;
}

test('quick menu normalization preserves valid order and rejects stale duplicates', () => {
  const model = loadQuickMenuModel();
  assert.deepEqual(
    model.normalizeQuickMenu(['history', 'stale', 'history', 'piece-editor']),
    ['history', 'piece-editor'],
  );
  assert.deepEqual(model.normalizeQuickMenu(undefined), model.DEFAULT_QUICK_MENU);
  assert.deepEqual(model.normalizeQuickMenu([]), []);
});

test('quick menu uses existing guarded destructive entry points and Ctrl+K', () => {
  const component = read('frontend/src/components/QuickMenu.tsx');
  const shortcuts = read('frontend/src/models/KeyboardShortcutService.ts');
  const app = read('frontend/src/components/App.tsx');
  assert.match(component, /emptyProjectImageTrashWithConfirm/);
  assert.match(component, /deleteProjectBackground/);
  assert.match(shortcuts, /id: 'quick-menu'.*defaultKey: 'Ctrl\+K'/);
  assert.match(app, /case 'quick-menu'/);
  assert.match(app, /<QuickMenu/);
});
