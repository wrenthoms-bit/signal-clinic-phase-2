import { BaseModule, type ModuleMeta } from './module';
import { fetchModelWithCache, type DownloadProgress } from '../core/modelCache';

export interface MLModuleMeta extends ModuleMeta {
  /** Where the model weights are fetched from (Hugging Face, typically). */
  modelUrl: string;
  /** Approximate download size, for showing the user what they're about to fetch. */
  modelSizeBytes: number;
}

/**
 * Base class for Phase 2 modules — handles the lazy-load-once-then-cache
 * pattern every ML-backed module needs, so each module only has to
 * implement `initializeSession` (turn model bytes into a ready-to-run
 * inference session) and `runInference` (the actual per-call work).
 */
export abstract class MLBackedModule extends BaseModule {
  abstract readonly meta: MLModuleMeta;
  modelLoaded = false;
  downloadProgress: DownloadProgress | null = null;

  protected async ensureModelLoaded(): Promise<void> {
    if (this.modelLoaded) return;
    const bytes = await fetchModelWithCache(this.meta.modelUrl, (progress) => {
      this.downloadProgress = progress;
    });
    await this.initializeSession(bytes);
    this.modelLoaded = true;
    this.downloadProgress = null;
  }

  /** Turn raw model bytes into whatever the concrete module needs to run inference. */
  protected abstract initializeSession(modelBytes: ArrayBuffer): Promise<void>;
}
