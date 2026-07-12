# Signal Clinic — Processing Chain Module Specification

**Status:** Draft v1
**Scope:** Redesign of the repair chain into two distinct signal paths — Stems and Master — replacing the prior single generic chain and the old Step 3 (intelligent loudness) placement.

---

## 1. Purpose

Define the module boundaries, signal flow, interfaces, and bypass contract for the audio repair/correction chain, split by processing context:

- **Stems chain** — individual tracks, isolated instruments/vocals. Aggressive repair is safe because nothing else in the file can be collaterally damaged.
- **Master chain** — finished stereo mixes. Every operation must be surgical; broadband repair applied blindly risks damaging elements that were never broken.

These are architecturally separate signal paths, not two presets of one chain. The application must expose a mode selector that determines which chain is active; modules are not shared between them even where the underlying algorithm is similar (e.g. de-click logic differs materially in how conservatively it should trigger on a full mix vs. an isolated stem).

---

## 2. Architecture Overview

```
                    ┌─────────────────┐
   Audio In ──────▶ │  Mode Selector   │
                    └────────┬─────────┘
                             │
              ┌──────────────┴──────────────┐
              ▼                             ▼
     ┌────────────────┐           ┌────────────────────┐
     │  STEMS CHAIN    │           │   MASTER CHAIN      │
     │  (5 modules)    │           │   (4 modules,        │
     │  serial, all    │           │   1 optional branch) │
     │  real-time      │           │   mixed real-time/   │
     │  where possible │           │   offline-only       │
     └────────────────┘           └────────────────────┘
              │                             │
              └──────────────┬──────────────┘
                             ▼
                      Audio Out / Export
```

Each module is an independent, bypassable unit with a defined input/output contract. Modules do not reach into each other's state. The chain manager is responsible for sequencing, routing around bypassed modules, and switching between real-time preview graph and offline render graph.

---

## 3. Module Interface Contract

All modules — DSP and ML-backed alike — implement a common interface so the chain manager can treat them uniformly regardless of what's happening internally.

```typescript
type ChainType = 'stems' | 'master';
type ProcessingMode = 'realtime' | 'offline-only';

interface ModuleParameter {
  id: string;
  label: string;
  min: number;
  max: number;
  default: number;
  unit?: string;          // 'dB', 'Hz', 'ms', 'LUFS', etc.
  step?: number;
}

interface ModuleMeta {
  id: string;                    // stable, e.g. 'declip'
  displayName: string;
  chain: ChainType;
  order: number;                 // position in signal flow
  requiresML: boolean;
  processingMode: ProcessingMode;
  introducesLatency: boolean;    // true if module needs lookahead/buffering
  parameters: ModuleParameter[];
}

interface ProcessingModule {
  meta: ModuleMeta;
  bypassed: boolean;

  // Real-time path: returns a connectable AudioNode (or node chain)
  buildRealtimeNode?(context: AudioContext): AudioNode;

  // Offline path: consumes and returns full buffers (required for ML modules,
  // optional for DSP modules that can also run in the realtime graph)
  processOffline(input: AudioBuffer, context: OfflineAudioContext): Promise<AudioBuffer>;

  setParameter(id: string, value: number): void;
  setBypass(state: boolean): void;
  getLatencySamples(): number;
}
```

**Why this split exists:** DSP modules (de-clip, de-hum, de-click, phase, loudness metering) can generally run as live `AudioNode` graphs for real-time preview. ML-backed modules (de-bleed, de-reverb quality mode, Music Rebalance) cannot run in the audio thread — they require full-buffer inference and are offline-only. Forcing both categories through a single "node graph" abstraction would either cripple the ML modules or fake real-time preview that doesn't reflect the real output. The interface makes this distinction explicit rather than papering over it.

---

## 4. Bypass Contract

Bypass is not a parameter — it's a routing decision, and the correct implementation differs by module type:

