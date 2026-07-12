import { useAudioEngine } from './hooks/useAudioEngine';
import { useSpectralEditor } from './hooks/useSpectralEditor';
import { ModeSelector } from './components/ModeSelector';
import { FileDropzone } from './components/FileDropzone';
import { TransportBar } from './components/TransportBar';
import { ModuleRack } from './components/ModuleRack';
import { SpectralEditorPanel } from './components/SpectralEditorPanel';

export default function App() {
  const engine = useAudioEngine();
  const spectralEditor = useSpectralEditor();

  const openManualEditor = () => {
    const buffer = engine.processedBuffer ?? engine.sourceBuffer;
    if (buffer) spectralEditor.open(buffer);
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-6 py-10">
      <header className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight text-ink">Signal Clinic</h1>
            <p className="mt-1 text-sm text-ink-muted">
              Transparent, surgical repair — {engine.chainType === 'stems' ? 'aggressive on isolated stems' : 'restrained on the finished master'}.
            </p>
          </div>
          <ModeSelector value={engine.chainType} onChange={engine.setChainType} disabled={engine.isRendering} />
        </div>
      </header>

      <FileDropzone onFile={engine.loadFile} fileName={engine.fileName} />

      {engine.error && (
        <p className="rounded-lg border border-clip/40 bg-clip/10 px-4 py-3 font-mono text-xs text-clip">{engine.error}</p>
      )}

      <TransportBar
        hasSource={!!engine.sourceBuffer}
        hasProcessed={!!engine.processedBuffer}
        isRendering={engine.isRendering}
        progress={engine.progress}
        onRender={engine.render}
        onPlaySource={() => engine.play('source')}
        onPlayProcessed={() => engine.play('processed')}
        onStop={engine.stop}
        onExport={engine.exportWav}
      />

      {engine.chainType === 'master' && (
        <button
          onClick={openManualEditor}
          disabled={!engine.sourceBuffer && !engine.processedBuffer}
          className="self-start rounded-lg border border-hairline px-3 py-1.5 font-mono text-xs text-ink-muted transition-colors hover:bg-panel-raised disabled:opacity-30"
        >
          Open Spectral Repair — Manual Edit
        </button>
      )}

      <ModuleRack chain={engine.activeChain} activeModuleId={engine.progress?.moduleId ?? null} />

      <footer className="pb-6 pt-2 text-center font-mono text-[11px] text-ink-muted">
        Phase 1 — pure DSP. De-bleed, De-reverb (quality mode), and Music Rebalance are ML-dependent and scoped for Phase 2.
      </footer>

      <SpectralEditorPanel
        editor={spectralEditor}
        onRenderComplete={engine.setExternalProcessedBuffer}
        onCancel={spectralEditor.close}
      />
    </div>
  );
}
