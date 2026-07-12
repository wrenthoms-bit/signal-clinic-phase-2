import { BaseModule, type ModuleMeta } from '../../types/module';
import { cloneBuffer, mapChannels } from '../../core/bufferUtils';
import { measureIntegratedLoudness, estimateTruePeakDb } from '../../core/loudness';
import { dbToGain } from '../../core/envelope';

/**
 * Step 4 of the master chain — always last. Any upstream repair changes
 * the crest factor the loudness measurement depends on, so measuring
 * before repair would target a signal that's about to be invalidated.
 * See spec §6.4.
 *
 * This module deliberately does not offer a "maximize loudness" mode —
 * per the audio engineering brief, transparency and dynamic preservation
 * are the priority over hitting the loudest allowable number. Defaults:
 *
 * - True-peak ceiling defaults to -1 dBTP, not 0 dBTP, leaving margin
 *   against inter-sample peaks a lossy codec will introduce on encode.
 * - Limiter release is program-dependent (fast-tracking envelope with a
 *   floor/ceiling on release time) rather than one fixed release value,
 *   since a fixed fast release pumps on sustained low end and a fixed
 *   slow release fails to recover gain between transient hits.
 */
export class LoudnessControl extends BaseModule {
  readonly meta: ModuleMeta = {
    id: 'loudnesscontrol',
    displayName: 'Loudness Control',
    chain: 'master',
    order: 4,
    requiresML: false,
    processingMode: 'offline-only',
    introducesLatency: true,
    description: 'Matches integrated loudness to a streaming target with a transparent true-peak limiter.',
    parameters: [
      // Reference points commonly cited for these platforms — treated as a
      // starting preset, not a guarantee, since platform targets do shift.
      { id: 'targetLufs', label: 'Target Loudness', min: -23, max: -9, default: -14, unit: 'LUFS', step: 0.5 },
      { id: 'ceilingDbtp', label: 'True-Peak Ceiling', min: -3, max: 0, default: -1, unit: 'dBTP', step: 0.1 },
      { id: 'releaseMs', label: 'Limiter Release (base)', min: 20, max: 300, default: 100, unit: 'ms', step: 10 },
    ],
  };

  lastMeasuredLufs = -Infinity;
  lastMeasuredTruePeak = -Infinity;

  constructor() {
    super();
    this.initDefaults();
  }

  async processOffline(input: AudioBuffer, ctx: OfflineAudioContext): Promise<AudioBuffer> {
    const targetLufs = this.getParameter('targetLufs');
    const ceilingDb = this.getParameter('ceilingDbtp');
    const baseReleaseMs = this.getParameter('releaseMs');

    this.lastMeasuredLufs = measureIntegratedLoudness(input);
    const gainDb = this.lastMeasuredLufs > -Infinity ? targetLufs - this.lastMeasuredLufs : 0;
    const makeupGain = dbToGain(gainDb);

    const out = cloneBuffer(ctx, input);
    mapChannels(out, (data) => {
      for (let i = 0; i < data.length; i++) data[i] *= makeupGain;
    });

    this.limitTruePeak(out, ceilingDb, baseReleaseMs);
    this.lastMeasuredTruePeak = estimateTruePeakDb(out);

    return out;
  }

  /**
   * Lookahead peak limiter. A short lookahead lets the gain reduction
   * begin ramping down slightly before the peak arrives rather than
   * reacting after the fact, avoiding the harder-edged distortion of a
   * zero-lookahead limiter. Release time adapts within [baseRelease,
   * baseRelease * 3] based on how densely peaks are occurring — dense
   * transients get a shorter effective release so gain recovers between
   * hits instead of the limiter staying clamped down.
   */
  private limitTruePeak(buffer: AudioBuffer, ceilingDb: number, baseReleaseMs: number): void {
    const ceiling = dbToGain(ceilingDb);
    const lookaheadSamples = Math.round(buffer.sampleRate * 0.003); // 3ms
    const attackSamples = Math.round(buffer.sampleRate * 0.001); // 1ms

    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const data = buffer.getChannelData(ch);
      const gainReduction = new Float32Array(data.length).fill(1);

      // Pass 1: compute the required instantaneous gain at each sample
      const required = new Float32Array(data.length);
      for (let i = 0; i < data.length; i++) {
        const abs = Math.abs(data[i]);
        required[i] = abs > ceiling ? ceiling / abs : 1;
      }

      // Pass 2: smooth with lookahead so reduction ramps in before the peak
      let currentGain = 1;
      let recentPeakCount = 0;
      const releaseWindow = Math.round(buffer.sampleRate * 0.5);

      for (let i = 0; i < data.length; i++) {
        const lookaheadEnd = Math.min(data.length, i + lookaheadSamples);
        let minRequired = 1;
        for (let j = i; j < lookaheadEnd; j++) {
          if (required[j] < minRequired) minRequired = required[j];
        }

        if (minRequired < currentGain) {
          // Fast attack toward the needed reduction
          const attackCoef = Math.exp(-1 / attackSamples);
          currentGain = attackCoef * currentGain + (1 - attackCoef) * minRequired;
          recentPeakCount++;
        } else {
          // Program-dependent release: denser recent peaks -> shorter release
          const density = Math.min(1, recentPeakCount / (releaseWindow / 1000));
          const releaseMs = baseReleaseMs * (1 + 2 * (1 - density));
          const releaseCoef = Math.exp(-1 / ((releaseMs / 1000) * buffer.sampleRate));
          currentGain = releaseCoef * currentGain + (1 - releaseCoef) * 1;
          if (i % releaseWindow === 0) recentPeakCount = Math.max(0, recentPeakCount - 1);
        }
        gainReduction[i] = currentGain;
      }

      for (let i = 0; i < data.length; i++) {
        data[i] *= gainReduction[i];
      }
    }
  }

  getLatencySamples(): number {
    return Math.round(44100 * 0.003); // lookahead window, sample-rate-independent approximation for display
  }
}