| Module type | Bypass behavior |
|---|---|
| Pure LTI filters (notch, EQ, phase rotation) | True node disconnect/reconnect via `AudioNode.disconnect()` + dry passthrough connection. Never simulate bypass by zeroing gain — a de-esser at 0 dB reduction is not the same signal path as a de-esser removed, and can still introduce phase/latency artifacts from its internal filtering. |
| Dynamics-based modules (de-click, de-plosive, breath control) | Same — full disconnect. These modules use sidechain detection even at "0 effect," which still costs CPU and can smear transients marginally. |
| ML-backed modules (de-bleed, de-reverb ML mode, Music Rebalance) | Bypass must skip inference entirely, not run-then-discard. Inference is the expensive part; bypassing must be checked *before* the module is invoked by the chain manager, not inside the module after computation. |
| Offline-only modules in a realtime preview graph | Bypass state is honored at render time. During real-time preview, these modules are always effectively "monitored bypassed" (dry signal passes through) with a UI indicator that says "will apply on render," since there's no live equivalent to preview. |

The chain manager, not the individual module, owns the "is this module actually in the graph right now" decision — modules only report their own bypass flag; routing is centralized so signal-flow order stays deterministic when modules are toggled.

---

## 5. Stems Chain (5 modules)

```
[1. De-clip] → [2. De-hum / De-bleed] → [3. De-click / De-plosive] → [4. De-reverb] → [5. Voice Cleaners]
```

### 5.1 De-clip
- **Purpose:** Rebuild squared-off waveforms from a signal that hit 0 dBFS during recording.
- **Why first:** Every downstream detector (click detection, hum detection, spectral analysis) is confused by clipped, flat-topped waveforms. Repairing shape before anything else touches the signal prevents false positives further down the chain.
- **Approach:** Detect flat-top regions (consecutive samples at or near full-scale, above a minimum run-length threshold) → reconstruct via autoregressive (AR) or cubic-spline interpolation across the damaged region using the surrounding waveform as a predictive model.
- **ML required:** No.
- **Processing mode:** Offline preferred (needs to see the region around each clip event, small lookahead), can be adapted to realtime with a short lookahead buffer.
- **Parameters:** Detection threshold (dBFS), minimum run-length (samples), interpolation window (ms).
- **Known limitation:** Severe, sustained clipping (long runs) degrades gracefully but cannot fully recover missing high-frequency content — physically unrecoverable information, not an algorithm shortfall.

### 5.2 De-hum / De-bleed
- **Purpose:** Remove stationary electrical noise (amp buzz, ground hum) and remove leakage from other sources (click track bleed into vocal mic, drum spill into an acoustic guitar mic).
- **Why here:** Stationary noise sits in the noise floor and throws false positives at transient-based click detectors if left in place — must be cleared before Step 3.
- **De-hum approach:** Adaptive narrow notch filter bank at the fundamental (50 Hz or 60 Hz depending on region) plus harmonics, with frequency tracking via periodic FFT peak re-detection to compensate for generator/ground drift.
- **De-hum ML required:** No — pure DSP.
- **De-bleed approach:** This is a source-separation problem — isolating one source's leaked energy from another's dominant signal in the same recording. Classical spectral-subtraction gives mediocre results here.
- **De-bleed ML required:** **Yes.** Flagged for Phase 2 — see §7.
- **Parameters (de-hum):** Fundamental frequency (Hz, auto-detect or manual), harmonic count, notch Q.
- **Known limitation:** De-bleed quality is bounded by how correlated the bleed source is with program material; heavy bleed with high spectral overlap (e.g. drum bleed into a vocal mic in the same frequency range as the vocal) will always be a soft, not hard, removal.

