import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hermiteFillGap } from '../src/core/interpolation';

test('hermiteFillGap: reconstructs a smooth sine wave gap within reasonable error', () => {
  const n = 1000;
  const sr = 48000;
  const freq = 440;
  const data = new Float32Array(n);
  for (let i = 0; i < n; i++) data[i] = Math.sin((2 * Math.PI * freq * i) / sr);

  const original = Float32Array.from(data);
  const gapStart = 400;
  const gapEnd = 420; // 21-sample gap, short relative to the wave period

  hermiteFillGap(data, gapStart, gapEnd);

  let maxErr = 0;
  for (let i = gapStart; i <= gapEnd; i++) {
    maxErr = Math.max(maxErr, Math.abs(data[i] - original[i]));
  }
  assert.ok(maxErr < 0.05, `interpolation error too large for a short gap in a smooth sine: ${maxErr}`);
});

test('hermiteFillGap: does not throw for a gap at the very start of the array', () => {
  const data = new Float32Array(50).fill(0.5);
  assert.doesNotThrow(() => hermiteFillGap(data, 0, 3));
});

test('hermiteFillGap: does not throw for a gap at the very end of the array', () => {
  const data = new Float32Array(50).fill(0.5);
  assert.doesNotThrow(() => hermiteFillGap(data, 46, 49));
});

test('hermiteFillGap: single-sample gap does not produce NaN', () => {
  const data = new Float32Array([0, 0.1, 0.2, 999, 0.4, 0.5]);
  hermiteFillGap(data, 3, 3);
  assert.ok(Number.isFinite(data[3]));
});
