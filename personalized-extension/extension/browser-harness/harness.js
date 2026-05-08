/* Browser-harness primitives via chrome.debugger.
 *
 * Adapted from webapp/browser-harness/helpers.py for the Chrome extension
 * service worker. CDP only works from the service worker, so this file is
 * imported from background.js via importScripts() and exposed as
 * `globalThis.BrowserHarness`. Page-side callers (skill-builder, onboarding)
 * use ./client.js, which proxies through the `bh` runtime message.
 *
 * Read, edit, extend -- the agent owns this file.
 */

const BH_INTERNAL = ['chrome://', 'chrome-untrusted://', 'devtools://', 'chrome-extension://', 'about:'];
const BH_DEBUGGER_VERSION = '1.3';
const BH_ATTACHED = new Set();

// Per-tab CDP event buffer + pending dialog state. Filled by the
// chrome.debugger.onEvent listener installed below; drained by
// bhDrainEvents() / surfaced by bhPageInfo. Cap mirrors the python
// daemon's `BUF = 500` -- enough headroom for SPA route transitions
// without unbounded growth on long-running tabs.
const BH_EVENT_LIMIT = 500;
const BH_EVENTS = new Map();          // tabId -> [{method, params, t}, ...]
const BH_PENDING_DIALOGS = new Map(); // tabId -> CDP Page.javascriptDialogOpening params

// --- attach lifecycle --------------------------------------------------
async function bhAttach(tabId) {
  if (BH_ATTACHED.has(tabId)) return;
  await chrome.debugger.attach({ tabId }, BH_DEBUGGER_VERSION);
  BH_ATTACHED.add(tabId);
  // Use the no-retry sender here. The retry path in bhCdp would call back
  // into bhAttach, and we're already mid-attach -- recursion risk if the
  // domain.enable fails for an unrelated reason.
  for (const d of ['Page', 'DOM', 'Runtime', 'Network']) {
    try { await _bhSendRaw(tabId, `${d}.enable`); } catch {}
  }
}

async function bhDetach(tabId) {
  if (!BH_ATTACHED.has(tabId)) return;
  try { await chrome.debugger.detach({ tabId }); } catch {}
  BH_ATTACHED.delete(tabId);
}

// User can dismiss the yellow "is being debugged" bar at any time -- mirror
// that into our local set so the next call re-attaches instead of failing.
chrome.debugger.onDetach.addListener((source) => {
  if (source && source.tabId != null) {
    BH_ATTACHED.delete(source.tabId);
    BH_EVENTS.delete(source.tabId);
    BH_PENDING_DIALOGS.delete(source.tabId);
  }
});

// CDP event tap. Mirrors browser-harness-orig's daemon `tap()` -- buffers
// events for later drain (wait_for_network_idle, custom listeners) and
// captures any pending JS dialog so pageInfo can surface it before the
// next CDP call hangs on the frozen JS thread. Guarded so importScripts
// re-runs on SW restart don't double-register.
if (!chrome.debugger.onEvent._bhInstalled) {
  chrome.debugger.onEvent.addListener((source, method, params) => {
    const tabId = source && source.tabId;
    if (tabId == null) return;
    if (method === 'Page.javascriptDialogOpening') {
      BH_PENDING_DIALOGS.set(tabId, params);
    } else if (method === 'Page.javascriptDialogClosed') {
      BH_PENDING_DIALOGS.delete(tabId);
    }
    let buf = BH_EVENTS.get(tabId);
    if (!buf) { buf = []; BH_EVENTS.set(tabId, buf); }
    buf.push({ method, params, t: Date.now() });
    if (buf.length > BH_EVENT_LIMIT) buf.shift();
  });
  chrome.debugger.onEvent._bhInstalled = true;
}

function bhDrainEvents(tabId) {
  const buf = BH_EVENTS.get(tabId) || [];
  BH_EVENTS.set(tabId, []);
  return buf;
}

function bhPendingDialog(tabId) {
  return BH_PENDING_DIALOGS.get(tabId) || null;
}

