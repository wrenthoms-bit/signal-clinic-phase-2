import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockAudioBuffer, MockOfflineAudioContext } from './mockWebAudio';
import { DeClip } from '../src/modules/stems/DeClip';
import { DeHum } from '../src/modules/stems/DeHum';
import { DeClick } from '../src/modules/stems/DeClick';
import { DePlosive } from '../src/modules/stems/DePlosive';
import { DeReverb } from '../src/modules/stems/DeReverb';
import { BreathControl } from '../src/modules/stems/BreathControl';
import { DeEss } from '../src/modules/stems/DeEss';
import { SpectralRepair } from '../src/modules/master/SpectralRepair';
import { AzimuthPhase } from '../src/modules/master/AzimuthPhase';
import { LoudnessControl } from '../src/modules/master/LoudnessControl';
import { ChainManager } from '../src/core/ChainManager';
import { measureIntegratedLoudnessFromChannels } from '../src/core/loudness';

const SR = 48000;

function makeBuffer(channels: Float32Array[], sampleRate = SR): MockAudioBuffer {
  const buf = new MockAudioBuffer(channels.length, channels[0].length, sampleRate);
  channels.forEach((data, i) => buf.copyToChannel(data, i));
  return buf;
}

function sine(n: number, freq: number, amp = 0.5, sampleRate = SR): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / sampleRate);
  return out;
}

function rms(data: Float32Array, start = 0, end = data.length): number {
  let sum = 0;
  for (let i = start; i < end; i++) sum += data[i] * data[i];
  return Math.sqrt(sum / (end - start));
}

function longestFlatRun(data: Float32Array, tolerance = 1e-6): number {
  let longest = 0;
  let current = 1;
  for (let i = 1; i < data.length; i++) {
    if (Math.abs(data[i] - data[i - 1]) < tolerance) current++;
    else current = 1;
    longest = Math.max(longest, current);
  }
  return longest;
}

/** Goertzel single-frequency magnitude estimate — standard algorithm, used
    only to check "how much energy is at this frequency" in test assertions. */
function goertzelMagnitude(data: Float32Array, sampleRate: number, targetFreq: number): number {
  const n = data.length;
  const k = Math.round((n * targetFreq) / sampleRate);
  const w = (2 * Math.PI * k) / n;
  const coeff = 2 * Math.cos(w);
  let q0 = 0, q1 = 0, q2 = 0;
  for (let i = 0; i < n; i++) {
    q0 = coeff * q1 - q2 + data[i];
    q2 = q1;
    q1 = q0;
  }
  const real = q1 - q2 * Math.cos(w);
  const imag = q2 * Math.sin(w);
  return Math.hypot(real, imag) / n;
}

async function run(module: { processOffline: (input: any, ctx: any) => Promise<any> }, input: MockAudioBuffer): Promise<MockAudioBuffer> {
  const ctx = new MockOfflineAudioContext(input.numberOfChannels, input.length, input.sampleRate);
  return module.processOffline(input as any, ctx as any);
}

test('DeClip: repairs a clipped run so it is no longer a long flat plateau', async () => {
  const n = SR; // 1s
  const data = sine(n, 220, 0.9);
  // simulate hard clipping: anything above 0.8 gets slammed to a flat 0.98 plateau
  for (let i = 0; i < n; i++) if (data[i] > 0.8) data[i] = 0.98;

  const before = longestFlatRun(data);
  const out = await run(new DeClip(), makeBuffer([data]));
  const after = longestFlatRun(out.getChannelData(0));

  assert.ok(before > 20, 'sanity check: the synthetic clip should have produced a real flat run');
  assert.ok(after < before / 2, `expected declip to break up the flat plateau, before=${before} after=${after}`);
});

test('DeHum: attenuates an injected 60Hz tone without destroying an unrelated 1000Hz tone', async () => {
  const n = SR; // 1s — good frequency resolution for the 45-65Hz search band
  // 1000Hz deliberately isn't a harmonic of 60Hz (default harmonics=4 notches
  // up to the 5th harmonic, 300Hz) — picking a harmonic by accident here
  // would make this look like a bug in DeHum when it's actually correct
  // behaviour (notching a real harmonic of the detected hum).
  const music = sine(n, 1000, 0.4);
  const hum = sine(n, 60, 0.3);
  const data = new Float32Array(n);
  for (let i = 0; i < n; i++) data[i] = music[i] + hum[i];

  const humBefore = goertzelMagnitude(data, SR, 60);
  const musicBefore = goertzelMagnitude(data, SR, 1000);

  const out = await run(new DeHum(), makeBuffer([data]));
  const outData = out.getChannelData(0);

  const humAfter = goertzelMagnitude(outData, SR, 60);
  const musicAfter = goertzelMagnitude(outData, SR, 1000);

  assert.ok(humAfter < humBefore * 0.3, `expected 60Hz notched down substantially: before=${humBefore}, after=${humAfter}`);
  assert.ok(musicAfter > musicBefore * 0.8, `expected 1000Hz to survive largely untouched: before=${musicBefore}, after=${musicAfter}`);
});

