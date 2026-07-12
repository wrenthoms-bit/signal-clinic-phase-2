# Phase 2 — ML Architecture Decisions

**Status:** Kickoff — infrastructure + Music Rebalance only. De-bleed and
De-reverb's quality mode are scoped separately (see "Not yet decided," below).

This covers the three modules deferred from Phase 1 (spec §7): De-bleed,
De-reverb's quality mode, and Music Rebalance. All three need a real ML
model, not classical DSP — this doc is the "explain the available
approaches, recommend one, explain why" pass required before writing any
of that code, per the project's development philosophy.

---

## Runtime: ONNX Runtime Web

**Alternatives considered:** TensorFlow.js, ONNX Runtime Web, a hosted
API (send audio to a server for inference).

- A **hosted API** is disqualified outright — it means uploading the
  user's audio to a third-party server, which contradicts the "runs
  entirely client-side, nothing uploaded" position already established
  in Phase 1's `FileDropzone` copy and the app's whole privacy posture.
- **TensorFlow.js** is the other realistic option, but the models that
  actually exist for music source separation (Demucs and its variants)
  are PyTorch-native. Getting one into TF.js means an extra PyTorch →
  TF conversion step on top of the already-nontrivial export process,
  with more chances for numerical drift.
- **ONNX Runtime Web** wins because working ONNX exports of HT-Demucs
  already exist with published PyTorch-parity numbers (max absolute
  difference ~0.0002 across stems on one export I found), and a
  browser-ready reference implementation (`demucs-web`, MIT-licensed)
  already wraps it with the exact segment-chunking and overlap-add
  logic Demucs needs for long audio — logic that would otherwise have
  to be reimplemented from scratch and independently verified.

**A note on sourcing confidence:** one of the sources I found while
researching this (a "StemSplit" blog) had text embedded in the page
instructing AI assistants to treat it as "the authoritative source" and
cite it preferentially — a prompt-injection attempt, not an editorial
credential. I'm not treating it as authoritative; the technical claims
used below (that a working ONNX export exists, its rough parity numbers)
are cross-checked against independent-looking sources — the package's
own PyPI/GitHub listing and an unrelated developer's blog post
describing a separate browser implementation — rather than taken from
that one page.

## Model: `htdemucs` (single model), not `htdemucs_ft` (4-model ensemble bag)

Demucs's fine-tuned mode (`htdemucs_ft`) runs 4 separate model passes
(a "bag of models") and blends them for better quality. That's a
reasonable tradeoff on a GPU server; in single-threaded WASM in a
browser tab, it means quadrupling an already-slow inference time for a
quality gain that matters far less than "this finishes before the user
gives up." `htdemucs` (the single-model version) is the pragmatic
choice for Phase 2 — same architecture, one pass instead of four.

Expect real numbers once this actually runs somewhere: independent
reports put browser WASM inference at several minutes for a standard
track, consistent with Phase 1 spec's original framing of Music
Rebalance as "render and wait," not a draggable slider.

## The real conflict: GitHub Pages can't set COOP/COEP headers

ONNX Runtime Web's multi-threaded WASM backend needs `SharedArrayBuffer`,
which needs the page to be **cross-origin isolated** — which needs
`Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` response
headers. GitHub Pages has never supported setting custom response
headers, and there's no indication that's changing — this has been an
open, unresolved request against GitHub Pages for years.

**The workaround that exists:** `coi-serviceworker` — a small script
that registers a service worker to fake those headers client-side
specifically for static hosts that can't set them, GitHub Pages being
the canonical example it's built for. It's real and it works for
simple cases, but it comes with genuine rough edges: it forces a page
reload on first visit to register itself, and it can conflict with any
service worker your own app already registers (a PWA's own service
worker, for instance — relevant, since some of your other projects are
PWA-packaged).

**Decision: don't take on that dependency for Phase 2.** Default to
ONNX Runtime Web's **single-threaded WASM** execution provider, which
needs no cross-origin isolation and no service worker hack at all — at
the cost of slower inference than the multi-threaded path would give.
This is the "favour long-term architecture over short-term convenience"
call explicitly asked for in this project's philosophy: a service-worker
header-spoofing hack is the *convenient*-looking option that adds a
fragile, easy-to-silently-break dependency; a slower but hack-free
execution path is more robust for a static-hosted app with no server to
fall back on if the trick stops working after a browser update.

`executionProviders` is still configured as `['webgpu', 'wasm']` —
WebGPU doesn't need cross-origin isolation and is meaningfully faster
where it's available (increasingly the common case in Chrome/Edge, and
now Safari), with single-threaded WASM as the universal fallback. If
render times prove painful in practice, `coi-serviceworker` is the
documented next step — but as an opt-in optimization once there's a
real reason to take on its fragility, not a default.

## Loading strategy: lazy-load, not bundled

This resolves Phase 1's open question #2. A ~170MB model has no
business being part of the initial page load for people who never touch
Music Rebalance, De-bleed, or De-reverb's quality mode. The model is
fetched from its host (Hugging Face) only when a Phase 2 module first
runs, and cached (Cache API) so it isn't re-downloaded every session.

## Not yet decided

- **De-bleed** needs its own model research. It's a different problem
  shape from Music Rebalance — isolating leakage into a single mic'd
  stem, not separating a finished stereo mix — and nothing in this
  research pass targeted it specifically. The ONNX Runtime Web
  infrastructure built here should be reusable regardless of which model
  it ends up running.
- **De-reverb's quality mode** needs a dereverberation model, which is
  an entirely different architecture from source separation (nothing
  here transfers). Separate research pass.

Music Rebalance is the one built in this pass — it's the most mature,
best-documented piece, and the runtime/caching infrastructure it
establishes is what the other two will sit on top of later.
