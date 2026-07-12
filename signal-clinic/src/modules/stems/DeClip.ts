import { BaseModule, type ModuleMeta } from '../../types/module';
import { hermiteFillGap } from '../../core/interpolation';
import { cloneBuffer, mapChannels } from '../../core/bufferUtils';

/**
 * Step 1 of the stems chain. Runs first because every downstream detector
 * (click detection, hum detection, spectral analysis) is thrown off by
 * flat-topped clipped waveforms — repair shape before anything else looks
 * at the signal. See spec §5.1.
 */
export class DeClip extends BaseModule {
  readonly meta: ModuleMeta = {
    id: 'declip',
    displayName: 'De-clip',
    chain: 'stems',
    order: 1,
    requiresML: false,
    processingMode: 'realtime',
    introducesLatency: true,
    description: 'Rebuilds squared-off waveforms from samples that hit 0dBFS.',
    parameters: [
      { id: 'threshold', label: 'Detection Threshold', min: 0.9, max: 1.0, default: 0.98, unit: '', step: 0.001 },
      { id: 'minRunLength', label: 'Min Run Length', min: 2, max: 50, default: 3, unit: 'smp', step: 1 },
    ],
  };

  constructor() {
    super();
    this.initDefaults();
  }

  async processOffline(input: AudioBuffer, ctx: OfflineAudioContext): Promise<AudioBuffer> {
    const out = cloneBuffer(ctx, input);
    const threshold = this.getParameter('threshold');
    const minRun = Math.round(this.getParameter('minRunLength'));

    mapChannels(out, (data) => {
      let runStart = -1;
      for (let i = 0; i <= data.length; i++) {
        const clipped = i < data.length && Math.abs(data[i]) >= threshold;
        if (clipped && runStart === -1) {
          runStart = i;
        } else if (!clipped && runStart !== -1) {
          const runEnd = i - 1;
          if (runEnd - runStart + 1 >= minRun) {
            hermiteFillGap(data, runStart, runEnd);
          }
          runStart = -1;
        }
      }
    });

    return out;
  }
}
