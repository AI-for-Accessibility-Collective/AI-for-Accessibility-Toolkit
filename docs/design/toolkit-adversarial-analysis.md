<!-- Generated 2026-06-26 via a 43-agent adversarial workflow (5 W3C-persona cross-context scenarios x 5 lenses + long-horizon edge sweep + completeness critic). Companion to toolkit-refactor-plan.md. Note: the dedicated sync & governance edge-agents failed structured-output retries; their themes were reconstructed by the synthesis from the per-scenario adversarial panels (see Themes E and H). -->

# Toolkit Refactor — Adversarial Analysis & Amendment Brief

**Audience:** the engineer who authored `docs/toolkit-refactor-plan.md`, to amend it.
**Source material:** 5 full persona scenarios (construct + support-eval + 5-lens adversarial), a long-horizon edge sweep (4 themes), and a completeness critic.
**Date:** 2026-06-26

---

## 1. Executive summary

The proposal is **architecturally well-aimed**. Its three central abstractions — a modality-agnostic `AbilityModel` split from per-app `SurfaceProfile`, a `SurfaceAdapter` layer for divergent rendering, and a capability-scoped, default-deny, revocable, auditable permission broker that carries provenance+confidence and delivers cross-app insights as *proposals not silent application* — are the right frame for "one understanding, many renderings, consented transfer." The parts that already exist in code (the proposal/suppression pipeline, the provenance map, the privacy floor, the deterministic adapter layer like `motion-reducer`/`simplify-text`/`wcag-fixes`, the cursor-based extract) are real and reusable.

**Where it is weakest:** almost every *load-bearing mechanism the personas actually experience* is unbuilt, under-specified, or in tension with the design's own behavior. The failures cluster:

- **Consent rests on assumptions that break for the exact users the Toolkit serves.** "Consent assumes a user who can evaluate a proposal" fails for Sophie (cognitive), Lakshmi/Marta (the consent UI is rendered in a channel they can't read), Elias (can't remember what he granted), and any shared account. The `language='plain'` field exists but is **never consumed**; `consentBoundary` exists but is **never read**; a single tap writes the profile with no high-stakes tier.
- **There is no identity / data-subject / supporter model**, yet the plan ships cross-device sync (`chrome.storage.sync`) and cross-app sharing on top of "one account = one consenting person." Shared logins (Stefan+Ian, Sophie+Priya, family/lab devices) silently cross-contaminate inference and apply one person's adaptations to another.
- **Sensor→ability inference is health data with no floor.** FOV/gaze infers a clinical-grade acuity profile; the privacy floor is hostname-only and never fires on sensor channels, native apps, or unclassified high-stakes pages. "Diagnoses never inferred/stored" is an unenforced naming convention over free-text blobs.
- **Hard, conflicting, and situational needs have no representation.** The scope chain is a soft specificity-merge of override-able preferences. There is no floor/non-negotiable flag, no conflict-resolution-by-channel-switch, no "cannot-satisfy" return, no situational/transient/decay lifecycle, and `Surface{apply(settings)}` is a settings *sink* that cannot carry a paced caption stream to braille.
- **Long-horizon drift is baked in by Phase 0's own gate.** `Math.max` font ratchet, `stable`=Infinity decay, confidence that only ever rises (never calibrated), `lastAccessed`-touch immortality, 30-day purge of the audit trail, and hallucinated `SUPERSEDE` with no corroboration — all locked in as "source of truth" by the 69-assert regression gate, then replicated to every native conformer.

### Highest-priority changes (do these first)

