const path = require('path');
const fs = require('fs').promises;
const fss = require('fs');
const crypto = require('crypto');

const STORAGE_VERSION = 2;
const STORAGE_MARKER_FILE = 'storage_version.json';
const MIGRATION_LEDGER_FILE = 'migration_ledger.json';
const WORKSPACE_ROOT = 'workspace';
const PROJECT_META_FILE = 'meta.json';
const PROJECT_JSON_FILE = 'project.json';
const PROJECT_ROOTS = Object.freeze([
  'outs',
  'inpaints',
  'inpaint_orgs',
  'inpaint_masks',
  'vibes',
  'references',
]);

function normalizeRelativePath(rawPath) {
  const normalized = String(rawPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.some((part) => part === '.' || part === '..' || part.includes('\0'))) {
    const error = new Error('Path traversal detected');
    error.statusCode = 400;
    throw error;
  }
  return parts.join('/');
}

function invalidProjectName(name) {
  if (typeof name !== 'string' || !name.trim()) return true;
  return name === '.' || name === '..' || name.startsWith('.') || /[\\/\0]/.test(name);
}

function assertProjectName(name) {
  if (invalidProjectName(name)) {
    const error = new Error(`Invalid project name: ${JSON.stringify(name)}`);
    error.statusCode = 400;
    throw error;
  }
}

function assertProjectFolder(folder) {
  if (typeof folder !== 'string' || (folder && normalizeRelativePath(folder) !== folder)) {
    const error = new Error(`Invalid project folder: ${JSON.stringify(folder)}`);
    error.statusCode = 400;
    throw error;
  }
}

function assertWorkspaceDir(dir) {
  if (
    typeof dir !== 'string' || !dir || dir === '.' || dir === '..' ||
    dir.startsWith('.') || /[\\/\0]/.test(dir)
  ) {
    const error = new Error(`Invalid workspace directory: ${JSON.stringify(dir)}`);
    error.statusCode = 400;
    throw error;
  }
}

function makeWorkspaceDirName(name, id) {
  assertProjectName(name);
  const shortId = String(id || '').replace(/-/g, '').slice(0, 8) || 'noid';
  const forbidden = '<>:"/\\|?*';
  let base = '';
  for (const ch of name.normalize('NFC')) {
    if (ch.charCodeAt(0) < 32 || forbidden.includes(ch)) continue;
    base += ch;
  }
  base = base.replace(/\s+/g, ' ').trim().replace(/^[. ]+|[. ]+$/g, '');
  if (base.length > 40) base = base.slice(0, 40).trim().replace(/[. ]+$/g, '');
  if (!base) base = 'project';
  return `${base}__${shortId}`;
}

function classifyDetection(markerExists, hasLegacyProjects, hasWorkspaceData = false) {
  if (hasLegacyProjects) return 'legacy';
  if (!markerExists && hasWorkspaceData) return 'recovery-required';
  return markerExists ? 'active' : 'fresh';
}

function resolveRecoveryName(original, taken) {
  if (!taken.has(original)) return original;
  let index = 2;
  while (taken.has(`${original}_복구${index}`)) index++;
  return `${original}_복구${index}`;
}

function parseProjectFileName(filename) {
  let match = filename.match(/^(.+)\.json\.bak$/i);
  if (match) return { name: match[1], file: `${PROJECT_JSON_FILE}.bak`, kind: 'bak' };
  match = filename.match(/^(.+)\.json\.deleted$/i);
  if (match) return { name: match[1], file: `${PROJECT_JSON_FILE}.deleted`, kind: 'deleted' };
  match = filename.match(/^(.+)\.deleted$/i);
  if (match) return { name: match[1], file: `${PROJECT_JSON_FILE}.deleted`, kind: 'deleted' };
  match = filename.match(/^(.+)\.json$/i);
  if (match) return { name: match[1], file: PROJECT_JSON_FILE, kind: 'active' };
  return null;
}

function parseVirtualProjectPath(rawPath) {
  const normalized = normalizeRelativePath(rawPath);
  const parts = normalized.split('/').filter(Boolean);
  if (parts[0] === 'projects' && parts.length >= 2) {
    const parsed = parseProjectFileName(parts[parts.length - 1]);
    if (!parsed) return null;
    assertProjectName(parsed.name);
    return {
      normalized,
      root: 'projects',
      name: parsed.name,
      folder: parts.slice(1, -1).join('/'),
      rest: [parsed.file],
      kind: parsed.kind,
    };
  }
  if (PROJECT_ROOTS.includes(parts[0]) && parts.length >= 2) {
    assertProjectName(parts[1]);
    return {
      normalized,
      root: parts[0],
      name: parts[1],
      folder: '',
      rest: parts.slice(2),
      kind: 'asset',
    };
  }
  return null;
}

function ledgerKey(folder, name) {
  return `${folder}\u0000${name}`;
}

function validateLedger(ledger) {
  if (!ledger || ledger.version !== 1 || !ledger.projects || typeof ledger.projects !== 'object') {
    throw new Error('invalid migration ledger header');
  }
  const states = new Set(['idle', 'backing-up', 'migrating', 'partial', 'done', 'rolled-back']);
  if (!states.has(ledger.state)) throw new Error(`invalid migration ledger state: ${ledger.state}`);
  for (const [key, item] of Object.entries(ledger.projects)) {
    if (!item || typeof item !== 'object') throw new Error(`invalid migration ledger item: ${key}`);
    assertProjectName(item.originalName);
    assertProjectName(item.logicalName);
    assertProjectFolder(item.folder || '');
    if (key !== ledgerKey(item.folder || '', item.originalName)) {
      throw new Error(`migration ledger key mismatch: ${key}`);
    }
    if (item.dir) assertWorkspaceDir(item.dir);
    if (!['pending', 'moving', 'done', 'failed'].includes(item.state)) {
      throw new Error(`invalid migration project state: ${item.state}`);
    }
    if (item.kind && !['active', 'deleted'].includes(item.kind)) {
      throw new Error(`invalid migration project kind: ${item.kind}`);
    }
    if (item.roots && (typeof item.roots !== 'object' || Array.isArray(item.roots))) {
      throw new Error(`invalid migration project roots: ${item.logicalName}`);
    }
  }
  return ledger;
}

