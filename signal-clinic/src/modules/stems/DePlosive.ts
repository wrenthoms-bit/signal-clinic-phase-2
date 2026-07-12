import { BaseModule, type ModuleMeta } from '../../types/module';
import { cloneBuffer, mapChannels, renderThroughGraph } from '../../core/bufferUtils';
import { windowedRms, followEnvelope, dbToGain } from '../../core/envelope';

/**
 * Step 3b of the stems chain. Plosives ("P"/"B" pops) are low-frequency,
 * short-duration energy bursts — detected in a low-passed copy of the
 * signal so the detector isn't triggered by full-band transients like
 * consonant attacks, then attenuation is applied to the original
 * full-band signal only during the detected burst window. See spec §5.3.
 */
export class DePlosive extends BaseModule {
  readonly meta: ModuleMeta = {
    id: 'deplosive',
    displayName: 'De-plosive',
    chain: 'stems',
    order: 4,
    requiresML: false,
    processingMode: 'realtime',
    introducesLatency: false,
    description: 'Tames heavy "P"/"B" pop transients without a static high-pass.',
    parameters: [
      { id: 'thresholdDb', label: 'Threshold', min: -40, max: -6, default: -18, unit: 'dB', step: 1 },
      { id: 'reductionDb', label: 'Max Reduction', min: 0, max: 24, default: 12, unit: 'dB', step: 1 },
      { id: 'cutoffHz', label: 'LF Band Ceiling', min: 60, max: 200, default: 120, unit: 'Hz', step: 5 },
    ],
  };

  constructor() {
    super();
    this.initDefaults();
  }

  async processOffline(input: AudioBuffer, ctx: OfflineAudioContext): Promise<AudioBuffer> {
    const cutoff = this.getParameter('cutoffHz');
    const thresholdGain = dbToGain(this.getParameter('thresholdDb'));
    const maxReduction = dbToGain(-this.getParameter('reductionDb'));

    // Low-passed copy used purely for detection — a real biquad via
    // OfflineAudioContext, since this is exactly a stock-node job.
    const ContextCtor = ctx.constructor as new (n: number, l: number, sr: number) => OfflineAudioContext;
    const lfCopy = await renderThroughGraph(input, (offlineCtx, source) => {
      const lp = offlineCtx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = cutoff;
      lp.Q.value = 0.707;
      source.connect(lp);
      return lp;
    }, ContextCtor);

    const out = cloneBuffer(ctx, input);
    const windowSamples = Math.round(input.sampleRate * 0.008); // 8ms burst window

    mapChannels(out, (data, ch) => {
      const lfData = lfCopy.getChannelData(Math.min(ch, lfCopy.numberOfChannels - 1));
      const burstEnergy = windowedRms(lfData, windowSamples);
      // Fast attack (catch the pop), slower release (smooth gain recovery, no zipper noise)
      const smoothed = followEnvelope(burstEnergy, input.sampleRate, 2, 40, 'peak');

      for (let i = 0; i < data.length; i++) {
        if (smoothed[i] > thresholdGain) {
          const excess = smoothed[i] / thresholdGain;
          const reduction = Math.max(maxReduction, 1 / excess);
          data[i] *= reduction;
        }
      }
    });

    return out;
  }
}
