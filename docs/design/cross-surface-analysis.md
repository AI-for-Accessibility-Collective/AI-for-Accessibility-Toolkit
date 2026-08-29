# Does the toolkit API support an adaptive XR interface?

A conceptual analysis, backed by an executable proof, of whether the
needs-model + surface-renderer architecture (`toolkit/core/ability.js`,
`toolkit/surfaces/*.js`) actually delivers what `docs/architecture.md`'s "XR
Agent (future direction)" section claims: onboard once, adapt everywhere. The
question this doc answers is the one the mission posed directly — does a
relevant change on web translate to XR, and does an XR-originated settings
update translate to mobile? The executable evidence is
`toolkit/test/cross-surface-translation-test.js`, driven entirely through the
public `createToolkit` SDK on in-memory ports (no Chrome, no LLM). At the time
of writing it passes 26/26.

## The architecture, in one paragraph

`librarian.getAbilityModel()` projects the stored profile into an
`AbilityModel` (`toolkit/core/ability.js#toAbilityModel`): a modality-neutral
`needs[]` array of `{ dimension, value, strength, unit?, source? }` entries —
`textSize: 1.6`, `darkTheme: true`, no CSS, no angular degrees, no OS setting
names. Each surface (`toolkit/surfaces/web.js`, `xr.js`, and now `mobile.js`)
is a **pure function** from this one model to its own device-appropriate
vocabulary: web gets `fontScale`/`darkMode`, XR gets angular text height and
world-locked captions, mobile gets Dynamic-Type-style `scalePercent` and
`touch.minTargetPt`. `web.js` doesn't even own its derivation — it delegates
to `platforms/chrome/web-surface.js#deriveWebSettings`, the single source of
truth for "what does this need render as on the web" — and the test asserts
that delegation is exact (`JSON.stringify` equality), not just similar.
Where a surface genuinely cannot represent a need, `createSurfaceAdapter`
(`toolkit/core/surface.js`) reports it as `unmet` rather than silently
dropping it — the "honest degradation" contract. This is what makes the
architecture *device-independent by construction*: adding `mobile.js` for
this task required zero changes to `ability.js`, `librarian.js`, or `web.js`
— a third surface is just a third pure function over the same model, which is
itself the strongest evidence the design generalizes past two surfaces.

## The translation chain the test proves

**WEB → XR.** The test writes a structured need the way a web host does today
— `librarian.setProfileField('fields.needs', [{dimension:'textSize',
value:1.6,...}, {dimension:'darkTheme', value:true,...}])`, the same
extract-free, LLM-free path `hosts/xr-demo/demo.js`'s onboarding step and
every `toolkit/test/*.js` fixture already uses. It then calls
`renderXRSettings(await librarian.getAbilityModel())` with **no XR-specific
code in the write path at all** and shows `text.angularSizeDeg` grew from the
neutral 0.35° to exactly `0.35 * 1.6`, and `ui.darkEnvironmentPreferred`
flipped from `false` to `true`. That is the whole claim: a relevant web
change reaches XR through the model alone.

**XR → MOBILE.** The test tries the mission's first-suggested path —
`librarian.recordScopedSettings('context:xr', {autoCaptions:true}, ...)` —
and confirms empirically that it does **not** reach the AbilityModel (see
Limits below). The path that does work today, and the one the test uses, is
**the cross-app grant + `importInsight` consent flow**, identical in shape to
`hosts/xr-demo/demo.js`'s "INSIGHT FLOWS BACK" step: `requestGrant` drafts a
proposal, `respondToProposal(id, 'accept')` on the local user surface mints
the grant (the requesting app can never self-resolve its own request), then
`importInsight('xr-host', {kind, change:{op:'profile-set',
path:'fields.needs', value:[...]}, rationale, confidence})` drafts a second
proposal that is asserted **not yet applied** before accept, and only
`respondToProposal` on that proposal applies it. After accept,
`renderMobileSettings(getAbilityModel())` shows `media.captions` and
`motion.reduceMotion` flip from `false` to `true`, and — because the XR
insight's `value` array had to carry the earlier web-set `textSize`/
`darkTheme` forward (`profile-set` replaces `fields.needs` wholesale; it does
not merge) — `text.scalePercent` still reads `160` and `display.darkMode`
still reads `true`, proving no data loss across the two hops. This consent
requirement is a **feature, not friction**: it is the same
sender-cannot-self-resolve, never-silent guarantee every cross-app write in
this codebase gets, and it is why `importInsight` was chosen over the
settings-writer paths — those bypass the AbilityModel entirely rather than
bypassing consent.

**Round-trip guard.** After the XR-originated accept, `renderWebSettings`
still reports the original `fontScale:160`/`darkMode:true` *and now also*
`autoCaptions:true`/`motionReducer:true` — the XR update is visible on web
too, unprompted. `resolveWebPreferences` (which composes the authoritative
`getEffectivePreferences` merge with the derived ability baseline) agrees,
and its `provenance` map is honest about which keys are the user's own
explicit choice versus which were filled in from the ability model
(`derived:ability`). One understanding, three renderings — literally the same
object graph, rendered three ways, agreeing with itself after two rounds of
cross-surface writes.

