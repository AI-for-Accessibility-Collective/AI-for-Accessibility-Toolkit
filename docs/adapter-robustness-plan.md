# Adapter Robustness Plan — demand × differentiation × code reality

> **Status (2026-07-12): implemented** on branch `adapter-robustness` — waves
> W1–W4 plus a 26-finding adversarial review fix pass (W5). Captions
> increment 2 (on-device Whisper/tabCapture) remains gated/deferred as
> planned. Gate at completion: 359 static / 638 unit / 194 e2e checks, all
> green.

**Inputs.** (1) The user-needs demand table (ability-type counts + rejections per
adapter, 2026-07); (2) [`adapter-overlap.md`](adapter-overlap.md) (what already
exists elsewhere); (3) [`observable-settings.md`](observable-settings.md) (the
five auto-respectable OS signals); (4) a 12-agent grounding pass (2026-07-12)
that re-read every live implementation in
`personalized-extension/skills/builtin/` + shared infra, and vetted every
candidate external package against current (mid-2026) versions, licenses, and
MV3 constraints.

**Headline finding.** The top of the demand table is largely *non-functional
today*, not merely fragile:

- **`fix-contrast` (demand 5/0) is dead code.** Its registry entry maps to
  `{autoWcagFix:true}` (registry.js:117), which enables `WcagFixes`; the
  `FixContrast` module is imported (content.js:10) but in no dispatch map. The
  "Fix Contrast" tile silently runs the structural sweep instead.
- **Both caption adapters (demand 5/0 each) ship zero captions.**
  `GenerateCaptions` is wired but its provider methods
  (`transcribeVideo/transcribeAudio/getYouTubeTranscript`) hard-return `null`
  (utils/ai.js:153-163) — a total no-op with a permanent per-element failure
  latch. `AutoCaptions` (the only builtin with a MutationObserver) is
  *unreachable*: same `{autoCaptions}` settings key, absent from both dispatch
  maps.
- **The audit trail is dead.** All 8 adapters' `logFix`/`incrementStat` read
  `globalThis.ai4a11yLogFix`/`ai4a11yIncrementStat`, which only the *legacy*
  extension assigns. The popup's fixes panel (popup.js:1511-1540) permanently
  shows zero; `reportFix` (content.js:50-58) has no callers.
- **AI sweeps default ON without a key.** `autoWcagFix/autoFixLabels/autoDescribe`
  are `!== false` defaults (content.js:221-223): fresh installs fire per-element
  cloud calls (or per-element failures) on every page.
- **axe pipeline is aspirational here.** Five builtins export `axeHandlers`;
  nothing in the personalized extension bundles axe-core or dispatches to them
  (the working pattern lives only in the legacy stack:
  `/extension/src/content.js:178-227` + `tools/adapters/index.js:37`).
- **`tools/adapters/` vs `skills/builtin/` are diverged forks** (13 pairs, all
  differ) — and in two places the *legacy* fork is better (Readability-based
  reader-mode; DOM-preserving simplify-text toggle). `skills/builtin/` is the
  live layer; all work below lands there.

So "make these integrations robust and actually usable" means, in order:
**(0) fix the wiring so demand-tier adapters run at all → (1) rebuild the
high-demand tier on vetted engines → (2) fix the rejection causes in the
contested tier → (3) freeze/retire the no-demand tier (with one safety fix).**

---

## Priority tiers (demand × rejections × current state)

