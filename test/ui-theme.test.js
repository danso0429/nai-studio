'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('../frontend/node_modules/typescript');

function loadThemeModule() {
  const filename = path.resolve(__dirname, '../frontend/src/models/uiTheme.ts');
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

test('theme variables derive readable text, lines, zones, and unified roles', () => {
  const { buildThemeVars } = loadThemeModule();
  const vars = buildThemeVars({
    surface: '#fdf2f8',
    surface2: '#fce7f3',
    inputBg: '#f6e9ef',
    textPattern: 'light',
    unifyButtons: true,
    accent: '#ec4899',
    neutral: '#9d7a8c',
    danger: '#e11d48',
  }, true);

  assert.equal(vars['--c-surface'], '#fdf2f8');
  assert.equal(vars['--c-input-text'], '#000000');
  assert.equal(vars['--c-text'], '#000000');
  assert.equal(vars['--c-zone'], '#eceff4');
  assert.match(vars['--c-line'], /^#[0-9a-f]{6}$/);
  assert.equal(vars['--c-sky-bg'], vars['--c-green-bg']);
  assert.equal(vars['--c-orange-bg'], vars['--c-green-bg']);
  assert.notEqual(vars['--c-red-bg'], vars['--c-green-bg']);
});

test('invalid or absent theme values leave CSS defaults untouched', () => {
  const { buildThemeVars, readableFg } = loadThemeModule();
  assert.deepEqual(buildThemeVars(undefined), {});
  assert.deepEqual(buildThemeVars({ surface: 'pink', inputBg: '#123' }), {});
  assert.equal(readableFg('#000000'), '#ffffff');
  assert.equal(readableFg('#ffffff'), '#000000');
});
