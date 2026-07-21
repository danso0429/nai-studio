const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs').promises;
const fss = require('node:fs');
const {
  StorageV2,
  makeWorkspaceDirName,
  classifyDetection,
  resolveRecoveryName,
  parseVirtualProjectPath,
} = require('../lib/storage-v2');

const readSource = (relative) => fss.readFileSync(path.resolve(__dirname, '..', relative), 'utf8');

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nai-storage-v2-'));
  await fs.mkdir(path.join(root, 'projects'), { recursive: true });
  return { root, storage: new StorageV2(root) };
}

test('storage v2 pure naming and detection rules are deterministic', () => {
  assert.equal(classifyDetection(false, false), 'fresh');
  assert.equal(classifyDetection(true, false), 'active');
  assert.equal(classifyDetection(true, true), 'legacy');
  assert.equal(classifyDetection(false, false, true), 'recovery-required');
  assert.equal(makeWorkspaceDirName(' a:b한글 ', '12345678-abcd'), 'ab한글__12345678');
  const taken = new Set(['A', 'A_복구2']);
  assert.equal(resolveRecoveryName('A', taken), 'A_복구3');
});

test('virtual project paths preserve logical folder and map project suffixes', () => {
  assert.deepEqual(parseVirtualProjectPath('projects/a/b/P.json'), {
    normalized: 'projects/a/b/P.json', root: 'projects', name: 'P', folder: 'a/b',
    rest: ['project.json'], kind: 'active',
  });
  assert.equal(parseVirtualProjectPath('projects/P.deleted').rest[0], 'project.json.deleted');
  assert.deepEqual(parseVirtualProjectPath('outs/P/scene/x.webp').rest, ['scene', 'x.webp']);
  assert.throws(() => parseVirtualProjectPath('outs/P/../Q/x.png'), /traversal/i);
});

test('active workspace resolves logical paths and reverses physical paths', async (t) => {
  const { root, storage } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const record = await storage.registerProject({ name: 'P', folder: 'a', id: '12345678-abcd' });
  await storage.writeMarker();
  await storage.initialize();
  const projectPath = storage.resolve('projects/a/P.json');
  const imagePath = storage.resolve('outs/P/scene/x.png');
  assert.equal(projectPath, path.join(root, 'workspace', record.dir, 'project.json'));
  assert.equal(imagePath, path.join(root, 'workspace', record.dir, 'outs', 'scene', 'x.png'));
  assert.equal(storage.toVirtualPath(imagePath), 'outs/P/scene/x.png');
});

test('workspace project rename and folder move update meta without moving physical directory', async (t) => {
  const { root, storage } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const record = await storage.registerProject({ name: 'Old', folder: 'before', id: '12345678-abcd' });
  const projectPath = storage.workspacePath(record, 'project.json');
  await fs.writeFile(projectPath, JSON.stringify({ name: 'Old', scenes: {} }));
  await storage.writeMarker();
  storage.active = true;
  const physicalDir = record.dir;
  const result = await storage.mutateProjectPath(
    'projects/before/Old.json',
    'projects/after/New.json',
  );
  assert.equal(result.handled, true);
  assert.equal(record.dir, physicalDir);
  assert.equal(storage.getRecord('Old'), null);
  assert.equal(storage.getRecord('New').folder, 'after');
  assert.equal(JSON.parse(await fs.readFile(projectPath, 'utf8')).name, 'New');
});

test('project root rename is logical-only while workspace storage is active', async (t) => {
  const { root, storage } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const record = await storage.registerProject({ name: 'Old', folder: '', id: '12345678-abcd' });
  await storage.writeMarker();
  storage.active = true;
  const mutation = storage.mutateProjectAssetPath('outs/Old', 'outs/New');
  assert.equal(mutation.handled, true);
  assert.equal(mutation.oldAbs, storage.workspacePath(record, 'outs'));
  assert.equal(mutation.newAbs, mutation.oldAbs);
  assert.equal(storage.mutateProjectAssetPath('outs/Old/scene', 'outs/New/scene').handled, false);
});

test('workspace rename rolls metadata back when project JSON cannot be rewritten', async (t) => {
  const { root, storage } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const record = await storage.registerProject({ name: 'Old', folder: 'before', id: '12345678-abcd' });
  await fs.writeFile(storage.workspacePath(record, 'project.json'), '{broken');
  await storage.writeMarker();
  storage.active = true;
  await assert.rejects(
    () => storage.mutateProjectPath('projects/before/Old.json', 'projects/after/New.json'),
    SyntaxError,
  );
  assert.equal(storage.getRecord('Old'), record);
  assert.equal(storage.getRecord('New'), null);
  assert.equal(record.folder, 'before');
  assert.equal(JSON.parse(await fs.readFile(storage.workspacePath(record, 'meta.json'), 'utf8')).name, 'Old');
});

