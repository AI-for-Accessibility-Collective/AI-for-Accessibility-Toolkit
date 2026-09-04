// dom-receiver.js — a browser ControlPort: the reference WEB receiving app.
//
// It implements the same neutral ControlPort contract as mock-receiver.js, but
// over a real DOM subtree (the "app" the Controller drives). This is ONE
// implementation of the port — a mobile/XR/desktop receiver would implement the
// same shape over its own platform. The Controller core never imports this; a
// host wires it in.
//
// Settings map to CSS custom properties / classes on the target root, so the
// effect is visible and undoable. The applied-settings journal powers undoLast.
//
// The `settingsMeta` clamping/validation already happened in the router before
// applySettings is called; here we just render supported keys and record the
// previous value for undo.

// Keys this web receiver knows how to render, and how. Each renderer receives
// (root, value) and returns the *previous* rendered value so undo can restore
// it. Keeping the set explicit is the honesty contract: describeCapabilities()
// reports exactly these.
const RENDERERS = {
  fontScale:      (r, v) => cssVar(r, '--aa-font-scale', v == null ? null : (Number(v) / 100)),
  lineHeight:     (r, v) => cssVar(r, '--aa-line-height', v),
  letterSpacing:  (r, v) => cssVar(r, '--aa-letter-spacing', v == null ? null : `${v}em`),
  darkMode:       (r, v) => toggleClass(r, 'aa-dark', v),
  contrastMode:   (r, v) => setDataAttr(r, 'aaContrast', v && v !== 'none' ? v : null),
  dyslexiaFont:   (r, v) => toggleClass(r, 'aa-dyslexia', v),
  bigTargets:     (r, v) => toggleClass(r, 'aa-big-targets', v),
  motionReducer:  (r, v) => toggleClass(r, 'aa-reduce-motion', v),
  hideDistractions: (r, v) => toggleClass(r, 'aa-hide-distractions', v),
  readingGuide:   (r, v) => toggleClass(r, 'aa-reading-guide', v),
  focusMode:      (r, v) => toggleClass(r, 'aa-focus-mode', v),
};

function cssVar(root, name, value) {
  const prev = root.style.getPropertyValue(name) || null;
  if (value == null || value === '') root.style.removeProperty(name);
  else root.style.setProperty(name, String(value));
  return prev === '' ? null : prev;
}
function toggleClass(root, cls, on) {
  const prev = root.classList.contains(cls);
  root.classList.toggle(cls, !!on);
  return prev;
}
function setDataAttr(root, key, value) {
  const prev = root.dataset[key] == null ? null : root.dataset[key];
  if (value == null) delete root.dataset[key];
  else root.dataset[key] = String(value);
  return prev;
}

/**
 * @param {HTMLElement} root                 The app subtree the Controller drives.
 * @param {Object} [opts]
 * @param {string} [opts.platform]           Capability tag (default 'web').
 * @param {HTMLElement} [opts.scrollTarget]  Element to scroll (default root).
 * @returns {import('../control-port.js').ControlPort}
 */
export function createDomReceiver(root, { platform = 'web', scrollTarget } = {}) {
  const journal = []; // LIFO of { key: previousRenderedValue }
  const scroller = scrollTarget || root;

  const ACTIONABLE = 'a, button, [role="button"], [role="link"], summary';
  const nameOf = (e) => (e.textContent || e.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
  const listTargets = () => [...root.querySelectorAll(ACTIONABLE)].map(nameOf).filter(Boolean);

  const capabilities = {
    platform,
    settingKeys: Object.keys(RENDERERS),
    actions: ['scroll', 'activate', 'back', 'forward'],
    canReadContent: true,
    canStop: false, // this receiver acts synchronously — nothing long-running to interrupt
  };

  // Track the logical active values (what was requested), separate from how
  // they render, so getContext can report them the way the router expects.
  const active = {};

  return {
    async describeCapabilities() {
      return { ...capabilities, settingKeys: [...capabilities.settingKeys], actions: [...capabilities.actions], targets: listTargets() };
    },

    async getContext() {
      const focus = root.querySelector('h1, h2, [role="heading"]');
      return {
        focus: focus ? focus.textContent.trim().slice(0, 80) : null,
        activeSettings: { ...active },
        capabilities: await this.describeCapabilities(),
      };
    },

    async applySettings(changes) {
      const applied = {};
      const previous = {};
      const rejected = [];
      for (const [key, value] of Object.entries(changes || {})) {
        const render = RENDERERS[key];
        if (!render) { rejected.push(key); continue; }
        previous[key] = key in active ? active[key] : undefined;
        render(root, value);
        // null is "remove": the key leaves the active map the same way undoLast
        // drops a key that had no prior value, so getContext reports only what
        // is in effect and a relative change ("bigger text") starts from the
        // baseline again rather than from Number(null).
        if (value == null) delete active[key]; else active[key] = value;
        applied[key] = value;
      }
      if (!Object.keys(applied).length) return { error: 'no applicable settings', rejected };
      journal.push(previous);
      return { applied, previous, rejected };
    },

    async undoLast() {
      if (!journal.length) return { error: 'nothing to undo' };
      const previous = journal.pop();
      const reverted = {};
      for (const [key, value] of Object.entries(previous)) {
        RENDERERS[key](root, value === undefined ? null : value);
        if (value === undefined) delete active[key]; else active[key] = value;
        reverted[key] = value;
      }
      return { reverted, remainingUndos: journal.length };
    },

    async resetUndo() { journal.length = 0; return { ok: true }; },

    async getContent(mode = 'outline') {
      const headings = [...root.querySelectorAll('h1, h2, h3')].map((h) => h.textContent.trim()).filter(Boolean);
      const title = headings[0] || (root.getAttribute('aria-label') || '');
      if (mode === 'text') {
        const text = (root.textContent || '').replace(/\s+/g, ' ').trim();
        return { source: 'untrusted-content', title, text, chunk: 0, totalChunks: 1 };
      }
      return { source: 'untrusted-content', title, outline: headings };
    },

    async performAction(action, target) {
      if (action === 'scroll') {
        if (target === 'top') scroller.scrollTo && scroller.scrollTo({ top: 0, behavior: 'smooth' });
        else if (target === 'bottom') scroller.scrollTo && scroller.scrollTo({ top: scroller.scrollHeight || 1e6, behavior: 'smooth' });
        else { const by = (scroller.clientHeight || 400) * 0.8; scroller.scrollBy && scroller.scrollBy({ top: target === 'up' ? -by : by, behavior: 'smooth' }); }
        return { ok: true, detail: `scroll ${target || 'down'}` };
      }
      if (action === 'back' || action === 'forward') {
        const win = (root.ownerDocument && root.ownerDocument.defaultView) || (typeof window !== 'undefined' ? window : null);
        try { win && win.history && win.history[action](); } catch {}
        return { ok: true, detail: action };
      }
      if (action === 'activate') {
        const t = String(target || '').toLowerCase();
        const els = [...root.querySelectorAll(ACTIONABLE)];
        const match = els.find((e) => {
          const n = nameOf(e).toLowerCase();
          return n && (n.includes(t) || t.includes(n));
        });
        if (!match) return { ok: false, detail: `no target matching "${target}"` };
        try { match.click(); } catch {}
        return { ok: true, detail: `activated ${nameOf(match)}` };
      }
      return { ok: false, detail: `unsupported action: ${action}` };
    },

    async stop() {
      // Nothing long-running here (settings/actions apply synchronously).
      return { ok: true, stopped: false, detail: 'no long-running work on this receiver' };
    },
  };
}

export default createDomReceiver;
