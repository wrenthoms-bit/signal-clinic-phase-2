import { BaseModule, type ModuleMeta } from '../../types/module';
import { renderThroughGraph } from '../../core/bufferUtils';
import { followEnvelope, dbToGain } from '../../core/envelope';

/**
 * Step 5b of the stems chain (Voice Cleaners, vocal stems only).
 * Split-band dynamics rather than a static EQ cut — a static cut removes
 * sibilance *and* legitimate high-frequency detail everywhere in the
 * file, not just on the esses. See spec §5.5.
 *
 * Architecture: split at a single crossover frequency into a low-passed
 * "body" path (untouched) and a high-passed "sibilance" path (dynamically
 * compressed), then sum back together — the un-compressed body path
 * guarantees the rest of the vocal's tone below the crossover is never
 * touched. Note: standard biquad LP/HP at a shared corner don't sum back
 * to a perfectly flat reconstruction (a true complementary crossover
 * needs matched Linkwitz-Riley filters); Phase 1 accepts the small
 * crossover-region ripple this approximation introduces rather than
 * building a full LR4 crossover for a first pass — flagged in README.
 */
export class DeEss extends BaseModule {
  readonly meta: ModuleMeta = {
    id: 'deess',
    displayName: 'De-ess',
    chain: 'stems',
    order: 7,
    requiresML: false,
    processingMode: 'realtime',
    introducesLatency: false,
    description: 'Softens harsh "S"/"T" sibilance via split-band dynamics.',
    parameters: [
      { id: 'centerHz', label: 'Center Frequency', min: 3000, max: 10000, default: 6500, unit: 'Hz', step: 100 },
      { id: 'thresholdDb', label: 'Threshold', min: -40, max: 0, default: -20, unit: 'dB', step: 1 },
      { id: 'reductionDb', label: 'Max Reduction', min: 0, max: 18, default: 9, unit: 'dB', step: 1 },
    ],
  };

  constructor() {
    super();
    this.initDefaults();
  }

  async processOffline(input: AudioBuffer, ctx: OfflineAudioContext): Promise<AudioBuffer> {
    const center = this.getParameter('centerHz');
    const thresholdGain = dbToGain(this.getParameter('thresholdDb'));
    const maxReductionGain = dbToGain(-this.getParameter('reductionDb'));

    const ContextCtor = ctx.constructor as new (n: number, l: number, sr: number) => OfflineAudioContext;

    // Body path: everything below the crossover, left untouched.
    const body = await renderThroughGraph(input, (offlineCtx, source) => {
      const lp = offlineCtx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = center;
      lp.Q.value = 0.707;
      source.connect(lp);
      return lp;
    }, ContextCtor);

    // Sibilance path: everything at/above the crossover — covers the full
    // sibilant range and above, unlike a narrow bandpass which would leave
    // a gap of untouched high-frequency energy above its upper skirt.
    const sibilance = await renderThroughGraph(input, (offlineCtx, source) => {
      const hp = offlineCtx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = center;
      hp.Q.value = 0.707;
      source.connect(hp);
      return hp;
    }, ContextCtor);

    const out = ctx.createBuffer(input.numberOfChannels, input.length, input.sampleRate);
    for (let ch = 0; ch < input.numberOfChannels; ch++) {
      const bodyData = body.getChannelData(ch);
      const sibData = sibilance.getChannelData(ch);
      const envelope = followEnvelope(sibData, input.sampleRate, 1, 60, 'peak');
      const outData = out.getChannelData(ch);

      for (let i = 0; i < outData.length; i++) {
        let sibGain = 1;
        if (envelope[i] > thresholdGain) {
          const excess = envelope[i] / thresholdGain;
          sibGain = Math.max(maxReductionGain, 1 / excess);
        }
        outData[i] = bodyData[i] + sibData[i] * sibGain;
      }
    }

    return out;
  }
}
