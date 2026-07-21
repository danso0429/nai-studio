'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('../frontend/node_modules/typescript');

function loadPlan() {
  const filename = path.resolve(__dirname, '../frontend/src/models/batchCreatePlan.ts');
  const source = fs.readFileSync(filename, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  }).outputText;
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded._compile(compiled, filename);
  return loaded.exports;
}

test('batch plan forms character × scene combinations and optional subfolders', () => {
  const { buildBatchCombinations } = loadPlan();
  assert.deepEqual(
    buildBatchCombinations(
      [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
      ['X', 'Y'],
      true,
    ),
    [
      { name: 'A_X', charPresetId: 'a', sceneTemplateName: 'X', subfolder: 'A' },
      { name: 'A_Y', charPresetId: 'a', sceneTemplateName: 'Y', subfolder: 'A' },
      { name: 'B_X', charPresetId: 'b', sceneTemplateName: 'X', subfolder: 'B' },
      { name: 'B_Y', charPresetId: 'b', sceneTemplateName: 'Y', subfolder: 'B' },
    ],
  );
  assert.deepEqual(buildBatchCombinations([], ['X'], true), [
    { name: 'X', sceneTemplateName: 'X' },
  ]);
  assert.deepEqual(buildBatchCombinations([], [], true), []);
});

test('batch names avoid both existing and within-plan collisions', () => {
  const { resolveBatchName } = loadPlan();
  const taken = new Set(['A', 'A_1']);
  assert.equal(resolveBatchName('A', taken), 'A_2');
  assert.equal(resolveBatchName('A', taken), 'A_3');
});

test('batch execution preserves axes and offers separate reservation registration', () => {
  const service = fs.readFileSync(
    path.resolve(__dirname, '../frontend/src/models/TemplateService.ts'),
    'utf8',
  );
  const panel = fs.readFileSync(
    path.resolve(__dirname, '../frontend/src/components/BatchCreatePanel.tsx'),
    'utf8',
  );
  const queue = fs.readFileSync(
    path.resolve(__dirname, '../frontend/src/models/sceneQueueActions.ts'),
    'utf8',
  );
  assert.match(service, /batchCreateFromTemplate/);
  assert.match(service, /protectAreas: batch \? \['characterPresets', 'scenes'\]/);
  assert.match(service, /instantiateIntoSession\(\s*session,/);
  assert.match(panel, /생성한 프로젝트 예약 등록/);
  assert.match(panel, /combinations\.length >= 50/);
  assert.match(queue, /queueProjectsForGeneration/);
  assert.match(queue, /beginBatchCollect/);
  assert.match(queue, /flushBatchCollect/);
});
