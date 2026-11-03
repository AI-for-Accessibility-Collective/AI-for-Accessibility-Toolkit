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
- `enable()` returns `false` when there is nothing to do on the page.
- `options` are the developer's defaults (document each one in the header
  comment); the person's own settings (`s.profile.get()`) win over them.
- The building blocks are listed, with every call, its config and what it
  always does, in the `ai4a11y-toolkit` skill's
  `reference/building-blocks.md`. **Read it first, all of it.** Use a block
  wherever one does what you need instead of writing your own. The source
  is in `toolkit/blocks/` if you need to know exactly what a call does; do
  not change it.
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
  **every site** in the extension's popup, not in your adapter. `set()`
  only works right after the person's own click or key on your UI or their
  shortcut; never call it on load.
- **No shortcuts of your own.** The toolkit has one pair of keys, which the
  person gives to one adapter in the extension's popup. If your adapter
  adjusts something, say what with `s.keys.adjust({ label, settings, up,
  down })`; when the person gives it the shortcut, its keys call `up()` and
  `down()`. Otherwise the toolkit's first key turns your adapter on and off
  by itself; do nothing for it.
- Say what changed with `s.announce(...)`, in plain words ("Text size 150%
  on this site.").
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
not in people.

Read the catalog adapters your brief lists under "prior work"
(`tools/adapters/`): they are older versions that handle real pages' edge
cases. Learn from them; do not import or copy their shared modules.

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

## Your report

Your last message is the report, in plain text, starting with one line:

    Outcome: verified | issues-left | could-not-verify

then:
- what the adapter does, in two sentences, what the shortcut adjusts in it (if anything), and its options;
- what you verified (the test page, the specs, the checks, the sites);
- each problem you found and fixed, with its evidence;
- what is left, with its evidence, and why you could not fix it;
- **Blocks:** what a building block lacked or got wrong, with evidence, for
  the toolkit to fix (or "none");
- what you could not verify, and why.
