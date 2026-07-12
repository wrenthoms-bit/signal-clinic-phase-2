import { MLBackedModule, type MLModuleMeta } from '../../types/mlModule';
import { resampleBuffer } from '../../core/resample';
import { DemucsProcessor, type SeparationResult, type ProgressInfo } from 'demucs-web';
import * as ort from 'onnxruntime-web';

const MODEL_SAMPLE_RATE = 44100; // the ONNX export's fixed input rate — see demucs-web docs

/**
 * Music Rebalance — spec §6.1, the optional branch of the master chain.
 * Splits a stereo master into vocals/drums/bass/other so a specific layer
 * can be targeted for repair instead of processing the whole mix blindly.
 * Runs before Spectral Repair (order 2) when active; Spectral Repair's own
 * documented fallback is to work directly on the stereo mix when this
 * module is bypassed, per spec §6.1 — no separate "skip" plumbing needed
 * here, bypassing this module is enough.
 *
 * SCOPE OF THIS PASS: this proves the ML pipeline end-to-end — lazy-load
 * the model, run real separation, recombine the four stems back into a
 * stereo mix. What it does NOT yet do: let you select one stem, route it
 * through a Phase 1 repair module, and recombine with the untouched
 * others. That per-stem targeting is the actual reason Music Rebalance
 * exists, and it's the immediate next step once this base pipeline is
 * proven — not built in this pass. Bypassed or active, this module's
 * output should sound like the input (modulo the model's own
 * reconstruction error), which is the honestly-scoped, testable claim
 * for this pass: `lastSeparation` exposes the four stems for future UI
 * and future targeted-repair work to build on.
 *
 * UNVERIFIED: written against demucs-web's documented API, not exercised
 * against the real package or a real model file — this sandbox has no
 * network access to install either. Treat this as reviewed-but-unrun,
 * not tested, until it's actually run somewhere with network access.
 * See docs/phase2-ml-architecture.md for the model/runtime decisions.
 */
export class MusicRebalance extends MLBackedModule {
  readonly meta: MLModuleMeta = {
    id: 'musicrebalance',
    displayName: 'Music Rebalance',
    chain: 'master',
    order: 1,
    requiresML: true,
    processingMode: 'offline-only',
    introducesLatency: false,
    description: 'Splits the master into vocals/drums/bass/other so a specific layer can be targeted.',
    modelUrl: 'https://huggingface.co/timcsy/demucs-web-onnx/resolve/main/htdemucs_embedded.onnx',
    modelSizeBytes: 172 * 1024 * 1024,
    parameters: [],
  };

  private processor: DemucsProcessor | null = null;
  lastSeparation: SeparationResult | null = null;
  lastInferenceProgress: ProgressInfo | null = null;

  constructor() {
    super();
    this.initDefaults();
  }

  protected async initializeSession(modelBytes: ArrayBuffer): Promise<void> {
    this.processor = new DemucsProcessor({
      ort,
      onProgress: (info) => {
        this.lastInferenceProgress = info;
      },
      onLog: (phase, message) => {
        console.debug(`[MusicRebalance:${phase}]`, message);
      },
    });
    // Passing bytes we already fetched via modelCache.ts directly, rather
    // than a URL — our own cache helper already handled the download and
    // progress reporting (see MLBackedModule.ensureModelLoaded), so there's
    // no second fetch for the processor to do here.
    await this.processor.loadModel(modelBytes);
  }

  async processOffline(input: AudioBuffer, ctx: OfflineAudioContext): Promise<AudioBuffer> {
    if (input.numberOfChannels < 2) return input; // designed for stereo masters, per spec §6.1

    await this.ensureModelLoaded();
    if (!this.processor) throw new Error('Music Rebalance: model failed to initialize');

    const ContextCtor = ctx.constructor as new (n: number, l: number, sr: number) => OfflineAudioContext;
    const resampled = await resampleBuffer(input, MODEL_SAMPLE_RATE, ContextCtor);

    const left = resampled.getChannelData(0);
    const right = resampled.getChannelData(1);
    const separation = await this.processor.separate(left, right);
    this.lastSeparation = separation;
    this.lastInferenceProgress = null;

    // Recombine all four stems — proves the round trip works end-to-end.
    // Targeted per-stem repair (the actual point of separating in the
    // first place) is the follow-up feature; see the class doc comment.
    const recombined = ctx.createBuffer(2, left.length, MODEL_SAMPLE_RATE);
    const outLeft = recombined.getChannelData(0);
    const outRight = recombined.getChannelData(1);
    for (const stem of [separation.vocals, separation.drums, separation.bass, separation.other]) {
      for (let i = 0; i < outLeft.length; i++) {
        outLeft[i] += stem.left[i];
        outRight[i] += stem.right[i];
      }
    }

    return resampleBuffer(recombined, input.sampleRate, ContextCtor);
  }
}
