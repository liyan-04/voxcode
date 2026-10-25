export const rpcMethods = Object.freeze(['status', 'listProjects', 'getProject', 'listTasks', 'getTask', 'startTask', 'confirmTask', 'cancelTask', 'archiveTask', 'deleteTask', 'restoreTask', 'getLogs', 'getDiff', 'getChecks']);
export const readMethods = Object.freeze(['status', 'listProjects', 'getProject', 'listTasks', 'getTask', 'getLogs', 'getDiff', 'getChecks']);
export const MAX_COMMAND_BYTES = 64 * 1024;
export const MAX_RESULT_BYTES = 1024 * 1024;
const invalid = () => { throw Object.assign(Error('Invalid control operation'), {code: 'invalid_argument'}); };
export const validId = x => typeof x === 'string' && x.length > 0 && x.length <= 128 && !/[\s\x00-\x1f\x7f]/u.test(x);
const object = (x, fields) => x && typeof x === 'object' && !Array.isArray(x) && Object.keys(x).every(k => fields.includes(k));
const revision = x => Number.isSafeInteger(x) && x > 0;

export function validateRpcPayload(payload) {
  if (!object(payload, ['method', 'params']) || !rpcMethods.includes(payload.method) || !Array.isArray(payload.params)) invalid();
  const {method, params: args} = payload;
  let valid = false;
  if (['status', 'listProjects'].includes(method)) valid = args.length === 0;
  if (['getProject', 'getTask', 'getLogs', 'getDiff', 'getChecks'].includes(method)) valid = args.length === 1 && validId(args[0]);
  if (method === 'listTasks') valid = args.length === 1 && object(args[0], ['projectId', 'includeArchived', 'includeDeleted']) && validId(args[0].projectId) && ['includeArchived', 'includeDeleted'].every(k => args[0][k] === undefined || typeof args[0][k] === 'boolean');
  if (method === 'startTask') valid = args.length === 1 && object(args[0], ['projectId', 'prompt', 'title', 'requestId', 'parentTaskId']) && validId(args[0].projectId) && validId(args[0].requestId) && typeof args[0].prompt === 'string' && args[0].prompt.trim().length > 0 && args[0].prompt.length <= 20000 && (args[0].title === undefined || typeof args[0].title === 'string' && args[0].title.length <= 200) && (args[0].parentTaskId === undefined || args[0].parentTaskId === null || validId(args[0].parentTaskId));
  if (['confirmTask', 'cancelTask'].includes(method)) valid = args.length === 2 && validId(args[0]) && object(args[1], method === 'confirmTask' ? ['revision', 'requestId'] : ['requestId']) && validId(args[1].requestId) && (method !== 'confirmTask' || revision(args[1].revision));
  if (['archiveTask', 'deleteTask', 'restoreTask'].includes(method)) valid = args.length === 2 && validId(args[0]) && object(args[1], method === 'archiveTask' ? ['requestId', 'metadataRevision', 'archived'] : ['requestId', 'metadataRevision']) && validId(args[1].requestId) && revision(args[1].metadataRevision) && (method !== 'archiveTask' || typeof args[1].archived === 'boolean');
  if (!valid) invalid();
  return structuredClone(payload);
}

export function validateCommandEnvelope(command, {deviceId, now = Date.now()} = {}) {
  if (!object(command, ['protocolVersion', 'requestId', 'operationId', 'deviceId', 'type', 'projectId', 'taskId', 'expectedRevision', 'payload', 'issuedAt', 'expiresAt']) || command.protocolVersion !== 1 || !['requestId', 'operationId', 'deviceId'].every(k => validId(command[k])) || deviceId !== undefined && command.deviceId !== deviceId) invalid();
  let size;
  try { size = Buffer.byteLength(JSON.stringify(command)); } catch { invalid(); }
  if (size > MAX_COMMAND_BYTES) invalid();
  const issued = typeof command.issuedAt === 'string' ? Date.parse(command.issuedAt) : NaN;
  const expires = typeof command.expiresAt === 'string' ? Date.parse(command.expiresAt) : NaN;
  if (!Number.isFinite(issued) || !Number.isFinite(expires) || new Date(issued).toISOString() !== command.issuedAt || new Date(expires).toISOString() !== command.expiresAt || expires <= now || issued > now + 5000 || expires <= issued || expires - issued > 60000) invalid();
  if (command.type === 'task_rpc') {
    if (['projectId', 'taskId', 'expectedRevision'].some(k => Object.hasOwn(command, k))) invalid();
    validateRpcPayload(command.payload);
  }
  else if (['switch_task', 'focus_window', 'open_project'].includes(command.type)) {
    if (!validId(command.projectId) || command.type !== 'open_project' && (!validId(command.taskId) || !revision(command.expectedRevision)) || command.type === 'open_project' && (command.taskId !== undefined || command.expectedRevision !== undefined) || !object(command.payload, ['focus', 'appId']) || command.payload.focus !== undefined && typeof command.payload.focus !== 'boolean' || command.payload.appId !== undefined && !validId(command.payload.appId)) invalid();
  } else invalid();
  return structuredClone(command);
}

export function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(',')}}`;
}
