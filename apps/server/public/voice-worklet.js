class VoxCodePcm16 extends AudioWorkletProcessor {
  constructor() {super();this.frame = new Int16Array(320);this.offset = 0;}
  process(inputs, outputs) {
    for (const output of outputs) for (const channel of output) channel.fill(0);
    const input = inputs[0]?.[0];
    if (!input || sampleRate !== 16000) return true;
    for (const value of input) {
      const sample = Math.max(-1, Math.min(1, value));
      this.frame[this.offset++] = Math.round(sample * (sample < 0 ? 32768 : 32767));
      if (this.offset === 320) {const frame = this.frame;this.frame = new Int16Array(320);this.offset = 0;this.port.postMessage(frame.buffer, [frame.buffer]);}
    }
    return true;
  }
}
registerProcessor('voxcode-pcm16', VoxCodePcm16);
