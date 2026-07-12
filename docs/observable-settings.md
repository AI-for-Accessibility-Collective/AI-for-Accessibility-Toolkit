# Observable System & Browser Accessibility Settings

> Accessibility guidelines say a site or tool should *respect* the user's system
> and browser settings. This doc answers the prerequisite question: **which of
> those settings can we actually detect** — from a website (CSS/JS) and from a
> Chrome extension (which has extra `chrome.*` APIs) — across macOS, Windows, and
> ChromeOS.

**Status:** verified snapshot, 2026-07. Chrome version numbers and Baseline
status were fact-checked against MDN / chromestatus / caniuse; the web-platform
AT-privacy stance against W3C TAG and the AOM explainer. Treat "not observable"
claims as accurate-as-of-this-date — the media-feature family is still growing.

Companion to [`docs/adapter-overlap.md`](adapter-overlap.md): that doc asks *what
already exists* for each adapter; this one asks *what the extension is allowed to
know* so it can auto-respect settings instead of asking the user.

---

## Bottom line

1. **On macOS and Windows, a Chrome extension can observe nothing more than a
   plain website can.** An extension *content script* reads CSS media queries
   (`window.matchMedia`, `@media`) identically to a page. The extension's one
   privileged accessibility API — `chrome.accessibilityFeatures` — is
   **ChromeOS-only for 15 of its 16 properties**. So the "extension superpower"
   for *detecting* accessibility settings is real but exists **only on ChromeOS**.

2. **Exactly five OS accessibility settings are web-observable** across all three
   platforms, via user-preference media features. These are the ones we can wire
   "auto-respect" to. Everything else is either inferable-but-ambiguous
   (zoom/font size) or **deliberately not exposed** (screen readers, magnifiers,
   color filters, cursor size) for privacy reasons.

3. For the non-observable majority, the guideline "respect the setting" is
   **unenforceable by detection** — the correct response is defensive design
   (semantic HTML/ARIA, never color-alone, `rem`-scalable layouts, ship captions)
   plus a **manual toggle**, not detection.

---

## Bucket 1 — Observable from a website (and identically from an extension)

The **user-preference media features**. Read them live so you react when the user
flips the OS toggle without a reload:

```js
const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
const apply = () => setReducedMotion(mq.matches);
mq.addEventListener('change', apply);   // fires on OS toggle, no reload
apply();                                 // and read the initial state
```

| Setting (OS source) | Media feature | macOS | Windows | ChromeOS | Chrome | Baseline |
|---|---|:--:|:--:|:--:|:--:|---|
| **Dark mode** (Appearance / Colors mode / Dark theme) | `prefers-color-scheme: dark` | ✅ | ✅ | ✅ | 76 | Widely available |
| **Reduce motion** (Reduce motion / Animation effects off) | `prefers-reduced-motion: reduce` | ✅ | ✅ | ✅ | 74 | Widely available |
| **Increase contrast** | `prefers-contrast: more` (also `less`, `custom`) | ✅ | ✅¹ | ✅ | 96 | Widely available |
| **High-contrast forced palette** | `forced-colors: active` + system-color keywords | ❌² | ✅ | ✅ | 89 | Since Sept 2022 |
| **Reduce transparency** | `prefers-reduced-transparency: reduce` | ✅ | ✅ | — | 118 | ⚠️ **not** Baseline³ |

¹ On Windows, `prefers-contrast` is mostly *derived from* the active Contrast
Theme (reports `custom`, plus `more`/`less` by theme luminance) rather than an
independent toggle.
² **macOS "Increase Contrast" does NOT trigger `forced-colors`** — it only sets
`prefers-contrast: more`. `forced-colors: active` is effectively a **Windows-only**
signal (Contrast Themes / legacy High Contrast).
³ `prefers-reduced-transparency` works in Chrome/Edge 118+ but Safari and Firefox
lack it as of 2026 — feature-detect before relying on it.

### When `forced-colors: active` (Windows Contrast Themes)

