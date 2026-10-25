import {createHash, randomBytes, randomUUID, timingSafeEqual} from 'node:crypto';
import {mkdir, realpath, lstat, readFile, open, rename, unlink} from 'node:fs/promises';
import {isAbsolute, join, resolve} from 'node:path';
import {validId as id, readMethods} from '../../packages/control-protocol/index.mjs';

const fail = (message, code = 'invalid_argument') => Object.assign(Error(message), {code});
const copy = value => structuredClone(value);
const hash = value => createHash('sha256').update(value).digest('hex');
const bounded = (value, maximum) => Number.isSafeInteger(value) && value > 0 && value <= maximum;
const terminal = new Set(['succeeded', 'failed', 'rejected', 'expired']);

// Opening is asynchronous so callers cannot start serving before durable recovery.
export async function createDeviceStore({root, clock = Date.now, random = () => randomBytes(24).toString('base64url'), token = () => randomBytes(32).toString('base64url'), pairingTtlMs = 300000, offlineAfterMs = 30000, limits = {}} = {}) {
  if (!isAbsolute(root ?? '') || typeof clock !== 'function' || !bounded(pairingTtlMs, 300000) || !bounded(offlineAfterMs, 300000)) throw fail('Absolute private device root and valid limits required');
  const defaults = {maxPairings: 64, maxDevices: 32, maxOperations: 1024, maxBytes: 16 * 1024 * 1024};
  const caps = {...defaults, ...limits};
  if (Object.keys(limits).some(key => !Object.hasOwn(defaults, key)) || !bounded(caps.maxPairings, 1024) || !bounded(caps.maxDevices, 1024) || !bounded(caps.maxOperations, 10000) || !bounded(caps.maxBytes, 64 * 1024 * 1024)) throw fail('Invalid device store limits');
  const directory = resolve(root);
  await mkdir(directory, {recursive: true, mode: 0o700});
  const info = await lstat(directory);
  if (info.isSymbolicLink() || !info.isDirectory() || await realpath(directory) !== directory || info.uid !== process.getuid?.() || (info.mode & 0o077)) throw fail('Device root must be a private owned directory');
  for (let parent = resolve(directory, '..');; parent = resolve(parent, '..')) {
    const stat = await lstat(parent), stickyRoot = stat.uid === 0 && (stat.mode & 0o1000) !== 0;
    if (!stat.isDirectory() || ![0, process.getuid?.()].includes(stat.uid) || ((stat.mode & 0o022) !== 0 && !stickyRoot)) throw fail('Device root ancestors must be trusted');
    if (parent === resolve(parent, '..')) break;
  }
  const file = join(directory, 'devices.json');
  let state = {version: 1, pairings: [], devices: [], operations: []};
  try {
    const stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid?.() || stat.mode & 0o077 || stat.size > caps.maxBytes) throw fail('Invalid private device ledger');
    state = JSON.parse(await readFile(file, 'utf8'));
    if (state?.version !== 1 || !Array.isArray(state.pairings) || !Array.isArray(state.devices) || !Array.isArray(state.operations) || state.pairings.length > caps.maxPairings || state.devices.length > caps.maxDevices || state.operations.length > caps.maxOperations) throw fail('Invalid device ledger');
    if (state.devices.some(x => !id(x.deviceId) || !id(x.userId) || !/^[a-f0-9]{64}$/u.test(x.tokenDigest ?? '') || !Array.isArray(x.capabilities)) ||
        state.pairings.some(x => !id(x.userId) || !/^[a-f0-9]{64}$/u.test(x.digest ?? '') || !Number.isFinite(x.expiresAt)) ||
        state.operations.some(x => !id(x.userId) || !id(x.deviceId) || !id(x.command?.operationId) || !id(x.command?.requestId) || !/^[a-f0-9]{64}$/u.test(x.fingerprint ?? '') || !['accepted', 'unknown', ...terminal].includes(x.response?.status))) throw fail('Invalid device ledger records');
    if (new Set(state.devices.map(x => x.deviceId)).size !== state.devices.length || new Set(state.operations.map(x => x.command.operationId)).size !== state.operations.length || new Set(state.operations.map(x => JSON.stringify([x.deviceId, x.command.requestId]))).size !== state.operations.length) throw fail('Duplicate device ledger identities');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const now = () => Number(clock());
  let serial = Promise.resolve(), uncertain = false;
  const healthy = () => {if (uncertain) throw fail('Device ledger commit outcome unknown; reopen to reconcile', 'outcome_unknown');};
  const locked = fn => {const pending = serial.then(fn); serial = pending.catch(() => {}); return pending;};
  async function save(next) {
    const body = JSON.stringify(next);
    if (Buffer.byteLength(body) > caps.maxBytes) throw fail('Device ledger capacity reached', 'capacity');
    const temporary = join(directory, '.device-' + randomUUID() + '.tmp');
    let renamed = false;
    try {
      const handle = await open(temporary, 'wx', 0o600);
      try {await handle.writeFile(body); await handle.sync();} finally {await handle.close();}
      await rename(temporary, file);
      renamed = true;
      const parent = await open(directory, 'r');
      try {await parent.sync();} finally {await parent.close();}
      state = next;
    } catch (error) {
      if (renamed) {uncertain = true; healthy();}
      throw error;
    } finally {await unlink(temporary).catch(() => {});}
  }
  const change = fn => locked(async () => {
    healthy();
    const next = copy(state), result = await fn(next);
    await save(next);
    return copy(result);
  });
  const view = device => device ? {deviceId: device.deviceId, userId: device.userId, capabilities: copy(device.capabilities), lastSeen: device.lastSeen, online: device.connected === true && device.lastSeen !== null && now() - device.lastSeen < offlineAfterMs, stateSource: 'serverCached', agentObserved: copy(device.agentObserved ?? null)} : null;
  const owned = (value, deviceId, userId) => {
    const device = value.devices.find(x => x.deviceId === deviceId && x.userId === userId);
    if (!device) throw fail('Device unavailable', 'not_found');
    return device;
  };
  // A process restart cannot prove that an accepted side effect did not happen.
  const recovered = copy(state);
  for (const device of recovered.devices) device.connected = false;
  for (const operation of recovered.operations) if (operation.response.status === 'accepted') operation.response = {...operation.response, status: 'unknown', errorCode: 'connection_lost'};
  if (JSON.stringify(recovered) !== JSON.stringify(state)) await save(recovered);

  return {
    async startPairing({userId} = {}) {
      if (!id(userId)) throw fail('Invalid userId');
      return change(next => {
        next.pairings = next.pairings.filter(x => x.expiresAt > now());
        if (next.pairings.length >= caps.maxPairings) throw fail('Pairing capacity reached', 'capacity');
        const code = random();
        if (typeof code !== 'string' || code.length < 12 || code.length > 128 || next.pairings.some(x => x.digest === hash(code))) throw fail('Invalid pairing entropy');
        const expiresAt = now() + pairingTtlMs;
        next.pairings.push({digest: hash(code), userId, expiresAt});
        return {code, expiresAt: new Date(expiresAt).toISOString(), fixture: true};
      });
    },
    async completePairing({code, userId, deviceId} = {}) {
      if (typeof code !== 'string' || code.length > 128 || !id(userId) || !id(deviceId)) throw fail('Invalid pairing input');
      return change(next => {
        const pairing = next.pairings.find(x => x.digest === hash(code) && x.userId === userId);
        if (!pairing) throw fail('Pairing code invalid', 'pairing_invalid');
        if (pairing.expiresAt <= now()) throw fail('Pairing code expired', 'pairing_expired');
        if (next.devices.some(x => x.deviceId === deviceId)) throw fail('Device identity already paired', 'device_conflict');
        if (next.devices.length >= caps.maxDevices) throw fail('Device capacity reached', 'capacity');
        const plainToken = token();
        if (typeof plainToken !== 'string' || plainToken.length < 12 || plainToken.length > 256) throw fail('Invalid token entropy');
        next.devices.push({deviceId, userId, tokenDigest: hash(plainToken), capabilities: [], connected: false, lastSeen: null, agentObserved: null});
        next.pairings = next.pairings.filter(x => x !== pairing);
        return {deviceId, token: plainToken, fixture: true};
      });
    },
    async authenticate({deviceId, token: plainToken} = {}) {
      await serial; healthy();
      if (!id(deviceId) || typeof plainToken !== 'string' || plainToken.length > 256) throw fail('Device authentication failed', 'unauthorized');
      const device = state.devices.find(x => x.deviceId === deviceId);
      if (!device || !timingSafeEqual(Buffer.from(hash(plainToken)), Buffer.from(device.tokenDigest))) throw fail('Device authentication failed', 'unauthorized');
      return {deviceId, userId: device.userId};
    },
    async assertOwner(deviceId, userId) {
      await serial; healthy();
      if (!id(deviceId) || !id(userId)) throw fail('Invalid device identity');
      return view(owned(state, deviceId, userId));
    },
    async listDevices({userId} = {}) {
      await serial; healthy(); if (!id(userId)) throw fail('Invalid userId');
      return state.devices.filter(x => x.userId === userId).map(view);
    },
    async getDevice(deviceId) {await serial; healthy(); return view(state.devices.find(x => x.deviceId === deviceId));},
    observeDevice({deviceId, userId, capabilities, snapshot, agentObservedAt}) {
      return change(next => {
        const device = owned(next, deviceId, userId);
        const observation = typeof agentObservedAt === 'string' ? Date.parse(agentObservedAt) : NaN;
        if ((snapshot !== undefined || agentObservedAt !== undefined) && (!Number.isFinite(observation) || new Date(observation).toISOString() !== agentObservedAt || observation > now() + 5000)) throw fail('Valid heartbeat observation time required');
        device.connected = true; device.lastSeen = now();
        if (capabilities !== undefined) device.capabilities = copy(capabilities);
        if (snapshot !== undefined && (!device.agentObserved || observation > Date.parse(device.agentObserved.observedAt))) device.agentObserved = {snapshot: copy(snapshot), observedAt: agentObservedAt, receivedAt: new Date(now()).toISOString(), stateSource: 'agentObserved'};
        return view(device);
      });
    },
    disconnectDevice(deviceId, userId) {
      return change(next => {
        owned(next, deviceId, userId).connected = false;
        for (const record of next.operations) if (record.deviceId === deviceId && record.response.status === 'accepted') record.response = {...record.response, status: 'unknown', errorCode: 'connection_lost'};
        return null;
      });
    },
    async getOperation(operationId) {await serial; healthy(); return copy(state.operations.find(x => x.command.operationId === operationId) ?? null);},
    async findRequest(deviceId, requestId) {await serial; healthy(); return copy(state.operations.find(x => x.deviceId === deviceId && x.command.requestId === requestId) ?? null);},
    reserveOperation(record, maxOperations = caps.maxOperations) {
      return change(next => {
        next.operations = next.operations.filter(operation => !(operation.command.type === 'task_rpc' && readMethods.includes(operation.command.payload?.method) && Date.parse(operation.command.expiresAt) <= now()));
        const prior = next.operations.find(x => x.deviceId === record.deviceId && x.command.requestId === record.command.requestId);
        if (prior) {
          if (prior.fingerprint !== record.fingerprint) throw fail('requestId conflict', 'request_conflict');
          return {created: false, record: prior};
        }
        if (next.operations.length >= Math.min(maxOperations, caps.maxOperations)) throw fail('Operation capacity reached', 'capacity');
        if (next.operations.some(x => x.command.operationId === record.command.operationId)) throw fail('Operation identity conflict', 'request_conflict');
        next.operations.push(copy(record));
        return {created: true, record};
      });
    },
    updateOperation(operationId, response) {
      return change(next => {
        const record = next.operations.find(x => x.command.operationId === operationId);
        if (!record) throw fail('Operation unavailable', 'not_found');
        if (terminal.has(record.response.status)) {
          if (JSON.stringify(record.response) !== JSON.stringify(response)) throw fail('Operation result conflict', 'request_conflict');
        } else record.response = copy(response);
        return record;
      });
    },
  };
}