async function atomicWriteFile(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp.${process.pid}.${crypto.randomBytes(4).toString('hex')}`;
  await fs.writeFile(tempPath, data);
  await fs.rename(tempPath, filePath);
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])]),
  );
}

async function jsonFilesEquivalent(first, second) {
  try {
    const [a, b] = await Promise.all([
      fs.readFile(first, 'utf8').then(JSON.parse),
      fs.readFile(second, 'utf8').then(JSON.parse),
    ]);
    return JSON.stringify(canonicalJson(a)) === JSON.stringify(canonicalJson(b));
  } catch {
    return false;
  }
}

async function measureTree(absPath) {
  const stat = await fs.lstat(absPath);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    return { size: stat.size, files: 1, mtimeMs: stat.mtimeMs };
  }
  let size = 0;
  let files = 0;
  let mtimeMs = stat.mtimeMs;
  for (const entry of await fs.readdir(absPath)) {
    const measured = await measureTree(path.join(absPath, entry));
    size += measured.size;
    files += measured.files;
    mtimeMs = Math.max(mtimeMs, measured.mtimeMs);
  }
  return { size, files, mtimeMs };
}

async function walkProjectFiles(projectsDir, maxDepth = 10) {
  const records = [];
  const dirs = [];
  async function walk(absDir, folder, depth) {
    let entries;
    try {
      entries = await fs.readdir(absDir, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (entry.isDirectory()) {
        const childFolder = folder ? `${folder}/${entry.name}` : entry.name;
        dirs.push(childFolder);
        if (depth < maxDepth) await walk(path.join(absDir, entry.name), childFolder, depth + 1);
        continue;
      }
      if (!entry.isFile() || entry.name.endsWith('.json.bak')) continue;
      const parsed = parseProjectFileName(entry.name);
      if (!parsed || (parsed.kind !== 'active' && parsed.kind !== 'deleted')) continue;
      records.push({
        name: parsed.name,
        folder,
        kind: parsed.kind,
        absPath: path.join(absDir, entry.name),
        virtualPath: `projects/${folder ? `${folder}/` : ''}${entry.name}`,
      });
    }
  }
  await walk(projectsDir, '', 0);
  return { records, dirs };
}

class StorageV2 {
  constructor(dataDir) {
    this.dataDir = path.resolve(dataDir);
    this.workspaceDir = path.join(this.dataDir, WORKSPACE_ROOT);
    this.markerPath = path.join(this.dataDir, STORAGE_MARKER_FILE);
    this.ledgerPath = path.join(this.dataDir, MIGRATION_LEDGER_FILE);
    this.active = false;
    this.projectsByName = new Map();
    this.projectsByDir = new Map();
    this.scanWarnings = [];
    this.operation = Promise.resolve();
    this.migrating = false;
    this.migrationIncomplete = false;
    this.partialFallbacks = new Map();
    this.migrationLedgerError = null;
  }

  async initialize() {
    await this.scanWorkspace();
    this.active = await pathExists(this.markerPath);
    try {
      await this.refreshMigrationState();
    } catch (error) {
      this.migrationIncomplete = true;
      this.partialFallbacks.clear();
      this.migrationLedgerError = error.message;
    }
    return await this.status();
  }

  async refreshMigrationState(providedLedger = null) {
    const ledger = providedLedger || await this.loadLedger();
    this.migrationLedgerError = null;
    this.partialFallbacks.clear();
    this.migrationIncomplete = ['backing-up', 'migrating', 'partial'].includes(ledger.state);
    if (!this.migrationIncomplete) return;
    for (const item of Object.values(ledger.projects || {})) {
      if (!item?.dir || item.state === 'done') continue;
      this.partialFallbacks.set(item.logicalName, item);
    }
  }

  async scanWorkspace() {
    this.projectsByName.clear();
    this.projectsByDir.clear();
    this.scanWarnings = [];
    let entries = [];
    try {
      entries = await fs.readdir(this.workspaceDir, { withFileTypes: true });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const metaPath = path.join(this.workspaceDir, entry.name, PROJECT_META_FILE);
      try {
        const meta = JSON.parse(await fs.readFile(metaPath, 'utf8'));
        if (
          meta?.version !== 1 || typeof meta.id !== 'string' || !meta.id ||
          invalidProjectName(meta.name) || typeof meta.folder !== 'string' ||
          (meta.folder && normalizeRelativePath(meta.folder) !== meta.folder)
        ) {
          throw new Error('invalid meta.json');
        }
        if (this.projectsByName.has(meta.name)) {
          throw new Error(`duplicate logical name: ${meta.name}`);
        }
        const record = { ...meta, dir: entry.name };
        this.projectsByName.set(meta.name, record);
        this.projectsByDir.set(entry.name, record);
      } catch (error) {
        this.scanWarnings.push({ dir: entry.name, error: error.message });
      }
    }
  }

  getRecord(name) {
    return this.projectsByName.get(name) || null;
  }

  workspacePath(record, ...segments) {
    return path.join(this.workspaceDir, record.dir, ...segments);
  }

  resolve(rawPath) {
    const normalized = normalizeRelativePath(rawPath);
    const parsed = parseVirtualProjectPath(normalized);
    if (this.active && parsed) {
      const record = this.projectsByName.get(parsed.name);
      if (record) {
        const segments = parsed.root === 'projects'
          ? parsed.rest
          : [parsed.root, ...parsed.rest];
        const workspaceResolved = this.workspacePath(record, ...segments);
        // 원장 재개 전 partial 상태의 *미완료로 기록된 root*만 legacy에서 읽는다.
        // 단순히 동명 legacy 폴더가 있다는 이유로 fallback하면 정상 v2 쓰기가 고아
        // 루트로 되돌아가 split을 만들 수 있다.
        const fallback = this.partialFallbacks.get(parsed.name);
        if (fallback && parsed.root === 'projects') {
          const filename = parsed.kind === 'bak'
            ? `${fallback.originalName}.json.bak`
            : fallback.kind === 'deleted'
              ? `${fallback.originalName}.deleted`
              : `${fallback.originalName}.json`;
          const legacyPath = path.join(
            this.dataDir,
            'projects',
            ...(fallback.folder ? fallback.folder.split('/') : []),
            filename,
          );
          if (fss.existsSync(legacyPath)) return legacyPath;
        }
        if (
          fallback && parsed.root !== 'projects' && fallback.moveImages &&
          fallback.roots?.[parsed.root] !== 'done'
        ) {
          const legacyPath = path.join(
            this.dataDir,
            parsed.root,
            fallback.originalName,
            ...parsed.rest,
          );
          if (fss.existsSync(path.join(this.dataDir, parsed.root, fallback.originalName))) {
            return legacyPath;
          }
        }
        return workspaceResolved;
      }
    }
    const resolved = path.resolve(this.dataDir, normalized);
    if (resolved !== this.dataDir && !resolved.startsWith(this.dataDir + path.sep)) {
      const error = new Error('Path traversal detected');
      error.statusCode = 400;
      throw error;
    }
    return resolved;
  }

  toVirtualPath(absPath) {
    const resolved = path.resolve(absPath);
    if (resolved.startsWith(this.workspaceDir + path.sep)) {
      const rel = path.relative(this.workspaceDir, resolved).split(path.sep);
      const record = this.projectsByDir.get(rel[0]);
      if (record && rel.length >= 2) {
        if (rel[1] === PROJECT_JSON_FILE) {
          return `projects/${record.folder ? `${record.folder}/` : ''}${record.name}.json`;
        }
        if (rel[1] === `${PROJECT_JSON_FILE}.bak`) {
          return `projects/${record.folder ? `${record.folder}/` : ''}${record.name}.json.bak`;
        }
        if (rel[1] === `${PROJECT_JSON_FILE}.deleted`) {
          return `projects/${record.folder ? `${record.folder}/` : ''}${record.name}.deleted`;
        }
        if (PROJECT_ROOTS.includes(rel[1])) {
          return [rel[1], record.name, ...rel.slice(2)].join('/');
        }
      }
    }
    return path.relative(this.dataDir, resolved).split(path.sep).join('/');
  }

  async listLegacyProjects() {
    return await walkProjectFiles(path.join(this.dataDir, 'projects'));
  }

  async listProjects() {
    const legacy = await this.listLegacyProjects();
    const records = [];
    const workspaceNames = new Set();
    if (this.active) {
      for (const record of this.projectsByName.values()) {
        const activePath = this.workspacePath(record, PROJECT_JSON_FILE);
        const deletedPath = this.workspacePath(record, `${PROJECT_JSON_FILE}.deleted`);
        if (await pathExists(activePath)) {
          records.push({
            name: record.name,
            folder: record.folder,
            kind: 'active',
            absPath: activePath,
            virtualPath: `projects/${record.folder ? `${record.folder}/` : ''}${record.name}.json`,
            storage: 'workspace',
          });
          workspaceNames.add(record.name);
        } else if (await pathExists(deletedPath)) {
          records.push({
            name: record.name,
            folder: record.folder,
            kind: 'deleted',
            absPath: deletedPath,
            virtualPath: `projects/${record.folder ? `${record.folder}/` : ''}${record.name}.deleted`,
            storage: 'workspace',
          });
          workspaceNames.add(record.name);
        }
      }
    }
    for (const record of legacy.records) {
      if (!workspaceNames.has(record.name)) records.push({ ...record, storage: 'legacy' });
    }
    return { records, dirs: legacy.dirs };
  }

  async listVirtualProjectDirectory(rawPath, withStats = false) {
    const normalized = normalizeRelativePath(rawPath);
    if (normalized !== 'projects' && !normalized.startsWith('projects/')) return null;
    const folder = normalized === 'projects' ? '' : normalized.slice('projects/'.length);
    const listing = await this.listProjects();
    const children = new Map();
    const addDirectory = (name) => {
      if (name && !children.has(name)) children.set(name, { name, size: 0, mtime: 0 });
    };
    for (const dir of listing.dirs) {
      if (folder && dir !== folder && !dir.startsWith(`${folder}/`)) continue;
      const remainder = folder ? dir.slice(folder.length).replace(/^\//, '') : dir;
      if (remainder) addDirectory(remainder.split('/')[0]);
    }
    for (const record of listing.records) {
      if (record.kind !== 'active') continue;
      if (record.folder === folder) {
        const name = `${record.name}.json`;
        if (!withStats) children.set(name, { name });
        else {
          const stat = await fs.stat(record.absPath).catch(() => null);
          children.set(name, {
            name,
            size: stat?.size || 0,
            mtime: stat?.mtimeMs || 0,
          });
        }
        continue;
      }
      if (!record.folder || (folder && !record.folder.startsWith(`${folder}/`))) continue;
      const remainder = folder
        ? record.folder.slice(folder.length + 1)
        : record.folder;
      addDirectory(remainder.split('/')[0]);
    }
    const values = [...children.values()].sort((a, b) => a.name.localeCompare(b.name));
    return withStats ? values : values.map((entry) => entry.name);
  }

  async listVirtualProjectTree() {
    const listing = await this.listProjects();
    const files = [];
    const dirs = new Set(listing.dirs);
    for (const record of listing.records) {
      if (record.kind !== 'active') continue;
      files.push(`${record.folder ? `${record.folder}/` : ''}${record.name}.json`);
      if (!record.folder) continue;
      const parts = record.folder.split('/');
      for (let index = 1; index <= parts.length; index++) {
        dirs.add(parts.slice(0, index).join('/'));
      }
    }
    return {
      files: files.sort((a, b) => a.localeCompare(b)),
      dirs: [...dirs].sort((a, b) => a.localeCompare(b)),
      truncated: false,
    };
  }

  async findProject(name) {
    const record = this.active ? this.projectsByName.get(name) : null;
    if (record) {
      const activePath = this.workspacePath(record, PROJECT_JSON_FILE);
      if (await pathExists(activePath)) return activePath;
    }
    const listing = await this.listLegacyProjects();
    return listing.records.find((entry) => entry.name === name && entry.kind === 'active')?.absPath || null;
  }

  async status() {
    const markerExists = await pathExists(this.markerPath);
    const legacy = await this.listLegacyProjects();
    let ledger = null;
    let migrationLedgerError = this.migrationLedgerError;
    if (await pathExists(this.ledgerPath)) {
      try {
        ledger = await this.loadLedger();
        migrationLedgerError = null;
        await this.refreshMigrationState(ledger);
      } catch (error) {
        migrationLedgerError = error.message;
        this.migrationLedgerError = migrationLedgerError;
        this.migrationIncomplete = true;
        this.partialFallbacks.clear();
      }
    } else {
      migrationLedgerError = null;
      this.migrationLedgerError = null;
      this.migrationIncomplete = false;
      this.partialFallbacks.clear();
    }
    let legacyCleanupCandidates = 0;
    if (this.active) {
      for (const project of legacy.records) {
        const record = this.projectsByName.get(project.name);
        if (!record) continue;
        const canonical = this.workspacePath(
          record,
          project.kind === 'deleted' ? `${PROJECT_JSON_FILE}.deleted` : PROJECT_JSON_FILE,
        );
        if (await jsonFilesEquivalent(project.absPath, canonical)) legacyCleanupCandidates++;
      }
    }
    return {
      storageVersion: markerExists ? STORAGE_VERSION : 1,
      active: this.active && markerExists,
      detection: classifyDetection(
        markerExists,
        legacy.records.length > 0,
        this.projectsByName.size > 0 || this.scanWarnings.length > 0,
      ),
      legacyProjects: legacy.records.length,
      legacyCleanupCandidates,
      workspaceProjects: this.projectsByName.size,
      scanWarnings: this.scanWarnings.slice(),
      migrationLedgerError,
      migration: ledger ? {
        state: ledger.state,
        startedAt: ledger.startedAt,
        authorizedAt: ledger.authorizedAt,
        backup: ledger.backup || null,
        projects: Object.values(ledger.projects || {}).map((entry) => ({
          name: entry.logicalName,
          state: entry.state,
          error: entry.error || null,
        })),
      } : null,
    };
  }

  async scanLegacyRemnants() {
    if (!this.active) {
      return {
        blocked: { code: 'storage-v2-inactive', count: 0 },
        remnants: [], totalSize: 0, totalFiles: 0, fingerprint: null,
      };
    }
    const legacy = await this.listLegacyProjects();
    if (legacy.records.length > 0) {
      return {
        blocked: { code: 'legacy-projects-present', count: legacy.records.length },
        remnants: [], totalSize: 0, totalFiles: 0, fingerprint: null,
      };
    }
    const remnants = [];
    for (const root of ['projects', ...PROJECT_ROOTS]) {
      const rootPath = path.join(this.dataDir, root);
      if (root === 'projects') {
        async function collectProjectRemnantFiles(absDir, relDir) {
          let entries;
          try {
            entries = await fs.readdir(absDir, { withFileTypes: true });
          } catch (error) {
            if (error.code === 'ENOENT') return;
            throw error;
          }
          for (const entry of entries) {
            const absPath = path.join(absDir, entry.name);
            const relPath = `${relDir}/${entry.name}`;
            if (entry.isDirectory() && !entry.isSymbolicLink()) {
              await collectProjectRemnantFiles(absPath, relPath);
              continue;
            }
            const measured = await measureTree(absPath);
            remnants.push({
              path: relPath,
              isDirectory: false,
              size: measured.size,
              files: measured.files,
              mtimeMs: measured.mtimeMs,
            });
          }
        }
        await collectProjectRemnantFiles(rootPath, 'projects');
        continue;
      }
      let entries;
      try {
        entries = await fs.readdir(rootPath, { withFileTypes: true });
      } catch (error) {
        if (error.code === 'ENOENT') continue;
        throw error;
      }
      for (const entry of entries) {
        const absPath = path.join(rootPath, entry.name);
        const measured = await measureTree(absPath);
        remnants.push({
          path: `${root}/${entry.name}`,
          isDirectory: entry.isDirectory() && !entry.isSymbolicLink(),
          size: measured.size,
          files: measured.files,
          mtimeMs: measured.mtimeMs,
        });
      }
    }
    remnants.sort((a, b) => a.path.localeCompare(b.path));
    const fingerprint = crypto.createHash('sha256')
      .update(JSON.stringify(remnants))
      .digest('hex');
    return {
      blocked: null,
      remnants,
      totalSize: remnants.reduce((total, item) => total + item.size, 0),
      totalFiles: remnants.reduce((total, item) => total + item.files, 0),
      fingerprint,
    };
  }

  async writeMarker() {
    await atomicWriteFile(this.markerPath, JSON.stringify({
      storageVersion: STORAGE_VERSION,
      migratedAt: Date.now(),
    }, null, 2));
    this.active = true;
  }

  async allocateWorkspaceDir(name, id) {
    const base = makeWorkspaceDirName(name, id);
    let candidate = base;
    let index = 2;
    while (
      this.projectsByDir.has(candidate) ||
      await pathExists(path.join(this.workspaceDir, candidate))
    ) {
      candidate = `${base}__${index++}`;
    }
    return candidate;
  }

  async registerProject({ name, folder = '', id = crypto.randomUUID(), dir }) {
    assertProjectName(name);
    assertProjectFolder(folder);
    if (this.projectsByName.has(name)) return this.projectsByName.get(name);
    const physicalDir = dir || await this.allocateWorkspaceDir(name, id);
    assertWorkspaceDir(physicalDir);
    if (this.projectsByDir.has(physicalDir)) throw new Error(`Workspace directory collision: ${physicalDir}`);
    if (await pathExists(path.join(this.workspaceDir, physicalDir))) {
      throw new Error(`Workspace directory already exists without a registered project: ${physicalDir}`);
    }
    const record = { version: 1, id, name, folder, dir: physicalDir };
    await atomicWriteFile(
      path.join(this.workspaceDir, physicalDir, PROJECT_META_FILE),
      JSON.stringify({ version: 1, id, name, folder }, null, 2),
    );
    this.projectsByName.set(name, record);
    this.projectsByDir.set(physicalDir, record);
    return record;
  }

  async updateProjectMeta(record, changes) {
    const previous = { ...record };
    const next = { ...record, ...changes };
    assertProjectName(next.name);
    assertProjectFolder(next.folder);
    if (next.name !== record.name && this.projectsByName.has(next.name)) {
      const error = new Error('Project already exists');
      error.statusCode = 409;
      throw error;
    }
    await atomicWriteFile(
      this.workspacePath(record, PROJECT_META_FILE),
      JSON.stringify({ version: 1, id: next.id, name: next.name, folder: next.folder }, null, 2),
    );
    if (previous.name !== next.name) this.projectsByName.delete(previous.name);
    Object.assign(record, next);
    this.projectsByName.set(next.name, record);
    this.projectsByDir.set(next.dir, record);
    return record;
  }

  async prepareProjectWrite(rawPath, data) {
    if (!this.active) return { path: this.resolve(rawPath), promoted: false, record: null };
    const parsed = parseVirtualProjectPath(rawPath);
    if (!parsed || parsed.root !== 'projects' || parsed.kind !== 'active') {
      return { path: this.resolve(rawPath), promoted: false, record: null };
    }
    let record = this.projectsByName.get(parsed.name);
    let promoted = false;
    if (!record) {
      let id;
      try {
        const project = JSON.parse(String(data || ''));
        if (typeof project?.id === 'string' && project.id) id = project.id;
      } catch {}
      record = await this.registerProject({
        name: parsed.name,
        folder: parsed.folder,
        id: id || crypto.randomUUID(),
      });
      promoted = true;
    }
    // 새 프로젝트의 이미지가 JSON보다 먼저 staging된 경로와, 중간 I/O 실패 뒤 재시도를
    // 모두 같은 seam에서 수습한다. 양쪽에 동시에 실데이터가 있으면 어느 쪽도 지우지 않고
    // split 상태를 표면화한다.
    for (const root of PROJECT_ROOTS) {
      const source = path.join(this.dataDir, root, parsed.name);
      const destination = this.workspacePath(record, root);
      if (await pathExists(source) && await pathExists(destination)) {
        throw new Error(`Cannot promote split project root: ${root}/${parsed.name}`);
      }
    }
    for (const root of PROJECT_ROOTS) {
      const source = path.join(this.dataDir, root, parsed.name);
      if (!(await pathExists(source))) continue;
      await fs.rename(source, this.workspacePath(record, root));
    }
    const legacyBak = path.join(
      this.dataDir,
      'projects',
      ...(parsed.folder ? parsed.folder.split('/') : []),
      `${parsed.name}.json.bak`,
    );
    const workspaceBak = this.workspacePath(record, `${PROJECT_JSON_FILE}.bak`);
    if (await pathExists(legacyBak) && !(await pathExists(workspaceBak))) {
      await fs.rename(legacyBak, workspaceBak);
    }
    return {
      path: this.workspacePath(record, PROJECT_JSON_FILE),
      promoted,
      record,
    };
  }

  async mutateProjectPath(oldRawPath, newRawPath) {
    if (!this.active) return { handled: false };
    const oldParsed = parseVirtualProjectPath(oldRawPath);
    const newParsed = parseVirtualProjectPath(newRawPath);
    if (!oldParsed || !newParsed || oldParsed.root !== 'projects' || newParsed.root !== 'projects') {
      return { handled: false };
    }
    const record = this.projectsByName.get(oldParsed.name);
    if (!record) return { handled: false };
    const oldAbs = this.workspacePath(record, ...oldParsed.rest);
    if (oldParsed.kind !== newParsed.kind) {
      const newAbs = this.workspacePath(record, ...newParsed.rest);
      await fs.rename(oldAbs, newAbs);
      return { handled: true, oldAbs, newAbs, record };
    }
    if (oldParsed.name === newParsed.name && oldParsed.folder === newParsed.folder) {
      return { handled: true, oldAbs, newAbs: oldAbs, record };
    }
    const previous = { name: record.name, folder: record.folder };
    await this.updateProjectMeta(record, { name: newParsed.name, folder: newParsed.folder });
    try {
      if (oldParsed.name !== newParsed.name && newParsed.kind === 'active') {
        const data = JSON.parse(await fs.readFile(oldAbs, 'utf8'));
        data.name = newParsed.name;
        await atomicWriteFile(oldAbs, JSON.stringify(data));
      }
    } catch (error) {
      try {
        await this.updateProjectMeta(record, previous);
      } catch (rollbackError) {
        error.message += `; metadata rollback failed: ${rollbackError.message}`;
      }
      throw error;
    }
    return { handled: true, oldAbs, newAbs: oldAbs, record };
  }

  mutateProjectAssetPath(oldRawPath, newRawPath) {
    if (!this.active) return { handled: false };
    const oldParsed = parseVirtualProjectPath(oldRawPath);
    const newParsed = parseVirtualProjectPath(newRawPath);
    if (
      !oldParsed || !newParsed || oldParsed.kind !== 'asset' || newParsed.kind !== 'asset' ||
      oldParsed.root !== newParsed.root || oldParsed.name === newParsed.name ||
      oldParsed.rest.length !== 0 || newParsed.rest.length !== 0
    ) {
      return { handled: false };
    }
    const record = this.projectsByName.get(oldParsed.name) || this.projectsByName.get(newParsed.name);
    if (!record) return { handled: false };
    const physical = this.workspacePath(record, oldParsed.root);
    return { handled: true, oldAbs: physical, newAbs: physical, record };
  }

  async mutateProjectFolder(oldRawPath, newRawPath) {
    if (!this.active) return { handled: false };
    const oldPath = normalizeRelativePath(oldRawPath);
    const newPath = normalizeRelativePath(newRawPath);
    if (!oldPath.startsWith('projects/') || !newPath.startsWith('projects/')) return { handled: false };
    const oldFolder = oldPath.slice('projects/'.length).replace(/\/$/, '');
    const newFolder = newPath.slice('projects/'.length).replace(/\/$/, '');
    if (!oldFolder || !newFolder) return { handled: false };
    const affected = [...this.projectsByName.values()].filter(
      (record) => record.folder === oldFolder || record.folder.startsWith(`${oldFolder}/`),
    );
    if (affected.length === 0) return { handled: false };
    const changed = [];
    try {
      for (const record of affected) {
        const previousFolder = record.folder;
        const folder = newFolder + previousFolder.slice(oldFolder.length);
        await this.updateProjectMeta(record, { folder });
        changed.push({ record, previousFolder });
      }
    } catch (error) {
      for (const item of changed.reverse()) {
        await this.updateProjectMeta(item.record, { folder: item.previousFolder }).catch(() => {});
      }
      throw error;
    }
    return { handled: true, affected: affected.map((record) => record.name) };
  }

  async removeWorkspaceProject(name) {
    const record = this.projectsByName.get(name);
    if (!record) return null;
    const physicalPath = this.workspacePath(record);
    await fs.rm(physicalPath, { recursive: true, force: false });
    this.projectsByName.delete(name);
    this.projectsByDir.delete(record.dir);
    return {
      record,
      virtualProjectPath: `projects/${record.folder ? `${record.folder}/` : ''}${name}.json`,
    };
  }

  serialize(operation) {
    const run = this.operation.catch(() => {}).then(operation);
    this.operation = run.catch(() => {});
    return run;
  }

  async loadLedger() {
    try {
      const parsed = JSON.parse(await fs.readFile(this.ledgerPath, 'utf8'));
      return validateLedger(parsed);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        const invalid = new Error(`Migration ledger is invalid: ${error.message}`);
        invalid.statusCode = 409;
        throw invalid;
      }
    }
    return {
      version: 1,
      state: 'idle',
      startedAt: Date.now(),
      authorizedAt: null,
      projects: {},
    };
  }

  async saveLedger(ledger) {
    validateLedger(ledger);
    await atomicWriteFile(this.ledgerPath, JSON.stringify(ledger, null, 2));
  }

  async planMigration() {
    const legacy = await this.listLegacyProjects();
    const taken = new Set(this.projectsByName.keys());
    const claimedOriginals = new Set(this.projectsByName.keys());
    const plans = [];
    for (const entry of legacy.records) {
      const logicalName = resolveRecoveryName(entry.name, taken);
      taken.add(logicalName);
      const moveImages = !claimedOriginals.has(entry.name);
      if (moveImages) claimedOriginals.add(entry.name);
      plans.push({ ...entry, logicalName, moveImages });
    }
    return plans;
  }

  async migrate({ authorizedAt, backup = null, onProgress = null } = {}) {
    if (!authorizedAt) {
      const error = new Error('Explicit migration authorization required');
      error.statusCode = 400;
      throw error;
    }
    return await this.serialize(async () => {
      this.migrating = true;
      try {
      const ledger = await this.loadLedger();
      ledger.authorizedAt = ledger.authorizedAt || authorizedAt;
      ledger.startedAt = ledger.startedAt || Date.now();
      ledger.state = backup && !ledger.backup?.done ? 'backing-up' : 'migrating';
      await this.saveLedger(ledger);
      if (backup && !ledger.backup?.done) {
        const file = await backup();
        ledger.backup = { done: true, file, completedAt: Date.now() };
        ledger.state = 'migrating';
        await this.saveLedger(ledger);
      }

      const plans = await this.planMigration();
      const plannedKeys = new Set(plans.map((plan) => ledgerKey(plan.folder, plan.name)));
      for (const [key, item] of Object.entries(ledger.projects || {})) {
        if (item.state === 'done' || plannedKeys.has(key)) continue;
        const kind = item.kind || 'active';
        plans.push({
          name: item.originalName,
          folder: item.folder || '',
          kind,
          absPath: path.join(
            this.dataDir,
            'projects',
            ...(item.folder ? item.folder.split('/') : []),
            kind === 'deleted' ? `${item.originalName}.deleted` : `${item.originalName}.json`,
          ),
          virtualPath: `projects/${item.folder ? `${item.folder}/` : ''}${item.originalName}${kind === 'deleted' ? '.deleted' : '.json'}`,
          logicalName: item.logicalName,
          moveImages: item.moveImages === true,
        });
        plannedKeys.add(key);
      }
      let index = 0;
      for (const plan of plans) {
        index++;
        const key = ledgerKey(plan.folder, plan.name);
        let item = ledger.projects[key];
        if (!item || !item.dir) {
          let project;
          try { project = JSON.parse(await fs.readFile(plan.absPath, 'utf8')); }
          catch (error) {
            ledger.projects[key] = {
              ...(item || {}),
              originalName: plan.name,
              logicalName: item?.logicalName || plan.logicalName,
              folder: plan.folder,
              kind: plan.kind,
              moveImages: item?.moveImages ?? plan.moveImages,
              state: 'failed',
              roots: item?.roots || {},
              error: `project JSON parse failed: ${error.message}`,
            };
            await this.saveLedger(ledger);
            continue;
          }
          const id = typeof project.id === 'string' && project.id ? project.id : crypto.randomUUID();
          item = {
            ...(item || {}),
            originalName: plan.name,
            logicalName: item?.logicalName || plan.logicalName,
            folder: plan.folder,
            id,
            dir: await this.allocateWorkspaceDir(item?.logicalName || plan.logicalName, id),
            kind: plan.kind,
            moveImages: item?.moveImages ?? plan.moveImages,
            state: 'pending',
            roots: item?.roots || {},
          };
          ledger.projects[key] = item;
        }
        if (item.state === 'done') continue;
        item.state = 'moving';
        delete item.error;
        await this.saveLedger(ledger);
        onProgress?.({ index, total: plans.length, name: item.logicalName });
        try {
          let record = this.projectsByName.get(item.logicalName);
          if (!record) {
            record = await this.registerProject({
              name: item.logicalName,
              folder: item.folder,
              id: item.id,
              dir: item.dir,
            });
          }
          if (item.moveImages) {
            for (const root of PROJECT_ROOTS) {
              if (item.roots[root] === 'done') continue;
              const source = path.join(this.dataDir, root, item.originalName);
              const destination = this.workspacePath(record, root);
              if (await pathExists(source)) {
                if (await pathExists(destination)) throw new Error(`migration destination exists: ${root}`);
                await fs.rename(source, destination);
              }
              item.roots[root] = 'done';
              await this.saveLedger(ledger);
            }
          }
          const destination = this.workspacePath(
            record,
            item.kind === 'deleted' ? `${PROJECT_JSON_FILE}.deleted` : PROJECT_JSON_FILE,
          );
          if (await pathExists(plan.absPath)) {
            if (await pathExists(destination)) throw new Error('migration project destination exists');
            await fs.rename(plan.absPath, destination);
          } else if (!(await pathExists(destination))) {
            throw new Error('migration project source and destination are both missing');
          }
          if (item.logicalName !== item.originalName && await pathExists(destination)) {
            const project = JSON.parse(await fs.readFile(destination, 'utf8'));
            project.name = item.logicalName;
            await atomicWriteFile(destination, JSON.stringify(project));
          }
          const oldBak = plan.absPath.replace(/(?:\.json|\.deleted)$/i, '.json.bak');
          const newBak = this.workspacePath(record, `${PROJECT_JSON_FILE}.bak`);
          if (await pathExists(oldBak) && !(await pathExists(newBak))) await fs.rename(oldBak, newBak);
          item.state = 'done';
          await this.saveLedger(ledger);
        } catch (error) {
          item.state = 'failed';
          item.error = error.message;
          await this.saveLedger(ledger);
        }
      }
      ledger.state = Object.values(ledger.projects).some((entry) => entry.state === 'failed')
        ? 'partial'
        : 'done';
      await this.saveLedger(ledger);
      await this.writeMarker();
      await this.scanWorkspace();
      await this.refreshMigrationState(ledger);
      this.active = true;
      return await this.status();
      } finally {
        this.migrating = false;
      }
    });
  }

  async cleanupLegacyCopies({ authorizedAt } = {}) {
    if (!authorizedAt || !this.active) {
      const error = new Error('Explicit legacy cleanup authorization on active storage v2 required');
      error.statusCode = 400;
      throw error;
    }
    return await this.serialize(async () => {
      const listing = await this.listLegacyProjects();
      const removed = [];
      const skipped = [];
      for (const project of listing.records) {
        const record = this.projectsByName.get(project.name);
        const canonical = record && this.workspacePath(
          record,
          project.kind === 'deleted' ? `${PROJECT_JSON_FILE}.deleted` : PROJECT_JSON_FILE,
        );
        if (!canonical || !(await jsonFilesEquivalent(project.absPath, canonical))) {
          skipped.push(project.virtualPath);
          continue;
        }
        await fs.unlink(project.absPath);
        removed.push(project.virtualPath);
        const legacyBak = project.absPath.replace(/(?:\.json|\.deleted)$/i, '.json.bak');
        if (await pathExists(legacyBak)) {
          const workspaceBak = this.workspacePath(record, `${PROJECT_JSON_FILE}.bak`);
          if (await jsonFilesEquivalent(legacyBak, workspaceBak)) {
            await fs.unlink(legacyBak);
            removed.push(path.relative(this.dataDir, legacyBak).split(path.sep).join('/'));
          }
        }
      }
      for (const root of PROJECT_ROOTS) {
        const rootPath = path.join(this.dataDir, root);
        async function removeEmptyChildren(dir) {
          let entries;
          try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
          for (const entry of entries) {
            if (entry.isDirectory()) await removeEmptyChildren(path.join(dir, entry.name));
          }
          if (dir !== rootPath) await fs.rmdir(dir).catch((error) => {
            if (error.code !== 'ENOTEMPTY' && error.code !== 'ENOENT') throw error;
          });
        }
        await removeEmptyChildren(rootPath);
      }
      return { removed, skipped };
    });
  }

  async cleanupLegacyRemnants({ authorizedAt, expectedFingerprint } = {}) {
    if (!authorizedAt || !expectedFingerprint || !this.active) {
      const error = new Error('Explicit legacy remnant cleanup authorization required');
      error.statusCode = 400;
      throw error;
    }
    return await this.serialize(async () => {
      const scan = await this.scanLegacyRemnants();
      if (scan.blocked) {
        const error = new Error(`Legacy remnant cleanup blocked: ${scan.blocked.code}`);
        error.statusCode = 409;
        error.blocked = scan.blocked;
        throw error;
      }
      if (scan.fingerprint !== expectedFingerprint) {
        const error = new Error('Legacy remnants changed after confirmation; scan again');
        error.statusCode = 409;
        throw error;
      }
      for (const item of scan.remnants) {
        const parts = item.path.split('/');
        const validProjectFile = parts[0] === 'projects' && parts.length >= 2 && !item.isDirectory;
        const validProjectRootEntry = PROJECT_ROOTS.includes(parts[0]) && parts.length === 2;
        if (!validProjectFile && !validProjectRootEntry) {
          throw new Error(`Unsafe legacy remnant path: ${item.path}`);
        }
        const absPath = path.resolve(this.dataDir, ...parts);
        if (!absPath.startsWith(this.dataDir + path.sep)) {
          throw new Error(`Unsafe legacy remnant path: ${item.path}`);
        }
      }
      const removed = [];
      const failed = [];
      for (const item of scan.remnants) {
        const parts = item.path.split('/');
        const absPath = path.resolve(this.dataDir, ...parts);
        try {
          await fs.rm(absPath, { recursive: item.isDirectory, force: false });
          removed.push(item.path);
        } catch (error) {
          failed.push({ path: item.path, error: error.message });
        }
      }
      return { removed, failed, fingerprint: scan.fingerprint };
    });
  }

  async rollbackMigration({ authorizedAt } = {}) {
    if (!authorizedAt || !this.active) {
      const error = new Error('Explicit storage rollback authorization required');
      error.statusCode = 400;
      throw error;
    }
    return await this.serialize(async () => {
      this.migrating = true;
      try {
        const ledger = await this.loadLedger();
        const migratory = Object.values(ledger.projects || {}).filter((entry) => entry.dir);
        const ledgerDirs = new Set(migratory.map((entry) => entry.dir));
        let workspaceEntries = [];
        try {
          workspaceEntries = await fs.readdir(this.workspaceDir, { withFileTypes: true });
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
        const unexpectedWorkspaceEntries = workspaceEntries.filter(
          (entry) => !entry.isDirectory() || !ledgerDirs.has(entry.name),
        );
        if (unexpectedWorkspaceEntries.length > 0) {
          throw new Error(
            `Rollback blocked by untracked workspace data: ${unexpectedWorkspaceEntries[0].name}`,
          );
        }
        const allowedEntries = new Set([
          PROJECT_META_FILE,
          PROJECT_JSON_FILE,
          `${PROJECT_JSON_FILE}.bak`,
          `${PROJECT_JSON_FILE}.deleted`,
          ...PROJECT_ROOTS,
        ]);
        for (const item of migratory) {
          const projectDir = path.join(this.workspaceDir, item.dir);
          if (await pathExists(projectDir)) {
            const entries = await fs.readdir(projectDir);
            const unknown = entries.filter((entry) => !allowedEntries.has(entry));
            if (unknown.length > 0) {
              throw new Error(`Rollback blocked by unknown workspace data: ${item.dir}/${unknown[0]}`);
            }
          }
          const record = this.projectsByDir.get(item.dir) || {
            dir: item.dir,
            name: item.logicalName,
            folder: item.folder,
          };
          const projectTarget = path.join(
            this.dataDir,
            'projects',
            ...(item.folder ? item.folder.split('/') : []),
            item.kind === 'deleted' ? `${item.originalName}.deleted` : `${item.originalName}.json`,
          );
          const projectSource = this.workspacePath(
            record,
            item.kind === 'deleted' ? `${PROJECT_JSON_FILE}.deleted` : PROJECT_JSON_FILE,
          );
          if (await pathExists(projectSource) && await pathExists(projectTarget)) {
            throw new Error(`Rollback destination exists: ${projectTarget}`);
          }
          const workspaceBak = this.workspacePath(record, `${PROJECT_JSON_FILE}.bak`);
          const legacyBak = projectTarget.replace(/(?:\.json|\.deleted)$/i, '.json.bak');
          if (await pathExists(workspaceBak) && await pathExists(legacyBak)) {
            throw new Error(`Rollback backup destination exists: ${legacyBak}`);
          }
          if (item.moveImages) {
            for (const root of PROJECT_ROOTS) {
              const source = this.workspacePath(record, root);
              const destination = path.join(this.dataDir, root, item.originalName);
              if (await pathExists(source) && await pathExists(destination)) {
                throw new Error(`Rollback destination exists: ${root}/${item.originalName}`);
              }
            }
          }
        }
        const restored = [];
        for (const item of migratory.slice().reverse()) {
          const record = this.projectsByDir.get(item.dir) || {
            dir: item.dir,
            name: item.logicalName,
            folder: item.folder,
          };
          const projectSource = this.workspacePath(
            record,
            item.kind === 'deleted' ? `${PROJECT_JSON_FILE}.deleted` : PROJECT_JSON_FILE,
          );
          const projectTarget = path.join(
            this.dataDir,
            'projects',
            ...(item.folder ? item.folder.split('/') : []),
            item.kind === 'deleted' ? `${item.originalName}.deleted` : `${item.originalName}.json`,
          );
          if (item.moveImages) {
            for (const root of PROJECT_ROOTS) {
              const source = this.workspacePath(record, root);
              if (!(await pathExists(source))) continue;
              const destination = path.join(this.dataDir, root, item.originalName);
              await fs.mkdir(path.dirname(destination), { recursive: true });
              await fs.rename(source, destination);
            }
          }
          if (await pathExists(projectSource)) {
            try {
              const project = JSON.parse(await fs.readFile(projectSource, 'utf8'));
              project.name = item.originalName;
              await atomicWriteFile(projectSource, JSON.stringify(project));
            } catch (error) {
              if (!(error instanceof SyntaxError)) throw error;
            }
            await fs.mkdir(path.dirname(projectTarget), { recursive: true });
            await fs.rename(projectSource, projectTarget);
          }
          const workspaceBak = this.workspacePath(record, `${PROJECT_JSON_FILE}.bak`);
          if (await pathExists(workspaceBak)) {
            await fs.rename(workspaceBak, projectTarget.replace(/(?:\.json|\.deleted)$/i, '.json.bak'));
          }
          await fs.unlink(this.workspacePath(record, PROJECT_META_FILE)).catch(() => {});
          if (await pathExists(this.workspacePath(record))) {
            await fs.rmdir(this.workspacePath(record));
          }
          if (await pathExists(projectTarget)) restored.push(item.originalName);
        }
        await fs.unlink(this.markerPath).catch((error) => {
          if (error.code !== 'ENOENT') throw error;
        });
        ledger.state = 'rolled-back';
        ledger.rolledBackAt = Date.now();
        await this.saveLedger(ledger);
        this.active = false;
        await this.refreshMigrationState(ledger);
        await this.scanWorkspace();
        return { restored };
      } finally {
        this.migrating = false;
      }
    });
  }
}

module.exports = {
  StorageV2,
  STORAGE_VERSION,
  STORAGE_MARKER_FILE,
  MIGRATION_LEDGER_FILE,
  WORKSPACE_ROOT,
  PROJECT_META_FILE,
  PROJECT_JSON_FILE,
  PROJECT_ROOTS,
  normalizeRelativePath,
  makeWorkspaceDirName,
  classifyDetection,
  resolveRecoveryName,
  parseVirtualProjectPath,
  walkProjectFiles,
};
