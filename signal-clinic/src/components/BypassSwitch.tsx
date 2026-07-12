interface Props {
  bypassed: boolean;
  onChange: (bypassed: boolean) => void;
  label: string;
}

/** Footswitch-style toggle: engaged (lit) = module is active in the chain. */
export function BypassSwitch({ bypassed, onChange, label }: Props) {
  const engaged = !bypassed;
  return (
    <button
      onClick={() => onChange(!bypassed)}
      aria-pressed={engaged}
      className="group flex items-center gap-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal focus-visible:outline-offset-2 rounded-full"
    >
      <span
        className={[
          'h-2.5 w-2.5 rounded-full transition-all',
          engaged ? 'bg-signal shadow-[0_0_8px_2px_rgba(79,216,196,0.55)]' : 'bg-hairline',
        ].join(' ')}
        aria-hidden="true"
      />
      <span className={['font-mono text-xs uppercase tracking-wider', engaged ? 'text-ink' : 'text-ink-muted'].join(' ')}>
        {engaged ? 'Active' : 'Bypassed'}
      </span>
      <span className="sr-only">{label} bypass toggle</span>
    </button>
  );
}
