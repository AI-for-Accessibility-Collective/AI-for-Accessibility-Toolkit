# Built-in Adapter Overlap Audit

> For each of the 18 built-in adapters, what already exists — open-source
> libraries, free extensions, or browser/OS-native features — that does *part*,
> *all*, or a *superset* of the job, and where the toolkit still adds defensible
> value.

**Status:** point-in-time snapshot, 2026-06-17. Tool landscapes (especially the
emerging on-device browser-AI APIs) move fast — treat URLs and "no equivalent
exists" claims as accurate-as-of-this-date, not permanent.

**Method.** Each adapter's *actual implementation* (in
`personalized-extension/skills/builtin/`, manifest in
[`skills/registry.js`](../personalized-extension/skills/registry.js)) was read
to ground capabilities in code, then researched against current tools. The five
adapters flagged as genuinely differentiated were additionally put through an
**adversarial verification pass**: an independent skeptic tried to *refute* each
"nothing free/native does this" claim by finding an existing tool that already
does it. Where the skeptic succeeded, the claim below is narrowed accordingly —
those corrections are called out explicitly. Confidence on the negative
("no tool does X") claims is **medium**: you cannot exhaustively prove a negative
across all of GitHub / the extension stores.

This audit substantiates the thesis already stated in
[`docs/architecture.md`](architecture.md): *"Existing accessibility tools
(axe-core, Pa11y) give you a report. This toolkit adapts the page."* The
evidence below shows that **detect-vs-adapt is the real moat** — the
remediation/adaptation tier is where almost nothing free or native competes.

---

## Summary

| Adapter | Closest existing equivalent | Verdict |
|---|---|---|
| `dark-mode` | **DarkReader** (already embedded); Chrome `force-dark` flag; Midnight Lizard | 🟥 Redundant |
| `large-cursor` | OS pointer-size settings (Win/macOS/ChromeOS) — system-wide superset | 🟥 Redundant |
| `read-aloud` | Web Speech `SpeechSynthesis` + Edge/macOS/iOS/Android read-aloud + free exts | 🟥 Redundant |
| `auto-captions` | Chrome / Windows / macOS / Android **Live Caption** (on-device, system-wide) | 🟥 Redundant |
| `voice-commands` | OS Voice Control/Access; LipSurf, Handsfree extensions | 🟥 Redundant |
| `dyslexia-font` | "OpenDyslexic for Chrome" ext; Lexend — *and the science is weak* | 🟥 Redundant |
| `fix-contrast` | Kilian Valkhof's free **"Fix Contrast"** ext; CSS `contrast-color()` | 🟥 Mostly redundant |
| `reader-mode` | **Readability.js + DOMPurify** (drop-in superset); native reader views | 🟥 Redundant |
| `color-filter` | OS color filters (correction, global); DevTools (simulation) | 🟨 Partial |
| `visual-assist` | Sienna / accessibility-widget.net (OSS bundles); Edge Immersive Reader | 🟨 Partial |
| `focus-mode` | Reader Line, BeeLine, Edge Line Focus (each a slice) | 🟨 Partial |
| `simplify-text` | Chrome **Summarizer API** (summaries half); Rewriter API (immature) | 🟨 Partial |
| `keyboard-nav` | Vimium/SurfingKeys, SkipTo, caret browsing, A11y Insights tab-stops (slices) | 🟨 Partial |
| `motion-reducer` | `prefers-reduced-motion` (advisory); Stop Animations (lossy, all-at-once) | 🟩 Differentiated |
| `generate-labels` | Overlays (publisher-side); TalkBack/VoiceOver (spoken-only); OSS = img-alt only | 🟩 Differentiated |
| `generate-captions` | CCaptioner (`<track>`, no ASR, archived); Live Caption (ephemeral) | 🟩 Differentiated |
| `auto-alt-text` | **Partly refuted** — overlays + AltAware inject alt to DOM; moat = non-raster | 🟩 Narrowed |
| `wcag-fixes` | Whole OSS/native stack is detect-only; only fixers are discredited overlays | 🟩 Differentiated (strongest) |

**Headline:** ~8 of 18 adapters are largely redundant with free or built-in
supersets. Three already wrap or could trivially wrap existing OSS
(`dark-mode`→DarkReader, `visual-assist`→OpenDyslexic, `reader-mode`→Readability.js).
The defensible value concentrates in the **🟩 tier** — runtime structural
remediation and AI name/caption/alt generation *written into the live DOM* — but
even there the claims must be stated precisely, because the adversarial pass
found real competitors for several of them.

