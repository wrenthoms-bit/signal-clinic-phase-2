import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findBestLag, correlationCoefficient } from '../src/core/correlation';

function makeTestSignal(n: number): Float32Array {
  const s = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    s[i] = Math.sin(i * 0.05) + 0.5 * Math.sin(i * 0.13) + 0.1 * Math.sin(i * 0.71);
  }
  return s;
}

test('findBestLag detects a known positive delay between channels', () => {
  const n = 20000;
  const knownLag = 37;
  const a = makeTestSignal(n);
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const srcIdx = i - knownLag;
    b[i] = srcIdx >= 0 ? a[srcIdx] : 0;
  }

  const detected = findBestLag(a, b, 200);
  assert.equal(detected, knownLag, `expected lag ${knownLag}, detected ${detected}`);
});

test('findBestLag detects a known negative delay between channels', () => {
  const n = 20000;
  const knownLag = -22;
  const a = makeTestSignal(n);
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const srcIdx = i - knownLag;
    b[i] = srcIdx >= 0 && srcIdx < n ? a[srcIdx] : 0;
  }

  const detected = findBestLag(a, b, 200);
  assert.equal(detected, knownLag, `expected lag ${knownLag}, detected ${detected}`);
});

test('correlationCoefficient: identical signals correlate near 1', () => {
  const a = makeTestSignal(5000);
  const coef = correlationCoefficient(a, a);
  assert.ok(coef > 0.999, `expected near-1 correlation, got ${coef}`);
});

test('correlationCoefficient: inverted signal correlates near -1', () => {
  const a = makeTestSignal(5000);
  const inverted = a.map((v) => -v);
  const coef = correlationCoefficient(a, inverted);
  assert.ok(coef < -0.999, `expected near-(-1) correlation, got ${coef}`);
});