The browser overrides author colors with the user's limited palette, exposed
through **CSS system-color keywords** you can read as normal color values:
`Canvas`, `CanvasText`, `LinkText`, `VisitedText`, `ActiveText`, `ButtonFace`,
`ButtonText`, `ButtonBorder`, `Field`, `FieldText`, `Highlight`, `HighlightText`,
`Mark`, `MarkText`, `GrayText`, `AccentColor`, `AccentColorText`. Chrome also
synthesizes `prefers-color-scheme` from the `Canvas` lightness, and matches
`prefers-contrast: custom`. Opt individual elements back out with
`forced-color-adjust: none`. (These keywords only carry the user's real palette
*while* `forced-colors` is active.)

### Three traps (all verified — easy to get wrong)

- **macOS Increase Contrast → `prefers-contrast: more`, not `forced-colors`.**
- **`inverted-colors` (macOS/iOS Invert / Smart Invert) is Safari-only** —
  Chromium has never shipped it (confirmed through Chrome 152). OS color
  *inversion* is undetectable in Chrome by any means, web or extension.
- **`prefers-reduced-data` never shipped** in stable Chrome (flag-only prototype,
  since retired). Use `navigator.connection.saveData` — but note that's a
  data-saver signal, not an accessibility setting.

### Optional server-side: `Sec-CH-Prefers-*` client hints

The same three preferences can be sent to the server as client hints (opt-in via
`Accept-CH`), for SSR without a flash: `Sec-CH-Prefers-Color-Scheme` (Chrome 93),
`Sec-CH-Prefers-Reduced-Motion` (108), `Sec-CH-Prefers-Reduced-Transparency`
(119), `Sec-CH-Prefers-Contrast`.

### Related web-readable signals (capability, not a11y toggles)

`pointer` / `hover` / `any-pointer` / `any-hover` (touch=coarse vs mouse=fine —
useful for target sizing, but a device trait, **not** an AT signal), `monochrome`
/ `color-gamut` (hardware), `update`, `scripting`; plus
`navigator.languages` and `speechSynthesis.getVoices()` (installed TTS voices —
also a fingerprinting surface; do not infer disability from it).

### Zoom & font size — inferable, but ambiguous

| What | How (web) | Limitation |
|---|---|---|
| Browser page zoom (Ctrl +/-) | `window.devicePixelRatio` (zoom multiplies it) | Combined with display density + OS scaling into **one** number — not separable. No `zoom` event; re-arm a `(resolution: Xdppx)` media query to detect changes. |
| Pinch-zoom | `visualViewport.scale` | **Desktop Ctrl-zoom does NOT move this** — it stays `1`. Touch/pinch only. |
| OS display scaling (e.g. Windows 150%, Retina) | folds into `devicePixelRatio` | Indistinguishable from density and browser zoom. |
| Browser default font size | `getComputedStyle(documentElement).fontSize`, or measure a `1rem` element | You read the *effect* (px), not the setting. |
| Browser **minimum** font size | reflected in `getComputedStyle().fontSize` in Chrome/Safari | Firefox doesn't reflect it → not cross-browser reliable. Extension can read it directly (Bucket 2). |

There is **no** `prefers-larger-text` media feature; the OS text-size slider does
not change Chrome's default font, so OS-level text scaling is not observable as a
discrete signal.

---

## Bucket 2 — Observable *only* from an extension

The extension's genuine extra reach. The first two are cross-platform and
directly useful; the rest are ChromeOS-only.

| Signal | API | Platforms | Permission | Notes |
|---|---|---|---|---|
| **Browser minimum / default font size** | `chrome.fontSettings.getMinimumFontSize()` / `getDefaultFontSize()` / `getDefaultFixedFontSize()` | cross-platform | `fontSettings` | A page **cannot** read the minimum-font-size pref at all. Genuine win — seed font scaling from the user's real pref. |
| **Exact zoom factor + default zoom** | `chrome.tabs.getZoom()` · `getZoomSettings().defaultZoomFactor` | cross-platform | none (zoom methods) | Pages can only approximate; extension gets the precise factor and the configured default. |
| **Animation policy** (GIF playback) | `chrome.accessibilityFeatures.animationPolicy` → `allowed`/`once`/`none` | cross-platform | `accessibilityFeatures.read` | The **only** cross-platform `accessibilityFeatures` prop — but it's Chrome's internal image-animation policy, **not** OS reduce-motion, and unrelated to `prefers-reduced-motion`. |
| **ChromeVox, high contrast, screen/docked magnifier, large cursor, cursor color, sticky keys, autoclick, virtual keyboard, dictation, switch access, select-to-speak, caret/cursor/focus highlight** (15 toggles) | `chrome.accessibilityFeatures.<x>.get({})` → `{value, levelOfControl}`; watch `.onChange` | **ChromeOS only** | The headline extension capability — including **detecting the ChromeVox screen reader**, impossible on any other platform. |

