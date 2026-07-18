'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  dirDeleteViolation,
  assertDeletableDataDirPath,
  projectDeleteViolation,
  assertDeletableProjectName,
} = require('../lib/data-path-guard');

test('recursive delete permits scoped child directories', () => {
  for (const input of [
    'projects/folder',
    'projects/folder/child',
    'outs/project/scene',
    'tmp/job-id',
    'custom-root/child',
  ]) {
    assert.equal(dirDeleteViolation(input), null, input);
    assert.doesNotThrow(() => assertDeletableDataDirPath(input));
  }
});

test('recursive delete rejects data roots and ambiguous paths', () => {
  for (const input of [
    '',
    '   ',
    '.',
    '..',
    'projects',
    'projects/',
    '/projects/',
    'outs',
    'tmp',
    'projects/../outs',
    'projects//child',
    'projects\\..\\outs',
  ]) {
    assert.ok(dirDeleteViolation(input), input);
    assert.throws(
      () => assertDeletableDataDirPath(input),
      (error) => error?.code === 'DATA_PATH_GUARD',
      input,
    );
  }
});

test('recursive delete rejects non-string paths', () => {
  for (const input of [undefined, null, 42, {}, []]) {
    assert.equal(dirDeleteViolation(input), 'path is not a string');
  }
});

test('permanent project deletion requires a non-empty basename', () => {
  for (const name of ['project', '프로젝트 1', ' name with spaces ']) {
    assert.equal(projectDeleteViolation(name), null, name);
    assert.doesNotThrow(() => assertDeletableProjectName(name));
  }
  for (const name of ['', '   ', '.', '..', '.hidden', 'folder/name', 'folder\\name', null]) {
    assert.ok(projectDeleteViolation(name), String(name));
    assert.throws(
      () => assertDeletableProjectName(name),
      (error) => error?.code === 'DATA_PATH_GUARD',
      String(name),
    );
  }
});
