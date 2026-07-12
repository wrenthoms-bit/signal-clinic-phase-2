import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fftInPlace, nextPowerOfTwo, hannWindow } from '../src/core/fft';

test('fftInPlace: forward + inverse reconstructs a random signal', () => {
  const n = 256;
  const original = new Float64Array(n);
  for (let i = 0; i < n; i++) original[i] = Math.sin(i * 0.13) + 0.3 * Math.random() - 0.15;

  const re = Float64Array.from(original);
  const im = new Float64Array(n);
  fftInPlace(re, im, false);
  fftInPlace(re, im, true);

  let maxErr = 0;
  for (let i = 0; i < n; i++) maxErr = Math.max(maxErr, Math.abs(re[i] - original[i]));
  assert.ok(maxErr < 1e-9, `round-trip error too large: ${maxErr}`);

  let maxImErr = 0;
  for (let i = 0; i < n; i++) maxImErr = Math.max(maxImErr, Math.abs(im[i]));
  assert.ok(maxImErr < 1e-9, `residual imaginary component too large: ${maxImErr}`);
});

test('fftInPlace: unit impulse produces a flat-magnitude spectrum', () => {
  const n = 64;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  re[0] = 1;
  fftInPlace(re, im, false);

  for (let i = 0; i < n; i++) {
    const mag = Math.hypot(re[i], im[i]);
    assert.ok(Math.abs(mag - 1) < 1e-9, `bin ${i} magnitude ${mag} should be 1 for a unit impulse`);
  }
});

test('fftInPlace: throws on non-power-of-two size', () => {
  const re = new Float64Array(100);
  const im = new Float64Array(100);
  assert.throws(() => fftInPlace(re, im, false));
});

test('nextPowerOfTwo', () => {
  assert.equal(nextPowerOfTwo(1), 1);
  assert.equal(nextPowerOfTwo(2), 2);
  assert.equal(nextPowerOfTwo(3), 4);
  assert.equal(nextPowerOfTwo(1000), 1024);
  assert.equal(nextPowerOfTwo(1024), 1024);
});

test('hannWindow: zero at both endpoints, peak of 1 at center', () => {
  const w = hannWindow(1024);
  assert.ok(w[0] < 1e-6);
  assert.ok(w[w.length - 1] < 1e-6);
  assert.ok(Math.abs(w[512] - 1) < 1e-3);
});
