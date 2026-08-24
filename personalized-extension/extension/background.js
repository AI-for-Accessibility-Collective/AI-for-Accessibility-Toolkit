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

// The task model, loaded the same way and for the same reason.
//
// Present, the validation layer reads each page with the reasoner against this
// model's questions instead of with the Amazon URL regexes and extractors.
// Absent, nothing changes: the shipped Amazon path runs exactly as before. So
// this file is the switch between the two, and no file is a supported state.
fetch(chrome.runtime.getURL('validation/taskmodel.json'))
  .then((r) => (r.ok ? r.json() : null))
  .then((m) => {
    if (!m) return;
    const n = globalThis.ValidationTaskModel?.load(m, 'validation/taskmodel.json');
    console.log('[AI4A11y] task model loaded:', n);
  })
  .catch(() => {});

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
// The module set dies with the worker; storage.session survives it within
// the browser session. On worker start, sweep tabs a dead worker left open -
// they are background amazon tabs the person never asked for.
chrome.storage.session?.get('probeTabIds').then(async (r) => {
  for (const id of r.probeTabIds || []) {
    probeTabs.add(id);
    try { await chrome.tabs.remove(id); } catch { /* already gone */ }
    probeTabs.delete(id);
  }
  chrome.storage.session?.set({ probeTabIds: [] });
}).catch(() => {});
const persistProbeTabs = () =>
  chrome.storage.session?.set({ probeTabIds: [...probeTabs] }).catch(() => {});

// A handed-over tab that closes ends the hand over.
//
// Without this the 4-second poll kept firing on a tab that no longer exists,
// axSnapshot threw every time, and `holder` stayed 'person' — so the agent
// remained gated with no give-up clock, because the hold timeout is
// deliberately disabled while the person has the wheel. The person had closed
// the page and nothing anywhere noticed.
chrome.tabs?.onRemoved?.addListener(async (tabId) => {
  try {
    const st = globalThis.Validation?.status?.();
    if (st?.holder === 'person' && st.tabId === tabId) {
      await globalThis.Validation?.handBack?.({ tabId });
    }
  } catch { /* nothing to hand back to */ }
});

chrome.webNavigation?.onCompleted?.addListener(async (d) => {
  if (d.frameId !== 0) return;                       // top frame only
  if (probeTabs.has(d.tabId)) return;                // a measurement, not the task
  // ensureRunning, not isRunning: after a worker restart the sync check is
  // false forever and observation silently stops - the person keeps
  // browsing a task the panel still shows, and no page gets checked.
  //
  // A live watch is the other reason to read a settle. A watched value outlives
  // the run that set it — the flights case is keeping the fare watch on after
  // booking — so "no task is running" stopped being the whole answer to whether
  // this page is worth looking at. Both checks are one storage read.
  const running = await globalThis.Validation?.ensureRunning?.();
  if (!running && !(await globalThis.ValidationWatch?.any?.())) return;
  // Let the page settle. Amazon renders prices and stock after first paint,
  // and reading too early reports absences that are really just lateness.
  setTimeout(() => {
    globalThis.Validation.observe(d.tabId).catch((e) =>
      console.warn('[validation] observe failed:', e.message));
  }, 1200);
});

