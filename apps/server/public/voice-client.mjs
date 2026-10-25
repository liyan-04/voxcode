const format = Object.freeze({codec: 'pcm_s16le', sampleRate: 16000, channels: 1, frameMs: 20});
const id = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/u.test(value);
const stopped = () => Object.assign(Error('Voice capture ended'), {voiceReason: 'aborted'});

export function createVoiceClient({endpoint, mediaDevices = globalThis.navigator?.mediaDevices, AudioContextImpl = globalThis.AudioContext ?? globalThis.webkitAudioContext, AudioWorkletNodeImpl = globalThis.AudioWorkletNode, WebSocketImpl = globalThis.WebSocket, uuid = () => globalThis.crypto.randomUUID(), onState = () => {}, onPartial = () => {}, onTranscript = () => {}, onResult = () => {}, onAssistant = () => {}, executionTimeoutMs = 180000, noToolGraceMs = 2000, startTimeoutMs = 15000, finalTimeoutMs = 20000, captureTimeoutMs = 29000, maxFrames = 1450} = {}) {
  if (!mediaDevices?.getUserMedia || !AudioContextImpl || !AudioWorkletNodeImpl || !WebSocketImpl || ![startTimeoutMs, finalTimeoutMs, executionTimeoutMs, noToolGraceMs, captureTimeoutMs, maxFrames].every(value => Number.isSafeInteger(value) && value > 0) || captureTimeoutMs > 30000 || maxFrames > 1500) throw Error('Browser voice capture unavailable');
  const url = new URL(endpoint ?? '/ws/voice', globalThis.location?.href);
  if (!endpoint) url.protocol = url.protocol === 'https:' ? 'wss:' : url.protocol === 'http:' ? 'ws:' : url.protocol;
  if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/ws/voice' || url.protocol === 'ws:' && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw Error('Secure same-origin voice endpoint required');
  if (globalThis.location && url.origin.replace(/^ws/u, 'http') !== globalThis.location.origin) throw Error('Same-origin voice endpoint required');
  let active = null, contextVersion = 0, state = 'idle';
  const current = session => active === session;
  const notify = (value, reason, target) => {state = value;try {onState({state: value, reason, target});} catch {}};
  const stopTracks = stream => {for (const track of stream?.getTracks?.() ?? []) try {track.stop();} catch {}};
  const releaseCapture = session => {
    stopTracks(session.stream);
    if (session.node) {session.node.onprocessorerror = null;session.node.port.onmessage = null;try {session.node.port.close();} catch {}try {session.node.disconnect();} catch {}}
    try {session.source?.disconnect();} catch {}
  };
  const releaseAudio = session => {
    releaseCapture(session);
    for (const source of session.playback ?? []) try {source.stop();source.disconnect();} catch {}
    const audio = session.audio;session.audio = null;
    try {return Promise.resolve(audio?.close()).catch(() => {});} catch {return Promise.resolve();}
  };
  const dispose = session => {
    if (current(session)) active = null;
    clearTimeout(session.startTimer);clearTimeout(session.captureTimer);clearTimeout(session.finalTimer);clearTimeout(session.playbackTimer);clearTimeout(session.noToolTimer);
    session.cancel();session.resolveReady(false);
    if (session.socket) {session.socket.onopen = session.socket.onmessage = session.socket.onclose = session.socket.onerror = null;try {session.socket.close(1000, 'Voice capture ended');} catch {}}
    return releaseAudio(session);
  };
  const fail = (session, reason) => {if (!current(session)) return;void dispose(session);notify('error', reason, session.target);};
  const send = (session, message) => {
    if (!current(session) || session.socket?.readyState !== 1) throw Error('Voice connection unavailable');
    session.socket.send(JSON.stringify(message));
  };
  const finish = (session, tailExpired = false) => {
    if (session.writeReady || !current(session) || !session.stopped || !session.finalText || !session.finalAfterStop && !tailExpired) return;
    const text = session.finalText;void dispose(session);
    try {onTranscript(text, session.target);} catch {notify('error', 'draft_unavailable', session.target);return;}
    notify('idle', 'transcribed', session.target);
  };
  const completeSpeech = (session, reason) => {
    clearTimeout(session.finalTimer);clearTimeout(session.noToolTimer);
    const remaining = Math.max(0, (session.playbackUntil ?? 0) - (session.audio?.currentTime ?? 0));
    const completed = () => {if (!current(session)) return;void dispose(session);notify('idle', reason, session.target);};
    if (remaining > 0) session.playbackTimer = setTimeout(completed, Math.ceil(remaining * 1000));else completed();
  };
  const receive = (session, data) => {
    if (!current(session)) return;
    if (typeof data !== 'string') {
      if ((data?.byteLength ?? data?.size ?? 0) > 65536) return fail(session, 'invalid_event');
      if (!session.writeReady) return;
      if (!(data instanceof ArrayBuffer) || !session.output || !data.byteLength || data.byteLength % 2 || data.byteLength > 5760 || !session.audio) return fail(session, 'invalid_event');
      try {
        const audio = session.audio, startAt = Math.max(audio.currentTime, session.playbackUntil ?? 0);
        if (startAt - audio.currentTime > 5) return fail(session, 'backpressure');
        const samples = new DataView(data), buffer = audio.createBuffer(1, data.byteLength / 2, session.output.sampleRate), channel = buffer.getChannelData(0);
        for (let index = 0; index < channel.length; index++) channel[index] = samples.getInt16(index * 2, true) / 32768;
        const source = audio.createBufferSource();source.buffer = buffer;source.connect(audio.destination);session.playback.add(source);
        source.onended = () => {session.playback.delete(source);try {source.disconnect();} catch {}};
        source.start(startAt);session.playbackUntil = startAt + buffer.duration;
      } catch {fail(session, 'playback_unavailable');}
      return;
    }
    if (data.length > 65536) return fail(session, 'invalid_event');
    let event;try {event = JSON.parse(data);} catch {return fail(session, 'invalid_event');}
    if (!event || typeof event !== 'object' || Array.isArray(event) || !Number.isSafeInteger(event.seq) || event.seq < 0) return fail(session, 'invalid_event');
    if (event.seq <= session.lastSeq) return;
    if (event.captureId !== null && event.captureId !== undefined && event.captureId !== session.captureId) return;
    session.lastSeq = event.seq;
    if (event.type === 'error') return fail(session, 'provider_error');
    if (event.type === 'session.ready' && session.phase === 'session') {
      if (event.requestId !== session.sessionRequestId || event.contextVersion !== session.contextVersion || !id(event.voiceSessionId) || event.captureId !== null) return fail(session, 'invalid_event');
      session.phase = 'capture';session.captureRequestId = uuid();
      try {send(session, {type: 'capture.start', requestId: session.captureRequestId, captureId: session.captureId, contextVersion: session.contextVersion, format});} catch {fail(session, 'connection_failed');}
    } else if (event.type === 'capture.ready' && session.phase === 'capture') {
      if (event.requestId !== session.captureRequestId || event.captureId !== session.captureId || event.contextVersion !== session.contextVersion || Object.entries(format).some(([key, value]) => event.input?.[key] !== value)) return fail(session, 'format_unavailable');
      session.writeReady = event.writeReady === true;
      if (event.output && (event.output.codec !== 'pcm_s16le' || ![16000, 24000].includes(event.output.sampleRate) || event.output.channels !== 1)) return fail(session, 'format_unavailable');
      session.output = event.output ?? null;
      session.phase = 'recording';clearTimeout(session.startTimer);
      session.captureTimer = setTimeout(() => {void stop();}, captureTimeoutMs);
      notify('recording', null, session.target);session.resolveReady(true);
    } else if ((event.type === 'stt.partial' || event.type === 'stt.final') && event.captureId === session.captureId) {
      if (typeof event.text !== 'string' || event.text.length > 4000 || event.contextVersion !== undefined && event.contextVersion !== session.contextVersion) return fail(session, 'invalid_event');
      if (event.type === 'stt.final') {session.finalText = event.text.trim();session.finalAfterStop = session.phase === 'stopping';}
      try {onPartial(event.text, session.target);} catch {}
      finish(session);
    } else if (event.type === 'tool.started' && event.captureId === session.captureId && session.writeReady) {
      clearTimeout(session.noToolTimer);session.toolPending = true;notify('processing', null, session.target);
    } else if (event.type === 'tool.result' && event.captureId === session.captureId && session.writeReady) {
      const result = event.result;
      if (!result || typeof result !== 'object' || Array.isArray(result) || result.executionTarget !== session.target.executionTarget || result.projectId !== session.target.projectId || result.taskId !== undefined && !id(result.taskId) || session.target.taskId && result.taskId !== session.target.taskId) return fail(session, 'invalid_event');
      clearTimeout(session.noToolTimer);session.toolPending = false;session.hasResult = true;
      try {onResult(result, session.target);} catch {return fail(session, 'result_unavailable');}
    } else if (event.type === 'assistant.event' && event.captureId === session.captureId && session.writeReady) {
      if (!['start', 'sentence_start', 'stop'].includes(event.state) || event.text !== undefined && (typeof event.text !== 'string' || event.text.length > 4000)) return fail(session, 'invalid_event');
      try {onAssistant(event, session.target);} catch {}
      if (event.state !== 'stop') {clearTimeout(session.noToolTimer);if (session.phase !== 'recording') notify('speaking', null, session.target);}
      else if (session.stopped && !session.toolPending) {
        if (session.hasResult) completeSpeech(session, 'voice_complete');
        else if (session.finalText) {clearTimeout(session.noToolTimer);session.noToolTimer = setTimeout(() => {if (current(session) && !session.toolPending) completeSpeech(session, 'spoken_answer');}, noToolGraceMs);}
      }
    } else if (event.type === 'capture.stopped' && event.captureId === session.captureId && session.phase === 'stopping') {session.stopped = true;finish(session);}
  };
  async function start(target) {
    if (active) return false;
    if (!id(target?.projectId) || typeof target.draftKey !== 'string' || !target.draftKey.length || target.draftKey.length > 512 || /[\x00-\x1f\x7f]/u.test(target.draftKey) || target.taskId !== undefined && !id(target.taskId) || target.parentTaskId !== undefined && !id(target.parentTaskId) || target.taskId && target.parentTaskId) throw Error('A fixed voice draft target is required');
    if (target.executionTarget !== undefined && !['mac', 'server'].includes(target.executionTarget)) throw Error('A fixed voice draft target is required');
    const session = {playback: new Set(), target: Object.freeze({executionTarget: 'mac', ...target}), contextVersion: ++contextVersion, sessionRequestId: uuid(), captureId: uuid(), phase: 'permission', lastSeq: -1, frames: 0, finalText: '', stopped: false};
    session.ready = new Promise(resolve => {session.resolveReady = resolve;});session.cancelled = new Promise(resolve => {session.cancel = resolve;});
    const live = promise => Promise.race([promise, session.cancelled.then(() => {throw stopped();})]);
    active = session;notify('permission', null, session.target);
    session.startTimer = setTimeout(() => fail(session, 'connection_timeout'), startTimeoutMs);
    try {
      session.audio = new AudioContextImpl({sampleRate: 16000});await live(session.audio.resume());
      const permission = Promise.resolve(mediaDevices.getUserMedia({audio: {channelCount: 1, sampleRate: 16000, echoCancellation: true, noiseSuppression: true}, video: false}));
      permission.then(stream => {if (!current(session)) stopTracks(stream);}, () => {});
      session.stream = await live(permission);
      if (session.audio.sampleRate !== 16000 || !session.audio.audioWorklet?.addModule) throw Object.assign(Error('Voice format unavailable'), {voiceReason: 'format_unavailable'});
      await live(session.audio.audioWorklet.addModule('/voice-worklet.js'));
      session.source = session.audio.createMediaStreamSource(session.stream);
      session.node = new AudioWorkletNodeImpl(session.audio, 'voxcode-pcm16', {numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1]});
      session.node.onprocessorerror = () => fail(session, 'capture_unavailable');
      session.node.port.onmessage = ({data}) => {
        if (!current(session) || session.phase !== 'recording') return;
        if (!(data instanceof ArrayBuffer) || data.byteLength !== 640) return fail(session, 'format_unavailable');
        if (session.socket.bufferedAmount > 65536) return fail(session, 'backpressure');
        if (session.frames >= maxFrames) {void stop();return;}
        try {session.socket.send(data);session.frames++;} catch {fail(session, 'connection_failed');}
      };
      session.source.connect(session.node);session.node.connect(session.audio.destination);
      session.phase = 'session';notify('connecting', null, session.target);
      session.socket = new WebSocketImpl(url.href);session.socket.binaryType = 'arraybuffer';
      session.socket.onopen = () => {
        const context = {executionTarget: session.target.executionTarget, projectId: session.target.projectId, contextVersion: session.contextVersion, ...(session.target.taskId ? {taskId: session.target.taskId} : {}), ...(session.target.parentTaskId ? {parentTaskId: session.target.parentTaskId} : {})};
        try {send(session, {type: 'session.start', requestId: session.sessionRequestId, context});} catch {fail(session, 'connection_failed');}
      };
      session.socket.onmessage = event => receive(session, event.data);
      session.socket.onerror = () => fail(session, 'connection_failed');session.socket.onclose = () => fail(session, 'connection_closed');
      return await session.ready;
    } catch (error) {if (current(session)) fail(session, error?.name === 'NotAllowedError' ? 'microphone_denied' : error?.name === 'NotFoundError' ? 'microphone_missing' : error?.voiceReason ?? 'capture_unavailable');return false;}
  }
  async function stop() {
    const session = active;if (!session) return;
    if (session.phase !== 'recording') {if (session.phase !== 'stopping') await abort();return;}
    session.phase = 'stopping';clearTimeout(session.captureTimer);notify('stopping', null, session.target);
    if (session.writeReady) {releaseCapture(session);notify('processing', null, session.target);}else void releaseAudio(session);
    session.finalTimer = setTimeout(() => {if (session.writeReady) fail(session, 'execution_timeout');else if (session.stopped && session.finalText) finish(session, true);else fail(session, 'recognition_timeout');}, session.writeReady ? executionTimeoutMs : finalTimeoutMs);
    try {send(session, {type: 'capture.stop', requestId: uuid(), captureId: session.captureId});} catch {fail(session, 'connection_failed');}
  }
  async function abort() {
    const session = active;if (!session) return;
    notify('aborting', null, session.target);
    if (['capture', 'recording', 'stopping'].includes(session.phase)) try {send(session, {type: 'capture.abort', requestId: uuid(), captureId: session.captureId});} catch {}
    await dispose(session);if (contextVersion === session.contextVersion && !active) notify('idle', 'aborted', session.target);
  }
  return {start, stop, abort, close: abort, get state() {return state;}, get active() {return active !== null;}};
}