test('workspace projects are exposed through the legacy logical tree', async (t) => {
  const { root, storage } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const record = await storage.registerProject({ name: 'P', folder: 'a/b', id: '12345678-abcd' });
  await fs.writeFile(storage.workspacePath(record, 'project.json'), '{}');
  await storage.writeMarker();
  storage.active = true;
  assert.deepEqual(await storage.listVirtualProjectDirectory('projects'), ['a']);
  assert.deepEqual(await storage.listVirtualProjectDirectory('projects/a'), ['b']);
  assert.deepEqual(await storage.listVirtualProjectDirectory('projects/a/b'), ['P.json']);
  assert.deepEqual(await storage.listVirtualProjectTree(), {
    files: ['a/b/P.json'], dirs: ['a', 'a/b'], truncated: false,
  });
});

test('first project JSON write on active storage promotes staged legacy assets', async (t) => {
  const { root, storage } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await storage.writeMarker();
  storage.active = true;
  await fs.mkdir(path.join(root, 'vibes', 'New'), { recursive: true });
  await fs.writeFile(path.join(root, 'vibes', 'New', 'v.png'), 'v');
  const prepared = await storage.prepareProjectWrite(
    'projects/f/New.json',
    JSON.stringify({ name: 'New', id: 'project-uuid-1234' }),
  );
  assert.equal(prepared.promoted, true);
  assert.equal(prepared.record.folder, 'f');
  assert.equal(prepared.record.id, 'project-uuid-1234');
  assert.equal(
    JSON.parse(await fs.readFile(storage.workspacePath(prepared.record, 'meta.json'), 'utf8')).id,
    'project-uuid-1234',
  );
  assert.equal(await fs.readFile(storage.resolve('vibes/New/v.png'), 'utf8'), 'v');
  assert.equal(await fs.stat(path.dirname(prepared.path)).then((value) => value.isDirectory()), true);
});

test('workspace registration refuses an unindexed physical directory collision', async (t) => {
  const { root, storage } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const dir = makeWorkspaceDirName('P', '12345678-abcd');
  await fs.mkdir(path.join(root, 'workspace', dir), { recursive: true });
  await assert.rejects(
    () => storage.registerProject({ name: 'P', id: '12345678-abcd', dir }),
    /already exists without a registered project/i,
  );
});

test('workspace registration allocates a stable suffix around an existing derived directory', async (t) => {
  const { root, storage } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const base = makeWorkspaceDirName('P', '12345678-abcd');
  await fs.mkdir(path.join(root, 'workspace', base), { recursive: true });
  const record = await storage.registerProject({ name: 'P', id: '12345678-abcd' });
  assert.equal(record.dir, `${base}__2`);
});

test('partial migration reads an unmoved root from legacy until resume', async (t) => {
  const { root, storage } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const record = await storage.registerProject({ name: 'P', folder: '', id: '12345678-abcd' });
  await storage.writeMarker();
  storage.active = true;
  await fs.mkdir(path.join(root, 'references', 'P'), { recursive: true });
  await fs.writeFile(path.join(root, 'references', 'P', 'r.png'), 'r');
  await storage.saveLedger({
    version: 1,
    state: 'partial',
    startedAt: 1,
    authorizedAt: 1,
    projects: {
      ['\0P']: {
        originalName: 'P', logicalName: 'P', folder: '', id: record.id, dir: record.dir,
        kind: 'active', moveImages: true, state: 'failed', roots: {},
      },
    },
  });
  await storage.refreshMigrationState();
  assert.equal(storage.resolve('references/P/r.png'), path.join(root, 'references', 'P', 'r.png'));
  await fs.mkdir(storage.workspacePath(record, 'outs'), { recursive: true });
  assert.equal(storage.resolve('outs/P/x.png'), storage.workspacePath(record, 'outs', 'x.png'));
});

test('an untracked legacy orphan never redirects a normal workspace write', async (t) => {
  const { root, storage } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const record = await storage.registerProject({ name: 'P', folder: '', id: '12345678-abcd' });
  await storage.writeMarker();
  storage.active = true;
  await fs.mkdir(path.join(root, 'outs', 'P'), { recursive: true });
  assert.equal(storage.resolve('outs/P/new.png'), storage.workspacePath(record, 'outs', 'new.png'));
});

