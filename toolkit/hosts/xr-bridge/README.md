# XR bridge

Connects the [AI for Accessibility XR guide](https://github.com/AI-for-Accessibility-Collective/AI-for-Accessibility-XR)
(an audio guide for smart glasses) to a toolkit service, without changing
that app. It is opt-in: nothing in the toolkit or the service starts it, and
it only runs against the XR guide. Pointed at any other server, it stops with
an error.

This is part of an active research project: a pre-alpha technology probe.
Its adaptations are unvalidated, and it is not a replacement for assistive
technology. In practice, test it with the people who will use it before
relying on it, and expect it to change.

## What it does

The XR guide keeps its own embedded toolkit and profile store. Its server
exposes a small HTTP API under `/webview`, and the bridge works only through
that API, so the XR guide stays the only writer of its store.

- **Shows the XR guide under Apps** in the developer console, as the app
  `ai4a11y-xr`, live while the bridge runs. It has four adaptations that a
  person, the console's Try it, `app_verify` or a coding agent can switch:
  - *Follow my profile*: the guide's toolkit mode (off is its baseline mode).
  - *One step at a time*: says one step, then waits until the person asks for
    the next. The toolkit has no name for this need, so the bridge registers
    it (`ai4a11y-xr/one-step`) and the profile agent can suggest it to the
    people it fits.
  - *Speaking rate*: 0.7 to 1.2 times normal speed.
  - *Captions on the display*.
- **Follows the person's toolkit profile.** On start, on every profile change
  and when the guide opens a profile (a phone session), it writes the
  profile's speaking rate (`readAloudRate`, kept within the guide's range),
  captions, and the one-step need (as the guide's pacing) into the guide.
  What the profile does not say is left as it is. It never switches the
  guide's mode on its own: that is the guide's own study setting.
- **Tells the toolkit when the person changes one of these on the guide**
  (an observation), so the toolkit can learn from it.

## Run it

Start the XR guide as its README says, then, from this repository:

```bash
npm run xr:bridge
```

It reads these from the environment or a `.env` file (in the current folder
or one above it):

| Variable | What it is |
|---|---|
| `TOOLKIT_URL` | The toolkit service, e.g. `http://localhost:8080` |
| `TOOLKIT_TOKEN` | The account's default token (the developer console shows it) |
| `XR_URL` | The XR guide's server; default `http://localhost:3000` |
| `XR_BRIDGE_TOKEN` | The XR guide's `BRIDGE_TOKEN` |
| `XR_ADMIN_PASSWORD` | Or its `ADMIN_PASSWORD`, if it has no bridge token |

Ctrl+C stops the bridge. The XR guide keeps running as it was, and it no
longer shows under Apps.

To embed it in another Node program instead:

```js
import { createXrBridge } from './toolkit/hosts/xr-bridge/bridge.js';
const bridge = createXrBridge({ toolkitUrl, toolkitToken, xrUrl, xrToken });
await bridge.start();   // { storeOpen, followed }
// …
await bridge.stop();
```

## Limits

- The guide's API can set only pacing, speaking rate and captions. Its other
  settings follow its own embedded store.
- The guide opens a profile only when its phone app connects. Until then the
  adaptations report that the guide is not available, and the bridge writes
  nothing.
- It polls the guide every 3 seconds to notice changes made on the guide.
- The guide's embedded store and the toolkit service's profile stay separate
  stores. The bridge copies the three settings above one way, from the
  toolkit to the guide, and reports changes made on the guide as
  observations; it does not merge the two stores.
- It has been tested against a stand-in for the guide's API
  (`server/test/xr-bridge.test.mjs`), not yet against the guide running on
  glasses.
