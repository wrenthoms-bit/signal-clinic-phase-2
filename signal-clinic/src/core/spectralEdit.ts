import type { StftFrame } from './stft';

/**
 * A rectangular time/frequency selection — inclusive bin and frame
 * ranges, in actual STFT indices (not screen pixels; the UI converts
 * screen coordinates to this via spectrogramRender.ts's mapping
 * functions before calling into here).
 */
export interface SelectionBox {
  frameStart: number;
  frameEnd: number;
  binStart: number;
  binEnd: number;
}

/**
 * Snapshot of every bin an edit actually touches, keyed by frame then
 * bin — not just the primary [binStart, binEnd] range, but every
 * mirrored bin too. A contiguous-slice snapshot was tried first and
 * failed its own test: a bin's mirror can land back inside the primary
 * range for wide selections, and — more subtly — undo can't assume a
 * mirror bin's original value equals the primary bin's (only true for
 * genuinely symmetric input, which real audio always is, but the code
 * shouldn't silently depend on that to be correct). A real, ungenerated
 * test fixture with asymmetric values caught this; see
 * tests/spectralEdit.test.ts.
 */
export interface EditRecord {
  box: SelectionBox;
  previousMagnitudes: Map<number, Map<number, number>>; // frame -> (bin -> original value)
}

function mirrorBin(bin: number, fftSize: number): number {
  return (fftSize - bin) % fftSize;
}

function affectedBins(box: SelectionBox, fftSize: number): Set<number> {
  const bins = new Set<number>();
  for (let b = box.binStart; b <= box.binEnd; b++) {
    bins.add(b);
    bins.add(mirrorBin(b, fftSize));
  }
  return bins;
}

function snapshotFrame(frames: StftFrame[], frameIndex: number, bins: Set<number>): Map<number, number> {
  const mag = frames[frameIndex].magnitude;
  const snapshot = new Map<number, number>();
  for (const b of bins) snapshot.set(b, mag[b]);
  return snapshot;
}

/**
 * Attenuates the selected region by a fixed dB amount — the "Gain" tool,
 * for turning down (not necessarily removing) an isolated problem.
 * Every touched bin's new value is computed from its own pre-mutation
 * snapshot, so a selection wide enough that some bins' mirrors fall back
 * inside the same selection can't get double-scaled.
 */
export function applyGain(frames: StftFrame[], box: SelectionBox, gainDb: number): EditRecord {
  const gain = Math.pow(10, gainDb / 20);
  const previousMagnitudes = new Map<number, Map<number, number>>();

  for (let f = box.frameStart; f <= box.frameEnd && f < frames.length; f++) {
    const mag = frames[f].magnitude;
    const bins = affectedBins(box, mag.length);
    const snapshot = snapshotFrame(frames, f, bins);
    previousMagnitudes.set(f, snapshot);

    for (const b of bins) {
      mag[b] = snapshot.get(b)! * gain;
    }
  }

  return { box, previousMagnitudes };
}

/**
 * Replaces the selected region with a linear interpolation, per
 * frequency bin, between the material just before and just after the
 * selection in time — the "Replace" tool, for healing a region rather
 * than just turning it down. Phase is left untouched; only magnitude is
 * interpolated. That's a real simplification (a full inpainting tool
 * would reconstruct phase too), documented here rather than silently
 * assumed away — magnitude-only healing is standard in spectral repair
 * tools and works well for the broadband transients this targets, but
 * won't perfectly reconstruct sustained tonal content inside a large
 * selection.
 */
export function applyReplace(frames: StftFrame[], box: SelectionBox): EditRecord {
  const previousMagnitudes = new Map<number, Map<number, number>>();
  const fftSize = frames[box.frameStart]?.magnitude.length ?? 0;
  const bins = affectedBins(box, fftSize);

  for (let f = box.frameStart; f <= box.frameEnd && f < frames.length; f++) {
    previousMagnitudes.set(f, snapshotFrame(frames, f, bins));
  }

  const beforeIdx = Math.max(0, box.frameStart - 1);
  const afterIdx = Math.min(frames.length - 1, box.frameEnd + 1);
  const span = afterIdx - beforeIdx;

  // Anchor values read once, up front, from frames strictly outside the
  // edited range — those are never mutated by this function, so reading
  // them per-bin below is always reading a stable, original value.
  const anchorBefore = new Map<number, number>();
  const anchorAfter = new Map<number, number>();
  for (const b of bins) {
    anchorBefore.set(b, frames[beforeIdx].magnitude[b]);
    anchorAfter.set(b, frames[afterIdx].magnitude[b]);
  }

  for (let f = box.frameStart; f <= box.frameEnd && f < frames.length; f++) {
    const t = span > 0 ? (f - beforeIdx) / span : 0.5;
    const mag = frames[f].magnitude;
    for (const b of bins) {
      const beforeVal = anchorBefore.get(b)!;
      const afterVal = anchorAfter.get(b)!;
      mag[b] = beforeVal + (afterVal - beforeVal) * t;
    }
  }

  return { box, previousMagnitudes };
}

/** Restores exactly the magnitudes an edit changed, including every mirrored bin. */
export function undoEdit(frames: StftFrame[], edit: EditRecord): void {
  for (const [frameIndex, snapshot] of edit.previousMagnitudes) {
    if (frameIndex >= frames.length) continue;
    const mag = frames[frameIndex].magnitude;
    for (const [bin, value] of snapshot) {
      mag[bin] = value;
    }
  }
}
