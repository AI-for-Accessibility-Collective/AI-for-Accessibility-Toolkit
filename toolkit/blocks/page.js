// Block 4, page: read what is on the page. Nothing here changes it.
//
//   page.main()                     the main content region
//   page.readableText(el, opts)     the text a person reads, without code, fields or hidden text
//   page.textNodes(el, opts)        the text nodes behind it
//   page.headings({ maxLevel })     visible headings with their levels
//   page.nameOf(el)                 accessible name; never a field's typed value
//   page.find(name, opts)           the control whose name best matches
//   page.isVisible(el), page.isOurs(el)
//   page.background(el), page.contrast(a, b)

import { isOurs, hasLayout, UI_ATTR } from './shared.js';
import { backgroundOf, contrast, parseColor, nearestWithContrast, hex } from './color.js';

// Never read or rewritten: code, form fields, live regions (the page speaks
// through them), and the toolkit's own controls.
export const SKIP_SELECTOR = [
  'script', 'style', 'noscript', 'template', 'svg', 'math', 'canvas', 'iframe', 'object',
  'textarea', 'input', 'select', 'option', 'code', 'pre', 'kbd', 'samp', 'var',
  '[contenteditable=""]', '[contenteditable="true"]', '[aria-live]',
  '[role="status"]', '[role="alert"]', '[role="log"]', '[role="timer"]', '[role="marquee"]',
  `[${UI_ATTR}="ui"]`,
].join(', ');

const BLOCK = /^(address|article|aside|blockquote|dd|div|dl|dt|figcaption|figure|footer|h[1-6]|header|hr|li|main|nav|ol|p|section|table|td|th|tr|ul|br|summary|details)$/i;

const INTERACTIVE = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="link"], [role="menuitem"], [role="tab"], [role="checkbox"], [role="radio"], [role="switch"], [role="option"], [tabindex]:not([tabindex="-1"])';

