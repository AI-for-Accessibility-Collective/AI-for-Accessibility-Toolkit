> Internal design document, 2026-11-03. It started as a proposal; the
> decisions below are recorded in "Decisions", and the blocks are now in
> `toolkit/blocks/` (see "What exists now"). This is a research prototype
> (pre-alpha, adapters unvalidated), so the blocks are scoped to what our
> adapters already need, not a general UI kit.

# Building blocks for adapters

The 50 built-in adapters in `tools/adapters/` implement the same handful of
mechanisms again and again: speaking text, highlighting it, simplifying it,
showing a tooltip or a panel, announcing to screen readers, watching the page
for changes, and putting everything back on `disable()`. Each copy differs a
little, and the differences are mostly accidents, not choices. Their bugs are
found and fixed one adapter at a time. Many of the bugs this week's reviews
found were in exactly these mechanisms:
- tooltips: define-words and persistent-hover;
- pausing media: motion-reducer;
- undoing changes: dismiss-overlays;
- late AI answers written after `disable()`: simplify-text and fix-contrast;
- accessible names: voice-commands.

This document proposes a **core list of building blocks** the toolkit
supplies. Built-in adapters and adapters an agent builds both compose them.
Each block has:

- a **config** the builder agent sets (plain JSON: colours, delays,
  selectors, prompts), so a new adapter is mostly configuration;
- **invariants** nobody can configure away (Escape dismisses, focus is
  never stolen, the page is put back exactly), so every adapter gets them;
- one implementation, tested once.

Source: a read of every adapter (file:line references below), with the
shared modules that exist today: `tools/adapters/_primitives.js`
(`injectStyle`, `observeAdded`, `transformTextNodes`, `mainRoot`) and
`tools/utils/` (`ai.js`, `ai-output.js`, `color.js`, `dom.js`, `image.js`,
`observe.js`, `system-prefs.js`).

## Why now

- **The shared modules exist but are not used.** About 17 adapters inject
  their own stylesheet instead of `injectStyle`, 13 hand-roll a
  MutationObserver, and `observeAdded` has no callers. `watchSystemPrefs` has
  none either. `dom.getAccessibleName` and `dom.isVisible` are each used by one
  adapter; three others re-implement the name and four the visibility test.
- **Agent-built adapters cannot use them at all.** The builder agent writes
  "plain browser JavaScript: no `import`, no network calls"
  (`agent-host/sandbox/AGENTS.md`). The only thing the runtime hands an
  adapter is `enable(options, toolkit)`, where `toolkit` is `data` and
  `observe` (`extension/runtime/scripts.js:70-75, 174-181`). So every agent
  adapter writes its own tooltip, its own speech and its own undo, from
  scratch, every time.
- **An AI call is impossible from an agent-built adapter.** With no network
  and no AI in `toolkit`, "simplify this paragraph" cannot be built.

## The core list

| # | Block | What it gives an adapter | Reimplemented today in |
|---|---|---|---|
| 1 | **session** | One undo ledger for every change, and stale-answer guards | every adapter (6 ledger styles, 4 async guards) |
| 2 | **styles** | Stylesheets, scoped rules, the shared page-filter slot | ~17 inline injectors; filter chain copied 3x |
| 3 | **watch** | New content, route changes, system preferences, "did the person cause this" | 13 observers, 2 route detectors, 6 intent clocks |
| 4 | **page** | Main region, readable text, headings, accessible name, visibility | main region 6x, name 3x, visibility 4x |
| 5 | **highlight** | Mark an element, a text range or a word; a band that follows pointer or focus; a focus ring | focus-mode, reading-ruler, visual-assist, focus-locator; read-aloud promises word highlighting and has none |
| 6 | **announce** | Polite or assertive messages to screen readers, coalesced | 4 own live regions, sr-only CSS copied 5x |
| 7 | **tooltip** | Content on hover or focus that meets WCAG 1.4.13 | 4 versions with 4 different dismissal rules |
| 8 | **panel** | A dialog, disclosure or full-screen overlay with focus handled | 6 versions |
| 9 | **focus** | Focus a region, return focus, keep focus when a control goes, shortcuts | 3 tabindex schemes, ~10 Escape handlers |
| 10 | **text** | Wrap words or runs reversibly, or swap text in place | 3 users of `transformTextNodes`, 3 re-implementations |
| 11 | **ai.text** | Simplify, summarise, define, translate, label, rewrite link text: prompt, gate, cache, budget | 7 adapters, gates in 4 |
| 12 | **ai.vision** | Describe an image or element, read a chart | 3 adapters, SVG capture copied 2x |
| 13 | **speech.out** | Speak text with chunking, rate, voice, word events, autoplay handling | read-aloud |
| 14 | **speech.in** | Voice commands: recognition, a phrase table, find an element by name | voice-commands |
| 15 | **media** | Pause and resume as the person left it, show controls, pick captions | flash-guard, stop-auto-advance, motion-reducer (pause copied 3x), show-captions, auto-transcriber |

