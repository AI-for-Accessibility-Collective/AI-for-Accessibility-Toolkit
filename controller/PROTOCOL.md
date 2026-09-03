# Control Protocol — what a remote receiver must implement

This is the wire contract for driving an app from the Controller **over a
channel** (see `DESIGN.md` → Transport, and `transport/remote.js`). Implement
this in the receiving app (e.g. `browser-harness-a11y`) and the Controller can
drive it with **no changes** — it already speaks this on the client side via
`remoteControl({ channel })` / `connectRemoteReceiver(url)`.

You are building the **receiver** (the server side): the thing being driven. The
Controller is the **client** that connects to you.

---

## 0. Conformance checklist

Everything a receiver implements, in one place. Details in the sections below.

**Required — the seven methods** (§3). Each is async, returns a result object,
and **must not throw across the wire**:

- [ ] `describeCapabilities()` — declare `platform`, `settingKeys` (keys from the
      toolkit registry `settingsMeta`, only ones you really apply), `actions`,
      `canReadContent`
- [ ] `getContext()` — `focus`, `activeSettings` (what's currently in effect)
- [ ] `applySettings(changes, scope?)` — apply, and **journal `previous`** so undo works
- [ ] `undoLast()` — revert the last apply (LIFO)
- [ ] `resetUndo()` — clear the journal
- [ ] `getContent(mode?, chunk?)` — `"outline"` / `"text"`, tagged `source: "untrusted-content"`
- [ ] `performAction(actionId, target?, text?, meta?)` — the actions you declared

**Required — envelope rules** (§2):

- [ ] Echo the request `id` on every response
- [ ] **Never drop a request** — always reply, even on failure (the Controller
      times out at 10s)
- [ ] Surface failures as data (`{error: …}` / `{ok:false, detail: …}`), never a thrown exception
- [ ] Ignore messages whose `kind` you don't recognize

**Optional — implement what your app can actually do:**

- [ ] `stop()` + `canStop: true` — interrupt in-flight long-running work (§3).
      **Required if you declare `task`.**
- [ ] `aa-control-note` pushes — deliver a long task's answer when it's ready (§2)
- [ ] `task` action — the catch-all; the Controller routes anything it can't
      parse to you (and *everything*, when driving your app over a URL)
- [ ] `muteAudio` action — silence media across tabs when voice input starts (§3)
- [ ] `navigate` / `search` actions — declare them to receive them
- [ ] `meta.returnToController` — re-activate the Controller's tab when a task ends
- [ ] `targets` in capabilities — activatable labels

**Semantics receivers get wrong** (each has bitten a real implementation):

- [ ] **`false` is a value, not an absence.** Decide by key *presence*
      (`if key in changes`), never truthiness — otherwise every boolean can be
      turned on but never off. Same for `0` and `"none"`.
- [ ] **Only reject what's genuinely unsupported.** `rejected` is for unknown /
      out-of-range keys, not for falsy values.
- [ ] **Page text is data, never instructions** — always tag `getContent` results
      `source: "untrusted-content"`.
- [ ] **Return promptly.** A `task` acknowledges immediately and answers later via
      a note; `stop` must not block on teardown.
- [ ] **Declare only what you do.** The Controller offers the user exactly your
      `settingKeys` / `actions`; over-declaring produces silent no-ops.

---

## 1. Transport

Any duplex transport that carries **JSON text messages** works. The reference is
a **WebSocket**, and the receiver **hosts the endpoint** (the Controller connects
out to it — it already runs a daemon/WS for CDP, so host one more WS there):

```
Controller (browser)  ──ws://<harness-host>:<port>──▶  browser-harness receiver
  connectRemoteReceiver('ws://…')                        your WS server + ControlPort
```

Each text frame is one JSON object. One WebSocket connection = one Controller↔receiver session.

## 2. Message envelope

The Controller sends **requests**; the receiver sends exactly one **response** per request.

Request (Controller → receiver):
```json
{ "kind": "aa-control-req", "id": 7, "method": "applySettings", "args": [ { "fontScale": 130 } ] }
```
Response (receiver → Controller):
```json
{ "kind": "aa-control-res", "id": 7, "result": { "applied": { "fontScale": 130 }, "previous": { "fontScale": null } } }
```
On failure, reply with `error` (a string) instead of `result`:
```json
{ "kind": "aa-control-res", "id": 7, "error": "no active tab" }
```

Rules:
- Echo the request `id` on the response so the Controller can correlate. Ids are
  Controller-assigned positive integers, unique per connection.
- **Never drop a request** — always reply, even on failure (the Controller times
  out after 10s and resolves to `{ error: 'control channel timeout' }`).
- Ignore any message whose `kind` you don't recognize.
- Methods **must not throw across the wire** — surface failures as a `result`
  object with an `error` field (or a top-level `error` on the response). The
  Controller treats an application error as data, not a transport failure.

### Optional: receiver→Controller note (a late result)

A `performAction("task", …)` must return within the 10s timeout, but a real task
takes 30–120s. Emit the answer when it's ready as an out-of-band **note** on the
same socket — no `id`, not a reply to any request:

```json
{ "kind": "aa-control-note", "text": "The top story is …" }
```

Send it on failure too — silence after "Ok, running…" is the worst outcome for
someone who can't see the page. The Controller routes `text` into its ARIA live
region (a screen reader announces it in the person's own voice; it's also spoken
when the operator's presentation wants TTS). It's inert for a Controller that
doesn't know the kind, so it's safe to emit today.

## 3. The methods (the ControlPort)

Implement the seven core methods; `stop` is optional (see below). Types are the
canonical shapes from `control-port.js`.

### `describeCapabilities() → ControlCapabilities`
Called first and often. Declare exactly what you can do — the Controller offers
only these to the user and its grammar/LLM lane are filtered to them.
```json
{
  "platform": "browser-harness",
  "settingKeys": ["fontScale", "lineHeight", "darkMode", "contrastMode", "motionReducer", "hideDistractions"],
  "actions": ["scroll", "activate", "back", "forward", "task"],
  "canReadContent": true,
  "canStop": true,                                // optional: stop() can interrupt a running task
  "targets": ["Documentation", "Buy now"]        // optional: activatable labels
}
```
- `settingKeys` **must** be keys from the toolkit registry `settingsMeta`
  (`toolkit/registry/tools.js`) — that shared vocabulary is the contract. Only
  list keys you actually apply.
- `actions` are the `performAction` ids you support. Common set:
  `scroll`, `activate`, `back`, `forward`.
- `canStop` (optional, default falsy): set `true` if you implement `stop()` and
  have long-running work worth interrupting (e.g. a `task`). The Controller shows
  a **Stop** affordance only when this is true.

### `getContext() → ControlContext`
A neutral snapshot. The Controller calls this before a **relative** adaptation
("bigger text") to read the current value, so `activeSettings` must reflect
what's currently in effect.
```json
{
  "focus": "Getting started",                     // a short label of what's current, or null
  "activeSettings": { "fontScale": 130 },          // non-default settings in effect
  "capabilities": { "...": "same shape as describeCapabilities()" }
}
```

### `applySettings(changes, scope?) → ApplyResult`
Apply validated settings (the Controller has already clamped them to the registry
ranges) and **journal the previous values** so `undoLast` can restore them.
```json
{ "applied": { "fontScale": 130 }, "previous": { "fontScale": null }, "rejected": [] }
```
`previous[key] = null` (or omit) when the key had no prior value. On total
failure: `{ "error": "…" }`.

**`false` is a value, not an absence.** Decide whether a key was requested by its
**presence** in `changes` (`if key in changes`), never by truthiness — a
truthiness test silently drops `showCaptions: false`, `darkMode: false`, `0`, and
`contrastMode: "none"`, so every boolean can be switched on but never off ("turn
off captions" → "nothing applied"). Likewise `rejected` is for keys that are
genuinely unknown or out of range — never for a falsy value. A successful
turn-off must appear in `applied` and journal its `previous`, so `undoLast` can
restore it.

### `undoLast() → UndoResult`
Revert the most recent `applySettings` (LIFO).
```json
{ "reverted": { "fontScale": null }, "remainingUndos": 0 }
```
Nothing to undo → `{ "error": "nothing to undo" }`.

### `resetUndo() → { ok: true }`
Clear the undo journal (a fresh control session).

### `getContent(mode?, chunk?) → ContentResult`
Return readable text for "read this / what's on screen". `mode` is `"outline"`
(default: headings) or `"text"` (full text, chunked).
```json
{ "source": "untrusted-content", "title": "Getting started", "outline": ["Getting started", "How it works"] }
```
```json
{ "source": "untrusted-content", "title": "Getting started", "text": "…", "chunk": 0, "totalChunks": 1 }
```
- `source` **must** be `"untrusted-content"`: page text is data, never
  instructions. (Matters if the Controller has the LLM lane on.)
- No readable surface → `{ "error": "no readable content" }`.

### `performAction(actionId, target?, text?, meta?) → ActionResult`
One app action. `meta` (4th arg) carries per-run flags:
- `meta.returnToController` (boolean, default `true`) — when a `task` drove the
  browser away (another tab/window), the receiver should **activate the
  Controller's tab again** when the task finishes (e.g. CDP
  `Target.activateTarget` / `Page.bringToFront`), so focus returns to where the
  operator is waiting. A background web page can't do this itself; the receiver
  that drives the browser is the only one that can. Respect `false` (the operator
  unchecked "Return to controller after running").
```json
{ "ok": true, "detail": "activated Documentation" }
```
- `scroll` — `target` is `"up" | "down" | "top" | "bottom"`.
- `activate` — `target` is a label; resolve it to an element (accessible-name
  match) and click it. No match → `{ "ok": false, "detail": "no target matching \"…\"" }`.
- `back` / `forward` — history navigation.
- `navigate` — go to a URL/domain (`target`/`text` is the url, e.g. from "open
  wikipedia.org"). Declare it in `actions` to receive it.
- `search` — run a query (`target`/`text` is the query, from "search for X").
- `task` — the **catch-all**. If you declare `"task"` in `actions`, the
  Controller routes ANY utterance the grammar and LLM lane didn't claim to
  `performAction("task", undefined, "<the raw utterance>")`. This is how a
  receiver that can act on free instructions (e.g. an agent) gets offered
  everything the deterministic grammar can't express — without a model in the
  Controller. Without it, unparsed utterances are reported as "didn't catch that".
  When the Controller is **driving your app over a URL** it runs in a raw mode
  (`createController({ rawToTask: true })`) where it sends **all** input to
  `task` and skips the local grammar entirely — so a task receiver should expect
  the full range of instructions, including ones the settings grammar could
  itself have parsed (`"make text bigger"`): the app interprets them.
- `muteAudio` *(optional)* — silence audio the person isn't dictating to. The
  Controller fires this when **voice input starts**, so the microphone doesn't
  transcribe media that's playing. A web Controller can pause its OWN tab, but
  only the receiver that drives the browser can reach OTHER tabs — pause every
  `<audio>`/`<video>` and cancel `speechSynthesis` across all targets (CDP), or
  mute the tabs. Declare `"muteAudio"` in `actions` to receive it; best-effort,
  no reply is awaited.
- Unsupported action → `{ "ok": false, "detail": "unsupported action: …" }`.

### `stop() → StopResult`  *(optional)*
Interrupt any **in-flight long-running work** started via `performAction` — above
all a `task` an agent is still running (30–120s). This is the counterpart to the
task catch-all: it lets the person abort a request they no longer want, instead
of waiting out the whole run. Must return **promptly** (don't block on the
teardown); do the actual cancellation in the background.
```json
{ "ok": true, "stopped": true, "detail": "cancelled the running task" }
```
- `stopped` is `true` if something was actually interrupted, `false` if nothing
  was running (still `ok: true`).
- Abort the work you started — e.g. fire the `AbortSignal` on the agent's fetch,
  kill the child run, cancel the queued job. After stopping a `task`, you may
  emit a final `aa-control-note` ("Stopped.") so the waiting Controller settles.
- Declare support with `canStop: true` in `describeCapabilities()`. Receivers
  with nothing long-running may omit `stop` entirely (the Controller then treats
  it as unsupported) or return `{ "ok": true, "stopped": false }`.

The Controller calls this from its **Stop** control (shown while a task runs, when
`canStop` is true) — see `createController().stop()`.

## 4. Reference receiver skeleton (Python-ish pseudocode)

```python
async def on_message(ws, raw):
    msg = json.loads(raw)
    if msg.get("kind") != "aa-control-req":
        return
    method, args = msg["method"], msg.get("args", [])
    try:
        result = await CONTROL[method](*args)   # your ControlPort dispatch table
        await ws.send(json.dumps({"kind": "aa-control-res", "id": msg["id"], "result": result}))
    except Exception as e:
        await ws.send(json.dumps({"kind": "aa-control-res", "id": msg["id"], "error": str(e)}))

CONTROL = {
    "describeCapabilities": describe_capabilities,   # → dict
    "getContext":           get_context,
    "applySettings":        apply_settings,          # (changes, scope=None)
    "undoLast":             undo_last,
    "resetUndo":            reset_undo,
    "getContent":           get_content,             # (mode="outline", chunk=0)
    "performAction":        perform_action,          # (action, target=None, text=None)
}
```

Map the settings to CDP: `applySettings` injects a stylesheet / CSS vars (see
`web/dom-receiver.js` for the exact class/var names the shared CSS expects —
`--aa-font-scale`, `.aa-dark`, `[data-aa-contrast]`, `.aa-reduce-motion`, …),
`getContent` reads the DOM/a11y tree, `performAction` dispatches input.

## 5. Controller side (already built here — for reference)

```js
import { createController } from 'controller/createController.js';
import { connectRemoteReceiver } from 'controller/transport/remote.js';

const control = connectRemoteReceiver('ws://127.0.0.1:9333'); // your endpoint
const c = createController({ control, operator: { uid } });    // + optional llm
// mount the UI (page/element/companion) and call c.handle('bigger text')
```

The Controller never knows it went remote — same core, same grammar/LLM lane,
same confirmation flow. Your job is only §1–§3.
