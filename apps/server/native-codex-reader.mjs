const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES = 1000;
const AUTHORITY_KINDS = new Set(['stored-history', 'shared-backend']);
const ALL_SOURCE_KINDS = [
  'cli', 'vscode', 'exec', 'appServer', 'subAgent', 'subAgentReview',
  'subAgentCompact', 'subAgentThreadSpawn', 'subAgentOther', 'unknown',
];

function fail(code, message) {
  return Object.assign(new Error(message), {code});
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function requireRequest(request) {
  if (typeof request !== 'function') throw fail('configuration', 'Native Codex request transport is required');
}

function requireAuthority(authority) {
  if (!authority || !AUTHORITY_KINDS.has(authority.kind)) throw fail('configuration', 'Native Codex authority is invalid');
  if (typeof authority.executionTarget !== 'string' || authority.executionTarget.length === 0 || authority.executionTarget.length > 64) {
    throw fail('configuration', 'Native Codex execution target is invalid');
  }
  if (typeof authority.backendId !== 'string' || authority.backendId.length === 0 || authority.backendId.length > 256) {
    throw fail('configuration', 'Native Codex backend identity is invalid');
  }
}

function pagingOptions({pageSize = DEFAULT_PAGE_SIZE, maxPages = DEFAULT_MAX_PAGES, maxRecords = 10000, maxBytes = 16 * 1024 * 1024} = {}) {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 1000) throw fail('configuration', 'Native Codex page size is invalid');
  if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 10000) throw fail('configuration', 'Native Codex page limit is invalid');
  if (!Number.isSafeInteger(maxRecords) || maxRecords < pageSize || maxRecords > 1_000_000) throw fail('configuration', 'Native Codex record limit is invalid');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1024 || maxBytes > 256 * 1024 * 1024) throw fail('configuration', 'Native Codex byte limit is invalid');
  return {pageSize, maxPages, maxRecords, maxBytes};
}

function pageResponse(response, method) {
  if (!response || typeof response !== 'object' || !Array.isArray(response.data)) {
    throw fail('invalid_response', `Native Codex ${method} returned an invalid page`);
  }
  if (response.nextCursor !== null && response.nextCursor !== undefined && typeof response.nextCursor !== 'string') {
    throw fail('invalid_response', `Native Codex ${method} returned an invalid cursor`);
  }
  return response;
}

async function collectPages(request, method, initialParams, {pageSize, maxPages, maxRecords, maxBytes}) {
  const pages = [];
  const seen = new Set();
  let cursor = null;
  let bytes = 0;
  for (let page = 0; page < maxPages; page += 1) {
    const params = {...initialParams, limit: pageSize, ...(cursor === null ? {} : {cursor})};
    const response = pageResponse(await request(method, params), method);
    const values = response.data.map(clone);
    bytes += Buffer.byteLength(JSON.stringify(values));
    if (pages.length + values.length > maxRecords) throw fail('pagination_limit', `Native Codex ${method} exceeded its record limit`);
    if (bytes > maxBytes) throw fail('response_too_large', `Native Codex ${method} exceeded its byte limit`);
    pages.push(...values);
    const nextCursor = response.nextCursor ?? null;
    if (nextCursor === null) return pages;
    if (seen.has(nextCursor)) throw fail('invalid_response', `Native Codex ${method} repeated a cursor`);
    seen.add(nextCursor);
    cursor = nextCursor;
  }
  throw fail('pagination_limit', `Native Codex ${method} exceeded its pagination limit`);
}

function sourceFor(authority, observedAt = new Date().toISOString()) {
  return {
    authority: authority.kind,
    executionTarget: authority.executionTarget,
    backendId: authority.backendId,
    observedAt,
  };
}

function normalizeProject(project) {
  if (!project || typeof project !== 'object' || typeof project.id !== 'string' || !Array.isArray(project.roots)) {
    throw fail('invalid_response', 'Native Codex returned an invalid project');
  }
  return clone(project);
}

