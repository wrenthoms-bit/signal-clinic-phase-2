import { useCallback, useMemo, useRef, useState } from 'react';
import { ChainManager } from '../core/ChainManager';
import { buildStemsChain } from '../chains/stemsChain';
import { buildMasterChain } from '../chains/masterChain';
import { audioBufferToWavBlob } from '../core/wavEncoder';
import type { ChainType } from '../types/module';

export interface RenderProgress {
  moduleId: string;
  index: number;
  total: number;
}

export function useAudioEngine() {
  const [chainType, setChainType] = useState<ChainType>('stems');
  const [sourceBuffer, setSourceBuffer] = useState<AudioBuffer | null>(null);
  const [processedBuffer, setProcessedBuffer] = useState<AudioBuffer | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [isRendering, setIsRendering] = useState(false);
  const [progress, setProgress] = useState<RenderProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Rebuilding the chain on mode switch is intentional — stems and master
  // chains never share module instances or state (spec §2).
  const stemsChain = useMemo(() => buildStemsChain(), []);
  const masterChain = useMemo(() => buildMasterChain(), []);
  const activeChain: ChainManager = chainType === 'stems' ? stemsChain : masterChain;

  const audioCtxRef = useRef<AudioContext | null>(null);
  const playbackSourceRef = useRef<AudioBufferSourceNode | null>(null);

  const getAudioContext = useCallback(() => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
    }
    return audioCtxRef.current;
  }, []);

  const loadFile = useCallback(
    async (file: File) => {
      setError(null);
      try {
        const ctx = getAudioContext();
        const arrayBuffer = await file.arrayBuffer();
        const decoded = await ctx.decodeAudioData(arrayBuffer);
        setSourceBuffer(decoded);
        setProcessedBuffer(null);
        setFileName(file.name);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to decode audio file.');
      }
    },
    [getAudioContext]
  );

  const render = useCallback(async () => {
    if (!sourceBuffer) return;
    setIsRendering(true);
    setError(null);
    try {
      const result = await activeChain.render(sourceBuffer, OfflineAudioContext, (moduleId, index, total) =>
        setProgress({ moduleId, index, total })
      );
      setProcessedBuffer(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Rendering failed.');
    } finally {
      setIsRendering(false);
      setProgress(null);
    }
  }, [sourceBuffer, activeChain]);

  const play = useCallback(
    (which: 'source' | 'processed') => {
      const buffer = which === 'source' ? sourceBuffer : processedBuffer;
      if (!buffer) return;
      const ctx = getAudioContext();
      playbackSourceRef.current?.stop();
      const node = ctx.createBufferSource();
      node.buffer = buffer;
      node.connect(ctx.destination);
      node.start();
      playbackSourceRef.current = node;
    },
    [sourceBuffer, processedBuffer, getAudioContext]
  );

  const stop = useCallback(() => {
    playbackSourceRef.current?.stop();
    playbackSourceRef.current = null;
  }, []);

  const exportWav = useCallback(() => {
    if (!processedBuffer) return;
    const blob = audioBufferToWavBlob(processedBuffer);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const base = fileName.replace(/\.[^/.]+$/, '') || 'signal-clinic-export';
    a.href = url;
    a.download = `${base}-${chainType}.wav`;
    a.click();
    URL.revokeObjectURL(url);
  }, [processedBuffer, fileName, chainType]);

  return {
    chainType,
    setChainType,
    activeChain,
    sourceBuffer,
    processedBuffer,
    fileName,
    isRendering,
    progress,
    error,
    loadFile,
    render,
    play,
    stop,
    exportWav,
  };
}
