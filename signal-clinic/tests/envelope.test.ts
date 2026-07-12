import { test } from 'node:test';
import assert from 'node:assert/strict';
import { windowedRms, followEnvelope, dbToGain, gainToDb } from '../src/core/envelope';

function bruteForceWindowedRms(data: Float32Array, windowSamples: number): Float32Array {
  const out = new Float32Array(data.length);
  const half = Math.floor(windowSamples / 2);
  for (let i = 0; i < data.length; i++) {
    const start = Math.max(0, i - half);
    const end = Math.min(data.length - 1, i + half);
    let sumSq = 0;
    for (let j = start; j <= end; j++) sumSq += data[j] * data[j];
    out[i] = Math.sqrt(sumSq / (end - start + 1));
  }
  return out;
}

test('windowedRms matches a brute-force reference (regression test for the pre-fill bug)', () => {
  const n = 500;
  const data = new Float32Array(n);
  for (let i = 0; i < n; i++) data[i] = Math.sin(i * 0.05) * (1 + 0.3 * Math.sin(i * 0.003));

  for (const windowSamples of [5, 8, 21, 64, 101]) {
    const fast = windowedRms(data, windowSamples);
    const reference = bruteForceWindowedRms(data, windowSamples);

    let maxErr = 0;
    for (let i = 0; i < n; i++) maxErr = Math.max(maxErr, Math.abs(fast[i] - reference[i]));
    assert.ok(maxErr < 1e-6, `windowedRms diverges from brute force at windowSamples=${windowSamples}, maxErr=${maxErr}`);
  }
});

test('windowedRms: first sample includes the left edge of the window, not just later entries', () => {
  // Regression case for the specific bug found: index 0 was never added to
  // the running sum at all under the old enter/leave stepping.
  const data = new Float32Array([1, 1, 1, 1, 1]); // constant signal — RMS should be exactly 1 everywhere
  const out = windowedRms(data, 3);
  for (let i = 0; i < data.length; i++) {
    assert.ok(Math.abs(out[i] - 1) < 1e-6, `expected RMS ~1 at index ${i}, got ${out[i]}`);
  }
});

test('followEnvelope: rises quickly on attack, decays slowly on release', () => {
  const sr = 48000;
  const n = sr; // 1 second
  const data = new Float32Array(n);
  // Silence, then a sudden loud burst at 0.1s that ends at 0.11s
  const burstStart = Math.round(sr * 0.1);
  const burstEnd = Math.round(sr * 0.11);
  for (let i = burstStart; i < burstEnd; i++) data[i] = 1;

  const env = followEnvelope(data, sr, 1, 200, 'peak');

  // Envelope should be near zero well before the burst
  assert.ok(env[burstStart - 100] < 0.01, 'envelope should be near-silent before the burst');
  // Envelope should have risen substantially by the end of a 1ms-attack burst
  assert.ok(env[burstEnd - 1] > 0.5, 'envelope should have risen close to full scale by burst end');
  // 200ms after the burst ends, with a 200ms release, envelope should still
  // be meaningfully above zero (release hasn't fully completed) but below the peak
  const checkPoint = burstEnd + Math.round(sr * 0.05);
  assert.ok(env[checkPoint] > 0.01 && env[checkPoint] < 1, 'envelope should be mid-release, not instantly zero or still at peak');
});

test('dbToGain / gainToDb are inverses', () => {
  for (const db of [-60, -20, -6, 0, 6, 12]) {
    const gain = dbToGain(db);
    const roundTrip = gainToDb(gain);
    assert.ok(Math.abs(roundTrip - db) < 1e-6, `round-trip failed for ${db}dB, got ${roundTrip}`);
  }
  assert.ok(Math.abs(dbToGain(0) - 1) < 1e-9);
  assert.ok(Math.abs(dbToGain(-6) - 0.5012) < 0.001);
});