test('a corrupted migration ledger fails closed without exposing a fallback path', async (t) => {
  const { root, storage } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'migration_ledger.json'), JSON.stringify({
    version: 1,
    state: 'partial',
    projects: {
      bad: {
        originalName: '../escape', logicalName: 'P', folder: '', dir: '../../escape',
        state: 'failed', roots: {},
      },
    },
  }));
  const status = await storage.initialize();
  assert.match(status.migrationLedgerError, /invalid/i);
  assert.equal(storage.migrationIncomplete, true);
  assert.equal(storage.partialFallbacks.size, 0);
  await assert.rejects(() => storage.migrate({ authorizedAt: 1 }), /invalid/i);
});

test('workspace project removal deletes only its fixed physical directory', async (t) => {
  const { root, storage } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const first = await storage.registerProject({ name: 'A', folder: '', id: 'aaaaaaaa-1' });
  const second = await storage.registerProject({ name: 'B', folder: '', id: 'bbbbbbbb-1' });
  await fs.writeFile(storage.workspacePath(first, 'project.json'), '{}');
  await fs.writeFile(storage.workspacePath(second, 'project.json'), '{}');
  const removed = await storage.removeWorkspaceProject('A');
  assert.equal(removed.virtualProjectPath, 'projects/A.json');
  assert.equal(await fs.stat(storage.workspacePath(second)).then((value) => value.isDirectory()), true);
  assert.equal(storage.getRecord('A'), null);
});

test('authorized migration is restart-ledgered and activates workspace', async (t) => {
  const { root, storage } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'projects', 'folder'), { recursive: true });
  await fs.writeFile(path.join(root, 'projects', 'folder', 'P.json'), JSON.stringify({ name: 'P' }));
  await fs.mkdir(path.join(root, 'outs', 'P', 'scene'), { recursive: true });
  await fs.writeFile(path.join(root, 'outs', 'P', 'scene', 'x.png'), 'x');
  await storage.initialize();
  await assert.rejects(() => storage.migrate(), /authorization/i);
  const status = await storage.migrate({ authorizedAt: 123 });
  assert.equal(status.active, true);
  assert.equal(status.workspaceProjects, 1);
  const projectPath = await storage.findProject('P');
  assert.equal(JSON.parse(await fs.readFile(projectPath, 'utf8')).name, 'P');
  assert.equal(await fs.readFile(storage.resolve('outs/P/scene/x.png'), 'utf8'), 'x');
  assert.equal((await storage.loadLedger()).state, 'done');
});

test('same-name legacy projects receive distinct logical names and matching JSON names', async (t) => {
  const { root, storage } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const folder of ['a', 'b']) {
    await fs.mkdir(path.join(root, 'projects', folder), { recursive: true });
    await fs.writeFile(
      path.join(root, 'projects', folder, 'P.json'),
      JSON.stringify({ id: 'same-project-id', name: 'P', folder }),
    );
  }
  await storage.initialize();
  const status = await storage.migrate({ authorizedAt: 1 });
  assert.equal(status.migration.state, 'done');
  const listing = await storage.listProjects();
  assert.deepEqual(listing.records.map((entry) => entry.name).sort(), ['P', 'P_복구2']);
  for (const entry of listing.records) {
    assert.equal(JSON.parse(await fs.readFile(entry.absPath, 'utf8')).name, entry.name);
  }
});

test('migration resumes a failed ledger item after its project JSON already moved', async (t) => {
  const { root, storage } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const record = await storage.registerProject({ name: 'P', folder: '', id: '12345678-abcd' });
  await fs.writeFile(storage.workspacePath(record, 'project.json'), JSON.stringify({ name: 'P' }));
  await storage.saveLedger({
    version: 1,
    state: 'partial',
    startedAt: 1,
    authorizedAt: 1,
    projects: {
      ['\0P']: {
        originalName: 'P', logicalName: 'P', folder: '', id: record.id, dir: record.dir,
        kind: 'active', moveImages: true, state: 'failed', roots: {}, error: 'interrupted',
      },
    },
  });
  await storage.writeMarker();
  await storage.initialize();
  const status = await storage.migrate({ authorizedAt: 2 });
  assert.equal(status.migration.state, 'done');
  assert.equal((await storage.loadLedger()).projects['\0P'].state, 'done');
});

test('a parse-failed legacy project can be repaired and resumed with ledger metadata', async (t) => {
  const { root, storage } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const legacy = path.join(root, 'projects', 'P.json');
  await fs.writeFile(legacy, '{broken');
  await storage.initialize();
  assert.equal((await storage.migrate({ authorizedAt: 1 })).migration.state, 'partial');
  await fs.writeFile(legacy, JSON.stringify({ id: '12345678-abcd', name: 'P' }));
  const status = await storage.migrate({ authorizedAt: 2 });
  assert.equal(status.migration.state, 'done');
  const item = (await storage.loadLedger()).projects['\0P'];
  assert.equal(item.dir, makeWorkspaceDirName('P', '12345678-abcd'));
  assert.equal(item.state, 'done');
});

