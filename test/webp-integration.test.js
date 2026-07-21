'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('../frontend/node_modules/typescript');

const read = (relative) => fs.readFileSync(path.resolve(__dirname, '..', relative), 'utf8');

function loadConcurrency() {
  const filename = path.resolve(__dirname, '../frontend/src/models/concurrency.ts');
  const output = ts.transpileModule(read('frontend/src/models/concurrency.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  }).outputText;
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded._compile(output, filename);
  return loaded.exports;
}

test('shared pool visits every item and respects its concurrency bound', async () => {
  const { runPool } = loadConcurrency();
  let active = 0;
  let peak = 0;
  const visited = [];
  await runPool([0, 1, 2, 3, 4, 5, 6], 3, async (item) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    visited.push(item);
    active--;
  });
  assert.equal(peak, 3);
  assert.deepEqual(visited.sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6]);
});

test('manual conversion persists references before deleting any PNG', () => {
  const app = read('frontend/src/models/AppService.ts');
  const conversionStart = app.indexOf('private async runWebpConversion');
  const flush = app.indexOf('await sessionService.flushResource(session.name)', conversionStart);
  const deletion = app.indexOf('await backend.deleteFile(pngPath)', conversionStart);
  assert.ok(conversionStart >= 0 && flush > conversionStart && deletion > flush);
  assert.match(app, /PNG와 WebP를 모두 유지하고 저장을 재시도/);
  assert.match(app, /scene\.imageMap = scene\.imageMap\.map/);
  assert.match(app, /scene\.mains = scene\.mains\.map/);
  assert.match(app, /player\.path = map\.get\(player\.path\)/);
});

test('server automatic conversion verifies derivative before unlinking PNG', () => {
  const server = read('server.js');
  const auto = server.indexOf('async function maybeAutoConvertGeneratedImage');
  const encode = server.indexOf('await encodeImagePathAtomic', auto);
  const unlink = server.indexOf('await fs.unlink(inputPath)', auto);
  assert.ok(auto >= 0 && encode > auto && unlink > encode);
  assert.match(server, /automatic conversion failed; PNG kept/);
  assert.match(server, /preserveStealth: true/);
  assert.match(server, /app\.post\('\/api\/image\/convert-webp'/);
});

test('WebP controls are wired through config, toolbar, storage, and export quality', () => {
  const config = read('frontend/src/components/ConfigScreen.tsx');
  const toolbar = read('frontend/src/components/SceneQueueControl.tsx');
  const storage = read('frontend/src/components/StorageManageModal.tsx');
  const exportUi = read('frontend/src/components/ExportPresetsDialog.tsx');
  assert.match(config, /autoConvertWebpQuality/);
  assert.match(toolbar, /'webp-convert'/);
  assert.match(toolbar, /openConvertToWebpMenu/);
  assert.match(storage, /openProjectWebpOptimize/);
  assert.match(exportUi, /preserveStealth/);
  assert.match(exportUi, /압축 품질/);
});

test('image refresh retains converted WebP and AVIF outputs beside PNG', () => {
  const imageService = read('frontend/src/models/ImageService.ts');
  assert.match(imageService, /\\\.\(\?:png\|webp\|avif\)\$/);
});
