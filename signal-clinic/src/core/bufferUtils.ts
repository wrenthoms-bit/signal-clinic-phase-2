/** Shared AudioBuffer helpers. Kept dependency-free — no module reaches into the Web Audio API differently. */

export function cloneBuffer(ctx: BaseAudioContext, source: AudioBuffer): AudioBuffer {
  const out = ctx.createBuffer(source.numberOfChannels, source.length, source.sampleRate);
  for (let ch = 0; ch < source.numberOfChannels; ch++) {
    out.copyToChannel(source.getChannelData(ch).slice(), ch);
  }
  return out;
}

/**
 * Runs a single AudioNode-graph pass (e.g. a biquad chain) through an
 * OfflineAudioContext. Takes the context constructor as a parameter
 * rather than referencing the global `OfflineAudioContext` directly —
 * ChainManager already threads an injectable constructor through
 * everything else (see spec §8's realtime/offline graph split), and
 * hardcoding the global here was the one place that didn't follow suit.
 * It happened to work in a real browser (where the global exists) but
 * made this unreachable from anywhere the global isn't defined —
 * including the Node-based integration tests that caught it.
 */
export async function renderThroughGraph(
  input: AudioBuffer,
  build: (ctx: OfflineAudioContext, source: AudioBufferSourceNode) => AudioNode,
  ContextCtor: new (numberOfChannels: number, length: number, sampleRate: number) => OfflineAudioContext = OfflineAudioContext
): Promise<AudioBuffer> {
  const ctx = new ContextCtor(input.numberOfChannels, input.length, input.sampleRate);
  const source = ctx.createBufferSource();
  source.buffer = input;
  const tail = build(ctx, source);
  tail.connect(ctx.destination);
  source.start();
  return ctx.startRendering();
}

/** In-place per-channel sample transform — for custom DSP with no stock AudioNode equivalent. */
export function mapChannels(
  buffer: AudioBuffer,
  fn: (data: Float32Array, channelIndex: number) => void
): AudioBuffer {
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    fn(buffer.getChannelData(ch), ch);
  }
  return buffer;
}