// --- raw CDP -----------------------------------------------------------
// One-shot send. Used directly by bhAttach (which can't recurse through the
// retry path) and as the inner of bhCdp's retry-on-detached wrapper.
function _bhSendRaw(tabId, method, params) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params || {}, (result) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(`${method}: ${err.message}`));
      else resolve(result || {});
    });
  });
}

const BH_REATTACH_RE = /detached|disconnected|target closed|no tab|not attached|debugger is not attached|session with given id not found/i;

// Self-heals from a debugger detach (user clicked "Cancel" on the warning bar,
// the page navigated cross-process, the daemon-equivalent dropped the session)
// by re-attaching once and retrying. Mirrors browser-harness-orig's
// daemon.handle()'s "stale session, re-attaching" branch.
async function bhCdp(tabId, method, params = {}) {
  try {
    return await _bhSendRaw(tabId, method, params);
  } catch (e) {
    if (!BH_REATTACH_RE.test(e.message)) throw e;
    BH_ATTACHED.delete(tabId);
    try {
      await bhAttach(tabId);
    } catch {
      throw e; // re-attach failed — surface the original error
    }
    return await _bhSendRaw(tabId, method, params);
  }
}

// --- navigation / page -------------------------------------------------
async function bhGotoUrl(tabId, url) {
  await bhAttach(tabId);
  return await bhCdp(tabId, 'Page.navigate', { url });
}

async function bhPageInfo(tabId) {
  await bhAttach(tabId);
  // A native dialog (alert/confirm/prompt/beforeunload) freezes the JS
  // thread, so Runtime.evaluate would hang. Surface the dialog instead --
  // matches browser-harness-orig's daemon meta:pending_dialog branch.
  const dialog = bhPendingDialog(tabId);
  if (dialog) return { dialog };
  const r = await bhCdp(tabId, 'Runtime.evaluate', {
    expression: 'JSON.stringify({url:location.href,title:document.title,w:innerWidth,h:innerHeight,sx:scrollX,sy:scrollY,pw:document.documentElement.scrollWidth,ph:document.documentElement.scrollHeight})',
    returnByValue: true,
  });
  if (r && r.result && r.result.value) return JSON.parse(r.result.value);
  return { url: '', title: '', w: 0, h: 0, sx: 0, sy: 0, pw: 0, ph: 0 };
}

// Accept (true) or cancel (false) the currently-open native dialog. For a
// prompt(), pass `promptText` to supply the value before accepting. The
// daemon-equivalent removes BH_PENDING_DIALOGS on the matching dialogClosed
// event automatically.
async function bhHandleDialog(tabId, accept = true, promptText = null) {
  await bhAttach(tabId);
  const params = { accept };
  if (promptText != null) params.promptText = promptText;
  await bhCdp(tabId, 'Page.handleJavaScriptDialog', params);
}

// --- input -------------------------------------------------------------
async function bhClickAt(tabId, x, y, button = 'left', clicks = 1) {
  await bhAttach(tabId);
  await bhCdp(tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, clickCount: clicks });
  await bhCdp(tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, clickCount: clicks });
}

async function bhTypeText(tabId, text) {
  await bhAttach(tabId);
  await bhCdp(tabId, 'Input.insertText', { text });
}

// key -> [windowsVirtualKeyCode, code, text]
const BH_KEYS = {
  Enter: [13, 'Enter', '\r'], Tab: [9, 'Tab', '\t'], Backspace: [8, 'Backspace', ''],
  Escape: [27, 'Escape', ''], Delete: [46, 'Delete', ''], ' ': [32, 'Space', ' '],
  ArrowLeft: [37, 'ArrowLeft', ''], ArrowUp: [38, 'ArrowUp', ''],
  ArrowRight: [39, 'ArrowRight', ''], ArrowDown: [40, 'ArrowDown', ''],
  Home: [36, 'Home', ''], End: [35, 'End', ''],
  PageUp: [33, 'PageUp', ''], PageDown: [34, 'PageDown', ''],
};

