'use strict';

function isHistoryEntry(entry) {
  return Boolean(
    entry &&
    typeof entry.outputFilePath === 'string' &&
    entry.outputFilePath.length > 0 &&
    Number.isFinite(entry.completedAt),
  );
}

function normalizeHistoryEntries(value, limit) {
  if (!Array.isArray(value)) return [];
  const byPath = new Map();
  for (const entry of value) {
    if (!isHistoryEntry(entry)) continue;
    byPath.set(entry.outputFilePath, entry);
  }
  return [...byPath.values()]
    .sort((a, b) => a.completedAt - b.completedAt)
    .slice(-limit);
}

function appendHistoryEntry(entries, entry, limit) {
  if (!isHistoryEntry(entry)) return normalizeHistoryEntries(entries, limit);
  return normalizeHistoryEntries(
    [...entries.filter((item) => item?.outputFilePath !== entry.outputFilePath), entry],
    limit,
  );
}

function rebuildMeta(outputFilePath, meta) {
  const parts = outputFilePath.split('/').filter(Boolean);
  if (parts.length < 4 || (parts[0] !== 'outs' && parts[0] !== 'inpaints')) {
    return meta || {};
  }
  const projectName = parts[1];
  const sceneName = parts.slice(2, -1).join('/');
  const sceneType = parts[0] === 'outs' ? 'scene' : 'inpaint';
  return {
    ...(meta || {}),
    sceneKey: `${projectName}/${sceneType}/${sceneName}`,
    sceneName,
  };
}

function rewriteHistoryEntries(entries, oldPath, newPath, limit) {
  const oldPrefix = String(oldPath || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const newPrefix = String(newPath || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!oldPrefix || !newPrefix) return { entries, changed: false };
  if (!['outs/', 'inpaints/'].some((prefix) => oldPrefix.startsWith(prefix))) {
    return { entries, changed: false };
  }
  let changed = false;
  const rewritten = entries.map((entry) => {
    const current = entry.outputFilePath.replace(/\\/g, '/');
    if (current !== oldPrefix && !current.startsWith(oldPrefix + '/')) return entry;
    const outputFilePath = newPrefix + current.slice(oldPrefix.length);
    changed = true;
    return {
      ...entry,
      outputFilePath,
      meta: rebuildMeta(outputFilePath, entry.meta),
    };
  });
  return {
    entries: changed ? normalizeHistoryEntries(rewritten, limit) : entries,
    changed,
  };
}

function removeProjectEntries(entries, projectName) {
  return entries.filter((entry) => {
    const parts = entry.outputFilePath.replace(/\\/g, '/').split('/');
    return parts[1] !== projectName;
  });
}

module.exports = {
  appendHistoryEntry,
  normalizeHistoryEntries,
  removeProjectEntries,
  rewriteHistoryEntries,
};
