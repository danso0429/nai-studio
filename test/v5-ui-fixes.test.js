'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function source(relativePath) {
  return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('cycling mode exposes preset-wide selection without changing scene selection', () => {
  const editor = source('frontend/src/components/CharacterPresetEditor.tsx');
  assert.match(editor, /프리셋 선택 \(\{selectedPresets\.size\}\/\{presets\.length\}\)/);
  assert.match(editor, /new Set\(allSelected \? \[\] : presets\.map/);
  assert.match(editor, /const targets = filteredScenes\.map/);
});

test('expanded prompt follows the configured input background token', () => {
  const prompt = source('frontend/src/components/PromptEditTextArea.tsx');
  assert.match(prompt, /if \(fullScreen\) bgColor = 'bg-\[var\(--c-input-bg\)\] shadow-lg'/);
  assert.doesNotMatch(prompt, /if \(fullScreen\) bgColor = 'bg-white dark:bg-slate-600 shadow-lg'/);
});
