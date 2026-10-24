export const DEFAULT_BODY_LIMIT = 1024 * 1024;
export const DEFAULT_RESPONSE_LIMIT = 2 * 1024 * 1024;
export const MAX_INFLIGHT = 32;
export const MAX_MEDIA_INFLIGHT = 8;
export const FRAME_LIMIT = 3 * 1024 * 1024;
export function credentials(machineId, machineKey) {
  if (typeof machineId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(machineId)) throw new Error('Invalid machine ID');
  if (typeof machineKey !== 'string' || !/^[A-Za-z0-9_-]{32,256}$/.test(machineKey)) throw new Error('Machine key must be 32-256 base64url characters');
}
export function bounded(value, fallback, max) {
  value ??= fallback;
  if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new Error('Invalid transport limit');
  return value;
}
export function route(method, path) {
  if (typeof path !== 'string' || path.length > 1024 || !path.startsWith('/api/') || /[%\\#\x00-\x20\x7f]/.test(path)) return null;
  const [pathname, query, extra] = path.split('?');
  if (extra !== undefined) return null;
  const id = '[A-Za-z0-9_-]{1,128}';
  let kind;
  if (method === 'GET' && pathname === '/api/health') kind = 'health';
  if (method === 'POST' && pathname === '/api/pair') kind = 'pair';
  if (method === 'POST' && pathname === '/api/unpair') kind = 'json';
  if (['GET','POST'].includes(method) && pathname === '/api/settings') kind = 'json';
  if (['GET','POST'].includes(method) && pathname === '/api/tasks') kind = 'json';
  if (method === 'GET' && new RegExp(`^/api/tasks/${id}$`).test(pathname)) kind = 'json';
  if (method === 'GET' && (new RegExp(`^/api/tasks/${id}/events$`).test(pathname) || new RegExp(`^/api/voice/sessions/${id}/events$`).test(pathname))) kind = 'events';
  if (method === 'POST' && new RegExp(`^/api/tasks/${id}/(messages|cancel|accept)$`).test(pathname)) kind = 'json';
  if (method === 'POST' && new RegExp(`^/api/tasks/${id}/approvals/${id}$`).test(pathname)) kind = 'json';
  if (method === 'POST' && new RegExp(`^/api/tasks/${id}/criteria/${id}$`).test(pathname)) kind = 'json';
  if (method === 'POST' && pathname === '/api/voice/sessions') kind = 'json';
  if (method === 'POST' && new RegExp(`^/api/voice/sessions/${id}/audio$`).test(pathname)) kind = 'binary';
  if (method === 'POST' && new RegExp(`^/api/voice/sessions/${id}/(stop|abort)$`).test(pathname)) kind = 'json';
  if (method === 'DELETE' && new RegExp(`^/api/voice/sessions/${id}$`).test(pathname)) kind = 'empty';
  if (!kind) return null;
  if (query !== undefined && (kind !== 'events' || !/^after=(0|[1-9][0-9]{0,14})$/.test(query))) return { error: 400 };
  return { kind, public: ['health','pair'].includes(kind), media: kind === 'binary' || (kind === 'events' && pathname.startsWith('/api/voice/')) };
}
export function atCapacity(entries, media) {
  return entries.size >= MAX_INFLIGHT || (media && [...entries.values()].filter(entry => entry.media).length >= MAX_MEDIA_INFLIGHT);
}
export function bearer(value) {
  return typeof value === 'string' && /^Bearer [A-Za-z0-9._~+\/-]{1,512}={0,2}$/.test(value);
}
export function requestType(method, kind, type) {
  if (method !== 'POST') return type === undefined || type === '' || /^application\/json(?:;\s*charset=utf-8)?$/i.test(type);
  if (typeof type !== 'string') return false;
  return kind === 'binary' ? type === 'application/octet-stream' : /^application\/json(?:;\s*charset=utf-8)?$/i.test(type);
}
export function decodeBody(encoded, limit) {
  if (typeof encoded !== 'string' || encoded.length > Math.ceil(limit / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw new Error('Invalid body');
  const result = Buffer.from(encoded, 'base64');
  if (result.length > limit || result.toString('base64') !== encoded) throw new Error('Invalid body');
  return result;
}
export function responseType(type) {
  return typeof type === 'string' && /^(application\/json|application\/octet-stream|audio\/pcm|audio\/opus|image\/png|image\/jpeg)(;\s*charset=utf-8)?$/i.test(type);
}
export function readBody(stream, limit) {
  return new Promise((resolve,reject) => {
    let size = 0, over = false; const chunks = [];
    stream.on('data', chunk => { size += chunk.length; if (over) return; if (size > limit) { over = true; chunks.length = 0; reject(new Error('Body limit exceeded')); } else chunks.push(chunk); });
    stream.on('end', () => { if (!over) resolve(Buffer.concat(chunks)); });
    stream.on('error', () => reject(new Error('Transport read failed')));
    stream.on('aborted', () => reject(new Error('Transport read failed')));
  });
}
