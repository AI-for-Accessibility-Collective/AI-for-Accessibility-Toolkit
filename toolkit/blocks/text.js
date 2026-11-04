// Block 10, text: change the page's text and put it back.
//
//   s.text.wrap(root, { match, build, cap })    wrap matching words in elements of your own
//   s.text.set(node, text)                      change one text node in place (translate-style)
//   s.text.replaceBlock(el, text, opts)         show new text in place of a block, with "Show original"
//   s.text.scale(factor)                        the page's text at factor (1.5 is 150%), px-sized text too
//   s.text.fit(() => s.css('spacing', rules))   make a change to text, and grow only the boxes it now cuts off
//
// text.scale is the text size alone, for when the browser's zoom is not
// the method (s.zoom.method()). It measures every element that holds text
// before it writes any, and sizes each from its own original size, so a
// second call with a new factor never compounds, and 1 puts the page's
// sizes back. Line heights the page set in pixels keep their proportion
// (the person's line spacing, a stylesheet with !important, still wins).
// A box with a fixed height that now cuts its text off grows instead.
// Text added later is sized as it arrives, and the page's sizes are
// measured again when the window's width changes (its breakpoints).
//
// text.fit is the same care for any change to text (line or letter
// spacing): it measures the boxes around the page's text, runs the change,
// and grows only the boxes that the change made cut their text off. Boxes
// that cut text off before, by the page's design, stay as they are.
//
// The original text nodes come back on end(), the same node objects. Text in
// code, form fields, live regions, hidden content and the toolkit's own UI is
// never changed (page.textNodes decides). The person can always see the
// original of a replaced block.

import { resolveConfig, UI_ATTR } from './shared.js';

export const WRAP_DEFAULTS = { cap: 500, skip: '' };
export const REPLACE_DEFAULTS = { showOriginal: true, label: 'Simplified', originalLabel: 'Show original', replacedLabel: 'Show simplified' };

const toRegExp = (match) => {
  if (match instanceof RegExp) return new RegExp(match.source, match.flags.includes('g') ? match.flags : match.flags + 'g');
  if (typeof match === 'string' && match) return new RegExp(match, 'gu');
  throw new Error('text.wrap needs `match`: a regular expression, or its source as a string.');
};

