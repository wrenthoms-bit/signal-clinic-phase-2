import { BaseModule, type ModuleMeta } from '../../types/module';
import { renderThroughGraph } from '../../core/bufferUtils';
import { fftInPlace, nextPowerOfTwo } from '../../core/fft';

/**
 * Step 2a of the stems chain (paired with De-bleed, which is ML-backed and
 * deferred to Phase 2 — see spec §5.2 and §7). Targets stationary electrical
 * noise: amp buzz, ground hum. Runs before De-click (step 3) because
 * leftover hum in the noise floor throws false positives at transient
 * detectors.
 *
 * Uses real BiquadFilterNode notches (type: 'notch') rendered through an
 * OfflineAudioContext rather than a hand-rolled IIR — this is exactly the
 * case where a stock Web Audio node is the right tool, per spec §9.
 */
export class DeHum extends BaseModule {
  readonly meta: ModuleMeta = {
    id: 'dehum',
    displayName: 'De-hum',
    chain: 'stems',
    order: 2,
    requiresML: false,
    processingMode: 'realtime',
    introducesLatency: false,
    description: 'Notches electrical hum at its fundamental and harmonics.',
    parameters: [
      { id: 'fundamental', label: 'Fundamental', min: 0, max: 65, default: 0, unit: 'Hz', step: 0.1 }, // 0 = auto-detect
      { id: 'harmonics', label: 'Harmonics', min: 0, max: 6, default: 4, unit: '', step: 1 },
      { id: 'q', label: 'Notch Q', min: 5, max: 60, default: 30, unit: '', step: 1 },
    ],
  };

  constructor() {
    super();
    this.initDefaults();
  }

  async processOffline(input: AudioBuffer, ctx: OfflineAudioContext): Promise<AudioBuffer> {
    let fundamental = this.getParameter('fundamental');
    if (fundamental <= 0) {
      fundamental = this.detectFundamental(input);
    }
    const harmonics = Math.round(this.getParameter('harmonics'));
    const q = this.getParameter('q');

    if (fundamental <= 0) return input; // nothing detected — pass through

    const ContextCtor = ctx.constructor as new (n: number, l: number, sr: number) => OfflineAudioContext;
    return renderThroughGraph(input, (offlineCtx, source) => {
      let node: AudioNode = source;
      for (let h = 1; h <= harmonics + 1; h++) {
        const freq = fundamental * h;
        if (freq >= offlineCtx.sampleRate / 2) break;
        const notch = offlineCtx.createBiquadFilter();
        notch.type = 'notch';
        notch.frequency.value = freq;
        notch.Q.value = q;
        node.connect(notch);
        node = notch;
      }
      return node;
    }, ContextCtor);
  }

  /** Searches the 45–65Hz band (covers 50Hz/60Hz mains + regional drift) for the strongest FFT peak. */
  private detectFundamental(buffer: AudioBuffer): number {
    const sr = buffer.sampleRate;
    const fftSize = nextPowerOfTwo(Math.min(buffer.length, sr * 2)); // ~2s window for good low-freq resolution
    const mono = this.downmix(buffer, fftSize);

    const re = Float64Array.from(mono);
    const im = new Float64Array(fftSize);
    fftInPlace(re, im, false);

    const binHz = sr / fftSize;
    const loBin = Math.max(1, Math.floor(45 / binHz));
    const hiBin = Math.min(fftSize / 2 - 1, Math.ceil(65 / binHz));

    let bestBin = -1;
    let bestMag = 0;
    for (let bin = loBin; bin <= hiBin; bin++) {
      const mag = Math.hypot(re[bin], im[bin]);
      if (mag > bestMag) {
        bestMag = mag;
        bestBin = bin;
      }
    }
    return bestBin >= 0 ? bestBin * binHz : 0;
  }

  private downmix(buffer: AudioBuffer, size: number): Float64Array {
    const out = new Float64Array(size);
    const channels = buffer.numberOfChannels;
    for (let ch = 0; ch < channels; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < size && i < data.length; i++) {
        out[i] += data[i] / channels;
      }
    }
    return out;
  }
}
