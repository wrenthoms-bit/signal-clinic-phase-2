import { BaseModule, type ModuleMeta } from '../../types/module';
import { cloneBuffer } from '../../core/bufferUtils';
import { findBestLag, correlationCoefficient } from '../../core/correlation';

/**
 * Step 3 of the master chain. Must run before Loudness Control — out-of-
 * phase content nulls in mono and skews LUFS measurement, so correcting
 * phase before measuring loudness is required, not optional ordering.
 * See spec §6.3.
 *
 * Only meaningful for stereo material — mono input is a pass-through with
 * a documented no-op rather than a silent skip, so it's clear in the UI
 * why the module had nothing to do.
 */
export class AzimuthPhase extends BaseModule {
  readonly meta: ModuleMeta = {
    id: 'azimuthphase',
    displayName: 'Azimuth / Phase',
    chain: 'master',
    order: 3,
    requiresML: false,
    processingMode: 'realtime',
    introducesLatency: false,
    description: 'Realigns L/R channel timing and phase using cross-correlation.',
    parameters: [
      { id: 'maxLagMs', label: 'Max Search Range', min: 1, max: 50, default: 20, unit: 'ms', step: 1 },
      { id: 'invertRight', label: 'Invert Right Channel', min: 0, max: 1, default: 0, unit: '', step: 1 },
      { id: 'autoDetect', label: 'Auto-detect Offset', min: 0, max: 1, default: 1, unit: '', step: 1 },
      { id: 'manualDelaySamples', label: 'Manual Delay (R)', min: -2000, max: 2000, default: 0, unit: 'smp', step: 1 },
    ],
  };

  lastDetectedLag = 0;
  lastCorrelation = 1;

  constructor() {
    super();
    this.initDefaults();
  }

  async processOffline(input: AudioBuffer, ctx: OfflineAudioContext): Promise<AudioBuffer> {
    if (input.numberOfChannels < 2) return input; // nothing to align

    const out = cloneBuffer(ctx, input);
    const left = out.getChannelData(0);
    const right = out.getChannelData(1);

    this.lastCorrelation = correlationCoefficient(left, right);

    const autoDetect = this.getParameter('autoDetect') >= 0.5;
    const maxLagSamples = Math.round((this.getParameter('maxLagMs') / 1000) * input.sampleRate);
    const lag = autoDetect
      ? findBestLag(left, right, maxLagSamples)
      : Math.round(this.getParameter('manualDelaySamples'));

    this.lastDetectedLag = lag;

    if (lag !== 0) {
      // findBestLag returns L such that right[i+L] ≈ left[i] — i.e. right
      // lags left by L samples. Correcting means pulling each output
      // sample from right's future by L (srcIdx = i + lag), not its past.
      // Verified against a known synthetic delay in
      // tests/modules.integration.test.ts — an earlier version used
      // `i - lag` here, which doubled the delay instead of cancelling it.
      const shifted = new Float32Array(right.length);
      for (let i = 0; i < right.length; i++) {
        const srcIdx = i + lag;
        shifted[i] = srcIdx >= 0 && srcIdx < right.length ? right[srcIdx] : 0;
      }
      right.set(shifted);
    }

    if (this.getParameter('invertRight') >= 0.5) {
      for (let i = 0; i < right.length; i++) right[i] *= -1;
    }

    return out;
  }
}