export function textBlock(s, env) {
  const { doc } = env;

  function wrap(root, opts = {}) {
    const c = resolveConfig(WRAP_DEFAULTS, opts, env.personal, {});
    if (!s.alive() || !root) return 0;
    const re = toRegExp(c.match);
    const build = typeof c.build === 'function' ? c.build : (word) => { const span = doc.createElement('span'); span.textContent = word; return span; };
    let count = 0;
    for (const node of env.page.textNodes(root, { skip: c.skip, includeReplaced: false })) {
      if (count >= c.cap) break;
      const text = node.nodeValue;
      re.lastIndex = 0;
      if (!re.test(text)) continue;
      re.lastIndex = 0;
      const wrapper = doc.createElement('span');
      wrapper.setAttribute('data-ai4a11y-text', s.id);
      let last = 0;
      for (const m of text.matchAll(re)) {
        if (!m[0] || count >= c.cap) break;
        if (m.index > last) wrapper.append(text.slice(last, m.index));
        const made = build(m[0], m);
        wrapper.append(made && made.nodeType ? made : m[0]);
        last = m.index + m[0].length;
        count++;
      }
      if (last < text.length) wrapper.append(text.slice(last));
      s.replace(node, wrapper);
    }
    if (count) s.css('text-wrap', `[data-ai4a11y-text="${s.id}"] { all: unset; display: inline; }`);
    return count;
  }

  function set(node, text) {
    if (!node || node.nodeType !== 3) return;
    s.setText(node, text);
  }

  function replaceBlock(el, text, opts = {}) {
    const c = resolveConfig(REPLACE_DEFAULTS, opts, env.personal, {});
    if (!s.alive() || !el || !el.parentNode || text === null || text === undefined || !String(text).trim()) return null;
    const box = s.el('div', { kind: 'content', attrs: { 'data-ai4a11y-replaced': s.id } });
    const inner = doc.createElement('div');
    for (const para of String(text).split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)) {
      const p = doc.createElement('p');
      p.textContent = para;
      inner.append(p);
    }
    box.append(inner);
    s.setAttr(el, 'hidden', '');
    s.insert(el.parentNode, box, el.nextSibling);
    let showingOriginal = false;
    let button = null;
    if (c.showOriginal) {
      const bar = s.el('div', { attrs: { class: 'ai4a11y-replaced-bar' } });
      // Its label says what it does next; no aria-pressed, which would
      // contradict a label that changes.
      button = s.el('button', { text: c.originalLabel, attrs: { type: 'button' } });
      bar.append(button);
      s.insert(box.parentNode, bar, box.nextSibling);
      s.listen(button, 'click', () => toggle());
      s.css('replace-block', `[data-ai4a11y-replaced] > div > p { margin: 0 0 .75em; }
.ai4a11y-replaced-bar { margin: 4px 0 12px; }
.ai4a11y-replaced-bar button { font: inherit; font-size: max(1em, 16px); min-height: 32px; padding: 2px 10px; cursor: pointer; }`);
    }
    function toggle(original = !showingOriginal) {
      if (!s.alive()) return;
      showingOriginal = original;
      if (original) { el.removeAttribute('hidden'); box.hidden = true; } else { el.setAttribute('hidden', ''); box.hidden = false; }
      env.shared.ourAttrs.set(el, new Map([...(env.shared.ourAttrs.get(el) || []), ['hidden', el.getAttribute('hidden')]]));
      if (button) button.textContent = original ? c.replacedLabel : c.originalLabel;
    }
    // end() puts `hidden` back only if it still holds what this block wrote.
    s.onEnd(() => { if (showingOriginal) el.setAttribute('hidden', ''); });
    return { el: box, original: el, toggle, get showingOriginal() { return showingOriginal; } };
  }

  // text.scale: one per session; what it wrote is in its own group.
  let scaling = null;
  const SKIP_SCALE = /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|SVG|MATH|CANVAS|IFRAME|OBJECT|VIDEO|AUDIO|IMG)$/;
  const FIELDS = 'input, select, textarea, button';

  // The elements under root that hold text of their own, and form fields.
  function carriers(root) {
    const out = new Set();
    if (!root || root.nodeType !== 1) return out;
    const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!el || out.has(el) || !n.nodeValue.trim() || SKIP_SCALE.test(el.tagName) || env.page.isOurs(el)) continue;
      out.add(el);
    }
    if (root.matches && root.matches(FIELDS) && !env.page.isOurs(root)) out.add(root);
    for (const f of root.querySelectorAll ? root.querySelectorAll(FIELDS) : []) if (!env.page.isOurs(f)) out.add(f);
    return out;
  }

  function scale(factor) {
    if (!s.alive()) return 0;
    const f = Math.max(0.5, Math.min(4, Number(factor) || 1));
    if (!scaling) scaling = { factor: 1, group: null, orig: new WeakMap(), sized: new Set(), clipped: new WeakSet(), width: env.win.innerWidth, watching: false };
    const st = scaling;
    st.factor = f;
    if (f === 1) {
      if (st.group) st.group.end();
      st.group = null;
      st.sized.clear();
      st.clipped = new WeakSet();
      return 0;
    }
    st.group ||= s.group();
    const n = apply([...carriers(doc.body)]);
    if (!st.watching) {
      st.watching = true;
      s.watch.added(null, (el) => { if (st.group && st.factor !== 1) apply([...carriers(el)], true); }, { debounceMs: 150 });
      s.listen(env.win, 'resize', () => {
        if (!st.group || Math.abs(env.win.innerWidth - st.width) < 1) return;
        st.width = env.win.innerWidth;
        // The page's own sizes at the new width, then the factor again.
        const keep = st.factor;
        scale(1);
        scaling.orig = new WeakMap();
        scale(keep);
      });
    }
    return n;
  }

  function apply(list, late = false) {
    const st = scaling;
    const g = st.group;
    const win = env.win;
    const fresh = list.filter((el) => !st.orig.has(el));
    // Text that arrives inside sized text inherits the size already: measure
    // it against its sized ancestors' original sizes, put back for a moment.
    const lifted = [];
    if (late && fresh.length) {
      for (const el of fresh) {
        for (let a = el.parentElement; a; a = a.parentElement) {
          if (st.sized.has(a) && !lifted.includes(a)) { lifted.push(a); break; }
        }
      }
      for (const a of lifted) a.style.setProperty('font-size', `${st.orig.get(a).size}px`, 'important');
    }
    // Every read before any write, of the page's own size and line height:
    // the toolkit's stylesheets (a spacing sheet) are off while it reads.
    const sheetsOff = [...doc.querySelectorAll(`style[${UI_ATTR}]`)].map((x) => x.sheet).filter((sh) => sh && !sh.disabled);
    for (const sh of sheetsOff) sh.disabled = true;
    try {
      for (const el of fresh) {
        const cs = win.getComputedStyle(el);
        const size = parseFloat(cs.fontSize);
        if (!(size > 0)) continue;
        const lh = cs.lineHeight;
        const ratio = /px$/.test(lh) ? parseFloat(lh) / size : null;
        st.orig.set(el, { size, ratio });
      }
    } finally {
      for (const sh of sheetsOff) sh.disabled = false;
    }
    // All of them: a new factor can make a box cut off what the last one did not.
    const wasClipped = clippedNow(list);
    for (const a of lifted) a.style.setProperty('font-size', `${Math.round(st.orig.get(a).size * st.factor * 100) / 100}px`, 'important');
    let n = 0;
    for (const el of list) {
      const o = st.orig.get(el);
      if (!o || !el.isConnected) continue;
      const px = Math.round(o.size * st.factor * 100) / 100;
      g.setStyle(el, 'font-size', `${px}px`, 'important');
      if (o.ratio) g.setStyle(el, 'line-height', String(Math.round(o.ratio * 1000) / 1000));
      st.sized.add(el);
      n++;
    }
    grow(wasClipped, g, st.clipped);
    return n;
  }

  // The boxes around these elements' text (three levels up), and whether
  // each cuts its content off now.
  function clippedNow(carriersList) {
    const boxes = new Map();
    for (const el of carriersList) {
      for (let b = el, i = 0; b && i < 3 && b !== doc.body; b = b.parentElement, i++) if (!boxes.has(b)) boxes.set(b, false);
    }
    for (const b of boxes.keys()) boxes.set(b, b.scrollHeight > b.clientHeight + 1);
    return boxes;
  }

  // A box with a fixed height that cuts text off now, and did not before, grows to fit it.
  function grow(before, into, done) {
    let n = 0;
    for (const [b, was] of before) {
      if (was || done.has(b) || !b.isConnected || !(b.scrollHeight > b.clientHeight + 1)) continue;
      const cs = env.win.getComputedStyle(b);
      if (cs.display === 'inline' || /^(auto|scroll)$/.test(cs.overflowY)) continue;
      done.add(b);
      if (cs.height !== 'auto') { into.setStyle(b, 'min-height', cs.height); into.setStyle(b, 'height', 'auto', 'important'); }
      if (cs.maxHeight !== 'none') into.setStyle(b, 'max-height', 'none', 'important');
      n++;
    }
    return n;
  }

  const grown = new WeakSet();
  function fit(change, { root } = {}) {
    if (!s.alive() || typeof change !== 'function') return 0;
    const before = clippedNow([...carriers(root || doc.body)]);
    change();
    return grow(before, s, grown);
  }

  return { wrap, set, replaceBlock, scale, fit, nodes: (root, opts) => env.page.textNodes(root, opts) };
}