Notes:
- `get()` needs the `accessibilityFeatures.read` permission (`.modify` does **not**
  imply read). Returns a `ChromeSetting`: `{value, levelOfControl}` where
  `levelOfControl ∈ {not_controllable, controlled_by_other_extensions,
  controllable_by_this_extension, controlled_by_this_extension}`.
- `spokenFeedback` reads **only ChromeVox on ChromeOS** — it does **not** detect
  JAWS/NVDA (Windows) or VoiceOver (macOS).
- Version note: the API dates to ~Chrome 37; later props were added over time
  (`caret/cursor/focusHighlight`, `selectToSpeak`, `switchAccess` in 51,
  `cursorColor` 85, `dockedMagnifier` 87, `dictation` 90).

---

## Bucket 3 — Not observable from either (the "respect this" gaps)

Deliberately unexposed on macOS/Windows to **both** websites and extensions. The
rationale for the AT-related items is **privacy**: AT use can re-identify a user
and may constitute sensitive medical data, so the web platform minimizes what
sites learn — the Accessibility Object Model *abandoned* its AT-event path for
exactly this reason, and there is no `navigator.screenReader` (nor a plan for one).

| Setting | Why not observable |
|---|---|
| **Screen reader running** (VoiceOver, Narrator, NVDA, JAWS) | No API by design (privacy). ARIA/AOM let you *expose* semantics to AT, never *detect* it. ChromeOS ChromeVox via extension is the lone exception. |
| **Screen magnifier** (macOS Zoom, Windows Magnifier) | Composited above the page; `devicePixelRatio`/`visualViewport` don't change. ChromeOS-only via extension. |
| **OS color filters / colorblindness filters / grayscale** | Applied by the OS compositor after render; no `prefers-color-filter` query. |
| **"Differentiate without color"** (macOS/Windows) | CSSWG declined a media query by design (author reactions could increase confusion). |
| **Mouse pointer size & color; text-cursor thickness** | No media feature; OS draws the cursor. ChromeOS `largeCursor`/`cursorColor` via extension only. |
| **OS text-size slider / "Make text bigger"** | No `prefers-larger-text`; slider doesn't change Chrome's default font. Only browser zoom/font is inferable, and not isolatable. |
| **Mono audio** | OS downmixes at the audio layer; Web Audio sees only the page's channel layout. |
| **OS caption styling** | `::cue` lets a site *set* caption style but not *read* the user's OS preference. |
| **Invert colors** (in Chrome) | `inverted-colors` is Safari-only; no `chrome.*` substitute. |

---

## What this means for the toolkit

"Can the extension auto-respect settings instead of asking?" — **yes, for exactly
the five Bucket-1 signals**, which map cleanly onto existing adapters. Wire each
adapter to read its signal on load and react to `change`:

| Observable signal | Adapter to auto-activate | Status today |
|---|---|---|
| `prefers-reduced-motion: reduce` | [`motion-reducer`](../personalized-extension/skills/builtin/motion-reducer.js) | Force-suppresses, but does **not** key off the OS signal — should auto-enable when `reduce` is set. |
| `prefers-color-scheme: dark` | [`dark-mode`](../personalized-extension/skills/builtin/dark-mode.js) | No auto-activation from the OS signal. |
| `prefers-contrast: more` / `forced-colors: active` | [`fix-contrast`](../personalized-extension/skills/builtin/fix-contrast.js) / `visual-assist` high-contrast | No auto-activation. |
| `prefers-reduced-transparency: reduce` | *(no adapter yet — candidate)* | — |
| `chrome.fontSettings.getMinimumFontSize()` (extension-only) | `visual-assist` font scaling | Not seeded from the user's real browser pref. |

