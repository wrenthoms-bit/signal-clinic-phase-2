import { BaseModule, type ModuleMeta } from '../../types/module';
import { stft, istft } from '../../core/stft';
import { cloneBuffer } from '../../core/bufferUtils';
import { nextPowerOfTwo } from '../../core/fft';

/**
 * Step 4 of the stems chain. Reshapes the whole spectral envelope, so it
 * runs before Voice Cleaners (breath/de-ess thresholds should see the
 * dry signal, not one about to have its reverb tail removed). See §5.4.
 *
 * Baseline (Phase 1) approach: per-bin spectral subtraction where the
 * "noise" being subtracted is an exponentially-decaying estimate of the
 * reverb tail — each bin's floor estimate tracks slowly upward when
 * energy is high (feeding the tail) and decays toward silence, so
 * sustained reverberant energy gets modeled and subtracted while the
 * direct-sound onset of each new transient is left alone.
 *
 * This is a real, working baseline — not a stub — but single-channel
 * blind dereverberation has a hard quality ceiling regardless of
 * algorithm (see spec §5.4, §10). An ML-based quality mode is Phase 2.
 */
export class DeReverb extends BaseModule {
  readonly meta: ModuleMeta = {
    id: 'dereverb',
    displayName: 'De-reverb',
    chain: 'stems',
    order: 5,
    requiresML: false,
    processingMode: 'offline-only',
    introducesLatency: true,
    description: 'Strips room reflections via spectral-subtraction (baseline mode).',
    parameters: [
      { id: 'reductionAmount', label: 'Reduction Amount', min: 0, max: 100, default: 50, unit: '%', step: 1 },
      { id: 'decayEstimateMs', label: 'Est. Room Decay', min: 100, max: 2000, default: 600, unit: 'ms', step: 50 },
    ],
  };

  constructor() {
    super();
    this.initDefaults();
  }

  async processOffline(input: AudioBuffer, ctx: OfflineAudioContext): Promise<AudioBuffer> {
    const fftSize = 2048;
    const reduction = this.getParameter('reductionAmount') / 100;
    const decayMs = this.getParameter('decayEstimateMs');

    const out = cloneBuffer(ctx, input);

    for (let ch = 0; ch < out.numberOfChannels; ch++) {
      const data = out.getChannelData(ch);
      const result = stft(data, fftSize);

      // Decay coefficient per frame hop, derived from the estimated RT60-ish
      // decay time so the floor tracker's memory roughly matches the room.
      const hopMs = (result.hopSize / input.sampleRate) * 1000;
      const decayCoef = Math.exp(-hopMs / decayMs);

      const floor = new Float64Array(fftSize);
      for (let f = 0; f < result.frames.length; f++) {
        const { magnitude } = result.frames[f];
        for (let bin = 0; bin < fftSize; bin++) {
          // Floor tracks a decaying estimate of sustained (reverberant) energy
          floor[bin] = Math.max(magnitude[bin] * 0.15, floor[bin] * decayCoef);
          const subtracted = magnitude[bin] - reduction * floor[bin];
          // Spectral floor to avoid musical-noise artifacts from over-subtraction
          magnitude[bin] = Math.max(subtracted, magnitude[bin] * 0.05);
        }
      }

      const rebuilt = istft(result);
      data.set(rebuilt.subarray(0, data.length));
    }

    return out;
  }

  getLatencySamples(): number {
    return nextPowerOfTwo(2048); // one FFT frame of lookahead, conceptually
  }
}
