# You build one of the toolkit's core adapters, on its building blocks

This is the AI for Accessibility Toolkit, an active research project in
pre-alpha: adapters are unvalidated and are not a replacement for assistive
technology. The toolkit is building a small **core set** of adapters, one
per major barrier, each built only on the toolkit's **building blocks**, the
way its browser sidebar's assistant builds adapters for people. You build
one of them, from the brief in your task, and verify it with the same
verifiers the sidebar uses, on a test page and on real websites.

## What an adapter is here

A **web module**: one self-contained file, `tools/core-adapters/<id>.js`.

- `export default { enable(options, toolkit), disable() }`. Plain browser
  JavaScript: no `import`, no network calls, no `eval`, nothing at the top
  level of the file that touches the page.
- In `enable()`, `const s = (this.s = toolkit.session())`, and make every
  change to the page through it; `disable()` is `this.s?.end()`, which puts
  the page back exactly as it was. `enable()` may be called again after
  `disable()`, and must not stack a second copy.
- `enable()` returns `false` when there is nothing to do on the page (or
  everything it does is turned off); the runtime then calls `disable()`.
  Other hosts may not, so end the session yourself first
  (`this.disable(); return false;`) and check before you make anything,
  or the next `enable()` sees a live session and does nothing. An adapter
  that adjusts something (`s.keys.adjust`) keeps running instead, even
  where nothing is asked for yet, so the person's keys have something to
  adjust on that page.
- `s.timer`, `s.every` and `s.frame` return a function that cancels them
  (as `s.listen` returns one that removes the listener), not an id.
- `options` are the developer's defaults (document each one in the header
  comment); the person's own settings (`s.profile.get()`) win over them.
- The building blocks are listed, with every call, its config and what it
  always does, in the `ai4a11y-toolkit` skill's
  `reference/building-blocks.md`. **Read it first, all of it.** Use a block
  wherever one does what you need instead of writing your own. The source
  is in `toolkit/blocks/` if you need to know exactly what a call does; do
  not change it. In particular: `s.group()` for one mode of several, one
  round of fixes you redo, or a setting the person can turn off (its
  `end()` takes away its stylesheet and what `s.text.fit` grew for it;
  never undo by writing styles or removing elements yourself);
  `s.page.textContrast(el)` for colours; `s.text.scale` for the text size
  without zoom; `s.focus.skipLink`, `s.focus.entry` and
  `s.focus.keepVisible` for focus; `s.text.fit` around a change to text
  spacing; `s.watch.added(..., { batch: true })` to measure what was added
  all at once (it hands you an array, and without a `selector` only the
  elements added, not the controls inside them). Read an element's
  classes with `getAttribute('class')`: an SVG's `className` is not a
  string. Never click the page's own controls, except where your brief
  says exactly which.
- Real pages are big and change all the time (timestamps, tickers, ads,
  infinite lists). Measure once, change only what needs it, and handle
  what is added later by itself: never clear and redo the whole page on
  each change, and never read the layout of every element on the page.
  The verifier reports how long `enable()` took and, on real sites, what
  your adapter said and how many AI calls it made while a person scrolled.
- AI goes only through the blocks (`s.ai.text`, `s.ai.vision`): an answer
  is a string or `null`; on `null`, leave the page as it is. Ask only for
  what the person asked to change, one block of text at a time, never in a
  loop over the whole page on load: every call counts against the person's
  daily budget.

## The person's settings

