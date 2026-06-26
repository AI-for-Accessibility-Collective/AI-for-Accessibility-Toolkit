# Refactor plan: extracting the personal‑memory core into the **Toolkit**

**Status:** proposal for review · **Date:** 2026‑06‑26
**Scope:** lift the Librarian / ability‑profile / memory‑agent subsystem out of
`personalized-extension/` into a standalone, app‑agnostic module ("the Toolkit")
that the Chrome extension, an XR app, ArtInsight, and mobile adaptations can all
build on — with permission‑guarded flow of understanding *between* those apps.

> **Scope: research prototype.** Safeguards are sized to protect study participants
> and keep the demo honest — *not* for regulatory compliance or adversarial
> multi‑party security. See
> [toolkit-adversarial-analysis.md §1a](./toolkit-adversarial-analysis.md) for the
> threat model and the keep/simplify/defer re‑rating this plan now reflects.
> Anything tagged **[product‑hardening]** is real but deliberately deferred.

---

## 1. Why now / what we're really building

Today the subsystem that *understands the user* — their abilities, preferences,
learned routines — is welded to one Chrome extension. The asks from the XR
conversation ("I wish I had this information about the person to make this app",
"insights from XR ⇄ webpages", "measure the field of view and then use it for
text size") all point at the same missing thing: **a portable understanding of
the person that any accessibility app can read from and contribute to, without
re‑interviewing the user and without leaking what shouldn't leak.**

So this is not just a code move. It is three things:

1. **Extract** the existing engine cleanly behind stable interfaces (mechanical, low‑risk — the bones are already good).
2. **Generalize** the *ability model* away from web‑only settings so XR/iOS/mobile can render the same understanding differently.
3. **Add** a *lightweight* cross‑app sharing + consent layer that does not exist yet — the genuinely new work (full identity/security is **[product‑hardening]**, not now).

The good news from the audit: two of the three hard seams are **already in the
code**. The LLM is injected (`Librarian.setGeminiCaller(fn)`,
[background.js:381](../personalized-extension/extension/background.js#L381)) and
storage already routes through a catalog facade
([datastore.js](../personalized-extension/extension/lib/datastore.js)) whose
entire design goal is "a store can be moved … with one catalog edit." We are
widening seams that already exist, not cutting new ones from scratch.

---

## 2. What exists today (audit summary)

The engine is the **Librarian**
([librarian.js](../personalized-extension/extension/lib/librarian.js), ~48 KB),
sole writer of its stores, with two lanes:

- **Fast lane (deterministic, ms, every page load):** `getProfile`,
  `getEffectivePreferences` (scope‑chain merge), `recall`, `recordExplicitSetting`,
  `recordScopedSettings`, `getSiteCategory`, `logObservation`, `respondToProposal`.
- **Slow lane (LLM, eventually consistent):** `extract` (episodic log → facts/
  proposals via ADD/UPDATE/SUPERSEDE/NOOP, cursor‑based), `reflect` (promotion,
  expiry, view rendering — the daily "dream").

Memory is sharded by a **scope chain** `general → context:* → category:* →
origin:*`, merged by specificity with a **provenance** map so the popup can
write a changed value back to the scope it came from. A **privacy floor** drops
observations on no‑memory categories (finance/health/government), paused
origins, or when globally paused.

Storage lives behind the **Datastore** catalog (logical name → `chrome.storage`
area+key+version). The **Global** tier (read‑only, shipped: taxonomy +
tools‑registry + builtin skills) is separated from the **Mine** tier (the user's
own data).

### What's portable already
- Datastore catalog facade (storage seam).
- `setGeminiCaller` injection (LLM seam).
- Single‑writer discipline, scope/merge logic, scoring (recency×importance×confidence), proposal gating — **all pure logic, no DOM**.

### What's welded to Chrome (must move behind ports)
| Coupling | Where | Port it becomes |
|---|---|---|
| `chrome.storage.local/sync` | datastore.js backend | **KVStore** |
| `chrome.alarms` (30‑min extract, 24‑h reflect) | background.js:1004‑1011 | **Scheduler** |
| `chrome.action` badge (pending‑proposal count) | librarian.js ~L998 | **Consent** (accessible proposal channel) |
| `chrome.storage.sync` API key | background.js:207 | **SecretStore** |
| `chrome.runtime.sendMessage` routing | background.js dispatcher L974‑1021 | **Transport** (host‑owned) |
| `Date.now()` everywhere | core | **Clock** (also unblocks deterministic tests) |
| `importScripts` + `globalThis.Librarian` | load mechanism | ES‑module core + thin Chrome shim |

### What's web‑shaped in the *data* (must generalize)
The ability profile blends a modality‑agnostic understanding (support areas,
free text, reading level, language) with **web‑specific renderings**
(`fields.vision.fontScale` is a CSS percentage; settings vocab is `fontScale /
lineHeight / letterSpacing / speechRate`). XR needs FOV→text‑size; ArtInsight
needs verbosity/spatial‑emphasis prompt context. So the profile must split into
**AbilityModel** (what we understand) vs **SurfaceProfile** (how a given app
renders it).

---

## 3. How the reference work maps onto our design

The three articles and the broader literature converge on patterns we already
half‑have; the refactor is a chance to name and harden them.

- **Reflective memory = Write / Manage / Read + an offline "dream"**
  (Google Cloud). We already have this exact shape: `logObservation` (write),
  `extract`+`reflect` (manage), `recall`+`getEffectivePreferences` (read), the
  24‑hour `reflect` alarm (dream). *Action:* make the dream a **Scheduler port**
  call, not a `chrome.alarms` literal, so every host can run it.

- **Separate *user memory* from *job memory*** ("agent that learns"). User
  memory = durable facts/preferences; job memory = lessons from task
  trajectories. We have both but blended: declarative settings vs the
  reusable‑action proposals from agent runs. *Action:* formalize as **semantic**
  vs **procedural** memory (CoALA's four categories: working / episodic /
  semantic / procedural).

- **"Dreams" = consolidate off the live path; treat derived memory as untrusted
  until checked; mark evidence processed; scope before storing** (Anthropic via
  Google Cloud). Our cursor‑based `extract` is exactly this pipeline. *Action:*
  add **reflection grounding** (every derived fact cites the episodic evidence
  IDs it came from — partly present via `evidence[]`) and an explicit
  **evidence‑discard policy** after consolidation. This is precisely the XR
  note "Store all observations → Validate observations, then discard evidence."

- **Consolidation is the hard part; naive summarization loses ~20% of facts**
  (2025 surveys). *Action:* keep consolidation conservative
  (ADD/UPDATE/SUPERSEDE/NOOP already avoids lossy re‑summarization), and add a
  **behavior‑summary** view distinct from the lossless fact store.

Sources: [Reflective memory](https://medium.com/google-cloud/what-is-reflective-memory-and-why-does-your-ai-agent-need-it-5aa1579fb57d) ·
[Agent that learns](https://medium.com/google-cloud/how-to-build-an-ai-agent-that-learns-76faea6d0208) ·
[Agent "dreams"](https://medium.com/google-cloud/anthropic-just-gave-agents-dreams-here-s-how-to-build-your-own-on-google-cloud-e509b0e1e6ba) ·
[Episodic memory for agents](https://atlan.com/know/episodic-memory-ai-agents/) ·
[Mem0](https://arxiv.org/pdf/2504.19413) ·
[Memory for autonomous LLM agents (survey)](https://arxiv.org/html/2603.07670v1) ·
[Anatomy of agentic memory](https://arxiv.org/pdf/2602.19320)

---

## 4. How the XR meeting notes map onto features

| Note | Toolkit feature |
|---|---|
| "People may not want to be asked" / "Avoiding judgement – suggesting a new skill or feature" | **Consent & framing policy** as a first‑class module: suggest, never diagnose; proposals not silent application; per‑user "don't ask" suppressions (already in `mine.suppressions`). |
| "Consolidation phase — what memories of abilities to be understood, stored, maintained?" | **AbilityModel** + reflection/promotion (origin→category) lifecycle. |
| "Store all observations → Validate observations, then discard evidence" | Episodic log (store raw) → `extract` (validate, grounded) → **evidence‑discard policy** (drop raw after consolidation; keep the grounded fact). |
| "Summary of user behavior" | **Behavior‑summary view** (materialized, regenerated in the dream). |
| "LLM determines skill suggestion" / "Skill + Settings" | Procedural (skills) **and** declarative (settings) memory kinds; proposal drafting + `interpretNeeds`. |
| "Template / Text size" / "Measure the field of view and then use it for text size" | **SurfaceAdapter**: AbilityModel → concrete settings. Flagship XR scenario: XR `Sensor` port reports FOV → ability inference ("needs ~X angular text size") → web SurfaceAdapter renders fontScale; ArtInsight renders verbosity. |
| "Insights from XR ⇄ webpages" | **Cross‑app insight flow** through the permission broker (§6). |
| "How do we portray the understanding of the user?" | **Understanding presentation API** (`getUnderstanding()` → the "What I Know About You" panel, already prototyped in the popup). |
| "Might want to turn on caption" | Procedural memory shared cross‑app (the captions routine learned on web is offered in XR). |
| "Finding things across many disabilities" | `recall(context)` over the merged profile. |
| "I wish I had this information about the person to make this app" | The whole point: any granted app can **read** the understanding instead of re‑interviewing. |

---

## 5. Target architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│ Consumers:   Chrome Extension │ XR app │ ArtInsight (iOS) │ Mobile     │
└──────────────────┬────────────┴────┬───┴───────────┬──────────────────┘
                   │     Toolkit SDK (stable public API)                 │
┌──────────────────▼─────────────────▼───────────────▼──────────────────┐
│  TOOLKIT CORE  (platform‑agnostic, pure logic, no chrome.* / no DOM)   │
│                                                                        │
│  AbilityModel   MemoryStore           Reflection/Dream   Consent &     │
│  (semantic:     (episodic + semantic  engine (slow lane: Proposal/     │
│   who they are) + procedural shards)  extract, reflect)  Framing policy│
│                                                                        │
│  Scope/Merge (fast lane)   SurfaceAdapters   Cross‑app Sync & Broker    │
│  general→ctx→cat→origin     render→app        (capability grants)       │
└──────────────────┬─────────────────────────────────────────────────────┘
                   │  Platform Ports (interfaces the core depends on)
┌──────────────────▼─────────────────────────────────────────────────────┐
│  PLATFORM ADAPTERS (one bundle per host)                               │
│  KVStore · Scheduler · LLM · Clock · SecretStore · Consent ·           │
│  Sensors? · Surface?                                                    │
│                                                                        │
│  Chrome : chrome.storage / chrome.alarms / Gemini / sync‑key / badge   │
│  iOS    : Files+CloudKit / BGTaskScheduler / OpenAI / Keychain / NC    │
│  XR     : engine store / frame loop / … / + FOV·gaze·a11y Sensors      │
└─────────────────────────────────────────────────────────────────────────┘
```

**Two stable contracts** define the module:

1. **Platform Ports** — what a host must *provide* to run the core:
   `KVStore{get,set,patch(name)}`, `Scheduler{every(id,interval,fn),cancel}`,
   `LLM{complete(prompt,opts), embed?(text)}`, `Clock{now()}`,
   `SecretStore{get,set}`, and **`Consent{present(proposal|grant), capture(response)}`**
   — the accessible proposal/consent channel: renders through the host's own
   reliable modality (TTS / live region / large‑target tap) and runs copy through
   the plain‑language pass, superseding the old badge‑only notifier. **Optional:**
   `Sensors{read(kind)}` (XR FOV/gaze, device a11y settings) and
   `Surface{apply(settings) → {applied, unmet[], degradedTo, satisfied}}` — a
   surface MUST be able to report **cannot‑satisfy** rather than fail silently.

2. **Toolkit SDK** — what consumers *call* (the cleaned Librarian surface, now
   platform‑neutral; today's `librarian*` message types map 1:1):
   `getUnderstanding()` / `getProfile()` / `setProfileField()`;
   `getEffectivePreferences(surfaceCtx)` / `recordExplicitSetting` /
   `recordScopedSettings`; `recall(ctx)` / `logObservation` / `listMemories` /
   `deleteMemory`; `listProposals` / `respondToProposal` / `setPaused`;
   procedural: `listSkills` / `saveSkill` (scope‑gated); cross‑app:
   `requestGrant` / `exportUnderstanding(grant)` / `importInsight(insight,grant)`.

**Built‑in safeguards (cheap, prototype‑scoped — in the core, not bolted on):**
- **Soft / reversible by default** — applied changes are easy to undo, and a single
  accept never hardens a high‑confidence trait; only deliberate, repeated, or
  explicitly‑confirmed signals promote into the durable AbilityModel.
- **Requirement strength** — every fact/preference carries `strength ∈ {floor,
  preference, hint}`; floors (a screen‑reader user's needs, Marta's captions) are
  applied last, may only tighten, and are never silently dropped by a narrower soft
  preference nor decayed away.
- **Honest failure** — preference resolution / surface application can return
  **cannot‑satisfy**, surfaced in the user's own modality, instead of pretending.
- **Acting user** — a lightweight "who's using this now?" selector partitions the
  model so two people on one device/headset don't cross‑contaminate, plus a "helper
  setup" mode for supported set‑up. (Not a formal supporter/principal model — that's
  **[product‑hardening]**.)
- **Privacy hygiene** — ability data is **local by default**; the no‑memory zones
  stay; the privacy floor **fails safe** on unknown category; the core minimizes and
  the user can see what free text is sent to the LLM.

**Construction** becomes explicit DI:
`const toolkit = createToolkit({ kv, scheduler, llm, clock, secrets, consent, sensors?, surface? })`
— replacing today's implicit `globalThis.Librarian` + `importScripts`.

---

## 6. The new piece: cross‑app, permission‑guarded flow

This is the genuinely new work — but for the prototype it is **small**. The goal:
let a trusted, first‑party app read the understanding instead of re‑interviewing,
and contribute insights back **as proposals**, without silently doing something
weird to a vulnerable participant. Drawn from the framing notes ("people may not
want to be asked", "avoiding judgement").

**Prototype‑scoped design:**
- **Trusted apps.** The consuming apps (web ext, XR, ArtInsight) are our own /
  collaborators'. No adversarial‑consumer defenses — the threat model is *mistakes,
  not malice*.
- **Read = a grant the user can see.** An app asks for what it needs (e.g.
  `ability.categories`, `reading.level`, `language`, `settings.text`); the user sees
  a plain‑language summary and approves. A simple **"what each app can see"** panel
  lists current grants; **revoke = local delete**. (Not a formal auditable grant
  ledger — that's **[product‑hardening]**.)
- **Write = a proposal, never silent.** A cross‑app insight (XR's FOV→text‑size,
  ArtInsight's preferred description style) arrives carrying `{source, kind,
  confidence}` and is surfaced through the **same** accessible consent/proposal path
  the user already knows — it never auto‑applies, and the *sending* app can't resolve
  its own proposal (only the local user surface can).
- **Keep it local; keep it honest.** Ability data stays on‑device by default;
  concrete diagnoses are never inferred or stored (ability *categories* only); raw
  evidence is discarded after consolidation; what little leaves the device does so
  only by the user's deliberate action.
- **Transport (prototype):** (1) **local shared store** — same device, multiple apps
  (the XR‑headset / phone case), zero accounts; (2) **user‑mediated export/import** —
  a profile blob the user moves themselves for the XR⇄web demo. Plain
  last‑write‑wins on the small synced AbilityModel; **SurfaceProfiles stay
  device‑local**, so a phone's 200% and a desktop's 120% aren't a "conflict."

**[product‑hardening] — deliberately *not* in the prototype:** signed insights &
per‑app keypairs, per‑principal write quarantine, scope enforcement on the wire,
encrypted recipient‑bound exports, tombstone revocation propagation, replay/version
vectors, HLC/CRDT conflict resolution, GDPR/HIPAA/FERPA postures, DPIAs, formal
grant ledgers. The full product‑grade analysis lives in
[toolkit-adversarial-analysis.md §3–§5](./toolkit-adversarial-analysis.md) for
if/when this productizes.

---

## 7. Key decision to make first (recommendation in **bold**)

**Is the Toolkit one shared library, or a shared *spec* with a reference
implementation + native ports?**

Consumers span Chrome (JS), ArtInsight (Swift/iOS), and XR (likely Unity/C# or
web). A single importable JS library cannot be the core of a Swift app.

> **Recommendation: ship the Toolkit as (a) a language‑neutral _spec_ — the data
> model, scope grammar, consent rules, and sync/permission protocol — plus (b) a
> reference TypeScript implementation that the Chrome extension and any JS/server
> consumer use directly, plus (c) thin native conformers (Swift first, for
> ArtInsight) that implement the same schema and speak the same sync protocol.**

The durable, cross‑language asset is the **protocol + schema**; the TS core is
the canonical engine; native apps either embed the TS core (via a JS runtime /
local service) or port the (small, pure) fast‑lane logic and defer slow‑lane
consolidation to a shared service. This keeps the web extension on the real code
while letting Swift/C# participate without a rewrite of the consolidation engine.

Secondary decisions (recommendations bold): package name **`@a11y-toolkit/core`**
in a new top‑level **`toolkit/`** dir (note the deliberate distinction from the
existing auditor `tools/`); cross‑app profile starts **local + user‑mediated
export**, cloud later; internal `skill`/`customSkills` identifiers **stay as‑is**
(schema‑versioned) to avoid a storage migration — only the new public types use
the settled "adapter/skill" vocabulary.

---

## 8. Phased migration (each phase ships; the extension keeps working throughout)

### Phase 0 — Carve the seam, zero behavior change ✅ **IMPLEMENTED (2026‑06‑26)**
- Created top‑level [`toolkit/`](../toolkit/) as the **source of truth**: pure
  ES‑module cores ([core/taxonomy.js](../toolkit/core/taxonomy.js),
  [core/datastore.js](../toolkit/core/datastore.js) `createDatastore(...)`,
  [core/librarian.js](../toolkit/core/librarian.js) `createLibrarian(...)`), a
  [ports contract](../toolkit/ports/index.js), a
  [`createToolkit`](../toolkit/index.js) DI entry, and a Chrome adapter
  ([adapters/chrome/](../toolkit/adapters/chrome/)).
- Core converted from `globalThis`/`importScripts` to ES modules. The three
  classic scripts the SW/popup/test load —
  `extension/lib/{taxonomy,datastore,librarian}.js` — are now **generated**
  esbuild IIFE shims (same pattern as `harness.js`/`agent.js`); `background.js`
  is **untouched**. Edit `toolkit/`, then `npm run build`.
- **Platform Ports** defined and the chrome.* bodies moved behind them:
  `KVStore / Clock / Scheduler / Consent` + a small `demo` hook. The core no
  longer references `chrome.*`, `Date.now()`, or `globalThis` (grep‑verified).
  **Corrections to the original sketch:** (a) the LLM stays injected
  post‑construction via `setGeminiCaller` (the pre‑existing seam) rather than a
  constructor port; (b) `SecretStore` is host‑owned (the API‑key wiring stays in
  `background.js`) and unused by the core in Phase 0; (c) **`tools-registry.js`
  is *generated* from
  [`skills/registry.js`](../personalized-extension/skills/registry.js) — it is
  NOT moved as a source of truth, it keeps being generated**; (d) implemented in
  **ES‑module JS, not TS** — TS‑ification is a mechanical follow‑up that doesn't
  move the seam, deferred to keep behavior risk near zero. One latent bug
  surfaced + fixed: `logObservation` declared `const origin` but the demo path
  reassigns it (now `let`).
- **Exit check (met):**
  [librarian-test.js](../personalized-extension/test/librarian-test.js) (69
  asserts) + new
  [toolkit-ports-test.js](../personalized-extension/test/toolkit-ports-test.js)
  (14 asserts — covers the refactored slow‑lane / shard‑scan paths the gate
  missed) + [run-tests.js](../personalized-extension/test/run-tests.js) (116
  structural) all green from a clean `npm run build`; both unit suites load the
  **built** bundles, so they also prove the ESM source survives esbuild + `eval`
  under the chrome mock. An independent adversarial diff review found no
  Chrome‑host behavior change. **Both puppeteer e2e suites also ran green in
  real Chrome for Testing:**
  [demo-beats-e2e.js](../personalized-extension/test/demo-beats-e2e.js) **26/26**
  (onboarding → Librarian profile → observation → proposal → popup "Yes, apply"
  → saved profile → vimeo auto‑replay) and
  [ai-features-e2e.js](../personalized-extension/test/ai-features-e2e.js)
  **20/20** (live Gemini interpretNeeds, a real agent run turning on YouTube
  captions, accept, and real Vimeo auto‑replay) — confirming the extension loads
  the generated bundles and the whole `background.js` → `globalThis.Librarian/
  Datastore` flow is unchanged. Full tally: **245 asserts, 0 failures.** This is
  the regression gate for the whole refactor.

### Phase 1 — Split AbilityModel from SurfaceProfile
- Separate modality‑agnostic understanding (support areas, free text, inferred
  needs, reading level, language, confidence) from per‑app renderings.
- Introduce `SurfaceAdapter`; move today's web settings mapping
  (`fontScale/lineHeight/…`) into `adapters/chrome` as the *web* surface. Add the
  derivation `abilityModel → webSettings`. Behavior identical for web users.
- Bake in the cheap safeguards here: add **`strength` (floor/preference/hint)** to
  records (floors applied last, never silently dropped); give every numeric value a
  **typed unit** (`fontScale:%`, `angularTextHeight:deg`, …) so XR↔web can't misread
  each other and the old `>10` %‑vs‑multiplier heuristic can be deleted; make
  `SurfaceAdapter.apply` return **cannot‑satisfy**.

### Phase 2 — Name the memory taxonomy + harden reflection
- Relabel shards as **episodic / semantic / procedural**; fold the skills/
  reusable‑action registry under procedural.
- Add **reflection grounding** (facts cite `evidence[]` IDs) and the
  **evidence‑discard policy** post‑consolidation. Add the **behavior‑summary**
  view to the dream.
- Fix the cheap **lifecycle‑correctness** bugs so the engine can't lock in a wrong
  belief: drop the `Math.max` font ratchet (**allow downward correction**; an
  explicit user value wins over a higher inferred one); base decay on
  *last‑confirmed*, not *last‑accessed*; **lower** confidence on a contradicting user
  edit instead of only ever raising it; don't auto‑`SUPERSEDE` a `floor`. (Skip the
  append‑only lineage/tombstone log — **[product‑hardening]**.)

### Phase 3 — Cross‑app sharing + consent (net‑new, prototype‑scoped)
- `toolkit/sync/`: the lightweight layer from §6 — grants the user can see + a
  **"what each app can see"** panel, **revoke = local delete**, cross‑app writes
  routed through the accessible **proposal/consent** path, the **acting‑user**
  switch, and a **global off switch**. Transport: **local shared store** first, then
  **user‑mediated export/import** for the XR⇄web demo. Plain last‑write‑wins;
  SurfaceProfiles stay device‑local.
- **Not** in this phase (**[product‑hardening]**): signed/quarantined writes,
  encrypted exports, tombstone propagation, HLC/CRDT sync, formal audit ledger.

### Phase 4 — Prove it with a second consumer
- Wire one non‑web host end‑to‑end against the spec: **ArtInsight** is the
  cleanest target — its LLM calls are centralized in `OpenAIService`/`Request`,
  it has *no* existing profile layer (clean slate), and the highest‑value hook is
  prompt‑context injection (read `ability + reading level + verbosity/spatial
  emphasis` → append to the describe prompt; observe edit/recording patterns →
  write back as proposals). Optionally stub the XR FOV→text‑size loop to exercise
  a `Sensors` port and the cross‑app insight flow.

---

## 9. Risks & mitigations

**Prototype risks (what can actually hurt a participant or break the demo):**
- **Doing something weird silently** → soft/reversible by default; nothing hardens
  on one tap; cross‑app writes arrive as proposals.
- **Asking something they can't perceive/understand** → consent is an accessible
  port + plain‑language pass (the research contribution, not an afterthought).
- **Pretending to help while failing** → requirement‑strength floors +
  cannot‑satisfy honesty.
- **Locking in a false belief** → lifecycle‑correctness fixes (Phase 2); allow
  downward correction; behavior summary is a *separate* view, never the fact store.
- **Mixing up two people** on a shared device → acting‑user switch.
- **Careless data handling** → local by default; no‑memory zones; fail‑safe unknown
  category; transparent LLM payload.
- **Consolidation is lossy** → keep ADD/UPDATE/SUPERSEDE/NOOP (no blanket
  re‑summarize); never summarize away a `floor`/safety fact.
- **Scope creep on the extension** → Phase 0's exit check (all current tests green)
  is the hard gate; no phase merges that regresses it.
- **Naming collision** with root `tools/` → distinct package `@a11y-toolkit/core` +
  a one‑line note in the root README.

**[product‑hardening] backlog (real, deferred until/unless this productizes):**
adversarial‑consumer defenses (signed insights, per‑principal quarantine, on‑the‑wire
scope enforcement), encrypted/recipient‑bound exports, revocation/deletion
propagation (tombstones), HLC/CRDT multi‑device conflict resolution, a formal
auditable grant ledger, and a regulatory posture (GDPR Art.9 / HIPAA / FERPA /
COPPA, DPIA). Full analysis in
[toolkit-adversarial-analysis.md](./toolkit-adversarial-analysis.md).

---

## 10. Open questions for you
1. **Spec + reference impl + native ports** (my recommendation, §7) — agree, or do you want a single‑language library and accept that ArtInsight/XR consume it over a service boundary only?
2. **First non‑web consumer** to actually wire in Phase 4: ArtInsight (iOS), the XR app, or just a stub harness?
3. **Cross‑app transport** to build first: local shared‑store only, or do you already need cross‑device (export/import) for the XR⇄web demo?
4. ~~**Scope of this pass:** produce Phase 0 as a real PR now, or keep iterating on this plan first?~~ → **Done: Phase 0 is implemented** on `main` (uncommitted working tree; toolkit/ + generated lib shims + port‑seam test). Next decision: commit Phase 0 as its own PR and start **Phase 1** (AbilityModel/SurfaceProfile split), or fold the TS‑ification follow‑up in first?
