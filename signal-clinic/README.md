# Signal Clinic

Pure-DSP implementation of the two-chain repair architecture (Stems + Master)
from `signal-clinic-processing-chain-spec.md`, plus Phase 2's first
ML-backed module. See `docs/phase2-ml-architecture.md` for the model/
runtime decisions behind Phase 2.

## Phase 2 status — read before touching ML-backed modules

**Music Rebalance is real, wired-in code — and it is unverified.** It's
written against `demucs-web`'s documented API (ONNX Runtime Web running
an exported HT-Demucs model), not exercised against the real package or
a real model file — this environment has no network access to install
either. Treat it as reviewed-but-unrun, not tested, until it's actually
run somewhere with network access. It's bypassed by default in
`buildMasterChain()` for exactly this reason, plus the more permanent
one: it's a ~170MB lazy-loaded model, and nobody should download that
without opting in first.

**Scope of what's actually built:** Music Rebalance proves the pipeline
end-to-end — lazy-load the model (cached via the Cache API so it's a
one-time cost), run real 4-stem separation, recombine the stems back
into a stereo mix. What it doesn't yet do: let you select one stem,
route it through an existing Phase 1 repair module, and recombine with
the untouched others — which is the actual reason Music Rebalance exists
per spec §6.1. That's the immediate next step, not built in this pass.

**De-bleed and De-reverb's quality mode are not started.** Both need
their own model research — De-bleed is a different problem shape from
music separation (isolating leakage into a single mic'd stem, not
splitting a finished mix), and dereverberation is a different
architecture entirely from source separation. Nothing transfers from
Music Rebalance's model choice.

**Real architectural finding from this pass:** ONNX Runtime Web's
multi-threaded WASM backend needs `SharedArrayBuffer`, which needs COOP/
COEP response headers, which GitHub Pages cannot set — a genuine,
years-old, unresolved limitation of the platform this project deploys
to. The fix that exists (`coi-serviceworker`, a client-side header-
spoofing shim) was deliberately not adopted; Phase 2 defaults to
single-threaded WASM instead, trading inference speed for not depending
on a fragile hack on a static host with no server fallback if it breaks.
See `docs/phase2-ml-architecture.md` for the full reasoning — this was a
real trade-off, not an oversight.

---

## Phase 1

## Purpose

Two independent, bypassable processing chains:

- **Stems** — De-clip → De-hum → De-click → De-plosive → De-reverb →
  Breath Control → De-ess. Aggressive repair is safe here; nothing else
  in the file can be collaterally damaged.
- **Master** — Spectral Repair → Azimuth/Phase → Loudness Control.
  Surgical only — every module is designed not to touch material that
  isn't the specific problem it targets.

## Architecture

```
src/
  types/module.ts        — ProcessingModule interface + BaseModule (all
                            modules extend this for parameter/bypass bookkeeping)
  core/                  — shared, dependency-free DSP primitives:
    bufferUtils.ts        buffer cloning, OfflineAudioContext render helper
    interpolation.ts       Hermite gap-fill (De-clip, De-click)
    fft.ts                 radix-2 FFT/IFFT (no external dependency)
    stft.ts                STFT/ISTFT, Hann window, overlap-add
    envelope.ts             attack/release envelope follower, windowed RMS
    slidingMedian.ts        incremental sliding-window median (De-click, Spectral Repair)
    loudness.ts             BS.1770 K-weighting + gated integrated LUFS
    correlation.ts          cross-correlation lag detection (Azimuth/Phase)
    wavEncoder.ts           AudioBuffer -> 16-bit PCM WAV Blob
    ChainManager.ts         owns module order + bypass routing (spec §4)
    modelCache.ts           Cache-API model download/cache (Phase 2)
    resample.ts             sample-rate conversion via OfflineAudioContext (Phase 2)
  types/mlModule.ts        — MLBackedModule: lazy-load-then-cache base class for Phase 2 modules
  types/vendor/*.d.ts      — hand-written ambient types for demucs-web/onnxruntime-web
                             (delete once `npm install` pulls in their real types)
  modules/stems/…          7 modules, spec §5
  modules/master/…         3 Phase 1 modules (spec §6) + MusicRebalance (Phase 2, bypassed by default)
  chains/                  assembles each ChainManager instance
  hooks/useAudioEngine.ts  file load, render, playback, export
  components/              rack UI (mode selector, module cards, transport)

tests/
  *.test.ts                 unit tests for src/core/ primitives
  mockWebAudio.ts            minimal AudioBuffer/OfflineAudioContext/
                             BiquadFilterNode mock for running real module
                             code in Node (see Testing, below)
  modules.integration.test.ts integration tests using that mock
```

