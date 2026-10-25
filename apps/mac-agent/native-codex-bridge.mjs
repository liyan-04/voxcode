import {createNativeCodexReader} from '../server/native-codex-reader.mjs';

export function createNativeCodexBridge({request, executionTarget = 'mac', backendId, authorityKind = 'stored-history', pageSize, maxPages, maxRecords, maxBytes} = {}) {
  if (executionTarget !== 'mac') throw Object.assign(new Error('Native Mac bridge requires executionTarget=mac'), {code: 'target_mismatch'});
  const reader = createNativeCodexReader({
    request,
    authority: {kind: authorityKind, executionTarget, backendId},
    pageSize,
    maxPages,
    maxRecords,
    maxBytes,
  });
  function reconnect({request: nextRequest, executionTarget: nextTarget = executionTarget, backendId: nextBackendId = backendId} = {}) {
    if (nextTarget !== executionTarget) throw Object.assign(new Error('Native Codex executionTarget is immutable'), {code: 'target_mismatch'});
    if (nextBackendId !== backendId) throw Object.assign(new Error('Native Codex backend identity is immutable'), {code: 'backend_mismatch'});
    return createNativeCodexBridge({request: nextRequest, executionTarget, backendId: nextBackendId, authorityKind, pageSize, maxPages, maxRecords, maxBytes});
  }
  return Object.freeze({
    inventory: reader.inventory,
    readThread: reader.readThread,
    observeStatus: reader.observeStatus,
    reconnect,
  });
}
