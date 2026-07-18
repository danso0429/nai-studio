'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('../frontend/node_modules/typescript');

function loadCoordinator() {
  const filename = path.resolve(
    __dirname,
    '../frontend/src/backends/TextWriteCoordinator.ts',
  );
  const source = fs.readFileSync(filename, 'utf8');
  const compiled = ts.transpileModule(source, {
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
  return loaded.exports.TextWriteCoordinator;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function waitFor(predicate) {
  for (let i = 0; i < 50; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error('condition was not reached');
}

test('same-path snapshots serialize and queued writes coalesce to the latest', async () => {
  const TextWriteCoordinator = loadCoordinator();
  const calls = [];
  const pending = [];
  const writer = async (filePath, data) => {
    calls.push({ filePath, data, mode: 'normal' });
    const gate = deferred();
    pending.push(gate);
    await gate.promise;
  };
  const coordinator = new TextWriteCoordinator(writer, async () => {
    throw new Error('unexpected keepalive write');
  });

  const first = coordinator.write('projects/a.json', 'one');
  const second = coordinator.write('projects/a.json', 'two');
  const third = coordinator.write('projects/a.json', 'three');
  const flushed = coordinator.flushPath('projects/a.json');

  assert.deepEqual(calls, [
    { filePath: 'projects/a.json', data: 'one', mode: 'normal' },
  ]);
  pending[0].resolve();
  await waitFor(() => calls.length === 2);
  assert.deepEqual(calls[1], {
    filePath: 'projects/a.json',
    data: 'three',
    mode: 'normal',
  });
  pending[1].resolve();

  await Promise.all([first, second, third, flushed]);
  assert.equal(calls.length, 2);
});

test('a queued keepalive request promotes the latest coalesced snapshot', async () => {
  const TextWriteCoordinator = loadCoordinator();
  const calls = [];
  const firstGate = deferred();
  const coordinator = new TextWriteCoordinator(
    async (filePath, data) => {
      calls.push({ filePath, data, mode: 'normal' });
      await firstGate.promise;
    },
    async (filePath, data) => {
      calls.push({ filePath, data, mode: 'keepalive' });
    },
  );

  const first = coordinator.write('projects/a.json', 'one');
  const second = coordinator.write('projects/a.json', 'two');
  const last = coordinator.write('projects/a.json', 'latest', 'keepalive');
  firstGate.resolve();
  await Promise.all([first, second, last]);

  assert.deepEqual(calls, [
    { filePath: 'projects/a.json', data: 'one', mode: 'normal' },
    { filePath: 'projects/a.json', data: 'latest', mode: 'keepalive' },
  ]);
});

test('flushAll waits for independent paths without serializing them together', async () => {
  const TextWriteCoordinator = loadCoordinator();
  const gates = new Map();
  const calls = [];
  const coordinator = new TextWriteCoordinator(async (filePath, data) => {
    calls.push({ filePath, data });
    const gate = deferred();
    gates.set(filePath, gate);
    await gate.promise;
  }, async () => {});

  const a = coordinator.write('projects/a.json', 'a');
  const b = coordinator.write('projects/b.json', 'b');
  let flushed = false;
  const flush = coordinator.flushAll().then(() => { flushed = true; });
  await waitFor(() => calls.length === 2);
  assert.equal(flushed, false);
  gates.get('projects/a.json').resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(flushed, false);
  gates.get('projects/b.json').resolve();
  await Promise.all([a, b, flush]);
  assert.equal(flushed, true);
});
