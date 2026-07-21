'use strict';

// deleteDir의 최종 관문. 개별 기능의 이름 검증이 빠져도 데이터 루트 자체는
// recursive delete에 들어가지 못하게 한다. 하위 경로는 기존 기능 호환을 위해 허용한다.
const PROTECTED_DATA_ROOTS = new Set([
  'projects',
  'outs',
  'inpaints',
  'vibes',
  'inpaint_masks',
  'inpaint_orgs',
  'references',
  'workspace',
  'exports',
  'artist_library',
  'tmp',
]);

function dirDeleteViolation(inputPath) {
  if (typeof inputPath !== 'string') return 'path is not a string';
  const normalized = inputPath
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '');
  if (!normalized.trim()) return 'empty path';

  const segments = normalized.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return 'invalid path segment';
  }
  if (segments.length === 1 && PROTECTED_DATA_ROOTS.has(segments[0])) {
    return 'protected data root';
  }
  return null;
}

function assertDeletableDataDirPath(inputPath) {
  const violation = dirDeleteViolation(inputPath);
  if (violation) {
    const error = new Error(
      `Directory deletion denied (${violation}): ${JSON.stringify(inputPath)}`,
    );
    error.code = 'DATA_PATH_GUARD';
    throw error;
  }
}

function projectDeleteViolation(name) {
  if (typeof name !== 'string') return 'name is not a string';
  if (!name.trim()) return 'empty project name';
  if (name === '.' || name === '..' || name.startsWith('.')) return 'reserved project name';
  if (name.includes('/') || name.includes('\\')) return 'project name contains a path separator';
  return null;
}

function assertDeletableProjectName(name) {
  const violation = projectDeleteViolation(name);
  if (!violation) return;
  const error = new Error(
    `Project deletion denied (${violation}): ${JSON.stringify(name)}`,
  );
  error.code = 'DATA_PATH_GUARD';
  throw error;
}

module.exports = {
  dirDeleteViolation,
  assertDeletableDataDirPath,
  projectDeleteViolation,
  assertDeletableProjectName,
};
