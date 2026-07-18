'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('../frontend/node_modules/typescript');

function source(relativePath) {
  return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

function loadResolutionValue() {
  const filename = path.resolve(__dirname, '../frontend/src/models/resolutionValue.ts');
  const compiled = ts.transpileModule(source('frontend/src/models/resolutionValue.ts'), {
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

test('custom resolutions reject invalid dimensions and round each side up to 64px', () => {
  const { normalizeCustomResolution } = loadResolutionValue();
  assert.equal(normalizeCustomResolution('', '1216'), null);
  assert.equal(normalizeCustomResolution('0', '1216'), null);
  assert.deepEqual(normalizeCustomResolution('1', '65'), {
    resolution: 'custom',
    width: 64,
    height: 128,
  });
  assert.deepEqual(normalizeCustomResolution('832', '1216'), {
    resolution: 'custom',
    width: 832,
    height: 1216,
  });
});

test('new scene resolution persists and is used by both scene creation paths', () => {
  const types = source('frontend/src/models/types.ts');
  const queue = source('frontend/src/components/SceneQueueControl.tsx');
  assert.match(types, /newSceneResolution\?: \{ resolution: string;/);
  assert.match(types, /session\.newSceneResolution = json\.newSceneResolution;/);
  assert.match(types, /newSceneResolution: this\.newSceneResolution,/);
  assert.match(queue, /const defaultResolution = curSession\.newSceneResolution;/);
  assert.equal((queue.match(/\.\.\.defaultResolutionFields,/g) || []).length, 2);
});

test('general preset and Quick UI expose resolution controls without merging generation buttons', () => {
  const preset = source('frontend/src/components/PreSetEditor.tsx');
  const quick = source('frontend/src/components/QuickModeTab.tsx');
  assert.match(preset, /showNewSceneResolution/);
  assert.match(preset, /const scenes = Array\.from\(session\.scenes\.values\(\)\);/);
  assert.match(preset, /sessionService\.markDirty\(session\.name\);/);
  assert.match(quick, /'1장 생성'/);
  assert.match(quick, /'자동 생성'/);
  assert.match(quick, /<ResolutionPicker/);
  assert.match(quick, /sessionService\.markDirty\(session\.name\);/);
});