| Tier | Adapters | Demand | Verdict |
|---|---|---|---|
| **1 — invest** | reader-mode, visual-assist, fix-contrast, captions (merged), motion-reducer | 6/0, 6/0, 5/0, 5+5/0, 4/0 | Rebuild on vetted packages; close correctness gaps |
| **2 — fix rejection causes** | voice-commands (4/**1**), auto-alt-text (4/**3**), keyboard-nav (3/**3**), wcag-fixes (3/1), simplify-text (3/0), generate-labels (2/0) | mixed | Rejections map precisely to identified harms — fix those, not features |
| **3 — freeze/retire** | read-aloud (2/**3**), large-cursor (2/**2**), dark-mode (0/**2**), focus-mode, dyslexia-font, color-filter (0/0) | none | Delegate to native/OS; one mandatory safety fix (color-filter) |

---

## Vetted package decisions (all verified mid-2026: version, license, size, MV3)

| Package | Version | License | Bundled cost | Use for | Verdict |
|---|---|---|---|---|---|
| `@mozilla/readability` | 0.6.0 | Apache-2.0 | 12 KB gz | reader-mode extraction (`isProbablyReaderable` gate + `parse()`) | **use** |
| `dompurify` | 3.4.12 | Apache-2.0 (dual) | 11 KB gz | sanitize Readability output (`USE_PROFILES:{html:true}`) | **use** |
| `colorjs.io` (`/fn` API) | 0.7.0 | MIT | 20 KB gz | fix-contrast: CSS Color 4 parsing, WCAG21 contrast, OKLCH lightness stepping + gamut mapping; APCA *advisory only* | **use** |
| `axe-core` | 4.12.1 | MPL-2.0 (bundling OK) | ~600 KB min — **lazy chunk only** | violation-driven dispatch to existing `axeHandlers` | **use, never eager** |
| `dom-accessibility-api` | 0.7.1 | MIT | 14 KB min | ACCNAME gate ("already has a name?") for labels/alt-text | **use** |
| `franc-min` | 6.2.0 | MIT | 175 KB min | html-lang guess — **deferred**: ship never-rewrite-valid + set-nothing-when-absent first; add franc only if measured need | defer |
| `aria-query` | 5.3.2 | Apache-2.0 | build-time only (no tree-shake, 104 KB runtime) | generate `VALID_ARIA_*` tables at build | **build-time only** |
| `@huggingface/transformers` | 4.2.0 | Apache-2.0 | 0.43 MB JS + ~20-25 MB packaged ORT WASM (offscreen only) | on-device Whisper ASR — **gated increment 2** of captions (see 1.3) | defer (gated) |
| `tabbable` | current npm | MIT | small | keyboard-nav tab-order overlay correctness | **use** |
| `darkreader` | 4.9.128 | MIT | 37 KB gz | dark-mode — **only if invested**; demand is 0/2 → not now | defer |
| ImageDecoder (platform) | Chrome 94+ | — | 0 | motion-reducer GIF/WebP/APNG freeze | **use** |
| Avoid | — | — | — | `apca-w3` (restrictive license, stale, superseded by colorjs.io), `wcag-contrast` (hex-only), `culori` (redundant), `freezeframe`/`gifuct-js` (dead field; ImageDecoder wins), whisper.cpp WASM (SAB/no-GPU), moonshine-js (stale, no timestamps), Chrome Prompt-API audio as primary ASR (no timestamps; GPU/22 GB-disk gated) | |

Bundle budget: eager content-script additions ≤ ~50 KB gz
(readability + dompurify + colorjs.io/fn + dom-accessibility-api). axe-core is
a **lazily injected file** (`chrome.scripting.executeScript({files})` on demand
— the `scripting` permission exists; a build step copies the npm dist into
`extension/lib/`). Captions increment 1 needs **no new permissions or CSP**;
increment 2 (on-device Whisper) adds `tabCapture` + an `extension_pages` CSP
with `wasm-unsafe-eval` (the manifest currently has no CSP key at all) +
packaged ORT WASM assets. Optional, read-only: `fontSettings` (seed font scale
from the real browser pref).

---

## Phase 0 — Foundations (no new features; everything else depends on it)

1. **Fix the dispatch wiring directly + guard test (no codegen).** Point
   `fix-contrast` at a new `fixContrast` key mapped to `FixContrast`; merge the
   caption entries (Phase 1.3) so `autoCaptions` maps to the one real module.
   Then add a `run-tests.js` guard: every registry entry's settings keys
   resolve to a dispatched module and no two entries share a key. (An earlier
   draft proposed generating the maps from a registry `module` field —
   adversarial review sized that as speculative-generality churn on the most
   contended file for a bug class with exactly two instances; the guard test
   buys the same CI protection. Note the registry `module` string couldn't
   resolve to IIFE-scoped imports anyway without a hand-kept resolver.)
2. *(merged into 1.)*
3. **Resurrect the audit trail.** Make adapters' `logFix` a **call-time
   lookup** — the module-scope `const` capture runs before content.js's body
   (ESM import order), so assigning the global late can never work with the
   `const` form. Assign `globalThis.ai4a11yLogFix = reportFix` once in
   content.js init, and surface the existing popup fixes panel. Store inverse
   ops where cheap → per-fix undo for structural fixes. This is the
   anti-overlay auditability moat, currently dark.
4. **Default-off AI sweeps + provider probe.** The three default-ON keys are
   `autoWcagFix/autoFixLabels/autoDescribe` (`!== false`); flip them to
   `=== true`. (`autoCaptions`/`autoSimplify` are already default-off.) Add
   `isConfigured()`/`capabilities()` to the provider and skip AI sweeps (with
   one friendly notice) when no key. Fix `PROMPT_GROUPS` mislabeling
   `autoWcagFix` as "AI-powered". **User-visible:** this is a polarity flip
   for existing installs (they silently lose auto-fixes) — see the
   "User-visible changes" section.
5. **Shared `utils/observe.js`** (~30 lines): debounced subtree
   MutationObserver + SPA URL-change hook (Navigation API with fallback);
   adapters register sweep callbacks in `enable()`, disconnect in `disable()`.
   `markProcessed` gains a **per-adapter namespace** (the shared
   `data-ai4a11yProcessed` flag currently causes silent cross-adapter skips)
   and distinguishes `done`/`failed` (failed = retryable; today's permanent
   failure latches all die here).
6. **`utils/system-prefs.js`** — the `watchSystemPrefs()` sketch from
   observable-settings.md, wired with `source:'os-signal'` provenance so OS
   auto-activation never overrides explicit user/Librarian choice
   (applied *before* the Librarian overlay in `init()`).
7. **Provider hardening** (utils/ai.js + background): AbortSignal timeout on
   the Gemini fetch, small concurrency cap + queue, per-element error isolation
   contract (a rejection must never abort a sweep — today generate-labels dies
   on the first error and poisons elements as `pending`).
8. **Contracts & hygiene:** `enable()` returns boolean and content.js honors it
   (no more phantom-enabled state, reader-mode.js:22-25 vs content.js:76-78);
   `announce()` fires on *user-initiated* toggles only (today every page load
   chatters into the aria-live region — an SR harm in its own right); settings
   changes rebroadcast to all tabs via one `chrome.storage.onChanged` listener
   in content.js.

*Non-goals (accepted):* `all_frames:true` injection (real cost on every page;
iframe blindness stays a documented limitation); storage migrations for renamed
keys (prototype; defaults suffice).

## Phase 1 — Top-demand tier

### 1.1 reader-mode (6/0) → Readability + DOMPurify + SR-safe overlay
- Replace the first-match selector heuristic (reader-mode.js:20-31) with
  `isProbablyReaderable(document)` gate → `new Readability(document.cloneNode(true)).parse()`;
  null/short result → friendly announce + `return false` (no phantom state).
- Replace the 23-line hand-rolled sanitizer (64-86) with
  `DOMPurify.sanitize(article.content, {USE_PROFILES:{html:true}})`.
- **Lazy images:** copy `data-src`/`data-srcset` → `src`/`srcset` before
  sanitizing (the page's IntersectionObserver never runs inside the overlay;
  without this, images render blank).
- Render into a **closed shadow root** so page CSS can't restyle article
  content (today site stylesheets apply inside the overlay); style against
  elements, not source classes (Readability strips classes). Relative URLs
  still resolve against the document base — no rewriting needed.
- **SR safety:** `inert` on body children **except the overlay host and the
  `#ai4a11y-announcer` live region** (inerting the announcer — a body child —
  would silence every `announce()` for exactly this audience). With the rest
  of the page inert, Tab can't escape the overlay, so no focus-trap library is
  needed. Cache `document.activeElement` before opening (a closed shadow root
  reports only the host afterward), move focus to the close button on open,
  restore on close. Escape keeps working.
- SPA: tear down on URL change (utils/observe.js hook). Drop the dead
  `originalContent` capture (line 33).
- Acceptance: extraction works on ≥8/10 of a fixed 10-site fixture list where
  `isProbablyReaderable` is true; Tab and SR virtual cursor cannot reach
  background content while open; toggle round-trip is state-clean.

### 1.2 fix-contrast (5/0) → deterministic colorjs.io pipeline, actually wired
- Own `fixContrast` key (Phase 0), `requiresAI:false` for real.
- Rewrite `utils/color.js` as a thin colorjs.io wrapper: parse arbitrary CSS
  colors (incl. oklch/lab), alpha-composite against the *real* effective
  background (walk ancestors compositing alpha; today rgba is treated opaque
  and dark-body sites fall through to a white default → black-on-black "fixes").
- Gate on failing WCAG 2.x ratio only (`meetsContrastAA` exists, is imported by
  nothing); compute the replacement **deterministically**: step OKLCH lightness
  toward compliance, hue-preserving, gamut-mapped. LLM becomes an optional
  brand-palette suggester, never the correctness path. APCA Lc reported as
  advisory only (WCAG 3 has not adopted it; WCAG 2.x remains normative).
- Incremental re-scan via utils/observe.js; fix disable→enable (clear own
  namespace marks); skip elements whose computed color already passes.
- Acceptance: on a fixture page with known failing pairs (incl. rgba overlays
  and a dark-body site), all failing text reaches ≥4.5:1, no passing text is
  touched, disable restores exactly, second enable re-fixes.

### 1.3 captions (5/0 + 5/0) → one adapter; delivery layer first, on-device ASR gated
Merge `AutoCaptions` (observer, overlay box, YouTube CC toggle) and
`GenerateCaptions` (`<track>`/transcript delivery) into one `captions` adapter
behind `autoCaptions`; delete the duplicate registry entry. Adversarial review
split the original single-shot Whisper/tabCapture design into two increments:
demand is 5/0 with *zero* rejections — users need cues to appear at all, not
best-in-class on-device ASR on day one.

**Increment 1 (this plan — no new permissions, no WASM/CSP):**
- **YouTube first:** auto-enable the platform's *native* CC (superset of
  anything we can generate) — fix the fragile bits: iframe src rewrite misses
  attribute-mutation, `.ytp-subtitles-button` selector guard, id regex for
  youtu.be//shorts//embed.
- **Fetchable media** (same-origin or CORS-permitted `src`): background fetches
  the bytes under host permissions → offscreen WebAudio `decodeAudioData` →
  slice into ~15 s chunks → per-chunk **cloud Gemini transcription** through
  the existing provider seam (`transcribeAudio` stops returning null; the user
  key already powers every other AI adapter). Cue times = real chunk offsets —
  honest, coarse (~15 s granularity), synced.
- **blob:/MSE/DRM media:** honest per-video notice ("this player's audio isn't
  reachable — try Chrome Live Caption"), never a silent no-op. Kills today's
  worst failure mode (5/0 demand getting *nothing* with no explanation).
- **Delivery (the moat):** live cues to the overlay box (visual surface, no
  `aria-live`; the transcript block covers braille users); persist accumulated
  VTT as a native `<track>` (video) / expandable transcript (audio); every cue
  labeled "AI-generated". Fix the `'failed'` permanent latch (failed =
  retryable), the `setup`-before-size-check latch, the `position:relative`
  leak, and the pagehide permanent-disable. MutationObserver discovery stays.
- **Honesty:** no WCAG-stat increment for machine output; note WER degrades on
  fast speech (the P3 use case) — fixture includes a fast-speech clip.

**Increment 2 (gated on increment-1 usage; separate wave):** on-device Whisper
— `@huggingface/transformers` 4.2.0, `whisper-base` q8 weights (runtime
download, cached), ORT WASM packaged, new `tabCapture` permission + CSP
`wasm-unsafe-eval` (new manifest key). Hard constraints from review:
`getMediaStreamId` must be minted in an **invoked context** (popup/side-panel
click — a runtime message or page-load auto-enable can never start capture, so
captions-from-tab-audio are per-tab, gesture-initiated by design); ASR runs in
a **Web Worker inside the offscreen doc** (Chrome allows one offscreen
document; the Live voice worklet shares it and inference on its main thread
would stall the audio pump); **mutual exclusion** with Live voice sessions,
surfaced to the user.

- Acceptance (inc. 1): fixture page with a same-origin `<video>` + known
  script (incl. a fast-speech clip) → cues appear with chunk-accurate onsets
  and sane WER; YouTube embed gets native CC enabled; a blob: video shows the
  notice, not silence; disable is layout-clean; failed elements retry after a
  key is added.

### 1.4 visual-assist (6/0) → stop breaking the pages it fixes
- `fontScale` → **text scaling done right**, not `html{zoom}` and *not*
  `chrome.tabs.setZoom` (review killed the setZoom idea: per-tab zoom is a
  single origin-persistent lane already owned by voice mode's `pageZoom` tool
  and undo journal — a second uncoordinated writer corrupts the journal's
  "previous" values; and zoom means "magnify everything", which `pageZoom`
  already offers). Implement as computed-style traversal (set inline
  `font-size = computed × scale` on text elements, Sienna-style), chunked via
  `requestIdleCallback` (pattern exists in motion-reducer), re-applied through
  utils/observe.js, fully reverted on disable. Delete the `html{zoom}`
  fixed-position skew and its reading-guide hand-patch (visual-assist.js:140-144)
  in the same change.
- Fix the third caller path that wipes settings: `applyProfileSettings`
  (content.js:317-331) must merge the stored baseline like the other two paths
  (this silently resets dyslexiaFont/contrastMode on profile auto-apply).
- Contrast presets: scope to text properties (drop forced `background` on every
  div/span, which erases sprite icons); explicit arbitration with dark-mode
  (mutually exclusive at the dispatch layer, with a notice).
- Focus ring: keep `:focus-visible` only; delete keyboard-nav's duplicate rule;
  one shared injectCSS rule.
- dyslexiaFont: exclude icon-font elements (`[class*="icon"], [class*="fa-"],
  .material-icons, [aria-hidden="true"]` heuristic guard) — ligature icons
  currently render as garbage text.
- letterSpacing/lineHeight coverage: apply to a broader, safer selector set.
- Auto-respect: `prefers-contrast: more`/`forced-colors` → suggest/enable
  contrast preset via system-prefs (never overriding explicit choice).
- Acceptance: text scaling keeps fixed navbars/reading-guide aligned and fully
  reverts; enabling a profile with only fontScale preserves stored
  dyslexiaFont; Material-icon pages keep icons; both contrast paths never
  stack with dark-mode; **and the three differentiators the overlap audit
  names — reading ruler, letter spacing, focus indicator — each demonstrably
  work on the fixture** (joint-top demand deserves working features, not just
  fixed bugs).

### 1.5 motion-reducer (4/0) → observer + honest coverage + reversibility
- utils/observe.js hooks re-run freeze/pause sweeps on added nodes; add
  `document.getAnimations().forEach(a => a.pause())` (WAAPI motion is untouched
  today) with resume on disable.
- Delete the class-substring `transform:none` heuristic (breaks
  transform-positioned layout wholesale); keep duration-zeroing + parallax
  kill; exempt the extension's own UI (`#ai4a11y-*`) from the universal kill
  (it currently freezes voice-commands' listening pulse).
- Image freezing via **ImageDecoder**: covers GIF + animated WebP + APNG;
  cross-origin bytes fetched by the SW under host permissions (no canvas
  taint); `drawImage` frame-0 fast path for same-origin. Frozen canvas gets
  `role="img"` **and `aria-label`** (bare `alt` on canvas confers no name —
  audit claim was wrong); copy id/width/height/srcset back on restore.
- Iframes: rewrite YouTube src to inject `enablejsapi=1` (once, with notice
  that playback restarts) or skip; **resume embeds on disable** (today pause is
  one-way). Vimeo via its documented postMessage API with readiness handshake.
- Auto-respect `prefers-reduced-motion` via system-prefs (the signal exists,
  the adapter ignores it).
- Acceptance: fixture with CSS animation, WAAPI animation, GIF, animated WebP,
  autoplay video, YouTube embed — all stop on enable, all resume on disable;
  a transform-positioned carousel keeps its layout.

## Phase 2 — Fix the rejection causes

### 2.1 voice-commands (4/1: "ASR fails non-standard speech") → route through voice mode
The structural fix is the already-built Gemini Live voice mode (LLM-mediated
understanding tolerates dysarthric/disfluent speech + typed-input fallback).
- Extract the deterministic page primitives (scroll/click/focus/back/type +
  `findElementByText`) into a shared module; expose them to Live as a
  `page_action` tool (`offscreen/src/live/tools.js` declaration →
  `voicePageAction` route in voice-routes.js → `pageCommand` branch in
  content.js) — Live currently has no low-latency page primitive; its only
  page path is the heavyweight browser agent.
- Demote the Web Speech adapter to non-quickStart no-key fallback and fix its
  real bugs: the bare `'click'` command shadows click-by-text (dead code);
  word-boundary matching; error-class backoff + self-disable (today
  mic-denied pages loop forever); no interim transcripts into aria-live;
  mutual-exclusion flag so Live sessions and the in-page recognizer never
  listen simultaneously (the Live model can currently *enable* the recognizer
  mid-session — double interpretation).
- Acceptance: "scroll down", "click <button text>", "type hello" work through
  a Live session on a fixture page; with Live connected the local recognizer
  refuses to start; mic-denied page does not loop.

### 2.2 auto-alt-text (4/3: trust) → gated, provenanced, reversible, opt-in
The three rejections map to confirmed harms: silent default-on DOM writes, no
confidence gate, no provenance, no undo, decorative-`alt=""` overwrite, and
silent CORS failure. Fix trust, not features:
- Opt-in (Phase 0 default-off). Targeting via axe `image-alt`/`svg-img-alt`
  node lists when the lazy axe chunk is present, else the sweep — but always
  gated by `computeAccessibleName(el) === ''` (dom-accessibility-api) and
  **never touching `alt=""`** (author-intent decorative) or
  `aria-hidden`/`role=presentation`/tiny images.
- Confidence gate: prompt allows abstain ("UNSURE" → skip, honest unlabeled);
  validate output (length, no refusal-prefix patterns).
- Provenance + undo: `data-ai4a11y-generated` on every written attribute;
  `disable()` reverts all writes (stored originals); fixes appear in the
  popup fixes panel with per-item revert.
- CORS: fetch image bytes via the SW (host permissions) instead of tainted
  canvas; preserve aspect ratio when downsampling (currently squashed).
- Video path: either finish it (write `aria-label` + restore playback position,
  timeout on seek) or delete the dead export — decide by effort; default:
  delete `autoVideoDescribe` (it toggles nothing today).
- Acceptance: decorative images untouched; already-named controls untouched;
  wrong-alt can be reverted from the popup; cross-origin CDN images get alt.

### 2.3 keyboard-nav (3/3: SR users) → SR-safe redesign
Grounding corrected the audit: Alt-modified shortcuts do *not* collide with SR
quick-nav; the real harms are stray badge text in the SR buffer, per-page-load
announcements, duplicate skip links, AltGr/Option typing hijack, and
first-heading-only Alt+H. Keep what motor users need, stop harming SR users:
- Badges: `aria-hidden="true"`, positioned via `tabbable` (correct
  positive-tabindex order, fixed-position elements), reposition on
  resize/mutation, teardown on SPA nav.
- Skip links: only when the page lacks one (detect existing skip links).
- Shortcuts: guard editable targets + `isContentEditable`, ignore
  `ctrlKey||metaKey` (AltGr), use `e.code`; heading nav becomes
  next/prev-from-current (cycling), not always-first.
- Clean up the tabindex leaks (shortcut paths never push to
  `modifiedElements`; disable clobbers author tabindex).
- Delegate the focus ring to visual-assist (delete duplicate rule).
- **Validation caveat:** the SR-harm diagnosis was *revised* by grounding (the
  audit's shortcut-collision theory was wrong; the badge/announce/AltGr causes
  are code-inferred, not user-confirmed). Before/while building, verify via
  puppeteer accessibility snapshots that the harms are real and the fixes land:
  badges absent from the AX tree, no live-region write on load.
- Acceptance: AX-tree snapshot shows no injected text nodes; no announce on
  page load; no typing interference in inputs on EU layouts (`ctrlKey` guard
  test); badges match real tab order on a positive-tabindex fixture.

### 2.4 wcag-fixes (3/1) → safety-tiered, violation-driven, audited, undoable
- **Tier the fixers.** Safe/always (when enabled): duplicate-id (fixed
  semantics: rename the *second* element but **do not** re-point references —
  they legally resolve to the first; today it re-points correct label wiring
  to the wrong element), target-blank `rel`, obsolete elements, viewport
  zoom-lock (also match `user-scalable=0`). Risky/opt-in flag: heading
  re-tag, ARIA strip/backfill, nested-interactive, target-size. **Delete**:
  the state-ARIA backfill (`aria-checked="false"` regardless of visual state —
  it lies to SRs), meta-refresh removal (no-op at document_idle).
- **Language:** never rewrite a *valid* BCP-47 tag (today `pt-BR`→`pt`,
  `fa`→`en` — actively harmful); validate structurally; when missing, **set
  nothing** (franc-min guessing deferred — ~90% of the value is in not doing
  harm; add the guesser only if fixtures show missing-lang is common).
- **axe-driven mode** (must not block the safe-tier fixers, which run without
  it): the content bundle publishes a dispatch entry point on its isolated
  world at init — `window.__ai4a11yAxeDispatch(violations)` closing over the
  module-scoped `axeHandlers` (they're IIFE-internal; an injected chunk cannot
  reach them directly). A build step copies axe-core 4.12.1's dist into
  `extension/lib/axe.min.js`; on demand the SW injects it plus a small runner
  via `chrome.scripting.executeScript({files})` into the same isolated world
  (`window.axe` and the dispatch global are mutually visible there). Runner:
  `axe.run` with `runOnly` + `resultTypes:['violations']`, debounced observer
  re-scan, never eager; verify rule-id keys against 4.12 (drop deprecated
  `duplicate-id*` keys as needed). Replace hand-rolled `VALID_ARIA_*` with
  build-time tables generated from aria-query.
- **Audit + undo:** every fix through the resurrected logFix → popup panel,
  inverse ops for the safe tier.
- Acceptance: valid-lang pages never rewritten; label wiring resolves to the
  same elements before/after duplicate-id fix; risky fixers run only when
  flagged; fixes visible + undoable in the popup.

### 2.5 simplify-text (3/0) + generate-labels (2/0)
- simplify-text: port the legacy fork's DOM-preserving show-original wrapper
  (the live fork destroys hyperlinks in every simplified paragraph —
  `element.textContent = ''`); drop `td` from the selector (data corruption);
  split `enable({simplify, summarize})` so `autoSummarize` stops silently
  running the wrong feature; route `summarizeText` through the Chrome
  Summarizer API in the provider when available (on-device, key-free), cloud
  fallback; re-check `enabled` after each await; cache per-URL in
  `chrome.storage.session`; batch candidate paragraphs into one prompt.
- generate-labels: gate every path on `computeAccessibleName === ''` (the
  import exists and is unused — links/buttons named by child `img[alt]`,
  `aria-labelledby`, wrapping `<label>` currently get AI labels *on top*);
  per-element try/catch (one failure kills the sweep today); visibility
  filter; fix the self-contradicting form selector (`:not([id])` makes the
  `label[for]` check dead and skips the most common unlabeled case);
  provenance + abstain + popup-undo same as auto-alt-text.

## Phase 3 — Low/no-demand tier (small, mostly subtractive)

- **color-filter (0/0) — mandatory safety fix:** the three matrices are
  *simulation* matrices (reproduce CVD), not correction — a protanope gets the
  red-green signal removed entirely. Swap in LMS-daltonization
  (error-redistribution) matrices (~20-line constant change), keep the
  injection infra, move the SVG defs anchor to `documentElement`, and note the
  dark-mode filter conflict in the dispatch arbitration from Phase 1.4.
- **read-aloud (2/3):** fix-then-freeze. Apply the cheap fixes — the
  double-speak (`announce()` racing TTS start; an SR harm regardless of
  whether it caused the rejections) and sentence-chunked utterances (Chrome's
  ~15 s remote-voice stall) — then demote from onboarding and freeze. Point SR
  users to voice mode's read-page instead. (Review note: don't assert a
  rejection cause *and* retire without the fix — the fix is ~small, so do it.)
- **large-cursor (2/2):** retire the registry entry + onboarding card; point
  at OS pointer settings (system-wide superset). Keep the dormant VA branch.
- **dark-mode (0/2):** no DarkReader investment now (0 demand, ~37 KB gz on
  every page). Auto-respect: `prefers-color-scheme` suggestion via
  system-prefs; fix the registry description (currently claims DarkReader);
  dedupe the conflicting `html{filter}` with color-filter via arbitration.
- **focus-mode (0/0):** delete the always-on hover-highlight rule (fires even
  with all options false, unreadable on dark themes); freeze the rest; remove
  the dead `dimBackground` claim from the registry description.
- **dyslexia-font (0/0):** retire the standalone registry entry (keep shared
  letterSpacing/lineHeight — the evidenced part); dormant VA branch stays for
  existing users.

Retirement checklist per entry (from grounding): registry entry + settingsMeta
+ PROMPT_GROUPS, popup controls, onboarding quickStart grid,
`run-tests.js`/`test-skills.html` expectations, `background.js`
OBSERVED_SETTING_KEYS, `web-surface.js` cross-app dimension mappings (dark-mode
is referenced there — keep the *key* alive even if the card retires), then
`npm run build` (regenerates `lib/tools-registry.js`).

## Verification strategy

1. **Static/unit:** extend `test/run-tests.js` (wiring guard: every registry
   settings key resolves to a dispatched module, no two entries share a key,
   logFix is call-time-bound) and `test/test-skills.html`-style module tests
   for pure logic (contrast math, VTT cue building, lang validation, ACCNAME
   gating with jsdom).
2. **Fixture pages:** one per Phase-1/2 adapter under
   `personalized-extension/test/fixtures/` (contrast pairs incl. rgba/dark-body;
   motion matrix incl. WAAPI/WebP; reader articles incl. div-soup;
   positive-tabindex page; unlabeled-controls page; a/v media page with known
   script).
3. **E2E (puppeteer, already a devDep):** per-adapter beats — enable → assert
   DOM effect → disable → assert clean restore; AX-tree snapshot assertions
   for the SR-safety fixes (reader inert, keyboard-nav badges); the captions
   transcription beat is `GEMINI_API_KEY`-gated like the existing live suites.
4. **Adversarial review:** after each implementation wave, an independent
   review pass (consent/SR-safety, correctness, MV3 lifecycle) with
   per-finding verification — same protocol that caught the voice-mode undo
   classes.
5. **Regression gate:** `npm run build` + existing suites (run-tests, voice
   suites, librarian/toolkit tests, demo-beats) stay green.

## Execution order

| Wave | Scope | Notes |
|---|---|---|
| W1 | Phase 0 foundations | 2 sequential items (wiring/defaults, then shared utils/provider) — content.js is the contention point |
| W2a | **Tier 1 complete first**: 1.1 reader, 1.2 contrast, 1.4 visual-assist, 1.5 motion | parallel (disjoint adapter files); first real consumers of the W1 utils — proves the infra before the wide fan-out |
| W2b | Tier 2: 2.2 alt-text trust layer, 2.3 keyboard-nav, 2.4 wcag+axe, 2.5 simplify+labels | parallel, after W2a validates shared infra; alt-text/labels use the sweep fallback, never block on axe |
| W3 | 1.3 captions **increment 1** (delivery + cloud ASR), 2.1 voice-commands→Live bridge | two agents, disjoint surfaces; no new permissions |
| W4 | Phase 3 tier + retirement checklist | one agent |
| W5 | Adversarial review + fix pass + full gate | review fan-out |
| — | captions **increment 2** (Whisper/tabCapture/CSP) | gated on increment-1 usage; not in this program |

## User-visible changes (explicit, not silent)

Adversarial review flagged four behavior changes that must be surfaced (a
release-note entry + where noted, an in-product nudge), not slipped in:

1. **Default polarity flip:** `autoWcagFix/autoFixLabels/autoDescribe` go
   default-ON → default-OFF. Existing installs lose auto-fixes until
   re-enabled — one-time notice pointing at the toggles.
2. **fix-contrast re-toggle gap:** users who "enabled Fix Contrast" were
   actually running WcagFixes; after the fix they get *neither* until they
   re-toggle. Migration nudge: if legacy `autoWcagFix` was set via the
   fix-contrast tile path, prompt once to enable the real `fixContrast`.
3. **Captions UX model:** not fully "set and forget" — blob:/DRM media shows a
   can't-caption notice (inc. 1), and tab-audio capture (inc. 2) is per-tab,
   gesture-initiated by platform design. Settings copy sets the expectation.
4. **Retired onboarding cards** (large-cursor, dyslexia-font; read-aloud
   demoted): cards get a "moved — use your OS setting" pointer state rather
   than vanishing for users who had them enabled.

## Bundle-budget disposition (post-implementation, finding #11)

Measured after W1–W4: the vetted packages add ~124 KB min (~48 KB gz) to the
eager content bundle — colorjs.io/fn 45, readability 33, dompurify 28,
dom-accessibility-api 12, tabbable 6 — i.e. **within** the ≤50 KB-gz additions
budget. The shipped bundle was 115 KB gz only because `build.js` never
minified; enabling minification brings the whole bundle to ~77 KB gz
(sourcemaps retained). Accepted at that size for the prototype; the next lever
if it grows is splitting reader-mode's readability+dompurify (61 KB min) into
an on-demand `chrome.scripting` chunk like axe. A size-budget guard in
run-tests fails the suite if the gzipped bundle exceeds 90 KB.

## Accepted limitations (prototype-scoped)

- Top-frame only (no `all_frames`); iframe content stays unadapted.
- Captions (inc. 1) have ~15 s cue granularity from chunked cloud
  transcription and require the user's Gemini key; blob:/MSE/DRM media is not
  captionable until increment 2 (tab audio); WER degrades on fast speech —
  labeled, not hidden.
- One offscreen document per extension: heavy captions work and a Live voice
  session will be mutually exclusive when increment 2 lands.
- axe-driven mode scans on demand/debounced, not continuously; >50 K-element
  pages may be slow — surfaced as a notice, not solved.
- OS-signal auto-respect covers exactly the five observable signals; screen
  readers/magnifiers/color filters remain undetectable by design.
