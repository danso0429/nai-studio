'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(
  path.resolve(__dirname, '../frontend/src/components/App.css'),
  'utf8',
);

test('custom themes bridge legacy neutral inputs and text to semantic tokens', () => {
  assert.match(css, /\.custom-theme input\.bg-white/);
  assert.match(css, /background-color: var\(--c-input-bg\) !important/);
  assert.match(css, /\.custom-theme \.text-gray-900/);
  assert.match(css, /color: var\(--c-text-label\) !important/);
});

test('shared button language includes focus, disabled, solid, ghost, and link states', () => {
  for (const selector of [
    '.btn:focus-visible',
    '.btn:disabled',
    '.btn-solid-sky',
    '.btn-solid-green',
    '.btn-solid-red',
    '.btn-ghost',
    '.btn-link',
  ]) {
    assert.ok(css.includes(selector), selector);
  }
});

test('appearance roles support strong controls, input rings, font choice, and classic rollback', () => {
  const config = fs.readFileSync(
    path.resolve(__dirname, '../frontend/src/main/config.ts'),
    'utf8',
  );
  const app = fs.readFileSync(
    path.resolve(__dirname, '../frontend/src/components/App.tsx'),
    'utf8',
  );
  assert.match(css, /--c-line-strong:/);
  assert.match(css, /--c-input-ring:/);
  assert.match(css, /html\.finish-classic/);
  assert.match(css, /html\.font-system body/);
  assert.match(config, /uiFont\?: 'noto' \| 'system'/);
  assert.match(config, /uiClassicFinish\?: boolean/);
  assert.match(app, /classList\.toggle\('finish-classic'/);
});
