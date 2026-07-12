import type { ChainType } from '../types/module';

interface Props {
  value: ChainType;
  onChange: (value: ChainType) => void;
  disabled?: boolean;
}

export function ModeSelector({ value, onChange, disabled }: Props) {
  return (
    <div className="inline-flex rounded-full border border-hairline bg-panel p-1" role="tablist" aria-label="Processing mode">
      {(['stems', 'master'] as ChainType[]).map((mode) => {
        const active = value === mode;
        return (
          <button
            key={mode}
            role="tab"
            aria-selected={active}
            disabled={disabled}
            onClick={() => onChange(mode)}
            className={[
              'px-5 py-2 rounded-full font-display text-sm font-semibold tracking-wide transition-colors',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal focus-visible:outline-offset-2',
              active ? 'bg-signal text-void' : 'text-ink-muted hover:text-ink disabled:opacity-40',
            ].join(' ')}
          >
            {mode === 'stems' ? 'Stems' : 'Master'}
          </button>
        );
      })}
    </div>
  );
}
