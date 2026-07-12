/**
 * Attack/release envelope follower shared by every dynamics-based module
 * (De-plosive, Breath Control, De-ess, Loudness Control's limiter).
 * One implementation means attack/release behaviour is consistent across
 * the whole chain rather than each module having a slightly different feel.
 */
export function followEnvelope(
  data: Float32Array,
  sampleRate: number,
  attackMs: number,
  releaseMs: number,
  mode: 'peak' | 'rms' = 'peak'
): Float32Array {
  const out = new Float32Array(data.length);
  const attackCoef = Math.exp(-1 / ((attackMs / 1000) * sampleRate));
  const releaseCoef = Math.exp(-1 / ((releaseMs / 1000) * sampleRate));

  let env = 0;
  for (let i = 0; i < data.length; i++) {
    const rectified = mode === 'peak' ? Math.abs(data[i]) : data[i] * data[i];
    const coef = rectified > env ? attackCoef : releaseCoef;
    env = coef * env + (1 - coef) * rectified;
    out[i] = mode === 'rms' ? Math.sqrt(env) : env;
  }
  return out;
}

/**
 * Short sliding-window RMS — used for burst/transient detection (de-plosive, breath).
 *
 * Centered window of `windowSamples` width. The running sum is pre-filled
 * for the first output position before the main loop starts; without that
 * pre-fill, a naive enter/leave step (enter = i+half, leave = i-half-1)
 * never actually visits indices 0..half-1 at all — not an edge rounding
 * error, a permanent omission that shifts the whole window and produces
 * systematically wrong (too-low) energy estimates. Verified against a
 * brute-force reference in tests/envelope.test.ts.
 */
export function windowedRms(data: Float32Array, windowSamples: number): Float32Array {
  const out = new Float32Array(data.length);
  const half = Math.floor(windowSamples / 2);
  let sumSq = 0;
  let count = 0;

  for (let j = 0; j <= half && j < data.length; j++) {
    sumSq += data[j] * data[j];
    count++;
  }

  for (let i = 0; i < data.length; i++) {
    out[i] = Math.sqrt(Math.max(0, sumSq) / Math.max(1, count));

    const enter = i + 1 + half;
    if (enter < data.length) {
      sumSq += data[enter] * data[enter];
      count++;
    }
    const leave = i - half;
    if (leave >= 0) {
      sumSq -= data[leave] * data[leave];
      count--;
    }
  }
  return out;
}

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

export function gainToDb(gain: number): number {
  return 20 * Math.log10(Math.max(1e-8, gain));
}
