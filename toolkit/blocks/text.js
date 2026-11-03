// Block 10, text: change the page's text and put it back.
//
//   s.text.wrap(root, { match, build, cap })    wrap matching words in elements of your own
//   s.text.set(node, text)                      change one text node in place (translate-style)
//   s.text.replaceBlock(el, text, opts)         show new text in place of a block, with "Show original"
//
// The original text nodes come back on end(), the same node objects. Text in
// code, form fields, live regions, hidden content and the toolkit's own UI is
// never changed (page.textNodes decides). The person can always see the
// original of a replaced block.

import { resolveConfig } from './shared.js';

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
.ai4a11y-replaced-bar button { font: inherit; font-size: .9em; min-height: 32px; padding: 2px 10px; cursor: pointer; }`);
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

  return { wrap, set, replaceBlock, nodes: (root, opts) => env.page.textNodes(root, opts) };
}
