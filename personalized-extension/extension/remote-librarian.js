// Remote toolkit server client -- HTTP client for server/CONTRACT.md's
// `/v1/librarian/{method}` route, plus a facade that mirrors the local
// globalThis.Librarian surface so background.js's message dispatcher can
// swap one for the other without touching its 36 `case 'librarian*'` arms.
//
// Classic script (IIFE), loaded via self.importScripts alongside
// chrome-actuation.js / voice-routes.js (background.js) AND as a plain
// <script> tag on the options page (options.html) and the test harness (a
// vm sandbox) -- so this file must not assume `chrome`, `self`, or any
// service-worker-only global. It only needs `fetch` and `globalThis`.
//
// Wire contract (server/CONTRACT.md, "Auth" + "/v1/librarian/{method}"):
//   POST {url}/v1/librarian/{method}
//     headers: Authorization: Bearer <token>, content-type: application/json
//     body:    {"args": [...]}
//   200 {"ok":true,"result":<value>}   -> return <value>
//   200 {"ok":false,"error":"<msg>"}   -> throw Error(<msg>)  (application error)
//   401 (any body)                      -> throw Error('unauthorized')
//   network failure (fetch rejects)     -> throw
(function () {
  // {url, token} once configure() has been called with both, else null.
  let _cfg = null;

  function configure({ url, token } = {}) {
    const u = (url || '').trim();
    const t = (token || '').trim();
    _cfg = (u && t) ? { url: u.replace(/\/+$/, ''), token: t } : null;
  }

  function isConfigured() {
    return !!_cfg;
  }

  // Low-level: POST {url}/v1/librarian/{method} {args}. `method` is the wire
  // name for a route -- see the ALIAS table below for where that differs
  // from the local Librarian method name.
  async function call(method, args = []) {
    if (!_cfg) throw new Error('RemoteLibrarian not configured');
    let res;
    try {
      res = await fetch(`${_cfg.url}/v1/librarian/${method}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'Authorization': `Bearer ${_cfg.token}`,
        },
        body: JSON.stringify({ args: args || [] }),
      });
    } catch (e) {
      // Network failure (offline, DNS, CORS, refused connection, ...):
      // rethrow so callers see a real Error, not a hung promise.
      throw new Error(`RemoteLibrarian: network error calling ${method}: ${e.message}`);
    }

    if (res.status === 401) throw new Error('unauthorized');

    let data = null;
    try { data = await res.json(); } catch { /* fall through to shape checks below */ }

    if (!data || typeof data !== 'object') {
      throw new Error(`RemoteLibrarian: bad response (HTTP ${res.status}) calling ${method}`);
    }
    if (data.ok === true) return data.result;
    if (data.ok === false) throw new Error(data.error || `RemoteLibrarian: ${method} failed`);
    // Unknown-method (404) and any other non-{ok:...} shape (per CONTRACT.md
    // "Unknown method: 404 {\"error\":\"unknown-method\"}").
    throw new Error(data.error || `RemoteLibrarian: unexpected response (HTTP ${res.status}) calling ${method}`);
  }

  // GET {url}/v1/whoami -> {uid, label}. Used by the options page's "Test
  // connection" button; not part of the Librarian facade.
  async function whoami() {
    if (!_cfg) throw new Error('RemoteLibrarian not configured');
    let res;
    try {
      res = await fetch(`${_cfg.url}/v1/whoami`, {
        headers: { Authorization: `Bearer ${_cfg.token}` },
      });
    } catch (e) {
      throw new Error(`RemoteLibrarian: network error calling whoami: ${e.message}`);
    }
    if (res.status === 401) throw new Error('unauthorized');
    let data = null;
    try { data = await res.json(); } catch { /* handled below */ }
    if (!res.ok || !data) throw new Error((data && data.error) || `RemoteLibrarian: whoami failed (HTTP ${res.status})`);
    return data;
  }

  // ---------------------------------------------------------------------
  // Facade: every method the local globalThis.Librarian exposes to
  // background.js's message dispatcher (enumerated from the `L.<method>`
  // calls inside the `case 'librarian*'` arms), each delegating to `call`.
  //
  // Most wire names equal the real Librarian method name 1:1 -- CONTRACT.md
  // defines `{method}` as "the librarian* message type with the `librarian`
  // prefix dropped and the first letter lower-cased", and for most methods
  // that derivation IS the real method name (message type
  // `librarianGetProfile` -> derived name `getProfile` -> real method
  // `getProfile`). Where the derived name and the real method name differ,
  // CONTRACT.md says the server keeps "an alias table in the server route
  // map" (its worked example: `librarianEffectivePreferences` ->
  // `effectivePreferences` maps server-side to `getEffectivePreferences`).
  // ALIAS below is the client-side mirror of that same table: real Librarian
  // method name -> the derived wire name the server expects.
  const ALIAS = {
    // message type librarianSetSiteCategory -> effectivePreferences-style
    // derivation `setSiteCategory`; real local method is setSiteCategoryOverride.
    setSiteCategoryOverride: 'setSiteCategory',
    // librarianEffectivePreferences -> effectivePreferences (CONTRACT.md's own example).
    getEffectivePreferences: 'effectivePreferences',
    // librarianExtractNow -> extractNow; real method is extract.
    extract: 'extractNow',
    // librarianReflectNow -> reflectNow; real method is reflect.
    reflect: 'reflectNow',
    // librarianFindSkill -> findSkill; real method is findSkillForNeed.
    findSkillForNeed: 'findSkill',
    // librarianShareAudit -> shareAudit; not a Librarian method locally (it's
    // the Grants bridge's getShareAudit), but CONTRACT.md's method list
    // covers it and background.js's remote branch calls it through this
    // same facade (see background.js's `case 'librarianShareAudit'`).
    getShareAudit: 'shareAudit',
    // librarianSetPause -> setPause. TWO real local methods share this one
    // wire route (background.js picks between them based on msg.origin);
    // the server distinguishes by argument shape ([origin, paused] vs
    // [paused]).
    setOriginPaused: 'setPause',
    setMemoryPaused: 'setPause',
  };

  // The exact method names background.js's dispatcher calls on `L`, i.e.
  // `globalThis.Librarian`'s public surface as far as the message layer is
  // concerned (grep `\bL\.[A-Za-z0-9_]+` over the `case 'librarian*'` arms
  // in background.js -- background.js's own require lists 36 arms /
  // 36 distinct `L.*` names; remote-librarian-test.mjs re-derives this same
  // list from the source so it can't rot out from under this file).
  const LIBRARIAN_METHODS = [
    'getProfile', 'getAbilityModel', 'listProcedural', 'setProfileField',
    'recordScopedSettings', 'getSiteCategory', 'setSiteCategoryOverride',
    'getEffectivePreferences', 'recall', 'listMemories', 'listProposals',
    'logObservation', 'respondToProposal', 'deleteMemory',
    'setOriginPaused', 'setMemoryPaused', 'extract', 'reflect',
    'listGrants', 'revokeGrant', 'setSharingPaused', 'requestGrant',
    'importInsight', 'exportAbilityModel', 'getActingUser', 'setActingUser',
    'exportProfileBlob', 'importProfileBlob', 'importInsightOutbox',
    'listSkills', 'retrieveSkill', 'findSkillForNeed', 'buildSkill',
    'resolveSkill', 'saveSkill', 'deleteSkill',
  ];

  // Extra, non-dispatcher methods the remote facade also offers:
  // - getShareAudit so background.js's `librarianShareAudit` arm can reach it
  //   through `L` exactly like any other passthrough (see ALIAS above);
  // - the DIRECT-surface methods the voice side panel / chrome-actuation call
  //   on the Librarian object (first-class wire routes per CONTRACT.md, no
  //   alias), so remote mode covers the voice memory path too.
  const EXTRA_METHODS = [
    'getShareAudit',
    'interpretNeedsPrompt', 'hasScopedSetting', 'getScopedSetting',
    'removeScopedSetting', 'recordExplicitSetting',
  ];

  function asLibrarian() {
    const facade = {};
    for (const name of [...LIBRARIAN_METHODS, ...EXTRA_METHODS]) {
      const wire = ALIAS[name] || name;
      facade[name] = (...args) => call(wire, args);
    }
    // Inherently local-only: the server holds its own GEMINI_API_KEY and
    // wires it into the Librarian it runs via setGeminiCaller at boot
    // (CONTRACT.md "Server-side LLM") -- a remote facade has no local
    // Librarian instance to inject a caller into. Safe no-op rather than a
    // missing method so any caller that still reaches for it (background.js
    // calls it once at startup on globalThis.Librarian directly, not
    // through this facade) doesn't crash if it ever is.
    facade.setGeminiCaller = () => {
      console.warn('[RemoteLibrarian] setGeminiCaller is a no-op in remote mode -- the server owns its own Gemini key.');
    };
    return facade;
  }

  globalThis.RemoteLibrarian = { configure, isConfigured, call, whoami, asLibrarian };
})();
