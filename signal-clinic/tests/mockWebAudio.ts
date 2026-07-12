/**
 * A minimal, faithful-enough Web Audio mock so the *actual* module classes
 * (not reimplemented test logic) can run end-to-end in plain Node. This is
 * not a full Web Audio implementation — only the surface every Phase 1
 * module actually calls: createBuffer, createBufferSource,
 * createBiquadFilter (lowpass/highpass/notch — the only types any module
 * uses), and a destination sink for startRendering().
 *
 * Biquad coefficients follow the same RBJ cookbook formulas the real
 * Web Audio API's BiquadFilterNode uses, so filtering behaviour here
 * should match a real browser closely, not just "process without
 * throwing."
 */

export class MockAudioBuffer {
  readonly numberOfChannels: number;
  readonly length: number;
  readonly sampleRate: number;
  private channels: Float32Array[];

  constructor(numberOfChannels: number, length: number, sampleRate: number) {
    this.numberOfChannels = numberOfChannels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }

  getChannelData(channel: number): Float32Array {
    return this.channels[channel];
  }

  copyToChannel(source: Float32Array, channel: number): void {
    this.channels[channel].set(source.subarray(0, this.length));
  }
}

interface Biquad {
  b0: number; b1: number; b2: number; a1: number; a2: number;
}

function designBiquad(type: 'lowpass' | 'highpass' | 'notch', freq: number, q: number, sampleRate: number): Biquad {
  const w0 = (2 * Math.PI * freq) / sampleRate;
  const cosw0 = Math.cos(w0);
  const sinw0 = Math.sin(w0);
  const alpha = sinw0 / (2 * Math.max(q, 1e-6));

  let b0: number, b1: number, b2: number;
  const a0 = 1 + alpha;
  const a1 = -2 * cosw0;
  const a2 = 1 - alpha;

  if (type === 'lowpass') {
    b0 = (1 - cosw0) / 2;
    b1 = 1 - cosw0;
    b2 = (1 - cosw0) / 2;
  } else if (type === 'highpass') {
    b0 = (1 + cosw0) / 2;
    b1 = -(1 + cosw0);
    b2 = (1 + cosw0) / 2;
  } else {
    // notch
    b0 = 1;
    b1 = -2 * cosw0;
    b2 = 1;
  }

  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

function applyBiquad(data: Float32Array, c: Biquad): Float32Array {
  const out = new Float32Array(data.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < data.length; i++) {
    const x0 = data[i];
    const y0 = c.b0 * x0 + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    out[i] = y0;
    x2 = x1; x1 = x0;
    y2 = y1; y1 = y0;
  }
  return out;
}

abstract class MockAudioNode {
  inputs: MockAudioNode[] = [];
  connect(target: MockAudioNode): MockAudioNode {
    target.inputs.push(this);
    return target;
  }
  disconnect(): void {
    this.inputs = [];
  }
  abstract process(sampleRate: number, length: number): Float32Array[];

  protected mixInputs(sampleRate: number, length: number): Float32Array[] {
    if (this.inputs.length === 0) return [new Float32Array(length)];
    const results = this.inputs.map((n) => n.process(sampleRate, length));
    const channelCount = Math.max(...results.map((r) => r.length));
    const out: Float32Array[] = Array.from({ length: channelCount }, () => new Float32Array(length));
    for (const result of results) {
      for (let ch = 0; ch < result.length; ch++) {
        for (let i = 0; i < length; i++) out[ch][i] += result[ch][i];
      }
    }
    return out;
  }
}

class MockBufferSourceNode extends MockAudioNode {
  buffer: MockAudioBuffer | null = null;
  start(): void {
    /* rendering is pull-based here, not push/schedule-based — no-op */
  }
  process(): Float32Array[] {
    if (!this.buffer) return [new Float32Array(0)];
    return Array.from({ length: this.buffer.numberOfChannels }, (_, ch) => this.buffer!.getChannelData(ch).slice());
  }
}

class MockBiquadFilterNode extends MockAudioNode {
  type: 'lowpass' | 'highpass' | 'notch' | 'bandpass' | 'highshelf' = 'lowpass';
  frequency = { value: 350 };
  Q = { value: 1 };

  process(sampleRate: number, length: number): Float32Array[] {
    const inputs = this.mixInputs(sampleRate, length);
    const supportedType = this.type === 'lowpass' || this.type === 'highpass' || this.type === 'notch' ? this.type : 'lowpass';
    const coef = designBiquad(supportedType, this.frequency.value, this.Q.value, sampleRate);
    return inputs.map((data) => applyBiquad(data, coef));
  }
}

class MockDestinationNode extends MockAudioNode {
  process(sampleRate: number, length: number): Float32Array[] {
    return this.mixInputs(sampleRate, length);
  }
}

export class MockOfflineAudioContext {
  readonly numberOfChannels: number;
  readonly length: number;
  readonly sampleRate: number;
  readonly destination = new MockDestinationNode();

  constructor(numberOfChannels: number, length: number, sampleRate: number) {
    this.numberOfChannels = numberOfChannels;
    this.length = length;
    this.sampleRate = sampleRate;
  }

  createBuffer(numberOfChannels: number, length: number, sampleRate: number): MockAudioBuffer {
    return new MockAudioBuffer(numberOfChannels, length, sampleRate);
  }

  createBufferSource(): MockBufferSourceNode {
    return new MockBufferSourceNode();
  }

  createBiquadFilter(): MockBiquadFilterNode {
    return new MockBiquadFilterNode();
  }

  async startRendering(): Promise<MockAudioBuffer> {
    const channels = this.destination.process(this.sampleRate, this.length);
    const out = new MockAudioBuffer(Math.max(this.numberOfChannels, channels.length), this.length, this.sampleRate);
    for (let ch = 0; ch < out.numberOfChannels; ch++) {
      if (channels[ch]) out.copyToChannel(channels[ch], ch);
    }
    return out;
  }
}
