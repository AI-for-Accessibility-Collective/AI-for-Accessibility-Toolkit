# Toolkit preference adapter: first slice

**Prototype only:** Use synthetic profiles in a trusted, single-user host. Do
not integrate this adapter with real profiles yet. Direct Librarian access does
not check the toolkit's cross-app grants, sharing pause or audit boundary. The
setter reads and later writes the active profile; an acting-user switch between
those steps can copy or overwrite another person's needs. Concurrent profile
edits can also be lost. A real host must enforce the correct consent boundary
and serialize both profile edits and user switches, or use a safe transactional
API; this prototype does neither.

Text size is stored as a shared, modality-neutral toolkit need, so a change may
also affect other surfaces. Whether a CaptionFlow-only control should propagate
this way requires an explicit product and consent decision.

`src/toolkit-preferences.mjs` implements the `getPreferences({videoId, sourceLanguage})`
provider seam. Pass it the Librarian from `createToolkit({ kv })`. It reads
`getAbilityModel()` and maps the neutral `textSize` ratio to CaptionFlow's
`fontScale` ratio. With no textSize need it returns an empty object, so the
pipeline's contract supplies its defaults. When needs conflict it uses the
same strength ordering as the toolkit (`floor > preference > hint`; latest
wins on equal strength). An unsupported unit that survives toolkit normalization
or a non-finite/out-of-range value fails rather than silently changing it.

`provider.setTextSize({ value, unit })` is an explicit user-choice write, not
an AI-inferred edit. It validates a finite ratio in 0.8–2.5 before writing;
an omitted unit means a ratio, while any explicitly supplied non-ratio unit
is rejected. It keeps needs from other sources and replaces only previous
non-floor CaptionFlow text-size entries. A stronger floor may still win, so
read `getPreferences()` to see the effective value. Callers must use this
method for CaptionFlow edits; directly calling Librarian bypasses validation.

**Existing/imported profile limitation:** `getAbilityModel()` strips
unrecognised unit tags. This adapter cannot distinguish a stripped invalid unit
from a genuinely omitted unit, which the toolkit documents as a ratio. Validation
of CaptionFlow writes does not repair or validate profiles created elsewhere.
The setter reads the needs and then writes the whole array, so concurrent edits
can be lost; use only when the host serializes profile edits. No toolkit core was
changed. Investigate an upstream validation fix separately.

Run `node --test captionflow/tests/*.test.mjs` from the repository root.
The test creates a sample profile, sends it through the actual fixture pipeline,
reopens a toolkit instance against a shared in-memory KV, and explicitly
restores the previous empty needs. This is **not** an undo implementation or
proof of disk persistence: the host must supply an appropriate persistent KV.
It does not yet connect to a player, map other preferences, or handle the
CaptionFlow-specific settings. Real profiles and co-designer preferences have
not been used or validated. No profile data is sent to any AI provider.