---

## 🟥 Largely redundant — a free or native superset already exists

A standalone tool or OS setting already does this as well or better. The
toolkit's value here is *bundling and per-site automation*, not novel capability.

- **`dark-mode`** — The implementation already wraps the open-source
  [DarkReader](https://darkreader.org/) library (`dark-mode.js:17`), with a
  CSS-filter fallback. Alternatives:
  [Midnight Lizard](https://github.com/Midnight-Lizard/Midnight-Lizard) (MIT,
  superset of controls), Chrome's `chrome://flags/#enable-force-dark`. CSS
  `prefers-color-scheme` only helps on sites that authored a dark theme. *This
  adapter is essentially a thin wrapper around an existing tool.*
- **`large-cursor`** — Windows (Mouse pointer size 1–15), macOS (Pointer size),
  ChromeOS (Large cursor + 7 colors) are **system-wide supersets**. CSS cursors
  are page-only and capped ~128px.
- **`read-aloud`** — The most commoditized adapter. Engine (Web Speech
  [`SpeechSynthesis`](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API))
  and word-boundary highlighting are native; synced-highlight TTS already ships
  in Edge Read Aloud, macOS/iOS Spoken Content, Android Select-to-Speak, plus
  free Read Aloud / NaturalReader extensions.
- **`auto-captions`** —
  [Chrome Live Caption](https://support.google.com/chrome/answer/10538231) is a
  browser-wide, on-device, 19-language superset; Windows/macOS/Android match it
  system-wide. Only thin uncovered slivers: auto-toggling YouTube's *own* CC and
  scraping its transcript.
- **`voice-commands`** — Windows Voice Access, macOS/iOS Voice Control, Android
  Voice Access control the *entire OS*; free [LipSurf](https://www.lipsurf.com/)
  and Handsfree extensions exceed the in-page command set. The implementation is
  itself just a thin layer over the browser-native
  [Web Speech `SpeechRecognition`](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition).
- **`dyslexia-font`** — Free
  ["OpenDyslexic for Chrome"](https://chromewebstore.google.com/detail/opendyslexic-for-chrome/cdnapgfjopgaggbmfgbiinmmbdcglnam)
  bundles OpenDyslexic + Lexend + Atkinson. **Caveat worth recording:** the
  peer-reviewed evidence that special dyslexia fonts help is weak/mixed (Rello &
  Baeza-Yates 2013 found no benefit from OpenDyslexic; a 2018 Dyslexie study
  found no effect) — the robust gain comes from the **spacing**, which the
  adapter already applies.
- **`fix-contrast`** — Kilian Valkhof's free
  [Fix Contrast](https://fixa11y.com/) does almost exactly this (per-element WCAG
  scan → recolor only failing text → preserve design). CSS
  [`contrast-color()`](https://developer.mozilla.org/en-US/docs/Web/CSS/color_value/contrast-color)
  shipped stable (Apr 2026). The only sliver the adapter adds is *AI/brand-aware*
  color suggestions vs. black/white fallback.
- **`reader-mode`** — Uses a hand-rolled `querySelector` heuristic
  (`reader-mode.js:20-31`), **not** Mozilla
  [Readability.js](https://github.com/mozilla/readability) (Apache-2.0, the
  engine behind Firefox Reader View). Readability + DOMPurify would be a strict
  superset using battle-tested code. **→ See [low-risk wins](#low-risk-engineering-wins).**

## 🟨 Partially redundant — pieces exist, no single tool bundles them

- **`color-filter`** — OS color filters (Win/macOS/iOS/Android) do *correction*
  but globally; DevTools "Emulate vision deficiencies" only *simulates*. The
  niche: page-scoped correction.
- **`visual-assist`** — OSS widget bundles
  ([Sienna](https://github.com/bennyluk/Sienna-Accessibility-Widget), MIT;
  [accessibility-widget.net](https://github.com/scysys/accessibility-widget.net),
  GPL-2.0) cover most of it. The least natively-served sub-features — reading
  ruler, letter-spacing, enhanced focus indicators — are the bundle's real
  differentiator (Edge Line Focus is the only native approximation, reader-mode
  only).
- **`focus-mode`** — Every component exists piecemeal (Reader Line for dim+ruler,
  scroll-progress extensions, Edge Line Focus) but nothing bundles *in-place
  dimming + live paragraph highlight + scroll progress*.
- **`simplify-text`** — The **summarization half is now native** (Chrome
  [Summarizer API](https://developer.chrome.com/docs/ai/summarizer-api), stable
  since Chrome 138, Gemini Nano on-device). But no native API offers a
  first-class **reading-level rewrite with show-original toggle** (the
  [Rewriter API](https://developer.chrome.com/docs/ai/rewriter-api) is
  tone/length only, still non-stable) — that half is genuinely differentiated.
  **→ See [low-risk wins](#low-risk-engineering-wins).**
- **`keyboard-nav`** — [Vimium](https://github.com/philc/vimium)/SurfingKeys
  (keyboard browsing),
  [SkipTo Landmarks & Headings](https://skipto.disability.illinois.edu/) (landmark
  jumps), native caret browsing (F7), and
  [Accessibility Insights "Tab stops"](https://accessibilityinsights.io/) (tab-order
  overlay) each cover a slice; no single *accessibility-oriented* tool combines
  skip-links + enhanced indicators + tab-order overlay + shortcuts.

---

## 🟩 Differentiated — deep dive

These five are where the toolkit earns its keep. Each was read in code and put
through adversarial verification. The differentiation is **real but narrow** —
stated precisely below, with the corrections the skeptic forced.

One theme runs through all five and must be managed head-on:

> **Guilt-by-architecture.** "A script that mutates a third-party page on the
> fly to fix accessibility" is mechanically the same surface as the
> accessibility *overlays* (accessiBe, UserWay, AudioEye, EqualWeb) that the
> [FTC fined accessiBe $1M](https://www.ftc.gov/news-events/news/press-releases/2025/04/ftc-approves-final-order-requiring-accessibe-pay-1-million)
> (final order Apr 2025) and that 700+ practitioners condemned in the
> [Overlay Fact Sheet](https://overlayfactsheet.com/). The defensible
> distinction is **user-agency + transparency**: these adapters are a tool *the
> visitor chooses to run for themselves* (like a screen reader), open and
> auditable, making no "your site is now WCAG-compliant" claim. That framing has
> to be stated *loudly and proactively*, or the work gets pattern-matched to
> overlays regardless of merit. Notably, the FTC action targeted **deceptive
> compliance claims**, not the runtime-patching mechanism per se — so the moat is
> honesty and auditability, not a claim that runtime patching is inherently
> legitimate here and illegitimate there.

### `wcag-fixes` — runtime structural remediation *(strongest claim)*

**What it actually does** (`skills/builtin/wcag-fixes.js`, ~16 fixers, pure
vanilla DOM, zero network, zero LLM):

- Adds/normalizes `html lang` (heuristic detection, `en` fallback); de-duplicates
  IDs *and rewrites all 7 families of referencing attributes* (`for`,
  `aria-labelledby/describedby/controls/owns`, `headers`, `list`) so label/ARIA
  wiring survives; repairs heading-order skips via real element replacement
  (`replaceWith`, migrating children + attributes); neutralizes positive
  `tabindex`; ARIA hygiene (strips invalid attrs/roles, maps deprecated roles,
  back-fills required attrs); resolves nested-interactive; enforces 2.5.8
  target-size (44×44); fixes viewport zoom locks; removes `meta refresh`;
  replaces obsolete `<blink>`/`<marquee>`.
- **Two modes:** a whole-page sweep, *and* an `axeHandlers` map keyed by
  axe-core rule IDs (`duplicate-id-aria`, `heading-order`, `target-size`…) for
  auditor-driven, per-violation remediation.
- **Per-mutation audit trail** via `logFix(type, el, before, after)` — overlays
  are notoriously opaque; this logs every change.

**Refined claim (upheld, medium confidence):** the entire OSS/native
accessibility stack is **detect-only**
([axe-core](https://github.com/dequelabs/axe-core), Lighthouse, Pa11y, WAVE, IBM
Equal Access, browser DevTools); the only *source-side* fixers
([axe DevTools MCP](https://www.deque.com/axe/mcp-server/),
[axle CI](https://github.com/marketplace/actions/axle-a11y-wcag-accessibility-ci))
patch the **repo**, not the rendered page a user is looking at. A **free, open,
deterministic, end-user runtime remediator** for the specific safely-automatable
structural failures, applied to a page the user *doesn't control*, occupies an
empty quadrant — the skeptic found no refuter after six targeted searches.

**Honest caveats** (must be stated, or critics state them for you):

- This is **best-effort mitigation, not WCAG conformance.** Making axe-core go
  green ≠ accessible — that is the core overlay critique. Several fixers are
  heuristic and can *introduce* harm: `detectLanguage()` guessing wrong and
  defaulting to `en` mis-pronounces a foreign page; `fixHeadingOrder` only
  compares to the immediately-preceding heading; `nested-interactive`
  *downgrades* a real `<button>` to a `<span>` (removes the control rather than
  restructuring); `target-size` padding can overlap adjacent controls; stripping
  invalid ARIA can remove an author's broken-but-intended semantics.
- **No efficacy evidence** yet — no screen-reader user testing, the same
  substantiation gap the FTC penalized.
- **Maintenance coupling:** the `VALID_ARIA_*` / `DEPRECATED_ROLES` / `VALID_LANGS`
  tables and axe rule-ID keys must track WAI-ARIA / WCAG / axe-core releases.
- **No MutationObserver** — SPA re-renders can overwrite fixes.

**Sharpen the moat:**
1. **Reposition** from "auto-fixer" to "transparent end-user remediator with a
   full audit trail," and publish an explicit overlay-comparison that *leads*
   with the differences (open, deterministic, no false compliance claim,
   per-mutation log, no tracking toolbar, fixed allow-list).
2. **Surface `logFix` as a user-visible, exportable remediation report** (rule,
   selector, before→after, WCAG SC) with **per-fix undo**. Auditability +
   reversibility are exactly what overlays lack.
3. **Tier fixes by safety:** keep low-risk always-on (`rel=noopener`,
   `meta-refresh` removal, duplicate-id), make risky rewrites (heading re-tagging,
   ARIA stripping, lang guessing) opt-in or flagged. Prefer *not* setting `lang`
   over guessing wrong.
4. **Close the loop:** run axe-core (or IBM Equal Access) as the live driver,
   dispatch only matched violations through `axeHandlers` — ship the canonical
   "detect-with-axe, then-fix" pairing.
5. **Get evidence:** benchmark against a public corpus (e.g. AccessGuru's
   3,500-violation set, [arXiv 2507.19549](https://arxiv.org/html/2507.19549v1))
   *and* a small NVDA/VoiceOver task study.
6. **Bound the claim:** publish an explicit do/don't list; never imply full
   WCAG/ADA compliance (the FTC order specifically bars that representation).

### `generate-labels` — AI-invented accessible names, persisted to the DOM

**What it actually does** (`skills/builtin/generate-labels.js`) — a **hybrid**,
not pure-AI:

- **Links** (`<a>` without a name): always AI — sends href + parent context +
  existing text to `inferLabel`, writes `aria-label`.
- **Icon buttons:** tries a 16-pattern className heuristic *first*
  (close/menu/search/…), falls back to AI on the button's **SVG source markup**
  (not rendered pixels).
- **Iframes:** 100% heuristic — a 17-entry `IFRAME_PATTERNS` table + hostname
  fallback. **No AI.**
- **Form inputs:** 100% deterministic cascade (placeholder → de-camelCased
  `name` → DOM-proximity text), *skipped* if nothing found. **No AI.**
- One-shot sweep, **no MutationObserver**.

**Refined claim (upheld, medium):** detecting a missing name (axe-core) and
*computing* one from existing markup
([dom-accessibility-api](https://github.com/eps1lon/dom-accessibility-api) /
[ACCNAME 1.2](https://www.w3.org/TR/accname-1.2/), which returns empty string
when no author content exists) are solved and open. *Inventing* a plausible name
for a truly nameless control and **persisting it to the live DOM as an
ARIA-shaped attribute, cross-AT** has no free/OSS/user-installed equivalent.

**Corrections the skeptic forced** (the claim overreached as first stated):

- **Mobile screen readers already invent names via on-device AI.** Android
  [TalkBack + Gemini Nano](https://blog.google/company-news/outreach-and-initiatives/accessibility/android-gemini-ai-gaad-2025/)
  and Apple VoiceOver Screen Recognition label unlabeled icons/buttons — so "AI
  invents names" is *not* novel. The honest delta is **mechanism + persistence**:
  they reason over *rendered pixels*, speak the result *ephemerally* inside one
  screen reader, and never touch the DOM; this adapter reasons over
  *markup/context/SVG-source* and writes a *durable, cross-AT* attribute.
- **Paid overlays (accessiBe/UserWay/AudioEye/EqualWeb) do inject AI `aria-label`s
  into the DOM** — but they are *publisher-deployed*, not user-installed. They
  confirm the framing rather than refute it; keep the concession explicit.
- **Free OSS extensions that write a11y attributes exist, but only for `<img>`
  alt** (vision-based) — none invent *names* for nameless links/buttons/iframes/
  forms.
- **Scope honesty:** the AI-invention path is genuinely only *links + classless
  icon-buttons*. Marketing "AI invents all names" is falsifiable by reading the
  iframe/form code.

**Defensible combination:** web-DOM persistence + markup/context signal (not pixel
vision) + cross-AT + user-installed + single-purpose + on-device-capable.

**Sharpen the moat:**
1. **Ship on-device by default** via the
   [Chrome Prompt API / Gemini Nano](https://developer.chrome.com/docs/ai/prompt-api)
   (the provider abstraction already supports it) — "private, on-device,
   user-controlled, the opposite of cloud overlays."
2. **Add a confidence gate:** let `inferLabel` return "unsure" → skip (honest
   "unlabeled," NVDA-style) or flag the name as AI-guessed, rather than silently
   asserting a possibly-hallucinated label (a wrong `aria-label` is worse than no
   name).
3. **Strengthen the icon signal:** send a *rendered raster* of the icon, not just
   SVG source; add a MutationObserver for SPA/late-rendered controls.
4. **Be ACCNAME-faithful by construction:** compose existing author content the
   way ACCNAME would; invent *only* for the genuine empty-string case, and say
   "we begin exactly where ACCNAME 1.2 returns empty."
5. **Benchmark** invented names vs. empty baseline vs. overlay output with
   screen-reader users.
6. **Scope the claim** to links + classless icon-buttons; describe iframes/forms
   as deterministic ACCNAME-style fallbacks.

### `motion-reducer` — force-suppress all motion classes on non-cooperating sites

**What it actually does** (`skills/builtin/motion-reducer.js`, pure DOM/CSS):

- Injects `!important` overrides zeroing animation/transition duration on
  *every* element; class-substring heuristics (`scroll/slide/carousel/animate/…`)
  to catch JS-driven motion; parallax kill (`background-attachment:fixed→scroll`);
  a chunked `requestIdleCallback` sweep setting `animationPlayState='paused'`.
- Pauses HTML5 `<video>` (recording prior state for resume) **and cross-origin
  YouTube/Vimeo iframes via `postMessage`** — motion no CSS/page-script can reach.
- **Freezes animated GIFs** by rendering the current frame to `<canvas>`,
  preserving `alt`/`role` so screen-reader output is unchanged.
- Fully reversible; announces via live region.

**Refined claim (upheld, medium):** `prefers-reduced-motion` and OS "Reduce
Motion" are
[advisory only](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion) —
they expose a preference the site must voluntarily honor, and most sites ship
zero such rules. This adapter **force-suppresses regardless of site cooperation**,
in-place, per-element, reversibly, **screen-reader-safe**, and additionally reaches
cross-origin YouTube/Vimeo iframes.

**Corrections the skeptic forced:**

- The framing "free extensions each cover only one motion type" is **false.**
  [Stop Animations](https://github.com/craigfrancis/stop-animations) (free/OSS)
  freezes *all* visible motion at once — but via a **lossy full-page screenshot
  overlay** that re-renders jumpily on scroll/resize, isn't per-element, and
  destroys underlying DOM/AT semantics. So the differentiator is **mechanism
  quality** (in-place, reversible, screen-reader-safe, + iframe reach), *not*
  "the only tool that does all four."
- Broad extensions like Helperbird have a "Reduce Motion" that is itself
  *advisory* (their own docs say it depends on the site) — so it does not refute
  the "force on non-cooperating sites" point.

**Honest caveats:** coverage is **not** truly unconditional — cross-origin GIFs
without permissive CORS keep animating; animated WebP/APNG aren't detected (only
`.gif`); **no MutationObserver** so lazy-loaded/SPA motion is missed; iframe
pausing needs `enablejsapi`/Vimeo JS-API at embed time or the `postMessage` is
silently dropped.

**Sharpen the moat:**
1. **Add a MutationObserver + SPA route hook** — the single biggest correctness
   gap; without it "on any site" fails on infinite-scroll/carousels.
2. **Widen freezing** beyond `.gif`: animated WebP, APNG, content-type sniffing,
   and a CSS visibility/overlay fallback for CORS-blocked images.
3. **Harden iframe pausing:** rewrite YouTube `src` to inject `enablejsapi`, use
   the official Vimeo Player API; last resort, blank+restore the `src`.
4. **Reframe** as a user-controlled assistive tool; pre-empt overlay association.
5. **Publish a coverage matrix** test page (one cell per motion type) showing
   competitors *and native settings* failing at least one cell — the
   muted-autoplay cell is a guaranteed Chrome failure (muted autoplay is always
   allowed).
6. **Offer a "respect the site's own reduced-motion variant" mode** — trigger the
   designer's intended safe path when it exists, force-override only when it
   doesn't.

### `auto-alt-text` — AI descriptions injected into the DOM *(claim narrowed)*

**What it actually does** (`skills/builtin/auto-alt-text.js`) — **element-type-correct**
injection, which is the substantive part:

- `<img>` → downsamples to ≤512px, describes, writes `alt`.
- `<canvas>` → `toDataURL`, writes `aria-label` + `role="img"`.
- inline `<svg>` → serializes, describes, **injects a real `<svg><title>` child**
  (+ `role="img"`) — the standards-correct way to name an SVG, not an `aria-label`
  bolt-on.
- `<video>` → captures 6 frames, describes… **but writes nothing to the DOM.**
  Video is currently *describe-only* — a code gap, not a shipped capability.
- Exports `axeHandlers` for `image-alt` / `svg-img-alt`; provider-agnostic
  (on-device Gemini Nano capable).

**⚠️ Claim partly refuted.** The original framing — "every off-the-shelf option
keeps the caption screen-reader-private or copy-paste-trapped; ALTer is the one
extension that injects into the DOM" — is **false**:

- **AI accessibility overlays (UserWay, accessiBe, AudioEye, EqualWeb) inject
  AI-generated alt into the live DOM at runtime**, readable by all AT — UserWay's
  docs say the alt
  ["lives in the DOM, not your HTML."](https://help.userway.org/en/articles/9509667-reviewing-and-updating-ai-powered-alt-image-text-remediations-via-the-widget)
- **[AltAware](https://github.com/DiyaBetcy/AltAware)** (free, OSS, Gemini) also
  injects generated alt into the page DOM. So ALTer is not uniquely DOM-injecting,
  and DOM injection itself is **not** the moat.

**What survives (the real, narrower moat):** no off-the-shelf tool — free, OSS,
native, *or* the SaaS overlays — does **element-type-correct injection across
`<img>` alt AND inline `<svg>` (`<title>`) AND `<canvas>` (`aria-label`+`role`) in
one client-side component, wired into an axe-core rule-ID pipeline, with an
on-device Gemini Nano option.** Overlays and the img-only extensions
(ALTer/AltAware/EveryAlt/AltText.ai) are **raster `<img>` only**. The non-raster
coverage is the headline. (The cloud natives — Chrome/Edge/VoiceOver/TalkBack —
*are* genuinely screen-reader-private and raster-only, so that contrast still
holds against *them*.)

**Honest caveats:** independent testing puts AI alt wrong ~40% of the time —
auto-injecting confidently-wrong alt can be *worse* than empty alt; there's no
confidence gate or human-in-the-loop. Video path is incomplete in code.
Downsampling (512px raster, 320×240 video) degrades text-in-image/charts. SVG
serialization breaks on external `<use>`/`foreignObject`/cross-origin raster.

**Sharpen the moat:**
1. **Finish the video path** — write `describeVideo` output to the DOM
   (`aria-label`/`aria-describedby`, or a descriptions `<track>`). Today it's a
   logged string; making it real gives a capability no competitor has.
2. **Make non-raster the headline demo:** a side-by-side test page (chart
   `<canvas>`, icon `<svg>`, data-viz `<svg>`) where overlays and natives produce
   "No description available" and the adapter names them correctly.
3. **Default to / showcase on-device** (Gemini Nano, or a
   [transformers.js](https://github.com/huggingface/transformers.js)
   Florence-2/SmolVLM WebGPU fallback): zero-cost, no-API-key, no-data-leaves-the-browser
   — a wedge against AltText.ai (paid) and the cloud natives (which send images to
   Google/Microsoft).
4. **Confidence gate + provenance:** mark AI alt (`data-ai-generated`), let the
   model abstain, never overwrite author alt.
5. **Benchmark** injected-name accuracy + WCAG 1.1.1 pass rate vs. ALTer,
   AltAware, and Chrome/Edge native.

### `generate-captions` — persistent `<track>` + `<audio>` transcripts on any site

**What it actually does** (`skills/builtin/generate-captions.js`):

- Page-scans all `<video>`/`<audio>`; for `<video>` injects a **real, persistent
  native `<track kind="captions">`** whose `src` is a `data:text/vtt` URI; for
  `<audio>` inserts an expandable `<details><summary>Transcript</summary>` block.
- Wires into `axeHandlers` (`video-caption`, `audio-caption`). ASR is delegated
  to the pluggable provider (no media uploaded by the module itself).

**Refined claim (upheld, medium):** no free/native/OSS tool combines all four
moves — auto-scan an arbitrary page + no-upload ASR + inject a *persistent native
`<track>`* into in-page `<video>` + insert expandable `<audio>` transcripts.
[CCaptioner](https://github.com/gorhill/ccaptioner) does the real `<track>`
injection but is **ASR-less** (manual file pick) and **archived** ("don't use
this, unmaintained"). [Live Caption](https://support.google.com/chrome/answer/10538231)
is an **ephemeral overlay** — never saved, never attached as a `<track>`.
[Whisper-class engines](https://github.com/ggml-org/whisper.cpp) emit WebVTT but
have **no in-page delivery layer**. YouTube auto-captions are platform-locked to
its own uploads.

**Corrections the skeptic forced — the moat is packaging, and the adapter
under-delivers on it today:**

- The thesis is about an **unbundled feature combination**, not a novel
  mechanism. Every individual move is commoditized; `<track>` injection is a
  documented WCAG technique (H95). The moat is **integration/delivery**, not
  invention.
- **The adapter does *not* itself do "no-upload ASR."** It's ASR-agnostic; the
  bundled `createChromeAIProvider().transcribeVideo/transcribeAudio` **return
  `null`**, so on the advertised Chrome built-in-AI path the adapter is currently
  a **no-op**. Local-Whisper extensions actually *ship* working in-browser ASR —
  on that axis they're *more* complete than this adapter as-shipped.
- **Caption timing is synthetic.** `createSimpleVTT` fabricates cues at a fixed
  10-words / 5-seconds cadence, *not* real ASR timestamps — so the `<track>` is
  structurally real but **desyncs from speech**, and the WCAG-stat increment
  overstates conformance.

**Honest caveats (additional):** `video.src` is empty/non-fetchable on most major
streaming/SPA sites (blob:/MSE/HLS/DASH/DRM) — "works on any site" fails on
exactly the high-value targets; no MutationObserver; `srclang` hardcoded `en`.

**Sharpen the moat:**
1. **Embed a real client-side WebVTT engine** (whisper-web / Whisper-WebGPU /
   Parakeet-v3-WebGPU) so timestamps are *real* and "no upload" is literally true
   — fixing both the synthetic-timing and the no-op-provider gaps.
2. **Own the delivery layer as the headline:** "persistent native `<track>` +
   seekable `<audio>` transcript, auto-injected by page-scan, on any site, no
   upload," benchmarked against the four named near-misses and their exact gaps.
3. **Hard-distance from overlays;** label every cue "AI auto-generated, may
   contain errors"; stop incrementing a WCAG-conformance stat for unverified
   machine output.
4. **Handle real media:** MutationObserver for SPA media; capture audio via
   `captureStream()`/WebAudio when there's no fetchable URL; set `srclang` from
   ASR language detection.
5. **Make captions editable + persisted** (keyed by media URL in
   `chrome.storage`/IndexedDB; exportable `.vtt`/`.srt`) — a real persistence
   advantage over ephemeral (Live Caption) and export-only (Tubelator) rivals.
6. **Benchmark** caption-timing alignment (WER + cue-onset offset) and a coverage
   matrix of which real sites' media actually get captioned.

---

## Cross-cutting recommendations

Patterns that recur across the 🟩 tier:

1. **Pre-empt the overlay association, everywhere.** Lead with user-agency +
   transparency + "no compliance claim." This is positioning, but it's
   load-bearing for the whole differentiated tier.
2. **On-device AI (Gemini Nano via the existing provider abstraction) is the
   single biggest under-used wedge.** It simultaneously *widens* the technical
   moat (no OSS/native tool wires on-device AI to DOM remediation) and *breaks*
   the overlay association (overlays are cloud + opaque). The abstraction
   (`createChromeAIProvider`) already exists — but note its `transcribe*` methods
   return `null` today, so `generate-captions` needs a real local ASR backend
   before this wedge is true for captions.
3. **Auditability is the anti-overlay moat.** `wcag-fixes` already logs every
   mutation (`logFix`); expose that as a user-facing, reversible report and the
   pattern generalizes to every adapter that writes to the DOM.
4. **MutationObserver is missing across the board** (`generate-labels`,
   `motion-reducer`, `auto-alt-text`, `generate-captions`). One-shot sweeps miss
   SPA/lazy-loaded content — the exact modern pages where these adapters are most
   needed. This is the most common correctness gap.
5. **Evidence is the universal weak point.** Every 🟩 claim currently rests on
   "no competitor found" reasoning. A small reproducible benchmark per adapter
   (accuracy / pass-rate / coverage matrix), ideally with screen-reader-user
   validation, converts assertions into defensible, citable proof — and is the
   thing the FTC-fined overlays *cannot* honestly produce.

## Low-risk engineering wins

Two changes fall straight out of the audit, both reducing code while *expanding*
capability:

1. **`reader-mode` → Readability.js + DOMPurify.** Replace the hand-rolled
   `querySelector` heuristic (`reader-mode.js:20-31`) with Mozilla
   [Readability.js](https://github.com/mozilla/readability) (the engine behind
   Firefox Reader View) + [DOMPurify](https://github.com/cure53/DOMPurify) for
   sanitization. Strict superset — better extraction, byline, and XSS handling
   for less bespoke code.
2. **`simplify-text` → Chrome Summarizer API for the summary half.** Route
   summarization through the now-stable on-device
   [Summarizer API](https://developer.chrome.com/docs/ai/summarizer-api) to cut
   token cost and latency, reserving the cloud/LLM call for the reading-level
   *rewrite* — the half that has no native equivalent.

## References

- [FTC final order requiring accessiBe to pay $1M](https://www.ftc.gov/news-events/news/press-releases/2025/04/ftc-approves-final-order-requiring-accessibe-pay-1-million) (Apr 2025)
- [Overlay Fact Sheet](https://overlayfactsheet.com/) — 700+ practitioner signatories
- [axe-core](https://github.com/dequelabs/axe-core) · [axe DevTools MCP Server](https://www.deque.com/axe/mcp-server/) · [axle a11y CI](https://github.com/marketplace/actions/axle-a11y-wcag-accessibility-ci)
- [Mozilla Readability.js](https://github.com/mozilla/readability) · [DOMPurify](https://github.com/cure53/DOMPurify)
- [Chrome built-in AI: Prompt API](https://developer.chrome.com/docs/ai/prompt-api) · [Summarizer API](https://developer.chrome.com/docs/ai/summarizer-api) · [Rewriter API](https://developer.chrome.com/docs/ai/rewriter-api)
- [Chrome Live Caption](https://support.google.com/chrome/answer/10538231)
- [whisper.cpp](https://github.com/ggml-org/whisper.cpp) · [whisper-web (transformers.js)](https://github.com/xenova/whisper-web)
- [W3C ACCNAME 1.2](https://www.w3.org/TR/accname-1.2/) · [dom-accessibility-api](https://github.com/eps1lon/dom-accessibility-api)
- [CCaptioner](https://github.com/gorhill/ccaptioner) (archived) · [AltAware](https://github.com/DiyaBetcy/AltAware) · [Stop Animations](https://github.com/craigfrancis/stop-animations)
- [DarkReader](https://darkreader.org/) · [Fix Contrast](https://fixa11y.com/) · [SkipTo](https://skipto.disability.illinois.edu/) · [Accessibility Insights](https://accessibilityinsights.io/)
- AccessGuru LLM remediation benchmark — [arXiv 2507.19549](https://arxiv.org/html/2507.19549v1)
