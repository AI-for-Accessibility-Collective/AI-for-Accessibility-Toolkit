// Voice-mode data routes. The offscreen voice engine has no chrome.tabs /
// chrome.scripting access, so every tool that touches the browser lands here
// via chrome.runtime.sendMessage. Loaded by background.js importScripts after
// lib/ (needs globalThis.Librarian / AA_TOOLS / WebSurface); getApiKey and
// callGemini are background.js top-level declarations on the same SW global.
//
// Own listener, whitelisted types only — background.js's main listener leaves
// unknown top-level types unanswered, so there is no sendResponse race
// (same pattern as the offscreen page's OFFSCREEN_MSG_TYPES whitelist).
//
//   voiceGetContext          {}                    -> tab/zoom/active-settings snapshot
//   voiceApplySettings       {changes, scope?}     -> persist + live-apply (popup semantics)
//   voiceReadPage            {mode?, chunk?}       -> extract page text for Q&A
//   voiceSuggestCapabilities {need}                -> interpretNeeds, compacted for voice
//   voiceGetMemory           {topic?}              -> profile + memories + pending proposals

(function () {
  const VOICE_DATA_ROUTES = new Set([
    'voiceGetContext',
    'voiceApplySettings',
    'voiceReadPage',
    'voiceSuggestCapabilities',
    'voiceGetMemory',
  ]);

  // Baseline value per setting when nothing is stored. Mirrors content.js
  // init() / popup defaults; used both to report "what's non-default" and as
  // the previous-value fallback for undo.
  const SETTING_DEFAULTS = {
    darkMode: false, readerMode: false, keyboardNav: false, voiceCommands: false,
    motionReducer: false, focusMode: false, hideDistractions: false, showProgress: true,
    colorBlindMode: 'none', contrastMode: 'none', fontScale: 100, lineHeight: 1.5,
    letterSpacing: 0, dyslexiaFont: false, largeCursor: false, enhanceFocus: false,
    readingGuide: false, speechRate: 1,
    autoWcagFix: true, autoDescribe: true, autoFixLabels: true, autoVideoDescribe: false,
    autoCaptions: false, autoSimplify: false, autoSummarize: false,
  };

  // Live-apply grouping — must mirror how the popup drives the content script
  // (popup.js setupToggles/applyVisualAssist). VisualAssist in particular must
  // always be sent as the FULL merged options object: the content tool resets
  // any option missing from the message, so a single-key patch would clobber
  // the other seven visual settings.
  const SIMPLE_TOOLS = {
    darkMode: 'DarkMode', readerMode: 'ReaderMode', keyboardNav: 'KeyboardNavigator',
    voiceCommands: 'VoiceCommands', motionReducer: 'MotionReducer',
  };
  const VA_KEYS = ['contrastMode', 'fontScale', 'lineHeight', 'letterSpacing',
    'dyslexiaFont', 'largeCursor', 'enhanceFocus', 'readingGuide'];
  const FOCUS_KEYS = ['focusMode', 'hideDistractions', 'showProgress'];
  const AI_KEYS = ['autoWcagFix', 'autoFixLabels', 'autoDescribe', 'autoVideoDescribe',
    'autoCaptions', 'autoSimplify', 'autoSummarize'];

  const PAGE_ZOOM_RANGE = [25, 500];
  const TEXT_CHUNK = 4000;      // 'text' mode chunk size (chars)
  const OUTLINE_TEXT = 1500;    // opening-text size in 'outline' mode

  function settingsMeta() {
    return (globalThis.AA_TOOLS && globalThis.AA_TOOLS.settingsMeta) || {};
  }

  async function activeTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab || null;
  }

  function isWebUrl(url) { return /^https?:/i.test(url || ''); }

  // A page title is attacker-controlled. It gets embedded into the Live
  // system-instruction's session-context block, so strip newlines/control
  // chars that could forge a new instruction line, and cap length.
  function safeTitle(title) {
    return String(title || '').replace(/[\u0000-\u001F]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
  }

  function hostnameOf(url) {
    try { return new URL(url).hostname; } catch { return null; }
  }

  // Coerce + clamp a raw tool value against the registry vocabulary. Returns
  // undefined when the key/value can't be made valid (caller reports it).
  function cleanValue(key, raw, meta) {
    const m = meta[key];
    if (!m) return undefined;
    if (m.type === 'boolean') {
      if (typeof raw === 'string') return raw === 'true' || raw === 'on';
      return !!raw;
    }
    if (m.type === 'number') {
      const n = Number(raw);
      if (!Number.isFinite(n)) return undefined;
      const [lo, hi] = m.range || [-Infinity, Infinity];
      return Math.min(hi, Math.max(lo, n));
    }
    if (m.type === 'enum') return (m.options || []).includes(raw) ? raw : undefined;
    return undefined;
  }

  // Same merge the popup consumes (librarianEffectivePreferences branch):
  // surface-adapted when the WebSurface bundle is loaded, raw merge otherwise.
  async function effectivePrefsFor(url) {
    const L = globalThis.Librarian;
    const meta = settingsMeta();
    if (globalThis.WebSurface && Object.keys(meta).length) {
      return await globalThis.WebSurface.resolveWebPreferences({
        librarian: L, settingsMeta: meta, url, contexts: [],
      });
    }
    return await L.getEffectivePreferences(url, []);
  }

  // ---- voiceGetContext ---------------------------------------------------

  async function getContext() {
    const tab = await activeTab();
    const url = tab && isWebUrl(tab.url) ? tab.url : null;

    let zoomPercent = null;
    if (url && tab.id != null) {
      try { zoomPercent = Math.round((await chrome.tabs.getZoom(tab.id)) * 100); } catch {}
    }

    const activeSettings = {};
    let siteScopedKeys = [];
    try {
      if (url) {
        const eff = await effectivePrefsFor(url);
        for (const [k, v] of Object.entries(eff.settings || {})) {
          if (k in SETTING_DEFAULTS && v !== SETTING_DEFAULTS[k]) activeSettings[k] = v;
        }
        siteScopedKeys = Object.entries(eff.provenance || {})
          .filter(([, s]) => typeof s === 'string' && /^(category:|origin:)/.test(s))
          .map(([k]) => k);
      } else {
        const stored = await chrome.storage.sync.get(Object.keys(SETTING_DEFAULTS));
        for (const [k, v] of Object.entries(stored)) {
          if (v !== undefined && v !== SETTING_DEFAULTS[k]) activeSettings[k] = v;
        }
      }
    } catch {}

    let memoryPaused = false;
    try { memoryPaused = !!(await globalThis.Librarian.getProfile()).memoryPaused; } catch {}

    return {
      tab: tab ? { title: safeTitle(tab.title), origin: url ? hostnameOf(url) : null } : null,
      onWebPage: !!url,
      zoomPercent,
      activeSettings,
      siteScopedKeys,
      memoryPaused,
    };
  }

  // Scope must match the Librarian's VALID_SCOPE exactly — a scope the toolkit
  // silently coerces to 'general' would turn a "only on YouTube" request into a
  // global change with a success message that lies about where it landed.
  const VOICE_SCOPE = /^(category:[a-z-]+|origin:[a-z0-9.-]+)$/;

  function validateScope(scope) {
    if (!scope) return { ok: true, scope: null };
    const s = String(scope).toLowerCase();
    if (!VOICE_SCOPE.test(s)) {
      return { ok: false, error: `invalid scope "${scope}" — use category:<id> (e.g. category:news) or origin:<hostname>, or omit it` };
    }
    if (s.startsWith('category:')) {
      const id = s.slice('category:'.length);
      const ids = (globalThis.AA_TAXONOMY && globalThis.AA_TAXONOMY.categoryIds && globalThis.AA_TAXONOMY.categoryIds()) || null;
      if (ids && !ids.includes(id)) {
        return { ok: false, error: `unknown site category "${id}" — it would apply nowhere` };
      }
    }
    return { ok: true, scope: s };
  }

  // Does a scope apply to the currently active tab? Used so an explicitly
  // scoped change ("bigger text on news sites") does NOT visibly re-style the
  // unrelated site the user happens to be looking at (persistence is correct
  // regardless; this only gates the live preview).
  async function scopeMatchesTab(scope, origin) {
    if (!scope || scope === 'general') return true;
    if (!origin) return false;
    if (scope.startsWith('origin:')) return scope.slice('origin:'.length) === origin;
    if (scope.startsWith('category:')) {
      try {
        const cat = await globalThis.Librarian.getSiteCategory(origin);
        return `category:${cat}` === scope;
      } catch { return false; }
    }
    return false;
  }

  // ---- voiceApplySettings --------------------------------------------------
  //
  // Two entry shapes:
  //   { changes, scope? }        — a normal voice change; provenance decides
  //                                where each key lands (unless scope is given).
  //   { restore }                — an undo replay carrying an EXPLICIT per-key
  //                                plan captured at change time, so it reverts
  //                                the exact records/tab the change touched
  //                                rather than re-resolving against the current
  //                                tab (which could clobber a different scope).

  async function applySettings(changes, scope, restore) {
    if (restore) return await applyRestore(restore);

    const meta = settingsMeta();
    const sv = validateScope(scope);
    if (!sv.ok) return { error: sv.error };
    scope = sv.scope;

    // 1. Validate + clamp against the registry vocabulary.
    const clean = {};
    const rejected = [];
    let zoomPct = null;
    for (const [key, raw] of Object.entries(changes || {})) {
      if (key === 'pageZoom') {
        const n = Number(raw);
        if (Number.isFinite(n)) zoomPct = Math.min(PAGE_ZOOM_RANGE[1], Math.max(PAGE_ZOOM_RANGE[0], n));
        else rejected.push(key);
        continue;
      }
      const v = cleanValue(key, raw, meta);
      if (v === undefined) rejected.push(key);
      else clean[key] = v;
    }
    if (!Object.keys(clean).length && zoomPct == null) {
      return { error: 'no valid settings in changes', rejected };
    }

    const tab = await activeTab();
    const url = tab && isWebUrl(tab.url) ? tab.url : null;
    const origin = url ? hostnameOf(url) : null;

    // 2. Current values — effective prefs (for provenance + previous) plus the
    // raw sync values the content script would fall back to.
    let effSettings = {}, provenance = {};
    if (url) {
      try {
        const eff = await effectivePrefsFor(url);
        effSettings = eff.settings || {};
        provenance = eff.provenance || {};
      } catch {}
    }
    const groupKeys = [...new Set([...VA_KEYS, ...FOCUS_KEYS, ...Object.keys(clean)])];
    let stored = {};
    try { stored = await chrome.storage.sync.get(groupKeys); } catch {}
    const current = (key) =>
      (key in effSettings) ? effSettings[key]
        : (stored[key] !== undefined) ? stored[key]
          : SETTING_DEFAULTS[key];

    const previous = {};
    for (const key of Object.keys(clean)) previous[key] = current(key);

    // 3. Resolve each key's target scope — explicit scope wins; otherwise
    // mirror the popup's persistSetting: keys whose current value is
    // site-scoped update that Librarian record, the rest are global.
    const scopesUsed = {};
    for (const key of Object.keys(clean)) {
      const prov = provenance[key];
      scopesUsed[key] = scope
        || ((typeof prov === 'string' && /^(category:|origin:)/.test(prov)) ? prov : 'general');
    }

    // 4. Persist. Report `previous`/`scopesUsed` even on a partial failure so
    // the caller can still record an undo entry for whatever committed (a
    // scoped write that landed before a later sync.set quota error must not be
    // left un-undoable).
    const persistErr = await persistPlan(clean, scopesUsed, origin);

    // 5. Page zoom (active tab; Chrome persists zoom per-origin). Record the
    // tab id so undo can revert the SAME tab, not whatever is active later.
    let pageZoomTabId = null;
    if (zoomPct != null) {
      if (url && tab.id != null) {
        try {
          previous.pageZoom = Math.round((await chrome.tabs.getZoom(tab.id)) * 100);
          await chrome.tabs.setZoom(tab.id, zoomPct / 100);
          pageZoomTabId = tab.id;
        } catch { rejected.push('pageZoom'); zoomPct = null; }
      } else { rejected.push('pageZoom'); zoomPct = null; }
    }

    // 6. Live-apply to the active tab — but only keys whose scope actually
    // applies to it, so an explicitly out-of-scope change doesn't visibly
    // re-style the current site.
    let liveApplied = false;
    if (url && tab.id != null) {
      const inScope = {};
      for (const [key, value] of Object.entries(clean)) {
        if (await scopeMatchesTab(scopesUsed[key], origin)) inScope[key] = value;
      }
      if (Object.keys(inScope).length) {
        const merged = (key) => (key in inScope) ? inScope[key] : current(key);
        liveApplied = await liveApply(tab.id, inScope, merged);
      }
    }

    const applied = { ...clean };
    if (zoomPct != null) applied.pageZoom = zoomPct;
    const result = { applied, previous, scopesUsed, pageZoomTabId, liveApplied };
    if (rejected.length) result.rejected = rejected;
    if (persistErr) result.error = persistErr;
    return result;
  }

  // Persist a resolved plan: scoped keys → Librarian records, global keys → one
  // batched sync.set. Returns an error string on failure (null on success).
  async function persistPlan(clean, scopesUsed, origin) {
    const globalWrites = {};
    const scopedWrites = {};
    for (const [key, value] of Object.entries(clean)) {
      const target = scopesUsed[key];
      if (target && target !== 'general') (scopedWrites[target] = scopedWrites[target] || {})[key] = value;
      else globalWrites[key] = value;
    }
    try {
      for (const [s, settings] of Object.entries(scopedWrites)) {
        await globalThis.Librarian.recordScopedSettings(s, settings, origin ? { origin } : {});
      }
      if (Object.keys(globalWrites).length) await chrome.storage.sync.set(globalWrites);
      return null;
    } catch (e) {
      return `could not save: ${e.message}`;
    }
  }

  // Undo replay: apply an explicit per-key plan to the exact scopes/tab the
  // original change touched. `restore` = { writes: [{key,value,scope}],
  // pageZoom?: {value, tabId} }.
  async function applyRestore(restore) {
    const writes = Array.isArray(restore.writes) ? restore.writes : [];
    const clean = {}, scopesUsed = {};
    for (const w of writes) {
      if (!w || typeof w.key !== 'string') continue;
      clean[w.key] = w.value;
      scopesUsed[w.key] = w.scope || 'general';
    }
    const rejected = [];

    let origin = null;
    const tab = await activeTab();
    const url = tab && isWebUrl(tab.url) ? tab.url : null;
    if (url) origin = hostnameOf(url);

    const persistErr = Object.keys(clean).length ? await persistPlan(clean, scopesUsed, origin) : null;

    // Zoom reverts the SAME tab the change zoomed (if it still exists),
    // never whatever is active now.
    const applied = { ...clean };
    if (restore.pageZoom && restore.pageZoom.tabId != null) {
      try {
        await chrome.tabs.setZoom(restore.pageZoom.tabId, Number(restore.pageZoom.value) / 100);
        applied.pageZoom = restore.pageZoom.value;
      } catch { rejected.push('pageZoom'); }
    } else if (restore.pageZoom) {
      rejected.push('pageZoom');
    }

    // Live-preview only the in-scope keys on the current tab. The unchanged
    // siblings in a full-merge group (VisualAssist/FocusMode) must come from
    // the tab's EFFECTIVE prefs — same precedence the normal path uses — so an
    // undo doesn't visually collapse a site-scoped sibling.
    if (url && tab.id != null) {
      const inScope = {};
      for (const [key, value] of Object.entries(clean)) {
        if (await scopeMatchesTab(scopesUsed[key], origin)) inScope[key] = value;
      }
      if (Object.keys(inScope).length) {
        let effSettings = {};
        try { effSettings = (await effectivePrefsFor(url)).settings || {}; } catch {}
        const stored = await chrome.storage.sync.get([...new Set([...VA_KEYS, ...FOCUS_KEYS])]).catch(() => ({}));
        const merged = (key) => (key in inScope) ? inScope[key]
          : (key in effSettings) ? effSettings[key]
            : (stored[key] !== undefined ? stored[key] : SETTING_DEFAULTS[key]);
        await liveApply(tab.id, inScope, merged);
      }
    }

    const result = { applied, scopesUsed };
    if (rejected.length) result.rejected = rejected;
    if (persistErr) result.error = persistErr;
    return result;
  }

  async function liveApply(tabId, clean, merged) {
    const send = (message) =>
      chrome.tabs.sendMessage(tabId, message).catch(() => {});

    for (const [key, tool] of Object.entries(SIMPLE_TOOLS)) {
      if (key in clean) {
        await send(clean[key] ? { type: 'enableTool', tool } : { type: 'disableTool', tool });
      }
    }

    if (FOCUS_KEYS.some((k) => k in clean)) {
      if (merged('focusMode')) {
        await send({
          type: 'enableTool', tool: 'FocusMode',
          options: {
            hideDistractions: merged('hideDistractions') === true,
            showProgress: merged('showProgress') !== false,
          },
        });
      } else {
        await send({ type: 'disableTool', tool: 'FocusMode' });
      }
    }

    if ('colorBlindMode' in clean) {
      await send(clean.colorBlindMode === 'none'
        ? { type: 'disableTool', tool: 'ColorBlindMode' }
        : { type: 'enableTool', tool: 'ColorBlindMode', options: clean.colorBlindMode });
    }

    if (VA_KEYS.some((k) => k in clean)) {
      const options = {
        contrastMode: merged('contrastMode'),
        fontScale: Number(merged('fontScale')) / 100,
        lineHeight: Number(merged('lineHeight')),
        letterSpacing: Number(merged('letterSpacing')),
        dyslexiaFont: merged('dyslexiaFont') === true,
        largeCursor: merged('largeCursor') === true,
        enhanceFocus: merged('enhanceFocus') === true,
        readingGuide: merged('readingGuide') === true,
      };
      const hasChanges = options.contrastMode !== 'none' ||
        options.fontScale !== 1 || options.lineHeight !== 1.5 ||
        options.letterSpacing !== 0 || options.dyslexiaFont ||
        options.largeCursor || options.enhanceFocus || options.readingGuide;
      await send(hasChanges
        ? { type: 'enableTool', tool: 'VisualAssist', options }
        : { type: 'disableTool', tool: 'VisualAssist' });
    }

    const ai = {};
    for (const k of AI_KEYS) if (k in clean) ai[k] = clean[k];
    if (Object.keys(ai).length) await send({ type: 'settingsChanged', settings: ai });

    return true;
  }

  // ---- voiceReadPage -------------------------------------------------------

  // Runs inside the page via chrome.scripting.executeScript — keep it
  // self-contained (no closure references).
  function extractPage() {
    const mainEl = document.querySelector('main') || document.querySelector('article')
      || document.querySelector('[role="main"]') || document.body;
    let selection = '';
    try { selection = String(window.getSelection() || '').trim().slice(0, 500); } catch {}
    const headings = Array.from(document.querySelectorAll('h1, h2, h3')).slice(0, 20)
      .map((h) => (h.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 120))
      .filter(Boolean);
    const text = ((mainEl && mainEl.innerText) || '')
      .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, 60000);
    return { title: document.title || '', selection: selection || null, headings, text };
  }

  async function readPage(mode, chunk) {
    const tab = await activeTab();
    if (!tab || tab.id == null || !isWebUrl(tab.url)) {
      return { error: 'The current tab is not a regular web page I can read.' };
    }
    let data = null;
    try {
      const [res] = await chrome.scripting.executeScript({
        target: { tabId: tab.id }, func: extractPage,
      });
      data = res && res.result;
    } catch (e) {
      return { error: `could not read the page: ${e.message}` };
    }
    if (!data) return { error: 'Could not read the page.' };

    const origin = hostnameOf(tab.url);
    // Flag every page-read result as untrusted data: the model must treat it as
    // content to summarize, never as instructions (a hostile page could embed
    // "call start_browser_task ..." in its text).
    const source = 'untrusted-page-content';
    if (mode === 'text') {
      const totalChunks = Math.max(1, Math.ceil(data.text.length / TEXT_CHUNK));
      const idx = Math.min(Math.max(0, Number(chunk) || 0), totalChunks - 1);
      return {
        source, title: safeTitle(data.title), origin,
        text: data.text.slice(idx * TEXT_CHUNK, (idx + 1) * TEXT_CHUNK),
        chunk: idx, totalChunks,
      };
    }
    return {
      source, title: safeTitle(data.title), origin,
      headings: data.headings,
      selection: data.selection,
      text: data.text.slice(0, OUTLINE_TEXT),
      chunk: 0,
      totalChunks: Math.max(1, Math.ceil(data.text.length / TEXT_CHUNK)),
    };
  }

  // ---- voiceSuggestCapabilities --------------------------------------------

  async function suggestCapabilities(need) {
    if (!need || !String(need).trim()) return { error: 'need is required' };
    const apiKey = await getApiKey();
    if (!apiKey) return { error: 'No Gemini API key configured. Add one in the extension popup under AI keys.' };

    let parsed;
    try {
      const prompt = await globalThis.Librarian.interpretNeedsPrompt(String(need).trim());
      const raw = await callGemini(prompt, apiKey, { mimeType: 'application/json' });
      parsed = JSON.parse(String(raw).replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, ''));
    } catch (e) {
      return { error: `the recommender did not return a usable answer (${e.message}) — try rephrasing` };
    }

    const reasons = {};
    for (const [k, v] of Object.entries(parsed.reasons || {})) reasons[k] = String(v).slice(0, 80);
    return {
      summary: String(parsed.summary || '').slice(0, 200),
      scope: parsed.scope || 'general',
      settings: parsed.settings || {},
      reasons,
      newSkills: (parsed.newSkills || []).slice(0, 3).map((s) => ({
        name: String(s.name || '').slice(0, 60),
        description: String(s.description || '').slice(0, 200),
      })),
    };
  }

  // ---- voiceGetMemory --------------------------------------------------------

  async function getMemory(topic) {
    const L = globalThis.Librarian;
    const tab = await activeTab();
    const url = tab && isWebUrl(tab.url) ? tab.url : 'https://example.invalid/';

    let memories = [];
    if (topic && String(topic).trim()) {
      const r = await L.recall(url, String(topic).trim(), []);
      memories = (r.facts || []).slice(0, 12).map((f) => ({
        id: f.id, text: String(f.text || '').slice(0, 300), scope: f._scope || f.scope || 'general',
      }));
    } else {
      const r = await L.listMemories({ status: 'active' });
      memories = (r.memories || [])
        .sort((a, b) => (b.lastAccessed || b.updatedAt || 0) - (a.lastAccessed || a.updatedAt || 0))
        .slice(0, 12)
        .map((m) => ({ id: m.id, text: String(m.text || '').slice(0, 300), scope: m.scope || 'general' }));
    }

    const profile = await L.getProfile();
    // Cross-app GRANT and INSIGHT proposals are deliberately NOT surfaced to
    // the voice model: minting a grant opens a durable cross-app read channel,
    // which belongs on the visual consent cards in the popup, not behind a
    // possibly-misheard "yes". Excluding them from the listing keeps their ids
    // out of the voice session's seen-set, so respond_to_proposal can't resolve
    // them either. Only self-learned device proposals are voice-resolvable.
    const CROSS_APP_OPS = new Set(['grant-request', 'cross-app-insight']);
    const pendingProposals = (await L.listProposals('pending'))
      .filter((p) => !(p.change && CROSS_APP_OPS.has(p.change.op)))
      .slice(0, 5)
      .map((p) => ({
        id: p.id,
        label: String(p.aspectLabel || p.aspect || 'suggestion').slice(0, 120),
        why: String(p.rationale || '').slice(0, 200),
      }));

    return {
      profile: {
        supportAreas: profile.supportAreas || [],
        notes: String(profile.freeText || '').slice(0, 200),
      },
      memories,
      pendingProposals,
    };
  }

  // ---- listener --------------------------------------------------------------

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || !VOICE_DATA_ROUTES.has(msg.type)) return;
    (async () => {
      try {
        switch (msg.type) {
          case 'voiceGetContext':
            sendResponse(await getContext()); break;
          case 'voiceApplySettings':
            sendResponse(await applySettings(msg.changes, msg.scope, msg.restore)); break;
          case 'voiceReadPage':
            sendResponse(await readPage(msg.mode, msg.chunk)); break;
          case 'voiceSuggestCapabilities':
            sendResponse(await suggestCapabilities(msg.need)); break;
          case 'voiceGetMemory':
            sendResponse(await getMemory(msg.topic)); break;
        }
      } catch (e) {
        sendResponse({ error: e.message || String(e) });
      }
    })();
    return true;
  });
})();