### 5.3 De-click / De-plosive
- **Purpose:** Remove short transient artifacts — saliva ticks, fret noise, plosive "P" pops.
- **Why here:** Runs after stationary noise is cleared (Step 2) so transient detection isn't tripped by hum-related energy, but before de-reverb (Step 4) so reverb tail isn't mistaken for click energy.
- **De-click approach:** Statistical outlier detection over a short sliding window (energy/derivative threshold) → AR-model interpolation across the identified click region. Mouth De-click mode narrows detection to the vocal-specific frequency/duration profile of saliva ticks; standard mode is tuned for broader transient noise (e.g. bass fret noise).
- **De-plosive approach:** Low-frequency transient burst detector (energy concentrated below ~120 Hz, short duration, rapid attack) → dynamic high-pass or targeted gain reduction applied only during the detected plosive window, not a static HPF across the whole file.
- **ML required:** No.
- **Parameters:** Sensitivity threshold, detection window (ms), plosive frequency ceiling (Hz), interpolation vs. attenuation mode.
- **Known limitation:** Very dense, closely-spaced clicks (e.g. vinyl crackle-density noise) can produce audible interpolation artifacts; this module is tuned for sparse discrete events, not continuous noise floors.

### 5.4 De-reverb
- **Purpose:** Strip room reflections from a source recorded in an untreated space.
- **Why here:** Reshapes the whole spectral envelope of the stem — must happen before Voice Cleaners (Step 5) so breath/de-ess thresholds are tuned against the *dry* signal, not against a signal whose reverb tail is about to disappear out from under it.
- **Approach — Phase 1 (DSP only):** Spectral subtraction based on an estimated late-reverberant energy model (statistical decay estimate per frequency band). Works reasonably on light-to-moderate room reflections; single-channel de-reverb has a hard ceiling on quality.
- **Approach — Phase 2 (quality mode):** ML-based dereverberation model for materially better separation on heavier room tails.
- **ML required:** No for baseline mode; yes for quality mode (Phase 2).
- **Processing mode:** Offline for both modes (needs analysis window ahead of the current sample).
- **Parameters:** Reduction amount (dB), estimated room decay time (auto or manual RT60 estimate).
- **Known limitation:** Single-channel blind dereverberation is fundamentally limited — this is physics, not implementation quality. Multichannel algorithms (e.g. weighted prediction error) exist but don't apply to typical single-mic-per-stem input.

### 5.5 Voice Cleaners (vocal stems only)
- **Purpose:** Final polish stage — tame breath noise, soften harsh sibilance.
- **Why last:** These are the most audibly sensitive, subtle operations in the chain; running them after every other repair means their detectors aren't fighting hum, clicks, or reverb tail that's since been removed.
- **Breath Control approach:** Envelope follower + broadband low-energy transient detection at natural phrase-boundary points → gentle automated gain reduction (a "breath rider"), not a gate — gating breath produces audible pumping.
- **De-ess approach:** Split-band dynamics targeting the 4–9 kHz sibilance region, frequency-dependent compression rather than static EQ cut (a static cut removes sibilance *and* legitimate high-frequency detail everywhere, not just on esses).
- **ML required:** No.
- **Parameters:** Breath reduction amount (dB), de-ess frequency center (Hz), de-ess range (Hz), de-ess threshold (dB).
- **Chain visibility:** This module should be conditionally shown/hidden based on stem type (vocal vs. instrumental) rather than always present with irrelevant controls exposed — consistent with the "expose advanced controls only when necessary" UX principle.

---

## 6. Master Chain (4 modules, 1 optional branch)

```
[1. Music Rebalance (optional)] → [2. Spectral Repair] → [3. Azimuth / Phase Control] → [4. Loudness Control]
```

### 6.1 Music Rebalance — optional branch, not mandatory-serial
- **Purpose:** Split the stereo master into sub-stems (vocals, drums, bass, other) so subsequent repair steps can target only the problem layer.
- **Design decision — deviation from a strictly serial chain:** Full stem separation is expensive and often unnecessary for a single localized problem (one cough, one digital pop). This module is architected as a **branch**, not a mandatory first step: Spectral Repair (6.2) can act directly on the stereo mix, or on rebalanced sub-stems if the user opts in. Bypass on this module means "skip separation entirely and feed the stereo mix straight to Spectral Repair" — not "separate, then discard and recombine."
- **Approach:** ML-based source separation (Demucs-class or similar architecture), inference via ONNX Runtime Web or TF.js, WASM/WebGL backend.
- **ML required:** **Yes.** Flagged for Phase 2 — see §7.
- **Processing mode:** Offline-only. Realistic runtime is measured in minutes for a full song, not real-time.
- **Parameters:** Stem count/targets (vocals/drums/bass/other), separation quality preset (speed vs. fidelity tradeoff if the model supports it).
- **Known limitation:** Separation artifacts ("bleed-through," phasey textures) are inherent to current source-separation model quality; this is a model-selection problem to revisit as better lightweight models become available for in-browser inference.

