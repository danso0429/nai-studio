'use strict';

function projectNameFromDataPath(rawPath) {
  const normalized = String(rawPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const rawParts = normalized.split('/');
  if (rawParts.some((part) => part === '.' || part === '..')) return null;
  const parts = rawParts.filter(Boolean);
  if (parts[0] === 'projects' && parts.length >= 2) {
    const filename = parts[parts.length - 1];
    if (/(?:\.json(?:\.(?:bak|deleted))?|\.deleted)$/i.test(filename)) {
      return filename.replace(/(?:\.json(?:\.(?:bak|deleted))?|\.deleted)$/i, '');
    }
    return null;
  }
  if (['outs', 'inpaints', 'vibes', 'references', 'inpaint_orgs', 'inpaint_masks'].includes(parts[0])) {
    return parts[1] || null;
  }
  return null;
}

class ProjectLeaseRegistry {
  constructor(options = {}) {
    this.ttlMs = options.ttlMs ?? 90_000;
    this.now = options.now ?? (() => Date.now());
    this.clients = new Map();
    this.leases = new Map();
    this.mirrors = new Map();
  }

  touch(clientId, deviceId = '') {
    if (!clientId) return null;
    const current = this.clients.get(clientId) || {
      deviceId,
      sockets: new Set(),
      lastSeen: 0,
      everConnected: false,
    };
    if (deviceId) current.deviceId = deviceId;
    current.lastSeen = this.now();
    this.clients.set(clientId, current);
    for (const lease of this.leases.values()) {
      if (lease.clientId === clientId) lease.lastSeen = current.lastSeen;
    }
    return { clientId, deviceId: current.deviceId || deviceId };
  }

  connect(clientId, deviceId, socket) {
    const identity = this.touch(clientId, deviceId);
    if (!identity) return null;
    const client = this.clients.get(clientId);
    client.sockets.add(socket);
    client.everConnected = true;
    return identity;
  }

  disconnect(clientId, socket) {
    const client = this.clients.get(clientId);
    if (!client) return;
    client.sockets.delete(socket);
    client.lastSeen = this.now();
  }

  isConnected(clientId) {
    return Boolean(this.clients.get(clientId)?.sockets.size);
  }

  get(projectName) {
    const lease = this.leases.get(projectName);
    if (!lease) return null;
    if (this.now() - lease.lastSeen <= this.ttlMs) return lease;
    this.leases.delete(projectName);
    return null;
  }

  acquire(projectName, identity) {
    const current = this.get(projectName);
    const sameClient = current?.clientId === identity.clientId;
    const ownerClient = current ? this.clients.get(current.clientId) : null;
    const sameDeviceTakeover = current &&
      current.deviceId === identity.deviceId &&
      !this.isConnected(current.clientId) &&
      ownerClient?.everConnected === true;
    if (!current || sameClient || sameDeviceTakeover) {
      this.leases.set(projectName, {
        clientId: identity.clientId,
        deviceId: identity.deviceId,
        lastSeen: this.now(),
      });
      this.mirrors.get(projectName)?.delete(identity.clientId);
      return true;
    }
    return false;
  }

  release(projectName, clientId) {
    if (this.get(projectName)?.clientId === clientId) this.leases.delete(projectName);
    this.releaseMirror(projectName, clientId);
  }

  registerMirror(projectName, identity) {
    const lease = this.get(projectName);
    if (!lease || !identity?.clientId || lease.clientId === identity.clientId) return false;
    const clients = this.mirrors.get(projectName) || new Set();
    clients.add(identity.clientId);
    this.mirrors.set(projectName, clients);
    return true;
  }

  releaseMirror(projectName, clientId) {
    const clients = this.mirrors.get(projectName);
    if (!clients) return;
    clients.delete(clientId);
    if (clients.size === 0) this.mirrors.delete(projectName);
  }

  canDelegate(projectName, clientId) {
    const lease = this.get(projectName);
    if (!lease) return true;
    return lease.clientId === clientId || Boolean(this.mirrors.get(projectName)?.has(clientId));
  }

  rekey(oldName, newName) {
    const lease = this.get(oldName);
    if (!lease) return;
    this.leases.delete(oldName);
    this.leases.set(newName, lease);
    const mirrors = this.mirrors.get(oldName);
    if (mirrors) {
      this.mirrors.delete(oldName);
      this.mirrors.set(newName, mirrors);
    }
  }

  assertPathOwner(rawPath, clientId) {
    this.assertSafePath(rawPath);
    const projectName = projectNameFromDataPath(rawPath);
    if (!projectName) return;
    const lease = this.get(projectName);
    if (!lease || lease.clientId === clientId) return;
    const error = new Error(`project is locked by another client: ${projectName}`);
    error.statusCode = 423;
    throw error;
  }

  assertPathDelegate(rawPath, clientId) {
    this.assertSafePath(rawPath);
    const projectName = projectNameFromDataPath(rawPath);
    if (!projectName || this.canDelegate(projectName, clientId)) return;
    const error = new Error(`project operation is not delegated to this client: ${projectName}`);
    error.statusCode = 423;
    throw error;
  }

  assertSafePath(rawPath) {
    const parts = String(rawPath || '').replace(/\\/g, '/').split('/');
    if (!parts.some((part) => part === '.' || part === '..')) return;
    const error = new Error('unsafe project data path');
    error.statusCode = 400;
    throw error;
  }

  sweep() {
    const now = this.now();
    for (const [name, lease] of this.leases) {
      if (now - lease.lastSeen > this.ttlMs) this.leases.delete(name);
    }
    for (const [clientId, client] of this.clients) {
      if (client.sockets.size === 0 && now - client.lastSeen > this.ttlMs * 2) {
        this.clients.delete(clientId);
        for (const [projectName, mirrors] of this.mirrors) {
          mirrors.delete(clientId);
          if (mirrors.size === 0) this.mirrors.delete(projectName);
        }
      }
    }
  }
}

module.exports = { ProjectLeaseRegistry, projectNameFromDataPath };
