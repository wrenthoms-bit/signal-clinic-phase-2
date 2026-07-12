/**
 * Resamples a buffer to a target sample rate using an OfflineAudioContext
 * — the browser's own resampler runs automatically when a source buffer's
 * sample rate differs from the rendering context's, so this just sets up
 * that mismatch deliberately rather than reimplementing resampling by hand.
 *
 * Needed because the Demucs ONNX export expects 44.1kHz input specifically
 * (per demucs-web's documented interface) — feeding it audio at any other
 * rate would silently produce garbage, not an error.
 */
export async function resampleBuffer(
  input: AudioBuffer,
  targetSampleRate: number,
  ContextCtor: new (n: number, l: number, sr: number) => OfflineAudioContext = OfflineAudioContext
): Promise<AudioBuffer> {
  if (input.sampleRate === targetSampleRate) return input;

  const targetLength = Math.ceil((input.length * targetSampleRate) / input.sampleRate);
  const ctx = new ContextCtor(input.numberOfChannels, targetLength, targetSampleRate);
  const source = ctx.createBufferSource();
  source.buffer = input;
  source.connect(ctx.destination);
  source.start();
  return ctx.startRendering();
}