test('legacy cleanup and rollback each require separate authorization', async (t) => {
  const { root, storage } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'projects', 'P.json'), JSON.stringify({ name: 'P' }));
  await storage.initialize();
  await storage.migrate({ authorizedAt: 1 });
  await assert.rejects(() => storage.cleanupLegacyCopies(), /authorization/i);
  const cleanup = await storage.cleanupLegacyCopies({ authorizedAt: 2 });
  assert.deepEqual(cleanup.removed, []);
  await assert.rejects(() => storage.rollbackMigration(), /authorization/i);
  const rollback = await storage.rollbackMigration({ authorizedAt: 3 });
  assert.deepEqual(rollback.restored, ['P']);
  assert.equal(JSON.parse(await fs.readFile(path.join(root, 'projects', 'P.json'), 'utf8')).name, 'P');
  assert.equal((await storage.status()).active, false);
});

test('rollback resumes a partial migration without overwriting legacy data', async (t) => {
  const { root, storage } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const record = await storage.registerProject({ name: 'P', folder: '', id: '12345678-abcd' });
  await fs.writeFile(path.join(root, 'projects', 'P.json'), JSON.stringify({ name: 'P' }));
  await fs.mkdir(storage.workspacePath(record, 'outs'), { recursive: true });
  await fs.writeFile(storage.workspacePath(record, 'outs', 'x.png'), 'x');
  await storage.saveLedger({
    version: 1,
    state: 'partial',
    startedAt: 1,
    authorizedAt: 1,
    projects: {
      ['\0P']: {
        originalName: 'P', logicalName: 'P', folder: '', id: record.id, dir: record.dir,
        kind: 'active', moveImages: true, state: 'failed', roots: { outs: 'done' },
      },
    },
  });
  await storage.writeMarker();
  storage.active = true;
  const result = await storage.rollbackMigration({ authorizedAt: 2 });
  assert.deepEqual(result.restored, ['P']);
  assert.equal(await fs.readFile(path.join(root, 'outs', 'P', 'x.png'), 'utf8'), 'x');
  assert.equal((await storage.status()).active, false);
});

test('legacy cleanup removes only a JSON-equivalent workspace counterpart', async (t) => {
  const { root, storage } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const record = await storage.registerProject({ name: 'P', folder: '', id: '12345678-abcd' });
  const canonical = storage.workspacePath(record, 'project.json');
  const legacy = path.join(root, 'projects', 'P.json');
  await fs.writeFile(canonical, JSON.stringify({ name: 'P', nested: { b: 2, a: 1 } }));
  await fs.writeFile(legacy, JSON.stringify({ nested: { a: 1, b: 2 }, name: 'P' }, null, 2));
  await storage.writeMarker();
  storage.active = true;
  assert.equal((await storage.status()).legacyCleanupCandidates, 1);
  const cleanup = await storage.cleanupLegacyCopies({ authorizedAt: 1 });
  assert.deepEqual(cleanup.removed, ['projects/P.json']);
  await assert.rejects(() => fs.access(legacy), { code: 'ENOENT' });
  assert.equal(JSON.parse(await fs.readFile(canonical, 'utf8')).name, 'P');
});

test('legacy cleanup preserves a same-name project whose JSON differs', async (t) => {
  const { root, storage } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const record = await storage.registerProject({ name: 'P', folder: '', id: '12345678-abcd' });
  await fs.writeFile(storage.workspacePath(record, 'project.json'), JSON.stringify({ name: 'P', revision: 2 }));
  const legacy = path.join(root, 'projects', 'P.json');
  await fs.writeFile(legacy, JSON.stringify({ name: 'P', revision: 1 }));
  await storage.writeMarker();
  storage.active = true;
  assert.equal((await storage.status()).legacyCleanupCandidates, 0);
  const cleanup = await storage.cleanupLegacyCopies({ authorizedAt: 1 });
  assert.deepEqual(cleanup.removed, []);
  assert.deepEqual(cleanup.skipped, ['projects/P.json']);
  assert.equal(JSON.parse(await fs.readFile(legacy, 'utf8')).revision, 1);
});

