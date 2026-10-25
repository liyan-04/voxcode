import {randomUUID, createHash} from 'node:crypto';
import {validateCommandEnvelope, stableJson, validId, MAX_COMMAND_BYTES, MAX_RESULT_BYTES} from '../../packages/control-protocol/index.mjs';

const fail = (message, code = 'invalid_argument') => Object.assign(Error(message), {code});
const copy = value => structuredClone(value);
const object = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key));
const types = ['switch_task', 'focus_window', 'open_project', 'task_rpc'];
const finalStatuses = ['succeeded', 'failed', 'rejected'];
const finiteLimit = (value, maximum) => Number.isSafeInteger(value) && value > 0 && value <= maximum;

export function createDeviceGateway({deviceStore, clock = Date.now, random = randomUUID, ttlMs = 30000, limits = {}} = {}) {
  if (!deviceStore?.reserveOperation || !finiteLimit(ttlMs, 60000)) throw fail('Opened device store and valid command TTL required');
  const defaults = {maxFrameBytes: MAX_RESULT_BYTES + 2048, maxPayloadBytes: MAX_COMMAND_BYTES, maxOperations: 1024, maxConnections: 32, maxPending: 64, sendTimeoutMs: 1000};
  if (Object.keys(limits).some(key => !Object.hasOwn(defaults, key))) throw fail('Invalid gateway limits');
  const cap = {...defaults, ...limits};
  if (!finiteLimit(cap.maxFrameBytes, defaults.maxFrameBytes) || !finiteLimit(cap.maxPayloadBytes, MAX_COMMAND_BYTES) || !finiteLimit(cap.maxOperations, 10000) || !finiteLimit(cap.maxConnections, 1024) || !finiteLimit(cap.maxPending, 256) || !finiteLimit(cap.sendTimeoutMs, 30000)) throw fail('Invalid gateway limits');
  const connections = new Map();
  const queue = [];
  let active = false, pending = 0, closing = 0;
  function drain() {
    if (active || queue.length === 0) return;
    const item = queue.shift(); active = true;
    const finish = (success, result) => {
      active = false;
      if (item.control) closing--; else pending--;
      if (success) item.resolve(result); else item.reject(result);
      drain();
    };
    Promise.resolve().then(item.fn).then(result => finish(true, result), error => finish(false, error));
  }
  const locked = (fn, control = false) => {
    if (control ? closing >= cap.maxConnections : pending >= cap.maxPending) return Promise.reject(fail('Gateway pending capacity reached', 'capacity'));
    if (control) closing++; else pending++;
    return new Promise((resolve, reject) => {
      const entry = {fn, resolve, reject, control};
      if (control) queue.unshift(entry); else queue.push(entry);
      drain();
    });
  };
  const now = () => Number(clock());
  const capabilities = value => {
    if (!Array.isArray(value) || value.length > types.length || value.some(x => !types.includes(x)) || new Set(value).size !== value.length) throw fail('Invalid capabilities');
    return copy(value);
  };
  const frame = message => {
    if (Buffer.isBuffer(message) || ArrayBuffer.isView(message)) throw fail('Binary control frames unsupported');
    let size;
    try {size = Buffer.byteLength(typeof message === 'string' ? message : JSON.stringify(message));} catch {throw fail('Invalid control frame');}
    if (size > cap.maxFrameBytes) throw fail('Control frame too large', 'payload_too_large');
    try {return copy(typeof message === 'string' ? JSON.parse(message) : message);} catch {throw fail('Invalid control frame');}
  };
  const send = async (connection, message) => {
    current(connection);
    if (Buffer.byteLength(JSON.stringify(message)) > cap.maxFrameBytes) throw fail('Control frame too large', 'payload_too_large');
    let timer;
    try {
      await Promise.race([
        Promise.resolve().then(() => connection.send(copy(message))),
        new Promise((_, reject) => {timer = setTimeout(() => reject(fail('Device send deadline reached', 'outcome_unknown')), cap.sendTimeoutMs);}),
      ]);
    } finally {clearTimeout(timer);}
  };
  const current = connection => {
    if (connection.closed || connections.get(connection.deviceId) !== connection) throw fail('Device connection replaced or closed', 'connection_replaced');
  };
  const owner = async ({userId, deviceId}) => {
    if (!validId(userId) || !validId(deviceId)) throw fail('Invalid device identity');
    return deviceStore.assertOwner(deviceId, userId);
  };
  const online = async (identity) => {
    const device = await owner(identity), connection = connections.get(identity.deviceId);
    if (!connection || connection.closed || !device.online) throw fail('Device is offline', 'offline');
    return connection;
  };
  const refreshOutcome = async record => {
    if (record.response.status === 'accepted' && Date.parse(record.command.expiresAt) <= now()) {
      return deviceStore.updateOperation(record.command.operationId, {...record.response, status: 'unknown', errorCode: 'command_timeout'});
    }
    return record;
  };
  const lookup = async (operationId, identity) => {
    await owner(identity);
    const record = await deviceStore.getOperation(operationId);
    if (!record || record.userId !== identity.userId || record.deviceId !== identity.deviceId) throw fail('Operation unavailable', 'not_found');
    return refreshOutcome(record);
  };
  const observed = message => {
    if (message.snapshot === undefined) return undefined;
    if (Buffer.byteLength(JSON.stringify(message.snapshot)) > MAX_RESULT_BYTES) throw fail('Agent snapshot too large', 'payload_too_large');
    return copy(message.snapshot);
  };
  async function receive(connection, message) {
    current(connection);
    if (!message || message.protocolVersion !== 1) throw fail('Unsupported protocol');
    if (message.deviceId !== connection.deviceId) throw fail('Authenticated device mismatch', 'unauthorized');
    if (message.type === 'heartbeat') {
      if (!object(message, ['type', 'protocolVersion', 'deviceId', 'capabilities', 'snapshot', 'agentObservedAt'])) throw fail('Invalid heartbeat');
      const declared = message.capabilities === undefined ? undefined : capabilities(message.capabilities);
      await deviceStore.observeDevice({deviceId: connection.deviceId, userId: connection.userId, capabilities: declared, snapshot: observed(message), agentObservedAt: message.agentObservedAt});
      if (declared !== undefined) connection.capabilities = declared;
      const reply = {type: 'heartbeat_ack', protocolVersion: 1, deviceId: connection.deviceId, connectionId: connection.connectionId, serverObservedAt: new Date(now()).toISOString()};
      await send(connection, reply);
      return reply;
    }
    if (message.type !== 'commandResult' || !object(message, ['type', 'protocolVersion', 'deviceId', 'requestId', 'operationId', 'status', 'errorCode', 'snapshot', 'agentObservedAt']) || !validId(message.requestId) || !validId(message.operationId) || ![...finalStatuses, 'unknown'].includes(message.status) || message.errorCode !== undefined && message.errorCode !== null && !validId(message.errorCode)) throw fail('Invalid command result');
    if (message.agentObservedAt !== undefined && (typeof message.agentObservedAt !== 'string' || !Number.isFinite(Date.parse(message.agentObservedAt)))) throw fail('Invalid agent observation time');
    const record = await lookup(message.operationId, connection);
    if (record.command.requestId !== message.requestId) throw fail('Operation identity conflict', 'request_conflict');
    const snapshot = observed(message) ?? null;
    const prior = record.response;
    const response = {protocolVersion: 1, requestId: message.requestId, operationId: message.operationId, status: message.status, errorCode: message.errorCode ?? null, agentObservedAt: message.agentObservedAt ?? (finalStatuses.includes(prior.status) ? prior.agentObservedAt : new Date(now()).toISOString()), snapshot};
    const completed = await deviceStore.updateOperation(message.operationId, response);
    return copy(completed.response);
  }

  const gateway = {
    startPairing(input) {return locked(() => deviceStore.startPairing(input));},
    completePairing(input) {return locked(() => deviceStore.completePairing(input));},
    listDevices(input) {return locked(() => deviceStore.listDevices(input));},
    async connect(value, transport) {
      const registration = frame(value);
      if (!object(registration, ['type', 'protocolVersion', 'deviceId', 'token', 'capabilities']) || registration.type !== 'register' || registration.protocolVersion !== 1 || typeof transport?.send !== 'function') throw fail('Invalid device registration');
      const declared = capabilities(registration.capabilities);
      return locked(async () => {
        const auth = await deviceStore.authenticate({deviceId: registration.deviceId, token: registration.token});
        if (!connections.has(auth.deviceId) && connections.size >= cap.maxConnections) throw fail('Connection capacity reached', 'capacity');
        const connection = {...auth, connectionId: random(), send: transport.send, capabilities: declared};
        if (!validId(connection.connectionId)) throw fail('Invalid connection identity');
        const old = connections.get(auth.deviceId);
        if (old) await deviceStore.disconnectDevice(old.deviceId, old.userId);
        await deviceStore.observeDevice({...auth, capabilities: declared});
        connections.set(auth.deviceId, connection);
        try {await send(connection, {type: 'connected', protocolVersion: 1, deviceId: auth.deviceId, connectionId: connection.connectionId});}
        catch {connections.delete(auth.deviceId); await deviceStore.disconnectDevice(auth.deviceId, auth.userId); throw fail('Device registration delivery failed', 'offline');}
        let closing;
        return Object.freeze({
          deviceId: auth.deviceId, userId: auth.userId, connectionId: connection.connectionId,
          async receive(value) {current(connection); const message = frame(value); return locked(() => receive(connection, message));},
          close() {
            if (closing) return closing;
            if (connections.get(auth.deviceId) !== connection) return Promise.resolve();
            connection.closed = true;
            closing = locked(async () => {
              if (connections.get(auth.deviceId) !== connection) return;
              connections.delete(auth.deviceId);
              await deviceStore.disconnectDevice(auth.deviceId, auth.userId);
            }, true);
            return closing;
          },
        });
      });
    },
    async submitCommand(value) {
      const input = frame(value);
      if (!object(input, ['userId', 'deviceId', 'requestId', 'type', 'projectId', 'taskId', 'expectedRevision', 'payload', 'issuedAt', 'expiresAt']) || !validId(input.requestId)) throw fail('Invalid command');
      let encoded;
      try {encoded = JSON.stringify(input.payload ?? {});} catch {throw fail('Invalid command payload');}
      if (Buffer.byteLength(encoded) > cap.maxPayloadBytes) throw fail('Command payload too large', 'payload_too_large');
      return locked(async () => {
        await owner(input);
        if (!types.includes(input.type)) throw fail('Unsupported local command', 'capability_unavailable');
        const intent = copy(input);
        const fingerprint = createHash('sha256').update(stableJson(intent)).digest('hex');
        const prior = await deviceStore.findRequest(input.deviceId, input.requestId);
        if (prior) {
          if (prior.userId !== input.userId || prior.fingerprint !== fingerprint) throw fail('requestId conflict', 'request_conflict');
          return copy((await refreshOutcome(prior)).response);
        }
        const timestamp = now(), expires = input.expiresAt === undefined ? timestamp + ttlMs : Date.parse(input.expiresAt);
        if (!Number.isFinite(expires)) throw fail('Invalid command expiry');
        const issued = input.issuedAt ?? new Date(Math.min(timestamp, expires - ttlMs)).toISOString();
        const command = {
          protocolVersion: 1, requestId: input.requestId, operationId: random(), deviceId: input.deviceId, type: input.type,
          ...(input.projectId !== undefined ? {projectId: input.projectId} : {}), ...(input.taskId !== undefined ? {taskId: input.taskId} : {}),
          ...(input.expectedRevision !== undefined ? {expectedRevision: input.expectedRevision} : {}),
          payload: input.payload ?? {}, issuedAt: issued, expiresAt: new Date(expires).toISOString(),
        };
        validateCommandEnvelope(command, {deviceId: input.deviceId, now: Math.min(timestamp, expires - 1)});
        const expired = expires <= timestamp;
        const connection = expired ? null : await online(input);
        if (connection && !connection.capabilities.includes(input.type)) throw fail('Device capability unavailable', 'capability_unavailable');
        const response = {protocolVersion: 1, requestId: input.requestId, operationId: command.operationId, status: expired ? 'expired' : 'accepted', errorCode: expired ? 'expired' : null, agentObservedAt: null, snapshot: null};
        const reservation = await deviceStore.reserveOperation({userId: input.userId, deviceId: input.deviceId, fingerprint, command, response}, cap.maxOperations);
        if (!reservation.created || expired) return copy(reservation.record.response);
        if (expires <= now()) {
          const expiredResponse = {...response, status: 'expired', errorCode: 'expired'};
          await deviceStore.updateOperation(command.operationId, expiredResponse);
          return expiredResponse;
        }
        try {await send(connection, {type: 'command', command});}
        catch {
          const unknown = {...response, status: 'unknown', errorCode: 'delivery_unknown'};
          await deviceStore.updateOperation(command.operationId, unknown);
          return unknown;
        }
        return copy(response);
      });
    },
    getOperation(operationId, identity = {}) {return locked(async () => copy((await lookup(operationId, identity)).response));},
    reconcile(identity = {}) {
      return locked(async () => {
        const record = await lookup(identity.operationId, identity);
        if (['accepted', 'unknown'].includes(record.response.status)) {
          const connection = await online(identity);
          await send(connection, {type: 'reconcile', protocolVersion: 1, deviceId: connection.deviceId, requestId: record.command.requestId, operationId: record.command.operationId});
        }
        return copy(record.response);
      });
    },
  };
  return gateway;
}