async function bhPressKey(tabId, key, modifiers = 0) {
  await bhAttach(tabId);
  const entry = BH_KEYS[key] || [
    key.length === 1 ? key.charCodeAt(0) : 0,
    key,
    key.length === 1 ? key : '',
  ];
  const [vk, code, text] = entry;
  const base = { key, code, modifiers, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk };
  await bhCdp(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', ...base, ...(text ? { text } : {}) });
  if (text && text.length === 1) {
    await bhCdp(tabId, 'Input.dispatchKeyEvent', { type: 'char', text, ...base });
  }
  await bhCdp(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', ...base });
}

async function bhScroll(tabId, x, y, dy = -300, dx = 0) {
  await bhAttach(tabId);
  await bhCdp(tabId, 'Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: dx, deltaY: dy });
}

// Fill a framework-managed input (React/Vue/Ember). bhTypeText uses
// Input.insertText which bypasses framework event listeners, so submit
// buttons stay disabled. This focuses + clears via real Cmd/Ctrl+A and
// Backspace, types via key events, then fires synthetic input+change
// so the framework's controlled-input state actually updates.
//
// Note the rawKeyDown trick: a normal keyDown for 'a' with the modifier
// still emits a `char` event, which Chrome treats as printable input
// (typing literally "a") instead of the select-all shortcut. rawKeyDown
// suppresses the char emission so the modifier+key combo registers.
async function bhFillInput(tabId, selector, text, { clearFirst = true, timeoutMs = 0 } = {}) {
  if (timeoutMs > 0) {
    if (!(await bhWaitForElement(tabId, selector, { timeoutMs }))) {
      throw new Error(`fill_input: element not found: ${selector}`);
    }
  }
  await bhAttach(tabId);
  const sel = JSON.stringify(selector);
  const focused = await bhJs(
    tabId,
    `(()=>{const e=document.querySelector(${sel});if(!e)return false;e.focus();return true})()`
  );
  if (!focused) throw new Error(`fill_input: element not found: ${selector}`);

  if (clearFirst) {
    const isMac = /Mac|iPhone|iPad|iPod/.test((navigator && navigator.userAgent) || '');
    const mods = isMac ? 4 : 2; // 4=Meta(Cmd), 2=Ctrl
    const selectAll = {
      key: 'a', code: 'KeyA', modifiers: mods,
      windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65,
    };
    await bhCdp(tabId, 'Input.dispatchKeyEvent', { type: 'rawKeyDown', ...selectAll });
    await bhCdp(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', ...selectAll });
    await bhPressKey(tabId, 'Backspace');
  }
  for (const ch of text) {
    await bhPressKey(tabId, ch);
  }
  await bhJs(
    tabId,
    `(()=>{const e=document.querySelector(${sel});if(!e)return;`
    + `e.dispatchEvent(new Event('input',{bubbles:true}));`
    + `e.dispatchEvent(new Event('change',{bubbles:true}))})()`
  );
}

// --- visual ------------------------------------------------------------
// Page.captureScreenshot returns the viewport in DEVICE pixels -- on a 2x
// display a 1920x1080 CSS viewport produces a 3840x2160 PNG. That's
// hostile to coordinate-driven agents: Input.dispatchMouseEvent expects
// CSS pixels, but a vision LLM looking at a 3840-wide image will report
// pixel positions in image space, not CSS space.
//
// `cssNormalize: true` re-renders the screenshot at the page's CSS-pixel
// dimensions, so 1 image pixel = 1 CSS pixel and the model's coordinates
// are directly clickable. `maxDim` further caps the longer side and
// returns a `scale` factor (image-pixels-per-CSS-pixel) the caller can
// divide model coordinates by to recover CSS pixels.
//
// Backwards-compatible: with no options the function returns the raw
// base64 string as before. With either option set, returns
// `{data, width, height, cssWidth, cssHeight, dpr, scale}`.
async function bhCaptureScreenshot(tabId, { full = false, maxDim = null, cssNormalize = false } = {}) {
  await bhAttach(tabId);
  const r = await bhCdp(tabId, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: full });
  const original = r.data; // base64 PNG, no data: prefix

  if (!maxDim && !cssNormalize) return original;
  if (typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') {
    return { data: original, width: 0, height: 0, cssWidth: 0, cssHeight: 0, dpr: 1, scale: 1 };
  }

  // Read the viewport metrics so we know what "CSS-pixel size" means.
  // Falls back to no-normalisation if the read fails (mid-navigation, etc).
  let cssWidth = 0, cssHeight = 0, dpr = 1;
  try {
    const info = await bhCdp(tabId, 'Runtime.evaluate', {
      expression: 'JSON.stringify({w:innerWidth,h:innerHeight,dpr:devicePixelRatio||1})',
      returnByValue: true,
    });
    const m = JSON.parse(info && info.result && info.result.value || '{}');
    cssWidth = m.w || 0; cssHeight = m.h || 0; dpr = m.dpr || 1;
  } catch {}

  let bmp;
  try {
    const blob = await (await fetch(`data:image/png;base64,${original}`)).blob();
    bmp = await createImageBitmap(blob);
  } catch (e) {
    console.warn('[BrowserHarness] screenshot decode failed:', e.message);
    return { data: original, width: 0, height: 0, cssWidth, cssHeight, dpr, scale: 1 };
  }

  // Decide target dimensions.
  let targetW = bmp.width;
  let targetH = bmp.height;
  if (cssNormalize && cssWidth && cssHeight) {
    targetW = cssWidth;
    targetH = cssHeight;
  }
  if (maxDim && Math.max(targetW, targetH) > maxDim) {
    const k = maxDim / Math.max(targetW, targetH);
    targetW = Math.max(1, Math.round(targetW * k));
    targetH = Math.max(1, Math.round(targetH * k));
  }

  let data = original;
  if (targetW !== bmp.width || targetH !== bmp.height) {
    try {
      const canvas = new OffscreenCanvas(targetW, targetH);
      canvas.getContext('2d').drawImage(bmp, 0, 0, targetW, targetH);
      const out = await canvas.convertToBlob({ type: 'image/png' });
      const buf = new Uint8Array(await out.arrayBuffer());
      let bin = '';
      for (let i = 0; i < buf.byteLength; i++) bin += String.fromCharCode(buf[i]);
      data = btoa(bin);
    } catch (e) {
      console.warn('[BrowserHarness] screenshot resize failed:', e.message);
    }
  }

  // image-pixels-per-CSS-pixel. 1.0 means model coordinates are CSS
  // pixels directly; <1.0 means caller must divide model coords by scale.
  const scale = (cssWidth > 0) ? (targetW / cssWidth) : 1;

  return { data, width: targetW, height: targetH, cssWidth, cssHeight, dpr, scale };
}

// --- tabs --------------------------------------------------------------
async function bhListTabs({ includeChrome = true } = {}) {
  const tabs = await chrome.tabs.query({});
  return tabs
    .filter(t => includeChrome || !BH_INTERNAL.some(p => (t.url || '').startsWith(p)))
    .map(t => ({ tabId: t.id, title: t.title || '', url: t.url || '' }));
}

async function bhCurrentTab() {
  const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
  return t ? { tabId: t.id, title: t.title || '', url: t.url || '' } : null;
}

async function bhSwitchTab(tabId) {
  const t = await chrome.tabs.get(tabId);
  await chrome.windows.update(t.windowId, { focused: true });
  await chrome.tabs.update(tabId, { active: true });
  return { tabId, url: t.url || '', title: t.title || '' };
}

async function bhNewTab(url = 'about:blank', { active = true } = {}) {
  const t = await chrome.tabs.create({ url, active });
  return { tabId: t.id, url: t.url || url };
}

async function bhEnsureRealTab() {
  const tabs = await bhListTabs({ includeChrome: false });
  if (!tabs.length) return null;
  const cur = await bhCurrentTab();
  if (cur && cur.url && !BH_INTERNAL.some(p => cur.url.startsWith(p))) return cur;
  return await bhSwitchTab(tabs[0].tabId);
}

// --- runtime / DOM -----------------------------------------------------
// Match python's helpers._decode_unserializable_js_value: NaN/Infinity/
// BigInt come over the wire as strings on `unserializableValue` because
// JSON can't represent them. Round-trip them to native JS values so
// callers don't get `undefined` for `js("NaN")` or `js("0n")`.
function _bhDecodeUnserializable(v) {
  if (v === 'NaN') return NaN;
  if (v === 'Infinity') return Infinity;
  if (v === '-Infinity') return -Infinity;
  if (v === '-0') return -0;
  if (typeof v === 'string' && /^-?\d+n$/.test(v)) {
    try { return BigInt(v.slice(0, -1)); } catch { return v; }
  }
  return v;
}

async function bhJs(tabId, expression, { iframeTargetId = null } = {}) {
  let send, target;
  if (iframeTargetId) {
    if (!BH_ATTACHED.has(iframeTargetId)) {
      await chrome.debugger.attach({ targetId: iframeTargetId }, BH_DEBUGGER_VERSION);
      BH_ATTACHED.add(iframeTargetId);
    }
    target = { targetId: iframeTargetId };
    send = (method, params) => new Promise((resolve, reject) => {
      chrome.debugger.sendCommand(target, method, params || {}, (result) => {
        const err = chrome.runtime.lastError;
        if (err) reject(new Error(`${method}: ${err.message}`));
        else resolve(result || {});
      });
    });
  } else {
    await bhAttach(tabId);
    send = (method, params) => bhCdp(tabId, method, params);
  }
  let exp = expression;
  if (/\breturn\b/.test(exp) && !exp.trim().startsWith('(')) {
    exp = `(function(){${exp}})()`;
  }
  const r = await send('Runtime.evaluate', {
    expression: exp,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r && r.exceptionDetails) {
    const msg = r.exceptionDetails.exception?.description
      || r.exceptionDetails.text
      || 'js evaluation failed';
    throw new Error(msg);
  }
  if (r && r.result) {
    if ('value' in r.result) return r.result.value;
    if ('unserializableValue' in r.result) return _bhDecodeUnserializable(r.result.unserializableValue);
  }
  return undefined;
}

// First iframe whose URL contains `urlSubstr`. Use the returned targetId
// with bhJs(tabId, expr, {iframeTargetId}) to evaluate inside the frame.
// Coordinate clicks already pass through iframes at the compositor level
// (Input.dispatchMouseEvent), so iframe targeting is mainly for DOM reads.
async function bhIframeTarget(tabId, urlSubstr) {
  await bhAttach(tabId);
  const r = await bhCdp(tabId, 'Target.getTargets');
  for (const t of (r.targetInfos || [])) {
    if (t.type === 'iframe' && (t.url || '').includes(urlSubstr)) {
      return t.targetId;
    }
  }
  return null;
}

const BH_KC = { Enter: 13, Tab: 9, Escape: 27, Backspace: 8, ' ': 32, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 };

async function bhDispatchKey(tabId, selector, key = 'Enter', event = 'keypress') {
  const kc = key in BH_KC ? BH_KC[key] : (key.length === 1 ? key.charCodeAt(0) : 0);
  const sel = JSON.stringify(selector);
  const k = JSON.stringify(key);
  const ev = JSON.stringify(event);
  await bhJs(
    tabId,
    `(()=>{const e=document.querySelector(${sel});if(e){e.focus();e.dispatchEvent(new KeyboardEvent(${ev},{key:${k},code:${k},keyCode:${kc},which:${kc},bubbles:true}));}})()`
  );
}

async function bhUploadFile(tabId, selector, files) {
  await bhAttach(tabId);
  const doc = await bhCdp(tabId, 'DOM.getDocument', { depth: -1 });
  const { nodeId } = await bhCdp(tabId, 'DOM.querySelector', { nodeId: doc.root.nodeId, selector });
  if (!nodeId) throw new Error(`no element for ${selector}`);
  await bhCdp(tabId, 'DOM.setFileInputFiles', {
    files: Array.isArray(files) ? files : [files],
    nodeId,
  });
}

// --- utility -----------------------------------------------------------
function bhWait(ms = 1000) {
  return new Promise(r => setTimeout(r, ms));
}

async function bhWaitForLoad(tabId, { timeoutMs = 15000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await bhJs(tabId, 'document.readyState')) === 'complete') return true;
    } catch {}
    await bhWait(300);
  }
  return false;
}

// Poll until querySelector(selector) finds something. wait_for_load misses
// SPAs because the document is 'complete' before the framework renders;
// use this after route changes / data fetches. visible:true also requires
// the element to be in-layout (checkVisibility, falling back to a
// per-element CSS check on older Chrome).
async function bhWaitForElement(tabId, selector, { timeoutMs = 10000, visible = false } = {}) {
  await bhAttach(tabId);
  const sel = JSON.stringify(selector);
  const check = visible
    ? `(()=>{const e=document.querySelector(${sel});if(!e)return false;`
      + `if(typeof e.checkVisibility==='function')`
      + `return e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true});`
      + `const s=getComputedStyle(e);`
      + `return s.display!=='none'&&s.visibility!=='hidden'&&s.opacity!=='0'})()`
    : `!!document.querySelector(${sel})`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if (await bhJs(tabId, check)) return true; } catch {}
    await bhWait(300);
  }
  return false;
}

