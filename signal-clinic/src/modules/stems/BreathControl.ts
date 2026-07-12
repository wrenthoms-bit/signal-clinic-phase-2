import { BaseModule, type ModuleMeta } from '../../types/module';
import { cloneBuffer, mapChannels } from '../../core/bufferUtils';
import { followEnvelope, dbToGain } from '../../core/envelope';

/**
 * Step 5a of the stems chain (Voice Cleaners, vocal stems only). Runs
 * last so its envelope thresholds are tuned against the already-repaired
 * signal. See spec §5.5.
 *
 * Deliberately a smooth gain rider, not a gate — gating breath produces
 * audible pumping as the gate snaps open/closed at the breath boundary.
 * Detection band: broadband low-energy sustained content, distinguished
 * from full-level singing by a relative threshold band rather than an
 * absolute one, so it adapts to the performance's overall level.
 */
export class BreathControl extends BaseModule {
  readonly meta: ModuleMeta = {
    id: 'breathcontrol',
    displayName: 'Breath Control',
    chain: 'stems',
    order: 6,
    requiresML: false,
    processingMode: 'realtime',
    introducesLatency: false,
    description: 'Gently rides down loud breath/gasp noise between phrases (vocal stems).',
    parameters: [
      { id: 'reductionDb', label: 'Max Reduction', min: 0, max: 18, default: 8, unit: 'dB', step: 1 },
      { id: 'sensitivity', label: 'Sensitivity', min: 0, max: 100, default: 50, unit: '%', step: 1 },
    ],
  };

  constructor() {
    super();
    this.initDefaults();
  }

  async processOffline(input: AudioBuffer, ctx: OfflineAudioContext): Promise<AudioBuffer> {
    const out = cloneBuffer(ctx, input);
    const maxReduction = dbToGain(-this.getParameter('reductionDb'));
    const sensitivity = this.getParameter('sensitivity') / 100;

    mapChannels(out, (data) => {
      const envelope = followEnvelope(data, input.sampleRate, 15, 150, 'rms');

      // Adaptive band: identify the loudest 10% of the signal as "performance
      // level," then treat sustained energy in a band below that (but above
      // the noise floor) as breath candidate territory.
      const sorted = Float32Array.from(envelope).sort();
      const performanceLevel = sorted[Math.floor(sorted.length * 0.9)] || 1e-4;
      const noiseFloor = sorted[Math.floor(sorted.length * 0.1)] || 1e-6;

      const breathCeiling = noiseFloor + (performanceLevel - noiseFloor) * (0.15 + 0.25 * sensitivity);
      const breathFloor = noiseFloor + (performanceLevel - noiseFloor) * 0.05;

      for (let i = 0; i < data.length; i++) {
        const e = envelope[i];
        if (e > breathFloor && e < breathCeiling) {
          const t = (e - breathFloor) / Math.max(1e-9, breathCeiling - breathFloor);
          // Smooth reduction curve, strongest mid-band, tapering at both edges
          // so the transition in/out of the breath region isn't a hard edge.
          const shape = Math.sin(Math.PI * t);
          const gain = 1 - shape * (1 - maxReduction);
          data[i] *= gain;
        }
      }
    });

    return out;
  }
}