function normalizeThread(thread) {
  if (!thread || typeof thread !== 'object' || typeof thread.id !== 'string') {
    throw fail('invalid_response', 'Native Codex returned an invalid thread');
  }
  return clone(thread);
}

function requireThreadId(threadId) {
  if (typeof threadId !== 'string' || threadId.length === 0 || threadId.length > 256) {
    throw fail('invalid_argument', 'Native Codex thread ID is invalid');
  }
}

async function collectItems(request, threadId, turnId, options) {
  const entries = await collectPages(request, 'thread/items/list', {threadId, turnId}, options);
  return entries.map(entry => {
    // Current protocol wraps an item with turnId/timestamps. Supporting the
    // bare shape keeps the adapter useful with older stored-history fixtures.
    if (entry && typeof entry === 'object' && entry.item && typeof entry.item === 'object') return clone(entry.item);
    return clone(entry);
  });
}

export function createNativeCodexReader({request, authority, pageSize = DEFAULT_PAGE_SIZE, maxPages = DEFAULT_MAX_PAGES, maxRecords = 10000, maxBytes = 16 * 1024 * 1024} = {}) {
  requireRequest(request);
  requireAuthority(authority);
  const options = pagingOptions({pageSize, maxPages, maxRecords, maxBytes});

  async function inventory() {
    const observedAt = new Date().toISOString();
    const projects = (await collectPages(request, 'project/list', {}, options)).map(normalizeProject);
    const seenThreads = new Set();
    const threads = [];
    // The protocol's archived filter is exclusive. Fetch both views so an
    // inventory does not silently omit archived native threads.
    for (const archived of [false, true]) {
      const page = await collectPages(request, 'thread/list', {archived, sourceKinds: ALL_SOURCE_KINDS}, options);
      for (const value of page.map(normalizeThread)) {
        if (!seenThreads.has(value.id)) {
          seenThreads.add(value.id);
          threads.push(value);
        }
      }
    }
    return {
      projects,
      threads,
      source: sourceFor(authority, observedAt),
    };
  }

  async function readThread(threadId) {
    requireThreadId(threadId);
    const observedAt = new Date().toISOString();
    const response = await request('thread/read', {threadId});
    if (!response || typeof response !== 'object' || !response.thread) throw fail('invalid_response', 'Native Codex returned an invalid thread read');
    const thread = normalizeThread(response.thread);
    const turns = await collectPages(request, 'thread/turns/list', {threadId, itemsView: 'summary'}, options);
    const completeTurns = [];
    for (const turn of turns) {
      if (!turn || typeof turn !== 'object' || typeof turn.id !== 'string') throw fail('invalid_response', 'Native Codex returned an invalid turn');
      const items = await collectItems(request, threadId, turn.id, options);
      completeTurns.push({...clone(turn), items, itemsView: 'full'});
    }
    return {
      thread,
      turns: completeTurns,
      source: {...sourceFor(authority, observedAt), statusSource: authority.kind},
    };
  }

  async function observeStatus(threadId) {
    requireThreadId(threadId);
    const response = await request('thread/read', {threadId});
    if (!response || !response.thread || typeof response.thread !== 'object') throw fail('invalid_response', 'Native Codex returned an invalid status read');
    const thread = normalizeThread(response.thread);
    return {
      threadId: thread.id,
      status: clone(thread.status ?? {type: 'unknown'}),
      live: authority.kind === 'shared-backend',
      statusSource: authority.kind,
      source: sourceFor(authority),
    };
  }

  function reconnect({request: nextRequest, backendId} = {}) {
    requireRequest(nextRequest);
    if (backendId !== authority.backendId) throw fail('backend_mismatch', 'Native Codex reconnect backend identity changed');
    return createNativeCodexReader({request: nextRequest, authority, ...options});
  }

  return Object.freeze({inventory, readThread, observeStatus, reconnect});
}

export {DEFAULT_PAGE_SIZE, DEFAULT_MAX_PAGES};
