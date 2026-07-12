import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyGain, applyReplace, undoEdit, type SelectionBox } from '../src/core/spectralEdit';
import type { StftFrame } from '../src/core/stft';

const FFT_SIZE = 16;

function makeFrames(count: number, fill: (frame: number, bin: number) => number): StftFrame[] {
  const frames: StftFrame[] = [];
  for (let f = 0; f < count; f++) {
    const magnitude = new Float64Array(FFT_SIZE);
    const phase = new Float64Array(FFT_SIZE);
    for (let b = 0; b < FFT_SIZE; b++) magnitude[b] = fill(f, b);
    frames.push({ magnitude, phase });
  }
  return frames;
}

test('applyGain reduces magnitude within the box by the exact expected factor', () => {
  const frames = makeFrames(10, () => 1.0);
  const box: SelectionBox = { frameStart: 3, frameEnd: 5, binStart: 2, binEnd: 4 };

  applyGain(frames, box, -20); // -20dB = 0.1x

  for (let f = 3; f <= 5; f++) {
    for (let b = 2; b <= 4; b++) {
      assert.ok(Math.abs(frames[f].magnitude[b] - 0.1) < 1e-9, `frame ${f} bin ${b} should be ~0.1`);
    }
  }
  // Outside the box, untouched
  assert.equal(frames[0].magnitude[2], 1.0);
  assert.equal(frames[3].magnitude[0], 1.0);
  assert.equal(frames[6].magnitude[3], 1.0);
});

test('applyGain mirrors the reduction onto the conjugate bin', () => {
  const frames = makeFrames(5, () => 1.0);
  const box: SelectionBox = { frameStart: 0, frameEnd: 0, binStart: 3, binEnd: 3 };

  applyGain(frames, box, -20);

  const mirror = (FFT_SIZE - 3) % FFT_SIZE;
  assert.ok(Math.abs(frames[0].magnitude[mirror] - 0.1) < 1e-9, 'mirror bin should also be reduced');
});

test('applyGain does not double-scale when a selection is wide enough that some bins\' mirrors fall back inside it', () => {
  // FFT_SIZE=16: a selection of bins 1..15 means every bin's mirror is
  // also inside the selection. A naive "loop bins, scale each bin and
  // its mirror" would double-apply gain to every bin here.
  const frames = makeFrames(3, () => 8.0);
  const box: SelectionBox = { frameStart: 0, frameEnd: 0, binStart: 1, binEnd: 15 };

  applyGain(frames, box, -20); // -20dB = 0.1x, applied exactly once

  for (let b = 1; b <= 15; b++) {
    assert.ok(Math.abs(frames[0].magnitude[b] - 0.8) < 1e-9, `bin ${b} should be 8.0 * 0.1 = 0.8 exactly once, got ${frames[0].magnitude[b]}`);
  }
});


test('undoEdit after applyGain restores the original values exactly', () => {
  const frames = makeFrames(10, (f, b) => f * 10 + b + 0.5);
  const original = frames.map((fr) => fr.magnitude.slice());
  const box: SelectionBox = { frameStart: 2, frameEnd: 7, binStart: 1, binEnd: 6 };

  const edit = applyGain(frames, box, -12);
  undoEdit(frames, edit);

  for (let f = 0; f < frames.length; f++) {
    for (let b = 0; b < FFT_SIZE; b++) {
      assert.equal(frames[f].magnitude[b], original[f][b], `frame ${f} bin ${b} did not restore exactly`);
    }
  }
});

test('applyReplace linearly interpolates between the frames just outside the selection', () => {
  // Bin 5 goes 0 -> 100 linearly across frames 0..10; frames 4..6 get "damaged"
  // to an obviously wrong value, then healed.
  const frames = makeFrames(11, (f, b) => (b === 5 ? f * 10 : 1));
  frames[4].magnitude[5] = 9999;
  frames[5].magnitude[5] = 9999;
  frames[6].magnitude[5] = 9999;

  const box: SelectionBox = { frameStart: 4, frameEnd: 6, binStart: 5, binEnd: 5 };
  applyReplace(frames, box);

  // Anchors are frame 3 (=30) and frame 7 (=70); frame 5 (midpoint) should land at 50
  assert.ok(Math.abs(frames[5].magnitude[5] - 50) < 1e-9, `expected ~50, got ${frames[5].magnitude[5]}`);
  // Frame 4 should be closer to the frame-3 anchor than frame 6 is
  assert.ok(frames[4].magnitude[5] < frames[6].magnitude[5]);
});

test('applyReplace clamps its anchors at the start of the buffer', () => {
  const frames = makeFrames(5, () => 42);
  const box: SelectionBox = { frameStart: 0, frameEnd: 1, binStart: 0, binEnd: 0 };
  assert.doesNotThrow(() => applyReplace(frames, box));
});

test('undoEdit after applyReplace restores the original values exactly', () => {
  const frames = makeFrames(12, (f, b) => f + b * 0.1);
  const original = frames.map((fr) => fr.magnitude.slice());
  const box: SelectionBox = { frameStart: 5, frameEnd: 8, binStart: 2, binEnd: 4 };

  const edit = applyReplace(frames, box);
  undoEdit(frames, edit);

  for (let f = 0; f < frames.length; f++) {
    for (let b = 0; b < FFT_SIZE; b++) {
      assert.equal(frames[f].magnitude[b], original[f][b], `frame ${f} bin ${b} did not restore exactly`);
    }
  }
});
