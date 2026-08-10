# AA cross-app protocol (v1)

Gap 3's language-neutral half: the wire shapes the toolkit's cross-app sync
layer (`toolkit/sync/`) actually produces and consumes, written down as
versioned JSON Schemas so a **non-JS** conformer (Swift, C#, Kotlin, …) can
implement the same contract without reading the engine source. The JS engine
remains the source of truth — these schemas describe its real behavior
(and are checked against it by `toolkit/test/protocol-conformance-test.js`),
they don't define new behavior of their own.

Everything here is prototype-scope, matching `toolkit/sync/grants.js`'s
posture: the threat model is **mistakes, not malice** (every consumer app is
first-party / a collaborator's), so there is no signing, no encryption, no
schema-version negotiation beyond a hard `kind`/`v` handshake. See
`docs/toolkit-refactor-plan.md` §6 [product-hardening] for what's
deliberately out of scope.

## The 3 message types

| # | Schema | `kind` | version | Produced by | Consumed by |
|---|---|---|---|---|---|
| 1 | [`profile-blob.schema.json`](./profile-blob.schema.json) | `aa-profile-blob` | `v: 1` | `toolkit/sync/blob.js#buildProfileBlob`, called from `librarian.exportProfileBlob()` | `librarian.importProfileBlob()`, or a reader app that only reads `.abilityModel` (ArtInsight) |
| 2 | [`insight-outbox.schema.json`](./insight-outbox.schema.json) | `aa-insight-outbox` | `v: 1` (documented; not yet enforced — see caveat below) | A consumer app (ArtInsight's `ToolkitStore.buildOutbox`) | `librarian.importInsightOutbox()` |
| 3 | [`transport-envelope.schema.json`](./transport-envelope.schema.json) | *(none — version-only handshake)* | `v: 1` (`ENVELOPE_VERSION`) | `toolkit/sync/transport.js#createSharedTransport` — both `publishExports` (export flavor) and `postInsight` (inbox-entry flavor) | `readExport(appId)` / `drainInbox(librarian)` |

**1. Profile blob** — the user-mediated transport (§6 "transport (b)" in the
refactor plan). The user deliberately exports a portable JSON document on one
device/app and imports it on another — e.g. web extension → ArtInsight, or
web ⇄ XR. Carries the full `AbilityModel` (unfiltered by any grant scope —
this is the ONE path that hands over the whole modality-neutral
understanding) plus the ability-model *source* fields for merge. Never
carries memories, grants, proposals, or any device-local `SurfaceProfile`
(web `fontScale`, XR angular height, …). The export button **is** the
consent; import is a plain last-write-wins merge keyed on `exportedAt` vs.
the local profile's `updatedAt`.

**2. Insight outbox** — the return path (§6 "transport (b)", increment 7). A
consumer app that learned something (ArtInsight noticing the user keeps
asking for more detail) batches it as insights the user carries home. Each
insight in the batch still goes through the exact same grant-gated,
never-silent `importInsight` path as a live cross-app insight — the outbox
is only a transport, it grants nothing and applies nothing by itself. An app
with no active grant gets every insight in its batch refused
(`reason: 'no-grant'`).

**3. Transport envelope** — the local shared-store transport (§6 "transport
(a)"): same device, multiple apps, zero accounts, live (no user action per
sync). One physical store (a shared file, an iOS app-group container, a
native bridge) carries two envelope *flavors* under the same version number:
- **export flavor** (`aa.shared.export.<appId>`, written by
  `publishExports`, read by `readExport(appId)`): the scope-filtered
  `AbilityModel` slice a granted app may see. Revoking the grant, pausing
  sharing, or the audience ceiling dropping below the grant's audience all
  **retract** this key on the next publish — it is deleted, not just stale.
- **inbox-entry flavor** (appended to the array at `aa.shared.inbox` by
  `postInsight`, consumed by `drainInbox`): one posted insight, same shape as
  an `insight-outbox` entry, tagged with its source app and post time.

The schema validates the union of both flavors' fields (see the "Validator
subset" caveat below) — check which of `appId`/`abilityModel` vs.
`sourceAppId`/`insight` are present to know which flavor you're holding.

## The grant scope whitelist

Only these four scopes exist (`toolkit/sync/grants.js#GRANT_SCOPES`) — a
CLOSED list, not an open string. `requestGrant`/`validateScopes` reject
anything outside it:

- `ability.categories` — coarse support-area labels (vision / hearing /
  motor / cognitive), never a diagnosis.
- `reading.level` — the reading-level hint.
- `language` — `'standard'` or `'plain'`.
- `settings.text` — structured, modality-**neutral** display needs
  (`needs[]`) — never a web `fontScale` or any other `SurfaceProfile` value.

Each scope unlocks a disjoint slice of the `AbilityModel`
(`filterAbilityModelByScopes`). `freeText` and `confidence` are **never**
exported through a grant, at any scope — only the user-mediated profile
blob (message type 1) carries them, because exporting *that* is a
deliberate, whole-document user action, not a live per-scope grant.

Scopes only gate the **live, grant-based** paths (transport-envelope export
+ `exportAbilityModel`). They do **not** gate the profile blob — that
document always carries the full `AbilityModel`, because the user
themselves chose to export it.

## Versioning

Each message type has its own independent `v` — there is no single global
protocol version. Bumping a message type's version is a breaking change for
that type only: `validateProfileBlob` and `readExport`/the datastore both
hard-reject a `kind`/`v` mismatch (`kind !== BLOB_KIND || v !== BLOB_VERSION`
for the blob; `env.v !== ENVELOPE_VERSION` for a transport envelope) rather
than attempt a best-effort read of a document from a version they don't
understand. A future v2 of any one type ships as a new schema file
(`profile-blob.v2.schema.json`) alongside v1, not an in-place edit — old
conformers keep working against v1 documents until they choose to upgrade.

**Known caveat:** `librarian.importInsightOutbox` currently checks
`kind === 'aa-insight-outbox'` but does **not** check `v`. The schema here
documents `v: 1` as the intended protocol version regardless — a native
conformer should still stamp `v: 1` (ArtInsight's `ToolkitOutbox.version`
does) so the field is meaningful once the engine starts enforcing it. This
is a known, minor loose end, not a deliberate design choice.

## Validator subset (why there's no `oneOf`)

`toolkit/test/protocol-conformance-test.js` validates against these schemas
with a small, dependency-free validator (no ajv, no npm package) that
supports exactly: `type` (string or array), `required`, `const`, `enum`,
`properties`, `items`, `additionalProperties`. It deliberately does **not**
implement `oneOf`/`anyOf`/`$ref`/`pattern`/numeric bounds. That's why
`transport-envelope.schema.json` is written as one shape covering the union
of both flavors' fields (all optional except `v`) rather than two
discriminated variants — a full JSON Schema validator (ajv, or a native
platform's schema library) can express the discriminated-union version more
precisely if you want stricter validation than this repo's test needs.

## How a native (Swift/C#/Kotlin) conformer implements this

1. **Model the 3 shapes as native Codable/serializable types**, field-for-field
   against the schemas here — see
   `Mixed-Ability-Artwork/Mixed-Ability-Artwork/Toolkit/ToolkitProfile.swift`
   (`ToolkitProfileBlob`, `ToolkitAbilityModel`, `ToolkitNeed`) and
   `ToolkitStore.swift` (`ToolkitOutbox`, `ToolkitInsight`) for a worked
   example. Use a permissive "unknown scalar" box (Swift's `AnyToolkitValue`
   enum: number/string/bool/null) for fields the engine treats as
   dimension-interpreted rather than statically typed (`need.value`,
   `readingLevel`).
2. **Check `kind` and `v` before trusting anything else** — exactly what
   `validateProfileBlob` does, and what a conformer's own "handshake" check
   should mirror (`ToolkitProfileBlob.isValid` in the Swift conformer).
   Reject silently-wrong-shape documents rather than partially decoding them.
3. **Only encode the fields the schema declares.** `additionalProperties:
   false` in these schemas means a conformer's own JSON output must not leak
   extra fields either — e.g. a native `Identifiable` wrapper type's local
   `id` must be excluded from the wire encoding (Swift: give the type
   explicit `CodingKeys` that omit `id`), or a strict validator on the JS
   side would reject a document a real conformer produced.
4. **Never enforce a grant scope you don't have the whitelist for.** A
   conformer that only ever *reads* a user-mediated profile blob (message
   type 1) doesn't need `GRANT_SCOPES` at all — that path is ungated by
   design. A conformer that participates in the *live* transport (message
   type 3, or requests a grant itself) must use exactly the four scope
   strings above, verbatim — an unrecognized scope string is silently
   dropped by `filterAbilityModelByScopes`, not an error, so a typo fails
   quiet rather than loud.
5. **Writes are always a proposal, never a direct write.** A conformer that
   *contributes* insights (outbox or live inbox) must not assume anything it
   sends gets applied — the toolkit core turns every inbound insight into a
   consent-gated proposal the person accepts or declines on their own
   surface. A conformer's UI copy should say so (see
   `ToolkitSettingsView.swift`'s "Nothing is applied until you approve it
   there.").
6. **Validate what you decode where you can afford to.** These JSON Schemas
   are the executable-by-humans spec; a conformer isn't required to run a
   general JSON Schema validator at runtime (Swift's `Codable` decode
   failure already rejects a malformed document), but should keep its native
   types in lockstep with the schemas here as the protocol version bumps.

## Files

- `profile-blob.schema.json`, `insight-outbox.schema.json`,
  `transport-envelope.schema.json` — the schemas.
- `fixtures/*.valid.json`, `fixtures/*.invalid.json` — worked examples,
  adapted from `toolkit/test/phase3-crossapp.test.mjs`'s real scenario data.
  Invalid fixtures are `[{ name, doc }, …]` arrays; each `name` states the
  one rule it breaks.
- `../test/protocol-conformance-test.js` — validates (a) real engine output
  against these schemas and (b) every fixture passes/fails as claimed.
