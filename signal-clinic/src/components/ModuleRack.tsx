import { useState } from 'react';
import type { ChainManager } from '../core/ChainManager';
import { ModuleCard } from './ModuleCard';

interface Props {
  chain: ChainManager;
  activeModuleId?: string | null;
}

export function ModuleRack({ chain, activeModuleId }: Props) {
  // Modules are mutable class instances, not React state — bumping this
  // counter forces a re-render whenever a card mutates its module.
  const [, setVersion] = useState(0);
  const bump = () => setVersion((v) => v + 1);

  return (
    <div className="flex flex-col">
      {chain.modules.map((module, i) => (
        <div key={module.meta.id} className="flex flex-col">
          <div
            className={[
              'rounded-xl transition-shadow',
              activeModuleId === module.meta.id ? 'ring-1 ring-signal/60' : '',
            ].join(' ')}
          >
            <ModuleCard module={module} index={i} onChange={bump} />
          </div>
          {i < chain.modules.length - 1 && (
            <div className="flex justify-start pl-[1.65rem]">
              {/* Signal-flow connector — the one place motion is used, and only
                  while that specific module is actually rendering, so it reflects
                  real audio moving through the chain rather than decoration. */}
              <div className="relative h-6 w-px bg-hairline">
                {activeModuleId === module.meta.id && (
                  <span className="absolute -left-[3px] top-0 h-1.5 w-1.5 animate-pulse rounded-full bg-signal" />
                )}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
