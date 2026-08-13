// Browser-harness primitives (chrome.debugger / CDP) -- exposes
// `globalThis.BrowserHarness`. See extension/browser-harness/README.md.
self.importScripts(
  'browser-harness/dist/harness.js',
  'browser-harness/skills.js',
  'browser-harness/dist/agent.js'
);

// The validation layer (globalThis.Validation). Reads the page the agent is
// on through the harness's own accessibility snapshot -- deliberately not
// through the agent's account of the page -- and holds the agent at a gate
// when a finding contradicts what the person asked for. Must load after the
// harness, whose axSnapshot it calls.
self.importScripts('validation/dist/validation.js');

// The analysis, loaded once at startup if it is present.
//
// Shipped as a file rather than compiled in, and gitignored here, because it
// carries research text that belongs in the research repository — the
// extension holds the mechanism. Absent, the layer still runs: it just has no
// paradigm map, so findings fall back to their sentence and no standing rule
// is ever offered. Degrading is the point; inventing the content would not be.
fetch(chrome.runtime.getURL('validation/corpus.json'))
  .then((r) => (r.ok ? r.json() : null))
  .then((c) => {
    if (!c) return;
    const n = globalThis.ValidationCorpus?.load(c);
    console.log('[AI4A11y] analysis loaded:', n);
  })
  .catch(() => {});   // no corpus file is a supported state, not an error

// Toolkit datastore layer -- taxonomy (globalThis.AA_TAXONOMY) and the
// generated built-in tools registry (globalThis.AA_TOOLS) must load before
// datastore.js, which exposes both via Datastore.global.*.
self.importScripts(
  'lib/demo-trace.js',
  'lib/taxonomy.js',
  'lib/tools-registry.js',
  'lib/skills-db.js',
  'lib/datastore.js',
  'lib/librarian.js',
  // Web SurfaceAdapter + abilityModel→webSettings derivation (globalThis.WebSurface).
  'lib/web-surface.js'
);

// Read every page the agent lands on while a validation run is active.
//
// Without this the layer is inert -- it can check a page but nothing ever asks
// it to, so a run would produce findings only where someone remembered to call
// observe. Navigation is the right trigger because the thing being checked is
// what the page now says, and settling is when it says it.
// Tabs the probe owns. The observer must not read them: a probe page is a
// measurement, not a page the task is on, and its findings would enter the
// session as unread holds about pages the person never saw.
const probeTabs = new Set();

chrome.webNavigation?.onCompleted?.addListener((d) => {
  if (d.frameId !== 0) return;                       // top frame only
  if (probeTabs.has(d.tabId)) return;                // a measurement, not the task
  if (!globalThis.Validation?.isRunning?.()) return;
  // Let the page settle. Amazon renders prices and stock after first paint,
  // and reading too early reports absences that are really just lateness.
  setTimeout(() => {
    globalThis.Validation.observe(d.tabId).catch((e) =>
      console.warn('[validation] observe failed:', e.message));
  }, 1200);
});

// Voice-mode actuation port (Chrome implementation of the host-agnostic
// ActuationPort — toolkit/ports/actuation.js) followed by the voice-mode data
// routes (offscreen tool calls that need chrome.tabs / chrome.scripting /
// Librarian). voice-routes.js's own onMessage listener answers voice* data
// types only. Loaded after lib/ so the toolkit globals both files read exist;
// chrome-actuation.js must load first since voice-routes.js reads
// globalThis.ChromeActuation at import time.
self.importScripts('chrome-actuation.js', 'voice-routes.js', 'remote-librarian.js');

// ----- Remote toolkit server mode -------------------------------------------
// See server/CONTRACT.md ("Extension remote mode") + remote-librarian.js.
// When chrome.storage.sync holds both `toolkitServerUrl` and
// `toolkitServerToken` (set via options.html), every `librarian*` message
// dispatched below routes through RemoteLibrarian.asLibrarian() instead of
// the local globalThis.Librarian. Cached because remoteIfConfigured() runs on
// EVERY librarian* message (the hot path); invalidated by
// chrome.storage.onChanged so flipping the options UI takes effect on the
// very next message, no service-worker restart required.
let _remoteLibrarianCache; // undefined = unread, null = local mode, object = remote facade
chrome.storage.onChanged?.addListener((changes, area) => {
  if (area !== 'sync') return;
  if ('toolkitServerUrl' in changes || 'toolkitServerToken' in changes) {
    _remoteLibrarianCache = undefined;
  }
});

async function remoteIfConfigured() {
  if (_remoteLibrarianCache !== undefined) return _remoteLibrarianCache;
  let cfg = {};
  try {
    cfg = await chrome.storage.sync.get(['toolkitServerUrl', 'toolkitServerToken']);
  } catch (e) {
    console.warn('[AgenticA11y] toolkit server config read failed:', e.message);
  }
  const url = (cfg.toolkitServerUrl || '').trim();
  const token = (cfg.toolkitServerToken || '').trim();
  if (!url || !token) {
    globalThis.RemoteLibrarian?.configure?.({});
    _remoteLibrarianCache = null;
    return _remoteLibrarianCache;
  }
  globalThis.RemoteLibrarian.configure({ url, token });
  _remoteLibrarianCache = globalThis.RemoteLibrarian.asLibrarian();
  return _remoteLibrarianCache;
}

// Shared resolver for SW modules that call the Librarian DIRECTLY rather than
// via librarian* messages (voice-routes.js, chrome-actuation.js). Keeps voice
// memory on the same local/remote source as everything else — without this,
// remote mode would split-brain: popup remote, voice local.
globalThis.__resolveLibrarian = async () =>
  (await remoteIfConfigured()) || globalThis.Librarian;

// Lazy, idempotent store migrations. Safe to fire-and-forget: stores are
// readable before this resolves (migration 1 is a stamp).
Datastore.runMigrations().catch((e) =>
  console.warn('[AgenticA11y] datastore migrations failed:', e.message));

// Demo mode: when the live-diagram pages are open they flip this on, which
// loosens the Librarian's proposal gating (forces agent-run success, bypasses
// the weekly cap / dedup / suppression) so the scripted beats fire reliably
// and are repeatable across rehearsals. Off in normal use. Mirrored onto the
// service-worker global so the Librarian (same importScripts scope) reads it
// synchronously without a storage round-trip.
chrome.storage.local.get('aaDemoMode', (d) => { globalThis.AA_DEMO_MODE = !!(d && d.aaDemoMode); });

const GEMINI_MODEL = 'gemini-3.5-flash';
const USER_SCRIPT_ID_PREFIX = 'aa-custom-';

function getApiUrl(apiKey, model) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model || GEMINI_MODEL}:generateContent?key=${apiKey}`;
}

// ----- User-scripts integration --------------------------------------------
// Custom skills are persisted blobs of arbitrary user-authored JS. MV3 forbids
// `unsafe-eval` everywhere except the dedicated user-scripts world, so saved
// skills are registered as user scripts (one per skill) and re-synced any time
// `customSkills` changes. Requires the user to enable "Developer mode" at
// chrome://extensions; calls below throw if it's off and the failures are
// surfaced via the getUserScriptsStatus message.

function userScriptsAvailable() {
  return typeof chrome.userScripts !== 'undefined';
}

let userScriptWorldConfigured = false;
async function ensureUserScriptWorld() {
  if (!userScriptsAvailable() || userScriptWorldConfigured) return;
  try {
    await chrome.userScripts.configureWorld({
      messaging: true,
      csp: "script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'; object-src 'self'",
    });
    userScriptWorldConfigured = true;
  } catch (e) {
    console.warn('[AgenticA11y] configureWorld failed:', e.message);
  }
}

function isDevModeError(err) {
  const msg = (err && err.message) || '';
  return /developer mode|user script/i.test(msg);
}

// Wrap a generated skill body for registration.
//   - Always an IIFE: chrome.userScripts.register runs the code as a classic
//     script, so a top-level `return` (which the prompt tells the generator
//     to use for idempotency guards) would be a SyntaxError. Wrapping turns
//     the body into a function where `return` is legal, and keeps any
//     `var`/`const`/`function` declarations from colliding with other skills
//     in the shared user-script world.
//   - Scoped skills (built from "...on news sites") additionally gate on a
//     background category check: the body only runs when the page matches the
//     scope. messaging:true on the user-script world makes the round-trip
//     possible. Unscoped skills run immediately as before.
function wrapSkillCode(code, scope) {
  if (!scope || scope === 'general') {
    return `(function(){\n${code}\n})();`;
  }
  // Detect content contexts (taxonomy: video/form/document) so context:*
  // scopes can be evaluated by the background scope gate.
  const detectContexts = `var __ctx=[];`
    + `try{if(document.querySelector('video'))__ctx.push('video');`
    + `if(document.querySelector('form'))__ctx.push('form');`
    + `if((document.body&&document.body.innerText||'').length>5000)__ctx.push('document');}catch(e){}`;
  return `(function(){\n`
    + `var __run=function(){\n${code}\n};\n`
    + detectContexts + `\n`
    + `try{chrome.runtime.sendMessage(`
    + `{type:'aaScopeCheck',scope:${JSON.stringify(scope)},hostname:location.hostname,contexts:__ctx},`
    + `function(resp){if(chrome.runtime.lastError)return;if(resp&&resp.match){try{__run()}catch(e){}}});`
    + `}catch(e){}\n})();`;
}

async function syncCustomUserScripts() {
  if (!userScriptsAvailable()) return;
  let data, sync;
  try {
    data = await chrome.storage.local.get(['customSkills']);
    // Master switch lives in storage.sync as `enabled` (written by popup/onboarding)
    sync = await chrome.storage.sync.get(['enabled']);
  } catch { return; }

  let registered;
  try {
    registered = await chrome.userScripts.getScripts();
  } catch (e) {
    if (isDevModeError(e)) {
      console.warn('[AgenticA11y] Custom skills require Developer mode at chrome://extensions.');
    } else {
      console.warn('[AgenticA11y] getScripts failed:', e.message);
    }
    return;
  }

  await ensureUserScriptWorld();

  const ours = registered.filter(s => s.id.startsWith(USER_SCRIPT_ID_PREFIX));
  const ourIds = new Set(ours.map(s => s.id));
  const enabled = sync.enabled !== false;
  const customSkills = enabled ? (data.customSkills || []) : [];

  const desired = customSkills
    .filter(s => s && typeof s.code === 'string' && typeof s.id === 'string')
    // Treat missing `enabled` as true (existing skills predate the field).
    .filter(s => s.enabled !== false)
    .map(s => ({
      id: USER_SCRIPT_ID_PREFIX + s.id,
      js: [{ code: wrapSkillCode(s.code, s.scope) }],
      matches: ['<all_urls>'],
      runAt: 'document_idle',
      world: 'USER_SCRIPT',
    }));

  const desiredIds = new Set(desired.map(d => d.id));

  const toRemove = [...ourIds].filter(id => !desiredIds.has(id));
  if (toRemove.length > 0) {
    try { await chrome.userScripts.unregister({ ids: toRemove }); }
    catch (e) { console.warn('[AgenticA11y] unregister failed:', e.message); }
  }

  for (const script of desired) {
    try {
      if (ourIds.has(script.id)) {
        await chrome.userScripts.update([script]);
      } else {
        await chrome.userScripts.register([script]);
      }
    } catch (e) {
      console.warn('[AgenticA11y] register/update failed for', script.id, ':', e.message);
    }
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.customSkills) {
    syncCustomUserScripts();
  }
  // Master switch: `enabled` in storage.sync — unregister/re-register custom
  // adapters when the user toggles the extension.
  if (area === 'sync' && changes.enabled) {
    syncCustomUserScripts();
  }
});

ensureUserScriptWorld().then(syncCustomUserScripts);

// callGemini supports two third-arg shapes for backward compatibility:
//   - an array of image data URLs (legacy from main: multimodal vision calls)
//   - an options object: { images?: string[], mimeType?: string, model?: string,
//                          audioParts?: [{mimeType, data}] }
// New callers should use the object form; mimeType (e.g. 'application/json')
// asks Gemini to emit only valid JSON, which the skill-builder relies on for
// runtime AI calls inside saved skills.
// audioParts: array of {mimeType, data} for audio transcription (Increment 1
// captions). Uses the same inlineData path as images.
async function callGemini(prompt, apiKey, optsOrImages) {
  const opts = Array.isArray(optsOrImages)
    ? { images: optsOrImages }
    : (optsOrImages || {});
  const { images, mimeType, model, audioParts } = opts;

  const parts = [{ text: prompt }];
  if (images && images.length > 0) {
    for (const dataUrl of images) {
      const match = typeof dataUrl === 'string' && dataUrl.match(/^data:(.+?);base64,(.+)$/);
      if (!match) {
        // Refuse a non-data-URL image instead of silently dropping it: a
        // dropped image leaves Gemini describing nothing and inventing an
        // answer — the worst outcome for a screen-reader user relying on it.
        throw new Error('Image must be a base64 data URL, not a page URL');
      }
      parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
    }
  }
  // Audio parts: pre-extracted {mimeType, data} objects from the decode pipeline.
  if (audioParts && audioParts.length > 0) {
    for (const ap of audioParts) {
      if (ap.mimeType && ap.data) {
        parts.push({ inlineData: { mimeType: ap.mimeType, data: ap.data } });
      }
    }
  }

  const generationConfig = { temperature: 0.7 };
  if (mimeType) generationConfig.responseMimeType = mimeType;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30_000);
  let resp;
  try {
    resp = await fetch(getApiUrl(apiKey, model), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig,
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Gemini API error ${resp.status}: ${err}`);
  }
  const data = await resp.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error(`Gemini returned no text: ${JSON.stringify(data)}`);
  return text;
}