// Voice-mode data routes (offscreen tool calls that need chrome.tabs /
// chrome.scripting / Librarian). Own onMessage listener, voice* data types
// only. Loaded after lib/ so the toolkit globals it reads exist.
self.importScripts('voice-routes.js');

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
// responseSchema + maxOutputTokens: structured output, which the validation
// reasoner needs. Its benchmark lost 3 of 40 calls to JSON cut off mid-response
// against no declared cap, so the cap and the schema travel together.
async function callGemini(prompt, apiKey, optsOrImages) {
  const opts = Array.isArray(optsOrImages)
    ? { images: optsOrImages }
    : (optsOrImages || {});
  const { images, mimeType, model, audioParts, responseSchema, maxOutputTokens,
          timeoutMs } = opts;

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
  if (responseSchema) generationConfig.responseSchema = responseSchema;
  if (maxOutputTokens) generationConfig.maxOutputTokens = maxOutputTokens;

  // 30 seconds was chosen for the agent's own calls: a screenshot and an
  // element list in, one short action out. The reasoner's call is a different
  // shape — every question in the task model, structured output — and it
  // inherited this timeout by sharing the function. On a live Wikipedia
  // article, 40,000 characters after the size guard and 59 questions, the call
  // takes about 35 seconds. A legitimate slow call is indistinguishable from a
  // hung one, so all three retries aborted and the page was never checked at
  // all — and large, question-dense pages are exactly the ones with the most
  // on them to check.
  //
  // Callers that know their call is long pass timeoutMs. Nothing else moves.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs || 30_000);
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

/**
 * The streaming form of callGemini: same request, but against the
 * streamGenerateContent endpoint, handing each text piece to `onText` as it
 * arrives and resolving with the complete text. Text calls only - the
 * reasoner is its one consumer and sends no images or audio.
 */
async function callGeminiStream(prompt, apiKey, opts, onText) {
  const { mimeType, model, responseSchema, maxOutputTokens, timeoutMs } = opts || {};
  const generationConfig = { temperature: opts?.temperature ?? 0.7 };
  if (mimeType) generationConfig.responseMimeType = mimeType;
  if (responseSchema) generationConfig.responseSchema = responseSchema;
  if (maxOutputTokens) generationConfig.maxOutputTokens = maxOutputTokens;

  const url = 'https://generativelanguage.googleapis.com/v1beta/models/'
    + `${model || GEMINI_MODEL}:streamGenerateContent?alt=sse&key=${apiKey}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs || 30000);
  let full = '';
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig }),
      signal: controller.signal,
    });
    if (!resp.ok || !resp.body) {
      throw new Error(`Gemini stream error ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
    }
    // SSE: `data: {json}` lines separated by blank lines. A chunk boundary can
    // fall anywhere, so lines are only consumed once their newline arrives.
    const reader = resp.body.getReader();
    const dec = new TextDecoder();
    let carry = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      carry += dec.decode(value, { stream: true });
      let nl;
      while ((nl = carry.indexOf('\n')) >= 0) {
        const line = carry.slice(0, nl).trim();
        carry = carry.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          const piece = JSON.parse(payload).candidates?.[0]?.content?.parts?.[0]?.text;
          if (piece) {
            full += piece;
            if (onText) await onText(piece);
          }
        } catch { /* a malformed keep-alive line is not a failure */ }
      }
    }
  } finally {
    clearTimeout(timeoutId);
  }
  if (!full) throw new Error('Gemini stream returned no text');
  return full;
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

// The validation reasoner uses the same one. Not a second provider and not a
// second key store: the layer that checks the agent runs on the same key the
// agent does, so there is nothing extra to configure before checking works.
if (globalThis.ValidationReasoner) {
  globalThis.ValidationReasoner.setGeminiCaller(async (prompt, opts) => {
    const key = await getApiKey();
    if (!key) throw new Error('No Gemini API key configured.');
    return await callGemini(prompt, key, opts);
  });
  // And the streaming form, so a stop-class answer written early in the reply
  // reaches the gate while the rest is still being generated. The reasoner
  // falls back to the plain call if a stream breaks, so this only adds speed.
  globalThis.ValidationReasoner.setGeminiStreamCaller(async (prompt, opts, onText) => {
    const key = await getApiKey();
    if (!key) throw new Error('No Gemini API key configured.');
    return await callGeminiStream(prompt, key, opts, onText);
  });
}

// Writing the task model uses the same key, for the same reason. It needs a
// longer ceiling than a page read: the prompt carries every worked example, so
// the first call is dominated by reading them rather than by answering.
if (globalThis.ValidationGenerate) {
  globalThis.ValidationGenerate.setCaller(async (prompt, opts) => {
    const key = await getApiKey();
    if (!key) throw new Error('No Gemini API key configured.');
    return await callGemini(prompt, key, { ...opts, timeoutMs: 180_000 });
  });
}

/**
 * A run that the service worker took down with it, said out loud.
 *
 * The agent loop lives in module state, so a worker teardown ends it. The
 * stored record does not know that: it still says `running`, or worse `paused`,
 * and both surfaces go on showing an agent that no longer exists. A paused run
 * is the bad case, because pausing is something the person did deliberately and
 * they are waiting for it to go again.
 *
 * This runs once per worker start, when no loop can be running yet, so anything
 * stored as live is stale by construction.
 */
(async () => {
  try {
    const st = (await chrome.storage.local.get('bhAgent')).bhAgent;
    if (!st || (st.status !== 'running' && st.status !== 'paused')) return;
    if (globalThis.BrowserAgent?.isRunning?.()) return;
    const why = st.status === 'paused'
      ? 'The browser put this to sleep while it was paused, so it never started again. '
        + 'Nothing was left half-done — it stopped where you paused it.'
      : 'The browser put this to sleep before it finished, so it stopped part way. '
        + 'What it had already done is in the log.';
    await chrome.storage.local.set({
      bhAgent: { ...st,
        status: 'stopped',
        endedAt: Date.now(),
        summary: why,
        log: [...(st.log || []), { kind: 'info', t: Date.now(), text: why }] },
    });
  } catch { /* a missing record is not a stalled run */ }
})();

