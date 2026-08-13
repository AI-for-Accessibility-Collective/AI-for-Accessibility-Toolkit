// Voice-mode data routes. The offscreen voice engine has no chrome.tabs /
// chrome.scripting access, so every tool that touches the browser lands here
// via chrome.runtime.sendMessage. Loaded by background.js importScripts after
// lib/ and chrome-actuation.js (needs globalThis.Librarian / AA_TOOLS /
// WebSurface / ChromeActuation); getApiKey and callGemini are background.js
// top-level declarations on the same SW global.
//
// The actual chrome.tabs / chrome.scripting / chrome.storage actuation logic
// (settings apply/undo, page read, page actions) lives behind the
// host-agnostic ActuationPort (toolkit/ports/actuation.js), implemented for
// Chrome in chrome-actuation.js. This file is now the thin message-routing
// layer: it validates/serializes requests and calls into that port, plus the
// two Librarian-only memory routes (getMemory / suggestCapabilities) that
// were never chrome-specific and stay here untouched.
//
// Own listener, whitelisted types only — background.js's main listener leaves
// unknown top-level types unanswered, so there is no sendResponse race
// (same pattern as the offscreen page's OFFSCREEN_MSG_TYPES whitelist).
//
//   voiceGetContext          {}                    -> tab/zoom/active-settings snapshot
//   voiceApplySettings       {changes, scope?}     -> persist + live-apply (popup semantics)
//   voiceReadPage             {mode?, chunk?}       -> extract page text for Q&A
//   voiceSuggestCapabilities {need}                -> interpretNeeds, compacted for voice
//   voiceGetMemory           {topic?}              -> profile + memories + pending proposals

(function () {

  // Resolve the Librarian through background.js's local/remote switch when
  // available (remote server mode); fall back to the local instance so this
  // file keeps working standalone (tests, early SW startup).
  async function LIB() {
    try { if (globalThis.__resolveLibrarian) return await globalThis.__resolveLibrarian(); } catch {}
    return globalThis.Librarian;
  }
  const VOICE_DATA_ROUTES = new Set([
    'voiceGetContext',
    'voiceApplySettings',
    'voiceUndoLast',
    'voiceResetUndo',
    'voiceReadPage',
    'voiceSuggestCapabilities',
    'voiceGetMemory',
    'voicePageAction',
  ]);

  // The one ActuationPort instance for this service worker. Everything that
  // touches chrome.tabs / chrome.scripting / chrome.storage for voice mode
  // goes through it — see chrome-actuation.js.
  const actuation = globalThis.ChromeActuation.createChromeActuation();

  function isWebUrl(url) { return /^https?:/i.test(url || ''); }

  // Serialize the settings write / undo / reset operations. The Live client
  // dispatches the function-calls in one toolCall batch concurrently, so two
  // adjust_settings in a single turn could otherwise interleave their
  // read-modify-write of the journal (and of a same-scope Librarian shard) and
  // drop an entry/record. A simple promise chain gives one-at-a-time ordering.
  let _opChain = Promise.resolve();
  function serialize(fn) {
    const run = _opChain.then(fn, fn);
    _opChain = run.then(() => {}, () => {});
    return run;
  }

  // ---- voiceGetContext ---------------------------------------------------

  // The actuation port reports the browser-surface snapshot (tab/zoom/active
  // settings); memoryPaused is a Librarian profile read, not chrome-specific,
  // so it's composed in here alongside it.
  async function getContext() {
    const ctx = await actuation.getContext();
    let memoryPaused = false;
    try { memoryPaused = !!(await (await LIB()).getProfile()).memoryPaused; } catch {}
    return { ...ctx, memoryPaused };
  }

  // ---- voiceSuggestCapabilities --------------------------------------------

  async function suggestCapabilities(need) {
    if (!need || !String(need).trim()) return { error: 'need is required' };
    const apiKey = await getApiKey();
    if (!apiKey) return { error: 'No Gemini API key configured. Add one in the extension popup under AI keys.' };

    let parsed;
    try {
      const prompt = await (await LIB()).interpretNeedsPrompt(String(need).trim());
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
    // Only the active tab's URL is needed (to scope recall()) — borrowed from
    // the actuation port so this route doesn't need its own chrome.tabs access.
    const tab = await actuation.activeTab();
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
            sendResponse(await serialize(() => actuation.applySettings(msg.changes, msg.scope))); break;
          case 'voiceUndoLast':
            sendResponse(await serialize(() => actuation.undoLast())); break;
          case 'voiceResetUndo':
            sendResponse(await serialize(() => actuation.resetUndo())); break;
          case 'voiceReadPage':
            sendResponse(await actuation.readPage(msg.mode, msg.chunk)); break;
          case 'voiceSuggestCapabilities':
            sendResponse(await suggestCapabilities(msg.need)); break;
          case 'voiceGetMemory':
            sendResponse(await getMemory(msg.topic)); break;
          case 'voicePageAction':
            sendResponse(await actuation.pageAction(msg.action, msg.target, msg.text)); break;
        }
      } catch (e) {
        sendResponse({ error: e.message || String(e) });
      }
    })();
    return true;
  });
})();
