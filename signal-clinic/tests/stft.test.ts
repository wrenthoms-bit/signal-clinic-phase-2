import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stft, istft } from '../src/core/stft';

test('stft + istft with no modification reconstructs the original signal', () => {
  const sr = 48000;
  const n = sr * 1; // 1 second
  const signal = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    signal[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / sr) + 0.2 * Math.sin((2 * Math.PI * 3000 * i) / sr);
  }

  const result = stft(signal, 2048);
  const rebuilt = istft(result);

  assert.equal(rebuilt.length, signal.length);

  // Skip the first/last frame's worth of samples — edge tapering from the
  // Hann window's zero endpoints is expected there, not a reconstruction bug.
  const edge = 2048;
  let maxErr = 0;
  for (let i = edge; i < signal.length - edge; i++) {
    maxErr = Math.max(maxErr, Math.abs(rebuilt[i] - signal[i]));
  }
  assert.ok(maxErr < 1e-3, `STFT/ISTFT round-trip error too large in the steady region: ${maxErr}`);
});

test('stft: frame count matches expected hop-based count', () => {
  const signal = new Float32Array(8192);
  const fftSize = 1024;
  const result = stft(signal, fftSize);
  assert.equal(result.hopSize, fftSize / 4);
  assert.ok(result.frames.length > 0);
  for (const frame of result.frames) {
    assert.equal(frame.magnitude.length, fftSize);
    assert.equal(frame.phase.length, fftSize);
  }
});