// One generation at a time. A second run supersedes the first rather than
// racing it to load a model for a task nobody is doing any more.
let modelRun = null;
// How long the agent waits before it starts, for a model with something in it
// to ask.
//
// It used to wait only for the tree. The tree says which phase a page belongs
// to and carries no questions, so a run that finished before the first batch of
// questions arrived was checked against nothing: a recorded Wikipedia lookup
// was answered and done in nineteen seconds, and every page read that run
// reported asking zero questions. Waiting for the tree alone bought the layer
// nothing on exactly the runs it could most easily have kept up with.
//
// So the wait is for questions, and the ceiling is raised to cover them. This
// is the deliberate trade: about a minute and a half before the agent moves, in
// exchange for a layer that is actually checking when it does. A stalled
// generation still cannot become an agent that never starts.
const MODEL_FIRST_PIECE_MS = 150_000;

/**
 * Write the task model for what the person just asked, and use it when it lands.
 *
 * The shipped `taskmodel.json` is dropped first. It was built for whatever task
 * happened to be current when the extension was packaged, and checking one
 * task's pages against another task's questions does not degrade gracefully —
 * it produces confident, correct-sounding contradictions ("the agent is
 * researching the Boeing 737 MAX", on a run about the Eiffel Tower) and holds
 * the agent on them. No model at all is quiet, and quiet is the honest state
 * while there is nothing trustworthy to check against.
 */
