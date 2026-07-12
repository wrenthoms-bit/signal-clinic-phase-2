import { ChainManager } from '../core/ChainManager';
import { SpectralRepair } from '../modules/master/SpectralRepair';
import { AzimuthPhase } from '../modules/master/AzimuthPhase';
import { LoudnessControl } from '../modules/master/LoudnessControl';

/**
 * Music Rebalance (spec §6.1) is temporarily unwired — see
 * docs/phase2-ml-architecture.md and the README's Phase 2 section. Its
 * code (src/modules/master/MusicRebalance.ts) is real and stays in the
 * repo, but `demucs-web` — the package it depends on — couldn't be
 * confirmed to exist on the npm registry, which would break `npm install`
 * outright. Re-wire this once that's resolved (either a confirmed real
 * package, or a self-hosted ONNX Runtime Web integration that doesn't
 * depend on it). Spectral Repair's own documented fallback (spec §6.1) is
 * to work directly on the stereo mix, so the chain is fully functional
 * without this branch in the meantime.
 */
export function buildMasterChain(): ChainManager {
  return new ChainManager('master', [
    new SpectralRepair(),
    new AzimuthPhase(),
    new LoudnessControl(),
  ]);
}
