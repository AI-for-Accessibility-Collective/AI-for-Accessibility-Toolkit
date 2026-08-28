# Control Protocol — what a remote receiver must implement

This is the wire contract for driving an app from the Controller **over a
channel** (see `DESIGN.md` → Transport, and `transport/remote.js`). Implement
this in the receiving app (e.g. `browser-harness-a11y`) and the Controller can
drive it with **no changes** — it already speaks this on the client side via
`remoteControl({ channel })` / `connectRemoteReceiver(url)`.

You are building the **receiver** (the server side): the thing being driven. The
Controller is the **client** that connects to you.

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

Implement these seven. Types are the canonical shapes from `control-port.js`.

### `describeCapabilities() → ControlCapabilities`
Called first and often. Declare exactly what you can do — the Controller offers
only these to the user and its grammar/LLM lane are filtered to them.
```json
{
  "platform": "browser-harness",
  "settingKeys": ["fontScale", "lineHeight", "darkMode", "contrastMode", "motionReducer", "hideDistractions"],
  "actions": ["scroll", "activate", "back", "forward"],
  "canReadContent": true,
  "targets": ["Documentation", "Buy now"]        // optional: activatable labels
}
```
- `settingKeys` **must** be keys from the toolkit registry `settingsMeta`
  (`toolkit/registry/tools.js`) — that shared vocabulary is the contract. Only
  list keys you actually apply.
- `actions` are the `performAction` ids you support. Common set:
  `scroll`, `activate`, `back`, `forward`.

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

### `performAction(actionId, target?, text?) → ActionResult`
One app action.
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
- Unsupported action → `{ "ok": false, "detail": "unsupported action: …" }`.

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
import { createController } from 'toolkit/controller/createController.js';
import { connectRemoteReceiver } from 'toolkit/controller/transport/remote.js';

const control = connectRemoteReceiver('ws://127.0.0.1:9333'); // your endpoint
const c = createController({ control, operator: { uid } });    // + optional llm
// mount the UI (page/element/companion) and call c.handle('bigger text')
```

The Controller never knows it went remote — same core, same grammar/LLM lane,
same confirmation flow. Your job is only §1–§3.
