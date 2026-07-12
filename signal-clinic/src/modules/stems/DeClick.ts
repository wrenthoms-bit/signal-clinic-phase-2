import { BaseModule, type ModuleMeta } from '../../types/module';
import { hermiteFillGap } from '../../core/interpolation';
import { cloneBuffer, mapChannels } from '../../core/bufferUtils';
import { SlidingWindowMedian } from '../../core/slidingMedian';

/**
 * Step 3a of the stems chain (paired with De-plosive). Runs after De-hum
 * so stationary noise doesn't inflate the local deviation estimate and
 * trigger false click detections, and before De-reverb so reverb tail
 * isn't misread as a train of clicks. See spec §5.3.
 *
 * Detection: a sample is flagged as a click if its second derivative
 * (the "surprise" relative to its neighbours) exceeds a multiple of the
 * local median absolute deviation — a robust statistic that isn't thrown
 * off by the one outlier sample it's trying to detect, unlike a mean/stddev
 * threshold would be.
 *
 * The local MAD is tracked with a SlidingWindowMedian rather than
 * re-slicing and sorting a fresh window at every sample — same win as
 * the windowedRms fix in core/envelope.ts, and using the same pre-fill-
 * then-enter/leave pattern so the two don't drift into inconsistent
 * windowing conventions.
 */
export class DeClick extends BaseModule {
  readonly meta: ModuleMeta = {
    id: 'declick',
    displayName: 'De-click',
    chain: 'stems',
    order: 3,
    requiresML: false,
    processingMode: 'realtime',
    introducesLatency: true,
    description: 'Removes saliva ticks, fret noise, and other short transient artifacts.',
    parameters: [
      { id: 'sensitivity', label: 'Sensitivity', min: 3, max: 20, default: 8, unit: '\u00d7MAD', step: 0.5 },
      { id: 'windowMs', label: 'Detection Window', min: 1, max: 20, default: 5, unit: 'ms', step: 0.5 },
    ],
  };

  constructor() {
    super();
    this.initDefaults();
  }

  async processOffline(input: AudioBuffer, ctx: OfflineAudioContext): Promise<AudioBuffer> {
    const out = cloneBuffer(ctx, input);
    const sensitivity = this.getParameter('sensitivity');
    const windowSamples = Math.max(8, Math.round((this.getParameter('windowMs') / 1000) * input.sampleRate));

    mapChannels(out, (data) => {
      const absDiff = new Float32Array(data.length);
      for (let i = 1; i < data.length - 1; i++) {
        // discrete 2nd derivative proxy — how much this sample departs
        // from a straight line through its neighbours
        absDiff[i] = Math.abs(data[i] - 0.5 * (data[i - 1] + data[i + 1]));
      }

      const half = Math.floor(windowSamples / 2);
      const tracker = new SlidingWindowMedian();
      for (let j = 0; j <= half && j < absDiff.length; j++) tracker.push(absDiff[j]);

      let runStart = -1;
      for (let i = 0; i <= data.length; i++) {
        const localMad = i < data.length ? tracker.median() : 0;
        const isClick = i < data.length && localMad > 1e-9 && absDiff[i] > sensitivity * localMad;

        if (isClick && runStart === -1) {
          runStart = i;
        } else if (!isClick && runStart !== -1) {
          hermiteFillGap(data, runStart, i - 1);
          runStart = -1;
        }

        const enter = i + 1 + half;
        if (enter < absDiff.length) tracker.push(absDiff[enter]);
        const leave = i - half;
        if (leave >= 0) tracker.remove(absDiff[leave]);
      }
    });

    return out;
  }
}
