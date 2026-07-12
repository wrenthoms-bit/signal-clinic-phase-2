import type { ModuleParameter } from '../types/module';

interface Props {
  param: ModuleParameter;
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}

export function ParameterSlider({ param, value, onChange, disabled }: Props) {
  const displayValue = Number.isInteger(param.step ?? 1) ? Math.round(value) : value.toFixed(2);

  return (
    <label className="flex flex-col gap-1.5">
      <span className="flex items-baseline justify-between">
        <span className="text-xs text-ink-muted font-body">{param.label}</span>
        {/* Monospace, tabular numeric readout — matches how real audio gear
            displays values so the digits don't jitter in width as they change. */}
        <span className="font-mono text-xs text-ink tabular-nums">
          {displayValue}
          {param.unit ? ` ${param.unit}` : ''}
        </span>
      </span>
      <input
        type="range"
        min={param.min}
        max={param.max}
        step={param.step ?? 1}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-signal disabled:opacity-40"
      />
    </label>
  );
}