function startModelFor(task) {
  const G = globalThis.ValidationGenerate;
  if (!G?.hasCaller?.() || !task) return Promise.resolve();
  if (modelRun) modelRun.aborted = true;
  const mine = { aborted: false };
  modelRun = mine;

  try { globalThis.ValidationTaskModel?.unload?.(); } catch { /* nothing loaded */ }

  // The retrieval tier first. A task the pipeline has a built HTA for loads in
  // milliseconds instead of generating for a minute, and the built model is
  // the stronger one — the generator's own coverage tops out well under the
  // gold it would be imitating. The match is conservative by design; anything
  // uncertain falls through to generation, which cannot be wrong about whose
  // task it is. The source is the extension path, so a worker restart
  // refetches the same file.
  const retrieved = G.retrieveModel?.(task)?.then?.((hit) => {
    if (!hit || mine.aborted) return false;
    globalThis.ValidationTaskModel?.load(hit.model, hit.source);
    chrome.storage.local.set({
      'aa.validation.gen': { stage: 'retrieved', domain: hit.domain, at: Date.now() },
    }).catch(() => {});
    console.log('[validation] built model retrieved:', hit.domain);
    globalThis.Validation?.planReview?.().catch(() => {});

    // Fit the bank to THIS request, without making the agent wait for it. The
    // raw model checks pages meanwhile; the adapted one replaces it when the
    // patch lands, a few seconds later. Stored like a generated model, because
    // a worker restart refetching the FILE would silently lose the patch.
    G.adaptModel?.(hit.model, task).then(async (a) => {
      if (mine.aborted || !a || (!a.rewritten && !a.added)) return;
      globalThis.ValidationTaskModel?.load(a.model, 'generated');
      await chrome.storage.local.set({ 'aa.validation.model': a.model });
      chrome.storage.local.set({
        'aa.validation.gen': { stage: 'adapted', domain: hit.domain,
          rewrites: a.rewritten, additions: a.added, at: Date.now() },
      }).catch(() => {});
      console.log(`[validation] model adapted to the request: `
        + `${a.rewritten} rewritten, ${a.added} added`);
      // Findings raised from the OLD wording of a rewritten question are
      // about a question nobody is asking any more - retire them so they
      // stop asking and stop holding.
      if (Array.isArray(a.rewrites) && a.rewrites.length) {
        globalThis.Validation?.retireQuestions?.(a.rewrites.map((r) => r.from))
          .catch(() => {});
      }
      // The plan review has already been spoken by now - it fires at
      // retrieval, and this patch lands half a minute later. What the
      // request added is worth one line of its own, or "from your request I
      // added" is never heard on the retrieval path at all.
      globalThis.Validation?.planAddendum?.(a).catch(() => {});
    }).catch(() => { /* the raw bank keeps working */ });
    return true;
  }).catch(() => false) || Promise.resolve(false);

  // Resolves on the first piece, so the caller can hold the agent for it. The
  // ceiling matters more than the wait: a generation that stalls must not
  // become an agent that never starts.
  let firstPiece;
  const ready = new Promise((r) => { firstPiece = r; });
  const ceiling = setTimeout(() => firstPiece('timed out'), MODEL_FIRST_PIECE_MS);
  const arrived = (why) => { clearTimeout(ceiling); firstPiece(why); };

  // Each piece is used as it is written. Waiting for the whole model loses
  // short runs entirely: a recorded Wikipedia lookup was over in ninety
  // seconds, well before a complete model could exist, and a model that
  // arrives after the agent has stopped has checked nothing.
  // How many questions the layer has had so far, so a batch that adds some can
  // be told from one that adds none.
  let had = 0;
  const countQuestions = (m) => {
    let n = 0;
    const walk = (x) => {
      n += (x.questions || []).length;
      for (const c of x.children || []) walk(c);
    };
    if (m?.tree) walk(m.tree);
    return n;
  };

  const use = async (model, st = {}) => {
    if (mine.aborted) return;
    try {
      globalThis.ValidationTaskModel?.load(model, 'generated');
      // Kept so a service-worker restart mid-run reloads it instead of falling
      // back to checking nothing. It has no URL to refetch.
      await chrome.storage.local.set({ 'aa.validation.model': model });

      // Read the page again now that there is something to ask it.
      //
      // Page reads are driven by the agent settling on a page, and the agent
      // gets through its pages faster than the questions arrive: in a recorded
      // Wikipedia run all three reads happened inside the first 75 seconds and
      // every one of them asked zero questions, because only the tree had
      // landed. The layer was reading pages it had nothing to ask about, and
      // the few findings that appeared came from the open noticing pass rather
      // than from the model. Re-reading when questions arrive is what makes
      // delivering the model in pieces worth anything.
      const now = countQuestions(model);
      const first = had === 0 && now > 0;
      const complete = st.stage === 'done';
      // The review spoke at the first batch; if the finished plan is much
      // bigger, one line corrects the count.
      if (complete) globalThis.Validation?.planUpdate?.().catch(() => {});
      if (now > had) {
        // Only now is there anything to ask a page. The tree on its own is not
        // a reason to let the agent go.
        arrived('ready');
        if (had === 0) globalThis.Validation?.planReview?.().catch(() => {});
        had = now;
      }
      // Re-read at most twice: when there are first questions to ask, and once
      // the model is finished. Re-reading on every batch costs a call each time
      // and asks the same question again - one recorded run answered "does the
      // address bar show wikipedia.org" six times, reworded, on the same page.
      if (first || complete) {
        // Normal windows only. `lastFocusedWindow` is the panel whenever the
        // panel is open, and its URL is a chrome-extension:// one, so the
        // re-read was skipped every single time on the surface that needs it
        // most.
        const wins = await chrome.windows.getAll({ windowTypes: ['normal'], populate: true });
        const tabs = [];
        for (const w of wins || []) for (const t of w.tabs || []) tabs.push(t);
        const real = tabs.filter((t) => /^https?:/.test(t.url || ''));
        const tab = real.find((t) => t.active) || real[0];
        if (tab?.id) {
          globalThis.Validation?.observe?.(tab.id)
            .catch((e) => console.warn('[validation] re-read failed:', e.message));
        }
      }
    } catch (e) {
      console.warn('[validation] could not use the model:', e.message);
    }
  };

  retrieved.then((got) => {
    if (mine.aborted) return;
    if (got) {
      // The whole model is already loaded, so the agent has nothing to wait
      // for and the current page is worth reading right away.
      arrived('retrieved');
      chrome.windows.getAll({ windowTypes: ['normal'], populate: true }).then((wins) => {
        const tabs = [];
        for (const w of wins || []) for (const t of w.tabs || []) tabs.push(t);
        const real = tabs.filter((t) => /^https?:/.test(t.url || ''));
        const tab = real.find((t) => t.active) || real[0];
        if (tab?.id) {
          globalThis.Validation?.observe?.(tab.id)
            .catch((e) => console.warn('[validation] re-read failed:', e.message));
        }
      }).catch(() => {});
      return;
    }

    G.generate(task, {
      signal: mine,
      onPartial: (m, st) => use(m, st),
      // Published, not just logged. A generation that fails inside the service
      // worker is otherwise invisible to everything outside it — including the
      // panel, which has to tell the person why nothing is being checked yet.
      onStage: (st) => {
        console.log('[validation] model', JSON.stringify(st));
        chrome.storage.local.set({ 'aa.validation.gen': { ...st, at: Date.now() } })
          .catch(() => {});
      },
    }).then(async (model) => {
      if (mine.aborted || !model) return;
      await use(model, { stage: 'done' });
      console.log('[validation] model complete for:', task);
    }).catch((e) => {
      console.warn('[validation] no model written:', e.message);
      chrome.storage.local.set({
        'aa.validation.gen': { stage: 'failed', error: e.message, at: Date.now() },
      }).catch(() => {});
      arrived('failed');   // never leave the agent waiting on a generation that died
    });
  });

  return ready;
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
//
// Generalised off Amazon by reading both hardcoded halves rather than assuming
// them. `${origin}/s?k=` became: find the parameter of the URL we are already
// on whose value carries the words the person searched for, and rewrite that
// one. `/([\d,]+) results/i` became: that pattern first because it is free,
// then one reasoner call scoped to the count when it misses. See probe.js —
// neither half guesses, and a site where the search is not in the URL is
// reported as such instead of opening a page that does not exist.
async function probeNarrower(tabUrl) {
  const P = globalThis.ValidationProbe;
  const st = (await chrome.storage.local.get('aa.validation'))['aa.validation'] || {};
  const c = st.contract || {};
  const ask = globalThis.ValidationAsk?.toQuery?.(c) || String(c.item || '');
  if (!P) return { options: [], why: 'the probe is not loaded' };
  if (!ask) {
    return { options: [],
      why: 'you have not told me what you are looking for, so I have nothing to '
         + 'narrow the search with.' };
  }

  // How a search is written on this site, read off the address bar. No match
  // means the search is not in the URL here — a POST, an app that keeps it in
  // state — and there is nothing to rewrite.
  const param = P.searchParamOf(tabUrl, ask);
  if (!param) return { options: [], why: P.NO_SEARCH_GRAMMAR };

  const candidates = P.narrowerQueries(param.value, c);
  if (!candidates.length) {
    return { options: [],
      why: 'everything you told me is already in the search, so there is nothing '
         + 'left of the ask to narrow it with.' };
  }

  const askPage = globalThis.ValidationReasoner?.hasCaller?.()
    ? (q, text) => globalThis.ValidationReasoner.askPage(q, text)
    : null;

  const options = [];
  for (const q of candidates) {
    const url = P.narrowerUrl(tabUrl, param.key, q);
    let tab = null;
    try {
      tab = await chrome.tabs.create({ url, active: false });
      probeTabs.add(tab.id);
      persistProbeTabs();
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
      const measured = await P.countOn(snap.text, askPage);
      options.push({ query: q, url, ...measured });
    } catch (e) {
      options.push({ query: q, url, count: null,
                     from: `I could not open it: ${String(e.message || e).slice(0, 60)}` });
    } finally {
      if (tab) {
        probeTabs.delete(tab.id);
        persistProbeTabs();
        chrome.tabs.remove(tab.id).catch?.(() => {});
      }
    }
  }
  return { options, why: null, param: param.key };
}

// Probe, don't guess. The card goes up immediately so the press is seen to
// have done something; the real counts replace it when read. Falls back to
// asking the agent when there was nothing to measure — and now says WHY there
// was nothing, because "I could not tell how a search is written on this site"
// and "I measured nothing" look identical from the outside and are not the same
// thing at all.
let refineProbeRunning = false;
async function runRefineProbe(fallbackSay) {
  // One at a time. Two presses opened two probes, up to six background tabs
  // each held about sixteen seconds, on a control a person can double-press
  // precisely because the first press has no immediate effect.
  if (refineProbeRunning) return 0;
  refineProbeRunning = true;
  try { return await _runRefineProbe(fallbackSay); }
  finally { refineProbeRunning = false; }
}

async function _runRefineProbe(fallbackSay) {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  await globalThis.Validation?.annotate?.({
    probe: { ask: 'Trying narrower searches…', options: [] } });
  const r = await probeNarrower(tabs[0]?.url || '') || { options: [], why: null };
  const options = r.options || [];
  if (options.length) {
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
    await globalThis.Validation?.annotate?.({
      probe: r.why ? { ask: r.why, options: [] } : null });
    if (r.why) {
      chrome.runtime.sendMessage({
        type: 'validationSpeak', phase: 'probe',
        lines: [{ say: r.why, level: 'aside', live: 'polite', widget: 'probe' }],
      }).catch(() => {});
    }
    if (fallbackSay) await steerAgent(fallbackSay);
  }
  return options.length;
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
    let modelReady = Promise.resolve();
    // The demo arms itself off the task sentence (David 2026-08-23: no
    // switch to remember on stage). A non-matching task changes nothing.
    let demoArm = false;
    try {
      demoArm = !!globalThis.DemoDirector?.wouldArm?.(msg.task);
      globalThis.DemoDirector?.maybeArm?.(msg.task);
    } catch { /* demo only */ }
    // A demo take starts from a CLEAN session. The validation run outlives
    // the agent, so a session left over from an earlier take feeds its old
    // findings and holds straight into the new run's gate - one leftover
    // demo hold refused the new agent's first navigate before any page had
    // loaded, and a stale panel showed last week's findings.
    if (globalThis.Validation && (demoArm || !globalThis.Validation.isRunning())) {
      try {
        const contract = msg.contract || globalThis.ValidationAsk.contractFromAsk(msg.task);
        const begin = () => {
          try { globalThis.Validation.start(contract, { style: msg.style || 'balanced' }); }
          catch (e) { console.warn('validation did not start:', e); }
        };
        if (demoArm) {
          // A model left over from an earlier run re-arms the reasoner and
          // the off-plan hard gate on a take that generated no model - a
          // recorded demo wedged at Reserve on exactly that stale model.
          const wipe = () => chrome.storage.local
            .remove(['aa.validation.model', 'aa.validation.gen']).catch(() => {});
          if (globalThis.Validation.isRunning()) {
            globalThis.Validation.stop().then(wipe, wipe).then(begin, begin);
          } else {
            wipe().then(begin, begin);
          }
        } else {
          begin();
        }
        // No task model on a demo take: the reasoner's stops are the wrong
        // voice for the story, and its per-page LLM passes were the bulk of
        // the run's latency (every stop briefly gated even a date click).
        // The gate machinery still runs; the director's beats hold it.
        if (!demoArm) modelReady = startModelFor(msg.task);
      } catch (e) {
        console.warn('validation did not start:', e);   // never block the agent
      }
    }
    (async () => {
      try {
        const book = (await chrome.storage.sync.get('aa.rulebook'))['aa.rulebook'] || [];
        const active = book.filter((r) => r.on !== false).map((r) => r.text);
        if (active.length) {
          globalThis.BrowserAgent.interject?.(
            `Standing rules from the person, always in force: ${active.join('; ')}.`);
        }
        if (demoArm) {
          const sc = globalThis.DemoDirector?.SCENARIO;
          if (sc?.playbook) {
            globalThis.BrowserAgent.interject?.(
              sc.playbook.replace('{searchUrl}', sc.searchUrl || ''));
          }
        }
      } catch { /* rules are also enforced at the gate */ }
    })();
    // Hold the agent until there is something to check it against.
    //
    // Only for the tree, which is one small call, and under a ceiling. Without
    // this the layer loses short runs outright: a recorded Wikipedia lookup was
    // answered and done in thirty-three seconds, and every check arrived after
    // the run had ended. Delegating and being able to check what was delegated
    // are one action; a check that lands afterwards is not a check.
    (async () => {
      try { await modelReady; } catch { /* no model is a supported state */ }
      globalThis.BrowserAgent.run(msg.task, {
        tabId: msg.tabId,
        tabMode: msg.tabMode,
        maxSteps: msg.maxSteps,
      }).catch((e) => {
        // Agent already wrote the error to storage; nothing more to do here.
        console.warn('[BrowserAgent] run failed:', e.message);
      });
    })();
    sendResponse({ started: true });
    return false;
  }

  // ---- the demo director ------------------------------------------------
  if (msg.type === 'demoFacts') {
    (globalThis.DemoDirector?.onFacts?.(msg.facts, sender?.tab?.id) || Promise.resolve({}))
      .then(sendResponse).catch((e) => sendResponse({ error: e.message }));
    return true;
  }
  if (msg.type === 'demoAnswer') {
    (globalThis.DemoDirector?.onAnswer?.(msg.id, msg.response) || Promise.resolve({}))
      .then(sendResponse).catch((e) => sendResponse({ error: e.message }));
    return true;
  }
  if (msg.type === 'demoForce') {
    (globalThis.DemoDirector?.force?.() || Promise.resolve({}))
      .then(sendResponse).catch((e) => sendResponse({ error: e.message }));
    return true;
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
  if (msg.type === 'validationAsk') {
    // Asking is not steering. This route deliberately does not go anywhere
    // near steerAgent() — every other press in this file sends the agent an
    // instruction, and that is exactly why the person cannot currently ask a
    // question without changing what the agent does next.
    globalThis.Validation.ask(msg.question, { tabId: msg.tabId })
      .then(sendResponse).catch((e) => sendResponse({ error: e.message }));
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
        // Answering a hold that is no longer waiting must not steer the
        // agent - the panel and the overlay both render answer rows off the
        // same state, and the second press (possibly a DIFFERENT choice)
        // would inject a second instruction.
        const st0 = (await chrome.storage.local.get('aa.validation'))['aa.validation'] || {};
        const stillWaiting = (st0.gate && st0.gate.allowed === false
          && (st0.gate.waitingOn || []).includes(msg.widget));
        if (!stillWaiting) { sendResponse({ resolved: false, stale: true }); return; }
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

    // The four actions that are NOT a sentence sent to the agent. Each one is a
    // mechanism the layer runs itself, and each replaced a sentence that asked
    // the agent to do something the agent cannot do.
    if (c.action === 'hand-over') {
      // This used to say "Stop and let me do this part myself" and hope, which
      // left the agent free to keep acting while the person did — two things on
      // one page. It now holds the agent and starts the layer watching.
      globalThis.Validation.handOver({ nodeId: c.node, reason: c.reason })
        .then(sendResponse).catch((e) => sendResponse({ error: e.message }));
      return true;
    }
    if (c.action === 'hand-back') {
      globalThis.Validation.handBack({ nodeId: c.node })
        .then(sendResponse).catch((e) => sendResponse({ error: e.message }));
      return true;
    }
    if (c.action === 'watch-value') {
      // The same correction hand over got, for the same reason. With no entry
      // in the map below the label became the instruction — "Watch it for me.
      // Then tell me what changed." — which is one re-read of the page already
      // in front of the person, and a watch is the opposite of that. It now
      // registers a watched value that re-reads on later settles and outlives
      // the run.
      // The tab the press came from, not the active one. The overlay is drawn
      // on the page the agent is working, and the agent usually works in a
      // background tab, so "the active tab" is wherever the person happens to
      // be reading — which is not the page the value is on.
      globalThis.Validation.watch({ nodeId: c.node, widget: c.widget,
        tabId: msg.tabId ?? sender?.tab?.id })
        .then(sendResponse).catch((e) => sendResponse({ error: e.message }));
      return true;
    }
    if (c.action === 'watch-stop') {
      globalThis.Validation.unwatch({ id: c.watchId, nodeId: c.node, widget: c.widget })
        .then(sendResponse).catch((e) => sendResponse({ error: e.message }));
      return true;
    }

    // Keyed by the action ids the corpus actually emits - the first version
    // of this map used five ids of its own invention, none of which the
    // corpus produces, so every control on a live run was a dead button.
    //
    // This map is now the FALLBACK, not the first answer. It is written in
    // shopping vocabulary throughout — "Describe the product photos", "Undo it.
    // If it was an order, cancel it." — because it was written against the
    // Amazon corpus, and it is still exactly right there. On a passport form or
    // a flight booking it names things that are not on the page. So a task
    // model, which carries the question that produced the finding, is asked
    // first; this answers when there is no model loaded (the corpus path, whose
    // demo must not change) or when the model has nothing better to offer.
    const fallbackSay = {
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
      // No 'hand-over' row. It was "Stop and let me do this part myself. Tell me
      // where things stand.", unreachable since the intercept above took it, and
      // it read as though handing over were still a sentence the agent obeys.
      're-sort': `Re-sort the results by ${c.arg || 'rating'} and tell me the new first result.`,
      'pick-size': 'Read me the sizes on this page and wait for me to choose.',
      'coupon-tick': 'Tick the coupon checkbox under the price, then read me the new price.',
      'remove-extras': 'Remove everything from the cart that is not the item we picked today.',
      'open-other': 'Open the next best match instead and read me its title.',
      'halt': 'Stop what you are doing and wait.',
    }[c.action]
      // An action this map has never heard of must not be a dead button:
      // the label names the person's move, so it becomes the instruction.
      || (c.label ? `${c.label}. Then tell me what changed.` : null);

    if (c.action === 'probe-pick') {
      (async () => {
        await globalThis.Validation?.annotate?.({ probe: null });
        const r = c.query ? await steerAgent(`Search for "${c.query}" now and continue the task with those results.`) : {};
        sendResponse({ sent: c.query || null, ...r });
      })();
      return true;
    }

    (async () => {
      // The task model's own question first. It knows what the thing is, which
      // is the whole reason the instruction should come from it: "Read me the
      // exact words on this page that answer it" carries the question with it,
      // where "Describe the product photos" carries an Amazon page.
      let say = null;
      try { say = await globalThis.Validation?.instructionFor?.(c); } catch { /* fall back */ }
      // The injection window: an answer for a phase behind the run does not
      // steer the agent. The layer says so and keeps it for the review.
      if (say && typeof say === 'object' && say.stale) {
        chrome.runtime.sendMessage({ type: 'validationSpeak', phase: 'control',
          lines: [{ say: say.say, level: 'aside', live: 'polite', widget: c.action }],
        }).catch(() => {});
        sendResponse({ stale: true, say: say.say });
        return;
      }
      say = (typeof say === 'string' ? say : null) || fallbackSay;

      if (c.action === 'refine-narrow') {
        sendResponse({ probed: await runRefineProbe(say) });
        return;
      }
      if (!say) { sendResponse({ error: `no instruction for ${c.action}` }); return; }
      const r = await steerAgent(say);
      chrome.runtime.sendMessage({
        type: 'validationSpeak', phase: 'control',
        lines: [{ say, level: 'aside', live: 'polite', widget: c.action }],
      }).catch(() => {});
      sendResponse({ sent: say, ...r });
    })();
    return true;
  }

  if (msg.type === 'validationHandOver') {
    globalThis.Validation.handOver({ nodeId: msg.nodeId, reason: msg.reason, tabId: msg.tabId })
      .then(sendResponse).catch((e) => sendResponse({ error: e.message }));
    return true;
  }
  if (msg.type === 'validationHandBack') {
    globalThis.Validation.handBack({ nodeId: msg.nodeId, tabId: msg.tabId })
      .then(sendResponse).catch((e) => sendResponse({ error: e.message }));
    return true;
  }
  if (msg.type === 'validationWatch') {
    globalThis.Validation.watch({ nodeId: msg.nodeId, widget: msg.widget, tabId: msg.tabId })
      .then(sendResponse).catch((e) => sendResponse({ error: e.message }));
    return true;
  }
  if (msg.type === 'validationUnwatch') {
    globalThis.Validation.unwatch({ id: msg.id, nodeId: msg.nodeId, widget: msg.widget })
      .then(sendResponse).catch((e) => sendResponse({ error: e.message }));
    return true;
  }
  if (msg.type === 'validationWatches') {
    globalThis.Validation.watches()
      .then((w) => sendResponse({ watches: w })).catch((e) => sendResponse({ error: e.message }));
    return true;
  }
  if (msg.type === 'validationStatus') {
    // Who holds the wheel. Anything drawing on the page should ask before it
    // acts, and so should the agent.
    sendResponse(globalThis.Validation.status());
    return false;
  }

  if (msg.type === 'validationTrace') {
    // Reading the record. `nodeId` is the whole point of it: a lookup by the
    // decision rather than a scan of a click list.
    (async () => {
      try {
        const T = globalThis.Validation.trace;
        const entries = msg.nodeId != null ? await T.at(msg.nodeId)
          : msg.since != null ? await T.since(msg.since)
          : await T.all();
        sendResponse({ entries, where: globalThis.Validation.where() });
      } catch (e) { sendResponse({ error: e.message }); }
    })();
    return true;
  }
  if (msg.type === 'validationWhy') {
    // Reads the trace and calls no model. Note what it does NOT do: going back
    // to a decision does not undo anything that already happened on the site.
    globalThis.Validation.why({ nodeId: msg.nodeId, step: msg.step })
      .then(sendResponse).catch((e) => sendResponse({ error: e.message }));
    return true;
  }

  if (msg.type === 'validationOnRequest') {
    sendResponse({ items: globalThis.Validation.onRequest() });
    return false;
  }

  if (msg.type === 'bhAgentStop') {
    // The reason travels with the stop so the run's own record says what
    // ended it. Absent one, the agent falls back to "Stopped by user", which
    // is what a press of the stop button is.
    // A stopped run also ends an unfinished demo - a done demo keeps its
    // end report, an abandoned one must not follow ordinary browsing around.
    try { globalThis.DemoDirector?.abandon?.(); } catch { /* demo only */ }
    globalThis.BrowserAgent?.stop(msg.reason);
    sendResponse({ success: true });
    return false;
  }

  // Held, not ended. Sits next to stop because it is the same question asked
  // less finally, and because a surface offering one should offer the other.
  if (msg.type === 'bhAgentPause') {
    sendResponse(globalThis.BrowserAgent?.pause?.({
      reason: msg.reason, byNode: msg.nodeId,
    }) || { paused: false, why: 'agent not loaded' });
    return false;
  }

  if (msg.type === 'bhAgentResume') {
    sendResponse(globalThis.BrowserAgent?.resume?.({
      rePerceive: msg.rePerceive !== false,
    }) || { resumed: false, why: 'agent not loaded' });
    return false;
  }

  if (msg.type === 'bhAgentPauseState') {
    sendResponse(globalThis.BrowserAgent?.pauseState?.() || { paused: false });
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
  if (msg.type && (msg.type.startsWith('librarian') || msg.type.startsWith('broker'))) {
    const L = globalThis.Librarian;
    if (!L) { sendResponse({ error: 'librarian not loaded' }); return false; }
    (async () => {
      try {
        switch (msg.type) {
          case 'librarianGetProfile':
            sendResponse({ profile: await L.getProfile() }); break;
          case 'librarianGetAbilityModel':
            sendResponse({ model: await L.getAbilityModel() }); break;
          case 'librarianListProcedural':
            sendResponse({ procedural: await L.listProcedural(msg.category || null) }); break;
          case 'brokerListGrants':
            sendResponse({ grants: await globalThis.Broker.listGrants() }); break;
          case 'brokerCreateGrant':
            sendResponse({ grant: await globalThis.Broker.createGrant(msg.grant || {}) }); break;
          case 'brokerRevokeGrant':
            sendResponse({ revoked: await globalThis.Broker.revokeGrant(msg.grantId) }); break;
          case 'brokerExportUnderstanding':
            sendResponse({ understanding: await globalThis.Broker.exportUnderstanding(msg.grantId) }); break;
          case 'brokerAuditLog':
            sendResponse({ audit: await globalThis.Broker.getAuditLog() }); break;
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
            sendResponse(await L.revokeGrant(msg.appId)); break;
          case 'librarianSetSharingPaused':
            await L.setSharingPaused(msg.paused);
            sendResponse({ success: true }); break;
          case 'librarianRequestGrant':
            sendResponse(await L.requestGrant(msg.appId, msg.scopes || [], msg.opts || {})); break;
          case 'librarianImportInsight':
            sendResponse(await L.importInsight(msg.appId, msg.insight || {})); break;
          case 'librarianExportAbilityModel':
            sendResponse(await L.exportAbilityModel(msg.appId)); break;
          case 'librarianGetActingUser':
            sendResponse({ actingUser: L.getActingUser() }); break;
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
            sendResponse({ plan: L.resolveSkill(msg.skill) }); break;
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
