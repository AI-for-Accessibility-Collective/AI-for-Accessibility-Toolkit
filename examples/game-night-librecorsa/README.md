# Example: LibreCorsa game-night voice bridge

This example shows how the [AI for Accessibility Toolkit](https://github.com/AI-for-Accessibility-Collective/AI-for-Accessibility-Toolkit) Controller (or a host that speaks the same phrase vocabulary) can drive an open-source browser racer through a local bridge.

Full PoC monorepo: [Isomkevin/game-night-access-adapter](https://github.com/Isomkevin/game-night-access-adapter).

## Flow

```text
Toolkit Controller / voice
    → logical actions (turnLeft, go, stop, …)
    → WebSocket input events (source: "voice")
    → Game Night bridge
    → Chrome extension (player remap table)
    → LibreCorsa KeyboardEvent.code
```

## Phrase → logical action

| Phrase (examples) | Logical action | Default game action |
| --- | --- | --- |
| turn left / left | `turnLeft` | steerLeft |
| turn right / right | `turnRight` | steerRight |
| go / accelerate | `go` | throttle |
| stop / brake | `stop` | brake |
| boost | `boost` | boost |
| pause | `pause` | pause |

Wire format (one JSON text frame):

```json
{
  "type": "input",
  "source": "voice",
  "action": "turnLeft",
  "state": "pulse",
  "strength": 1,
  "ts": 0,
  "v": 1
}
```

## Using the Controller

Hosts that already expose `createController({ control, operator })` can treat unrecognized racing phrases as `performAction` results that enqueue the JSON above on `ws://127.0.0.1:18765`.

A minimal sender:

```js
import { createRequire } from 'node:module';
// Pseudocode — plug into your ControlPort receiver or grammar hook:
function sendVoiceAction(action) {
  const ws = new WebSocket('ws://127.0.0.1:18765');
  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'hello', role: 'voice', v: 1, ts: Date.now() }));
    ws.send(JSON.stringify({
      type: 'input', source: 'voice', action, state: 'pulse', strength: 1, ts: Date.now(), v: 1,
    }));
  };
}
```

## Why this belongs in the toolkit

It documents a **game-agnostic** pattern: profile/skills decide *what* to adapt; a thin bridge turns speech into the host app’s existing input channel. Racing is the PoC; the protocol is reusable.
