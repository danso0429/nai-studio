'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.resolve(__dirname, '../frontend/src/components/ConfigScreen.tsx'),
  'utf8',
);

test('config dirty state compares only the draft fields written by the save flow', () => {
  assert.match(source, /interface SavedConfigDraft/);
  assert.match(source, /const currentDraft = configDraftFingerprint/);
  assert.match(source, /const dirty = savedDraft !== undefined && currentDraft !== savedDraft/);
  assert.doesNotMatch(source, /SavedConfigDraft[\s\S]*saveLocation:/);
});

test('config load and save both reset the unsaved-change baseline', () => {
  assert.equal((source.match(/setSavedDraft\(configDraftFingerprint\(/g) || []).length, 2);
  assert.match(source, /\{dirty && \(/);
  assert.match(source, /저장 안 된 변경/);
});
