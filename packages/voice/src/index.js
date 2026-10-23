import WebSocket from 'ws';

export function createLinxSession({ config, onEvent = () => {}, WebSocketImpl = WebSocket, tools = [] }) {
  let url;
  try { url = new URL(config.url); } catch { throw new Error('Invalid Linx URL'); }
  if (url.protocol !== 'wss:' || url.username || url.password || url.search || url.hash) throw new Error('Linx requires a credential-free WSS URL');
  if (typeof config.token !== 'string' || !config.token.trim() || /[\s\x00-\x1f\x7f]/.test(config.token)) throw new Error('Invalid Linx token');
  if (!/^([\da-f]{2}:){5}[\da-f]{2}$/i.test(config.deviceId)) throw new Error('Invalid device MAC address');
  if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(config.clientId)) throw new Error('Invalid client UUID');
  const timeout = config.handshakeTimeoutMs ?? 10000;
  if (!Number.isFinite(timeout) || timeout < 1 || timeout > 60000) throw new Error('Invalid handshake timeout');
  const registry = new Map();
  for (const tool of tools) {
    if (!tool || typeof tool.name !== 'string' || registry.has(tool.name) || typeof tool.invoke !== 'function' || !tool.inputSchema) throw new Error('Invalid tool registration');
    registry.set(tool.name, tool);
  }
  let socket, state = 'idle', listening = false, sessionId, timer, pending, resolveConnect, rejectConnect;
  const requests = new Map();
  const emit = event => { try { onEvent(event); } catch { /* Consumer errors cannot crash transport callbacks. */ } };
  const send = value => socket.send(JSON.stringify(value));
  const control = value => send({ ...(sessionId ? { session_id: sessionId } : {}), ...value });
  const requireReady = () => { if (state !== 'ready') throw new Error('Linx session is not ready'); };
  function finish(message, report = true) {
    if (state === 'closed') return;
    state = 'closed'; listening = false; clearTimeout(timer);
    rejectConnect?.(new Error(message)); resolveConnect = rejectConnect = undefined;
    if (report) emit({ type: 'error', message });
    try { socket?.close(); } catch { /* Already disconnected. */ }
  }
  async function mcp(payload) {
    emit({ type: 'mcp', payload });
    if (state !== 'ready') return;
    if (payload?.jsonrpc !== '2.0' || !['string','number'].includes(typeof payload.id) || typeof payload.method !== 'string') return;
    const key = `${typeof payload.id}:${payload.id}`;
    if (!requests.has(key)) {
      if (requests.size >= 256) { finish('Linx MCP request limit reached'); return; }
      requests.set(key, (async () => {
        const base = { jsonrpc: '2.0', id: payload.id };
        if (payload.method === 'initialize') return { ...base, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'VoxCode', version: '0.1.0' } } };
        if (payload.method === 'tools/list') return { ...base, result: { tools: [...registry.values()].map(({name,description,inputSchema}) => ({name,description,inputSchema})), nextCursor: null } };
        if (payload.method === 'tools/call') {
          const tool = registry.get(payload.params?.name);
          if (!tool) return { ...base, error: { code: -32601, message: 'Unknown tool' } };
          const args = payload.params?.arguments ?? {};
          if (!args || typeof args !== 'object' || Array.isArray(args)) return { ...base, error: { code: -32602, message: 'Invalid tool arguments' } };
          try { const result = await tool.invoke(args); return { ...base, result: { content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result ?? null) }], isError: false } }; }
          catch { return { ...base, error: { code: -32603, message: 'Tool execution failed' } }; }
        }
        return { ...base, error: { code: -32601, message: 'Unknown method' } };
      })());
    }
    const response = await requests.get(key);
    if (state === 'ready') { try { send({ type: 'mcp', payload: response }); } catch { finish('Linx send failed'); } }
  }
  return {
    connect() {
      if (pending) return pending;
      if (state !== 'idle') return Promise.reject(new Error('Linx session is closed'));
      state = 'connecting';
      pending = new Promise((resolve,reject) => { resolveConnect = resolve; rejectConnect = reject; });
      timer = setTimeout(() => finish('Linx handshake timed out'), timeout);
      try {
        socket = new WebSocketImpl(url.href, { headers: { Authorization: `Bearer ${config.token}`, 'Device-Id': config.deviceId, 'Client-Id': config.clientId, 'Protocol-Version': '1' }, maxPayload: 1024 * 1024, followRedirects: false, handshakeTimeout: timeout });
        socket.on('open', () => {
          if (state !== 'connecting') return;
          try { send({ type: 'hello', version: 1, features: { mcp: true }, transport: 'websocket', audio_params: { format: 'pcm', sample_rate: 16000, channels: 1, bit_depth: 16, endianness: 'little', frame_duration: 20, frame_size: 320, sample_format: 'signed_int16', play_buffer_duration: 1000 } }); } catch { finish('Linx send failed'); }
        });
        socket.on('message', (data, binary) => {
          if (state === 'closed') return;
          if (binary) { if (state === 'ready') emit({type:'audio',data:Buffer.from(data)}); return; }
          let message;
          try { message = JSON.parse(data.toString()); } catch { finish('Invalid Linx message'); return; }
          if (message?.type === 'hello' && state === 'connecting') {
            const audio = message.audio_params;
            if (message.transport !== 'websocket' || !audio || !['pcm','opus'].includes(audio.format) || ![16000,24000].includes(audio.sample_rate) || audio.channels !== 1) { finish('Invalid Linx hello'); return; }
            sessionId = typeof message.session_id === 'string' ? message.session_id : undefined;
            state = 'ready'; clearTimeout(timer); resolveConnect(); resolveConnect = rejectConnect = undefined; emit({type:'ready',audioParams:{...audio}});
          } else if (state === 'ready' && message?.type === 'mcp') { void mcp(message.payload); }
          else if (state === 'ready' && message?.type === 'stt' && typeof message.text === 'string') emit({type:'stt',text:message.text});
          else if (state === 'ready' && message?.type === 'tts' && typeof message.state === 'string') emit({type:'tts',state:message.state,...(typeof message.text === 'string'?{text:message.text}:{})});
          else if (message?.type === 'error') finish('Linx server reported an error');
        });
        socket.on('error', () => finish('Linx connection failed'));
        socket.on('close', () => finish('Linx connection closed'));
      } catch { finish('Linx connection failed'); }
      return pending;
    },
    startListening() { requireReady(); if (listening) throw new Error('Already listening'); control({type:'listen',state:'start',mode:'manual'}); listening=true; },
    stopListening() { requireReady(); if (!listening) throw new Error('Not listening'); control({type:'listen',state:'stop',mode:'manual'}); listening=false; },
    sendAudio(buffer) { requireReady(); if (!listening) throw new Error('Not listening'); if (!(buffer instanceof Uint8Array) || buffer.byteLength === 0 || buffer.byteLength % 2 || buffer.byteLength > 32000) throw new Error('Expected 1 to 16000 PCM int16 samples'); if (socket.bufferedAmount > 1024 * 1024) throw new Error('Linx audio backpressure'); socket.send(buffer); },
    abort() { requireReady(); control({type:'abort',reason:'wake_word_detected'}); listening=false; },
    close() { finish('Linx session closed',false); },
  };
}
