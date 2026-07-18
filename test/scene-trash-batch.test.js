'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.resolve(__dirname, '../frontend/src/components/SceneQueueControl.tsx'),
  'utf8',
);

test('scene trash bulk deletion requires explicit confirmation and blocks interaction while running', () => {
  assert.match(source, /confirmText: '모두 영구 삭제'/);
  assert.match(source, /const targets = \[\.\.\.deletedScenes\]/);
  assert.match(source, /blockingProgress && \(/);
  assert.match(source, /className="fixed inset-0 flex items-center justify-center/);
  assert.match(source, /finally \{\s*setBlockingProgress\(undefined\);/);
});

test('scene trash bulk deletion reports partial failures instead of claiming full success', () => {
  assert.match(source, /let failed = 0/);
  assert.match(source, /failed\+\+/);
  assert.match(source, /씬 \$\{targets\.length - failed\}개를 영구 삭제했고/);
});