async function getApiKey() {
  const data = await chrome.storage.sync.get(['geminiApiKey', 'geminiKey']);
  return data.geminiApiKey || data.geminiKey || null;
}

// ---------- Voice offscreen lifecycle ----------------------------------
// chrome.offscreen.createDocument() requires `reasons` declaring why we
// need a hidden page. USER_MEDIA covers the mic capture; AUDIO_PLAYBACK
// keeps the page eligible to play sound when the panel is closed.
const OFFSCREEN_PATH = 'offscreen/offscreen.html';
const OFFSCREEN_REASONS = ['USER_MEDIA', 'AUDIO_PLAYBACK'];
let _offscreenCreating = null;

// ---------------------------------------------------------------------------
// Transcription refcount registry (finding #13)
// ---------------------------------------------------------------------------
// Tracks the number of in-flight transcribeMedia jobs so that a side-panel
// close (which calls closeOffscreen via voice port disconnect) does not abort
// captions that are mid-decode. closeOffscreen is deferred until the refcount
// reaches zero or a 60-second grace period expires.
//
// Also used to enforce concurrency=1 end-to-end: the second caller waits for
// the first to finish before proceeding (serialize decodes).
let _transcribeRefcount = 0;
let _transcribeIdleCallbacks = []; // resolved when _transcribeRefcount hits 0

function _transcribeAcquire() {
  _transcribeRefcount++;
}

function _transcribeRelease() {
  _transcribeRefcount = Math.max(0, _transcribeRefcount - 1);
  if (_transcribeRefcount === 0) {
    const cbs = _transcribeIdleCallbacks.splice(0);
    for (const cb of cbs) cb();
  }
}

/** Returns a promise that resolves when all in-flight transcriptions finish. */
function _waitTranscribeIdle() {
  if (_transcribeRefcount === 0) return Promise.resolve();
  return new Promise((resolve) => { _transcribeIdleCallbacks.push(resolve); });
}

// Serialize end-to-end: only one full transcribeMedia job runs at a time.
// The queue contains { run: () => Promise<void> } items.
let _transcribeQueue = Promise.resolve();

async function _hasOffscreen() {
  if (!chrome.offscreen) return false;
  // hasDocument is supported on Chrome 116+. Fallback uses getContexts.
  if (typeof chrome.offscreen.hasDocument === 'function') {
    return await chrome.offscreen.hasDocument();
  }
  if (typeof chrome.runtime.getContexts === 'function') {
    const ctxs = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
    return Array.isArray(ctxs) && ctxs.length > 0;
  }
  return false;
}

async function ensureOffscreen() {
  if (await _hasOffscreen()) return;
  // Race-guard: createDocument throws if called twice concurrently.
  if (_offscreenCreating) return _offscreenCreating;
  _offscreenCreating = chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: OFFSCREEN_REASONS,
    justification: 'Hold the Gemini Live WebSocket + audio capture/playback for voice control while the side panel may be closed.',
  }).finally(() => { _offscreenCreating = null; });
  await _offscreenCreating;
}

async function closeOffscreen() {
  if (!(await _hasOffscreen())) return;
  // If captions transcription is in flight, wait for it to finish before
  // tearing down the shared offscreen page (finding #13). Cap at 60 s so a
  // hung LLM call can't prevent the page from ever closing.
  if (_transcribeRefcount > 0) {
    const CLOSE_DEFER_MS = 60_000;
    await Promise.race([
      _waitTranscribeIdle(),
      new Promise((r) => setTimeout(r, CLOSE_DEFER_MS)),
    ]);
  }
  try { await chrome.offscreen.closeDocument(); } catch {}
}

// On SW startup, reconcile persisted voiceState with reality. The
// offscreen page owns the live connection state and writes it through
// to chrome.storage.local.voiceState; if the offscreen page isn't
// running (extension reload / Chrome restart / explicit teardown),
// any "live" / "connecting" status in storage is left over from a
// previous session and would mislead the side panel into rendering
// the live UI on a fresh load.
(async function _resetStaleVoiceStateOnStart() {
  try {
    if (await _hasOffscreen()) return; // real session in flight
    const { voiceState } = await chrome.storage.local.get('voiceState');
    if (!voiceState || voiceState.connection === 'disconnected') return;
    await chrome.storage.local.set({
      voiceState: {
        ...voiceState,
        connection: 'disconnected',
        recording: false,
        speaking: false,
        error: null,
      },
    });
    console.log('[voice] reset stale voiceState on SW start');
  } catch (e) {
    console.warn('[voice] stale-state reset failed:', e && e.message);
  }
})();

// Track UI ports (the side panel opens a runtime port on mount). When all
// ports close, we check the user's background-mode preference: if off,
// tear down the offscreen page so the WebSocket + mic also stop. The
// preference is persisted by the offscreen doc itself in
// chrome.storage.local.voiceBackgroundMode.
const _voicePorts = new Set();
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'voice-ui') return;
  _voicePorts.add(port);
  port.onDisconnect.addListener(async () => {
    _voicePorts.delete(port);
    if (_voicePorts.size > 0) return;
    const data = await chrome.storage.local.get('voiceBackgroundMode');
    if (!data.voiceBackgroundMode) {
      // Ask the offscreen doc to disconnect cleanly first; it stops mic
      // + closes the Live WS. Then close the page itself.
      try { await chrome.runtime.sendMessage({ type: 'voiceDisconnect' }); } catch {}
      try { await closeOffscreen(); } catch {}
    }
  });
});

// ---------- Storage-change forwarding for offscreen ---------------------
// The offscreen page can't subscribe to chrome.storage.onChanged when
// chrome.storage isn't exposed to it. We re-broadcast every change as a
// runtime message; the offscreen storage shim relays it to its
// in-process listeners (e.g. the agent bridge).
chrome.storage.onChanged.addListener((changes, area) => {
  // Log only bhAgent changes -- voiceState writes (chatty) would spam
  // the SW console without being useful for debugging the bridge path.
  if (changes && changes.bhAgent) {
    console.log('[bg] broadcasting bhAgent change to offscreen, area=', area);
  }
  chrome.runtime.sendMessage({
    type: 'voiceProxyStorageChange',
    changes,
    area,
  }).catch(() => {});
});

// ---------- Browser-agent terminal-state notifications -----------------
// When the browser agent finishes (done / error) AND the side panel is
// closed AND background mode is on, fire a desktop notification so the
// user knows to reopen the panel for the result.
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local' || !changes.bhAgent) return;
  const prev = changes.bhAgent.oldValue;
  const next = changes.bhAgent.newValue;
  if (!next || !prev) return;
  if (prev.status === next.status) return;
  if (next.status !== 'done' && next.status !== 'error') return;
  // Only notify when there's no UI surface visible.
  if (_voicePorts.size > 0) return;
  // And only if user opted into background mode (otherwise the offscreen
  // page is already gone and the notification could surprise them).
  const pref = await chrome.storage.local.get('voiceBackgroundMode');
  if (!pref.voiceBackgroundMode) return;
  if (!chrome.notifications) return;
  const title = next.status === 'done'
    ? 'Browser task complete'
    : 'Browser task failed';
  const message = next.summary || next.error || 'Tap to open the voice panel.';
  try {
    chrome.notifications.create('bhAgentDone', {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.svg'),
      title,
      message: String(message).slice(0, 200),
      priority: next.status === 'error' ? 2 : 1,
    });
  } catch (e) {
    console.warn('[voice] notification failed', e);
  }
});

