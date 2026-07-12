import { ChainManager } from '../core/ChainManager';
import { MusicRebalance } from '../modules/master/MusicRebalance';
import { SpectralRepair } from '../modules/master/SpectralRepair';
import { AzimuthPhase } from '../modules/master/AzimuthPhase';
import { LoudnessControl } from '../modules/master/LoudnessControl';

/**
 * Music Rebalance (spec §6.1) is now wired in as Phase 2's first ML-backed
 * module — bypassed by default (see below), since it's a ~170MB lazy-load
 * the user should opt into, not something that silently downloads a model
 * the first time anyone renders a master. Spectral Repair's own documented
 * fallback (spec §6.1) is to work directly on the stereo mix when Rebalance
 * is bypassed, so the chain is fully functional either way.
 */
export function buildMasterChain(): ChainManager {
  const musicRebalance = new MusicRebalance();
  musicRebalance.setBypass(true); // opt-in — see comment above

  return new ChainManager('master', [
    musicRebalance,
    new SpectralRepair(),
    new AzimuthPhase(),
    new LoudnessControl(),
  ]);
}