The three blocks you named (speech, highlighting and simplification) are
13, 5 and 11. They depend on 1, 4 and 6, which is why those come first.

Not in the core list for now: the measure-then-write layout engine
(big-targets, reflow-column, visual-assist), colour-blind matrices and
DarkReader. They are each used by one or two adapters, and are better kept as
adapters a skill can switch on than as blocks.

## Conventions every block follows

- **Everything goes through a session.** `enable()` opens one
  (`const s = toolkit.session()`), every block is created from it
  (`s.highlight(...)`, `s.tooltip(...)`), and `disable()` is `s.end()`. The
  session undoes every change in reverse order. It restores a value only if
  the page has not changed it since; otherwise it leaves the page's value.
  This is how translate-page, keyboard-nav and dismiss-overlays work today,
  but it becomes the default. Late async answers are dropped automatically,
  because every callback a block runs checks that its session is still
  open. That one rule removes the bug class the reviews kept finding: a
  late AI answer written after `disable()`.
- **Config is plain JSON**, so it can live in an adapter's parameters, a
  skill, or the registry, and the builder agent can write it. Each block
  publishes a JSON Schema for its config (the registry's settings vocabulary
  is the model: `toolkit/registry/tools.js` `settingsMeta`).
- **Where config comes from (proposal).** Each value comes from the block's
  default, then the builder's config, with one exception. For personal
  settings (speech rate and voice, highlight and tooltip colours, text size,
  reading level, target language), the person's profile (the AbilityModel)
  wins over the builder's value. A builder can say "highlight in yellow"; a
  person whose profile says "highlight in blue, high contrast" sees blue.
  This needs your decision; see the questions at the end.
- **Invariants are not config.** Each block below lists them. A builder
  cannot turn off Escape, make a tooltip unhoverable, or have a panel take
  focus on load.
- **Our own UI is marked** (`data-ai4a11y-ui`), so watchers and text walkers
  never react to it, and the agent-watch pattern of hiding from other agents
  is the default.

## The blocks

Each block lists its API (a sketch), its config with today's values, its
invariants, and what it replaces.

### 1. session: reversible changes

```js
const s = toolkit.session();
s.setAttr(el, 'tabindex', '-1');      // recorded: old value or absent
s.setStyle(el, 'outline', '3px solid');
s.addClass(el, 'ai4a11y-big');
s.replace(oldNode, newNode);          // swaps back on end()
s.insert(parent, node, before);       // removed on end()
s.listen(target, 'keydown', fn, opts);
s.timer(fn, ms); s.frame(fn);
const answer = await s.guard(promise); // throws Ended if the session ended meanwhile
s.end();                               // undo everything, in reverse
```

- **Config:** `restore`: `"unless-changed"` (default) or `"always"`.
- **Invariants:** `end()` is idempotent and never throws. A second `enable()`
  while a session is open is a no-op. focus-mode and visual-assist are not
  idempotent today.
