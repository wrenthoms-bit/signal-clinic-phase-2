import { ChainManager } from '../core/ChainManager';
import { DeClip } from '../modules/stems/DeClip';
import { DeHum } from '../modules/stems/DeHum';
import { DeClick } from '../modules/stems/DeClick';
import { DePlosive } from '../modules/stems/DePlosive';
import { DeReverb } from '../modules/stems/DeReverb';
import { BreathControl } from '../modules/stems/BreathControl';
import { DeEss } from '../modules/stems/DeEss';

/**
 * De-bleed (spec §5.2) is omitted — it requires source-separation ML and
 * is scoped for Phase 2 (spec §7). Every other stems-chain module from
 * the spec is here, in signal-flow order.
 */
export function buildStemsChain(): ChainManager {
  return new ChainManager('stems', [
    new DeClip(),
    new DeHum(),
    new DeClick(),
    new DePlosive(),
    new DeReverb(),
    new BreathControl(),
    new DeEss(),
  ]);
}
