/**
 * Normalized cross-correlation between two channels over a lag search
 * range, used to detect L/R timing offset (Azimuth/Phase Control) and to
 * drive the stereo correlation meter.
 */
export function findBestLag(a: Float32Array, b: Float32Array, maxLagSamples: number): number {
  let bestLag = 0;
  let bestScore = -Infinity;

  // Coarse-to-fine would scale better for large maxLag; Phase 1 targets
  // tape-transfer-scale offsets (a few ms), so a direct search over a
  // capped range keeps this simple without a real performance cost.
  const cappedLag = Math.min(maxLagSamples, 4800); // ~100ms at 48kHz ceiling

  for (let lag = -cappedLag; lag <= cappedLag; lag++) {
    const score = correlationAtLag(a, b, lag);
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }
  return bestLag;
}

function correlationAtLag(a: Float32Array, b: Float32Array, lag: number): number {
  const start = Math.max(0, -lag);
  const end = Math.min(a.length, b.length - lag);
  if (end <= start) return -Infinity;

  let sum = 0;
  let normA = 0;
  let normB = 0;
  // Sample stride keeps this fast on full-length material — correlation
  // for offset detection doesn't need every sample, just a representative
  // window of the signal's overall alignment.
  const stride = Math.max(1, Math.floor((end - start) / 44100));

  for (let i = start; i < end; i += stride) {
    const av = a[i];
    const bv = b[i + lag];
    sum += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  const denom = Math.sqrt(normA * normB);
  return denom > 1e-9 ? sum / denom : -Infinity;
}

/** Overall (zero-lag) correlation coefficient, -1..1, for meter display. */
export function correlationCoefficient(a: Float32Array, b: Float32Array): number {
  return correlationAtLag(a, b, 0);
}
