'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('../frontend/node_modules/typescript');

function loadLayoutModule() {
  const filename = path.resolve(__dirname, '../frontend/src/models/uiLayout.ts');
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

const layout = loadLayoutModule();
const registries = [
  {
    area: 'scene',
    registry: [
      { id: 'scene-main', name: 'scene main', tier: 'primary' },
      { id: 'scene-more', name: 'scene more', tier: 'secondary' },
      { id: 'portable', name: 'portable', tier: 'overflow', portable: true },
      { id: 'desktop', name: 'desktop', tier: 'primary', pcOnly: true },
    ],
  },
  {
    area: 'project',
    registry: [{ id: 'project-main', name: 'project main', tier: 'primary' }],
  },
];

test('v1 defaults and classic mode preserve the established placement contract', () => {
  assert.deepEqual(layout.resolveToolbar(registries[0].registry, undefined, false), {
    inline: ['scene-main', 'scene-more', 'desktop'],
    menu: ['portable'],
  });
  assert.deepEqual(layout.resolveToolbar(registries[0].registry, undefined, true), {
    inline: ['scene-main'],
    menu: ['scene-more', 'portable'],
  });
  assert.deepEqual(
    layout.resolveToolbar(registries[0].registry, { classic: true }, true),
    { inline: ['scene-main', 'scene-more', 'portable', 'desktop'], menu: [] },
  );
});

test('v2 resolves ordered cross-area portable buttons exactly once', () => {
  const resolved = layout.resolveToolbarView(
    registries,
    {
      schema: 2,
      areas: {
        scene: { inline: ['scene-more', 'scene-main'] },
        project: { inline: ['portable', 'project-main'] },
      },
    },
    false,
  );
  assert.deepEqual(resolved[0].inline, ['scene-more', 'scene-main', 'desktop']);
  assert.deepEqual(resolved[0].menu, []);
  assert.deepEqual(resolved[1].inline, ['portable', 'project-main']);
  assert.equal(resolved.flatMap(({ inline, menu }) => [...inline, ...menu]).filter((id) => id === 'portable').length, 1);
});

test('stale and nonportable cross-area assignments are ignored', () => {
  const resolved = layout.resolveToolbarView(
    registries,
    { areas: { project: { inline: ['scene-main', 'stale', 'project-main'] } } },
    false,
  );
  assert.ok(resolved[0].inline.includes('scene-main'));
  assert.deepEqual(resolved[1].inline, ['project-main']);
});

test('derived exclusion hides companion buttons without mutating config', () => {
  const config = { buttons: { portable: 'pinned' } };
  const before = structuredClone(config);
  const resolved = layout.resolveToolbarView(registries, config, false, new Set(['portable']));
  assert.equal(resolved.flatMap(({ inline, menu }) => [...inline, ...menu]).includes('portable'), false);
  assert.deepEqual(config, before);
});

test('move uses anchors, dual-writes v1 placement, and leaves input immutable', () => {
  const original = { classic: false, buttons: { portable: 'menu' } };
  const before = structuredClone(original);
  const moved = layout.moveToolbarButton(registries, original, {
    id: 'portable',
    toArea: 'project',
    slot: 'inline',
    anchor: { id: 'project-main', side: 'before' },
  });
  assert.deepEqual(original, before);
  assert.equal(moved.schema, 2);
  assert.equal(moved.buttons.portable, 'pinned');
  assert.deepEqual(moved.areas.project.inline, ['portable', 'project-main']);
  const visible = layout.resolveToolbarView(registries, moved, false);
  assert.equal(visible.flatMap(({ inline, menu }) => [...inline, ...menu]).filter((id) => id === 'portable').length, 1);
});

test('move rejects a nonportable cross-area target', () => {
  const original = { buttons: { 'scene-main': 'menu' } };
  assert.equal(
    layout.moveToolbarButton(registries, original, {
      id: 'scene-main',
      toArea: 'project',
      slot: 'inline',
    }),
    original,
  );
});
