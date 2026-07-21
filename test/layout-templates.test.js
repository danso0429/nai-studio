'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('../frontend/node_modules/typescript');

const read = (relative) => fs.readFileSync(path.resolve(__dirname, '..', relative), 'utf8');

function loadModel() {
  const filename = path.resolve(__dirname, '../frontend/src/models/layoutTemplates.ts');
  const compiled = ts.transpileModule(read('frontend/src/models/layoutTemplates.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  }).outputText;
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded._compile(compiled, filename);
  return loaded.exports;
}

test('layout resolver keeps classic defaults and forces mobile fallback', () => {
  const { resolveLayout } = loadModel();
  assert.equal(resolveLayout(undefined, false).id, 'classic');
  assert.equal(resolveLayout('stale', false).id, 'classic');
  assert.equal(resolveLayout('compact', true).id, 'classic');
  assert.deepEqual(
    {
      bottomBar: resolveLayout('compact', false).bottomBar,
      sessionSelectTop: resolveLayout('compact', false).sessionSelectTop,
      generationControl: resolveLayout('compact', false).generationControl,
    },
    { bottomBar: 'none', sessionSelectTop: true, generationControl: 'floating' },
  );
});

test('App and top bar consume the resolved layout without duplicating generation controls', () => {
  const app = read('frontend/src/components/App.tsx');
  const top = read('frontend/src/components/TobBar.tsx');
  assert.match(app, /resolvedLayout\.bottomBar === 'bottom'/);
  assert.match(app, /resolvedLayout\.generationControl === 'floating'/);
  assert.match(app, /--bottombar-h', '0px'/);
  assert.match(top, /layout\.sessionSelectTop/);
});