| # | Change | Why it's top priority |
|---|--------|----------------------|
| **1** | **Add a data-subject / supporter / "who is acting now" identity layer** before any sync or cross-app sharing (move the broker's identity model from "one person, many apps" to also cover "many people, one app/account/device"). | Unblocks consent validity, shared-account safety, supported decision-making, and GDPR lawful-subject — every other consent fix depends on it. |
| **2** | **Make consent first-class accessible and policy-driven:** consume `language='plain'`, render proposals/grants through the host's accessible Notifier channel, *enforce* `consentBoundary`, and add a **high-stakes tier** (money/identity/irreversible/self-conception) that a single tap can never settle (→ "hold for joint review"). | The consent story is the proposal's claimed strength and is currently inert or inaccessible for the target users. |
| **3** | **Add a requirement-strength axis (floor / preference / hint) + a composability/conflict layer + a structured `cannot-satisfy` return**, and **decouple `Surface{apply(settings)}` from a new streaming port.** | Hard, conflicting, and unsatisfiable needs (Marta) currently fail silent-and-wrong; floors get silently dropped by narrower preferences. |
| **4** | **Treat the whole AbilityModel + sensor-derived inferences as GDPR Art.9 special-category data:** sensor-channel privacy floor, content/context-sensitivity floor (not hostname-only), explicit Art.9 consent, DPIA before Phase 3, encrypted (not just signed) exports, and deletion/revocation **propagation** (tombstones) across apps/devices. | The system's core asset is exactly what the law most restricts; "never stored/shared" is unenforced; revocation and erasure don't propagate. |
| **5** | **Fix the lifecycle model before freezing it:** replace `Math.max` ratchet with specificity+recency-wins (allow downward correction), add re-validation for `stable` facts, calibrate confidence (decay toward prior on non-confirmation, lower on contradiction), gate `SUPERSEDE` of stable/floor facts behind corroboration+proposal, and add a situational/transient class with decay. Add long-horizon simulated-clock tests to the conformance suite. | Phase 0 lifts `librarian.js` as the cross-language source of truth at its least-tested moment; today's drift bugs otherwise propagate to every conformer permanently. |

---

## 1a. Scope correction — right-sizing for a research prototype

> **This section was added after the analysis and GOVERNS it.** The risk register
> (§4) and amendments (§5) below were written at product/compliance grade. This is a
> **research prototype**, so most of that is over-engineering. Read §3–§5 as the
> *"if this ever becomes a product"* analysis; build to **this** section.

**Right-sized threat model.** The prototype runs on a participant's own device(s),
possibly with a researcher/helper present; the consuming apps (web extension, XR,
ArtInsight) are first-party/collaborator code, not adversarial; N is small and
consented; legal/ethics is owned by the study's IRB, not by the engine. So the real
risks are **experiential, not regulatory**: silently doing something wrong to a
vulnerable participant, asking them something they can't perceive or understand,
failing while pretending to help, mixing up two people on a shared device, leaking
disability data carelessly, or locking in a false belief that makes the demo
misrepresent the person. Adversarial third-party apps, regulator audits, and
cross-device replay attacks are **out of scope**.

**Keep / Simplify / Defer** (re-rating the §5 amendments):

| # (§5) | Topic | Prototype call | What that means |
|---|---|---|---|
| 2 | Accessible + plain-language consent | **KEEP** | Deliver consent through the app's own accessible channel; actually consume `language='plain'`. Drop the "zero pixels perceived" *conformance gate* — keep it as a design goal. |
| 5 | Requirement-strength (floor/preference/hint) + situational lifecycle | **KEEP** | Cheap field + honest merge; core research value (hard vs soft needs). |
| 3 | `cannot-satisfy` honest return | **KEEP** | Adapters report when they can't help instead of failing silent-and-wrong. **Defer** the streaming braille port unless braille is actually in the study. |
| 9 | Lifecycle correctness | **KEEP (lite)** | Kill the `Math.max` font ratchet (allow downward correction), explicit-user-wins, don't harden a high-confidence trait on one tap, don't auto-`SUPERSEDE` a floor. **Skip** the append-only lineage/tombstone log. |
| 4 | Typed units + angular schema | **KEEP** | Needed for the XR text-size demo to work at all; cheap. |
| 1 | Identity | **SIMPLIFY** | A lightweight "who's using this now?" switch + a "helper setup" mode. **Drop** the data-subject/supporter *principal* formalism and crypto "held-for-joint-review." |
| 11 | Cadence + off-switch + management view | **KEEP (lite)** | Pull-not-push proposals + a simple cap; a human-readable "what each app can see / recent activity" panel; a global off switch; demo-mode must never override suppressions. **Drop** the formal grant ledger / non-regression *invariant* framing. |
| 6 | Data sensitivity | **SIMPLIFY** | Keep cheap hygiene only: ability data **local by default**, be transparent about what's sent to the LLM (and prefer not to send the verbatim free-text narrative), keep the existing no-memory zones, make unknown-category **fail-safe**. **Drop** Art.9 classification, DPIA, field-level grant taxonomy, processor DPAs. |
| 12 | Missing dimensions (keyboard/input, locale/reading-level, color-vision) | **KEEP as scope notes** | Real coverage gaps, not over-engineering; build as the study needs them. |
| 13 | Procedural memory as abstract intent | **KEEP** | Architecture correctness, cheap. |
| 7, 8, 10 | Signed insights / per-principal quarantine / encrypted recipient-bound exports / tombstone propagation / HLC-CRDT sync | **DEFER** | Adversarial multi-party security + distributed-systems hardening. First-party trusted apps + mostly-single-user → for the prototype: cross-app insights arrive as **proposals** (already the design), revoke = **local delete**, sync = device-local SurfaceProfile + a small synced AbilityModel with plain last-write-wins, export = a blob the user moves themselves. |

**Revised top priorities (prototype):**
1. **Consent that the participant can actually perceive and understand**, and **soft/reversible-by-default** so nothing weird silently sticks or hardens on one tap. *(the research contribution; cheap)*
2. **Honest failure** — requirement-strength floors + `cannot-satisfy`, so the system never presents a caption box to a blind user and calls it help.
3. **Lightweight multi-user / helper-setup** so two people on one device don't cross-contaminate.
4. **Cheap lifecycle + units correctness** so the engine doesn't lock in a wrong belief and the XR→text-size number actually works.
5. **Simple privacy hygiene** — local by default, transparent LLM payload, keep no-memory zones, fail-safe on unknown.

Everything in §3–§5 beyond these is parked as a **product-hardening backlog**: real, but not to be built into the prototype.

---

## 2. The five scenarios

### S1 — Lakshmi (blind screen-reader user; senior accountant *and* blind parent) · ArtInsight ⇄ web

**Recap.** The same understanding (blind, fast listener, *describe-don't-interpret + non-reductive + concise + spatial-first*) must render divergently: a spatial paragraph in ArtInsight, terse inline alt text on a work invoice catalog, and a richer conversational register on her kid's school-art gallery. A description-style preference she *corrects* in ArtInsight should travel to the web — dropping the parental framing for invoices but keeping it for children's art.

**Supported.** The portable-AbilityModel thesis fits her invariant traits. The SurfaceAdapter abstraction is the right shape for divergent rendering. The permission broker is the **strongest, genuinely net-new fit** — it directly answers "should ArtInsight's style travel to the web?" with default-deny, revocable, provenance-carrying, proposal-on-arrival semantics.

**Gaps.**
- **No producer:** ArtInsight has no edit-capture, no persistence, opaque server-side Assistant prompt — the single event the scenario pivots on ("the edit becomes data") doesn't exist (the plan concedes ArtInsight has no profile layer).
- **No consumer:** web `describeImage()` is image-only with a hardcoded prompt; a ported style preference has nowhere to land, so the "sleek, modern, looks sturdy" drift can't be prevented at generation time.
- **No structured style schema** (lands in `freeText`, unparseable), **no content-type register selector** (terse invoice vs rich gallery on the same platform), **no per-axis conditional gating**, and the marquee step is **cross-device** (iPhone→work desktop) on the least-built transport tier with no identity binding.

### S2 — Elias (low vision + hand tremor + mild short-term memory loss; retiree) · XR ⇄ mobile ⇄ web

**Recap.** XR FOV/gaze infers an *angular* text-size need that should re-derive per surface (not copy a number); tremor needs dwell/large targets/commit-guards; memory loss stresses the consent model ("did I already turn that on?") and the consistency-vs-adaptivity tension ("lock layout").

**Supported.** Proposal-not-silent-application, the provenance map, suppressions, and the 44×44 target-size fixer are real and serve "re-show don't re-ask" and large-target needs.

**Gaps.**
- **Angular sizing is the least-supported flagship mechanism:** `fontScale` is a flat %, the merge **MAXes/copies** the number, there's no Sensors port, no angular schema, no distance model — and web/mobile *can't sense distance*, so 2 of 3 surfaces must assume a "typical" distance Elias (who reads up close) violates.
- **Tremor commit-guard / dwell** unbuilt (only target enlargement; enlarging doesn't stop double-fire). **"Lock layout"** unbuilt and physically unsatisfiable with `html{zoom}` (which reflows). **Cross-device transport + identity** is the connective tissue and is least-built. **Memory-impaired consent**: proposal-on-every-arrival vs "don't re-ask a person who can't track decisions" is unreconciled; decline-count escalation toward permanent suppression is exactly backwards for cognitive disability.

### S3 — Marta (deafblind; ~700% magnification + braille display; marketing assistant) · web ⇄ mobile ⇄ XR

**Recap.** Maximal, partly *conflicting*, non-negotiable needs: captions are the only audio route, must be *reflowable* (not burned-in) because at 700% an overlay is a smear, and must route to a refreshable braille display *paced to her panning*. One surface (audio-only WebXR) structurally **cannot** satisfy her — the system must say so honestly and salvage a transcript.

**Supported (skeleton only).** Procedural "captions for any video" genuinely exists (`auto-captions.js` MutationObserver + `generate-captions.js` ASR). The AbilityModel/SurfaceProfile split is the right shape. The consent-gated broker rides the real proposal machinery.

**Gaps (all the load-bearing beats).**
- **No reflowable-vs-burned-in distinction** — the only caption code paints fixed overlays or re-attaches `<track>`s, i.e. produces exactly the unreadable artifact.
- **Zero braille support** (the repo's only "braille" is the `aria-braillelabel` attribute name); `Surface{apply(settings)}` is a one-shot sink that **structurally cannot** carry a paced text stream — the narrative's own "braille-as-a-Surface" framing misreads the port.
- **No floor/hard-constraint model and no conflict-resolution-by-channel-switch** — the scope chain is soft specificity-merge; a narrower benign pref can silently override a caption floor.
- **No `cannot-satisfy`/verdict channel** — adapters are fire-and-forget; the ethically central "honest failure + salvage" exists nowhere. The two non-web hosts she needs are the least-committed targets.

### S4 — Stefan (dyslexia + ADHD; student) + Ian (autism; predictability) · web ⇄ mobile · shared LMS/shopping login

**Recap.** ADHD *day-to-day variability*: the same aggressive stack rescues a low-focus morning and is patronizing friction by a sharp afternoon — so adaptations must be condition-toggled and **decay** back. Dignity: simplify must be opt-in/per-paragraph, never force-fed "easy mode." Ian is the live constraint: a self-modifying adaptation layer is itself "a layout that changes often." Both share one login.

**Supported.** Dignity + motion suppression are real and code-backed: `simplify-text.js` already does opt-in, per-element, show-original; `motion-reducer.js`/`focus-mode.js` are deterministic, in-place, reversible. The Consent & Framing policy correctly elevates "suggest never diagnose."

**Gaps.**
- **No "current capacity state" primitive and no decay policy** — the only "conditions" are time/day gates; the AbilityModel is a stable-trait model a consolidation engine *converges*, philosophically at odds with a signal that flips twice a day (extract will `SUPERSEDE` the bimodal truth into whichever it saw last).
- **Per-paragraph choice isn't a memory type** (lives in transient `dataset`), and **cross-device** is single-user/no-identity. **Ian's predictability** is unbuilt *and* in tension with the dream/reflection/insight-arrival self-modification; a "pin" that only freezes the surface doesn't freeze the slow lane. **Shared login** can't tell whose session is active. `logFix` audits DOM edits only, not adaptation-layer state changes.

### S5 — Sophie (Down syndrome; comprehension) + Priya (supporter) · web ⇄ mobile, caregiver-assisted setup

**Recap.** The consent/agency crux. Sophie gives meaningful consent to *concrete before/after on a page she cares about* but **cannot evaluate an abstract forward-looking policy** ("simplify checkout everywhere?"). Supported decision-making (Priya is a chosen supporter, not a guardian). Cross-device sync silently carries authority onto a supporter-absent device; smoothing checkout friction removes the protective pause where she'd call Priya.

**Supported.** Concrete reading accommodations she *can* consent to (simplify-text, read-aloud) are real, tested, and sync via `mine.profile`. The proposal-gate correctly stops *silent* promotion of "comfortable with checkout."

**Gaps (the ethically decisive third).**
- `language='plain'` is **stored but unconsumed** (no setter, raw LLM copy rendered) — the consent UI she's asked to evaluate isn't actually simplified.
- `consentBoundary='profile-only'` is **declared but never read** — Priya's "ethical hinge" is inert; tightening or loosening it does nothing.
- **No high-stakes tier:** one ambiguous tap on a bus immediately writes the profile field and *boosts evidence confidence*, hardening a false self-description.
- **No supporter role / "hold for joint review" state** — the only safety move available is the one the scenario forbids (guardian override). **No "smoothing removes a protective signal" concept**; an unclassified ticketing checkout falls through to no category, so the privacy floor fails open and simplify-text fires where it's contraindicated.

---

## 3. Cross-cutting findings, grouped by theme

### Theme A — Identity, data-subject & supported decision-making *(highest structural gap)*

| Failure mode | Severity | Plan handles? | Fix |
|---|---|---|---|
| "One account = one consenting person" breaks on shared logins/devices: inference cross-contaminates (Ian↔Stefan), one person's adaptation applies to another, consent collected from the wrong human. | Critical | No | Add a lightweight **acting-subject** selector ("who is using this now?") that partitions the episodic log, ability model, suppressions, and active settings per local user-slot — not per device/account. |
| No supporter/proxy concept → only safety move is guardian override (strips agency); no way to author a profile *for* someone without it becoming guardianship. | Critical | No | First-class **supporter principal** + **"held-for-joint-review"** proposal status that neither party can resolve alone for high-stakes aspects. Supporter sets/locks policy but cannot unilaterally accept on the subject's behalf. Attribute every profile field to an **actor (self vs other-party)**. |
| Cross-device sync silently equates "same Google account" with "same consenting context"; authority to settle profile/high-stakes proposals roams to a supporter-absent device. | High | No | Split the sync payload: low-stakes derived settings may roam freely; **authority** to resolve profile-tier/high-stakes proposals is a separately-scoped capability that does not auto-transfer to a device that never completed supporter-present setup. |
| No data-subject field on observations → ArtInsight infers about a *child* (COPPA/Art.8); the broker has no notion of a second subject. | Critical | No | Add a **`subject`** field to every observation/insight; reject writes where `subject != account holder`; ArtInsight write-back limited to the parent's own preferences, never child-derived inferences. |
| Grants have no lifecycle/expiry; teardown (uninstall, account deletion, device loss, death) of a special-category store is unmodeled. | Medium | No | Grants **expire & re-confirm**; define teardown semantics (export-before-uninstall, "forget me everywhere", inheritance posture). |

### Theme B — Consent fatigue, accessibility of consent & the predictability paradox

| Failure mode | Severity | Plan handles? | Fix |
|---|---|---|---|
| The consent UI is rendered in the exact channel the user can't use (visual popup/badge for blind/braille; un-simplified prose for cognitive; audio cue for deaf; color-coded state for color-blind; keyboard-inoperable for motor). `language='plain'` is unconsumed. | Critical | No | Make the **consent/grant/proposal channel a first-class PORT obligation**, not a popup: deliver via the host's accessible Notifier (VoiceOver/JAWS live region / TTS / braille stream), keyboard-and-voice operable, all copy run through the plain-language pass. Conformance test: the grant flow is operable with **zero pixels perceived**. |
| Per-app weekly proposal cap doesn't aggregate → N apps each spend their own quota (30×4=120/week). Same need re-proposed once per surface (local-only dedup). | High | No | **Person-level proposal budget** + cross-app dedup by `(person, aspect)` at the broker; a response on any surface withdraws siblings everywhere. |
| Proposals **push** mid-task via a raw count badge; arrival itself is a disruptive state change (hostile to ADHD attention and to Ian's predictability). The system that suggests is itself self-modifying (dream/reflect/insight-arrival). | High | No | Redefine **Notifier** to carry timing/batching/quiet-hours; default **pull-not-push** (review-later digest). Add a first-class **predictability/quiet posture** that freezes proactive proposals *and* pauses self-initiated promotion/view-regeneration and guarantees stable control placement. |
| Graduated consent escalates two declines → permanent suppression; suppression is aspect-global (not surface/condition-scoped) and asymmetric (cheap to kill, obscure to restore). Disastrous for memory-impaired (accidental) and hard-need users (a "stop captions" kills the only audio route). | High | Partial | Add a non-binary tier (snooze / "not on sharp days" / per-aspect frequency). Scope suppressions along the scope chain + surface/modality. Never auto-escalate to permanent; make it a separate explicit affirmative choice, reversible from a visible list. Forbid suppress on aspects flagged as access-floors. |
| "Blind-accept laundering": fatigued queue-clearing accepts boost evidence confidence (+0.1) and feed promotion → fatigue *corrupts* the model with high-confidence false facts. Cap default is contradictory (30 vs 3). Demo mode disables cap *and* ignores suppressions. | High | No | Detect rapid-fire/blanket accepts and **down-weight** (fatigue ≠ N validations); never let a single accept cross the cross-app promotion threshold. Pin one canonical cap default. Demo mode must **never** override user suppressions. |
| Cadence-tuning requires inferring interruptibility — itself creepy behavioral inference of a sensitive cognitive/attentional trait, shareable cross-app. | High | No | Cadence is **user-declared** (never / digest / batch / per-event). Any adaptive component stays ephemeral, local, never promoted/shared/cited. Add an explicit **no-store/no-share class for attentional state**. |

### Theme C — Sensor→ability inference & medical-data risk

| Failure mode | Severity | Plan handles? | Fix |
|---|---|---|---|
| "Diagnoses never inferred/stored/shared" is unenforced: a derived `0.5° angular need` / `reading.level=low` / `must have captions` **is** clinical-grade disability data (Art.9), stored in free-text blobs with no classifier. The whole AbilityModel is the most-restricted data class. | Critical | No | Reclassify the **entire AbilityModel as Art.9 special-category**; controlled vocab (enums, not free text) so diagnosis-shaped strings literally can't be stored; output filter on every extract/reflect result; explicit Art.9 consent at inference enablement; **DPIA before Phase 3**. Drop the "never inferred/stored" claim until mechanical. |
| FOV/gaze is biometric and the textbook route to inferring acuity/field-loss/cognitive load — but the privacy floor is hostname-only and **never fires on sensor channels, native apps, or unclassified pages**. | Critical | No | Classify gaze/FOV/head-pose as **biometric special-category**; never persist or transmit raw samples; derive a single bounded scalar in the platform adapter *before* it crosses the port; run the floor on **sensor ingestion and observation content/context**, not just URL category. Make the floor fail-**safe** (unknown → no-memory). |
| `freeText` (verbatim disability narrative) is injected into third-party LLM prompts (Gemini/OpenAI) on every call and rides into export blobs with no redaction or DPA. | High | No | Quarantine `freeText`: exclude from cross-app export by default, never send to a remote LLM without scrubbing, structure-then-discard the verbatim string. Name the LLM provider a processor with a DPA; offer on-device/local-LLM for sensitive consolidation. |
| Coarse grants over-disclose: sharing one writing-style or text-size preference forces `ability.categories` exposure (the whole disability constellation — often a re-identifying fingerprint). Provenance+confidence travel, compounding linkability. | High | Partial | **Field-level capabilities** (`style.description-preference`, `derived.fontScale`) below the category level; broker returns **derived settings, never raw categories**, to non-clinical/external apps; minimize/strip provenance on the wire (coarse trust-tier, never app identity that re-reveals context). |
| Provenance-travels-with-insight defeats unlinkability; the behavior-summary view and grounded facts re-derive a durable disability+occupation dossier that *survives* evidence-discard (evidence-discard creates false safety). | High | No | Separate provenance-for-the-user (full, local) from provenance-on-the-wire (minimized, no free-text `evidenceSummary`). Apply the same sensitivity/retention to derived facts and the behavior-summary as to raw evidence. |

### Theme D — Irreconcilable / unsatisfiable / hard / situational needs

| Failure mode | Severity | Plan handles? | Fix |
|---|---|---|---|
| No `cannot-satisfy` return: an unsatisfiable surface fails **silent-and-wrong** (presents a caption box to a blind user as if it were help). | Critical | No | Every adapter returns `{satisfied, unmet[], degradedTo, salvage?}`; a Toolkit-level **accessibility verdict** rendered in the user's own modality; absence of a verdict is a conformance failure. |
| Hard needs modeled as soft override-able preferences → a narrower benign pref silently drops a floor; no conflict-resolution-by-channel-switch. | Critical | No | Add **requirement-strength axis (floor/preference/hint)**; floors applied last, can only tighten; a post-merge **composability check** detects antagonistic pairs (magnification×overlay-caption) and a channel-substitution table (caption→braille/TTS). |
| `Surface{apply(settings)}` is a one-shot idempotent **sink**; can't carry a viewport-paced braille caption **stream** — structural, not a bug. | High | No | Add an optional **streaming port** (`TextStreamSink{push(seq), ackCursor, onAdvanceRequest}`) with ordering + back-pressure, distinct from `apply(settings)`. |
| No situational/temporary lifecycle: sunlight/baby-in-arms/broken-arm/recovery states get promoted into permanent traits; deliberate-toggle = `stable` forever is the wrong default for temporary needs; conditions model only clock time. | High | No | First-class **situational/transient class** with mandatory TTL + active demotion in `reflect()`; generalize conditions beyond clock to situational predicates (ambient light/audio/grip) from Sensors; one-tap "this is temporary" / "I no longer need X" that supersedes across all scopes. |
| Cold-start = null adaptation for the highest-need users at first contact; the only inference source is web behavior; new ArtInsight/XR installs have an empty model with no web history to seed from. | High | Partial | **Declared-constraints intake** (confidence=1, hardFloor, bypasses occurrence gating); seed from device a11y flags (VoiceOver/TalkBack → screen-reader user); provisional-vs-confirmed states; cold-start defaults to the **safest** rendering for declared floors, never platform defaults. |
| Consolidation's ~20% fact-loss preferentially drops the **rare safety axis** of a multi-axis need (tremor commit-guard, seizure motion-suppression) because rarity looks like staleness. | High | Partial | Mark safety/harm-prevention facts a **protected class**: never summarized away, never demoted by recency/frequency; importance encodes consequence-of-loss; `UPDATE` does settings-key **union**, never wholesale overwrite, for floor/safety records. |

### Theme E — Sync conflicts, offline & multi-device

| Failure mode | Severity | Plan handles? | Fix |
|---|---|---|---|
| Whole-object last-write-wins on `chrome.storage.sync` silently discards one device's profile edits; `patch()` has no concurrency guard; "single-writer" assumption breaks the instant data is shared. | High | No | Shard the profile into per-field sync keys **or** a CRDT LWW-map with field-level **logical** timestamps (HLC), merged in `onChanged`; optimistic concurrency (compare-and-set) per store. |
| Three different conflict rules (Object.assign order vs specificity+recency vs Math.max numeric) and a **wall-clock** recency tiebreak that clock skew corrupts; explicit records are *local* while the profile is *sync* (split-brain). | High | No | One **total order** (specificity → HLC, never `Date.now()`); the Clock port exposes a logical/hybrid clock; reconcile which tier is authoritative cross-device and use the same merge algorithm on both paths. |
| `fontScale 200%` (phone) vs `120%` (desktop) is a legitimate per-surface need the schema can't express, so sync turns it into a conflict; `sanitizeSettings` %-vs-multiplier heuristic re-interprets the same value differently per device/conformer. | High | Partial | Add a **surface/device axis**; store the angular *need* in the synced AbilityModel and derive per-surface fontScale **locally** (SurfaceProfile stays device-local — make this explicit in the plan). Replace the magnitude heuristic with **typed unit tags** on every numeric value. |
| Stale signed export/import replays a corrected setting (no nonce/version vector); `conditionsMet` uses local `getHours()` → time-gated adaptation fires in the wrong timezone after travel. | High | No | Stamp every export and field with HLC/version + nonce; reject causally-older imports; store time conditions with an explicit reference frame and a tz-aware Clock. |

### Theme F — Long-horizon drift & consolidation error

| Failure mode | Severity | Plan handles? | Fix |
|---|---|---|---|
| `Math.max` font ratchet: text can only grow; vision recovery/cataract surgery can never shrink it; one bad day floors every future value. | High | No | Replace `Math.max` with specificity-wins+recency; an explicit lower user-set **SUPERSEDES** the higher inferred fact; periodic "still needed?" re-validation. |
| `stable`=Infinity facts never decay **and** never re-validate: degenerative progression freezes at a stale snapshot; recovery-or-progression both unhandled. | High | Partial | Even stable facts carry a **re-validation interval** (proposal, not auto-change); distinguish "measured need" (re-validate) from "user-stated preference" (durable); compute longitudinal **trends** in the dream. |
| Confidence is asserted, never calibrated: `UPDATE`/accept only ever raise it; repetition → ~1.0 regardless of correctness; a user edit that undoes output is ignored instead of lowering confidence; inflated confidence then travels cross-app. | High | No | Confidence decays toward a prior on time-since-last-**confirmation** (not last-access); a contradicting user edit **lowers** it; cross-app re-import of a self-originated fact is NOOP, never corroboration; cap exported confidence; require evidence-count, not a bare scalar. |
| Hallucinated `SUPERSEDE` (zero threshold, no confirmation) permanently rewrites an invariant; 30-day purge + evidence-discard then destroy the antidote and the audit trail; `lastAccessed`-touch makes a wrong-but-hot fact immortal. | High/Critical | No | Gate `SUPERSEDE` of stable/floor/high-importance facts behind corroboration + a confidence-delta floor + the proposal path; keep an append-only lineage/tombstone log for AbilityModel-class facts surviving the 30-day purge; decouple `lastAccessed` (surfacing) from `lastConfirmed` (user accepted). |
| **P0 freezes today's lifecycle bugs into the durable cross-language spec** at its least-tested moment, then replicates them to every conformer. | Medium | No | Add long-horizon simulated-clock tests (confidence calibration, situational demotion, supersede-gating, round-trip schema preservation) to the conformance suite; explicitly **version the lifecycle/decay policy** as part of the spec. |

### Theme G — Cross-app integrity & adversarial consumers

| Failure mode | Severity | Plan handles? | Fix |
|---|---|---|---|
| Provenance is a free-text string and confidence an unsigned float → any write-granted/compromised app forges `{source:'xr', confidence:1.0}`; the consumer can't verify (evidence was discarded). | Critical | No | Per-app **signing keypair** at grant time; sign `{source,kind,value,confidence,evidenceDigest,grantId,nonce,ts}`; broker verifies against the granted principal and **recomputes** confidence per source-trust tier (sender can't self-assert final confidence; cap single-correction insights low). Display the **verified** producer. |
| `respondToProposal` doesn't know which principal answered → a malicious consumer can **plant a proposal and accept its own** (manufacture consent end-to-end). `setProfileField` "user-initiated" path bypasses the gate entirely. | Critical | No | Consumers may **only enqueue** proposals, never respond; responding is reserved to the local trusted user-surface, authenticated separately. Cross-app/cross-device "user-initiated" must always route through the proposal path. Stamp every applied change with responder identity + surface. |
| Confidence amplification loop: A writes a guess → B observes the resulting behavior → writes it back as "corroboration" → ratchets to 1.0 with no new signal; evidence-discard hides the echo. | Critical | No | Tag **origin-evidence lineage**; refuse to count a cross-app insight as independent corroboration of its own ancestor; cap cumulative gain per aspect/window; mark imported-then-accepted facts **derived-not-observed** so they can't close the loop. |
| Revocation/deletion don't propagate: imports are copied into the consumer's native shard severed from the grant; revoke/delete on one device leaves live copies everywhere; stale-import resurrection (no tombstones). | High/Critical | No | Imports retain immutable `grantId/originId`, stored grant-scoped (leases), never copied free-standing; revocation publishes **tombstones** consumers honor on next sync/use (pull-based for offline); tombstones dominate concurrent updates. |
| Grant scope-creep: a narrow text-size write can submit `add-profile-action` with an arbitrary prompt; coarse read grants silently widen as reflection adds facets; aspect-string squatting/collision DoS. | High | No | Broker enforces grant scope on the **write/proposal path** (validate `{op,path,scope,kind}` ⊂ granted set; reject, don't surface); procedural-action writes are a separate higher-sensitivity capability; **namespace** aspects/proposals by verified principal + grantId. |
| One compromised consumer poisons the shared model for all (no per-app blast-radius isolation; the canonical shared store trusts the writer); prompt-injection laundered through a free-text "style preference" into both surfaces. | Critical | No | Per-principal **write quarantine/staging**; promotion only via user-confirmed proposal + independent corroboration; the style preference is a **closed enumerated schema** mapped to app-authored prompt fragments (no free text spliced into a prompt). |

### Theme H — Governance, regulation & liability

| Failure mode | Severity | Plan handles? | Fix |
|---|---|---|---|
| No grant audit log → Art.15/Art.30 "who accessed my disability data" is unanswerable despite "auditable" claim. | High | No | First-class append-only **`mine.grantLedger`** written *before* any read returns; `getAccessHistory()` wired to the panel. |
| Right-to-be-forgotten fails across apps; export blob is signed not **encrypted** (a portable plaintext health dossier; QR/file/Downloads leak); institutional (FERPA/HIPAA) deployment has no posture; ADA/EU Accessibility Act non-regression liability when an inferred adaptation makes a service **less** accessible than baseline. | Critical/High | No | Deletion/revocation **propagation** protocol; **encrypt** exports recipient-bound + expiry + minimized; add a **deployment-context** concept (consumer vs institutional: on-prem/zero-retention LLM, no cloud sync, access logging) or declare institutional use unsupported; spec a **non-regression invariant** (an inferred adaptation must never disable an assistive affordance below the host baseline without explicit user action) + host kill-switch + per-adaptation record. |
| Liability/safety attribution gap when a poisoned/mis-derived setting causes harm in a safety-critical XR context. | High | No | Surfaces in safety-critical contexts receive an **inferred-vs-explicit flag + confidence band** and fall back to a conservative default below threshold/on conflict; carry provenance to the point of application; SurfaceAdapter may **abort** rather than silently degrade. |

---

## 4. Severity-ranked risk register

| # | Risk | Severity | Handled? | Recommended mitigation |
|---|------|----------|----------|------------------------|
| R1 | No identity/data-subject/supporter model under sync + cross-app sharing; shared accounts cross-contaminate and apply one person's adaptation to another | Critical | No | Acting-subject + supporter principal + "held-for-joint-review"; `subject` field on observations (Theme A) |
| R2 | Whole AbilityModel + sensor inference is Art.9 health data with no enforced floor/consent/DPIA; "never inferred/stored" unenforced | Critical | No | Reclassify as special-category; enum vocab + output filter; sensor + content/context floor; Art.9 consent; DPIA before Phase 3 (Theme C) |
| R3 | Consent inaccessible/inert for target users (`language='plain'` & `consentBoundary` unconsumed; visual-only UI; one tap writes profile) | Critical | No | Consent as accessible PORT obligation; plain-language pass; enforce `consentBoundary`; high-stakes tier → joint review (Theme B, §2 changes) |
| R4 | Unsatisfiable/hard/conflicting needs fail silent-and-wrong; floors silently dropped; no streaming port for braille | Critical | No | Requirement-strength axis + composability check + `cannot-satisfy` verdict + streaming port (Theme D) |
| R5 | Provenance/confidence forgeable; compromised consumer poisons shared model / self-accepts proposals; no blast-radius isolation | Critical | No | Signed insights, broker-recomputed confidence, enqueue-only consumers, per-principal quarantine (Theme G) |
| R6 | Revocation/deletion/erasure don't propagate across apps & devices; stale-import resurrection | Critical | No | Tombstones + grant-scoped leases + version/nonce + propagation protocol (Themes E, G, H) |
| R7 | Confidence amplification loop launders a guess into certainty; cross-app echo manufactures "corroboration" | Critical | No | Origin-evidence lineage, idempotent confidence, cap cross-app gain (Themes F, G) |
| R8 | Lifecycle drift baked in by P0 gate: Math.max ratchet, stable=∞, uncalibrated confidence, hallucinated SUPERSEDE, 30-day purge of audit trail | High | No | Fix merge/decay/confidence/supersede + lineage log; add long-horizon conformance tests before lifting as spec (Theme F) |
| R9 | No situational/temporary lifecycle; transient states promoted to permanent traits; conditions are clock-only | High | No | Situational/transient class with TTL + active demotion; situational predicates from Sensors (Theme D) |
| R10 | Angular-sizing flagship mechanism essentially unbuilt; web/mobile can't sense distance; merge copies/MAXes the number | High | No | Angular schema + normative per-surface derivation + assumed-distance low-confidence flag + nudge-feedback loop (S1/S2; Amendment 4) |
| R11 | Sync conflicts: whole-object LWW, wall-clock tiebreak, split-brain local-vs-sync, no offline merge | High | No | Field-level CRDT/HLC merge; logical Clock; define authoritative tier (Theme E) |
| R12 | Per-app proposal caps don't aggregate; duplicate-prompt storms; push interrupts mid-task; self-modifying suggester hostile to predictability | High | No | Person-level budget + cross-app dedup + pull-not-push Notifier + predictability posture (Theme B) |
| R13 | freeText sent to third-party LLMs verbatim; coarse grants over-disclose the disability constellation; provenance defeats unlinkability | High | Partial | Quarantine freeText; field-level grants; derived-settings-only tier; minimize wire provenance (Theme C) |
| R14 | Graduated consent escalates to permanent suppression; aspect-global; asymmetric — kills hard needs for memory-impaired/cognitive users | High | Partial | Non-binary tier, scope-chained suppressions, reversible, never auto-escalate (Theme B) |
| R15 | No grant audit log; no encrypted export; FERPA/HIPAA & ADA/EU-AA non-regression liability | High | No | grantLedger; encrypted/minimized exports; deployment-context; non-regression invariant (Theme H) |
| R16 | Smoothing friction removes the protective help-seeking signal on unfamiliar high-stakes pages (privacy floor fails open on unknown category) | High | No | "unfamiliar+high-stakes" context-class suppresses friction-smoothing; unknown category → conservative posture (S5; Theme D) |
| R17 | Consolidation ~20% loss preferentially drops rare safety axes; LLM hallucination adds ungrounded facts | High | Partial | Protected safety class; union-not-overwrite UPDATE; reject ungrounded ADDs (Themes D, F) |
| R18 | ArtInsight uploads a minor's image to a persistent third-party thread; no child-data/COPPA posture; discard policy can't reach it | Critical | No | Child-subject class local-only/non-portable; on-device/redacted description; zero-retention vendor tier; parental-consent surface (Themes A, C) |
| R19 | Cross-device transport (iPhone→work/managed desktop) puts special-category data on untrusted/MDM devices on the least-built tier | Medium | No | Per-device trust class; refuse special-category export to managed/untrusted devices without per-transfer consent; encrypt + ephemeral (Themes A, E) |
| R20 | Demo mode disables caps AND ignores suppressions | Medium | Partial | Build-time-only flag, never overrides suppressions, loud banner, conformance test (Theme B) |

---

## 5. Concrete amendments to `docs/toolkit-refactor-plan.md`

1. **§6 Identity — replace "One person, many apps" with a fuller identity model.** Add a **data-subject** field on every observation/insight, a lightweight **acting-subject** selector for shared accounts/devices, and a **supporter principal** with a **`held-for-joint-review`** proposal status (terminal-blocking for high-stakes aspects; supporter sets/locks policy but cannot unilaterally accept). State explicitly that multi-co-user-on-one-account is otherwise **unsupported** and how it degrades. *(R1, R18)*

2. **§5 Ports — make consent a first-class accessible PORT, not a popup.** Extend `Notifier` to `Notifier{present(proposal|grant), capture(response), timing-policy}` carrying an accessible-description payload, batching, and quiet-hours; add a **`ConsentSurface`** obligation that every grant/proposal renders and is acceptable/declinable/revocable on the host's reliable modality (TTS/braille/keyboard) with **zero pixels perceived**. Add a conformance test for this. *(R3, R12)*

3. **§5 Ports — split `Surface` and add a streaming sink.** Keep `Surface{apply(settings)}` for level-triggered settings; add optional **`TextStreamSink{push(chunk,seq), ackCursor(seq), onAdvanceRequest(cb)}`** with ordering + back-pressure (braille/live-region pacing). Change the SurfaceAdapter contract to return a **structured result** `{appliedChannels, unmet[], degradedTo, verdict, salvage?}` — a SurfaceAdapter MUST be able to report `cannot-satisfy`, and silent success when a hard requirement is unmet is a conformance failure. *(R4)*

4. **§2/§7 Schema — make every quantity typed and add the angular need.** Every numeric setting/insight carries `{kind, unit, value}` (e.g. `angularTextHeight:deg`, `fontScale:percent`, `verbosity:ordinal`); **delete** the `>10` multiplier/percent heuristic via a one-time migration. Specify the **angular schema** `{angularHeightDeg, measuredAtDistanceCm|null, confidence, source}` and a normative per-surface derivation formula + default-distance table; distance-assumed surfaces emit **low-confidence** proposals plus a "still too small?" correction loop. Add conformance test vectors. *(R10, R11)*

5. **§2 Schema — add a requirement-strength axis and a situational lifecycle.** Records carry `strength ∈ {floor, preference, hint}` (floors applied last, may only tighten, never silently dropped, immune to decay/summarization) and `lifecycle ∈ {durable, situational/provisional}` with TTL + active demotion in `reflect()`. Add a post-merge **composability check** + channel-substitution table. Mark safety/harm-prevention facts a protected class. *(R4, R9, R17)*

6. **§6 + new §6a — enforce sensitivity, not just name it.** Reclassify the **entire AbilityModel and all sensor-derived inferences as Art.9 special-category**; require an Art.9 consent gate before any inference *runs*; replace free-text ability fields with a controlled vocabulary; add an output classifier that blocks diagnosis-shaped strings; quarantine `freeText` from export and remote-LLM prompts. Run the **privacy floor on sensor ingestion and observation content/context** (not just hostname); make unknown category fail-**safe**. Add **field-level grants** and a **derived-settings-only** grant tier. *(R2, R13, R16)*

7. **§6 — sign insights and authenticate proposal responses.** Per-app keypair at grant time; the broker stamps/verifies `source` and **recomputes** confidence per source-trust tier (sender can't assert final confidence; single-correction capped low). Carry **origin-evidence lineage**; re-import of a self-originated fact is NOOP, never corroboration. **Consumers may only enqueue proposals; responding is reserved to the local trusted user-surface.** Enforce grant scope on the **write/proposal path** (reject out-of-scope `{op,path,scope,kind}`); procedural-action writes are a separate higher-sensitivity capability; namespace aspects by principal+grantId; per-principal write quarantine. *(R5, R7)*

8. **§6 + §9 — define revocation/deletion propagation and replay protection.** Imports are grant-scoped **leases** with `grantId/originId`, never free-standing copies. Revocation/deletion emit **signed tombstones** propagated along grant edges (pull-based for offline), dominating concurrent updates. Every export carries a monotonic **version/HLC + nonce**; receivers reject causally-older or replayed blobs. **Encrypt** exports recipient-bound + expiry (not merely signed); add a per-device **trust class** (personal vs managed) that refuses special-category export to untrusted devices without per-transfer consent. *(R6, R15, R19)*

9. **§6/§8 Phase 0–2 — replace the lossy lifecycle, and gate it.** Replace `Math.max` numeric merge with specificity+recency (downward correction allowed; an explicit lower user-set SUPERSEDES a higher inferred fact). Decouple `lastAccessed` (surfacing) from `lastConfirmed` (user accepted); base decay/score on the latter. Confidence decays toward a prior on non-confirmation and **drops on contradiction**. Gate `SUPERSEDE` of stable/floor/high-importance facts behind corroboration + the proposal path. Keep an append-only **lineage/tombstone log** for AbilityModel-class facts that survives the 30-day purge; even stable facts carry a re-validation interval. **Add long-horizon simulated-clock conformance tests** and **version the lifecycle/decay policy** as part of the spec — do this *before* §8 Phase 0 lifts `librarian.js` as source of truth. *(R7, R8)*

10. **§5/§6 — sync as a first-class concern with a defined merge.** State which stores are device-local vs roaming and why; reconcile the local-explicit-records / sync-profile split-brain. Store the angular **need** in the synced AbilityModel and derive **SurfaceProfile locally** (per-device). Merge via field-level CRDT/HLC (never wall-clock); the **Clock** port exposes a logical/hybrid clock and timezone; treat a freshly-synced cross-device change like a cross-app insight (route through the proposal path, not silent auto-apply). *(R11, R3)*

11. **§6/§9 — proposal cadence, governance, and non-regression.** Add a **person-level proposal budget** + cross-app dedup by `(person, aspect)`; default **pull-not-push**; add a first-class **predictability/quiet posture** that freezes proactive proposals *and* slow-lane self-modification and guarantees stable control placement. Add a first-class **`mine.grantLedger`** (write-before-read; `getAccessHistory()`). Add a **non-regression invariant**: an inferred adaptation may never disable/downgrade an assistive affordance below the host baseline without explicit user action; provide a host kill-switch and per-adaptation audit. Reconcile the `30`-vs-`3` cap default; make demo mode build-time-only and never override suppressions. *(R12, R14, R15, R20)*

12. **§8 Phase 4 / §10 — surface the missing dimensions and consumer realities.** Add **input-modality adaptation** (keyboard-only/switch/dwell/voice, focus order, no keyboard trap, visible focus) as a SurfaceAdapter target — the model is currently visual/cognitive-output only. Make `language` a real **locale + reading-level** field (with RTL/bidi) rather than `standard|plain`, and a **color-vision** axis (don't-encode-by-color-alone) — both are advertised/implied grant scopes that don't exist. Define a **deployment-context** concept (consumer vs institutional). Quantify the **resource/latency/offline budget** and a deterministic fallback floor for when the LLM port is unavailable, since the engine currently no-ops silently and the episodic log truncates behind the unprocessed cursor. *(completeness critic)*

13. **§3/§4 — re-scope the procedural-memory cross-app claim.** Store procedural memory as an **abstract intent** ("audio→reflowable-text→preferred-channel:braille") plus surface-specific realizations compiled at apply time, never as web DOM action steps (`.ytp-*` selectors) shipped cross-surface. The plan currently presents procedural memory as the most-portable; it is the **least**-transferable kind. *(completeness critic, S3)*

---

## 6. What we deliberately did *not* cover / residual unknowns

These were surfaced by the completeness critic and are **not** adequately probed by the five scenarios; treat them as known blind spots, not as cleared.

- **Pure-motor / keyboard-only (Ade).** The only persona never scenario-tested. Reveals that the whole architecture is silently a *visual/cognitive-output* system with **no input-adaptation dimension** (focus order, switch/dwell/voice, keyboard traps). High severity — a missing dimension, not a missing scenario. *(Amendment 12)*
- **Language / non-English / translation / RTL.** `language` is a `standard|plain` English flag; `reading.level` is a phantom grant scope (exists nowhere in code). Multilingual, reading-grade, and bidi interactions with magnification are untested. *(Amendment 12)*
- **Color-vision deficiency (Lexie).** No color axis; "don't encode by color alone" / recolor-with-non-color-cues is unrepresentable; a wrong recolor can make charts *less* readable (non-regression hazard considered only for captions/text). Color-vision deficiency is also sex-linked genetic/familial data, arguably more sensitive than a coarse `vision` category. *(Amendment 12)*
- **Pure-deaf, fully-sighted (Dhruv).** Captions-as-a-positive-capability path was never validated independently of Marta's conflict case — so caption **quality/accuracy** as an accessibility need, **sign-language** preference (text ≠ ASL/BSL; reading-level assumptions can be wrong for prelingually-Deaf users), and "suppress audio-only adaptations" are all unmodeled.
- **Caregiver/supporter as a *positive* flow at scale** (beyond Sophie+Priya): set-up-by-one-used-by-another, shared family/lab/library devices, "guest/not-me" mode, caregiver handoff.
- **Accessibility of the Toolkit's own management surfaces for the *full* persona set** (only blindness/braille was stressed). The grant/consent/understanding-panel/Adapter-Creator surfaces must be self-accessible to ADHD, autistic, cognitive, deaf, color-blind, and keyboard-only users *simultaneously*; each breaks differently.
- **Efficacy/outcome measurement.** Nothing anywhere asks "did the adaptation actually help, and how would we know." The only feedback is "user clicked accept" (which is also a poisoning vector). Blocks the regulatory non-regression claim and any quality ground truth.
- **Cost / latency / battery / offline budget** of an LLM-backed memory engine on phone/XR/iOS, and whether a low-income user can rely on an always-needs-cloud-LLM architecture; no deterministic fallback floor specified.
- **Compound/intersecting needs** where one adaptation's output is another's input (deaf+dyslexic → does the simplify pass run on the caption stream? low-vision+RTL+magnification → does enlargement break bidi?), and the **elderly/temporary-overlap majority** who reject the disability frame entirely ("helpful to someone who will never tick a disability box").
- **Grant lifecycle & teardown horizon:** grants that never expire, and uninstall / account-deletion / device-loss / death of a special-category personal-understanding store. The data outlives the user's attention to it.

**Relevant file:** `/Users/jason/Developer/AI-for-Accessibility-Toolkit-Draft/docs/toolkit-refactor-plan.md` (also note the untracked `docs/adapter-overlap.md`, not reviewed here).
