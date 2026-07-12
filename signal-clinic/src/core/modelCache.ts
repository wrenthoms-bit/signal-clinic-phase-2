/**
 * Downloads and caches ML model weights for Phase 2 modules. Models are
 * lazy-loaded on first use (spec decision — see docs/phase2-ml-architecture.md
 * "Loading strategy") rather than bundled, since a ~170MB asset has no
 * business being part of the initial page load for people who never touch
 * an ML-backed module.
 */

const MODEL_CACHE_NAME = 'signal-clinic-models-v1';

export interface DownloadProgress {
  loaded: number;
  total: number;
}

/**
 * Fetches a model, serving from the Cache API on repeat visits. Falls
 * back to an uncached fetch if the Cache API is unavailable (e.g. some
 * private-browsing modes) or if writing to the cache fails (e.g. quota)
 * — a slower repeat download is preferable to failing the whole load.
 */
export async function fetchModelWithCache(
  url: string,
  onProgress?: (progress: DownloadProgress) => void
): Promise<ArrayBuffer> {
  if ('caches' in window) {
    try {
      const cache = await caches.open(MODEL_CACHE_NAME);
      const cached = await cache.match(url);
      if (cached) return cached.arrayBuffer();
    } catch {
      // Fall through to an uncached fetch.
    }
  }

  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to fetch model (${response.status} ${response.statusText}): ${url}`);
  }

  const total = Number(response.headers.get('content-length') ?? 0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress?.({ loaded, total });
  }

  const combined = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  if ('caches' in window) {
    try {
      const cache = await caches.open(MODEL_CACHE_NAME);
      await cache.put(
        url,
        new Response(combined.slice().buffer, { headers: { 'Content-Type': 'application/octet-stream' } })
      );
    } catch (e) {
      console.warn('Model caching failed (continuing without cache):', e);
    }
  }

  return combined.buffer;
}

/** Clears all cached model weights — useful for a "free up storage" UI action. */
export async function clearModelCache(): Promise<void> {
  if ('caches' in window) {
    await caches.delete(MODEL_CACHE_NAME);
  }
}