## Data flow

Phase 1 is entirely an **offline buffer pipeline** — see "Phase 1 scope
decisions" below for why realtime `AudioWorklet` preview was deferred.
`ChainManager.render()` clones the source `AudioBuffer`, then runs it
through each non-bypassed module's `processOffline()` in `meta.order`,
producing a new `AudioBuffer` at each step. Modules that map cleanly onto
stock Web Audio nodes (biquad notches, delay for phase alignment) render
through a disposable `OfflineAudioContext` via `renderThroughGraph()`.
Modules with no stock-node equivalent (interpolation-based repair, STFT
spectral work, envelope-based dynamics, LUFS measurement) operate
directly on the buffer's `Float32Array` channel data.

## Dependencies

React, TypeScript, Vite, Tailwind — per the spec's preferred stack. No
audio-processing libraries: FFT, STFT, interpolation, loudness metering,
and the WAV encoder are all hand-implemented in `core/`, since the spec's
"free of unnecessary dependencies" standard applies especially strongly
to DSP code the app's whole value proposition depends on.

## Phase 1 scope decisions (read before extending)

1. **No realtime `AudioWorklet` preview yet.** The module interface's
   `buildRealtimeNode?` is optional and intentionally unimplemented for
   every Phase 1 module. Building genuine low-latency worklet-based
   preview for ten modules is a separate, substantial scope of work from
   getting the DSP itself correct. Auditioning currently means: adjust
   parameters, hit Render, listen to the result. Fast-follow, not a gap
   that was missed.
2. **Spectral Repair is automated, not a manual paint tool.** The spec's
   intended UX is an interactive spectrogram editor. Phase 1 ships an
   automated outlier-detection mode instead (see the module's own doc
   comment) — a real, working repair, just not the manual editor. The
   detection core should be validated against real problem material
   before investing in the canvas UI on top of it.
3. **True-peak detection is an approximation.** `estimateTruePeakDb()`
   uses 4x linear-interpolation oversampling, not a proper polyphase
   reconstruction filter (ITU-R BS.1770 Annex 2). Close enough to steer
   the limiter, not accurate enough to cite in a mastering report.
4. **De-ess's crossover is a plain biquad LP/HP pair**, not a matched
   Linkwitz-Riley crossover, so there's a small reconstruction ripple
   right at the crossover frequency. Audible only in extreme A/B, not in
   normal use — noted so it isn't mistaken for a bug later.

## Deferred to Phase 2 (ML-dependent — see spec §7)

- **De-bleed** (stems) — needs source separation, not classical DSP.
- **De-reverb quality mode** (stems) — baseline spectral-subtraction mode
  ships now; ML mode is a materially different effort.
- **Music Rebalance** (master) — full stem separation, offline-only,
  render time in minutes not seconds. Spectral Repair already works
  directly on the stereo mix without it (the spec's own documented
  fallback path), so the master chain is functionally complete without
  this branch.

## Testing

Two layers, both runnable with no network access and no browser:

```bash
npm test    # compiles tests/ + src/core/ + src/modules/ to CommonJS, runs node --test
```

**Unit tests** for core DSP primitives (`fft`, `stft`, `interpolation`,
`envelope`, `correlation`, `slidingMedian`, and the pure parts of
`loudness`) — 27 tests, no dependencies beyond Node's built-in test
runner.

**Integration tests** (`tests/modules.integration.test.ts`) run the
*actual* module classes end-to-end — not reimplemented test logic —
against a small Web Audio mock (`tests/mockWebAudio.ts`) that implements
just enough of `AudioBuffer`/`OfflineAudioContext`/`BiquadFilterNode`
(real RBJ-cookbook filter coefficients, not stubs) to execute
`processOffline()` outside a browser. 11 tests: one per Phase 1 module,
plus `ChainManager`'s bypass/ordering behaviour.