### 6.2 Spectral Repair
- **Purpose:** Manually target and remove a specific broadband error (a cough, a digital pop, a click) without touching surrounding material — the "laser eraser."
- **Why here:** Needs to run after any optional rebalance (so it can act on an isolated layer if the user chose to split) but before phase/loudness, since those later stages should operate on the final corrected spectral content.
- **Approach:** STFT-based spectrogram editor — user visually selects a time/frequency region; Gain tool attenuates the selection, Replace tool interpolates content from surrounding time-frequency bins. Reconstruction via inverse STFT with overlap-add windowing to avoid the seams/artifacts that a naive per-frame edit would introduce.
- **ML required:** No — this is classical STFT manipulation with a manual visual interface, not automated repair.
- **Processing mode:** Offline (requires the full spectrogram to be computed and rendered for the user to select regions in).
- **Parameters:** FFT size / window (tradeoff between time and frequency resolution — needs to be exposed since a user painting out a narrowband issue wants different resolution than one painting out a broadband transient), overlap factor, Gain vs. Replace mode.
- **Known limitation:** This is the one module in the chain that's inherently manual rather than automated — by design, since automated broadband repair on a full mix is exactly the failure mode this whole chain split exists to avoid.

### 6.3 Azimuth / Phase Control
- **Purpose:** Realign left/right channels when a stereo file feels lopsided or has phase cancellation issues (common in tape transfers/archival material).
- **Why here:** Must run before Loudness Control (6.4) — out-of-phase content nulls in mono and skews LUFS measurement, so measuring loudness before correcting phase means measuring a distorted signal.
- **Approach:** Cross-correlation analysis between channels to detect timing/phase offset → manual or automatic all-pass phase rotation and/or sub-sample delay alignment. Correlation meter exposed in the UI as a real-time visual reference.
- **ML required:** No.
- **Processing mode:** Real-time capable (correlation analysis and all-pass rotation are both lightweight).
- **Parameters:** Delay offset (samples, L/R independent), phase rotation (degrees), auto-detect toggle.
- **Known limitation:** Auto-detect works well for consistent, file-wide offset (tape transfer skew); it is not designed for time-varying phase issues within a single file.

### 6.4 Loudness Control
- **Purpose:** Set final integrated loudness to match streaming platform targets so the platform doesn't apply its own turn-down.
- **Why last, always:** Any upstream repair changes the crest factor and dynamic content the loudness measurement depends on — measuring before repair produces a target that's invalidated by the very next step.
- **Approach:** ITU-R BS.1770-4 loudness measurement (integrated, short-term, momentary LUFS) plus true-peak limiting to prevent inter-sample overs on lossy encode.
- **Threshold/ceiling justification (per DSP standards, this needs to be stated, not just implemented):**
  - Target integrated loudness should be **selectable per platform preset** (e.g. commonly cited references: Spotify ≈ −14 LUFS, Apple Music ≈ −16 LUFS, YouTube ≈ −14 LUFS) rather than hardcoded, since these targets shift over time and the app shouldn't need a code change to stay current.
  - True-peak ceiling should default conservatively (e.g. −1 dBTP) rather than pushing to 0 dBTP, to leave margin against inter-sample peaks introduced by lossy codec encoding downstream — consistent with the "transparency over loudness" philosophy in the audio engineering brief. This should not be a marketing-driven "hit the loudest allowable number" default.
  - Limiter release behavior should be program-dependent/adaptive rather than a single fixed release time, since a fixed fast release on sustained low-end content produces audible pumping, and a fixed slow release on transient-heavy content fails to recover gain reduction between hits.