// Reopen the side panel when the user clicks the notification.
if (chrome.notifications && chrome.notifications.onClicked) {
  chrome.notifications.onClicked.addListener(async (id) => {
    if (id !== 'bhAgentDone') return;
    try {
      const win = await chrome.windows.getCurrent();
      if (chrome.sidePanel && chrome.sidePanel.open) {
        await chrome.sidePanel.open({ windowId: win.id });
      }
      chrome.notifications.clear(id);
    } catch (e) {
      console.warn('[voice] reopen-panel failed', e);
    }
  });
}

// Hand the agent loop a Gemini caller that resolves the stored API key on
// every call. agent.js can't reach this closure on its own; it stays
// transport-agnostic so future runners (cli, skill-creator) can swap it.
if (globalThis.BrowserAgent) {
  globalThis.BrowserAgent.setGeminiCaller(async (prompt, apiKey, opts) => {
    const key = apiKey || await getApiKey();
    if (!key) throw new Error('No Gemini API key configured. Open extension settings.');
    return await callGemini(prompt, key, opts);
  });
}

// The Librarian's slow lane (extraction, reflection, playbooks) uses the
// same key-resolving caller.
if (globalThis.Librarian) {
  globalThis.Librarian.setGeminiCaller(async (prompt) => {
    const key = await getApiKey();
    if (!key) throw new Error('No Gemini API key configured.');
    return await callGemini(prompt, key);
  });
}

// Observe explicit setting toggles as memory signal. One listener instead
// of instrumenting every popup control: any sync-area change to a known
// tool setting is a deliberate user action (weight 3) — the popup, the
// onboarding finish, and profile "Apply" buttons all write through here.
const OBSERVED_SETTING_KEYS = new Set([
  'darkMode', 'readerMode', 'keyboardNav', 'voiceCommands', 'motionReducer', 'focusMode',
  'hideDistractions', 'showProgress', 'colorBlindMode', 'fontScale', 'lineHeight',
  'letterSpacing', 'contrastMode', 'dyslexiaFont', 'largeCursor', 'enhanceFocus',
  'readingGuide', 'speechRate', 'autoWcagFix', 'autoDescribe', 'autoSimplify',
  'autoSummarize', 'autoFixLabels', 'autoCaptions', 'fixContrast',
]);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync' || !globalThis.Librarian) return;
  const changed = Object.entries(changes).filter(([k]) => OBSERVED_SETTING_KEYS.has(k));
  if (!changed.length) return;
  (async () => {
    let origin = null;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.url) origin = new URL(tab.url).hostname;
    } catch {}
    for (const [key, { oldValue, newValue }] of changed) {
      // A REMOVE (newValue === undefined) means "revert to default" — e.g. a
      // voice undo of a change that first introduced this key. Don't mint a
      // durable user-explicit record for it (that would defeat the undo and
      // leave a final-say record pinning the default); the undo path removes
      // any existing record explicitly.
      if (newValue === undefined) continue;
      // This listener is async (it awaited tabs.query above), so by now a
      // faster follow-up write — most importantly a voice UNDO that removed the
      // key we're about to record — may have superseded newValue. Re-read the
      // live value and skip if it no longer matches, so we don't re-mint a
      // stale final-say record after an undo already deleted it.
      let fresh;
      try { fresh = (await chrome.storage.sync.get(key))[key]; } catch { fresh = newValue; }
      if (fresh !== newValue) continue;
      // Fast lane: make the change stick immediately (final say in the
      // effective-preferences merge); the episodic observation below is the
      // slow-lane signal for extraction/reflection.
      await globalThis.Librarian.recordExplicitSetting(key, newValue, origin).catch(() => {});
      await globalThis.Librarian.logObservation({
        type: 'setting-change',
        origin,
        text: `User changed setting ${key} from ${JSON.stringify(oldValue)} to ${JSON.stringify(newValue)}`,
        data: { key, oldValue, newValue },
      }).catch(() => {});
    }
  })();
});

// Routed from BOTH chrome.runtime.onMessage (extension pages: popup, builder,
// onboarding) AND chrome.runtime.onUserScriptMessage (user scripts running
// saved custom skills). User-script messages don't reach the regular
// onMessage listener — they have their own event channel — so without this
// shared handler, runtime AI calls from skills get no reply and return
// `undefined` to the caller.
function handleGeminiMessage(msg, sender, sendResponse) {
  (async () => {
    const callerId = sender?.userScriptWorldId != null
      ? `userScript:${sender.userScriptWorldId}`
      : (sender?.id || sender?.url || 'unknown');
    try {
      const apiKey = msg.apiKey || await getApiKey();
      if (!apiKey) {
        console.log('[AgenticA11y] gemini call from', callerId, '→ no API key');
        sendResponse({ error: 'No Gemini API key configured. Go to extension settings.' });
        return;
      }
      const result = await callGemini(msg.prompt, apiKey, {
        images: msg.images,
        mimeType: msg.mimeType,
        model: msg.model,
      });
      console.log('[AgenticA11y] gemini call from', callerId, '→ result length:', result.length);
      sendResponse({ result });
    } catch (e) {
      console.log('[AgenticA11y] gemini call from', callerId, '→ error:', e.message);
      sendResponse({ error: e.message });
    }
  })();
  return true;
}

if (chrome.runtime.onUserScriptMessage) {
  chrome.runtime.onUserScriptMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === 'gemini') {
      return handleGeminiMessage(msg, sender, sendResponse);
    }
  });
}

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('onboarding/onboarding.html') });
  }
});

// --- Browser harness dispatch -----------------------------------------
// Page-side callers (skill-builder, onboarding) reach the chrome.debugger-
// backed harness through this message. Keeps args explicit so each op's
// arity stays obvious from the call site.
function handleBrowserHarnessMessage(msg, sendResponse) {
  (async () => {
    try {
      const a = msg.args || {};
      const H = globalThis.BrowserHarness;
      if (!H) throw new Error('browser harness not loaded');
      let result;
      switch (msg.op) {
        case 'attach':            result = await H.attach(a.tabId); break;
        case 'detach':            result = await H.detach(a.tabId); break;
        case 'cdp':               result = await H.cdp(a.tabId, a.method, a.params || {}); break;
        case 'drainEvents':       result = H.drainEvents(a.tabId); break;
        case 'pendingDialog':     result = H.pendingDialog(a.tabId); break;
        case 'handleDialog':      await H.handleDialog(a.tabId, a.accept !== false, a.promptText ?? null); result = { ok: true }; break;
        case 'gotoUrl':           result = await H.gotoUrl(a.tabId, a.url); break;
        case 'pageInfo':          result = await H.pageInfo(a.tabId); break;
        case 'clickAt':           result = await H.clickAt(a.tabId, a.x, a.y, a.button || 'left', a.clicks || 1); break;
        case 'typeText':          result = await H.typeText(a.tabId, a.text); break;
        case 'fillInput':         await H.fillInput(a.tabId, a.selector, a.text, { clearFirst: a.clearFirst !== false, timeoutMs: a.timeoutMs || 0 }); result = { ok: true }; break;
        case 'pressKey':          result = await H.pressKey(a.tabId, a.key, a.modifiers || 0); break;
        case 'scroll':            result = await H.scroll(a.tabId, a.x, a.y, a.dy ?? -300, a.dx ?? 0); break;
        case 'captureScreenshot': result = await H.captureScreenshot(a.tabId, { full: !!a.full, maxDim: a.maxDim ?? null, cssNormalize: !!a.cssNormalize }); break;
        case 'listTabs':          result = await H.listTabs({ includeChrome: a.includeChrome !== false }); break;
        case 'currentTab':        result = await H.currentTab(); break;
        case 'switchTab':         result = await H.switchTab(a.tabId); break;
        case 'newTab':            result = await H.newTab(a.url || 'about:blank', { active: a.active !== false }); break;
        case 'ensureRealTab':     result = await H.ensureRealTab(); break;
        case 'iframeTarget':      result = await H.iframeTarget(a.tabId, a.urlSubstr); break;
        case 'js':                result = await H.js(a.tabId, a.expression, { iframeTargetId: a.iframeTargetId || null }); break;
        case 'dispatchKey':       result = await H.dispatchKey(a.tabId, a.selector, a.key || 'Enter', a.event || 'keypress'); break;
        case 'uploadFile':        result = await H.uploadFile(a.tabId, a.selector, a.files); break;
        case 'waitForLoad':       result = await H.waitForLoad(a.tabId, { timeoutMs: a.timeoutMs }); break;
        case 'waitForElement':    result = await H.waitForElement(a.tabId, a.selector, { timeoutMs: a.timeoutMs ?? 10000, visible: !!a.visible }); break;
        case 'waitForNetworkIdle': result = await H.waitForNetworkIdle(a.tabId, { timeoutMs: a.timeoutMs ?? 10000, idleMs: a.idleMs ?? 500 }); break;
        case 'httpGet':           result = await H.httpGet(a.url, a.headers); break;

        // Skills registry — bundled markdown + agent-written persistence.
        case 'listInteractionSkills': result = await globalThis.BrowserSkills.listInteraction(); break;
        case 'listDomainSkills':      result = await globalThis.BrowserSkills.listDomain(a.hostname); break;
        case 'readSkill':             result = await globalThis.BrowserSkills.read(a.kind, a.name, a.host); break;
        case 'writeSkill':            result = await globalThis.BrowserSkills.write(a.kind, a.name, a.content, a.host); break;
        case 'deleteSkill':           result = await globalThis.BrowserSkills.remove(a.kind, a.name, a.host); break;

        default: throw new Error(`unknown harness op: ${msg.op}`);
      }
      sendResponse({ result });
    } catch (e) {
      sendResponse({ error: e.message || String(e) });
    }
  })();
  return true;
}

