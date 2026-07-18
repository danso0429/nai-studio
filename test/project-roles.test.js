'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('../frontend/node_modules/typescript');

function loadProjectRoles() {
  const filename = path.resolve(__dirname, '../frontend/src/models/projectRoles.ts');
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

test('project roles accept known roles and keep only one Quick project', () => {
  const { normalizeProjectRoles } = loadProjectRoles();
  assert.deepEqual(normalizeProjectRoles({
    roles: {
      QuickA: 'quick-generation',
      QuickB: 'quick-generation',
      Template: 'scene-template',
      Bad: 'admin',
    },
  }), {
    version: 1,
    roles: {
      QuickA: 'quick-generation',
      Template: 'scene-template',
    },
  });
});

test('visible project names hide internal roles without weakening collision names', () => {
  const { visibleProjectNames } = loadProjectRoles();
  const all = ['User', 'Quick', 'Template'];
  assert.deepEqual(visibleProjectNames(all, {
    Quick: 'quick-generation',
    Template: 'scene-template',
  }), ['User']);
  assert.deepEqual(all, ['User', 'Quick', 'Template']);
});

test('Quick project naming uses the first unoccupied stable name', () => {
  const { nextQuickProjectName } = loadProjectRoles();
  assert.equal(nextQuickProjectName([]), '퀵 생성');
  assert.equal(nextQuickProjectName(['퀵 생성']), '퀵 생성 (2)');
  assert.equal(nextQuickProjectName(['퀵 생성', '퀵 생성 (2)']), '퀵 생성 (3)');
});

test('Quick wiring separates prompt ownership from output ownership', () => {
  const queue = fs.readFileSync(
    path.resolve(__dirname, '../frontend/src/models/TaskQueueService.ts'),
    'utf8',
  );
  const quick = fs.readFileSync(
    path.resolve(__dirname, '../frontend/src/components/QuickModeTab.tsx'),
    'utf8',
  );
  assert.match(queue, /promptSession\.getCommonSetup\(workflow\)/);
  assert.match(queue, /def\.handler\(\s*outputSession,/);
  assert.match(queue, /copyQuickPresetAssets\(promptSession, outputSession, shared\)/);
  assert.match(quick, /queueQuickWorkflow\(promptSession, quickSession, scene, 1\)/);
  assert.match(quick, /removeTasksFromScene\(quickSession!, scene\)/);
});
