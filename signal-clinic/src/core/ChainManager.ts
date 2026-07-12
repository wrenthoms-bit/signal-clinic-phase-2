import type { ProcessingModule, ChainType } from '../types/module';
import { cloneBuffer } from './bufferUtils';

/**
 * Owns module order and bypass routing centrally, per spec §4 — modules
 * never reorder themselves or reach into each other. ChainManager is the
 * single place that decides "is this module actually in the signal path
 * right now."
 */
export class ChainManager {
  readonly chainType: ChainType;
  readonly modules: ProcessingModule[];

  constructor(chainType: ChainType, modules: ProcessingModule[]) {
    this.chainType = chainType;
    this.modules = [...modules].sort((a, b) => a.meta.order - b.meta.order);
  }

  getModule(id: string): ProcessingModule | undefined {
    return this.modules.find((m) => m.meta.id === id);
  }

  totalLatencySamples(): number {
    return this.modules.reduce(
      (sum, m) => sum + (m.bypassed ? 0 : m.getLatencySamples()),
      0
    );
  }

  /**
   * Renders the full chain in order. Bypassed modules are skipped
   * entirely — for ML-backed modules this means inference is never
   * invoked; for DSP modules it means no disconnect/reconnect artifact
   * since we're operating on discrete buffers, not a live node graph.
   */
  async render(
    input: AudioBuffer,
    audioCtxCtor: typeof OfflineAudioContext,
    onProgress?: (moduleId: string, index: number, total: number) => void
  ): Promise<AudioBuffer> {
    let current = cloneBuffer(
      new audioCtxCtor(input.numberOfChannels, input.length, input.sampleRate),
      input
    );

    const active = this.modules.filter((m) => !m.bypassed);
    for (let i = 0; i < active.length; i++) {
      const module = active[i];
      onProgress?.(module.meta.id, i, active.length);
      const ctx = new audioCtxCtor(current.numberOfChannels, current.length, current.sampleRate);
      current = await module.processOffline(current, ctx);
    }
    return current;
  }
}
