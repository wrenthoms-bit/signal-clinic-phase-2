/**
 * ITU-R BS.1770-4 loudness measurement — K-weighting filter, mean-square
 * per 400ms gating block (75% overlap), relative gating, integrated LUFS.
 *
 * K-weighting is two cascaded biquads: a high-shelf (simulating head
 * diffraction) and a high-pass (RLB, simulating reduced low-frequency
 * sensitivity). Coefficients below are the standard BS.1770 values at
 * 48kHz, bilinear-transformed for other sample rates.
 */

interface Biquad {
  b0: number; b1: number; b2: number; a1: number; a2: number;
}

function kWeightingStage1(sampleRate: number): Biquad {
  // Pre-filter: high shelf, +4dB above ~1.5kHz
  const fc = 1681.9744509555319;
  const G = 3.99984385397;
  const Q = 0.7071752369554193;
  return designHighShelf(fc, G, Q, sampleRate);
}

function kWeightingStage2(sampleRate: number): Biquad {
  // RLB high-pass, -3dB around 38Hz
  const fc = 38.13547087613982;
  const Q = 0.5003270373238773;
  return designHighPass(fc, Q, sampleRate);
}

function designHighShelf(fc: number, gainDb: number, Q: number, sr: number): Biquad {
  const A = Math.pow(10, gainDb / 40);
  const w0 = (2 * Math.PI * fc) / sr;
  const cosw0 = Math.cos(w0);
  const sinw0 = Math.sin(w0);
  const alpha = sinw0 / (2 * Q);
  const twoSqrtAAlpha = 2 * Math.sqrt(A) * alpha;

  const b0 = A * (A + 1 + (A - 1) * cosw0 + twoSqrtAAlpha);
  const b1 = -2 * A * (A - 1 + (A + 1) * cosw0);
  const b2 = A * (A + 1 + (A - 1) * cosw0 - twoSqrtAAlpha);
  const a0 = A + 1 - (A - 1) * cosw0 + twoSqrtAAlpha;
  const a1 = 2 * (A - 1 - (A + 1) * cosw0);
  const a2 = A + 1 - (A - 1) * cosw0 - twoSqrtAAlpha;

  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

function designHighPass(fc: number, Q: number, sr: number): Biquad {
  const w0 = (2 * Math.PI * fc) / sr;
  const cosw0 = Math.cos(w0);
  const sinw0 = Math.sin(w0);
  const alpha = sinw0 / (2 * Q);

  const b0 = (1 + cosw0) / 2;
  const b1 = -(1 + cosw0);
  const b2 = (1 + cosw0) / 2;
  const a0 = 1 + alpha;
  const a1 = -2 * cosw0;
  const a2 = 1 - alpha;

  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

function applyBiquad(data: Float32Array, c: Biquad): Float32Array {
  const out = new Float32Array(data.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < data.length; i++) {
    const x0 = data[i];
    const y0 = c.b0 * x0 + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    out[i] = y0;
    x2 = x1; x1 = x0;
    y2 = y1; y1 = y0;
  }
  return out;
}

function kWeight(data: Float32Array, sampleRate: number): Float32Array {
  const s1 = applyBiquad(data, kWeightingStage1(sampleRate));
  return applyBiquad(s1, kWeightingStage2(sampleRate));
}

/**
 * Measures integrated loudness (LUFS) from raw channel arrays — the pure
 * computation, with no AudioBuffer/DOM dependency, so it can be unit
 * tested directly (see tests/loudness.test.ts). Channel weighting is 1.0
 * for L/R/C, 1.41 for surrounds — simplified here to 1.0 per channel
 * since Phase 1 targets stereo material only.
 */
export function measureIntegratedLoudnessFromChannels(channels: Float32Array[], sampleRate: number): number {
  const blockSize = Math.round(sampleRate * 0.4); // 400ms gating block
  const hop = Math.round(blockSize * 0.25); // 75% overlap

  const weighted = channels.map((ch) => kWeight(ch, sampleRate));

  const blockLoudness: number[] = [];
  for (let start = 0; start + blockSize <= weighted[0].length; start += hop) {
    let sumSq = 0;
    for (let ch = 0; ch < weighted.length; ch++) {
      const data = weighted[ch];
      let chSum = 0;
      for (let i = start; i < start + blockSize; i++) chSum += data[i] * data[i];
      sumSq += chSum / blockSize;
    }
    const l = -0.691 + 10 * Math.log10(Math.max(sumSq, 1e-12));
    blockLoudness.push(l);
  }

  if (blockLoudness.length === 0) return -Infinity;

  // Absolute gate at -70 LUFS
  const absGated = blockLoudness.filter((l) => l > -70);
  if (absGated.length === 0) return -Infinity;

  const meanPow = absGated.reduce((s, l) => s + Math.pow(10, (l + 0.691) / 10), 0) / absGated.length;
  const relativeThreshold = -0.691 + 10 * Math.log10(meanPow) - 10;

  // Relative gate at (ungated mean - 10 LU)
  const relGated = absGated.filter((l) => l > relativeThreshold);
  if (relGated.length === 0) return -Infinity;

  const finalMeanPow = relGated.reduce((s, l) => s + Math.pow(10, (l + 0.691) / 10), 0) / relGated.length;
  return -0.691 + 10 * Math.log10(finalMeanPow);
}

/** Thin AudioBuffer wrapper around the pure channel-array measurement above. */
export function measureIntegratedLoudness(buffer: AudioBuffer): number {
  const channels: Float32Array[] = [];
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) channels.push(buffer.getChannelData(ch));
  return measureIntegratedLoudnessFromChannels(channels, buffer.sampleRate);
}

/**
 * Approximate true-peak detection via 4x linear-interpolation oversampling.
 * This is a lightweight stand-in for the spec's polyphase-filtered true
 * peak — flagged in README as an approximation, not full ITU-R BS.1770
 * Annex 2 compliance, since a proper polyphase oversampling filter is a
 * meaningful chunk of additional DSP that Phase 1 defers.
 */
export function estimateTruePeakDbFromChannels(channels: Float32Array[]): number {
  let peak = 0;
  for (const data of channels) {
    for (let i = 0; i < data.length - 1; i++) {
      const a = data[i];
      const b = data[i + 1];
      for (let f = 0; f < 4; f++) {
        const interp = a + (b - a) * (f / 4);
        if (Math.abs(interp) > peak) peak = Math.abs(interp);
      }
    }
  }
  return 20 * Math.log10(Math.max(peak, 1e-8));
}

/** Thin AudioBuffer wrapper around the pure channel-array true-peak estimate above. */
export function estimateTruePeakDb(buffer: AudioBuffer): number {
  const channels: Float32Array[] = [];
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) channels.push(buffer.getChannelData(ch));
  return estimateTruePeakDbFromChannels(channels);
}