- **ML required:** No.
- **Processing mode:** Real-time capable for metering/preview; final limiting pass typically rendered offline for the export file.
- **Parameters:** Target integrated LUFS (platform preset or manual), true-peak ceiling (dBTP), limiter release character (auto / manual ms).
- **Known limitation:** This module deliberately does not offer a "maximize loudness" mode — that would contradict the stated mastering philosophy. If aggressive loudness is ever requested as a feature, it should be a clearly separate, explicitly-labeled mode, not a slider extreme on this one.

---

## 7. Phased Build Plan

Not every module is the same class of engineering problem, and the build order should reflect that rather than following list order blindly.

**Phase 1 — Pure DSP, buildable now, no ML dependency:**
De-clip, De-hum, De-click, De-plosive, De-reverb (baseline mode), Breath Control, De-ess, Spectral Repair, Azimuth/Phase Control, Loudness Control. This covers the entire stems chain except de-bleed, and the entire master chain except Music Rebalance and de-reverb's quality mode.

**Phase 2 — ML-dependent, separate scope:**
De-bleed, De-reverb (quality mode), Music Rebalance. These require model selection (a lightweight source-separation architecture viable for in-browser inference), an inference runtime (ONNX Runtime Web or TF.js), and realistic UX expectations around render time (offline, not draggable-slider real-time). This phase should be scoped and estimated separately once Phase 1 is stable — bundling them into the same timeline as the DSP modules would misrepresent the actual effort involved.

---

## 8. Data Flow & Processing Modes

Two graph types coexist:

- **Realtime preview graph** (`AudioContext` + `AudioWorkletNode` chain): used for live parameter auditioning on modules capable of it. Offline-only modules pass through dry in this graph with a UI indicator that the effect isn't reflected in the live preview.
- **Offline render graph** (`OfflineAudioContext` for DSP modules, direct buffer-in/buffer-out for ML modules): used for final export. This is the graph that runs every module, bypassed or not honored per §4, in the order defined by `ModuleMeta.order`.

The chain manager is the single source of truth for module order and bypass state; individual modules never reference each other or reorder themselves.

---

## 9. Dependencies

- Web Audio API, AudioWorklet (Phase 1)
- WASM-compiled DSP where AudioWorklet's JS performance isn't sufficient for AR-interpolation-heavy modules (de-clip, de-click) — to be confirmed via profiling once Phase 1 is implemented, not assumed upfront
- ONNX Runtime Web or TF.js (Phase 2 only)
- No backend/server dependency — all processing is client-side, consistent with the existing GitHub Pages deployment model

---

## 10. Known Limitations & Assumptions (explicit)

- Assumes this extends the existing Signal Clinic repair chain rather than introducing a parallel app — flagged for confirmation.
- Single-channel de-reverb has a hard quality ceiling regardless of algorithm (§5.4) — this is physics, not a gap to be engineered around in Phase 1.
- ML module runtime performance in-browser (model size, inference time, memory footprint) is unvalidated until a specific model is selected in Phase 2 scoping.
- Safari's Web Audio / AudioWorklet implementation has known quirks (worklet loading behavior, occasional clock drift) that need dedicated browser-compatibility testing before Phase 1 is considered done, not assumed to "just work" from Chrome testing.

---

## 11. Open Questions

1. Mode selector UX — tab/toggle at the top of the app, or a project-creation-time choice (stems project vs. master project)?
2. Should Phase 2 ML models be bundled at install time (larger initial PWA download) or lazy-loaded on first use of a Phase 2 module?
3. Target latency budget for the real-time preview graph — is there a hard ceiling (e.g. <20ms) or is "reasonably responsive" acceptable given several modules are offline-only regardless?
4. Does Spectral Repair need a full custom visual paint editor built from scratch, or is there value in scoping a simpler threshold-based auto-declick-for-masters as a Phase 1 stopgap before the full manual editor is built?