test('DeClick: attenuates a single large impulse without disturbing the surrounding waveform', async () => {
  const n = 4800; // 100ms
  const data = sine(n, 220, 0.3);
  const impulseIdx = 2400;
  data[impulseIdx] = 5.0; // absurd single-sample spike, way outside program material

  const out = await run(new DeClick(), makeBuffer([data]));
  const outData = out.getChannelData(0);

  assert.ok(Math.abs(outData[impulseIdx]) < 1.0, `expected the impulse to be interpolated away, got ${outData[impulseIdx]}`);
  // A neighbouring untouched sample should be close to the original sine value
  const neighbourIdx = impulseIdx - 100;
  assert.ok(
    Math.abs(outData[neighbourIdx] - data[neighbourIdx]) < 0.05,
    'expected samples away from the click to be essentially untouched'
  );
});

test('DePlosive: reduces the peak of a low-frequency burst', async () => {
  const n = 9600; // 200ms
  const data = sine(n, 300, 0.2);
  const burstStart = 4000;
  const burstEnd = 4200;
  const burst = sine(burstEnd - burstStart, 80, 0.9); // 80Hz burst, well inside the LF band
  for (let i = burstStart; i < burstEnd; i++) data[i] += burst[i - burstStart];

  const peakBefore = Math.max(...Array.from(data.subarray(burstStart, burstEnd)).map(Math.abs));

  const out = await run(new DePlosive(), makeBuffer([data]));
  const outData = out.getChannelData(0);
  const peakAfter = Math.max(...Array.from(outData.subarray(burstStart, burstEnd)).map(Math.abs));

  assert.ok(peakAfter < peakBefore * 0.85, `expected burst peak reduced: before=${peakBefore}, after=${peakAfter}`);
});

test('DeReverb: reduces sustained tail energy relative to the transient', async () => {
  const n = SR; // 1s
  const data = new Float32Array(n);
  // Transient at the start, then a synthetic exponentially-decaying "tail"
  // standing in for room reflections — not real reverb, just enough
  // sustained trailing energy for spectral subtraction to have something
  // to act on.
  for (let i = 0; i < 200; i++) data[i] = sine(200, 300, 0.8)[i];
  for (let i = 200; i < n; i++) {
    const decay = Math.exp(-(i - 200) / (SR * 0.3));
    data[i] = decay * 0.3 * Math.sin(i * 0.7) * (0.5 + 0.5 * Math.random());
  }

  const tailRmsBefore = rms(data, SR / 2, SR - 1000);
  const out = await run(new DeReverb(), makeBuffer([data]));
  const tailRmsAfter = rms(out.getChannelData(0), SR / 2, SR - 1000);

  assert.ok(Number.isFinite(tailRmsAfter));
  assert.ok(tailRmsAfter < tailRmsBefore, `expected tail energy reduced: before=${tailRmsBefore}, after=${tailRmsAfter}`);
});

test('BreathControl: reduces a quiet broadband "breath" region without gating loud performance', async () => {
  const n = SR; // 1s
  const data = new Float32Array(n);
  // Loud "performance" for most of the file, with a quieter broadband
  // "breath" region in the middle.
  for (let i = 0; i < n; i++) data[i] = 0.5 * Math.sin(i * 0.09);
  const breathStart = Math.floor(n * 0.4);
  const breathEnd = Math.floor(n * 0.5);
  for (let i = breathStart; i < breathEnd; i++) data[i] = 0.08 * (Math.random() * 2 - 1);

  const performanceRmsBefore = rms(data, 0, breathStart - 1000);
  const breathRmsBefore = rms(data, breathStart, breathEnd);

  const out = await run(new BreathControl(), makeBuffer([data]));
  const outData = out.getChannelData(0);
  const performanceRmsAfter = rms(outData, 0, breathStart - 1000);
  const breathRmsAfter = rms(outData, breathStart, breathEnd);

  assert.ok(
    performanceRmsAfter > performanceRmsBefore * 0.9,
    `performance section should be largely untouched: before=${performanceRmsBefore}, after=${performanceRmsAfter}`
  );
  assert.ok(
    breathRmsAfter < breathRmsBefore,
    `breath region should be reduced: before=${breathRmsBefore}, after=${breathRmsAfter}`
  );
});

test('DeEss: reduces sibilant high-frequency energy while preserving low-frequency body', async () => {
  const n = SR; // 1s
  const body = sine(n, 200, 0.3);
  const sibilance = sine(n, 7500, 0.6);
  const data = new Float32Array(n);
  for (let i = 0; i < n; i++) data[i] = body[i] + sibilance[i];

  const module = new DeEss();
  module.setParameter('thresholdDb', -30); // low threshold so our loud sibilance definitely triggers it
  const out = await run(module, makeBuffer([data]));
  const outData = out.getChannelData(0);

  const sibilanceBefore = goertzelMagnitude(data, SR, 7500);
  const sibilanceAfter = goertzelMagnitude(outData, SR, 7500);
  const bodyBefore = goertzelMagnitude(data, SR, 200);
  const bodyAfter = goertzelMagnitude(outData, SR, 200);

  assert.ok(sibilanceAfter < sibilanceBefore * 0.8, `expected sibilance reduced: before=${sibilanceBefore}, after=${sibilanceAfter}`);
  assert.ok(bodyAfter > bodyBefore * 0.8, `expected body frequency preserved: before=${bodyBefore}, after=${bodyAfter}`);
});

