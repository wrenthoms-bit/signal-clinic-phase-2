import type { StftFrame } from './stft';

/**
 * Coordinate mapping + rendering for the manual Spectral Repair editor
 * (spec §6.2's originally-intended visual paint tool, which Phase 1
 * shipped as automated-only — see SpectralRepair.ts's doc comment).
 *
 * Frequency axis is log-scaled for display (matching how every real
 * spectrogram viewer works — most program material and most problems
 * live in the lower/mid bands, and a linear axis wastes half the canvas
 * on high frequencies where nothing interesting usually happens). The
 * underlying STFT data stays linear-bin, as FFT output always is —
 * only the screen-space mapping is logarithmic, via freqToY/yToFreq.
 */

export interface SpectrogramViewport {
  width: number;
  height: number;
  minFreq: number;
  maxFreq: number;
}

export function frameToX(frameIndex: number, frameCount: number, width: number): number {
  if (frameCount <= 1) return 0;
  return (frameIndex / (frameCount - 1)) * width;
}

export function xToFrame(x: number, frameCount: number, width: number): number {
  if (frameCount <= 1) return 0;
  const t = Math.min(1, Math.max(0, x / width));
  return Math.round(t * (frameCount - 1));
}

export function binToFrequency(bin: number, fftSize: number, sampleRate: number): number {
  return (bin * sampleRate) / fftSize;
}

export function frequencyToBin(freq: number, fftSize: number, sampleRate: number): number {
  return Math.round((freq * fftSize) / sampleRate);
}

/** Log-frequency mapping: y=0 is the top of the canvas (highest frequency). */
export function freqToY(freq: number, viewport: SpectrogramViewport): number {
  const clamped = Math.min(viewport.maxFreq, Math.max(viewport.minFreq, freq));
  const logRange = Math.log2(viewport.maxFreq / viewport.minFreq);
  const t = Math.log2(clamped / viewport.minFreq) / logRange;
  return (1 - t) * viewport.height;
}

export function yToFreq(y: number, viewport: SpectrogramViewport): number {
  const t = 1 - Math.min(1, Math.max(0, y / viewport.height));
  const logRange = Math.log2(viewport.maxFreq / viewport.minFreq);
  return viewport.minFreq * Math.pow(2, t * logRange);
}

/**
 * On-brand color ramp (void -> dark teal -> signal teal -> ink highlight)
 * instead of a generic rainbow heatmap — ties the editor's signature
 * visual to the same palette as the rest of the rack UI.
 */
const COLOR_STOPS: Array<{ t: number; rgb: [number, number, number] }> = [
  { t: 0.0, rgb: [16, 18, 21] }, // #101215 void
  { t: 0.45, rgb: [26, 74, 69] }, // dark teal
  { t: 0.75, rgb: [79, 216, 196] }, // #4FD8C4 signal
  { t: 1.0, rgb: [237, 234, 227] }, // #EDEAE3 ink highlight
];

function magnitudeToColor(t: number): [number, number, number] {
  const clamped = Math.min(1, Math.max(0, t));
  for (let i = 1; i < COLOR_STOPS.length; i++) {
    if (clamped <= COLOR_STOPS[i].t) {
      const a = COLOR_STOPS[i - 1];
      const b = COLOR_STOPS[i];
      const span = b.t - a.t;
      const localT = span > 0 ? (clamped - a.t) / span : 0;
      return [
        Math.round(a.rgb[0] + (b.rgb[0] - a.rgb[0]) * localT),
        Math.round(a.rgb[1] + (b.rgb[1] - a.rgb[1]) * localT),
        Math.round(a.rgb[2] + (b.rgb[2] - a.rgb[2]) * localT),
      ];
    }
  }
  return COLOR_STOPS[COLOR_STOPS.length - 1].rgb;
}

/**
 * Renders (a downsampled view of) the spectrogram to ImageData. Real
 * audio files produce far more STFT frames than a canvas has pixel
 * columns — each column takes the MAX magnitude across the frames/bins
 * that map to it (max, not average, so transients stay visible rather
 * than getting smoothed away). Selection still resolves to exact frame/
 * bin indices via frameToX/yToFreq — only the picture is downsampled,
 * not the underlying data being edited.
 *
 * KNOWN LIMITATION: no pan/zoom — the whole buffer is always squeezed
 * into one canvas width. Fine for finding and fixing a handful of
 * problem spots; a proper zoomed timeline view is future work.
 */
export function renderSpectrogramToImageData(
  frames: StftFrame[],
  fftSize: number,
  sampleRate: number,
  viewport: SpectrogramViewport,
  floorDb = -80
): ImageData {
  const { width, height } = viewport;
  const imageData = new ImageData(width, height);
  const frameCount = frames.length;

  for (let x = 0; x < width; x++) {
    const frameStart = xToFrame((x / width) * width, frameCount, width);
    const frameEnd = Math.max(frameStart, xToFrame(((x + 1) / width) * width, frameCount, width));

    for (let y = 0; y < height; y++) {
      const freqTop = yToFreq(y, viewport);
      const freqBottom = yToFreq(y + 1, viewport);
      const binHigh = Math.min(fftSize / 2, frequencyToBin(freqTop, fftSize, sampleRate));
      const binLow = Math.max(0, frequencyToBin(freqBottom, fftSize, sampleRate));

      let maxMag = 0;
      for (let f = frameStart; f <= frameEnd && f < frameCount; f++) {
        const mag = frames[f].magnitude;
        for (let b = binLow; b <= binHigh; b++) {
          if (mag[b] > maxMag) maxMag = mag[b];
        }
      }

      const db = 20 * Math.log10(Math.max(maxMag, 1e-9));
      const t = Math.min(1, Math.max(0, (db - floorDb) / -floorDb));
      const [r, g, b] = magnitudeToColor(t);

      const idx = (y * width + x) * 4;
      imageData.data[idx] = r;
      imageData.data[idx + 1] = g;
      imageData.data[idx + 2] = b;
      imageData.data[idx + 3] = 255;
    }
  }

  return imageData;
}
