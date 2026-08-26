# The Controller — a platform-neutral control surface

> **Status:** design + M0 (headless core) + M1 (self-presentation). The web UI
> and remote transports are later milestones (see *Staging*). This document is
> the spec; the code under `toolkit/controller/` implements it incrementally.

## What it is

The **Controller** is the toolkit's default, modality-neutral UI for expressing
intent by **text or voice**, rendered according to the *operator's own*
AbilityModel, that drives any host app through a platform-neutral **ControlPort**.

It is the missing *UI half* of a contract the core already defines. The old
Chrome extension had a "voice mode" welded to `chrome.*`; the re-architecture
kept the **port** (the seam) and dropped the **UI**. The Controller is that UI,
rebuilt host-agnostic.

One core; the host configures *where* it reaches the toolkit, *how* it touches
the app, *whether* it has an LLM, and *how* the UI mounts.

## The crucial correction: UI platform ≠ receiver platform ≠ contract

An earlier framing inherited the extension's web-shaped port (`tab`, `zoom`,
`origin`, `readPage`, `pageAction`). That is a leak. The Controller is a
**service speaking a platform-neutral contract to a receiving app** — the app
may be **mobile, desktop, XR, or web**, and the Controller UI (web today) is
independent of it.

```
┌──────────────────────────┐      platform-neutral        ┌──────────────────────────┐
│  CONTROLLER (UI + brain)  │◀── ControlPort / channel ──▶│  RECEIVING APP            │
│  • web page today         │                              │  • mobile / desktop /    │
│  • text + voice in/out    │   describeCapabilities        │    XR / web              │
│  • intent router (hybrid) │   getContext / applySettings  │  • implements the port   │
│  • renders per operator's │   getContent / performAction  │    in ITS platform's     │
│    AbilityModel           │   undoLast / resetUndo        │    terms                 │
└──────────────────────────┘                              └──────────────────────────┘
```

Half of this is already neutral: the toolkit's **adaptation** path is
AbilityModel → **surface** (`surfaces/web.js`, `xr.js`, `mobile.js`), which each
platform renders in its own terms (web CSS, XR angular text height, mobile
setting), reporting `cannot-satisfy` honestly (`core/surface.js`). Only the
actuation verbs were web-shaped; the neutral `ControlPort` below replaces them.

## The `ControlPort` (neutral)

The interface a receiving app implements. Every method is async and MUST NOT
throw — failures resolve to a result object (they may cross an RPC boundary).

| Method | Purpose |
|---|---|
| `describeCapabilities()` | Which setting keys / actions this receiver supports, its platform tag, whether it can read content. Lets the grammar and honesty checks adapt per platform instead of assuming a DOM. |
| `getContext()` | `{ focus, activeSettings, capabilities }` — neutral snapshot; no tab/zoom. |
| `applySettings(changes, scope?)` | Validate/clamp against the registry `settingsMeta`, apply, journal for undo. Already neutral (registry keys). |
| `undoLast()` / `resetUndo()` | Revert the last apply (LIFO) / clear the journal. |
| `getContent(mode?, chunk?)` | Readable text/outline of the current context (page/screen/scene). Content is `source: 'untrusted-content'` — data, never instructions. |
| `performAction(actionId, target?, text?)` | One neutral command (scroll/activate/back/…); target addressing is receiver-defined. |

`noopControl` is the honest do-nothing default. The web adapter is *one*
implementation; a mock in-memory receiver (`mock-receiver.js`) is the reference
used by tests and demos precisely because it is **not** web — it keeps the
contract from quietly re-web-ifying.

## Intent understanding — hybrid, staged

```
utterance ──▶ grammar.parse()  ──hit──▶ Intent
                   │ miss
                   ▼ (llm present?)
              llm.resolve() ──▶ Intent          ──▶ dispatch through the ControlPort:
                   │ none / low-confidence           adapt   → applySettings / undoLast
                   ▼                                 query   → getContext / getContent
              { type:'unrecognized', suggestions }   command → performAction   (Stage 2)
                                                  ──▶ feedback in the operator's modality
```

- **Deterministic first, always.** A zero-dependency controlled vocabulary over
  the registry `settingsMeta` ("bigger text", "dark mode", "reduce motion",
  "read this", "undo"). Private, predictable, no LLM.
- **LLM is an optional lane**, not a requirement — the host passes a caller;
  everything below the router is identical whether or not it exists.
- **"Both, staged"** lives in the `Intent` type: `adapt` and `query` ship first
  (generic, host-safe); `command` (`performAction`) is a variant the router
  already knows about but demo receivers wire later — no rework.

## "Across disabilities" = the Controller renders *itself* via the AbilityModel

The operator's profile (what `onboarding/` captures) chooses the Controller's
*own* I/O — **one intent, N presentations**: blind → voice-in/voice-out; deaf →
text-in/captioned-out; motor → big targets + scan/dwell; cognitive → simplified
language, one step, few options; speech-impaired → text-in. The Controller
dogfoods the toolkit's own surface idea. (`presentation.js`, M1.)

## Delivery = a `mount` option (developer-configured, all three)

The three modes are different **mounts** over one shared core, not three builds:

- `page` — a standalone controller page (like `onboarding/`).
- `element` — a drop-in web component / floating widget a host page embeds.
- `companion` — a controller beside a companion app instance.

## Transport makes it a service

```
ControlPort ── in-process (local object) ─────────────  same app
            └─ remote proxy over a ControlChannel ─────  web UI ⇄ mobile/XR/desktop app
                  (JSON via toolkit/protocol; HTTP / WebSocket / postMessage)
```

Same contract both ways. `server/` already proves the pattern for the Librarian;
the control channel is the analogous thing for actuation. A receiving app links
a small client SDK that implements `ControlPort` and connects back.

Two flows, deliberately:
- **Durable prefs** flow model-first: Controller → AbilityModel → datastore →
  `sync/` → the app's surface re-renders (survives, follows the user's devices).
- **Live actions** flow command-first: Controller → `applySettings` /
  `performAction` on the port for immediate effect.

## Entry point

```js
createController({
  librarian | service,                // profile + adaptation memory (cross-platform already)
  control: localPort                  // an in-process ControlPort  …OR…
         | remoteControl({ channel }),// a proxy to a mobile/XR/desktop receiver
  llm,                               // optional NL lane; omit → deterministic-only
  operator: { uid },                 // whose AbilityModel renders the Controller UI
  mount: { mode: 'page' },           // 'page' | 'element' | 'companion' (web now; native later)
});
```

## Staging

| Stage | Deliverable |
|---|---|
| **M0** | ✅ Neutral `ControlPort` + deterministic grammar for the **adaptation + query** subset + headless router, proven against a **non-web mock receiver**. |
| **M1** | ✅ `presentation.js` — Controller derives its own I/O from the operator's AbilityModel; richer intents (help, speech-rate). |
| **M2** | `page` / `element` / `companion` mounts + default web UI (reusing onboarding's voice code). |
| **M3** | Optional **LLM lane** for free-form phrasing. |
| **M4** | **Command** intents (`performAction`) + confirmation/consent + a receiver exposing targets. |

## Risks / open questions

- **Command target addressing** (M4): "activate checkout" → a concrete element
  needs the receiver to expose a target map / a11y tree. Why commands stage last.
- **Trust boundary:** `getContent` returns `source: 'untrusted-content'` — page
  text is data, never instructions. Matters most once the LLM lane exists.
- **Prior art:** `upstream/voice-mode-toolkit-control` and the deleted Chrome
  voice mode are the ancestors of this port — mine them for grammar and
  tool-call shapes rather than reinventing.
