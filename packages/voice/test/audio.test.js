import test from 'node:test';
import assert from 'node:assert/strict';
import OpusScript from 'opusscript';
import { createOutputDecoder } from '../src/audio.js';

test('decodes real Opus packets to bounded signed PCM at negotiated rates', () => {
  for (const rate of [16000, 24000]) {
    const encoder = new OpusScript(rate, 1, OpusScript.Application.AUDIO);
    const decoder = createOutputDecoder({ format: 'opus', sample_rate: rate, channels: 1 });
    try {
      const samples = rate * 0.02;
      const input = Buffer.alloc(samples * 2);
      for (let i = 0; i < samples; i++) input.writeInt16LE(Math.round(10000 * Math.sin(i * 0.1)), i * 2);
      const encoded = encoder.encode(input, samples);
      const pcm = decoder.decode(encoded);
      assert.equal(pcm.length, input.length);
      assert(pcm.some(value => value !== 0));
      assert.deepEqual(decoder.format, { format: 'pcm', sample_rate: rate, channels: 1 });
    } finally { encoder.delete(); decoder.close(); }
    assert.throws(() => decoder.decode(Buffer.from([1, 2])));
  }
});

test('PCM frames are copied and invalid formats, frames and closed decoders fail', () => {
  for (const params of [{}, { format: 'opus', sample_rate: 48000, channels: 1 }, { format: 'pcm', sample_rate: 16000, channels: 2 }]) {
    assert.throws(() => createOutputDecoder(params));
  }
  const decoder = createOutputDecoder({ format: 'pcm', sample_rate: 16000, channels: 1 });
  const data = Buffer.from([1, 0, 2, 0]);
  const output = decoder.decode(data);
  data.fill(0);
  assert.deepEqual([...output], [1, 0, 2, 0]);
  for (const bad of [Buffer.alloc(0), Buffer.alloc(3), Buffer.alloc(65538)]) assert.throws(() => decoder.decode(bad));
  decoder.close(); decoder.close();
  assert.throws(() => decoder.decode(Buffer.alloc(2)));
});
