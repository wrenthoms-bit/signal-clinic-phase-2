import { useCallback, useEffect, useRef } from 'react';
import type { StftFrame } from '../core/stft';
import {
  renderSpectrogramToImageData,
  frameToX,
  xToFrame,
  freqToY,
  yToFreq,
  binToFrequency,
  frequencyToBin,
  type SpectrogramViewport,
} from '../core/spectrogramRender';
import type { SpectralEditorController } from '../hooks/useSpectralEditor';

interface Props {
  editor: SpectralEditorController;
}

const WIDTH = 900;
const HEIGHT = 360;
const MIN_FREQ = 20;

/** Builds a mono-downmix frame array purely for display — editing still applies per-channel. */
function buildDisplayFrames(channels: import('../core/stft').StftResult[]): StftFrame[] {
  const frameCount = channels[0].frames.length;
  const fftSize = channels[0].fftSize;
  const display: StftFrame[] = [];
  for (let f = 0; f < frameCount; f++) {
    const magnitude = new Float64Array(fftSize);
    for (let b = 0; b < fftSize; b++) {
      let sum = 0;
      for (const ch of channels) sum += ch.frames[f].magnitude[b];
      magnitude[b] = sum / channels.length;
    }
    display.push({ magnitude, phase: new Float64Array(fftSize) });
  }
  return display;
}

export function SpectralEditorCanvas({ editor }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragStartPixel = useRef<{ x: number; y: number } | null>(null);

  const getViewport = useCallback((): SpectrogramViewport => {
    const sampleRate = editor.sourceMetaRef.current?.sampleRate ?? 44100;
    return { width: WIDTH, height: HEIGHT, minFreq: MIN_FREQ, maxFreq: sampleRate / 2 };
  }, [editor.sourceMetaRef]);

  useEffect(() => {
    const channels = editor.stftRef.current;
    const canvas = canvasRef.current;
    if (!channels || !canvas) return;
    const ctx2d = canvas.getContext('2d');
    if (!ctx2d) return;

    const displayFrames = buildDisplayFrames(channels);
    const sampleRate = editor.sourceMetaRef.current?.sampleRate ?? 44100;
    const viewport = getViewport();
    const imageData = renderSpectrogramToImageData(displayFrames, channels[0].fftSize, sampleRate, viewport);
    ctx2d.putImageData(imageData, 0, 0);

    if (editor.selection) {
      const frameCount = channels[0].frames.length;
      const fftSize = channels[0].fftSize;
      const x0 = frameToX(editor.selection.frameStart, frameCount, WIDTH);
      const x1 = frameToX(editor.selection.frameEnd, frameCount, WIDTH);
      // binEnd is the higher frequency, which maps to a *smaller* y (top of canvas)
      const y0 = freqToY(binToFrequency(editor.selection.binEnd, fftSize, sampleRate), viewport);
      const y1 = freqToY(binToFrequency(editor.selection.binStart, fftSize, sampleRate), viewport);
      ctx2d.strokeStyle = '#4FD8C4';
      ctx2d.lineWidth = 1.5;
      ctx2d.strokeRect(x0, y0, x1 - x0, y1 - y0);
      ctx2d.fillStyle = 'rgba(79, 216, 196, 0.15)';
      ctx2d.fillRect(x0, y0, x1 - x0, y1 - y0);
    }
  }, [editor.version, editor.selection, editor.stftRef, editor.sourceMetaRef, getViewport]);

  const pixelFromEvent = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const selectionFromDrag = useCallback(
    (start: { x: number; y: number }, end: { x: number; y: number }) => {
      const channels = editor.stftRef.current;
      if (!channels) return;
      const frameCount = channels[0].frames.length;
      const fftSize = channels[0].fftSize;
      const sampleRate = editor.sourceMetaRef.current?.sampleRate ?? 44100;
      const viewport = getViewport();

      const frameA = xToFrame(Math.min(start.x, end.x), frameCount, WIDTH);
      const frameB = xToFrame(Math.max(start.x, end.x), frameCount, WIDTH);
      const freqA = yToFreq(Math.min(start.y, end.y), viewport);
      const freqB = yToFreq(Math.max(start.y, end.y), viewport);
      const binHigh = Math.min(fftSize / 2, frequencyToBin(freqA, fftSize, sampleRate));
      const binLow = Math.max(0, frequencyToBin(freqB, fftSize, sampleRate));

      editor.setSelection({
        frameStart: frameA,
        frameEnd: Math.max(frameA, frameB),
        binStart: Math.min(binLow, binHigh),
        binEnd: Math.max(binLow, binHigh),
      });
    },
    [editor, getViewport]
  );

  return (
    <canvas
      ref={canvasRef}
      width={WIDTH}
      height={HEIGHT}
      onPointerDown={(e) => {
        dragStartPixel.current = pixelFromEvent(e);
      }}
      onPointerMove={(e) => {
        if (!dragStartPixel.current) return;
        selectionFromDrag(dragStartPixel.current, pixelFromEvent(e));
      }}
      onPointerUp={() => {
        dragStartPixel.current = null;
      }}
      className="w-full touch-none rounded-lg border border-hairline bg-void cursor-crosshair"
      style={{ aspectRatio: `${WIDTH} / ${HEIGHT}` }}
    />
  );
}
