import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  frameToX,
  xToFrame,
  binToFrequency,
  frequencyToBin,
  freqToY,
  yToFreq,
  type SpectrogramViewport,
} from '../src/core/spectrogramRender';

test('frameToX / xToFrame round-trip across the width', () => {
  const frameCount = 500;
  const width = 1000;
  for (const frame of [0, 1, 100, 250, 499]) {
    const x = frameToX(frame, frameCount, width);
    const roundTripped = xToFrame(x, frameCount, width);
    assert.ok(Math.abs(roundTripped - frame) <= 1, `frame ${frame} round-tripped to ${roundTripped}`);
  }
});

test('frameToX: frameCount of 1 does not divide by zero', () => {
  assert.equal(frameToX(0, 1, 800), 0);
  assert.doesNotThrow(() => xToFrame(400, 1, 800));
});

test('binToFrequency / frequencyToBin round-trip', () => {
  const fftSize = 2048;
  const sampleRate = 44100;
  for (const bin of [0, 1, 100, 512, 1024]) {
    const freq = binToFrequency(bin, fftSize, sampleRate);
    const roundTripped = frequencyToBin(freq, fftSize, sampleRate);
    assert.equal(roundTripped, bin);
  }
});

test('freqToY: higher frequency maps to a smaller y (top of canvas)', () => {
  const viewport: SpectrogramViewport = { width: 800, height: 400, minFreq: 20, maxFreq: 20000 };
  const yLow = freqToY(100, viewport);
  const yHigh = freqToY(10000, viewport);
  assert.ok(yHigh < yLow, `expected higher frequency to be nearer the top: yLow=${yLow}, yHigh=${yHigh}`);
});

test('freqToY / yToFreq round-trip (log scale)', () => {
  const viewport: SpectrogramViewport = { width: 800, height: 400, minFreq: 20, maxFreq: 20000 };
  for (const freq of [20, 100, 440, 1000, 5000, 20000]) {
    const y = freqToY(freq, viewport);
    const roundTripped = yToFreq(y, viewport);
    const relativeError = Math.abs(roundTripped - freq) / freq;
    assert.ok(relativeError < 0.01, `freq ${freq} round-tripped to ${roundTripped} (${relativeError * 100}% error)`);
  }
});

test('freqToY: clamps frequencies outside the viewport range', () => {
  const viewport: SpectrogramViewport = { width: 800, height: 400, minFreq: 20, maxFreq: 20000 };
  assert.equal(freqToY(5, viewport), viewport.height); // below minFreq -> bottom
  assert.equal(freqToY(30000, viewport), 0); // above maxFreq -> top
});
