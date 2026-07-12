import { SpectralEditorCanvas } from './SpectralEditorCanvas';
import type { SpectralEditorController } from '../hooks/useSpectralEditor';

interface Props {
  editor: SpectralEditorController;
  onRenderComplete: (buffer: AudioBuffer) => void;
  onCancel: () => void;
}

export function SpectralEditorPanel({ editor, onRenderComplete, onCancel }: Props) {
  if (!editor.isOpen) return null;

  const handleRender = () => {
    const ctx = new AudioContext();
    const buffer = editor.renderToBuffer(ctx);
    void ctx.close(); // only needed createBuffer() here, not a live audio graph
    onRenderComplete(buffer);
    editor.close();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-void/80 p-4" role="dialog" aria-modal="true">
      <div className="flex w-full max-w-4xl flex-col gap-4 rounded-xl border border-hairline bg-panel p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-display text-lg font-semibold text-ink">Spectral Repair — Manual Edit</h2>
            <p className="mt-0.5 text-xs text-ink-muted">
              Drag on the spectrogram to select a region, choose a tool, then Apply. Frequency axis is log-scaled;
              time runs left to right across the whole file.
            </p>
          </div>
          <button
            onClick={onCancel}
            className="rounded-lg border border-hairline px-3 py-1.5 font-mono text-xs text-ink-muted hover:bg-panel-raised"
          >
            Cancel
          </button>
        </div>

        <SpectralEditorCanvas editor={editor} />

        <div className="flex flex-wrap items-center gap-4">
          <div className="inline-flex rounded-full border border-hairline bg-void p-1">
            {(['gain', 'replace'] as const).map((t) => (
              <button
                key={t}
                onClick={() => editor.setTool(t)}
                className={[
                  'rounded-full px-3 py-1 font-display text-xs font-semibold capitalize transition-colors',
                  editor.tool === t ? 'bg-signal text-void' : 'text-ink-muted hover:text-ink',
                ].join(' ')}
              >
                {t}
              </button>
            ))}
          </div>

          {editor.tool === 'gain' && (
            <label className="flex items-center gap-2">
              <span className="text-xs text-ink-muted">Reduction</span>
              <input
                type="range"
                min={-60}
                max={0}
                step={1}
                value={editor.gainDb}
                onChange={(e) => editor.setGainDb(parseFloat(e.target.value))}
                className="w-32 accent-signal"
              />
              <span className="font-mono text-xs text-ink tabular-nums">{editor.gainDb} dB</span>
            </label>
          )}

          <button
            onClick={editor.apply}
            disabled={!editor.selection}
            className="rounded-lg bg-signal px-3 py-1.5 font-display text-xs font-semibold text-void disabled:opacity-30"
          >
            Apply
          </button>
          <button
            onClick={editor.undo}
            disabled={!editor.canUndo}
            className="rounded-lg border border-hairline px-3 py-1.5 font-mono text-xs text-ink-muted hover:bg-panel-raised disabled:opacity-30"
          >
            Undo
          </button>
          <button
            onClick={editor.redo}
            disabled={!editor.canRedo}
            className="rounded-lg border border-hairline px-3 py-1.5 font-mono text-xs text-ink-muted hover:bg-panel-raised disabled:opacity-30"
          >
            Redo
          </button>

          <div className="flex-1" />

          <button
            onClick={handleRender}
            className="rounded-lg border border-signal/60 px-4 py-1.5 font-display text-sm font-semibold text-signal hover:bg-signal/10"
          >
            Render &amp; Use This
          </button>
        </div>
      </div>
    </div>
  );
}
