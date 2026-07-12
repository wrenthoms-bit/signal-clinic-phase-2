import type { RenderProgress } from '../hooks/useAudioEngine';

interface Props {
  hasSource: boolean;
  hasProcessed: boolean;
  isRendering: boolean;
  progress: RenderProgress | null;
  onRender: () => void;
  onPlaySource: () => void;
  onPlayProcessed: () => void;
  onStop: () => void;
  onExport: () => void;
}

export function TransportBar({
  hasSource,
  hasProcessed,
  isRendering,
  progress,
  onRender,
  onPlaySource,
  onPlayProcessed,
  onStop,
  onExport,
}: Props) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-hairline bg-panel p-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={onRender}
          disabled={!hasSource || isRendering}
          className="rounded-lg bg-signal px-4 py-2 font-display text-sm font-semibold text-void transition-opacity disabled:opacity-30"
        >
          {isRendering ? 'Rendering…' : 'Render Chain'}
        </button>
        <button
          onClick={onPlaySource}
          disabled={!hasSource}
          className="rounded-lg border border-hairline px-4 py-2 font-display text-sm text-ink transition-colors hover:bg-panel-raised disabled:opacity-30"
        >
          Play Source
        </button>
        <button
          onClick={onPlayProcessed}
          disabled={!hasProcessed}
          className="rounded-lg border border-hairline px-4 py-2 font-display text-sm text-ink transition-colors hover:bg-panel-raised disabled:opacity-30"
        >
          Play Processed
        </button>
        <button
          onClick={onStop}
          className="rounded-lg border border-hairline px-3 py-2 font-mono text-xs text-ink-muted transition-colors hover:bg-panel-raised"
        >
          Stop
        </button>
        <div className="flex-1" />
        <button
          onClick={onExport}
          disabled={!hasProcessed}
          className="rounded-lg border border-signal/60 px-4 py-2 font-display text-sm font-semibold text-signal transition-colors hover:bg-signal/10 disabled:opacity-30 disabled:border-hairline disabled:text-ink-muted"
        >
          Export WAV
        </button>
      </div>
      {isRendering && progress && (
        <p className="font-mono text-xs text-ink-muted">
          {progress.index + 1}/{progress.total} {'\u00b7'} {progress.moduleId}
        </p>
      )}
    </div>
  );
}
