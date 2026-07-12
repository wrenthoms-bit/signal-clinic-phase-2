/**
 * Core module contract. Every processing module — DSP or (later) ML-backed —
 * implements this interface so ChainManager can sequence, bypass, and render
 * them uniformly regardless of what happens internally.
 *
 * See /docs/signal-clinic-processing-chain-spec.md §3 for the full rationale.
 */

export type ChainType = 'stems' | 'master';
export type ProcessingMode = 'realtime' | 'offline-only';

export interface ModuleParameter {
  id: string;
  label: string;
  min: number;
  max: number;
  default: number;
  unit?: string;
  step?: number;
}

export interface ModuleMeta {
  id: string;
  displayName: string;
  chain: ChainType;
  order: number;
  requiresML: boolean;
  processingMode: ProcessingMode;
  introducesLatency: boolean;
  /** One line explaining what this module targets — surfaced in the UI. */
  description: string;
  parameters: ModuleParameter[];
}

export interface ProcessingModule {
  readonly meta: ModuleMeta;
  bypassed: boolean;

  /**
   * Phase 1 modules are implemented as offline buffer transforms — see
   * README "Phase 1 scope decisions" for why realtime AudioWorklet preview
   * was deferred rather than half-built for this pass.
   */
  processOffline(
    input: AudioBuffer,
    context: OfflineAudioContext
  ): Promise<AudioBuffer>;

  /** Optional real-time preview path — unimplemented for Phase 1 modules. */
  buildRealtimeNode?(context: AudioContext): AudioNode;

  setParameter(id: string, value: number): void;
  getParameter(id: string): number;
  setBypass(state: boolean): void;
  getLatencySamples(): number;
}

/** Base class handling the parameter/bypass bookkeeping every module shares. */
export abstract class BaseModule implements ProcessingModule {
  abstract readonly meta: ModuleMeta;
  bypassed = false;
  protected values: Record<string, number> = {};

  constructor() {
    // deferred: subclasses populate `values` from meta.parameters after
    // their meta is assigned (see each module's constructor).
  }

  protected initDefaults() {
    for (const p of this.meta.parameters) {
      this.values[p.id] = p.default;
    }
  }

  setParameter(id: string, value: number): void {
    const def = this.meta.parameters.find((p) => p.id === id);
    if (!def) throw new Error(`Unknown parameter "${id}" on module "${this.meta.id}"`);
    this.values[id] = Math.min(def.max, Math.max(def.min, value));
  }

  getParameter(id: string): number {
    return this.values[id];
  }

  setBypass(state: boolean): void {
    this.bypassed = state;
  }

  getLatencySamples(): number {
    return 0;
  }

  abstract processOffline(input: AudioBuffer, context: OfflineAudioContext): Promise<AudioBuffer>;
}