- **Replaces:**
  - math-a11y's `setTracked` (139-144), the most general of the six ledgers;
  - the element Sets in unpin-sticky, dismiss-overlays, mute-sounds and
    reflow-column;
  - the dataset originals in fix-contrast;
  - the cleanup closures in fix-landmarks;
  - the request tokens, generation counters and `=== 'pending'` checks in
    describe-on-demand, explore-a-chart, translate-page, motion-reducer,
    simplify-text, fix-contrast and generate-captions.

### 2. styles

```js
s.css('reader', `...`, { scope: 'ai4a11y-reader' });  // <style id>, rules under html.ai4a11y-reader
s.filter('dim', 'brightness(0.8)');                   // the shared page-filter slot
```

- **Config:** CSS text, scope class, and the filter slot's `name` and `value`.
- **Invariants:**
  - One `<style>` per id.
  - Filters compose. dark-mode, reduce-brightness and color-blind share one
    `filter` chain of CSS variables. Today the chain is copied three times
    (dark-mode:9, reduce-brightness:20, color-blind:55) and the media
    variables twice (dark-mode:18-20, flash-guard:21-23).
- **Replaces:** `injectStyle` (kept as the implementation) and the ~17 inline
  injectors.

### 3. watch

```js
s.watch.added(root, el => ..., { debounceMs: 400, cap: 500, types: ['childList'] });
s.watch.route(url => ...);                    // pushState, replaceState, popstate
s.watch.prefs(p => ...);                      // reduced motion, contrast, colour scheme
s.watch.byPerson(el, { withinMs: 1000 });     // true if the person just clicked or typed in el
```

- **Config:** `debounceMs` (0-800 today), `cap`, record `types`
  (childList, characterData, attributes), and `withinMs`. The intent windows
  today are 400, 1000, 1500 and 3000 ms. Also `trusted` (isTrusted only).
- **Invariants:**
  - Never reacts to our own UI or our own writes.
  - Disconnects on `end()`.
- **Replaces:**
  - the 13 hand-rolled observers, `registerSweep` and the unused
    `observeAdded`;
  - spa-focus's history patch (59-79) and `observe.js`'s URL polling;
  - the six intent clocks: dismiss-overlays, mute-sounds,
    live-region-announcer, stop-auto-advance, motion-reducer and
    confirm-actions;
  - `watchSystemPrefs`, which has no users today.

### 4. page: what is on the page

```js
toolkit.page.main();                 // the main content region
toolkit.page.readableText(el, { blockPause: '. ' });
toolkit.page.headings({ maxLevel: 3 });
toolkit.page.nameOf(el);             // accessible name, never a field's typed value
toolkit.page.isVisible(el);
toolkit.page.isOurs(el);
```

- **Config:** skip selectors (live regions, code, form fields; the live-region
  list is copied in 6 files today), and `maxLevel`.
- **Invariants:** read-only.
- **Replaces:**
  - `mainRoot`, and the main-region selectors in read-aloud, skip-links,
    keyboard-nav, spa-focus and define-words;
  - the three `nameOf` copies (confirm-actions, voice-commands, math-a11y);
    this week's voice-commands bug was one of them;
  - the four visibility tests;
  - the heading collectors in page-outline, keyboard-nav and wcag-fixes.

### 5. highlight

```js
s.highlight.element(el, { style: 'background', color: 'auto' });
s.highlight.range(range, { color: 'auto' });          // CSS Custom Highlight API, no DOM change
s.highlight.follow({ source: ['pointer', 'focus'], shape: 'band', height: 40, dimOutside: 0.4 });
s.highlight.focusRing({ color: 'auto', width: 3 });
```

- **Config:**
  - `style`: background, outline or underline;
  - `color`: `auto` picks a colour that meets 3:1 against the background,
    the way focus-mode and reader-mode do now;
  - band `height` and `dimOutside`;
  - `source`;
  - ring `width` and `color`. Today's rings are #c67d00, #0066ff, #1a73e8
    and #1a5fb4.
