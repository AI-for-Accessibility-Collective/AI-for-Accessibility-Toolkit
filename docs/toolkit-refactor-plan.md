# Refactor plan: extracting the personal‑memory core into the **Toolkit**

**Status:** proposal for review · **Date:** 2026‑06‑26
**Scope:** lift the Librarian / ability‑profile / memory‑agent subsystem out of
`personalized-extension/` into a standalone, app‑agnostic module ("the Toolkit")
that the Chrome extension, an XR app, ArtInsight, and mobile adaptations can all
build on — with permission‑guarded flow of understanding *between* those apps.

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
3. **Add** a cross‑app identity + sync + permission layer that does not exist yet — the genuinely new work.

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
| `chrome.action` badge (pending‑proposal count) | librarian.js ~L998 | **Notifier** |
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
│  KVStore · Scheduler · LLM · Clock · SecretStore · Notifier ·          │
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
   `SecretStore{get,set}`, `Notifier{pending(count|items)}`, and **optional**
   `Sensors{read(kind)}` (XR FOV/gaze, device a11y settings) and
   `Surface{apply(settings)}`.

2. **Toolkit SDK** — what consumers *call* (the cleaned Librarian surface, now
   platform‑neutral; today's `librarian*` message types map 1:1):
   `getUnderstanding()` / `getProfile()` / `setProfileField()`;
   `getEffectivePreferences(surfaceCtx)` / `recordExplicitSetting` /
   `recordScopedSettings`; `recall(ctx)` / `logObservation` / `listMemories` /
   `deleteMemory`; `listProposals` / `respondToProposal` / `setPaused`;
   procedural: `listSkills` / `saveSkill` (scope‑gated); cross‑app:
   `requestGrant` / `exportUnderstanding(grant)` / `importInsight(insight,grant)`.

**Construction** becomes explicit DI:
`const toolkit = createToolkit({ kv, scheduler, llm, clock, secrets, notifier, sensors?, surface? })`
— replacing today's implicit `globalThis.Librarian` + `importScripts`.

---

## 6. The new piece: cross‑app, permission‑guarded flow

This does not exist today and is the highest‑design‑risk part. Principles, drawn
straight from the framing notes ("people may not want to be asked", "avoiding
judgement") and the articles' "scope enforcement before passing to the agent":

- **Identity.** One *person*, many *apps*. An app is a principal that holds a
  **grant**. No global account is required to start (see transport options).
- **Capability‑scoped grants (default deny, explicit, revocable, auditable).**
  A grant names exactly what an app may **read** (e.g. `ability.categories`,
  `reading.level`, `language`, `settings.text`) and what it may **write/observe**
  (e.g. XR may write `ability.inference.fov→textSize`). Mirrors the article's
  separation of caller vs runtime identity.
- **Information classes by sensitivity** — enforced by the broker:
  - *Ability categories & derived needs* → shareable per grant.
  - *Concrete medical diagnoses* → **never inferred, never stored, never shared** (extends the existing no‑memory zones).
  - *Raw observations / evidence* → **stay local, discarded after consolidation** (the "discard evidence" note). Only grounded facts can ever leave a device.
  - *Derived settings/skills* → shareable per grant, but as **proposals on arrival**, not silent application ("avoiding judgement").
- **Provenance & confidence travel with every shared insight.** An insight from
  XR→web carries `{source: xr, kind: ability.inference, confidence, evidenceSummary}`;
  the receiving app surfaces it through the *same* consent/proposal UI the user
  already knows — it never auto‑applies.
- **Transport, phased:**
  1. **Local shared store** (same device, multiple apps via OS app‑group / shared container) — zero accounts, works for "XR + web on one headset/phone".
  2. **User‑mediated export/import** (signed profile blob via file/QR/handoff) — cross‑device without a backend.
  3. **Optional cloud sync** (end‑to‑end‑scoped, opt‑in) — designed for, not built first.

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

### Phase 0 — Carve the seam, zero behavior change
- Create `toolkit/` (reference TS). Move `librarian.js`, `datastore.js`,
  `taxonomy.js`, `tools-registry.js` in as the **source of truth**.
- Convert core from `globalThis`/`importScripts` to ES modules. Add a thin
  `adapters/chrome` that re‑exposes `globalThis.Librarian` / `globalThis.Datastore`
  so `background.js` is untouched. (esbuild already bundles — mechanical.)
- Define **Platform Ports**; move the chrome.* bodies currently inside
  datastore/background behind `KVStore / Scheduler / LLM / Clock / SecretStore /
  Notifier`. Core stops referencing `chrome.*` and `Date.now()` directly.
- **Exit check:** existing test suites
  ([librarian-test.js](../personalized-extension/test/librarian-test.js) 69 asserts,
  [demo-beats-e2e.js](../personalized-extension/test/demo-beats-e2e.js),
  [ai-features-e2e.js](../personalized-extension/test/ai-features-e2e.js)) pass
  unchanged. This is the regression gate for the whole refactor.

### Phase 1 — Split AbilityModel from SurfaceProfile
- Separate modality‑agnostic understanding (support areas, free text, inferred
  needs, reading level, language, confidence) from per‑app renderings.
- Introduce `SurfaceAdapter`; move today's web settings mapping
  (`fontScale/lineHeight/…`) into `adapters/chrome` as the *web* surface. Add the
  derivation `abilityModel → webSettings`. Behavior identical for web users.

### Phase 2 — Name the memory taxonomy + harden reflection
- Relabel shards as **episodic / semantic / procedural**; fold the skills/
  reusable‑action registry under procedural.
- Add **reflection grounding** (facts cite `evidence[]` IDs) and the
  **evidence‑discard policy** post‑consolidation. Add the **behavior‑summary**
  view to the dream.

### Phase 3 — Cross‑app identity, sync, permission broker (net‑new)
- `toolkit/sync/`: identity, capability grants, signed export/import, broker that
  enforces read scopes and routes all cross‑app writes through the proposal/
  consent path. Implement **local shared‑store** transport first; design the
  cloud interface without building it.

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
- **Consolidation is lossy** → keep ADD/UPDATE/SUPERSEDE/NOOP (no blanket
  re‑summarize); behavior summary is a *separate* view, never the fact store.
- **Privacy / over‑sharing** → default‑deny grants; diagnoses never stored;
  evidence discarded post‑consolidation; cross‑app writes arrive as proposals.
- **Multi‑language drift** → the spec (schema + protocol) is the contract and is
  versioned; conformance tests run against TS and each native port.
- **Scope creep on the extension** → Phase 0's exit check (all current tests
  green) is the hard gate; no phase merges that regresses it.
- **Naming collision** with root `tools/` (the auditor toolkit) → distinct
  package name `@a11y-toolkit/core` and a one‑line note in the root README.

---

## 10. Open questions for you
1. **Spec + reference impl + native ports** (my recommendation, §7) — agree, or do you want a single‑language library and accept that ArtInsight/XR consume it over a service boundary only?
2. **First non‑web consumer** to actually wire in Phase 4: ArtInsight (iOS), the XR app, or just a stub harness?
3. **Cross‑app transport** to build first: local shared‑store only, or do you already need cross‑device (export/import) for the XR⇄web demo?
4. **Scope of this pass:** produce Phase 0 as a real PR now, or keep iterating on this plan first?