// ---------------------------------------------------------------------------
// _doTranscribeMedia — inner worker for the transcribeMedia message handler.
// Extracted so it can be called through the serialize queue without the outer
// voice-mutual-exclusion + refcount boilerplate. Calls sendResponse directly.
// (finding #13 + #15)
// ---------------------------------------------------------------------------
async function _doTranscribeMedia(url, apiKey, MAX_MEDIA_BYTES, CHUNK_CONCURRENT, sendResponse) {
  // Step 1: fetch media bytes via streaming reader with incremental size cap
  // (finding #15 — content-length is missing for chunked responses, so we
  // must count bytes as they arrive rather than relying on the header alone).
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5 * 60 * 1000);
  let mediaResp;
  try {
    mediaResp = await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
  if (!mediaResp.ok) {
    sendResponse({ error: `transcribeMedia: fetch failed ${mediaResp.status}` });
    return;
  }

  // Pre-check content-length when present (fast-path reject for large files).
  const contentLength = parseInt(mediaResp.headers.get('content-length') || '0', 10);
  if (contentLength > MAX_MEDIA_BYTES) {
    sendResponse({ error: 'transcribeMedia: media too large (>50MB)' });
    return;
  }

  // Stream-read with an incremental byte counter so chunked/no-header
  // responses are also capped before the full body is in memory.
  let arrayBuffer;
  {
    const reader = mediaResp.body.getReader();
    const chunks = [];
    let totalBytes = 0;
    let aborted = false;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > MAX_MEDIA_BYTES) {
          aborted = true;
          reader.cancel().catch(() => {});
          break;
        }
        chunks.push(value);
      }
    } catch (e) {
      reader.cancel().catch(() => {});
      throw e;
    }
    if (aborted) {
      sendResponse({ error: 'transcribeMedia: media too large (>50MB)' });
      return;
    }
    // Assemble into a single ArrayBuffer.
    const combined = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    arrayBuffer = combined.buffer;
  }

  // Step 2: ensure offscreen doc exists.
  await ensureOffscreen();

  // Step 3: send bytes to offscreen for decode+chunk.
  // Transfer as ArrayBuffer via structured clone (not base64 — avoids 33% overhead
  // for a buffer that may be tens of MB).
  const decodeResp = await new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: 'captionDecodeAudio', buffer: arrayBuffer },
      (r) => { resolve(r || {}); }
    );
  });
  if (decodeResp.error) {
    sendResponse({ error: `transcribeMedia: decode error: ${decodeResp.error}` });
    return;
  }
  const wavChunks = decodeResp.chunks; // [{startSec, endSec, wavBase64}]
  if (!Array.isArray(wavChunks) || !wavChunks.length) {
    sendResponse({ error: 'transcribeMedia: no audio chunks returned' });
    return;
  }

  // Step 4: transcribe each chunk via Gemini (2 concurrent).
  const results = new Array(wavChunks.length);
  const queue = wavChunks.map((c, i) => ({ ...c, index: i }));

  async function processChunk(item) {
    const { startSec, endSec, wavBase64, index } = item;
    try {
      const text = await callGemini(
        'Transcribe this audio exactly. Return only the transcript text, nothing else.',
        apiKey,
        { audioParts: [{ mimeType: 'audio/wav', data: wavBase64 }] }
      );
      results[index] = { startSec, endSec, text: (text || '').trim() };
    } catch (e) {
      console.warn('[AI4A11y] chunk transcription error:', e.message);
      results[index] = { startSec, endSec, text: '' };
    }
  }

  // Sliding window of CHUNK_CONCURRENT.
  let qi = 0;
  async function runWorker() {
    while (qi < queue.length) {
      const item = queue[qi++];
      await processChunk(item);
    }
  }
  const workers = [];
  for (let w = 0; w < Math.min(CHUNK_CONCURRENT, queue.length); w++) {
    workers.push(runWorker());
  }
  await Promise.all(workers);

  // Filter empty chunks, return the rest.
  const chunks = results.filter(c => c && c.text);
  sendResponse({ chunks });
}

// Try narrower searches in background tabs and read the REAL result counts.
// The alternative shipped first: the model was asked to guess, and answered
// with invented numbers ("Estimated results: ~2,000"). A count the page never
// said is exactly the kind of claim this layer exists to replace.
async function probeNarrower(tabUrl) {
  const st = (await chrome.storage.local.get('aa.validation'))['aa.validation'] || {};
  const c = st.contract || {};
  let base = '';
  let origin = 'https://www.amazon.com';
  try {
    const u = new URL(tabUrl);
    origin = u.origin;
    base = (u.searchParams.get('k') || '').trim();
  } catch { /* fall through to the contract's own query */ }
  if (!base) base = globalThis.ValidationAsk?.toQuery?.(c) || String(c.item || '');
  if (!base) return null;

  // Narrower means: a term of the ask that the query does not carry yet.
  const have = new Set(base.toLowerCase().split(/\s+/));
  const terms = [
    ...(Array.isArray(c.mustHaves) ? c.mustHaves : []),
    c.size ? `size ${c.size}` : null,
  ].filter(Boolean)
   .filter((t) => !String(t).toLowerCase().split(/\s+/).every((w) => have.has(w)));
  const candidates = terms.slice(0, 3).map((t) => `${base} ${t}`);
  if (!candidates.length) return null;

  const options = [];
  for (const q of candidates) {
    const url = `${origin}/s?k=${encodeURIComponent(q)}`;
    let tab = null;
    try {
      tab = await chrome.tabs.create({ url, active: false });
      probeTabs.add(tab.id);
      // Wait for the load, then the same settle the observe trigger uses.
      await new Promise((resolve) => {
        const done = (id, info) => {
          if (id === tab.id && info.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(done);
            clearTimeout(to);
            setTimeout(resolve, 1200);
          }
        };
        // The timeout path removes the listener too - leaving it leaked one
        // closure per timed-out candidate for the worker's lifetime.
        const to = setTimeout(() => {
          chrome.tabs.onUpdated.removeListener(done);
          resolve();
        }, 15000);
        chrome.tabs.onUpdated.addListener(done);
      });
      const snap = await globalThis.BrowserHarness.axSnapshot(tab.id);
      const m = /of\s+(?:over\s+|about\s+)?([\d,]+)\s+results/i.exec(snap.text)
             || /([\d,]+)\s+results/i.exec(snap.text);
      options.push({ query: q, count: m ? m[1] : null });
    } catch (e) {
      options.push({ query: q, count: null });
    } finally {
      if (tab) {
        probeTabs.delete(tab.id);
        chrome.tabs.remove(tab.id).catch?.(() => {});
      }
    }
  }
  return options;
}

// Probe, don't guess. The card goes up immediately so the press is seen to
// have done something; the real counts replace it when read. Falls back to
// asking the agent when the ask has no unused terms left to add.
async function runRefineProbe(fallbackSay) {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  await globalThis.Validation?.annotate?.({
    probe: { ask: 'Trying narrower searches…', options: [] } });
  const options = await probeNarrower(tabs[0]?.url || '');
  if (options && options.length) {
    await globalThis.Validation?.annotate?.({
      probe: { ask: 'I tried these. Pick one, or keep the current search.', options } });
    const best = options.filter((o) => o.count)[0];
    chrome.runtime.sendMessage({
      type: 'validationSpeak', phase: 'probe',
      lines: [{ say: `I tried ${options.length} narrower searches.`
        + (best ? ` "${best.query}" has ${best.count} results.` : ''),
        level: 'aside', live: 'polite', widget: 'probe' }],
    }).catch(() => {});
  } else {
    await globalThis.Validation?.annotate?.({ probe: null });
    if (fallbackSay) await steerAgent(fallbackSay);
  }
  return (options || []).length;
}