test('SpectralRepair: attenuates an injected broadband click in an otherwise steady mix', async () => {
  const n = SR; // 1s
  const data = sine(n, 440, 0.3);
  const clickIdx = Math.floor(n / 2);
  for (let i = clickIdx; i < clickIdx + 10; i++) data[i] += 0.8; // short broadband-ish spike

  const peakBefore = Math.max(...Array.from(data.subarray(clickIdx, clickIdx + 10)).map(Math.abs));
  const out = await run(new SpectralRepair(), makeBuffer([data]));
  const outData = out.getChannelData(0);
  const peakAfter = Math.max(...Array.from(outData.subarray(clickIdx, clickIdx + 10)).map(Math.abs));

  assert.ok(peakAfter < peakBefore, `expected the injected click to be attenuated: before=${peakBefore}, after=${peakAfter}`);
});

test('AzimuthPhase: detects and corrects a known inter-channel delay', async () => {
  const n = 48000;
  const left = sine(n, 300, 0.5);
  // add a second component so autocorrelation doesn't have a purely
  // periodic ambiguity across the search range
  for (let i = 0; i < n; i++) left[i] += 0.2 * Math.sin(i * 0.031);

  const knownLag = 25;
  const right = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const srcIdx = i - knownLag;
    right[i] = srcIdx >= 0 ? left[srcIdx] : 0;
  }

  const module = new AzimuthPhase();
  const out = await run(module, makeBuffer([left, right]));

  assert.equal(module.lastDetectedLag, knownLag, `expected detected lag ${knownLag}, got ${module.lastDetectedLag}`);

  // After correction, zero-lag correlation between the two channels should
  // be much stronger than it was before correction.
  const correctedL = out.getChannelData(0);
  const correctedR = out.getChannelData(1);
  let dot = 0, normA = 0, normB = 0;
  for (let i = 1000; i < n - 1000; i++) {
    dot += correctedL[i] * correctedR[i];
    normA += correctedL[i] * correctedL[i];
    normB += correctedR[i] * correctedR[i];
  }
  const correlation = dot / Math.sqrt(normA * normB);
  assert.ok(correlation > 0.99, `expected near-perfect correlation after correction, got ${correlation}`);
});

test('LoudnessControl: brings the output close to the target LUFS and respects the true-peak ceiling', async () => {
  const n = SR * 3; // 3s — enough for stable gating blocks
  const quiet = [sine(n, 1000, 0.05), sine(n, 1000, 0.05)];

  const module = new LoudnessControl();
  module.setParameter('targetLufs', -14);
  module.setParameter('ceilingDbtp', -1);

  const out = await run(module, makeBuffer(quiet));
  const outputLufs = measureIntegratedLoudnessFromChannels(
    [out.getChannelData(0), out.getChannelData(1)],
    SR
  );

  assert.ok(Math.abs(outputLufs - -14) < 1.5, `expected output near -14 LUFS, got ${outputLufs}`);

  let peak = 0;
  for (let ch = 0; ch < 2; ch++) {
    const data = out.getChannelData(ch);
    for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
  }
  const peakDb = 20 * Math.log10(peak);
  assert.ok(peakDb < -0.9, `expected true peak near or under the -1dBTP ceiling, got ${peakDb}dB`);
});

test('ChainManager: skips bypassed modules and always runs in meta.order regardless of construction order', async () => {
  const dehum = new DeHum();
  const declip = new DeClip();
  // Constructed out of order on purpose (dehum has order=2, declip order=1)
  const chain = new ChainManager('stems', [dehum, declip]);

  assert.equal(chain.modules[0].meta.id, 'declip', 'expected declip (order 1) to run before dehum (order 2)');
  assert.equal(chain.modules[1].meta.id, 'dehum');

  const n = 4800;
  const data = sine(n, 220, 0.9);
  for (let i = 0; i < n; i++) if (data[i] > 0.8) data[i] = 0.98; // clipped plateau for declip to fix

  dehum.setBypass(true);
  const result = await chain.render(
    makeBuffer([data]) as unknown as AudioBuffer,
    MockOfflineAudioContext as unknown as typeof OfflineAudioContext
  );
  const resultData = result.getChannelData(0);

  // declip should still have run (bypass only applies to dehum)
  assert.ok(longestFlatRun(resultData) < longestFlatRun(data) / 2, 'expected declip to still run even with dehum bypassed');
});
