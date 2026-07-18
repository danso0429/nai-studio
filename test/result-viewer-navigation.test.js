'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('../frontend/node_modules/typescript');

function loadSwipeNavigation() {
  const filename = path.resolve(__dirname, '../frontend/src/models/swipeNavigation.ts');
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  }).outputText;
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded._compile(compiled, filename);
  return loaded.exports;
}

test('horizontal swipe navigation rejects short and vertical gestures', () => {
  const { horizontalSwipeDirection } = loadSwipeNavigation();
  assert.equal(horizontalSwipeDirection(49, 0), 0);
  assert.equal(horizontalSwipeDirection(80, 60), 0);
  assert.equal(horizontalSwipeDirection(-80, 10), 1);
  assert.equal(horizontalSwipeDirection(80, 10), -1);
});

test('result viewer loading and scene navigation have cancellation and filtered-order wiring', () => {
  const viewer = fs.readFileSync(
    path.resolve(__dirname, '../frontend/src/components/ResultViewer.tsx'),
    'utf8',
  );
  const queue = fs.readFileSync(
    path.resolve(__dirname, '../frontend/src/components/SceneQueueControl.tsx'),
    'utf8',
  );
  assert.match(viewer, /setImage\(undefined\);/);
  assert.match(viewer, /canceled = true;/);
  assert.match(viewer, /image-prev-scene/);
  assert.match(queue, /const navigationScenes = getFilteredScenes\(\);/);
  assert.match(queue, /key=\{`\$\{type\}:\$\{displayScene\.name\}`\}/);
});
