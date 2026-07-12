import { BaseModule, type ModuleMeta } from '../../types/module';
import { stft, istft } from '../../core/stft';
import { cloneBuffer } from '../../core/bufferUtils';
import { SlidingWindowMedian } from '../../core/slidingMedian';

/**
 * Step 2 of the master chain (spec §6.2 — "the laser eraser"). The spec's
 * intended UX is a manual visual paint tool over the spectrogram. Building
 * that full interactive canvas editor is a separate scope of UI work from
 * the DSP engine itself, so Phase 1 ships the automated mode answering
 * open question #4: broadband transient outliers (coughs, digital pops,
 * clicks) are detected automatically per time/frequency bin and attenuated,
 * without requiring the user to hand-select regions. The manual paint
 * editor is the fast-follow once this detection core is validated — see
 * README "Known limitations."
 *
 * Detection: for each STFT frame, a bin is flagged if its magnitude
 * exceeds the local median across neighbouring frames at that same
 * frequency by more than a threshold multiple — i.e. "energy that doesn't
 * belong in this frequency's normal trajectory," which is what a cough or
 * pop looks like spectrally (a broadband vertical streak) versus normal
 * program material (smoother frame-to-frame continuity per bin).
 *
 * Per-bin detection runs against a snapshot of the frame's original
 * magnitudes, not the live (possibly already-attenuated) array. An
 * earlier version compared against `result.frames[k].magnitude[bin]`
 * directly while writing reductions into that same array in the same
 * pass — meaning a frame's neighbour-median could include an already-
 * attenuated neighbour, subtly under-detecting adjacent problem frames.
 * Snapshotting the originals per bin before scanning removes that
 * order-dependency, and the SlidingWindowMedian tracker turns the
 * per-position cost from an O(window log window) slice-and-sort into an
 * O(window) incremental update.
 */
export class SpectralRepair extends BaseModule {
  readonly meta: ModuleMeta = {
    id: 'spectralrepair',
    displayName: 'Spectral Repair',
    chain: 'master',
    order: 2,
    requiresML: false,
    processingMode: 'offline-only',
    introducesLatency: true,
    description: 'Auto-detects and attenuates broadband transient artifacts (coughs, pops, clicks).',
    parameters: [
      { id: 'sensitivity', label: 'Sensitivity', min: 2, max: 12, default: 5, unit: '\u00d7median', step: 0.5 },
      { id: 'maxReductionDb', label: 'Max Reduction', min: 0, max: 30, default: 18, unit: 'dB', step: 1 },
    ],
  };

  constructor() {
    super();
    this.initDefaults();
  }

  async processOffline(input: AudioBuffer, ctx: OfflineAudioContext): Promise<AudioBuffer> {
    const fftSize = 1024; // shorter frame — better time resolution for transient localisation
    const sensitivity = this.getParameter('sensitivity');
    const maxReductionGain = Math.pow(10, -this.getParameter('maxReductionDb') / 20);

    const out = cloneBuffer(ctx, input);

    for (let ch = 0; ch < out.numberOfChannels; ch++) {
      const data = out.getChannelData(ch);
      const result = stft(data, fftSize);
      const frameCount = result.frames.length;
      const historyWindow = 8; // frames of context each side, for the local-median baseline

      // Real-valued input means the spectrum is conjugate-symmetric — only
      // the first half needs detection; the mirror bin gets the same
      // reduction applied directly rather than being analysed twice.
      for (let bin = 0; bin <= fftSize / 2; bin++) {
        const original = new Float64Array(frameCount);
        for (let f = 0; f < frameCount; f++) original[f] = result.frames[f].magnitude[bin];

        const tracker = new SlidingWindowMedian();
        for (let j = 0; j <= historyWindow && j < frameCount; j++) tracker.push(original[j]);

        for (let f = 0; f < frameCount; f++) {
          if (tracker.size() >= 4) {
            const median = tracker.median();
            const current = original[f];
            if (median > 1e-9 && current > sensitivity * median) {
              const excess = current / (sensitivity * median);
              const reduction = Math.max(maxReductionGain, 1 / excess);
              result.frames[f].magnitude[bin] *= reduction;
              const mirrorBin = (fftSize - bin) % fftSize;
              if (mirrorBin !== bin) {
                result.frames[f].magnitude[mirrorBin] *= reduction;
              }
            }
          }

          const enter = f + 1 + historyWindow;
          if (enter < frameCount) tracker.push(original[enter]);
          const leave = f - historyWindow;
          if (leave >= 0) tracker.remove(original[leave]);
        }
      }

      const rebuilt = istft(result);
      data.set(rebuilt.subarray(0, data.length));
    }

    return out;
  }
}