## What an XR host must implement

A conformer needs the four core ports in `toolkit/ports/index.js` —
`KVStore` (mirrors `chrome.storage.<area>`), `Clock`, `Scheduler`, and
`Consent` (at minimum `notifyPending`; a headset without a visual badge
should implement the optional `present`/`capture` pair for a TTS-prompt or
large-target dialog instead) — passed to `createToolkit`. That is sufficient
to read and write the AbilityModel and render `xr.js`'s output. Two more
pieces are XR-specific: the optional `Sensors` port (`read(kind)`, e.g.
`'fov.textSizeMultiplier'`) for measuring the person rather than asking them,
and an **actuation port** the toolkit does not define — some XR-runtime API
(OpenXR, a game engine's UI layer) that takes `renderXRSettings`'s output
(`text.worldHeightM`, `motion.comfortVignette`, `captions.placement`) and
actually resizes text meshes, applies a vignette, and world-locks a caption
panel. The toolkit's contract ends at "here is the number"; turning the
number into pixels/meters on a specific headset SDK is host code, same as it
is for `web.js`'s numbers becoming CSS today.

## Limits found while testing

1. **Settings vocabulary and needs vocabulary are two different writer paths,
   and only one crosses surfaces.** `WEB_DERIVATION` in
   `platforms/chrome/web-surface.js` maps `needs[] → settings` one way; there
   is no reverse. `recordExplicitSetting`/`recordScopedSettings` (the popup
   toggle path) write to memory-shard `settings` records that only
   `getEffectivePreferences` reads — `getAbilityModel()` never sees them,
   confirmed for both a plain web scope and an XR-labeled `context:xr` scope
   in the test. A production web (or XR) host that wants a raw setting toggle
   to also cross to other surfaces must explicitly also write the
   corresponding `fields.needs` entry, or route through `extract()`'s LLM
   pass, which does bridge raw observations into `profile-set` proposals but
   needs a Gemini caller wired in — not exercised here since the mission
   asked for an extract-free path.
2. **`profile-set` on `fields.needs` replaces, it does not merge.** Every
   cross-surface writer (`setProfileField`, an accepted `importInsight`) must
   round-trip the *entire* current needs array or silently wipe unrelated
   needs. The test's XR insight has to re-list `textSize`/`darkTheme` to
   avoid erasing them. A naive XR host that only knows its own delta (just
   "captions on") and doesn't first read the current model before writing
   would regress this exact way. A merge-aware write helper in `ability.js`
   would remove this footgun.
3. **`mobile.js` had to collapse several OS settings onto shared or
   borrowed needs dimensions**, the same way `xr.js` already does for
   `ui.largeTargets`: there is no `boldText` or `reduceTransparency`
   dimension, so both ride the single `contrast` need alongside
   `display.highContrast`; there is no touch-target-size dimension, so
   `touch.largeTargets`/`minTargetPt` reuse the `motor` support-area
   heuristic `xr.js` already established. This is a reasonable modeling
   choice (these OS settings are genuinely grouped for the same underlying
   need), but it means a person who wants *only* bold text without the wider
   contrast/transparency changes has no way to express that in the current
   needs vocabulary.
4. **Strength/precedence caveats.** Collisions on one dimension resolve
   floor > preference > hint, ties go to the later entry
   (`toolkit/core/strength.js#rankOf`, shared by `getEffectivePreferences`,
   `deriveWebSettings`, and `xr.js`) — so all three surfaces agree on one
   winner for the same `needs[]`, which the test's round-trip guard leans on.
   But an `importInsight`-sourced need is force-capped to `preference`
   strength on accept (`respondToProposal`'s `cross-app-insight` branch,
   `insrec.strength = 'preference'`) *only* for the `add-memory` sub-path —
   a `profile-set` insight (the one this test uses, and the one XR's FOV loop
   in `hosts/xr-demo/demo.js` uses) carries whatever strength the sending app
   wrote into the array, uncapped. A malicious or buggy cross-app sender
   could therefore write a `floor`-strength need that permanently outranks
   the user's own softer preference on every surface — worth closing before
   this leaves prototype scope.
5. **What a production XR host would still need beyond this test:** real FOV
   sensor calibration (the demo and this test both hardcode
   `fovDegrees`/`viewingDistanceM`; a real headset would read these from its
   runtime and feed a *measured* signal back through `importInsight`, not a
   constant); and a per-surface override layer (a `SurfaceProfile` a person
   could set to say "smaller text in XR specifically, even though I asked for
   larger everywhere else") — today one `needs[]` value renders identically
   scaled on every surface that reads it, with no per-surface exception
   mechanism.

## Conclusion

Yes: the needs-model + surface-renderer architecture supports adaptive XR
interfaces, and the mechanism generalizes — adding `mobile.js` as a third
surface required no core changes, only a new pure derivation function, which
is the architecture doing its job. The translation chain is real and
tested end-to-end in both directions asked about (web → XR, XR → mobile),
through the actual consent-gated public API, not a mocked shortcut. The
limits above are specific, fixable gaps in the current writer paths and
strength enforcement — not evidence the model is wrong — and are the concrete
punch list for hardening this past prototype scope.
