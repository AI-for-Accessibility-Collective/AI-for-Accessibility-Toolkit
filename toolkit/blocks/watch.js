// Block 3, watch: what changes in the page while the adapter runs.
//
//   s.watch.added(root, fn, opts)  new elements (or changed text/attributes)
//   s.watch.route(fn)              the address changed without a page load
//   s.watch.prefs(fn)              reduced motion, contrast, colour scheme
//   s.watch.byPerson(el, opts)     did the person just click or type in el?
//
// Watchers never react to the toolkit's own UI or to what a block wrote, and
// they stop on end().

import { isOurs } from './shared.js';

const ROUTE_POLL_MS = 1000;
const QUERIES = {
  reducedMotion: '(prefers-reduced-motion: reduce)',
  moreContrast: '(prefers-contrast: more)',
  dark: '(prefers-color-scheme: dark)',
  forcedColors: '(forced-colors: active)',
};

/** Record the person's last click, tap or key, once per page. */
export function watchInput(env) {
  const { shared, doc } = env;
  if (shared.inputWatch) return;
  shared.inputWatch = true;
  const note = (e) => { if (e.isTrusted) shared.lastInput = { target: e.target, at: Date.now() }; };
  for (const type of ['pointerdown', 'keydown', 'input']) doc.addEventListener(type, note, true);
}

export function watchBlock(s, env) {
  const { shared, win, doc } = env;

  // Whether a mutation record is the blocks' own write.
  const ourRecord = (r) => {
    if (r.type === 'attributes') {
      const m = shared.ourAttrs.get(r.target);
      return !!m && m.has(r.attributeName) && m.get(r.attributeName) === r.target.getAttribute(r.attributeName);
    }
    if (r.type === 'characterData') return shared.ourText.get(r.target) === r.target.nodeValue;
    return false;
  };

  function added(root, fn, opts = {}) {
    if (!s.alive() || typeof win.MutationObserver !== 'function') return () => {};
    const { debounceMs = 0, cap = 500, types = ['childList'], selector = null } = opts;
    const target = root || doc.body || doc.documentElement;
    let pending = new Set();
    let timer = null;
    const flush = () => {
      timer = null;
      const list = [...pending].slice(0, cap);
      pending = new Set();
      for (const el of list) if (s.alive() && el.isConnected && !isOurs(el)) fn(el);
    };
    const take = (el) => {
      if (!el || el.nodeType !== 1 || isOurs(el)) return;
      if (!selector) { pending.add(el); return; }
      if (el.matches(selector)) pending.add(el);
      for (const m of el.querySelectorAll(selector)) if (pending.size < cap * 2) pending.add(m);
    };
    const mo = new win.MutationObserver((records) => {
      if (!s.alive()) return;
      for (const r of records) {
        if (ourRecord(r)) continue;
        if (r.type === 'childList') {
          for (const n of r.addedNodes) if (!shared.ourNodes.has(n)) take(n);
        } else {
          take(r.target.nodeType === 1 ? r.target : r.target.parentElement);
        }
      }
      if (!pending.size) return;
      if (debounceMs > 0) { win.clearTimeout(timer); timer = win.setTimeout(flush, debounceMs); } else flush();
    });
    mo.observe(target, {
      subtree: true,
      childList: types.includes('childList'),
      attributes: types.includes('attributes'),
      characterData: types.includes('characterData'),
    });
    const stop = () => { mo.disconnect(); win.clearTimeout(timer); };
    s.onEnd(stop);
    return stop;
  }

  // One watcher per page for address changes made with history.pushState.
  // Patching pushState would not help: the page calls its own world's copy.
  // The Navigation API's event and popstate cover most; a slow poll covers
  // the rest.
  function route(fn) {
    if (!s.alive()) return () => {};
    if (!shared.route) {
      const listeners = new Set();
      let last = win.location.href;
      const check = () => {
        const now = win.location.href;
        if (now === last) return;
        last = now;
        for (const l of [...listeners]) { try { l(now); } catch { /* one listener's error */ } }
      };
      const nav = win.navigation;
      nav?.addEventListener?.('currententrychange', check);
      win.addEventListener('popstate', check);
      win.addEventListener('hashchange', check);
      const poll = win.setInterval(check, ROUTE_POLL_MS);
      shared.route = {
        listeners,
        stop: () => {
          nav?.removeEventListener?.('currententrychange', check);
          win.removeEventListener('popstate', check);
          win.removeEventListener('hashchange', check);
          win.clearInterval(poll);
          shared.route = null;
        },
      };
    }
    const handler = (url) => { if (s.alive()) fn(url); };
    const r = shared.route;
    r.listeners.add(handler);
    const stop = () => { r.listeners.delete(handler); if (!r.listeners.size && shared.route === r) r.stop(); };
    s.onEnd(stop);
    return stop;
  }

  function prefs(fn) {
    const lists = {};
    const read = () => {
      const out = {};
      for (const [k, q] of Object.entries(QUERIES)) {
        try { out[k] = !!(lists[k] || (lists[k] = win.matchMedia?.(q)))?.matches; } catch { out[k] = false; }
      }
      // The person's profile turns reduced motion on even when the system does not.
      if (env.personal.reduceMotion) out.reducedMotion = true;
      return out;
    };
    const now = read();
    if (typeof fn === 'function' && s.alive()) {
      fn(now);
      for (const list of Object.values(lists)) if (list?.addEventListener) s.listen(list, 'change', () => fn(read()));
    }
    return now;
  }

  function byPerson(el, { withinMs = 1000 } = {}) {
    const last = shared.lastInput;
    if (!last || !el || Date.now() - last.at > withinMs) return false;
    return el === last.target || (typeof el.contains === 'function' && last.target && el.contains(last.target));
  }

  return { added, route, prefs, byPerson };
}
