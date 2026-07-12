import { fftInPlace, hannWindow } from './fft';

export interface StftFrame {
  magnitude: Float64Array;
  phase: Float64Array;
}

export interface StftResult {
  frames: StftFrame[];
  fftSize: number;
  hopSize: number;
  originalLength: number;
}

/**
 * Forward STFT with 75% overlap by default (hopSize = fftSize / 4) —
 * high enough overlap that overlap-add reconstruction after per-frame
 * gain edits (spectral repair, spectral-subtraction de-reverb) doesn't
 * produce audible frame-boundary seams.
 */
export function stft(signal: Float32Array, fftSize: number, hopSize = fftSize / 4): StftResult {
  const window = hannWindow(fftSize);
  const frames: StftFrame[] = [];

  for (let start = 0; start + fftSize <= signal.length + fftSize; start += hopSize) {
    const re = new Float64Array(fftSize);
    const im = new Float64Array(fftSize);
    for (let i = 0; i < fftSize; i++) {
      const s = start + i;
      re[i] = s < signal.length ? signal[s] * window[i] : 0;
    }
    fftInPlace(re, im, false);

    const magnitude = new Float64Array(fftSize);
    const phase = new Float64Array(fftSize);
    for (let i = 0; i < fftSize; i++) {
      magnitude[i] = Math.hypot(re[i], im[i]);
      phase[i] = Math.atan2(im[i], re[i]);
    }
    frames.push({ magnitude, phase });

    if (start >= signal.length) break;
  }

  return { frames, fftSize, hopSize, originalLength: signal.length };
}

/** Inverse STFT via overlap-add. Consumes (possibly edited) magnitude/phase frames. */
export function istft(result: StftResult): Float32Array {
  const { frames, fftSize, hopSize, originalLength } = result;
  const window = hannWindow(fftSize);
  const outLen = originalLength + fftSize;
  const out = new Float64Array(outLen);
  const windowSum = new Float64Array(outLen);

  for (let f = 0; f < frames.length; f++) {
    const { magnitude, phase } = frames[f];
    const re = new Float64Array(fftSize);
    const im = new Float64Array(fftSize);
    for (let i = 0; i < fftSize; i++) {
      re[i] = magnitude[i] * Math.cos(phase[i]);
      im[i] = magnitude[i] * Math.sin(phase[i]);
    }
    fftInPlace(re, im, true);

    const start = f * hopSize;
    for (let i = 0; i < fftSize; i++) {
      out[start + i] += re[i] * window[i];
      windowSum[start + i] += window[i] * window[i];
    }
  }

  const signal = new Float32Array(originalLength);
  for (let i = 0; i < originalLength; i++) {
    signal[i] = windowSum[i] > 1e-8 ? out[i] / windowSum[i] : out[i];
  }
  return signal;
}
