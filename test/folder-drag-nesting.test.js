'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const drawer = fs.readFileSync(
  path.resolve(__dirname, '../frontend/src/components/ProjectDrawer.tsx'),
  'utf8',
);
const service = fs.readFileSync(
  path.resolve(__dirname, '../frontend/src/models/SessionService.ts'),
  'utf8',
);

test('folder drag distinguishes sibling reorder, nesting, and top-level extraction', () => {
  assert.match(drawer, /const sourceParent = parentOfFolder\(d\.name\)/);
  assert.match(drawer, /await sessionService\.moveFolder\(d\.name, targetFolder\)/);
  assert.match(drawer, /await sessionService\.moveFolder\(d\.name, null\)/);
  assert.match(drawer, /data-nest-folder=\{f\}/);
  assert.match(drawer, /targetFolder\.startsWith\(d\.name \+ '\/'\)/);
  assert.match(drawer, /dragStartTimerRef\.current = setTimeout/);
  assert.match(drawer, /clearTimeout\(dragStartTimerRef\.current\)/);
});

test('folder move service remains the final cycle, collision, and depth guard', () => {
  assert.match(service, /newParent\.startsWith\(folderPath \+ '\/'\)/);
  assert.match(service, /대상 위치에 같은 이름의 폴더가 이미 있어요/);
  assert.match(service, /if \(newDeepest > MAX_FOLDER_DEPTH\)/);
});