const NAME_FROM_CONTENT = /^(a|button|summary|h[1-6]|label|legend|caption|figcaption|option|td|th|li|dt)$/i;
const CONTENT_ROLES = new Set(['button', 'link', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab', 'checkbox', 'radio', 'switch', 'option', 'treeitem', 'cell', 'columnheader', 'rowheader', 'heading', 'tooltip']);

const squash = (t) => String(t || '').replace(/\s+/g, ' ').trim();

export function pageBlock(env) {
  const { doc, win } = env;
  const layout = () => hasLayout(doc);

  function isVisible(el) {
    if (!el || el.nodeType !== 1 || !el.isConnected) return false;
    if (el.closest('[hidden]')) return false;
    const style = win.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) return false;
    if (!layout()) return true;
    if (typeof el.checkVisibility === 'function' && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function main() {
    const visible = (list) => [...list].filter((el) => isVisible(el) && !isOurs(el));
    const marked = visible(doc.querySelectorAll('main, [role="main" i]'));
    if (marked.length) return marked[0];
    const articles = visible(doc.querySelectorAll('article'));
    if (articles.length) return articles.sort((a, b) => b.textContent.length - a.textContent.length)[0];
    return visible(doc.querySelectorAll('#main, #content, .content'))[0] || doc.body || doc.documentElement;
  }

  /** The readable text nodes under root, in order. With `includeReplaced`
   *  (the default), text a block put in place of the page's counts. */
  function textNodes(root, { skip = '', includeReplaced = true } = {}) {
    const out = [];
    if (!root) return out;
    const skipSel = skip ? `${SKIP_SELECTOR}, ${skip}` : SKIP_SELECTOR;
    const hiddenCache = new Map();
    const hidden = (el) => {
      if (hiddenCache.has(el)) return hiddenCache.get(el);
      let h = false;
      if (el.matches(skipSel) || el.hidden || el.getAttribute('aria-hidden') === 'true') h = true;
      else if (el.getAttribute(UI_ATTR) === 'content' && !includeReplaced) h = true;
      else { const st = win.getComputedStyle(el); h = st.display === 'none' || st.visibility === 'hidden'; }
      if (!h && el.parentElement && el !== root) h = hidden(el.parentElement);
      hiddenCache.set(el, h);
      return h;
    };
    const walker = doc.createTreeWalker(root, 4 /* SHOW_TEXT */);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.nodeValue.trim()) continue;
      const parent = n.parentElement;
      if (!parent || hidden(parent)) continue;
      out.push(n);
    }
    return out;
  }

  function readableText(root, { blockPause = '\n', skip = '', includeReplaced = true } = {}) {
    let text = '';
    let lastBlock = null;
    for (const node of textNodes(root, { skip, includeReplaced })) {
      let block = node.parentElement;
      while (block && block !== root && !BLOCK.test(block.tagName)) block = block.parentElement;
      if (text && block !== lastBlock) text = text.replace(/\s+$/, '') + blockPause;
      lastBlock = block;
      text += node.nodeValue.replace(/\s+/g, ' ');
    }
    return text.replace(/[ \t]+/g, ' ').trim();
  }

  function headings({ maxLevel = 6, root = doc.body } = {}) {
    const out = [];
    if (!root) return out;
    for (const el of root.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading" i]')) {
      if (isOurs(el) || !isVisible(el) || el.closest('[aria-hidden="true"]')) continue;
      // role presentation or none takes a heading's role away.
      if (/^(presentation|none)$/i.test((el.getAttribute('role') || '').trim())) continue;
      const aria = parseInt(el.getAttribute('aria-level'), 10);
      const level = /^H[1-6]$/.test(el.tagName) && !el.hasAttribute('aria-level') ? +el.tagName[1] : (aria >= 1 ? aria : 2);
      if (level > maxLevel) continue;
      out.push({ el, level, text: nameOf(el) });
    }
    return out;
  }

  // Text from content, without what a field holds and without hidden parts.
  function contentText(el) {
    let t = '';
    for (const n of el.childNodes) {
      if (n.nodeType === 3) t += n.nodeValue;
      else if (n.nodeType === 1) {
        if (n.hidden || n.getAttribute('aria-hidden') === 'true' || /^(script|style|template|input|textarea|select)$/i.test(n.tagName)) continue;
        if (n.tagName === 'IMG') t += ' ' + (n.getAttribute('alt') || '') + ' ';
        else t += ' ' + contentText(n) + ' ';
      }
    }
    return t;
  }

  function labelledBy(el) {
    const ids = (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
    return ids.map((id) => doc.getElementById(id)).filter(Boolean)
      .map((ref) => squash(ref.getAttribute('aria-label')) || squash(contentText(ref)) || squash(ref.getAttribute('title'))).join(' ');
  }

  function labelFor(el) {
    const labels = el.labels ? [...el.labels] : [];
    if (!labels.length && el.id) labels.push(...doc.querySelectorAll(`label[for="${CSS_escape(el.id)}"]`));
    const wrap = el.closest('label');
    if (wrap && !labels.includes(wrap)) labels.push(wrap);
    return labels.map((l) => squash(contentText(l))).filter(Boolean).join(' ');
  }

  /** The accessible name, close to the ARIA name computation. A field's
   *  typed value is never its name: only a button-type input's value is. */
  function nameOf(el) {
    if (!el || el.nodeType !== 1) return '';
    const tag = el.tagName;
    const type = (el.getAttribute('type') || '').toLowerCase();
    const isField = /^(INPUT|TEXTAREA|SELECT)$/.test(tag);
    const role = (el.getAttribute('role') || '').toLowerCase().split(/\s+/)[0];
    const candidates = [
      labelledBy(el),
      el.getAttribute('aria-label'),
      tag === 'IMG' || (tag === 'INPUT' && type === 'image') || tag === 'AREA' ? el.getAttribute('alt') : '',
      isField ? labelFor(el) : '',
      tag === 'INPUT' && /^(button|submit|reset)$/.test(type) ? el.getAttribute('value') : '',
      NAME_FROM_CONTENT.test(tag) || CONTENT_ROLES.has(role) ? contentText(el) : '',
      tag === 'FIELDSET' ? el.querySelector('legend')?.textContent : '',
      tag === 'TABLE' ? el.querySelector('caption')?.textContent : '',
      el.getAttribute('title'),
      isField ? el.getAttribute('placeholder') : '',
      tag === 'INPUT' && type === 'submit' ? 'Submit' : tag === 'INPUT' && type === 'reset' ? 'Reset' : '',
    ];
    return candidates.map(squash).find(Boolean) || '';
  }

  /** The visible control whose name best matches: exact, then starts with, then contains. */
  function find(name, { within = doc.body, selector = INTERACTIVE } = {}) {
    const want = squash(name).toLowerCase();
    if (!want || !within) return null;
    let best = null, bestScore = 0;
    for (const el of within.querySelectorAll(selector)) {
      if (isOurs(el) || !isVisible(el)) continue;
      const have = nameOf(el).toLowerCase();
      if (!have) continue;
      const score = have === want ? 3 : have.startsWith(want) ? 2 : have.includes(want) ? 1 : 0;
      if (score > bestScore) { best = el; bestScore = score; if (score === 3) break; }
    }
    return best;
  }

  // The contrast of an element's text against what it is drawn on (WCAG
  // 1.4.3), and the nearest colour of its hue that would be enough. Layers
  // of see-through backgrounds are blended; over an image or a gradient the
  // background cannot be known, so there is no fix.
  function textContrast(el) {
    const cs = win.getComputedStyle(el);
    const layers = [];
    let overImage = false;
    // An ancestor's background counts only where the text is drawn on it: a
    // positioned child can sit outside its parent's box.
    const box = layout() ? el.getBoundingClientRect() : null;
    const cx = box && box.left + box.width / 2, cy = box && box.top + box.height / 2;
    const under = (n) => {
      if (!box || n === el || !(box.width || box.height)) return true;
      const r = n.getBoundingClientRect();
      return cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom;
    };
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      if (!under(n)) continue;
      const ns = n === el ? cs : win.getComputedStyle(n);
      const c = parseColor(ns.backgroundColor);
      // A background image is drawn over the element's own colour.
      if (ns.backgroundImage && ns.backgroundImage !== 'none') { overImage = true; break; }
      if (c && c[3] > 0) layers.push(c);
      if (c && c[3] >= 0.999) break;
    }
    let bg = [255, 255, 255];
    for (const [r, g, b, a] of layers.reverse()) bg = [r * a + bg[0] * (1 - a), g * a + bg[1] * (1 - a), b * a + bg[2] * (1 - a)];
    const c = parseColor(cs.color) || [0, 0, 0, 1];
    const fg = [0, 1, 2].map((i) => c[i] * c[3] + bg[i] * (1 - c[3]));
    const size = parseFloat(cs.fontSize) || 16;
    const large = size >= 24 || (size >= 18.66 && (parseInt(cs.fontWeight, 10) || 400) >= 700);
    const min = large ? 3 : 4.5;
    const ratio = Math.round(contrast(fg, bg) * 100) / 100;
    const fix = overImage || ratio >= min ? null : hex(nearestWithContrast(fg, bg, min + 0.05));
    return { color: hex(fg), background: hex(bg), ratio, min, large, overImage, fix };
  }

  return {
    main, textNodes, readableText, headings, nameOf, find, isVisible,
    isOurs: (el) => isOurs(el),
    background: (el) => backgroundOf(el, win),
    contrast,
    textContrast,
  };
}

function CSS_escape(s) {
  return String(s).replace(/["\\]/g, '\\$&');
}
