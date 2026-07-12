import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measureIntegratedLoudnessFromChannels, estimateTruePeakDbFromChannels } from '../src/core/loudness';

function sineChannel(n: number, sr: number, freq: number, amplitude: number): Float32Array {
  const data = new Float32Array(n);
  for (let i = 0; i < n; i++) data[i] = amplitude * Math.sin((2 * Math.PI * freq * i) / sr);
  return data;
}

test('measureIntegratedLoudnessFromChannels: louder signal measures higher LUFS', () => {
  const sr = 48000;
  const n = sr * 3; // 3 seconds — enough for several gating blocks
  const quiet = [sineChannel(n, sr, 1000, 0.1), sineChannel(n, sr, 1000, 0.1)];
  const loud = [sineChannel(n, sr, 1000, 0.5), sineChannel(n, sr, 1000, 0.5)];

  const quietLufs = measureIntegratedLoudnessFromChannels(quiet, sr);
  const loudLufs = measureIntegratedLoudnessFromChannels(loud, sr);

  assert.ok(loudLufs > quietLufs, `expected louder signal to measure higher LUFS: quiet=${quietLufs}, loud=${loudLufs}`);
  // 5x amplitude is +14dB; LUFS should track that roughly (allow filter/gating slack)
  assert.ok(Math.abs(loudLufs - quietLufs - 13.98) < 2, `expected ~14 LU difference, got ${loudLufs - quietLufs}`);
});

test('measureIntegratedLoudnessFromChannels: near-silence returns -Infinity (absolute-gated out)', () => {
  const sr = 48000;
  const n = sr * 2;
  const silence = [new Float32Array(n), new Float32Array(n)];
  const lufs = measureIntegratedLoudnessFromChannels(silence, sr);
  assert.equal(lufs, -Infinity);
});

test('estimateTruePeakDbFromChannels: full-scale sine measures close to 0dBTP', () => {
  const sr = 48000;
  const n = sr;
  const channels = [sineChannel(n, sr, 1000, 0.999)];
  const peak = estimateTruePeakDbFromChannels(channels);
  assert.ok(peak > -1 && peak <= 0.5, `expected peak near 0dBTP, got ${peak}`);
});

test('estimateTruePeakDbFromChannels: silence measures at the floor, not NaN', () => {
  const channels = [new Float32Array(1000)];
  const peak = estimateTruePeakDbFromChannels(channels);
  assert.ok(Number.isFinite(peak));
  assert.ok(peak < -100);
});
