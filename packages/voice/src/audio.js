import OpusScript from 'opusscript';

export function createOutputDecoder(params) {
  if (!params || !['pcm', 'opus'].includes(params.format) || ![16000, 24000].includes(params.sample_rate) || params.channels !== 1)
    throw new Error('Unsupported voice output format');
  let closed = false;
  const codec = params.format === 'opus' ? new OpusScript(params.sample_rate, 1, OpusScript.Application.AUDIO) : null;
  return {
    format: { format: 'pcm', sample_rate: params.sample_rate, channels: 1 },
    decode(data) {
      const limit = codec ? OpusScript.MAX_PACKET_SIZE : params.sample_rate * 2 * 0.12;
      if (closed || !(data instanceof Uint8Array) || !data.length || data.length > limit || (!codec && data.length % 2))
        throw new Error('Invalid voice output frame');
      const pcm = codec ? codec.decode(data) : Buffer.from(data);
      if (!pcm.length || pcm.length % 2 || pcm.length > params.sample_rate * 2 * 0.12) throw new Error('Invalid decoded voice output');
      return pcm;
    },
    close() { if (!closed) { closed = true; codec?.delete(); } },
  };
}
