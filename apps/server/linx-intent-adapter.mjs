const contextKeys = ['ownerId', 'deviceId', 'projectId', 'taskId', 'contextVersion'];
const definitions = [
  ['list_tasks', 'listTasks', 'read', []],
  ['get_task_snapshot', 'getTaskSnapshot', 'read', ['taskId']],
  ['get_projects', 'getProjects', 'read', []],
  ['switch_task', 'switchTask', 'selection', ['taskId']],
  ['propose_task', 'proposeTask', 'draft', ['prompt', 'title']],
  ['propose_followup', 'proposeFollowup', 'draft', ['taskId', 'deltaPrompt']],
];

export const intentDefinitions = Object.freeze(definitions.map(([action, operation, kind]) =>
  Object.freeze({action, operation, kind})));

const record = value => value && typeof value === 'object' && !Array.isArray(value);
const id = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 128;
const fail = (code, message) => { throw Object.assign(new Error(message), {code}); };

function freezeContext(context) {
  if (!record(context) || Object.keys(context).some(key => !contextKeys.includes(key)) ||
      !['ownerId', 'deviceId', 'projectId'].every(key => id(context[key])) ||
      context.taskId !== null && !id(context.taskId) ||
      !Number.isSafeInteger(context.contextVersion) || context.contextVersion < 1) {
    fail('invalid_context', 'Invalid authenticated context');
  }
  return Object.freeze(Object.fromEntries(contextKeys.map(key => [key, context[key]])));
}

const contextFingerprint = context => JSON.stringify(contextKeys.map(key => context[key]));

export function mapLinxIntent(input, context) {
  const target = freezeContext(context);
  if (!record(input) || Object.keys(input).some(key => !['action', 'args'].includes(key))) fail('invalid_intent', 'Invalid intent');
  const definition = definitions.find(([action]) => action === input.action);
  if (!definition) fail('unsupported_intent', 'Unsupported voice intent');
  const [, operation, kind, allowed] = definition;
  const args = input.args ?? {};
  if (!record(args)) fail('invalid_arguments', 'Invalid intent arguments');
  for (const key of ['ownerId', 'deviceId', 'projectId', 'contextVersion']) {
    if (Object.hasOwn(args, key) && args[key] !== target[key]) fail('context_mismatch', 'Intent context mismatch');
  }
  if (Object.keys(args).some(key => !allowed.includes(key))) fail('invalid_arguments', 'Invalid intent arguments');
  if (allowed.includes('taskId')) {
    if (!id(args.taskId)) fail('invalid_arguments', 'Invalid taskId');
    if (input.action !== 'switch_task' && args.taskId !== target.taskId) fail('context_mismatch', 'Intent task mismatch');
  }
  const promptKey = input.action === 'propose_task' ? 'prompt' : input.action === 'propose_followup' ? 'deltaPrompt' : null;
  if (promptKey && (typeof args[promptKey] !== 'string' || !args[promptKey].trim() || args[promptKey].length > 20000)) {
    fail('invalid_arguments', 'Invalid draft prompt');
  }
  if (args.title !== undefined && (typeof args.title !== 'string' || args.title.length > 200)) fail('invalid_arguments', 'Invalid draft title');
  return {operation, kind, args:Object.freeze({...args})};
}

