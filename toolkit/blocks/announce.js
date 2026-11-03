// Block 6, announce: tell screen readers what changed.
//
// One polite and one assertive live region per page, shared by every
// adapter. Each message clears the region first and is written a moment
// later, so the same message twice is read twice. announce.batch() gathers
// messages under a key for a short window and says the last one, so ten
// paragraphs simplified at once is one announcement, not ten.
// The regions go when the last session that announced ends, so disable()
// leaves nothing behind.

import { UI_ATTR } from './shared.js';

const SR_ONLY = 'position:absolute!important;width:1px!important;height:1px!important;margin:-1px!important;padding:0!important;border:0!important;overflow:hidden!important;clip:rect(0 0 0 0)!important;clip-path:inset(50%)!important;white-space:nowrap!important;';

export function announcer(env) {
  const { doc, win, shared } = env;
  const batches = new Map();
  let batchTimer = null;

  function region(politeness) {
    let r = shared.liveRegions[politeness];
    if (r && r.isConnected) return { el: r, fresh: false };
    r = doc.createElement('div');
    r.setAttribute(UI_ATTR, 'ui');
    r.setAttribute('aria-live', politeness);
    r.setAttribute('aria-atomic', 'true');
    r.setAttribute('style', SR_ONLY);
    shared.ourNodes.add(r);
    (doc.body || doc.documentElement).appendChild(r);
    shared.liveRegions[politeness] = r;
    return { el: r, fresh: true };
  }

  // Messages that arrive while one is waiting to be written are said
  // together, in order: a later one never loses to an earlier timer. Shared,
  // because every adapter writes to the same region.
  const pending = shared.livePending || (shared.livePending = {});

  function announce(message, { politeness = 'polite', maxChars = 300 } = {}) {
    const text = String(message ?? '').replace(/\s+/g, ' ').trim().slice(0, maxChars);
    if (!text) return;
    const p = politeness === 'assertive' ? 'assertive' : 'polite';
    const { el, fresh } = region(p);
    if (pending[p]) { pending[p].text += ' ' + text; return; }
    el.textContent = '';
    // A region added to the page this moment is often missed by screen
    // readers: give it longer to be noticed.
    pending[p] = { text };
    win.setTimeout(() => {
      const entry = pending[p];
      delete pending[p];
      if (entry && el.isConnected) el.textContent = entry.text;
    }, fresh ? 250 : 60);
  }

  announce.batch = (key, message, { windowMs = 400, politeness = 'polite' } = {}) => {
    batches.set(key, { message, politeness });
    if (batchTimer) return;
    batchTimer = win.setTimeout(() => {
      batchTimer = null;
      const list = [...batches.values()];
      batches.clear();
      const assertive = list.some((b) => b.politeness === 'assertive');
      announce(list.map((b) => b.message).join(' '), { politeness: assertive ? 'assertive' : 'polite' });
    }, windowMs);
  };

  /** Take the regions out of the page (no session is using them). */
  announce.release = () => {
    for (const [k, el] of Object.entries(shared.liveRegions)) { el.remove(); delete shared.liveRegions[k]; }
    for (const k of Object.keys(pending)) delete pending[k];
    win.clearTimeout(batchTimer);
    batchTimer = null;
    batches.clear();
  };

  return announce;
}