// Quiescence detector: drains the buffered Network.* events and returns
// true once all in-flight requests finish AND no new Network event fires
// for `idleMs`. Useful after form submits and SPA route transitions where
// there's no DOM change to wait_for_element on.
async function bhWaitForNetworkIdle(tabId, { timeoutMs = 10000, idleMs = 500 } = {}) {
  await bhAttach(tabId);
  // Reset the buffer so prior traffic doesn't poison the idle window.
  bhDrainEvents(tabId);
  const deadline = Date.now() + timeoutMs;
  let lastActivity = Date.now();
  const inflight = new Set();
  while (Date.now() < deadline) {
    for (const e of bhDrainEvents(tabId)) {
      if (e.method === 'Network.requestWillBeSent') {
        inflight.add(e.params && e.params.requestId);
        lastActivity = Date.now();
      } else if (e.method === 'Network.loadingFinished' || e.method === 'Network.loadingFailed') {
        inflight.delete(e.params && e.params.requestId);
        lastActivity = Date.now();
      } else if (e.method.startsWith('Network.')) {
        lastActivity = Date.now();
      }
    }
    if (inflight.size === 0 && Date.now() - lastActivity >= idleMs) return true;
    await bhWait(100);
  }
  return false;
}

async function bhHttpGet(url, headers = null) {
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', ...(headers || {}) } });
  return await r.text();
}

// Expose for background.js's bh:* dispatcher.
globalThis.BrowserHarness = {
  attach: bhAttach,
  detach: bhDetach,
  cdp: bhCdp,
  drainEvents: bhDrainEvents,
  pendingDialog: bhPendingDialog,
  handleDialog: bhHandleDialog,
  gotoUrl: bhGotoUrl,
  pageInfo: bhPageInfo,
  clickAt: bhClickAt,
  typeText: bhTypeText,
  fillInput: bhFillInput,
  pressKey: bhPressKey,
  scroll: bhScroll,
  captureScreenshot: bhCaptureScreenshot,
  listTabs: bhListTabs,
  currentTab: bhCurrentTab,
  switchTab: bhSwitchTab,
  newTab: bhNewTab,
  ensureRealTab: bhEnsureRealTab,
  iframeTarget: bhIframeTarget,
  js: bhJs,
  dispatchKey: bhDispatchKey,
  uploadFile: bhUploadFile,
  wait: bhWait,
  waitForLoad: bhWaitForLoad,
  waitForElement: bhWaitForElement,
  waitForNetworkIdle: bhWaitForNetworkIdle,
  httpGet: bhHttpGet,
};
