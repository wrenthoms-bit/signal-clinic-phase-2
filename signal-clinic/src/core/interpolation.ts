/**
 * Gap-fill interpolation shared by De-clip and De-click.
 *
 * Both modules face the same underlying problem — a run of samples is
 * damaged and needs to be rebuilt from the surrounding, undamaged waveform.
 * Cubic Hermite interpolation is used rather than linear interpolation
 * because linear interpolation leaves an audible "flat" segment in fast
 * transients; Hermite interpolation uses estimated slopes at each edge of
 * the gap so the reconstructed segment continues the waveform's curvature
 * rather than just connecting two points with a straight line.
 */

/**
 * Fills data[start..end] (inclusive) in place, using samples just outside
 * the gap to estimate boundary values and slopes.
 */
export function hermiteFillGap(data: Float32Array, start: number, end: number): void {
  const gapLen = end - start + 1;
  if (gapLen <= 0) return;

  // Slope estimation window — average local derivative over a few samples
  // rather than a single sample pair, so a single noisy neighbour sample
  // doesn't dictate the whole reconstructed curve.
  const slopeWindow = 3;

  const p0Idx = Math.max(0, start - 1);
  const p1Idx = Math.min(data.length - 1, end + 1);

  const p0 = data[p0Idx];
  const p1 = data[p1Idx];

  const m0 = estimateSlope(data, p0Idx, -1, slopeWindow);
  const m1 = estimateSlope(data, p1Idx, +1, slopeWindow);

  // Tangent scaling uses the true sample distance between p0 and p1, not
  // just the gap length — p0 and p1 sit one sample outside the gap on
  // each side, so the actual span is gapLen + 1.
  const span = p1Idx - p0Idx;

  for (let i = 0; i < gapLen; i++) {
    const t = gapLen === 1 ? 0.5 : i / (gapLen - 1);
    data[start + i] = hermite(t, p0, p1, m0, m1, span);
  }
}

/**
 * Estimates the signal's rate of change (per sample, in the direction of
 * increasing index) at `idx`, using a `window`-sample baseline on the
 * `dir` side. Falls back to a shorter baseline near an array boundary
 * rather than silently returning 0 for the full requested window.
 *
 * Caught by tests/interpolation.test.ts: an earlier per-k accumulation
 * here returned the *negated* slope for a rising signal on both sides —
 * verified failing, not just imprecise — which fed the wrong-sign tangent
 * into the Hermite blend and visibly distorted reconstructed gaps.
 */
function estimateSlope(data: Float32Array, idx: number, dir: -1 | 1, window: number): number {
  for (let w = window; w >= 1; w--) {
    const otherIdx = idx + dir * w;
    if (otherIdx < 0 || otherIdx >= data.length) continue;
    return dir === 1 ? (data[otherIdx] - data[idx]) / w : (data[idx] - data[otherIdx]) / w;
  }
  return 0;
}

function hermite(t: number, p0: number, p1: number, m0: number, m1: number, span: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  // Tangents (m0, m1) are per-sample slopes; the Hermite basis expects
  // tangents with respect to the normalized parameter t, so scale by the
  // sample span between p0 and p1 to convert.
  return h00 * p0 + h10 * m0 * span + h01 * p1 + h11 * m1 * span;
}
