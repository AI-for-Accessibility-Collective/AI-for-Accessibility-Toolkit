// Block 16, profile: the person's settings on this site, and recording a
// change they make in the adapter.
//
//   s.profile.get()                       their settings here (= toolkit.personal, kept current)
//   s.profile.get('fontScale')
//   await s.profile.set({ fontScale: 150 })                    for this site (the default)
//   await s.profile.set({ fontScale: 150 }, { scope: 'all' })  for every site
//   s.profile.onChange((personal, changed) => ...)
//   s.profile.need('toolkit/bigger-targets')  a registered need's value, or undefined when they do not have it
//
// set() records what the person chose in their toolkit profile, so it
// follows them to other pages and devices and wins over what the toolkit
// derived from their needs. Only the person can change it: set() works only
// right after their own click, tap or key on the toolkit's UI in this page
// (a panel or button an adapter added) or their shortcut (keys.adjust), never
// from the adapter alone. The change applies in this page at once, for every
// adapter, whether or not it could be saved. Only settings can be set
// (SETTABLE_KEYS), checked and kept in range.

import { isOurs } from './shared.js';
import { SETTABLE_KEYS, personalFromSettings } from './personal-sites.js';

/** How recent the person's own input must be for set() to count as theirs. */
export const PERSON_MS = 5000;

export function profileBlock(s, env) {
  const { shared } = env;
  if (!shared.personalListeners) shared.personalListeners = new Set();

  function get(key) {
    const p = env.personal;
    return key === undefined ? p : p[key];
  }

  /** A need an adapter or app registered ("<appId>/<id>"): its value when the person has it. */
  function need(key) {
    const n = env.personal.needs;
    return n && Object.hasOwn(n, key) ? n[key] : undefined;
  }

  /** Whether the person just used the toolkit's UI or their shortcut. */
  function byPerson() {
    const now = Date.now();
    const last = shared.lastInput;
    if (last && now - last.at <= PERSON_MS && isOurs(last.target)) return true;
    return !!shared.lastShortcut && now - shared.lastShortcut <= PERSON_MS;
  }

  async function set(changes, { scope = 'site' } = {}) {
    if (!s.alive()) return { applied: false, saved: false, reason: 'ended' };
    const wanted = Object.fromEntries(Object.entries(changes || {}).filter(([k]) => SETTABLE_KEYS.includes(k)));
    const clean = personalFromSettings(wanted, { keepOff: true });
    if (!Object.keys(clean).length) return { applied: false, saved: false, reason: 'nothing-settable' };
    if (!byPerson()) return { applied: false, saved: false, reason: 'not-by-person' };
    // In this page at once, for every adapter in it.
    shared.personalOverrides = { ...(shared.personalOverrides || {}), ...clean };
    const now = env.personal;
    for (const fn of [...shared.personalListeners]) { try { fn(now, clean); } catch { /* one listener's error */ } }
    if (!env.transport.profile) return { applied: true, saved: false, reason: 'unavailable' };
    try {
      const r = await env.transport.profile({ op: 'set', changes: clean, scope: scope === 'all' ? 'all' : 'site' });
      return { applied: true, saved: !!(r && r.saved), ...(r && r.reason ? { reason: r.reason } : {}) };
    } catch {
      return { applied: true, saved: false, reason: 'unavailable' };
    }
  }

  function onChange(fn) {
    if (!s.alive() || typeof fn !== 'function') return () => {};
    const h = (p, changed) => { if (s.alive()) fn(p, changed); };
    shared.personalListeners.add(h);
    const stop = () => shared.personalListeners.delete(h);
    s.onEnd(stop);
    return stop;
  }

  return { get, set, onChange, need, keys: SETTABLE_KEYS };
}
