'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('../frontend/node_modules/typescript');

const read = (relative) => fs.readFileSync(path.resolve(__dirname, '..', relative), 'utf8');

function loadLayout() {
  const filename = path.resolve(__dirname, '../frontend/src/models/presetLayout.ts');
  let code = ts.transpileModule(read('frontend/src/models/presetLayout.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  }).outputText;
  code = code.replace(
    /const WorkFlow_1 = require\("\.\/workflows\/WorkFlow"\);/,
    'const WorkFlow_1 = { wfiElementKey: (element) => element.key };',
  );
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded._compile(code, filename);
  return loaded.exports;
}

test('preset order drops stale keys, inserts new definition keys, and keeps a permutation', () => {
  const { resolvePresetOrder } = loadLayout();
  assert.deepEqual(resolvePresetOrder(['a', 'b', 'c'], ['c', 'stale', 'a', 'c']), ['c', 'a', 'b']);
  assert.deepEqual(resolvePresetOrder(['new', 'a', 'b'], ['b', 'a']), ['new', 'b', 'a']);
});

test('preset input resolver fails open to definition order on missing or duplicate keys', () => {
  const { resolvePresetInputs } = loadLayout();
  const valid = { inputs: [{ key: 'a' }, { key: 'b' }] };
  assert.deepEqual(resolvePresetInputs(valid, ['b', 'a']).map((x) => x.key), ['b', 'a']);
  const invalid = { inputs: [{ key: 'a' }, {}] };
  assert.equal(resolvePresetInputs(invalid, ['a']), invalid.inputs);
});

test('preset movement protects selector anchors and root editor persists keyed layout', () => {
  const { movePresetInput } = loadLayout();
  assert.deepEqual(
    movePresetInput(['preset-select', 'a', 'b'], 'b', 'a'),
    ['preset-select', 'b', 'a'],
  );
  assert.deepEqual(
    movePresetInput(['preset-select', 'a'], 'preset-select'),
    ['preset-select', 'a'],
  );
  const editor = read('frontend/src/components/PreSetEditor.tsx');
  const workflow = read('frontend/src/models/workflows/WorkFlow.ts');
  assert.match(editor, /<PresetRootStack stack=/);
  assert.match(editor, /uiPresetLayout: next/);
  assert.match(workflow, /export function wfiElementKey/);
});

test('workflow roots use stable explicit ids for elements without field keys', () => {
  const workflow = read('frontend/src/models/workflows/WorkFlow.ts');
  const sd = read('frontend/src/models/workflows/SDWorkFlow.ts');
  const augment = read('frontend/src/models/workflows/AugmentWorkFlow.ts');
  assert.match(workflow, /case 'inline': return element\.field/);
  assert.match(workflow, /case 'ifIn': return wfiElementKey\(element\.element\)/);
  assert.match(sd, /wfiPresetSelect\('preset-select'\)/);
  assert.match(sd, /wfiProfilePresetSelect\('profile-preset-select'\)/);
  assert.match(sd, /wfiExtraPromptInput\('추가 프롬프트', 'extra-prompt'\)/);
  assert.equal((sd.match(/\], 'sampling-group'\)/g) || []).length, 5);
  assert.match(augment, /wfiShowImage\('image', 'shared', 'show-image'\)/);
  assert.match(augment, /'if-preset-select'/);
  assert.match(augment, /'if-middle-prompt'/);
});
