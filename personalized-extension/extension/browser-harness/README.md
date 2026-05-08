# Browser Harness (in-extension)

Direct CDP control of any tab from inside the extension, ported from
[`webapp/browser-harness/`](../../../webapp/browser-harness/). Same primitives,
same naming -- adapted to JS and `chrome.debugger` instead of a Python daemon
talking to remote-debugging Chrome over a WebSocket.

## Why it lives here

`chrome.debugger.sendCommand` only works from the service worker, so:

```
extension/browser-harness/
├── harness.js   -- service-worker module (loaded by background.js)
├── client.js    -- page-side proxy (skill-builder, onboarding, popup)
└── agent.js     -- Gemini-vision agent loop (mirror of my_agent.py)
```

Page-side callers use `client.js`, which forwards every call as a
`chrome.runtime.sendMessage({ type: 'bh', op, args })` to the background
worker, where `harness.js` runs the real CDP call.

## Setup

1. `manifest.json` already has the `debugger` and `tabs` permissions added.
2. `background.js` already has `self.importScripts('browser-harness/harness.js')`
   and the `bh` message dispatcher.

Nothing else to wire. After `npm run build`, reload the extension at
`chrome://extensions`.

## Usage from any extension page

```js
import { harness } from '../browser-harness/client.js';

const tab = await harness.currentTab();
await harness.gotoUrl(tab.tabId, 'https://example.com');
await harness.waitForLoad(tab.tabId);

const png = await harness.captureScreenshot(tab.tabId);  // base64
console.log(await harness.pageInfo(tab.tabId));

await harness.clickAt(tab.tabId, 340, 200);
await harness.typeText(tab.tabId, 'hello world');
await harness.pressKey(tab.tabId, 'Enter');
```

## Agent loop

```js
import { runAgent } from '../browser-harness/agent.js';

await runAgent('open the GitHub trending page and tell me the top repo', {
  maxSteps: 12,
  onStep: ({ step, action }) => console.log(step, action),
});
```

Reuses the existing background `gemini` message, so the API key flow and
prompt-caching pipeline that the skill-builder uses are shared.

## API mapping (helpers.py -> client.js)

| helpers.py                         | harness client                                          |
|------------------------------------|---------------------------------------------------------|
| `cdp(method, **params)`            | `harness.cdp(tabId, method, params)`                    |
| `goto_url(url)`                    | `harness.gotoUrl(tabId, url)`                           |
| `page_info()`                      | `harness.pageInfo(tabId)`                               |
| `click_at_xy(x, y)`                | `harness.clickAt(tabId, x, y)`                          |
| `type_text(text)`                  | `harness.typeText(tabId, text)`                         |
| `press_key(key)`                   | `harness.pressKey(tabId, key)`                          |
| `scroll(x, y, dy)`                 | `harness.scroll(tabId, x, y, dy)`                       |
| `capture_screenshot(path)`         | `harness.captureScreenshot(tabId)` -- returns base64    |
| `list_tabs()`                      | `harness.listTabs()`                                    |
| `current_tab()`                    | `harness.currentTab()`                                  |
| `switch_tab(targetId)`             | `harness.switchTab(tabId)`                              |
| `new_tab(url)`                     | `harness.newTab(url)`                                   |
| `ensure_real_tab()`                | `harness.ensureRealTab()`                               |
| `js(expression)`                   | `harness.js(tabId, expression)`                         |
| `dispatch_key(selector, key)`      | `harness.dispatchKey(tabId, selector, key)`             |
| `upload_file(selector, path)`      | `harness.uploadFile(tabId, selector, files)`            |
| `wait_for_load()`                  | `harness.waitForLoad(tabId)`                            |
| `wait(seconds)`                    | `harness.wait(ms)`                                      |
| `http_get(url)`                    | `harness.httpGet(url)`                                  |

A few primitives differ from the Python version:

- **`tabId` is explicit on every call.** The Python daemon tracks one
  attached session per `BU_NAME`; the extension always knows which tab
  the page-side caller wants to drive (e.g. the user's last real tab).
- **`captureScreenshot` returns a base64 string,** not a file path. Decode
  to a Blob/object URL if you need to display it.
- **`uploadFile` takes file paths** that must be visible to the browser
  process. `chrome.debugger`'s `DOM.setFileInputFiles` reads the path on
  the local filesystem just like the Python helper.

## Caveats

- **Yellow debugger bar.** Any tab the harness attaches to shows Chrome's
  "[ext] started debugging this browser" warning. The user can dismiss it,
  which detaches the debugger; the next call re-attaches automatically.
- **DevTools conflict.** `chrome.debugger` and DevTools can't both attach
  to the same tab. If the user has DevTools open, the attach will fail.
- **Restricted pages.** `chrome://`, the Web Store, and the extension's
  own pages can't be attached to.
- **Self-driving.** Don't run the agent against the extension's own pages
  (skill-builder, onboarding) -- it would try to debug itself.

## Eventual use in skill-creator

The plan mentioned in the conversation is to surface this harness inside
the [`skill-creator/`](../../skill-creator/) Claude Code skill so the
creation agent can assess pages while building skills. That path will
likely keep `harness.js` as-is and add a small Python or RPC wrapper that
talks to the extension.