- **Invariants:**
  - Contrast is checked. A highlight that would make text unreadable is not
    drawn (focus-mode's rule, 14-45).
  - Ranges use `CSS.highlights`, so word highlighting never wraps or splits
    the page's text nodes.
  - Rings beat `outline: none !important` (the box-shadow technique).
  - Motion follows reduced motion.
- **Replaces:**
  - focus-mode's paragraph highlight (232-271);
  - reading-ruler (32-93) and visual-assist's reading guide (632-678);
  - focus-locator's ring (50-137);
  - and it provides the word highlighting read-aloud promises in its header
    but never draws (its `highlightColor` at line 30 is unused).

### 6. announce

```js
toolkit.announce('Definitions on', { politeness: 'polite' });
toolkit.announce.batch(key, message, { windowMs: 400 });
```

- **Config:** `politeness`, `atomic`, `windowMs` (simplify-text coalesces at
  400 ms), and `maxChars`.
- **Invariants:**
  - One live region per page, shared by all adapters, cleared and written
    so that repeats are read.
  - explore-a-chart writes without clearing, so the same message twice is
    missed.
- **Replaces:** the `announce` seam, which hosts implement, and the own
  regions in spa-focus, describe-on-demand, explore-a-chart and
  sound-visualizer; also the sr-only CSS copied in 5 files.

### 7. tooltip (WCAG 1.4.13)

```js
s.tooltip({ trigger: 'abbr[title], .term', content: el => el.title, delayMs: 350,
            dismiss: 'stays-until-left', placement: 'below-flip', describe: true });
```

- **Config:**
  - `trigger` selector;
  - `content`: a function, or the `title` attribute;
  - `delayMs`: 0 or 350 today;
  - `dismiss`: `stays-until-left` (persistent-hover) or `once`;
  - `placement`;
  - `describe`: whether the trigger gets `aria-describedby` pointing at the
    tooltip;
  - `theme`.
- **Invariants (from this week's fixes, so no adapter has to rediscover them):**
  - It is hoverable.
  - Escape dismisses it, and it stays dismissed only while the pointer or
    focus stays on the trigger.
  - It persists while its trigger has focus.
  - A click never closes what the same click's hover opened.
  - A late answer never opens one after it was dismissed.
  - It is measured at full width before it is placed.
  - It never covers the focused element (2.4.11).
- **Replaces:** persistent-hover (120-283) and define-words (293-445). The
  other two versions stay outside the block on purpose: magnifier's lens and
  confirm-actions' prompt are `aria-hidden` and are not 1.4.13 tooltips.

### 8. panel

```js
const p = s.panel({ kind: 'dialog', label: 'Chart data', near: el,
                    focus: 'from-trigger', returnTo: 'trigger', inert: false });
p.body.append(table); p.open(); p.close();
```

- **Config:**
  - `kind`: dialog, disclosure or fullscreen;
  - `near` and `corner`, and collision flip;
  - `label`;
  - `focus`: `never`, `from-trigger` or `always`;
  - `returnTo`;
  - `inert`: fullscreen only, keeping live regions reachable;
  - `theme`;
  - `zIndex`. Today's values are 2147483647, 2147483646, 999999 and 100000.
- **Invariants:**
  - It has a close button at least 24 px.
  - Escape closes it.
  - It takes focus only when its `focus` policy allows.
  - Focus returns to `returnTo` only if the panel had focus.
  - It never covers its target. describe-on-demand's flip is the rule.
- **Replaces:** the panels in describe-on-demand, explore-a-chart,
  page-outline and reader-mode, and the dark panel theme copied between the
  first two.

### 9. focus and keys

```js
s.focus.region(el);                    // temporary tabindex=-1, removed on blur or end()
s.focus.keepWhenRemoving(el);          // move focus to the nearest block before el goes
s.keys.shortcut({ code: 'KeyD', alt: true }, fn);
```

- **Config:** the shortcut's key `code` and modifiers.
- **Invariants:**
  - A shortcut is never taken from an editable target, with Ctrl or Meta
    held (AltGr, VoiceOver), or for a key on the reserved list.
    keyboard-nav's guards (header 3-12) become the default.
  - Smooth scrolling follows reduced motion. Only keyboard-nav does that
    today.
- **Replaces:**
  - the tabindex schemes in skip-links, page-outline, spa-focus,
    keyboard-nav, reading-spot, simplify-text and define-words;
  - the focus-keeping code in simplify-text (294-300) and define-words
    (476-489);
  - the Alt shortcuts in describe-on-demand, explore-a-chart and
    keyboard-nav.

### 10. text: reversible text transforms

```js
s.text.wrap(root, { match: /[A-Za-z]{8,}/g, build: word => span, cap: 500, skip: 'default' });
s.text.swap(root, { pieces: node => ..., apply: (node, newText) => ... });   // in place, translate-style
```

- **Config:** `match`, `build`, `cap`, `skip` (selectors added to the default
  skip list), and `rescanMs`.
- **Invariants:**
  - The original text nodes are put back, the same node objects.
  - Text is not changed in code, form fields, live regions, hidden content
    or our own UI.
  - Wrapped spans start from `all: unset`.
  - Rescans never react to their own writes.
- **Replaces:** `transformTextNodes`, which stays as the implementation, plus
  define-words' own walker (140-182) and translate-page's in-place swap.

### 11. ai.text: simplification and other text tasks

This is the block that needs the most new work, and the one where the
builder's config matters most.

```js
const out = await s.ai.text('simplify', paragraph.textContent, {
  context: heading.textContent,
  readingLevel: 'plain',          // plain | easy-read | the person's profile
  instructions: 'Keep the drug names exactly as written.',
  maxRatio: 1.5,
});
if (out) s.text.replaceBlock(paragraph, out, { showOriginal: true });
```

- **Tasks:** `simplify`, `summarize`, `define`, `translate`, `label`,
  `linkText`, `columnHeader`. These are today's methods in `tools/utils/ai.js`,
  under one shape.
- **Prompts (proposal).** Today the toolkit carries no prompts at all: hosts
  write their own (`ai.js:8-11`). The only concrete ones in the repository
  are the CLI's (`cli/ai4a11y/page.py:190-336`). Its simplify prompt cuts
  input to 2,000 characters while the adapter sends up to 10,000, and it
  addresses "someone with cognitive disabilities", against our own language
  rules. We propose:
  - **The toolkit supplies a default prompt per task**, versioned, written
    to the plain-language and social-model rules.
  - **The builder configures it in two ways:**
    - `instructions`: added guidance, such as "keep drug names", "explain
      in one sentence", "use British spelling";
    - `template`: a full replacement with named slots (`{text}`,
      `{context}`, `{readingLevel}`, `{targetLang}`).
  - Neither can remove the **output contract** (return only the text, no
    preamble) or the gates.
  - **The host runs the model** through one generic provider method,
    `complete({ system, prompt, maxTokens, signal })`. The per-task provider
    methods keep working; a host that supplies them overrides our prompt.
- **Config:**
  - `readingLevel`, `targetLang` and `audience`. These are personal, so
    they come from the profile first.
  - `instructions` and `template`.
  - `maxRatio` and `minRatio`: today 0.3-2 for simplify, at most 1 for
    a summary.
  - `maxInputChars`: today 100-10,000.
  - `budget`: calls per page. Today: links 10, tables 10, define 40,
    translate 40, charts 20.
  - `cache`: per page, shared across in-flight calls (define-words'
    memo).
- **Invariants:**
  - Every answer passes the gates in `ai-output.js` (refusal, uncertainty,
    ratio, length) before it reaches the page. Today the define answers,
    fix-contrast's colour and chart data are ungated.
  - A failed or rejected answer leaves the page as it was.
  - Late answers are dropped (session).
  - The person can always see the original: simplify-text's "Show
    original" becomes the default for `replaceBlock`.
- **Replaces:** the per-adapter AI pipelines in simplify-text, define-words,
  translate-page, fix-links, fix-tables, generate-labels and fix-contrast.

### 12. ai.vision

```js
const alt = await s.ai.vision('describe', el, { purpose: 'alt', maxChars: 150, instructions });
const data = await s.ai.vision('chart', el, { context });
```

- **Config:** as ai.text, plus `purpose` (alt, long description, chart) and
  `maxChars`.
- **Invariants:**
  - Gates: refusal, uncertainty, length. generate-alt has its own gate today,
    case-sensitive (flagged in its code).
  - The element is captured once. The SVG serialization is copied in
    generate-alt (110-114) and explore-a-chart (224-228).
- **Replaces:** the vision pipelines in generate-alt, describe-on-demand and
  explore-a-chart.

### 13. speech.out

```js
const r = s.speech.say(text, { rate: 'profile', voice: 'profile', chunkChars: 220,
                               onWord: (range) => hl.move(range) });
r.pause(); r.resume(); r.stop();
```

- **Config:**
  - `rate` and `voice`: personal, from the profile;
  - `chunkChars`: 220 today;
  - `presets`: read-aloud has slow, normal and fast;
  - `onWord` and `onChunk`, for highlighting;
  - `waitForGesture`.
- **Invariants:**
  - One voice at a time, page-wide. Two adapters never talk over each other.
  - Speech waits for the person's first click or key where the browser
    requires it (read-aloud 150-171).
  - Stopping is always possible with Escape.
  - Speech is never started by page changes alone.
- **Replaces:** read-aloud's engine (173-280). Word events are what the
  missing word highlighting needs (block 5).

### 14. speech.in

```js
s.speech.listen({ commands: { 'next heading': () => ..., 'click *': name => s.page.find(name)?.click() },
                  language: 'profile', feedback: 'toast' });
```

- **Config:** the `commands` table (phrase to action, with `*` for a name),
  `language`, `feedback`, and the backoff limits.
- **Invariants:**
  - A visible indicator shows that the microphone is on.
  - It stops after repeated errors with a message saying why.
  - A field's typed value is never its name. This was one of this week's
    fixes.
- **Replaces:** voice-commands' recogniser (112-192) and `findElementByText`
  (322-343).

### 15. media

```js
s.media.pause(video, { showControls: true });   // waits for a pending play(), resumes only what was playing
s.media.mute(el); s.media.captions(video, { lang: 'profile' });
```

- **Config:** `showControls`, `iframes` (YouTube and Vimeo via postMessage),
  and the captions `lang`.
- **Invariants:**
  - It never starts what the person paused. This week's high-severity
    motion-reducer bug was exactly this.
  - It never re-mutes what the person unmuted.
  - It never breaks the page's own `play()` promise.
- **Replaces:**
  - the pause routine copied in flash-guard (94-103), stop-auto-advance
    (45-55) and motion-reducer (408-416);
  - the three autoplay and controls ledgers;
  - the caption-track choice copied in show-captions and auto-transcriber.

## Example: what a builder writes

"Read the article aloud in plain language, highlighting each word" is three
blocks and no hand-written UI:

```js
export default {
  async enable(options, toolkit) {
    this.s = toolkit.session();
    const main = toolkit.page.main();
    const text = toolkit.page.readableText(main);
    const plain = await this.s.ai.text('simplify', text, { instructions: options.instructions });
    const hl = this.s.highlight.range(null, { color: 'auto' });
    this.s.speech.say(plain || text, { onWord: (range) => hl.move(range) });
  },
  disable() { this.s.end(); },
};
```

(Highlighting words of a simplified text that is not on the page needs it
shown first, with `s.text.replaceBlock`. That detail is what the block's
schema and examples teach the builder.)

## How the blocks reach adapters

- **Built-in adapters** would import them as ES modules from
  `toolkit/blocks/`, once the package boundary allows the catalog to import
  the toolkit (see "Not done yet"). `_primitives.js` and the shared parts of
  `tools/utils/` would move in, behind the same exports.
- **Agent-built adapters** get them on the `toolkit` argument. The runtime
  already builds `TOOLKIT` in two places, for installed adapters and for
  previews (`extension/runtime/scripts.js`). Both would add the blocks from
  the same code, vendored by `npm run build:extension`. The preview's
  verifier then checks the blocks as the person will get them.
- **AI from an agent-built adapter** goes through the service worker to the
  toolkit service. That is a new path: a `/v1/ai/<task>` route that applies
  the default prompt, the builder's `instructions`, the gates and a per-adapter
  budget, and calls the model with the service's key. The page never sees a
  key. This is a cost and abuse surface: budgets per account and per
  adapter, and a switch per account.
- **The builder agent learns them** from:
  - each block's JSON Schema, published in the registry next to the
    settings vocabulary;
  - a section in `agent-host/sandbox/AGENTS.md` and the `ai4a11y-toolkit`
    skill: "use a block where one exists; its invariants are why";
  - one worked example per block.
- **Skills** keep composing whole adapters. Blocks sit one level below
  skills, so this changes nothing for `SKILL.md`.

## Order of work

Each step ships on its own, with tests and the verifier specs:

1. **session, styles, announce, page.** This is the foundation. Move
   unpin-sticky, reading-ruler and page-outline onto them as the proof:
   small adapters with a ledger, a stylesheet and a panel. Their specs must
   pass unchanged.
2. **highlight and speech.out.** Rebuild read-aloud on them and give it the
   word highlighting it promises.
3. **ai.text**, with default prompts and `complete()`. Move simplify-text
   and define-words onto it. Fix the CLI prompt in passing.
4. **The runtime `toolkit` object and the builder's documentation.** From
   here, agent-built adapters can use blocks 1-6 and 10-11.
5. **tooltip, panel, focus and keys**, moving persistent-hover,
   define-words, describe-on-demand and explore-a-chart onto them.
6. **media and speech.in.**
7. **The `/v1/ai` route** for agent-built adapters, behind a per-account
   switch.

## Found along the way

These are not part of the proposal, but they are true today:

- `translate-page` reads `options.targetLang`, but the settings vocabulary's
  `translateTo` is never passed to it (`tools/profiles/settings.js:185`), so
  it always translates into English.
- `read-aloud`'s header promises word highlighting; there is none.
- The registry's dark-mode entry says it "respects prefers-color-scheme";
  no code reads it. The generate-captions entry describes "~15s chunks" and a
  blob notice. The code makes one call and writes evenly spaced cues.
- `focus-mode` and `visual-assist` are not idempotent on a second
  `enable()`.
- fix-links, fix-tables, generate-alt, generate-labels and wcag-fixes have
  no restore; their changes stay until the page reloads.

## Decisions

The project lead decided, 2026-11-03:

1. **The person's profile wins.** A builder's or adapter's value for a
   personal setting is only a default: speech rate, reading level, text
   size, reduced motion and contrast come from the profile when it has them.
2. **The toolkit supplies low-level prompts**, such as simplification, with
   customization fields, because a task like simplifying needs the
   builder's language, tone, style and relevant information. This reverses
   `ai.js`'s position that hosts write their own prompts.
3. **Agent-built adapters get AI through the service** (`/v1/ai`), with
   budgets.
4. **The blocks live in the toolkit** (`toolkit/blocks/`), the adapters the
   agent builds use them, and a skill documents them.

Choices made while building it (mine, open to change):

- Block config is its own vocabulary (`toolkit/blocks/catalog.js`), apart
  from the settings vocabulary: settings are the person's, block config is
  the builder's (a tooltip's delay, a panel's corner). Where the two overlap,
  they share the settings vocabulary's name (the project lead's decision):
  `speechRate`, `fontScale`, `motionReducer`, `contrastMode`, `darkMode`,
  `translateTo`, and the profile's `readingLevel`. The person's values reach
  the blocks as `personal` (`toolkit/blocks/personal.js`), derived by the web
  surface's own `deriveWebSettings`, and win over the builder's.
- The prompt fields are `readingLevel`, `language`, `tone`, `audience`,
  `context`, `keep`, `glossary`, `instructions`, `template`,
  `maxSentences`, `maxChars`, `purpose`, `minRatio` and `maxRatio`
  (`toolkit/blocks/ai/prompts.js`). No field can remove the fence around the
  page text or the output contract, and the gates always run.
- Limits: $200 of AI per account per day (the project lead's number,
  `AI_DAILY_BUDGET_USD`), priced from the tokens each response reports at
  the model's standard-tier rate, because the response carries token counts
  and no cost; 200 calls per adapter per day and 40 per adapter session
  (mine); an off switch per account (`PUT /v1/ai/settings`). What a page
  sends to `/v1/ai` is never logged.
- The gates stay in `tools/utils/ai-output.js`; the service imports them.
  The toolkit may not import the catalog, so a host that runs its own model
  imports the gates from there too.

## Browser settings, zoom and text size

Decided by the project lead, 2026-11-03:

- **Zoom is set through the Chrome DevTools Protocol.** CDP has no command
  for Chrome's own page zoom, and `Emulation.setPageScaleFactor` is pinch
  zoom (no reflow). `Emulation.setDeviceMetricsOverride` with the viewport
  divided by the zoom factor and the device scale factor multiplied by it
  is what browser zoom does to a page (checked: at 200% a 1280-pixel window
  gives `innerWidth` 640, `devicePixelRatio` 2, and the page's narrow-screen
  layout). The verifier and the CLI already drive pages over CDP.
- **No dyslexia font.** Its benefit is not shown, so no block offers it and
  the core set of adapters does not include it.
- **Zoom or text size is the person's or the developer's choice**, never
  both at once: changing both together does not work well, and the toolkit
  does not prescribe one. The developer sets a default method, the person's
  setting overrides it, and the block applies only the chosen one.

## What exists now

- `toolkit/blocks/`: the 15 blocks, `createBlocks()`, the catalog the skill
  reference is generated from, the prompts, and `personalFromProfile()`.
  Tests: `toolkit/test/blocks.test.mjs`.
- The browser runtime injects the blocks bundle (`extension/vendor/blocks.js`,
  built by `npm run build:extension`) before every adapter and every
  sidebar preview. `enable(options, toolkit)` gets `toolkit.session()`,
  `toolkit.page` and `toolkit.personal`. AI calls go through the service
  worker to `/v1/ai` with the person's token, which never reaches the page.
  Each sync reads the profile; a change to the personal settings rebuilds
  the scripts, so open pages pick it up.
- The service: `server/src/ai.js` (`POST /v1/ai/text`, `/v1/ai/vision`,
  `GET /v1/ai/usage`, `PUT /v1/ai/settings`). Tests: `server/test/ai.test.mjs`.
- The builder learns them from the skill's `reference/building-blocks.md`
  (generated from the catalog) and from `agent-host/sandbox/AGENTS.md`.

Not done yet:

- **The built-in adapters still use their own copies.** Moving them onto
  the blocks means the catalog (`tools/`) importing the toolkit, which the
  package boundaries forbid today (`scripts/import-boundaries-test.mjs`:
  "the catalog stands alone"). That needs a decision first. Order of work
  steps 1-3 and 5-6 (moving unpin-sticky, read-aloud, simplify-text and the
  rest) wait on it.
- The CLI's own prompts (`cli/ai4a11y/page.py`) are unchanged.
- The registry does not publish the blocks' schemas yet; the skill
  reference is where the builder reads them.
- The agent host image has to be rebuilt to carry the new skill reference,
  AGENTS.md and the bundle, and the extension reloaded.
