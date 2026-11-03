// What the blocks share between adapters in one page, and small helpers every
// block uses.
//
// One live region, one voice, one page filter and one record of what the
// person last touched serve every adapter on the page. The state lives on the
// window: in the browser runtime that is the USER_SCRIPT world all adapters
// share, so two adapters see the same state even when each one's script
// brought its own copy of this code.

const KEY = '__ai4a11yBlocksShared';

/** Marks the toolkit's own elements. "ui" for controls, tooltips and panels;
 *  "content" for text a block put in place of the page's (a simplified
 *  paragraph), which readers still read but watchers ignore. */
export const UI_ATTR = 'data-ai4a11y-ui';

export function sharedState(win) {
  if (!win[KEY]) {
    Object.defineProperty(win, KEY, {
      configurable: true,
      value: {
        nextId: 1,
        // Nodes and values the blocks wrote, so watchers never react to them.
        ourNodes: new WeakSet(),
        ourAttrs: new WeakMap(),   // element -> Map(attribute -> value written)
        ourText: new WeakMap(),    // text node -> value written
        liveRegions: {},           // politeness -> element
        liveUsers: new Set(),      // sessions that announced and are still open
        voice: null,               // the utterance speaking now, page-wide
        filters: new Map(),        // `${session}:${name}` -> CSS filter value
        cache: new Map(),          // AI answers for this page
        lastInput: null,           // {target, at}: the person's last click or key
        inputWatch: false,
        route: null,               // {listeners, stop}
        adjusters: new Map(),      // adapter key -> what the toolkit's shortcut adjusts (keys.adjust)
        shortcut: null,            // the person's shortcut here, when they gave it to an adapter
      },
    });
  }
  return win[KEY];
}

/** Whether a node is inside the toolkit's own UI. Text a block put in place
 *  of the page's ("content") counts too: watchers and walkers skip it. */
export function isOurs(node) {
  const el = node && (node.nodeType === 1 ? node : node.parentElement);
  return !!(el && el.closest && el.closest(`[${UI_ATTR}]`));
}

/** Each value comes from the block's default, then the builder's config,
 *  then the person's profile for the personal ones: what the builder sets is
 *  a default the person's own settings override. `personalKeys` maps a
 *  config key to its name in `personal` ({ rate: 'speechRate' }). */
export function resolveConfig(defaults, builder, personal, personalKeys = {}) {
  const out = { ...defaults };
  for (const [k, v] of Object.entries(builder || {})) if (v !== undefined) out[k] = v;
  for (const [k, p] of Object.entries(personalKeys)) {
    const v = personal && personal[p];
    if (v !== undefined && v !== null) out[k] = v;
  }
  return out;
}

/** Reduced motion: the system setting or the person's profile. */
export function reducedMotion(env) {
  if (env.personal && env.personal.motionReducer) return true;
  try { return !!env.win.matchMedia?.('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

/** Whether the document has layout (a real browser, not jsdom). */
export const hasLayout = (doc) => !!(doc.documentElement && doc.documentElement.clientWidth > 0);

/** CSS property name from camelCase or kebab-case. */
export const cssName = (prop) => (prop.startsWith('--') ? prop : prop.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase()));

/** A short, id-safe slug. */
export const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'adapter';
