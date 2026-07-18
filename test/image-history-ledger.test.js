'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  appendHistoryEntry,
  normalizeHistoryEntries,
  removeProjectEntries,
  rewriteHistoryEntries,
} = require('../lib/image-history-ledger');

function entry(path, completedAt) {
  return { outputFilePath: path, completedAt, meta: {} };
}

test('history ledger keeps the newest unique entries without an age cutoff', () => {
  const old = entry('outs/A/default/old.png', 1);
  const entries = normalizeHistoryEntries([
    old,
    entry('outs/A/default/new.png', 9999999999999),
    entry('outs/A/default/old.png', 2),
    null,
  ], 2);
  assert.deepEqual(entries.map((item) => item.outputFilePath), [
    'outs/A/default/old.png',
    'outs/A/default/new.png',
  ]);
  assert.equal(entries[0].completedAt, 2);
});

test('appending moves a repeated path to the newest position and enforces the limit', () => {
  let entries = [entry('a.png', 1), entry('b.png', 2)];
  entries = appendHistoryEntry(entries, entry('a.png', 3), 2);
  assert.deepEqual(entries.map((item) => item.outputFilePath), ['b.png', 'a.png']);
  entries = appendHistoryEntry(entries, entry('c.png', 4), 2);
  assert.deepEqual(entries.map((item) => item.outputFilePath), ['a.png', 'c.png']);
});

test('invalid persisted shapes load as an empty ledger', () => {
  assert.deepEqual(normalizeHistoryEntries({ entries: [] }, 30), []);
  assert.deepEqual(normalizeHistoryEntries([{}, { outputFilePath: 'x' }], 30), []);
});

test('project and scene path renames also rebuild navigation metadata', () => {
  const original = entry('outs/Old/scene one/1.png', 1);
  original.meta = { sceneKey: 'Old/scene/scene one', sceneName: 'scene one' };
  const project = rewriteHistoryEntries([original], 'outs/Old', 'outs/New', 30);
  assert.equal(project.changed, true);
  assert.equal(project.entries[0].outputFilePath, 'outs/New/scene one/1.png');
  assert.equal(project.entries[0].meta.sceneKey, 'New/scene/scene one');
  const scene = rewriteHistoryEntries(project.entries, 'outs/New/scene one', 'outs/New/renamed', 30);
  assert.equal(scene.entries[0].meta.sceneName, 'renamed');
});

test('project removal only drops entries owned by that project', () => {
  const entries = [entry('outs/A/default/1.png', 1), entry('inpaints/B/edit/2.png', 2)];
  assert.deepEqual(
    removeProjectEntries(entries, 'A').map((item) => item.outputFilePath),
    ['inpaints/B/edit/2.png'],
  );
});
