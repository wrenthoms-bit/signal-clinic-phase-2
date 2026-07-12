import type { ProcessingModule } from '../types/module';
import { BypassSwitch } from './BypassSwitch';
import { ParameterSlider } from './ParameterSlider';

interface Props {
  module: ProcessingModule;
  index: number;
  /** Modules are mutable class instances outside React state — this tells
      the parent rack to re-render after any mutation. */
  onChange: () => void;
}

export function ModuleCard({ module, index, onChange }: Props) {
  const { meta, bypassed } = module;

  return (
    <div
      className={[
        'relative flex flex-col gap-4 rounded-xl border p-5 transition-colors',
        bypassed ? 'border-hairline bg-panel/60' : 'border-hairline bg-panel',
      ].join(' ')}
    >
      {/* Numbering here is justified, not decorative — it's the module's
          real position in signal flow, and reordering these numbers would
          reorder the actual audio processing. */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 font-mono text-xs text-ink-muted tabular-nums">{String(index + 1).padStart(2, '0')}</span>
          <div>
            <h3 className="font-display text-base font-semibold text-ink">{meta.displayName}</h3>
            <p className="mt-0.5 max-w-md text-xs text-ink-muted">{meta.description}</p>
          </div>
        </div>
        <BypassSwitch
          bypassed={bypassed}
          label={meta.displayName}
          onChange={(v) => {
            module.setBypass(v);
            onChange();
          }}
        />
      </div>

      {meta.requiresML && (
        <span className="w-fit rounded-full border border-ml/40 bg-ml/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-ml">
          ML {'\u00b7'} Phase 2
        </span>
      )}
      {meta.processingMode === 'offline-only' && (
        <span className="w-fit rounded-full border border-hairline px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-ink-muted">
          Offline render only
        </span>
      )}

      {meta.parameters.length > 0 && (
        <div className={['grid grid-cols-1 gap-3 sm:grid-cols-2', bypassed ? 'pointer-events-none opacity-40' : ''].join(' ')}>
          {meta.parameters.map((p) => (
            <ParameterSlider
              key={p.id}
              param={p}
              value={module.getParameter(p.id)}
              disabled={bypassed}
              onChange={(v) => {
                module.setParameter(p.id, v);
                onChange();
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
