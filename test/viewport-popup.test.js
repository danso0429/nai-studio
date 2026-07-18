'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('../frontend/node_modules/typescript');

function loadHelpers() {
  const filename = path.resolve(__dirname, '../frontend/src/models/viewportPopup.ts');
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  }).outputText;
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded._compile(compiled, filename);
  return loaded.exports;
}

test('autocomplete stays below the caret when it fits and flips above the keyboard when needed', () => {
  const { positionAutocompletePopup } = loadHelpers();
  const viewport = { top: 40, height: 500 };
  assert.equal(positionAutocompletePopup(100, 200, 22, viewport), 122);
  assert.equal(positionAutocompletePopup(500, 200, 22, viewport), 278);
  assert.equal(positionAutocompletePopup(150, 400, 22, viewport), 140);
});

test('scene prompt popover is clamped inside the visible viewport', () => {
  const { positionAnchoredPanel } = loadHelpers();
  assert.deepEqual(
    positionAnchoredPanel(
      { left: 380, top: 700, width: 100 },
      { width: 300, height: 200 },
      { top: 20, height: 700, width: 500 },
    ),
    { left: 192, top: 512 },
  );
});
