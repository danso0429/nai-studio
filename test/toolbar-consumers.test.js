'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (relative) =>
  fs.readFileSync(path.resolve(__dirname, '..', relative), 'utf8');

test('scene and project toolbars consume the shared v2 resolver', () => {
  const scene = read('frontend/src/components/SceneQueueControl.tsx');
  const project = read('frontend/src/components/SessionSelect.tsx');
  for (const source of [scene, project]) {
    assert.match(source, /resolveToolbarView\(/);
    assert.match(source, /appState\.uiToolbar/);
    assert.match(source, /<ToolbarOverflowMenu/);
    assert.match(source, /<DraggableToolbarButton/);
    assert.match(source, /<ToolbarHideZone/);
  }
});

test('toolbar drag has an explicit edit shell and suppresses history swipes', () => {
  const dnd = read('frontend/src/components/ToolbarDnd.tsx');
  const topBar = read('frontend/src/components/TobBar.tsx');
  const app = read('frontend/src/components/App.tsx');
  const history = read('frontend/src/components/ImageHistory.tsx');
  const overflow = read('frontend/src/components/ToolbarOverflowMenu.tsx');
  assert.match(dnd, /moveToolbarButton\(TOOLBAR_VIEW_MAIN/);
  assert.match(dnd, /slot: 'inline'/);
  assert.match(dnd, /slot: 'menu'/);
  assert.match(dnd, /slot="hidden"/);
  assert.match(topBar, /화면 편집/);
  assert.match(app, /<EditModeShell/);
  assert.ok((history.match(/appState\.toolbarDragging/g) ?? []).length >= 4);
  assert.match(overflow, /hidden=\{appState\.toolbarDragging\}/);
});

test('all pre-v5 Remote toolbar actions remain bound to a stable id', () => {
  const scene = read('frontend/src/components/SceneQueueControl.tsx');
  const project = read('frontend/src/components/SessionSelect.tsx');
  for (const id of [
    'add-scene',
    'queue-add',
    'cancel-project-queue',
    'export-images',
    'batch-process',
    'change-resolution',
    'import-image',
    'scene-search',
    'bookmark-jump',
    'scene-trash',
    'reorder-scenes',
    'empty-image-trash',
    'find-replace',
  ]) {
    assert.ok(scene.includes(`'${id}'`), id);
  }
  for (const id of [
    'add-session',
    'character-presets',
    'rename-session',
    'project-browser',
    'media-import',
    'delete-session',
    'piece-editor',
  ]) {
    assert.ok(project.includes(`'${id}'`), id);
  }
  assert.match(scene, /모든 예약\(대기 \+ 준비 중\)을 취소할까요/);
  assert.match(project, /deleteProjectBackground/);
  assert.match(project, /variant\?: 'bar' \| 'sidebar'/);
  assert.match(project, /variant === 'sidebar'/);
});
