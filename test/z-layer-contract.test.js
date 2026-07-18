'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function source(relativePath) {
  return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('global overlay layers have one ordered token ladder', () => {
  const css = source('frontend/src/components/App.css');
  const expected = [
    ['float-view', 100],
    ['widget', 1000],
    ['prompt-back', 1400],
    ['prompt-popup', 1500],
    ['modal', 2000],
    ['drawer-handle', 2050],
    ['drawer', 2100],
    ['feature-modal', 3000],
    ['drive-widget', 4500],
    ['toast', 5000],
    ['confirm', 5100],
    ['context-menu', 5200],
    ['blocking-modal', 5500],
    ['tooltip', 9000],
    ['drag-overlay', 9500],
    ['drag-ghost', 9999],
  ];
  for (const [name, value] of expected) {
    assert.match(css, new RegExp(`--z-${name}: ${value};`));
  }
  assert.deepEqual(expected.map(([, value]) => value), [...expected.map(([, value]) => value)].sort((a, b) => a - b));
});

test('core portals and drawers consume the shared layer tokens', () => {
  assert.match(source('frontend/src/components/contexify.css'), /--contexify-zIndex: var\(--z-context-menu\)/);
  assert.match(source('frontend/src/components/ModalOverlay.tsx'), /zIndex: 'var\(--z-modal\)'/);
  assert.match(source('frontend/src/components/ProjectDrawer.tsx'), /zIndex: 'var\(--z-drawer\)'/);
  assert.match(source('frontend/src/components/ImageHistory.tsx'), /zIndex: 'var\(--z-drawer-handle\)'/);
  assert.match(source('frontend/src/components/Tooltip.tsx'), /zIndex: 'var\(--z-tooltip\)'/);
  assert.match(source('frontend/src/components/PromptEditTextArea.tsx'), /z-\[var\(--z-prompt-popup\)\]/);
});
