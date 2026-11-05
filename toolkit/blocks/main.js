// Part of block 4, page: where the main content is when the page does not say.
//
//   const main = await s.page.findMain()   // an element, or null
//
// What the page says comes first and costs nothing: its main landmark, or
// its one article (page.main()). Only where it says neither does the block
// look for candidates, from layout and the tree, never from names (ids and
// classes): the boxes that hold the page's running text (blocks of words
// that are not links or controls), outside its navigation, banner,
// contentinfo, complementary and search landmarks, its dialogs and its fixed
// layers. Then it asks the session's model which of them is the main content
// (ai.choose), once per page: every session in the page shares the answer.
// The model may say the page does not make it clear: then null, as with no
// candidates or no model, and the adapter does less.

import { isOurs } from './shared.js';
import { BLOCK, isChrome } from './page.js';

export const MAIN_QUESTION = "Which of these is the page's main content: what a person comes to this page to read or use, not its menus, sidebars, header or footer?";

// Text that is not running text: what a person activates or picks.
const NOT_RUNNING = 'a[href], button, label, summary, select, option, [role="link" i], [role="button" i], [role="menuitem" i], [role="tab" i], [role="option" i]';
// A block that is one paragraph, never a region of its own.
const PARAGRAPH_TAGS = /^(p|h[1-6]|li|dt|dd|blockquote|figcaption|caption|summary|address)$/i;

const PARAGRAPH = 60;   // characters of running text for a block to count as a paragraph
const MIN_TOTAL = 200;  // less running text than this in the whole page: nothing to find
const SHARE = 0.2;      // a candidate holds at least this share of the page's running text
const ONE_BLOCK = 500;  // ... in two paragraphs or more, or one block this long (an old table cell)
const TIGHT = 0.85;     // a box whose part holds this share of its text is that part
const MAX = 6;

/** The boxes that may be the main content, in document order: at most six. */
export function mainCandidates(env) {
  const { doc, win, page } = env;
  const body = doc.body;
  if (!body) return [];
  const blocked = new Map();
  const excluded = (el) => {
    if (!el || el === body || el === doc.documentElement) return false;
    if (blocked.has(el)) return blocked.get(el);
    let x = isOurs(el) || el.localName === 'dialog' || /^(dialog|alertdialog)$/i.test((el.getAttribute('role') || '').trim()) || isChrome(el);
    if (!x) { try { x = win.getComputedStyle(el).position === 'fixed'; } catch { x = false; } }
    if (!x) x = excluded(el.parentElement);
    blocked.set(el, x);
    return x;
  };
  const blockOf = (node) => {
    let b = node.parentElement;
    while (b && b !== body && !BLOCK.test(b.tagName)) b = b.parentElement;
    return b || body;
  };
  // Running text in each block.
  const own = new Map();
  for (const node of page.textNodes(body)) {
    const parent = node.parentElement;
    if (excluded(parent) || parent.closest(NOT_RUNNING)) continue;
    const n = node.nodeValue.replace(/\s+/g, ' ').trim().length;
    if (!n) continue;
    const b = blockOf(node);
    own.set(b, (own.get(b) || 0) + n);
  }
  const paragraphs = [...own].filter(([b, n]) => n >= PARAGRAPH && !/^h[1-6]$/i.test(b.tagName));
  const total = paragraphs.reduce((t, [, n]) => t + n, 0);
  if (total < MIN_TOTAL) return [];
  // What each box holds: its paragraphs' text, and how many.
  const held = new Map();
  for (const [b, n] of paragraphs) {
    for (let a = b; a && a !== body && a !== doc.documentElement; a = a.parentElement) {
      const h = held.get(a) || { text: 0, count: 0 };
      h.text += n; h.count++;
      held.set(a, h);
    }
  }
  let found = [...held].filter(([el, h]) => h.text >= SHARE * total && (h.count >= 2 || h.text >= ONE_BLOCK)
    && !PARAGRAPH_TAGS.test(el.tagName) && page.isVisible(el));
  // A box whose part holds nearly all its text is that part.
  found = found.filter(([el, h]) => !found.some(([d, dh]) => d !== el && el.contains(d) && dh.text >= TIGHT * h.text));
  return found.sort((a, b) => b[1].text - a[1].text).slice(0, MAX).map(([el]) => el)
    .sort((a, b) => (a.compareDocumentPosition(b) & 4 /* FOLLOWING */ ? -1 : 1));
}

const sameList = (a, b) => a.length === b.length && a.every((el, i) => el === b[i]);

/** findMain for one session: s.page.findMain(). */
export function findMainBlock(s, env) {
  const { doc, win, shared } = env;
  const said = () => {
    const m = env.page.main();
    return m && m !== doc.body && m !== doc.documentElement ? m : null;
  };
  return async function findMain() {
    if (!s.alive()) return null;
    const first = said();
    if (first) return first;
    if (!s.ai.available) return null;
    const options = mainCandidates(env);
    if (!options.length) return null;
    const href = String((win.location && win.location.href) || '');
    for (;;) {
      // One question per page and candidates, shared by every session in it.
      let asked = shared.mainAsked;
      if (!asked || asked.href !== href || !sameList(asked.options, options)) {
        const title = String(doc.title || '').replace(/\s+/g, ' ').trim().slice(0, 200);
        asked = { href, options, asker: s, answer: s.ai.choose(MAIN_QUESTION, options, title ? { context: `The page's title: "${title}"` } : {}) };
        shared.mainAsked = asked;
      }
      const el = await asked.answer;
      if (!s.alive()) return null;
      // The session that asked ended before the answer came: ask again.
      if (el === null && asked.asker !== s && !asked.asker.alive() && shared.mainAsked === asked) { shared.mainAsked = null; continue; }
      // The page (or another adapter) may have said meanwhile.
      return said() || (el && el.isConnected ? el : null);
    }
  };
}