38/38 passing — but this exercise is what actually found four real bugs,
not something to read past:

1. **`hermiteFillGap`'s slope estimator had a sign error** (De-clip,
   De-click). Boundary tangents came out negated for a rising signal —
   caught by a sine-wave gap reconstruction test that failed outright
   (0.39 error against a 0.05 tolerance), not a subtle tolerance miss.
   Tangent-span scaling was corrected alongside it.
2. **`windowedRms` never included its window's left edge** — a missing
   pre-fill step meant indices `0..half-1` were never added to the
   running sum at all, permanently, not just at file boundaries. Fed
   De-plosive's burst detector. Fixed with an explicit pre-fill;
   verified against a brute-force reference.
3. **`SpectralRepair` compared frames against already-attenuated
   neighbours** in the same pass (in-place mutation during the scan),
   subtly under-detecting adjacent problem frames. Fixed by snapshotting
   original magnitudes per bin before scanning.
4. **`AzimuthPhase` shifted the delayed channel in the wrong direction**
   — it doubled the delay instead of cancelling it. Caught by the
   integration test: detection (`findBestLag`) correctly found the known
   synthetic delay, but applying the correction made post-correction
   correlation *worse* (-0.33 instead of >0.99). One sign flip
   (`i - lag` → `i + lag`) fixed it.

Bug 4 specifically is the kind of thing pure unit tests on `correlation.ts`
couldn't have caught — that module's own tests all passed the whole time,
because the bug was in how `AzimuthPhase` *used* the correctly-detected
lag, not in the lag detection itself. That's the actual case for
integration tests over unit tests: correct parts, wired together wrong.

There's also a real architecture fix underneath one of the integration
failures: `renderThroughGraph` (used by De-hum, De-plosive, De-ess)
hardcoded a reference to the global `OfflineAudioContext` instead of
taking an injectable constructor, unlike `ChainManager`, which already
threads one through. It worked by accident in a browser (the global
exists there) but was unreachable from anywhere else — including these
tests, until fixed to derive the constructor from whatever `ctx` its
caller was actually given.

What's still *not* covered: no real browser has run any of this. The
mock's biquad filters use the same coefficient formulas as the real
`BiquadFilterNode`, but Safari-specific Web Audio quirks, real click/pop
material, and actual perceptual audio quality are all things a mock
can't stand in for. That's the next real checkpoint.

## Known limitations

- `SpectralRepair` and `DeClick` used to re-slice-and-sort a fresh window
  at every position — replaced with `SlidingWindowMedian`, an incrementally
  maintained sorted window. Measured speedup on a realistic De-click-sized
  workload (500k samples, 220-sample window): **20.2s → 0.1s (≈195×)**.
  This also fixed a smaller correctness issue in `SpectralRepair`: the old
  version compared a frame's magnitude against neighbours that could
  already have been attenuated earlier in the same pass (in-place mutation
  during the scan), subtly under-detecting adjacent problem frames. It now
  snapshots each bin's original magnitudes before scanning.
- Single-channel `DeReverb` has a hard quality ceiling regardless of
  algorithm — this is physics (see spec §5.4), not something to keep
  trying to engineer around in DSP-only mode.
- Not yet tested across browsers. Safari's Web Audio implementation has
  known quirks; validate there before considering Phase 1 "done," not
  just in Chrome.
- Not yet tested against real audio material — the mock validates that
  each module does something directionally correct on synthetic signals
  (sines, injected impulses, synthetic hum/bleed/bursts). Real stems and
  masters will surface parameter-tuning issues (thresholds, ratios,
  window sizes) that no synthetic signal substitutes for.

## Running this locally

This sandbox has no network access, so `npm install` couldn't be run or
verified here — the full dependency graph in `package.json` needs to be
fetched on your machine.

```bash
npm install
npm run dev      # local dev server
npm run build    # production build to dist/, deployable to GitHub Pages
npm test         # runs the core DSP unit tests (see Testing, above)
```

`tsconfig.strictcheck.json` type-checks every non-React source file
(`core/`, `types/`, `modules/`, `chains/`) under the app's real strict
settings without needing `node_modules` at all — useful for a fast
sanity check before a full install:

```bash
npx tsc -p tsconfig.strictcheck.json
```