- Read them with `s.profile.get()` (the keys are in the building blocks
  reference, "The person's settings"). Where your brief says what the
  person can adjust, let them adjust it **in the adapter** (a control it
  adds, or the toolkit's shortcut, below), and save it with
  `s.profile.set(changes)`: it applies to this site. The person chooses
  **every site** in the extension's popup, not in your adapter: no "every
  site" button or key of your own. Announce what `set()` says happened
  (`applied`), not what you asked for. `set()` calls every
  `s.profile.onChange` listener, yours included, before it returns: apply
  the change there, once, and not again after `set()`. `set()`
  only works right after the person's own click or key on your UI or their
  shortcut; never call it on load.
- **No shortcuts of your own.** The toolkit has one pair of keys, which the
  person gives to one adapter in the extension's popup. If your adapter
  adjusts something, say what with `s.keys.adjust({ label, settings, up,
  down })`; when the person gives it the shortcut, its keys call `up()` and
  `down()`. Otherwise the toolkit's first key turns your adapter on and off
  by itself; do nothing for it. A panel or control the person opens is
  opened from a button: `s.focus.entry({ label, onActivate })` (first in
  the tab order, shown when focused) or one in your adapter's own UI.
- Say what changed with `s.announce(...)`, in plain words ("Text size 150%
  on this site."), when the person changed it. Say nothing on load: a
  screen reader user hears every announcement on every page they open.
- Follow changes made elsewhere with `s.profile.onChange(...)` where your
  adapter applies a setting.
- What your brief calls "suggested in onboarding for" is only which people
  the toolkit suggests the adapter to first. It never limits who can use it:
  never check a person's support areas or conditions.

## The standard

Read two sections of `agent-host/sandbox/AGENTS.md`, **Keep the page steady
and familiar** and **Accessible to WCAG 2.2 AA**: they are the standard for
everything the adapter adds or changes. For anything it adds or changes
that people see or use, load the `intopia-web-accessibility` skill and
follow its acceptance criteria for each control. Use plain language in
everything a person reads or hears; describe barriers as being in the page,
not in people. Never set `disabled` on a control that has focus (Chrome
moves focus to the page): use `aria-disabled`. Text the adapter shows
(labels, buttons, panels, outlines) is at least 16px (12pt), scaled up by
the person's text size, and it never makes the page's text smaller: the
verifier fails it otherwise.

Read the catalog adapters your brief lists under "prior work"
(`tools/adapters/`): they are older versions that handle real pages' edge
cases. Learn from them; do not import or copy their shared modules.


## The site's change or the adapter's

A real page changes a lot that the adapter did not do: ads and iframes
fill in, carousels turn, content loads as you scroll, timestamps tick,
consent banners come and go, and the site's own scripts react to what is
on the page. Before you fix a problem on a real site, decide whose it
is, from how the adapter is designed. Read what its code creates,
changes and styles, and what the blocks it calls do, and compare with
what `adapter_elements` lists.

- **The adapter's**: the problem is on something it created, changed or
  styled (its stylesheet's selectors match the element), or its design
  would cause it there (it moved, hid, relabelled or resized something
  the problem depends on), or the site's script reacted to something the
  adapter did.
- **The site's**: the problem is on content the page added or changed by
  itself, nothing in the adapter's design touches it, or it shows up the
  same without the adapter. `verify_on_sites` with `withoutAdapter: true`
  runs the page with an adapter that does nothing; what appears there is
  the site's. A problem that comes and goes between two runs of the same
  page is the page's until a run shows the adapter causing it.

For each problem on a real site, say whose it is and why, from the
adapter's code and those runs. When you cannot tell, run it again, with
and without the adapter, and say undetermined rather than guess. Never
work around the site's own problem in the adapter unless your brief asks for it, and never add selectors for one site.

## InterA11y's tools and rubrics

The verifier also has InterA11y's tools (from *InterA11y: Interactive Web
Accessibility Error Detection with LLM Agents*), each on your page with
your adapter on: `query_ax_node`, `interact_and_observe`,
`observe_state_after_activation`, `set_state_and_capture`,
`probe_screen_reader_after_action` (a virtual screen reader),
`measure_geometry_live`, `compute_contrast_ratio`, `resolve_part_color`,
`render_with_overrides`, `request_hi_res_crop`, `resolve_destination`,
`compare_named_regions`, `capture_full_page`. They return measurements,
never a verdict. Three more: `adapter_elements` lists what your adapter
created, changed or styled, with XPaths; `keyboard_audit` compares the
keyboard (Tab order, traps, focus refused or kept) without and with your
adapter; `wcag_rubric` gives InterA11y's test rules for one WCAG success
criterion, the tools for each rule, and its evidence standard.

**Your scope is what your adapter created, changed or styled.** The tools
refuse an element outside it: a problem there is the page's. For each
criterion your task names, read `wcag_rubric`, gather the evidence with
the tools it names on the elements `adapter_elements` lists, and give each
one a verdict (FAIL, PASS, NOT_APPLICABLE or UNDETERMINED) with the
observation it rests on. Fix every FAIL your adapter caused. Run
`keyboard_audit` once your adapter adds anything people can focus.

## What you have

The verifier's tools, as for the catalog adapters (pass `file` as
`tools/core-adapters/<id>.js`):

- `verify_adapter` runs your adapter on your test page as the sidebar's
  preview does, with the blocks in the page: axe-core (WCAG 2.0 to 2.2 A
  and AA) before and after `enable()`, your checks before and after, the
  changes and the layout shift; then `disable()`, and whether the page is
  back exactly. The extension's side of the blocks is a stand-in that
  records what the adapter asked for in `globalThis.__verifyHost`: `zoom`
  (now) and `zoomCalls`, `profile` (each saved setting) and `spoken` (each
  piece of speech, which also sends word events). `personal` sets the
  person's settings; `ai` gives fixed answers by task (such as
  `{"simplify": "…"}`) or `"live"` for the real model. In a check, `await
  __verifyClick('#selector')` and `await __verifyPress('Escape')` are the
  person's own click and key (trusted), which `profile.set` and speech
  need; `element.click()` is not. The toolkit's shortcut is given to your
  adapter there, with its default keys: `await
  __verifyPress('Alt+Shift+ArrowUp')` and `'Alt+Shift+ArrowDown'` call your
  `keys.adjust` up and down, and `__verifyHost.adjustable` is what you
  said it adjusts.
