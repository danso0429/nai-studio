'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ProjectLeaseRegistry, projectNameFromDataPath } = require('../lib/project-leases');

const read = (relative) => fs.readFileSync(path.resolve(__dirname, '..', relative), 'utf8');

test('connected tabs on the same device cannot steal an active project lease', () => {
  let now = 1000;
  const leases = new ProjectLeaseRegistry({ ttlMs: 100, now: () => now });
  const socketA = {};
  const socketB = {};
  const a = leases.connect('client-a', 'phone', socketA);
  const b = leases.connect('client-b', 'phone', socketB);
  assert.equal(leases.acquire('project', a), true);
  assert.equal(leases.acquire('project', b), false);
  assert.throws(
    () => leases.assertPathOwner('projects/folder/project.json', 'client-b'),
    (error) => error.statusCode === 423,
  );
});

test('a disconnected page can hand its lease to a reloaded page on the same device', () => {
  const leases = new ProjectLeaseRegistry();
  const oldSocket = {};
  const oldPage = leases.connect('old-page', 'phone', oldSocket);
  assert.equal(leases.acquire('project', oldPage), true);
  leases.disconnect('old-page', oldSocket);
  const reloadedPage = leases.touch('new-page', 'phone');
  assert.equal(leases.acquire('project', reloadedPage), true);
  assert.equal(leases.get('project').clientId, 'new-page');
});

test('mirror registration atomically becomes owner when the previous owner disappears', () => {
  const leases = new ProjectLeaseRegistry();
  const owner = leases.touch('owner', 'desktop');
  const contender = leases.touch('contender', 'phone');
  assert.equal(leases.acquire('project', owner), true);
  assert.equal(leases.acquire('project', contender), false);
  assert.equal(leases.mirrorOrAcquire('project', contender), 'mirror');
  assert.equal(leases.get('project').clientId, owner.clientId);
  assert.equal(leases.mirrors.get('project').has(contender.clientId), true);
  leases.release('project', owner.clientId);
  assert.equal(leases.mirrorOrAcquire('project', contender), 'owner');
  assert.equal(leases.get('project').clientId, contender.clientId);
  assert.equal(leases.mirrors.get('project')?.has(contender.clientId) ?? false, false);
});

test('expired leases recover on another device and project rename rekeys ownership', () => {
  let now = 0;
  const leases = new ProjectLeaseRegistry({ ttlMs: 50, now: () => now });
  const first = leases.touch('first', 'phone');
  const second = leases.touch('second', 'desktop');
  assert.equal(leases.acquire('old', first), true);
  assert.equal(leases.registerMirror('old', leases.touch('mirror', 'tablet')), true);
  now = 51;
  assert.equal(leases.acquire('old', second), true);
  leases.rekey('old', 'new');
  assert.equal(leases.get('old'), null);
  assert.equal(leases.get('new').clientId, 'second');
  assert.equal(leases.mirrors.get('new').has('mirror'), true);
});

test('only a registered readonly mirror can delegate project operations', () => {
  let now = 0;
  const leases = new ProjectLeaseRegistry({ ttlMs: 50, now: () => now });
  const owner = leases.touch('owner', 'desktop');
  const mirror = leases.touch('mirror', 'phone');
  assert.equal(leases.acquire('project', owner), true);
  assert.equal(leases.registerMirror('project', mirror), true);
  assert.doesNotThrow(() => leases.assertPathDelegate('outs/project/scene/file.png', 'mirror'));
  assert.throws(
    () => leases.assertPathDelegate('outs/project/scene/file.png', 'stale-client'),
    (error) => error.statusCode === 423,
  );
  assert.throws(
    () => leases.assertPathOwner('projects/project.json', 'mirror'),
    (error) => error.statusCode === 423,
  );
  now = 101;
  leases.sweep();
  assert.equal(leases.mirrors.has('project'), false);
});

test('project path ownership covers JSON and all mutable asset roots but not global stores', () => {
  assert.equal(projectNameFromDataPath('projects/a/b/demo.json'), 'demo');
  assert.equal(projectNameFromDataPath('projects/a/b/demo.deleted'), 'demo');
  assert.equal(projectNameFromDataPath('outs/demo/scene/1.png'), 'demo');
  assert.equal(projectNameFromDataPath('inpaint_masks/demo/x.png'), 'demo');
  assert.equal(projectNameFromDataPath('global_presets.json'), null);
  const leases = new ProjectLeaseRegistry();
  assert.doesNotThrow(() => leases.assertPathOwner('outs/demo/scene/1.png', 'any-client'));
  assert.throws(
    () => leases.assertPathDelegate('outs/demo/../other/scene/1.png', 'any-client'),
    (error) => error.statusCode === 400,
  );
});

test('server and client wire lease, revision broadcast, mirror reload, and Quick CAS', () => {
  const server = read('server.js');
  const backend = read('frontend/src/backends/serverBackend.ts');
  const app = read('frontend/src/components/App.tsx');
  const appService = read('frontend/src/models/AppService.ts');
  const resourceSync = read('frontend/src/models/ResourceSyncService.ts');
  const session = read('frontend/src/models/SessionService.ts');
  const imageService = read('frontend/src/models/ImageService.ts');
  assert.match(server, /\/api\/projects\/lease\/acquire/);
  assert.match(server, /assertProjectDelegateForPath\(req, params\.outputFilePath\)/);
  assert.match(server, /\/api\/projects\/lease\/mirror/);
  assert.match(server, /projectLeaseRegistry\.mirrorOrAcquire/);
  assert.match(server, /\/api\/projects\/generation-asset/);
  assert.match(server, /\/api\/images\/trash/);
  assert.match(server, /broadcastProjectLifecycle\('project-renamed'/);
  assert.match(server, /broadcastProjectLifecycle\('project-deleted'/);
  assert.match(server, /broadcastExcept\('resource-changed'/);
  assert.match(server, /recentProjectLifecycleEvents/);
  assert.match(server, /resolveRecentProjectRename/);
  assert.match(server, /await findProjectFile\(projectName\)/);
  assert.match(server, /quickEnsureChain\.then/);
  assert.match(server, /\/api\/projects\/session-image-main/);
  assert.match(server, /withProjectOperation\(projectName/);
  assert.match(server, /projectLeaseRegistry\.isConnected\(lease\.clientId\)/);
  assert.match(backend, /X-NAI-Client-ID/);
  assert.match(backend, /deferred: true/);
  assert.match(backend, /useProjectMirror/);
  assert.match(backend, /result\.acquired \? 'owner' : 'mirror'/);
  assert.match(backend, /writeGenerationAsset/);
  assert.match(backend, /trashImages/);
  assert.match(backend, /importScenes/);
  assert.match(app, /읽기 전용 미러/);
  assert.match(app, /sessionService\.reloadExternal/);
  assert.match(app, /onProjectRenamed/);
  assert.match(app, /onProjectDeleted/);
  assert.match(app, /trashService\.reloadExternal/);
  assert.match(app, /shared-stores:reconnect/);
  assert.match(app, /flushPendingSave/);
  assert.match(appService, /flushResource\(oldName\)/);
  assert.match(resourceSync, /if \(!this\.canWriteResource\(name\)\) return 'retry'/);
  assert.match(session, /backend\.ensureQuickProject/);
  assert.match(imageService, /setImageMain\(/);
  assert.match(imageService, /notifySessionImageMain/);
});