Suggested shared helper — a single "environment preferences" reader the adapters
subscribe to:

```js
// utils/system-prefs.js  (sketch)
export function watchSystemPrefs(onChange) {
  const q = {
    reducedMotion: '(prefers-reduced-motion: reduce)',
    dark:          '(prefers-color-scheme: dark)',
    moreContrast:  '(prefers-contrast: more)',
    forcedColors:  '(forced-colors: active)',
    reducedTransparency: '(prefers-reduced-transparency: reduce)',
  };
  const mqs = Object.fromEntries(
    Object.entries(q).map(([k, m]) => [k, window.matchMedia(m)]));
  const read = () => onChange(
    Object.fromEntries(Object.entries(mqs).map(([k, mq]) => [k, mq.matches])));
  Object.values(mqs).forEach(mq => mq.addEventListener('change', read));
  read();
}
```

**Honest boundary:** for everything in Bucket 3 (screen reader, magnifier, color
filters, cursor/text size), "respect the system setting" is **unenforceable by
detection** — those adapters must stay manual/heuristic, and the UI should let the
user turn them on directly. Auto-respect is a five-signal story, not a
detect-everything story.

---

## Verification notes

Sourced from a four-stream research pass (media features · `chrome.*` privileged
APIs · zoom/font/not-observable · OS-setting completeness sweep), each
adversarially fact-checked. Confidence **high**. Corrections applied from the
fact-check: `forced-colors` reached Baseline **September 2022** (not a later
date); `chrome.accessibilityFeatures` base version "37" is an approximate
historical attribution (the current doc prints explicit "since" versions only for
the newer properties). "No tool/API does X" claims carry the usual
can't-prove-a-negative caveat but were each checked against a second source.

## References

- MDN media features: [`prefers-color-scheme`](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-color-scheme) · [`prefers-reduced-motion`](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion) · [`prefers-contrast`](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-contrast) · [`forced-colors`](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/forced-colors) · [`prefers-reduced-transparency`](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-transparency) · [`inverted-colors`](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/inverted-colors)
- [CSS system colors](https://developer.mozilla.org/en-US/docs/Web/CSS/system-color) · [`forced-color-adjust`](https://developer.mozilla.org/en-US/docs/Web/CSS/forced-color-adjust)
- [`Sec-CH-Prefers-*` client hints (web.dev)](https://web.dev/articles/user-preference-media-features-headers)
- Chrome extension APIs: [`accessibilityFeatures`](https://developer.chrome.com/docs/extensions/reference/api/accessibilityFeatures) · [`fontSettings`](https://developer.chrome.com/docs/extensions/reference/api/fontSettings) · [`tabs` zoom](https://developer.chrome.com/docs/extensions/reference/api/tabs) · [`types.ChromeSetting`](https://developer.chrome.com/docs/extensions/reference/api/types)
- Zoom/font detection: [`devicePixelRatio`](https://developer.mozilla.org/en-US/docs/Web/API/Window/devicePixelRatio) · [`VisualViewport.scale`](https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport/scale) · [minimum font-size discussion (csswg-drafts #10479)](https://lists.w3.org/Archives/Public/public-css-archive/2024Jun/0790.html)
- AT-privacy rationale: [AOM explainer](https://wicg.github.io/aom/explainer.html) · [W3C TAG Privacy Principles](https://w3ctag.github.io/privacy-principles/) · [W3C Fingerprinting Guidance](https://www.w3.org/TR/fingerprinting-guidance/)
- Microsoft: [deprecating `-ms-high-contrast` (2024)](https://blogs.windows.com/msedgedev/2024/04/29/deprecating-ms-high-contrast/) · [styling for Windows High Contrast with forced-colors](https://blogs.windows.com/msedgedev/2020/09/17/styling-for-windows-high-contrast-with-new-standards-for-forced-colors/)
