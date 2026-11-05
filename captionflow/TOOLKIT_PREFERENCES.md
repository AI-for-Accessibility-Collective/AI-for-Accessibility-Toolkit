# Toolkit preference adapter: first slice

**Prototype only:** Use synthetic profiles in a trusted, single-user host. Do
not integrate this adapter with real profiles yet. Direct Librarian access does
not check the toolkit's cross-app grants, sharing pause or audit boundary.

## Trust-boundary decision (2026-11-05)

**Option A + guard.** CaptionFlow is a trusted-host component: it runs inside a
host that already authenticated the user and reads/writes that user's profile
directly, with no per-request consent prompt. Full cross-app consent (Option B)
is deferred until this boundary has been exercised on synthetic data.

The guard: every call into `createToolkitPreferenceProvider` must declare
`actingUserId` (the host's current user, `null` for the toolkit's default
partition — never inferred). Internally the adapter calls `librarian.getActingUser()`
before each toolkit call and again immediately after the one `await` in that
operation, and refuses with `ActingUserMismatchError` if the toolkit's real
acting user doesn't match the declared one, or if the toolkit exposes no
`getActingUser()` at all. This stops a read or write from silently landing
under the wrong partition when the host hands over a stale or wrong user
context, or when the acting user changes mid-operation. It does **not**
enforce cross-app grants, the sharing pause, or any consent boundary — those
remain Option B's job, deferred.

Remaining, not fixed by this guard:

- Concurrent edits from a *different caller* writing the same profile at the
  same time can still be lost; the guard only covers the acting-user identity,
  not locking. A real host must still serialize profile edits or use a safe
  transactional API.

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
The setter reads the needs and then writes the whole array; the acting-user
guard (above) stops a user switch between those two steps from landing the
write under the wrong partition, but a second caller editing the same profile
at the same time can still lose an edit. No toolkit core was changed.
Investigate an upstream validation fix separately.

Run `node --test captionflow/tests/*.test.mjs` from the repository root.
The test creates a sample profile, sends it through the actual fixture pipeline,
reopens a toolkit instance against a shared in-memory KV, and explicitly
restores the previous empty needs. This is **not** an undo implementation or
proof of disk persistence: the host must supply an appropriate persistent KV.
It does not yet connect to a player, map other preferences, or handle the
CaptionFlow-specific settings. Real profiles and co-designer preferences have
not been used or validated. No profile data is sent to any AI provider.