// The authenticated phone route supplies context and authorization. Neither is
// inferred from provider text; only prepare's six actions are provider tools.
export function createLinxIntentAdapter({
  remoteTaskService, deviceGateway, authorizeConfirmation, now = Date.now,
  ttlMs = 120000, maxEntries = 128,
} = {}) {
  if (!Number.isFinite(ttlMs) || ttlMs < 1 || ttlMs > 3600000 ||
      !Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > 1024) {
    fail('configuration', 'Invalid intent cache configuration');
  }
  const service = remoteTaskService ?? deviceGateway;
  const requests = new Map();
  const keyFor = (context, requestId) => JSON.stringify([context.ownerId, requestId]);
  const prune = () => {
    for (const [key, entry] of requests) {
      if (!entry.pending && !entry.confirming && entry.expiresAt <= now()) requests.delete(key);
    }
  };
  async function prepare(input, context, {requestId} = {}) {
    const target = freezeContext(context);
    if (!id(requestId)) fail('invalid_arguments', 'requestId required');
    const intent = mapLinxIntent(input, target);
    const fingerprint = JSON.stringify([contextFingerprint(target), intent.operation,
      Object.entries(intent.args).sort(([left], [right]) => left.localeCompare(right))]);
    const key = keyFor(target, requestId);
    prune();
    let entry = requests.get(key);
    if (entry) {
      if (entry.fingerprint !== fingerprint) fail('request_conflict', 'requestId conflict');
      await entry.ready;
      if (entry.failure) fail(entry.failure, 'Remote task service unavailable');
      return structuredClone(entry.result);
    }
    if (requests.size >= maxEntries) fail('cache_full', 'Intent cache full; reconcile before retrying');
    entry = {fingerprint, context:target, pending:true, confirming:false, confirmed:false, expiresAt:Infinity};
    requests.set(key, entry);
    entry.ready = (async () => {
      try {
        if (intent.kind === 'draft') {
          entry.result = {...intent, context:target, requestId, status:'draft'};
        } else {
          if (typeof service?.[intent.operation] !== 'function') fail('provider_error', 'Remote task service unavailable');
          const result = await service[intent.operation](target, intent.args);
          const body = JSON.stringify(result ?? null);
          if (Buffer.byteLength(body) > 65536) fail('provider_error', 'Remote task response too large');
          entry.result = {...intent, requestId, status:'resolved', result:JSON.parse(body)};
        }
      } catch {
        entry.failure = 'provider_error';
      } finally {
        entry.pending = false;
        entry.expiresAt = now() + ttlMs;
      }
    })();
    await entry.ready;
    if (entry.failure) fail(entry.failure, 'Remote task service unavailable');
    return structuredClone(entry.result);
  }

  async function confirm(input, context, authorization) {
    const target = freezeContext(context);
    if (!record(input) || Object.keys(input).some(key => key !== 'requestId') || !id(input.requestId)) fail('invalid_arguments', 'requestId required');
    prune();
    const entry = requests.get(keyFor(target, input.requestId));
    if (!entry) fail('not_found', 'Draft unavailable or expired');
    if (contextFingerprint(entry.context) !== contextFingerprint(target)) fail('context_mismatch', 'Confirmation context mismatch');
    if (entry.pending || entry.result?.kind !== 'draft') fail('invalid_draft', 'Only a completed draft can be confirmed');
    if (entry.confirmed || entry.confirming) fail('already_confirmed', 'Draft already confirmed or confirmation pending');
    if (typeof authorizeConfirmation !== 'function') fail('authorization_required', 'Authenticated phone authorization required');
    entry.confirming = true;
    try {
      let allowed;
      try {
        allowed = await authorizeConfirmation({context:target, draft:structuredClone(entry.result), authorization});
      } catch {
        fail('authorization_unavailable', 'Phone authorization unavailable');
      }
      if (allowed !== true) fail('authorization_required', 'Authenticated phone authorization required');
      if (now() >= entry.expiresAt) fail('not_found', 'Draft expired during authorization');
      entry.confirmed = true;
      // A confirmed draft is a route handoff, never a Codex execution/approval.
      return {...structuredClone(entry.result), status:'confirmed'};
    } finally {
      entry.confirming = false;
    }
  }
  return {prepare, confirm};
}

// Only an explicitly injected, operator-authorized read-only probe may touch a
// provider. Configuration or a positive readiness response is not live voice.
export async function probeLinxReadiness({configured = false, probe} = {}) {
  const report = {configured:configured === true, readiness:'unavailable', live:false};
  if (!report.configured) return report;
  if (typeof probe !== 'function') return {...report, readiness:'unverified'};
  try {
    const result = await probe();
    return {...report, readiness:result?.ready === true ? 'ready' : 'unverified'};
  } catch {
    return {...report, readiness:'provider_error'};
  }
}