// One steering path for everything the person sends the agent - the tell
// box, a finding's control, a gate answer, an option button. Running means
// queued for the very next model call. Ended mid-task means the person's
// words ARE the task continuing, so a fresh run starts on the same tab
// carrying the original ask - the alternative was the live dead end where
// the agent asked "which option?", ended, and every answer was refused with
// "no agent is running". No task at all is said honestly.
async function steerAgent(say) {
  if (globalThis.BrowserAgent?.isRunning?.()) {
    return globalThis.BrowserAgent.interject(say);
  }
  // ensureRunning, not isRunning: a worker restart nulls the session's module
  // state while the stored run lives on, and the sync check answered "no
  // task" to the person's first press after every restart.
  if (globalThis.BrowserAgent && await globalThis.Validation?.ensureRunning?.()) {
    const prev = (await chrome.storage.local.get('bhAgent')).bhAgent || {};
    // The agent's own tab, while it still exists - the run usually works in
    // a background tab, so "the active tab" is wherever the person is
    // reading, not where the task was.
    let tabId = prev.tabId ?? null;
    if (tabId != null) {
      try { await chrome.tabs.get(tabId); } catch { tabId = null; }
    }
    if (tabId == null) {
      const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      tabId = tabs[0]?.id;
    }
    // Continuations do not compound: the base task is kept, the newest
    // instruction replaces the previous continuation clause.
    const base = String(prev.task || '').split('. Continuing where you left off:')[0];
    const task = base ? `${base}. Continuing where you left off: ${say}` : say;
    globalThis.BrowserAgent.run(task, { tabId }).catch((e) => {
      // Two presses can race past the isRunning check; the loser's
      // instruction still reaches the agent instead of vanishing.
      if (/already running/i.test(e.message || '')) {
        globalThis.BrowserAgent.interject(say);
      } else {
        console.warn('[BrowserAgent] continue failed:', e.message);
      }
    });
    return { queued: 1, continued: true };
  }
  return { queued: 0, why: 'no agent is running — this is your own browsing' };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'gemini') {
    return handleGeminiMessage(msg, sender, sendResponse);
  }

  if (msg.type === 'bh') {
    return handleBrowserHarnessMessage(msg, sendResponse);
  }

  // ---- Voice (offscreen document lifecycle) ---------------------------
  // The offscreen page (extension/offscreen/offscreen.html) hosts the
  // Gemini Live WebSocket + AudioWorklet -- APIs that don't exist in the
  // SW. The side panel sends `voiceEnsure` to make sure the page is up
  // before issuing voice* commands; subsequent commands route directly
  // to the offscreen page's own onMessage listener.
  if (msg.type === 'voiceEnsure') {
    ensureOffscreen()
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ error: e.message || String(e) }));
    return true;
  }

  if (msg.type === 'voiceTeardown') {
    // Explicit shutdown -- closes the offscreen page regardless of
    // background-mode preference. Used from "End voice session".
    (async () => {
      try { await chrome.runtime.sendMessage({ type: 'voiceDisconnect' }); } catch {}
      try { await closeOffscreen(); } catch {}
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (msg.type === 'voiceProxyStorage') {
    // Some Chrome builds don't expose chrome.storage to offscreen
    // documents even with the "storage" manifest permission. The
    // offscreen's storage shim falls back to this proxy. The SW
    // always has chrome.storage available -- it does the operation
    // here and replies. Supports {op: 'get'|'set'|'remove', area:
    // 'local'|'sync', payload: keys-or-values}.
    (async () => {
      try {
        const area = msg.area === 'sync' ? 'sync' : 'local';
        const target = chrome.storage[area];
        switch (msg.op) {
          case 'get': {
            const data = await target.get(msg.payload);
            sendResponse({ ok: true, data });
            return;
          }
          case 'set':
            await target.set(msg.payload || {});
            sendResponse({ ok: true });
            return;
          case 'remove':
            await target.remove(msg.payload);
            sendResponse({ ok: true });
            return;
          default:
            sendResponse({ error: `unknown storage op: ${msg.op}` });
        }
      } catch (e) {
        sendResponse({ error: e.message || String(e) });
      }
    })();
    return true;
  }

  if (msg.type === 'bhAgentStart') {
    // Kick the loop and answer immediately. Progress lands in
    // chrome.storage.local.bhAgent; the popup tails it via storage.onChanged
    // so it survives the popup closing.
    if (!globalThis.BrowserAgent) {
      sendResponse({ error: 'agent not loaded' });
      return false;
    }
    if (globalThis.BrowserAgent.isRunning()) {
      sendResponse({ error: 'agent already running' });
      return false;
    }
    // Start checking at the same moment the agent starts acting.
    //
    // Not a separate button. A validation layer someone has to remember to
    // switch on is off exactly when it matters — nobody predicts the run that
    // will go wrong. Delegating and being able to check what was delegated are
    // one action, so they are one call.
    //
    // `msg.contract` is honoured when the caller already built one (the panel
    // does, after asking about the gaps); otherwise the task sentence is
    // parsed, and whatever could not be read from it becomes a question rather
    // than a guess.
    if (globalThis.Validation && !globalThis.Validation.isRunning()) {
      try {
        const contract = msg.contract || globalThis.ValidationAsk.contractFromAsk(msg.task);
        globalThis.Validation.start(contract, { style: msg.style || 'balanced' });
      } catch (e) {
        console.warn('validation did not start:', e);   // never block the agent
      }
    }
    globalThis.BrowserAgent.run(msg.task, {
      tabId: msg.tabId,
      tabMode: msg.tabMode,
      maxSteps: msg.maxSteps,
    }).catch((e) => {
      // Agent already wrote the error to storage; nothing more to do here.
      console.warn('[BrowserAgent] run failed:', e.message);
    });
    sendResponse({ started: true });
    return false;
  }

  // ---- validation layer -------------------------------------------------
  if (msg.type === 'validationStart') {
    globalThis.Validation.start(msg.contract, msg.opts || {})
      .then((r) => sendResponse(r))
      .catch((e) => sendResponse({ error: e.message }));
    return true;
  }
  if (msg.type === 'validationObserve') {
    globalThis.Validation.observe(msg.tabId, msg.opts || {})
      .then((r) => sendResponse(r))
      .catch((e) => sendResponse({ error: e.message }));
    return true;
  }
  if (msg.type === 'validationAllow') {
    globalThis.Validation.allow(msg.action)
      .then((r) => sendResponse(r))
      .catch((e) => sendResponse({ error: e.message }));
    return true;
  }
  if (msg.type === 'validationDone') {
    // The person ends the task. Stops the agent too — a run whose checking has
    // been ended is a run nobody is watching, and that is the one state this
    // whole layer exists to prevent.
    (async () => {
      try { globalThis.BrowserAgent?.stop?.(); } catch (e) { /* not fatal */ }
      const s = await globalThis.Validation.summary?.();
      await globalThis.Validation.stop();
      sendResponse({ ended: true, summary: s || null });
    })();
    return true;
  }
  if (msg.type === 'agentTell') {
    const said = String(msg.said || '').trim();
    if (!said) { sendResponse({ error: 'nothing said' }); return false; }
    steerAgent(said).then(sendResponse);
    return true;
  }
  if (msg.type === 'validationAck') {
    globalThis.Validation.acknowledge(msg.key)
      .then(sendResponse).catch((e) => sendResponse({ error: e.message }));
    return true;
  }
  if (msg.type === 'validationEdit') {
    globalThis.Validation.editAsk(msg.field, msg.value)
      .then(sendResponse).catch((e) => sendResponse({ error: e.message }));
    return true;
  }
  if (msg.type === 'validationPromote') {
    globalThis.Validation.promote(msg.offer, msg.always)
      .then(sendResponse).catch((e) => sendResponse({ error: e.message }));
    return true;
  }
  if (msg.type === 'validationToggleRule') {
    globalThis.Validation.toggleRule(msg.id)
      .then(sendResponse).catch((e) => sendResponse({ error: e.message }));
    return true;
  }
  if (msg.type === 'validationAnswer') {
    // The agent hears the decision BEFORE the hold releases. Resolving the
    // hold alone meant "Change the size" let the agent resume and add the
    // wrong size anyway - the answer never reached it. steerAgent queues the
    // instruction (or restarts an ended agent); only then does answer()
    // unblock.
    (async () => {
      try {
        // A gate answer on a widget that probes goes through the probe, not
        // through a sentence - otherwise "Narrow it down" at the gate got
        // the model's invented counts while the same press on the finding
        // card measured real ones.
        const st = (await chrome.storage.local.get('aa.validation'))['aa.validation'] || {};
        const held = (st.findings || []).find((f) => f.widget === msg.widget && f.control);
        if (held?.control?.action === 'refine-narrow' && !/keep|leave|go on/i.test(String(msg.response))) {
          // Not awaited - the card lands when measured. But a probe that
          // finds nothing to try must not leave the agent waiting for a
          // pick that will never come.
          runRefineProbe(null).then((n) => {
            if (!n) {
              steerAgent('Never mind the wait. No narrower search to measure - '
                + 'suggest your own way to narrow the results, then continue.');
            }
          });
          await steerAgent('Wait. I am measuring narrower searches; a pick is coming.');
        } else {
          await steerAgent(`About ${msg.widget}: the person chose "${msg.response}". Do that before anything else.`);
        }
        const r = await globalThis.Validation.answer(msg.widget, msg.response);
        sendResponse(r);
      } catch (e) {
        sendResponse({ error: e.message });
      }
    })();
    return true;
  }
  if (msg.type === 'validationStop') {
    globalThis.Validation.stop().then(() => sendResponse({ stopped: true }));
    return true;
  }
  if (msg.type === 'validationControl') {
    // A control the panel offered -- re-sort, open another, change the size.
    // These are what delegation took away, so they go to the agent as a fresh
    // instruction rather than being simulated here.
    const c = msg.control || {};
    // Keyed by the action ids the corpus actually emits - the first version
    // of this map used five ids of its own invention, none of which the
    // corpus produces, so every control on a live run was a dead button.
    const say = {
      'what-can-you-filter-by': 'Read me the filters this page offers, then wait for my pick.',
      'what-color-options': 'Read me the color options for this item, then wait for my pick.',
      'can-you-re-sort-them': 'Re-sort the results by rating and tell me the new first result.',
      'free-returns': 'Open the returns policy and tell me whether returns are free for this item.',
      'which-delivery-do-you-pick': 'Read me the delivery options, then wait for my pick.',
      'can-you-place-it': 'Do not place the order. Tell me the total and wait for me.',
      'can-you-change-details': 'Read me the current selections, then wait while I change one.',
      'can-you-open-it': 'Open the next best match instead and read me its title.',
      'can-you-pick-the-size': 'Read me the sizes this page offers, then wait for my pick.',
      'can-you-add-it': 'Before adding anything to the cart, read me exactly what would be added.',
      'can-you-check-out': 'Before going to checkout, read me what is in the cart.',
      // the nine cluster defaults, one per decision type in the analysis
      'refine-narrow': 'Suggest two or three narrower searches, with roughly how many results each would leave, then wait for my pick.',
      'compare-diff': 'Read me the differences between the top options, one at a time.',
      'select-options': 'Read me the options, then wait for me to choose.',
      'approve-change': 'Do not commit this step yet. Read me exactly what is about to happen, then wait for my go-ahead.',
      'facts-source': 'Read me the exact words on the page that say that.',
      'photos-describe': 'Describe the product photos, including anything the listing text does not say.',
      'receipts-readback': 'Read me back exactly what was done, with the numbers.',
      'undo-last': 'Undo it. If it was an order, cancel it. Tell me when it is done.',
      'hand-over': 'Stop and let me do this part myself. Tell me where things stand.',
      're-sort': `Re-sort the results by ${c.arg || 'rating'} and tell me the new first result.`,
      'pick-size': 'Read me the sizes on this page and wait for me to choose.',
      'remove-extras': 'Remove everything from the cart that is not the item we picked today.',
      'open-other': 'Open the next best match instead and read me its title.',
      'halt': 'Stop what you are doing and wait.',
    }[c.action]
      // An action this map has never heard of must not be a dead button:
      // the label names the person's move, so it becomes the instruction.
      || (c.label ? `${c.label}. Then tell me what changed.` : null);
    if (c.action === 'refine-narrow') {
      runRefineProbe(say).then((n) => sendResponse({ probed: n }));
      return true;
    }
    if (c.action === 'probe-pick') {
      (async () => {
        await globalThis.Validation?.annotate?.({ probe: null });
        const r = c.query ? await steerAgent(`Search for "${c.query}" now and continue the task with those results.`) : {};
        sendResponse({ sent: c.query || null, ...r });
      })();
      return true;
    }
    if (!say) { sendResponse({ error: `no instruction for ${c.action}` }); return false; }
    steerAgent(say).then((r) => {
      chrome.runtime.sendMessage({
        type: 'validationSpeak', phase: 'control',
        lines: [{ say, level: 'aside', live: 'polite', widget: c.action }],
      }).catch(() => {});
      sendResponse({ sent: say, ...r });
    });
    return true;
  }

  if (msg.type === 'validationOnRequest') {
    sendResponse({ items: globalThis.Validation.onRequest() });
    return false;
  }

  if (msg.type === 'bhAgentStop') {
    globalThis.BrowserAgent?.stop();
    sendResponse({ success: true });
    return false;
  }

  if (msg.type === 'bhAgentClear') {
    (async () => {
      try {
        await globalThis.BrowserAgent?.clear();
        sendResponse({ success: true });
      } catch (e) {
        sendResponse({ error: e.message });
      }
    })();
    return true;
  }

  if (msg.type === 'saveApiKey') {
    chrome.storage.sync.set({ geminiApiKey: msg.apiKey }, () => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (msg.type === 'getApiKey') {
    getApiKey().then(key => sendResponse({ apiKey: key }));
    return true;
  }

  if (msg.type === 'aiStatus') {
    // Returns {configured: bool} — NEVER returns the key itself.
    getApiKey().then(key => sendResponse({ configured: !!key }));
    return true;
  }

  if (msg.type === 'getActiveSkills') {
    chrome.storage.local.get(['activeSkills', 'customSkills'], (data) => {
      sendResponse({
        activeSkills: data.activeSkills || [],
        customSkills: data.customSkills || []
      });
    });
    return true;
  }

  if (msg.type === 'setActiveSkills') {
    chrome.storage.local.set({ activeSkills: msg.skills }, () => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (msg.type === 'saveCustomSkill') {
    chrome.storage.local.get('customSkills', (data) => {
      const customs = data.customSkills || [];
      const existing = customs.findIndex(s => s.id === msg.skill.id);
      if (existing >= 0) {
        customs[existing] = msg.skill;
      } else {
        customs.push(msg.skill);
      }
      chrome.storage.local.set({ customSkills: customs }, () => {
        sendResponse({ success: true });
      });
    });
    return true;
  }

  if (msg.type === 'deleteCustomSkill') {
    chrome.storage.local.get('customSkills', (data) => {
      const customs = (data.customSkills || []).filter(s => s.id !== msg.skillId);
      chrome.storage.local.set({ customSkills: customs }, () => {
        sendResponse({ success: true });
      });
    });
    return true;
  }

  if (msg.type === 'executeCustomSkill') {
    (async () => {
      try {
        await ensureUserScriptWorld();
        // Preferred path: chrome.userScripts.execute runs in the user-scripts
        // world whose CSP we configured to allow `unsafe-eval`, so arbitrary
        // skill code works even on strict-CSP pages (Google, GitHub, etc).
        if (userScriptsAvailable() && typeof chrome.userScripts.execute === 'function') {
          await chrome.userScripts.execute({
            target: { tabId: msg.tabId },
            js: [{ code: msg.code }],
            world: 'USER_SCRIPT',
          });
          sendResponse({ success: true });
          return;
        }
        // Fallback for older Chrome: scripting + new Function. This will fail
        // on strict-CSP pages, but works on permissive pages.
        await chrome.scripting.executeScript({
          target: { tabId: msg.tabId },
          func: (code) => {
            try {
              const fn = new Function(code);
              fn();
            } catch (e) {
              console.error('[AgenticA11y] Custom skill error:', e);
            }
          },
          args: [msg.code],
        });
        sendResponse({ success: true });
      } catch (e) {
        if (isDevModeError(e)) {
          sendResponse({
            error: 'Custom adapters need Developer mode enabled. Open chrome://extensions and toggle Developer mode in the top-right, then try again.',
          });
        } else {
          sendResponse({ error: e.message });
        }
      }
    })();
    return true;
  }

  if (msg.type === 'getUserScriptsStatus') {
    (async () => {
      let result;
      try {
        const us = chrome.userScripts;
        const diag = {
          chromeVersion: (navigator.userAgent.match(/Chrome\/(\d+)/) || [])[1] || 'unknown',
          userScriptsType: typeof us,
          hasGetScripts: !!(us && typeof us.getScripts === 'function'),
          hasExecute: !!(us && typeof us.execute === 'function'),
          hasRegister: !!(us && typeof us.register === 'function'),
          hasConfigureWorld: !!(us && typeof us.configureWorld === 'function'),
        };
        console.log('[AgenticA11y] userScripts diag:', diag);

        if (!us || typeof us.getScripts !== 'function') {
          result = {
            available: false,
            reason: 'toggle_off',
            message: `chrome.userScripts is ${diag.userScriptsType}. Toggle "Allow user scripts" for this extension at chrome://extensions, then reload the extension.`,
            diag,
          };
        } else {
          try {
            const scripts = await us.getScripts();
            result = { available: true, registeredCount: scripts.length, diag };
          } catch (e) {
            result = {
              available: false,
              reason: isDevModeError(e) ? 'developer_mode' : 'error',
              message: e.message,
              diag,
            };
          }
        }
      } catch (e) {
        result = {
          available: false,
          reason: 'handler_crash',
          message: 'getUserScriptsStatus handler threw: ' + ((e && e.message) || String(e)),
        };
      }
      console.log('[AgenticA11y] getUserScriptsStatus →', result);
      try { sendResponse(result); }
      catch (e) { console.warn('[AgenticA11y] sendResponse failed:', e); }
    })();
    return true;
  }

  if (msg.type === 'getUserProfile') {
    chrome.storage.local.get('userProfile', (data) => {
      sendResponse({ profile: data.userProfile || null });
    });
    return true;
  }

  // Demo trace relay: page/content contexts can't reach the SW-global
  // aaDemoTrace, so they message it here.
  if (msg.type === 'aaDemoTrace') {
    globalThis.aaDemoTrace(msg.diagram, msg.region, msg.label);
    sendResponse({ ok: true });
    return false;
  }

  // Scope gate for scoped custom skills: the wrapped skill asks whether the
  // current page matches its scope before running its body. Deterministic
  // (hostmap + cached classifications), so it's fast and adds no Gemini call.
  if (msg.type === 'aaScopeCheck') {
    (async () => {
      try {
        const scope = msg.scope || 'general';
        const host = (msg.hostname || '').toLowerCase().replace(/^www\./, '');
        let match = true;
        if (scope.startsWith('origin:')) {
          const want = scope.slice(7).toLowerCase().replace(/^www\./, '');
          match = host === want || host.endsWith('.' + want);
        } else if (scope.startsWith('category:')) {
          const cat = await globalThis.Librarian.getSiteCategory(host, { allowLlm: false });
          match = cat === scope.slice(9);
        } else if (scope.startsWith('context:')) {
          // Content contexts (video/form/document) are page properties the
          // sender detects; it passes them as msg.contexts (array of ids).
          match = Array.isArray(msg.contexts) && msg.contexts.includes(scope.slice(8));
        }
        sendResponse({ match });
      } catch (e) {
        sendResponse({ match: false });
      }
    })();
    return true;
  }

  // ---------------------------------------------------------------------------
  // Axe audit route
  // ---------------------------------------------------------------------------
  // Injects axe-core into the active tab (or a specified tabId), runs it for
  // the rule IDs we handle, then calls window.__ai4a11yAxeDispatch in the
  // content script with the violations array.
  //
  // Trigger paths:
  //   - popup "Scan & Fix" button sends { type: 'runAxeAudit' }
  //   - content.js debounced re-scan sends { type: 'runAxeAudit', tabId } when
  //     autoWcagFix is on AND a first scan was user-triggered (session flag).
  //
  // Security: axe.min.js is a packed extension file (not from a remote URL),
  // injected into the ISOLATED world. No user data is sent anywhere.
  if (msg.type === 'runAxeAudit') {
    (async () => {
      try {
        let tabId = msg.tabId;
        if (!tabId) {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          tabId = tab?.id;
        }
        if (!tabId) { sendResponse({ error: 'no tab' }); return; }

        // Rule IDs we handle (intersection of axe 4.12 and our combined handler map).
        const HANDLED_RULES = [
          'html-has-lang', 'html-lang-valid', 'valid-lang',
          'duplicate-id', 'duplicate-id-aria', 'duplicate-id-active',
          'tabindex', 'aria-valid-attr', 'aria-roles', 'aria-allowed-role',
          'aria-deprecated-role', 'nested-interactive', 'target-size',
          'meta-viewport', 'meta-viewport-large', 'blink', 'marquee',
          'heading-order',
          // From other modules:
          'color-contrast', 'color-contrast-enhanced', 'link-in-text-block',
          'image-alt', 'svg-img-alt',
          'link-name', 'button-name', 'frame-title', 'label', 'select-name',
          'video-caption', 'audio-caption',
        ];

        // Step 1: inject axe-core into the isolated world.
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ['lib/axe.min.js'],
        });

        // Step 2: run axe and dispatch violations to the content script.
        await chrome.scripting.executeScript({
          target: { tabId },
          func: (ruleIds) => {
            /* global axe */
            axe.run(document, {
              resultTypes: ['violations'],
              runOnly: { type: 'rule', values: ruleIds },
            }).then(results => {
              if (typeof window.__ai4a11yAxeDispatch === 'function') {
                window.__ai4a11yAxeDispatch(results.violations);
              }
            }).catch(e => console.warn('[AI4A11y] axe.run error:', e));
          },
          args: [HANDLED_RULES],
        });

        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ error: e.message || String(e) });
      }
    })();
    return true;
  }

  // -------------------------------------------------------------------------
  // transcribeMedia — captions adapter Increment 1
  // -------------------------------------------------------------------------
  // 1. Fetch media bytes under host_permissions (size-capped at 50MB).
  // 2. Ensure the offscreen document is up (reuse ensureOffscreen).
  // 3. Send bytes to the offscreen doc for AudioContext.decodeAudioData →
  //    slice into ~15s PCM chunks → re-encode each as WAV base64.
  // 4. Call Gemini per chunk (audio/wav inlineData, same callGemini path as
  //    images but with an audio MIME type part).
  // 5. Return [{startSec, endSec, text}] to the caller.
  //
  // Concurrency: 2 chunks at a time to avoid stampeding Gemini.
  // Overall AbortSignal timeout: 5 minutes for large files.
  if (msg.type === 'transcribeMedia') {
    (async () => {
      const MAX_MEDIA_BYTES = 50 * 1024 * 1024; // 50MB
      const CHUNK_CONCURRENT = 2;

      try {
        const url = msg.url;
        if (!url || typeof url !== 'string' || (!url.startsWith('http://') && !url.startsWith('https://'))) {
          sendResponse({ error: 'transcribeMedia: invalid url' });
          return;
        }

        const apiKey = await getApiKey();
        if (!apiKey) {
          sendResponse({ error: 'No Gemini API key configured.' });
          return;
        }

        // Mutual exclusion with voice Live session (finding #13): if the voice
        // WebSocket is active, the shared offscreen AudioContext is in use for
        // mic capture / playback. Attempting to decode media audio on top would
        // stack AudioContexts and risk disrupting the session. Return a retryable
        // error so the adapter shows an honest notice to the user.
        const { voiceState: vs } = await chrome.storage.local.get('voiceState');
        if (vs && vs.connection !== 'disconnected' && vs.connection) {
          sendResponse({
            error: 'transcribeMedia: voice mode is using audio — try again after the voice session ends',
            retryable: true,
          });
          return;
        }

        // Serialize end-to-end: queue this job behind any already-running decode
        // (finding #13 — concurrent per-video decodes stack AudioContexts).
        let resolveJob;
        const jobPromise = new Promise((r) => { resolveJob = r; });
        _transcribeQueue = _transcribeQueue.then(() => jobPromise);

        _transcribeAcquire();
        try {
          await _doTranscribeMedia(url, apiKey, MAX_MEDIA_BYTES, CHUNK_CONCURRENT, sendResponse);
        } finally {
          _transcribeRelease();
          resolveJob();
        }
      } catch (e) {
        sendResponse({ error: e.message || String(e) });
      }
    })();
    return true;
  }

  if (msg.type === 'fetchImageBytes') {
    // Fetch image bytes under host_permissions for cross-origin image freezing
    // in the motion-reducer adapter. Returns base64-encoded bytes.
    // Size bound: 8MB to prevent abuse.
    (async () => {
      const MAX_BYTES = 8 * 1024 * 1024;
      try {
        const url = msg.url;
        if (!url || typeof url !== 'string' || !url.startsWith('http')) {
          sendResponse({ error: 'invalid url' });
          return;
        }
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10_000);
        let resp;
        try {
          resp = await fetch(url, { signal: controller.signal });
        } finally {
          clearTimeout(timeoutId);
        }
        if (!resp.ok) { sendResponse({ error: `fetch failed: ${resp.status}` }); return; }
        // Pre-check content-length when available (fast path).
        const contentLength = parseInt(resp.headers.get('content-length') || '0', 10);
        if (contentLength > MAX_BYTES) { sendResponse({ error: 'image too large' }); return; }
        // Stream-read with incremental byte counter so chunked/no-header
        // responses are also capped before the full body buffers (finding #15).
        let arrayBuffer;
        {
          const reader = resp.body.getReader();
          const chunks = [];
          let totalBytes = 0;
          let aborted = false;
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              totalBytes += value.byteLength;
              if (totalBytes > MAX_BYTES) {
                aborted = true;
                reader.cancel().catch(() => {});
                break;
              }
              chunks.push(value);
            }
          } catch (e) {
            reader.cancel().catch(() => {});
            throw e;
          }
          if (aborted) { sendResponse({ error: 'image too large' }); return; }
          const combined = new Uint8Array(totalBytes);
          let off = 0;
          for (const chunk of chunks) { combined.set(chunk, off); off += chunk.byteLength; }
          arrayBuffer = combined.buffer;
        }
        // Convert to base64
        const bytes = new Uint8Array(arrayBuffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
        const base64 = btoa(binary);
        sendResponse({ bytes: base64 });
      } catch (e) {
        sendResponse({ error: e.message || String(e) });
      }
    })();
    return true;
  }

  // Demo control: the live-diagram pages flip demo mode on when opened.
  if (msg.type === 'aaSetDemoMode') {
    globalThis.AA_DEMO_MODE = !!msg.on;
    chrome.storage.local.set({ aaDemoMode: !!msg.on }, () => sendResponse({ ok: true }));
    return true;
  }

  // Demo reset: wipe the state that accumulates across rehearsals so the
  // suggestion + adaptive-learning beats start clean every time — pending
  // proposals, suppressions, the auto-created "… automations" profile, the
  // episodic log, and the trace ring buffer. Leaves the user's onboarding
  // profile and any hand-made profiles untouched.
  if (msg.type === 'aaResetDemo') {
    (async () => {
      try {
        await globalThis.Datastore.set('mine.proposals', []);
        await globalThis.Datastore.set('mine.suppressions', []);
        await globalThis.Datastore.patch('mine.episodicLog', (l) => ({ entries: [], cursor: (l && l.cursor) || 0 }));
        const { customProfiles } = await chrome.storage.local.get('customProfiles');
        const kept = (customProfiles || []).filter(p => !/ automations$/.test(p.name || ''));
        await chrome.storage.local.set({ customProfiles: kept });
        await chrome.storage.local.set({ aaDemoTrace: [] });
        try { await chrome.action.setBadgeText({ text: '' }); } catch (_) {}
        sendResponse({ ok: true, removedProfiles: (customProfiles || []).length - kept.length });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true;
  }

  if (msg.type === 'saveUserProfile') {
    chrome.storage.local.set({ userProfile: msg.profile }, () => {
      sendResponse({ success: true });
    });
    // Onboarding cold-start populates the personal profile/Librarian.
    aaDemoTrace('personal', 'user', 'onboarding');
    aaDemoTrace('personal', 'coldstart', 'support areas + free text');
    aaDemoTrace('personal', 'profiledb', 'profile saved');
    aaDemoTrace('personal', 'librarian', 'Librarian seeded');
    return true;
  }

  // --- AI Support: interpret natural language needs ---
  if (msg.type === 'interpretNeeds') {
    // Diagram 2's explicit flow: the Librarian builds the prompt from the
    // global tools registry (the "does this exist in the global db?" check
    // is grounded in AA_TOOLS, not a duplicated list) and conditions it on
    // the ability profile. Response shape is unchanged for the popup.
    (async () => {
      try {
        const apiKey = await getApiKey();
        if (!apiKey) { sendResponse({ error: 'No API key' }); return; }
        // Explicit branch: Librarian consults the global tools db.
        aaDemoTrace('skill', 'user', 'explicit request');
        aaDemoTrace('skill', 'explicit', 'describe access needs');
        aaDemoTrace('skill', 'globaldb_q', 'check global db');
        const prompt = await globalThis.Librarian.interpretNeedsPrompt(msg.text);
        const result = await callGemini(prompt, apiKey);
        sendResponse({ result });
      } catch (e) {
        sendResponse({ error: e.message });
      }
    })();
    return true;
  }

  // --- Custom Profile CRUD ---
  if (msg.type === 'saveCustomProfile') {
    chrome.storage.local.get('customProfiles', (data) => {
      const profiles = data.customProfiles || [];
      const existing = profiles.findIndex(p => p.id === msg.profile.id);
      if (existing >= 0) profiles[existing] = msg.profile;
      else profiles.push(msg.profile);
      chrome.storage.local.set({ customProfiles: profiles }, () => {
        sendResponse({ success: true });
      });
    });
    return true;
  }

  if (msg.type === 'getCustomProfiles') {
    chrome.storage.local.get('customProfiles', (data) => {
      sendResponse({ profiles: data.customProfiles || [] });
    });
    return true;
  }

  if (msg.type === 'deleteCustomProfile') {
    chrome.storage.local.get('customProfiles', (data) => {
      const profiles = (data.customProfiles || []).filter(p => p.id !== msg.id);
      chrome.storage.local.set({ customProfiles: profiles }, () => {
        sendResponse({ success: true });
      });
    });
    return true;
  }

  // --- Site Classification ---
  // Delegates to the Librarian's site index: hostMap/TLD first, then a
  // one-time Gemini classification cached per origin (no more re-classifying
  // the same host on every visit). User overrides are sticky.
  if (msg.type === 'classifySite') {
    (async () => {
      const hostname = msg.hostname || '';
      const title = msg.title || '';

      let siteType = null;
      try {
        siteType = await globalThis.Librarian.getSiteCategory(hostname, { allowLlm: true, title });
      } catch (e) {
        console.warn('[AgenticA11y] classify failed:', e.message);
      }

      if (!siteType) siteType = 'other';

      const { customProfiles } = await chrome.storage.local.get('customProfiles');
      const profiles = customProfiles || [];
      const matching = profiles.find(p => p.autoApply && p.siteTypes?.includes(siteType));

      sendResponse({ siteType, matchingProfile: matching || null });
    })();
    return true;
  }

  if (msg.type === 'openOnboarding') {
    chrome.tabs.create({ url: chrome.runtime.getURL('onboarding/onboarding.html') });
    sendResponse({ success: true });
    return true;
  }

  if (msg.type === 'openSkillBuilder') {
    let url = chrome.runtime.getURL('adapter-builder/builder.html');
    const params = new URLSearchParams();
    if (msg.pendingSkills) params.set('pending', JSON.stringify(msg.pendingSkills));
    // Carry the scope so a skill built from a scoped request ("...on news
    // sites") is gated to those sites, matching the settings.
    if (msg.scope && msg.scope !== 'general') params.set('scope', msg.scope);
    const qs = params.toString();
    if (qs) url += '?' + qs;
    chrome.tabs.create({ url });
    sendResponse({ success: true });
    return true;
  }

  if (msg.type === 'openSkillManager') {
    let url = chrome.runtime.getURL('skill-builder/skills.html');
    const params = new URLSearchParams();
    // Needs onboarding (or a popup suggestion) couldn't cover with a built-in
    // adapter. They come here first: most are a new combination of things
    // that already exist, which is a skill. The page hands the leftovers to
    // the Adapter Builder, which writes actual code.
    if (msg.pendingSkills) params.set('pending', JSON.stringify(msg.pendingSkills));
    if (msg.scope && msg.scope !== 'general') params.set('scope', msg.scope);
    const qs = params.toString();
    if (qs) url += '?' + qs;
    chrome.tabs.create({ url });
    sendResponse({ success: true });
    return true;
  }

  // --- Librarian (personal memory/profile agent) ---
  // Fast lane: deterministic queries + mechanical writes. The slow lane
  // (extract/reflect) runs on alarms; the *Now variants exist for debugging.
  if (msg.type && msg.type.startsWith('librarian')) {
    // Cross-app sharing (Phase 3): audience-ceiling enforcement + the audit
    // trail (toolkit/sync/grants.js) now live IN core/librarian.js itself
    // (requestGrant's accept path, revokeGrant, exportAbilityModel, the
    // cross-app-insight accept path) — every host gets them for free, not
    // just Chrome. The routes below are thin pass-throughs. `Grants` is kept
    // only for the read-only audit route below (no UI writes through it
    // anymore); optional-chained in case the bundle didn't wire it.
    const Grants = globalThis.Grants || null;
    const dsGetter = () => globalThis.Datastore;
    (async () => {
      try {
        // Remote toolkit server mode (server/CONTRACT.md): when configured,
        // every arm below runs against RemoteLibrarian.asLibrarian() instead
        // of the local Librarian — same 36 arms, same `L.<method>` calls,
        // switchable source. See remoteIfConfigured() above.
        const L = (await remoteIfConfigured()) || globalThis.Librarian;
        if (!L) { sendResponse({ error: 'librarian not loaded' }); return; }
        switch (msg.type) {
          case 'librarianGetProfile':
            sendResponse({ profile: await L.getProfile() }); break;
          case 'librarianGetAbilityModel':
            sendResponse({ model: await L.getAbilityModel() }); break;
          case 'librarianListProcedural':
            sendResponse({ procedural: await L.listProcedural(msg.category || null) }); break;
          case 'librarianSetProfileField':
            sendResponse({ profile: await L.setProfileField(msg.path, msg.value) }); break;
          case 'librarianRecordScopedSettings':
            sendResponse({ ids: await L.recordScopedSettings(msg.scope, msg.settings || {}, msg.opts || {}) }); break;
          case 'librarianGetSiteCategory':
            sendResponse({ category: await L.getSiteCategory(msg.origin, msg.opts || {}) }); break;
          case 'librarianSetSiteCategory':
            await L.setSiteCategoryOverride(msg.origin, msg.category);
            sendResponse({ success: true }); break;
          case 'librarianEffectivePreferences': {
            // Route the merged preferences through the web SurfaceAdapter so an
            // unrenderable (e.g. cross-app) need is reported, not silently
            // dropped — and so the derived ability baseline composes under the
            // result. Fail open to the raw merge if the surface bundle or the
            // settings registry isn't loaded (behaviour-identical fallback).
            const settingsMeta = globalThis.AA_TOOLS && globalThis.AA_TOOLS.settingsMeta;
            if (globalThis.WebSurface && settingsMeta) {
              sendResponse(await globalThis.WebSurface.resolveWebPreferences({
                librarian: L, settingsMeta, url: msg.url, contexts: msg.contexts || [],
              }));
            } else {
              sendResponse(await L.getEffectivePreferences(msg.url, msg.contexts || []));
            }
            break;
          }
          case 'librarianRecall':
            sendResponse(await L.recall(msg.url, msg.task || '', msg.contexts || [])); break;
          case 'librarianListMemories':
            sendResponse(await L.listMemories(msg.filter || {})); break;
          case 'librarianListProposals':
            sendResponse({ proposals: await L.listProposals(msg.status ?? 'pending') }); break;
          case 'librarianLogObservation':
            sendResponse(await L.logObservation(msg.observation || {})); break;
          case 'librarianRespondToProposal':
            // Cross-app grants/insights only become real HERE, on accept —
            // and the 'grant-created' / 'insight-import' audit entries are
            // now recorded by respondToProposal itself (core/librarian.js),
            // at the moment each actually takes effect.
            sendResponse(await L.respondToProposal(msg.id, msg.response)); break;
          case 'librarianDeleteMemory':
            sendResponse({ success: await L.deleteMemory(msg.id) }); break;
          case 'librarianSetPause':
            if (msg.origin) await L.setOriginPaused(msg.origin, msg.paused);
            else await L.setMemoryPaused(msg.paused);
            sendResponse({ success: true }); break;
          case 'librarianExtractNow':
            sendResponse(await L.extract()); break;
          case 'librarianReflectNow':
            sendResponse(await L.reflect()); break;
          // --- Cross-app sharing (Phase 3): grants, insights, off switch,
          //     acting user. Resolution of grant/insight proposals stays on
          //     librarianRespondToProposal — the LOCAL user surface — so a
          //     consuming app can never approve its own request.
          case 'librarianListGrants':
            sendResponse({ grants: await L.listGrants() }); break;
          case 'librarianRevokeGrant':
            // revokeGrant() audits ('grant-revoked') itself, before the delete.
            sendResponse(await L.revokeGrant(msg.appId)); break;
          case 'librarianSetSharingPaused':
            await L.setSharingPaused(msg.paused);
            sendResponse({ success: true }); break;
          case 'librarianRequestGrant':
            sendResponse(await L.requestGrant(msg.appId, msg.scopes || [], msg.opts || {})); break;
          case 'librarianImportInsight':
            sendResponse(await L.importInsight(msg.appId, msg.insight || {})); break;
          case 'librarianExportAbilityModel':
            // Audience ceiling + the 'export' / 'export-blocked' audit are
            // enforced/recorded inside exportAbilityModel itself now (core/
            // librarian.js) — portable to every host, not just this route.
            sendResponse(await L.exportAbilityModel(msg.appId)); break;
          case 'librarianShareAudit':
            // No UI reads this yet (the Phase 3 grant panel shows live grants
            // only — see popup.js's librarianListGrants). Wired for when one
            // does; graceful-empty rather than throwing if the Grants bridge
            // somehow isn't loaded. Local mode has no L.getShareAudit (the
            // audit trail lives in the Grants bridge, not on Librarian
            // itself) so it falls through to Grants; remote mode's facade
            // DOES expose getShareAudit (CONTRACT.md: shareAudit route), so
            // it answers first and Grants is never consulted.
            sendResponse({ audit: (await L.getShareAudit?.(dsGetter)) || (await Grants?.getShareAudit?.(dsGetter)) || [] }); break;
          case 'librarianGetActingUser':
            sendResponse({ actingUser: await L.getActingUser() }); break;
          case 'librarianSetActingUser':
            sendResponse(await L.setActingUser(msg.id ?? null, msg.opts || {})); break;
          case 'librarianExportProfileBlob':
            sendResponse({ blob: await L.exportProfileBlob() }); break;
          case 'librarianImportProfileBlob':
            sendResponse(await L.importProfileBlob(msg.blob)); break;
          case 'librarianImportInsightOutbox':
            sendResponse(await L.importInsightOutbox(msg.outbox)); break;
          // -- Skill layer (Engineer + Skills db) --
          case 'librarianListSkills':
            sendResponse({ skills: await L.listSkills() }); break;
          case 'librarianRetrieveSkill':
            sendResponse({ skill: await L.retrieveSkill(msg.url, msg.contexts || []) }); break;
          case 'librarianFindSkill':
            sendResponse({ skill: await L.findSkillForNeed(msg.need) }); break;
          case 'librarianBuildSkill':
            sendResponse(await L.buildSkill(msg.need, { previous: msg.previous || null, feedback: msg.feedback || '' })); break;
          case 'librarianResolveSkill':
            sendResponse({ plan: await L.resolveSkill(msg.skill) }); break;
          case 'librarianSaveSkill':
            sendResponse(await L.saveSkill(msg.skill)); break;
          case 'librarianDeleteSkill':
            sendResponse({ deleted: await L.deleteSkill(msg.name) }); break;
          default:
            sendResponse({ error: `unknown librarian message: ${msg.type}` });
        }
      } catch (e) {
        sendResponse({ error: e.message });
      }
    })();
    return true;
  }

  if (msg.type === 'saveActionToProfile') {
    chrome.storage.local.get('customProfiles', (data) => {
      const profiles = data.customProfiles || [];
      const profile = profiles.find(p => p.id === msg.profileId);
      if (!profile) { sendResponse({ error: 'Profile not found' }); return; }
      if (!profile.actions) profile.actions = [];
      profile.actions.push(msg.action);
      chrome.storage.local.set({ customProfiles: profiles }, () => {
        sendResponse({ success: true });
      });
      // Saving a reusable action is strong, deliberate signal.
      globalThis.Librarian?.logObservation({
        type: 'saved-action',
        text: `User saved reusable agent action "${msg.action?.name}" (prompt: ${msg.action?.prompt}) to profile "${profile.name}" for site types: ${(profile.siteTypes || []).join(', ')}`,
        data: { profileId: profile.id, siteTypes: profile.siteTypes },
      }).catch(() => {});
    });
    return true;
  }

  if (msg.type === 'removeActionFromProfile') {
    chrome.storage.local.get('customProfiles', (data) => {
      const profiles = data.customProfiles || [];
      const profile = profiles.find(p => p.id === msg.profileId);
      if (!profile) { sendResponse({ error: 'Profile not found' }); return; }
      profile.actions = (profile.actions || []).filter(a => a.id !== msg.actionId);
      chrome.storage.local.set({ customProfiles: profiles }, () => {
        sendResponse({ success: true });
      });
    });
    return true;
  }

  // Apply-path for skills whose recipe carries agent actions (reusable tasks
  // saved as skills): the Skill Builder page resolved the skill and asks the
  // browser agent to run the task on the tab the person chose. The Apply
  // click on the page is the consent.
  if (msg.type === 'runSkillActions') {
    (async () => {
      const actions = msg.actions || [];
      if (!actions.length || !globalThis.BrowserAgent) {
        sendResponse({ skipped: true });
        return;
      }
      if (globalThis.BrowserAgent.isRunning()) {
        sendResponse({ skipped: true, reason: 'agent_busy' });
        return;
      }
      sendResponse({ started: true, count: actions.length });
      for (const action of actions) {
        if (globalThis.BrowserAgent.isRunning()) break;
        try {
          console.log(`[AgenticA11y] Running skill action: ${action.name || action.prompt}`);
          await globalThis.BrowserAgent.run(action.prompt, { tabId: msg.tabId ?? null });
        } catch (e) {
          console.warn(`[AgenticA11y] Skill action failed: ${e.message}`);
        }
      }
    })();
    return true;
  }

  if (msg.type === 'runProfileActions') {
    (async () => {
      const actions = msg.actions || [];
      // Profile actions trigger from the content script of the page that
      // just matched the profile's site type, so the action belongs on
      // that tab -- not a fresh about:blank one.
      const senderTabId = sender?.tab?.id ?? null;
      if (!actions.length || !globalThis.BrowserAgent) {
        sendResponse({ skipped: true });
        return;
      }
      if (globalThis.BrowserAgent.isRunning()) {
        console.log('[AgenticA11y] Skipping profile actions — agent already running');
        sendResponse({ skipped: true, reason: 'agent_busy' });
        return;
      }
      sendResponse({ started: true, count: actions.length });
      for (const action of actions) {
        if (globalThis.BrowserAgent.isRunning()) break;
        try {
          console.log(`[AgenticA11y] Running profile action: ${action.name || action.prompt}`);
          await globalThis.BrowserAgent.run(action.prompt, { tabId: senderTabId });
        } catch (e) {
          console.warn(`[AgenticA11y] Profile action failed: ${e.message}`);
        }
      }
    })();
    return true;
  }
});
