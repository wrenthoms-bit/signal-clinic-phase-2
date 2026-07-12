import { useCallback, useRef, useState } from 'react';
import { stft, istft, type StftResult } from '../core/stft';
import { applyGain, applyReplace, undoEdit, type SelectionBox, type EditRecord } from '../core/spectralEdit';

export type SpectralTool = 'gain' | 'replace';

interface HistoryEntry {
  tool: SpectralTool;
  box: SelectionBox;
  gainDb?: number;
  editsPerChannel: EditRecord[];
}

interface SourceMeta {
  sampleRate: number;
  originalLength: number;
  numberOfChannels: number;
}

const FFT_SIZE = 2048;

/**
 * STFT data lives in a ref, not React state — apply/undo mutate the
 * magnitude arrays in place (same pattern as ModuleRack's mutable module
 * instances), and `version` is bumped to tell the canvas it's time to
 * redraw. Keeping ~15k frames × 2048 bins in React state and diffing it
 * on every edit would be needless overhead for data nothing else in the
 * component tree needs to read reactively.
 */
export function useSpectralEditor() {
  const stftRef = useRef<StftResult[] | null>(null);
  const sourceMetaRef = useRef<SourceMeta | null>(null);

  const [isOpen, setIsOpen] = useState(false);
  const [version, setVersion] = useState(0);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [redoStack, setRedoStack] = useState<HistoryEntry[]>([]);
  const [selection, setSelection] = useState<SelectionBox | null>(null);
  const [tool, setTool] = useState<SpectralTool>('gain');
  const [gainDb, setGainDb] = useState(-20);

  const load = useCallback((buffer: AudioBuffer) => {
    const results: StftResult[] = [];
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      results.push(stft(buffer.getChannelData(ch), FFT_SIZE));
    }
    stftRef.current = results;
    sourceMetaRef.current = {
      sampleRate: buffer.sampleRate,
      originalLength: buffer.length,
      numberOfChannels: buffer.numberOfChannels,
    };
    setHistory([]);
    setRedoStack([]);
    setSelection(null);
    setVersion((v) => v + 1);
    setIsOpen(true);
  }, []);

  const apply = useCallback(() => {
    if (!stftRef.current || !selection) return;
    const editsPerChannel = stftRef.current.map((result) =>
      tool === 'gain' ? applyGain(result.frames, selection, gainDb) : applyReplace(result.frames, selection)
    );
    setHistory((h) => [...h, { tool, box: selection, gainDb: tool === 'gain' ? gainDb : undefined, editsPerChannel }]);
    setRedoStack([]);
    setVersion((v) => v + 1);
  }, [selection, tool, gainDb]);

  const undo = useCallback(() => {
    setHistory((h) => {
      if (!stftRef.current || h.length === 0) return h;
      const last = h[h.length - 1];
      stftRef.current.forEach((result, i) => undoEdit(result.frames, last.editsPerChannel[i]));
      setRedoStack((r) => [...r, last]);
      setVersion((v) => v + 1);
      return h.slice(0, -1);
    });
  }, []);

  const redo = useCallback(() => {
    setRedoStack((r) => {
      if (!stftRef.current || r.length === 0) return r;
      const entry = r[r.length - 1];
      // Re-running apply fresh (rather than replaying a stored post-state)
      // is deterministic here — undo already restored the pre-edit state,
      // so applying the same operation again reproduces the same result
      // and yields a fresh EditRecord for any further undo.
      const editsPerChannel = stftRef.current.map((result) =>
        entry.tool === 'gain' ? applyGain(result.frames, entry.box, entry.gainDb!) : applyReplace(result.frames, entry.box)
      );
      setHistory((h) => [...h, { ...entry, editsPerChannel }]);
      setVersion((v) => v + 1);
      return r.slice(0, -1);
    });
  }, []);

  const renderToBuffer = useCallback((ctx: BaseAudioContext): AudioBuffer => {
    if (!stftRef.current || !sourceMetaRef.current) {
      throw new Error('Spectral editor: nothing loaded to render');
    }
    const { sampleRate, originalLength, numberOfChannels } = sourceMetaRef.current;
    const out = ctx.createBuffer(numberOfChannels, originalLength, sampleRate);
    stftRef.current.forEach((result, ch) => {
      const rebuilt = istft(result);
      out.copyToChannel(rebuilt.subarray(0, originalLength), ch);
    });
    return out;
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
  }, []);

  return {
    isOpen,
    open: load,
    close,
    version,
    stftRef,
    sourceMetaRef,
    selection,
    setSelection,
    tool,
    setTool,
    gainDb,
    setGainDb,
    apply,
    undo,
    redo,
    canUndo: history.length > 0,
    canRedo: redoStack.length > 0,
    renderToBuffer,
    fftSize: FFT_SIZE,
  };
}

export type SpectralEditorController = ReturnType<typeof useSpectralEditor>;