test('orphan remnant cleanup is blocked by legacy projects and bound to a scan fingerprint', async (t) => {
  const { root, storage } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await storage.writeMarker();
  storage.active = true;
  await fs.writeFile(path.join(root, 'projects', 'Pending.json'), '{}');
  assert.equal((await storage.scanLegacyRemnants()).blocked.code, 'legacy-projects-present');
  await fs.unlink(path.join(root, 'projects', 'Pending.json'));
  await fs.mkdir(path.join(root, 'outs', 'Orphan'), { recursive: true });
  await fs.writeFile(path.join(root, 'outs', 'Orphan', 'x.png'), 'x');
  const first = await storage.scanLegacyRemnants();
  assert.deepEqual(first.remnants.map((item) => item.path), ['outs/Orphan']);
  await assert.rejects(
    () => storage.cleanupLegacyRemnants({ authorizedAt: 1, expectedFingerprint: 'stale' }),
    /changed after confirmation/i,
  );
  const cleanup = await storage.cleanupLegacyRemnants({
    authorizedAt: 2,
    expectedFingerprint: first.fingerprint,
  });
  assert.deepEqual(cleanup.removed, ['outs/Orphan']);
  assert.equal((await storage.scanLegacyRemnants()).remnants.length, 0);
});

test('legacy remnant cleanup preserves empty logical project folders', async (t) => {
  const { root, storage } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await storage.writeMarker();
  storage.active = true;
  await fs.mkdir(path.join(root, 'projects', 'empty', 'child'), { recursive: true });
  await fs.mkdir(path.join(root, 'projects', 'folder'), { recursive: true });
  await fs.writeFile(path.join(root, 'projects', 'folder', 'old.json.bak'), '{}');
  const scan = await storage.scanLegacyRemnants();
  assert.deepEqual(scan.remnants.map((item) => item.path), ['projects/folder/old.json.bak']);
  await storage.cleanupLegacyRemnants({ authorizedAt: 1, expectedFingerprint: scan.fingerprint });
  assert.equal(await fs.stat(path.join(root, 'projects', 'empty', 'child')).then((s) => s.isDirectory()), true);
  assert.equal(await fs.stat(path.join(root, 'projects', 'folder')).then((s) => s.isDirectory()), true);
});

test('server and UI wire migration consent, logical backup, copy promotion, and separate cleanup', () => {
  const server = readSource('server.js');
  const backend = readSource('frontend/src/backends/serverBackend.ts');
  const gate = readSource('frontend/src/components/StorageMigrationGate.tsx');
  const config = readSource('frontend/src/components/ConfigScreen.tsx');
  const session = readSource('frontend/src/models/SessionService.ts');
  const images = readSource('frontend/src/models/ImageService.ts');
  const trash = readSource('frontend/src/models/TrashService.ts');
  const sizes = readSource('frontend/src/models/ProjectSizeService.ts');
  const sessionTypes = readSource('frontend/src/models/types.ts');
  const copyRoute = server.slice(
    server.indexOf("app.post('/api/fs/copy'"),
    server.indexOf("app.post('/api/fs/copy-dir'"),
  );
  assert.match(server, /MOVE_PROJECT_DATA_TO_STORAGE_V2/);
  assert.match(server, /DELETE_MIGRATED_LEGACY_STORAGE/);
  assert.match(server, /DELETE_SCANNED_LEGACY_REMNANTS/);
  assert.match(server, /ROLLBACK_STORAGE_V2/);
  assert.match(server, /storage_migration_optout\.json/);
  assert.match(server, /FULL_BACKUP_MANIFEST_FILE/);
  assert.match(server, /backupVersion: manifest\.version/);
  assert.match(server, /mutateProjectAssetPath/);
  assert.match(server, /copy destination already exists/);
  assert.match(copyRoute, /prepareProjectWrite\(req\.body\.dest, projectPayload\)/);
  assert.match(backend, /setStorageMigrationOptOut/);
  assert.match(backend, /cleanupLegacyStorageRemnants/);
  assert.match(gate, /다시 알리지 않음/);
  assert.match(config, /구 저장소 고아 잔재 검사/);
  assert.match(config, /scan\.fingerprint/);
  assert.match(session, /async renameProject\(oldName: string, newName: string\)/);
  assert.match(session, /createdDests\.reverse\(\)/);
  assert.match(images, /rollbackErrors/);
  assert.match(trash, /renameProjectKeys/);
  assert.match(sizes, /renameProject\(oldName: string, newName: string\)/);
  assert.match(sessionTypes, /id\?: string/);
  assert.match(sessionTypes, /id: this\.id/);
  assert.match(session, /if \(!rc\.id\) rc\.id = v4\(\)/);
  assert.match(session, /json\.id = v4\(\)/);
  assert.match(server, /projJson\.id = preservedProjectId \|\| uuidv4\(\)/);
});