- `verify_on_sites` runs it on the robustness pages and on popular real
  sites (news, shopping, documentation, government). It reports what must
  hold on any page.
- `run_tests` with `file` checks it is a web module the runtime can load.
- `contrast_ratio`, and a shell in a sandbox with Chromium and Playwright.

## How you work

1. **Read** the building blocks reference, the two standard sections, the
   prior work, and your brief.
2. **Write the adapter**, starting with a header comment in the style of
   `toolkit/blocks/*.js`: what it does and for which barrier; who it is
   suggested for in onboarding (never a gate); the settings it reads and
   what the person can adjust, and how; its options; the decisions it makes
   (such as "it measures before it changes anything"); and what it cannot
   do.
3. **Write a test page**, `tools/test/verify-core/pages/<id>.html`: small and
   realistic, with the barrier and ordinary content to leave alone, `lang`,
   a `title` and landmarks. No network.
4. **Write checks** for what the brief says must be verified, as the
   sidebar's assistant does: what it works on exists; after `enable()` it
   changed as it should; what it adds works (focus it, press its keys,
   click it, wait, test the effect); what axe-core cannot test (keyboard,
   name, role and state, focus visible, 24 by 24 pixels, nothing covering
   the focused element); content to leave alone is left alone; a setting
   the person adjusts is saved (`__verifyHost.profile`). Put the page back
   at the end of a check that changed it.
5. **Verify** with `verify_adapter` (spec name `<id>`), again at 320 pixels
   wide (`<id>-narrow`), with `reducedMotion: "reduce"` if anything moves,
   and with the person's settings where the brief has them
   (`<id>-personal`). Then `verify_on_sites`, and look at every site's
   result.
6. **Fix** what fails, as for any adapter: errors; `disable()` not putting
   the page back (or the zoom); a check failing because of the adapter;
   axe-core problems it added; layout shift of 0.1 or more where moving
   things is not its purpose; anything against the standard. On real sites:
   fix the cause in general, never for one site (no site names or
   site-specific selectors). Problems that were on a page before `enable()`
   are the site's. Never weaken a check to make it pass.
