'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('../frontend/node_modules/typescript');

function loadPresetHelpers() {
  const filename = path.resolve(__dirname, '../frontend/src/models/uiThemePresets.ts');
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

test('theme preset snapshots trim names and do not retain mutable theme references', () => {
  const { createUiThemePreset } = loadPresetHelpers();
  const theme = { surface: '#112233', buttons: { green: '#00ff00' } };
  const preset = createUiThemePreset('  밤  ', false, true, theme);
  theme.surface = '#ffffff';
  theme.buttons.green = '#000000';
  assert.equal(preset.name, '밤');
  assert.equal(preset.trueDark, true);
  assert.equal(preset.theme.surface, '#112233');
  assert.equal(preset.theme.buttons.green, '#00ff00');
  assert.equal(createUiThemePreset('   ', true, false, {}), null);
  assert.equal(createUiThemePreset('light', true, true, {}).trueDark, undefined);
});

test('normalization rejects malformed presets and duplicate names keep the last snapshot', () => {
  const { normalizeUiThemePresets } = loadPresetHelpers();
  assert.deepEqual(normalizeUiThemePresets([
    { name: 'A', whiteMode: true, theme: { surface: '#111111' } },
    { name: 'A', whiteMode: false, theme: { surface: '#222222' } },
    { name: '', whiteMode: true, theme: {} },
    { name: 'bad', whiteMode: 'yes', theme: {} },
  ]), [{ name: 'A', whiteMode: false, trueDark: undefined, theme: { surface: '#222222' } }]);
});

test('upsert preserves ordering while replacing the same named preset', () => {
  const { upsertUiThemePreset } = loadPresetHelpers();
  const old = [
    { name: 'A', whiteMode: true, theme: {} },
    { name: 'B', whiteMode: false, theme: {} },
  ];
  const next = upsertUiThemePreset(old, { name: 'A', whiteMode: false, theme: { danger: '#ff0000' } });
  assert.deepEqual(next.map((item) => item.name), ['A', 'B']);
  assert.equal(next[0].whiteMode, false);
  assert.notEqual(next, old);
});