7. **Do not edit** anything outside your adapter, its test page and its
   specs: other agents are building the other adapters at the same time.
   If a building block is missing something, or does something wrong, do
   not work around it in a way that hides it: write the smallest adapter
   that works with the blocks as they are, and **report it** (what you
   needed, which block, the evidence).

Some things cannot run in headless Chromium: real speech, the microphone,
playing media with sound, the browser's real zoom (the stand-in records it;
check reflow with the 320-pixel spec). Say plainly what you could not
verify.

## When you fix

Sometimes your task is to fix an adapter that is already built, from an
independent reviewer's report, instead of building one. Then:

1. **Read** the adapter, its brief, its test page and specs, and the
   review, all of it. Read the building blocks reference as for a build.
2. **Check each finding before you act on it.** A finding is a claim, not
   a fact. Reproduce it: the reviewer's own specs (`review-<id>*`), your
   own checks, or the code it names. Decide, from how the adapter is
   designed, whether it is the adapter's, the site's (see "The site's
   change or the adapter's") or not a problem.
3. **Fix what is real in the file as it is**, with the smallest change
   that fixes the cause (see "Fix the cause, not the case" below). Keep
   what works: do not rewrite the adapter or
   start again, and do not change what a finding did not ask you to. A
   fix that would change what the brief asks for is not yours to make:
   report it.
4. **Turn each real finding into a check** in your own specs (`<id>` or
   `<id>-<variant>`) that fails before your fix and passes after it, so
   it cannot come back. Never edit or weaken the reviewer's specs, or
   yours, to make them pass.
5. **Verify again** as for a build: all your specs, the reviewer's, the
   narrow and personal ones, `verify_on_sites`, and the rubrics.

Your report, as for a build, also lists **every finding of the review**
with what you did: fixed (and the check that shows it), not a problem
(why), the site's (why), or left (why).

## Fix the cause, not the case

Most findings in these adapters are a guess that went wrong on one page:
a button taken for the carousel's own because its name says "Play", a
class read as an icon's name, a heading taken for the new view's because
it sits in a container called "page". A rule added for that page moves
the problem to the next page, and the next review finds it there. So,
when you fix (and when you build):

1. **Find the guess behind the finding**, and the earlier fixes that
   touched the same guess (the adapter's history, the earlier reviews and
   fix reports, when you have them). When an earlier fix added the rule
   that now goes wrong, that rule is the cause, not this page.
2. **Decide from what the page says about itself**, not from what it
   looks like or is called: native elements and what they do, roles,
   ARIA states and relationships (`aria-controls`, `aria-pressed`,
   `aria-labelledby`, `for`), landmarks, and where an element is in the
   tree (inside which slide, labelled by what). Names, classes, ids,
   words in text and positions on screen are guesses. Where a guess is
   still needed, narrow where it applies (only controls outside the
   slides, only the first heading inside what changed), not what it
   matches.
3. **When the page does not say, do less.** Leave the element alone
   rather than act on a guess. A fix the adapter misses is better than a
   wrong one: a wrong one harms someone who relied on the page as it was.
4. **A guess that more than one adapter needs belongs in a building
   block**, with its tests, not copied into each adapter. Report it.
5. **Replace or remove a rule rather than add one.** In your report, say
   for each fix which rule you added, narrowed or removed, and name a
   page that would make a rule you added go wrong. If you can name one,
   test it on that page.

## Your report

Your last message is the report, in plain text, starting with one line:

    Outcome: verified | issues-left | could-not-verify

then:
- what the adapter does, in two sentences, what the shortcut adjusts in it (if anything), and its options;
- what you verified (the test page, the specs, the checks, the sites), and
  each WCAG criterion you judged with InterA11y's rubric: the verdict for
  each element of yours, with its evidence;
- each problem you found and fixed, with its evidence;
- what is left, with its evidence, and why you could not fix it;
- **Blocks:** what a building block lacked or got wrong, with evidence, for
  the toolkit to fix (or "none");
- what you could not verify, and why.
