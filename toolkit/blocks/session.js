// Block 1, session: every change an adapter makes, undone by one call.
//
// enable() opens a session, every other block is made from it, and disable()
// is s.end(). The session records each change and undoes them in reverse. It
// puts a value back only if the page has not changed it since (restore
// "unless-changed"): a page that set its own value meanwhile keeps it. Every
// callback a block runs checks that its session is still open, and every
// change after end() is a no-op, so a late answer (an AI reply, a timer)
// never writes to the page after disable().

import { UI_ATTR, cssName, slug } from './shared.js';
import { stylesBlock } from './styles.js';
import { watchBlock } from './watch.js';
import { highlightBlock } from './highlight.js';
import { tooltipBlock } from './tooltip.js';
import { panelBlock } from './panel.js';
import { focusBlock, keysBlock } from './focus.js';
import { textBlock } from './text.js';
import { aiBlock } from './ai.js';
import { speechBlock } from './speech.js';
import { mediaBlock } from './media.js';

/** What s.guard() throws when the session ended while it waited. */
export class Ended extends Error {
  constructor() { super('The session ended.'); this.name = 'Ended'; }
}

export function createSession(env, config = {}) {
  const always = config.restore === 'always';
  const undo = [];
  let open = true;
  const { shared } = env;
  const id = `${slug(env.adapter)}-${shared.nextId++}`;

  // Put an attribute back where it was in the element's list, so the page
  // serializes exactly as before (an attribute set again goes last).
  const restoreAttr = (el, name, value, index) => {
    const later = [...el.attributes].slice(index).filter((a) => a.name !== name).map((a) => [a.name, a.value]);
    for (const [n] of later) el.removeAttribute(n);
    el.setAttribute(name, value);
    for (const [n, v] of later) el.setAttribute(n, v);
  };

  const noteAttr = (el, name, value) => {
    let m = shared.ourAttrs.get(el);
    if (!m) shared.ourAttrs.set(el, (m = new Map()));
    m.set(name, value);
  };

  const s = {
    id,
    get ended() { return !open; },
    alive: () => open,
    personal: env.personal,

    /** Run fn on end(), in reverse order with the rest. */
    onEnd(fn) { if (open) undo.push(fn); },

    setAttr(el, name, value) {
      if (!open || !el) return;
      const had = el.hasAttribute(name);
      const before = el.getAttribute(name);
      const index = [...el.attributes].findIndex((a) => a.name === name);
      const next = value === null || value === undefined || value === false ? null : String(value);
      if (next === null) el.removeAttribute(name); else el.setAttribute(name, next);
      noteAttr(el, name, next);
      undo.push(() => {
        if (!always && el.getAttribute(name) !== next) return;
        if (!had) el.removeAttribute(name);
        else if (el.hasAttribute(name)) el.setAttribute(name, before);
        else restoreAttr(el, name, before, index);
        noteAttr(el, name, had ? before : null);
      });
    },

    setStyle(el, prop, value, priority = '') {
      if (!open || !el || !el.style) return;
      const p = cssName(prop);
      const hadAttr = el.hasAttribute('style');
      const beforeAttr = el.getAttribute('style');
      const before = el.style.getPropertyValue(p);
      const beforePriority = el.style.getPropertyPriority(p);
      el.style.setProperty(p, value, priority);
      const set = el.style.getPropertyValue(p);
      noteAttr(el, 'style', el.getAttribute('style'));
      undo.push(() => {
        if (!always && el.style.getPropertyValue(p) !== set) return;
        if (before) el.style.setProperty(p, before, beforePriority); else el.style.removeProperty(p);
        if (!hadAttr && !el.getAttribute('style')) el.removeAttribute('style');
        else if (hadAttr) {
          // The same declarations as before: put the page's own text back.
          const probe = env.doc.createElement('div');
          probe.setAttribute('style', beforeAttr);
          if (probe.style.cssText === el.style.cssText) el.setAttribute('style', beforeAttr);
        }
        noteAttr(el, 'style', el.getAttribute('style'));
      });
    },

    addClass(el, ...names) {
      if (!open || !el) return;
      for (const name of names) {
        if (!name || el.classList.contains(name)) continue;
        el.classList.add(name);
        noteAttr(el, 'class', el.getAttribute('class'));
        undo.push(() => {
          el.classList.remove(name);
          if (!el.getAttribute('class')) el.removeAttribute('class');
        });
      }
    },

    /** Put `node` into `parent` before `before` (or last); it goes on end(). */
    insert(parent, node, before = null) {
      if (!open || !parent || !node) return node;
      parent.insertBefore(node, before && before.parentNode === parent ? before : null);
      shared.ourNodes.add(node);
      undo.push(() => { if (node.parentNode) node.parentNode.removeChild(node); });
      return node;
    },
    append(parent, node) { return s.insert(parent, node, null); },

    /** Swap a page node for a new one; the same old node comes back on end(). */
    replace(oldNode, newNode) {
      if (!open || !oldNode || !oldNode.parentNode) return newNode;
      oldNode.parentNode.replaceChild(newNode, oldNode);
      shared.ourNodes.add(newNode);
      undo.push(() => { if (newNode.parentNode) newNode.parentNode.replaceChild(oldNode, newNode); });
      return newNode;
    },

    /** Take a node out of the page; it goes back where it was on end(). */
    remove(node) {
      if (!open || !node || !node.parentNode) return;
      const parent = node.parentNode;
      const next = node.nextSibling;
      parent.removeChild(node);
      undo.push(() => {
        if (node.parentNode) return;
        parent.insertBefore(node, next && next.parentNode === parent ? next : null);
      });
    },

    /** Change a text node's text; the original comes back unless the page changed it since. */
    setText(node, text) {
      if (!open || !node) return;
      const before = node.nodeValue;
      const next = String(text);
      node.nodeValue = next;
      shared.ourText.set(node, next);
      undo.push(() => { if (always || node.nodeValue === next) node.nodeValue = before; });
    },

    listen(target, type, fn, options) {
      if (!open || !target) return () => {};
      const handler = (e) => { if (open) fn(e); };
      target.addEventListener(type, handler, options);
      const capture = typeof options === 'boolean' ? options : !!(options && options.capture);
      const off = () => target.removeEventListener(type, handler, capture);
      undo.push(off);
      return off;
    },

    timer(fn, ms = 0) {
      if (!open) return 0;
      const t = env.win.setTimeout(() => { if (open) fn(); }, ms);
      undo.push(() => env.win.clearTimeout(t));
      return t;
    },
    every(fn, ms) {
      if (!open) return 0;
      const t = env.win.setInterval(() => { if (open) fn(); }, ms);
      undo.push(() => env.win.clearInterval(t));
      return t;
    },
    frame(fn) {
      if (!open) return;
      const raf = env.win.requestAnimationFrame ? env.win.requestAnimationFrame.bind(env.win) : (f) => env.win.setTimeout(f, 16);
      raf(() => { if (open) fn(); });
    },

    /** Await a promise of your own; throws Ended if the session ended meanwhile. */
    guard(promise) {
      return Promise.resolve(promise).then(
        (v) => { if (!open) throw new Ended(); return v; },
        (e) => { if (!open) throw new Ended(); throw e; });
    },

    /** A new element marked as the toolkit's own UI (not yet in the page). */
    el(tag, { text, attrs, kind = 'ui' } = {}) {
      const node = env.doc.createElement(tag);
      node.setAttribute(UI_ATTR, kind);
      if (text !== undefined) node.textContent = String(text);
      for (const [k, v] of Object.entries(attrs || {})) if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v === true ? '' : String(v));
      return node;
    },

    announce: (message, options) => { if (open) { shared.liveUsers.add(s); env.announce(message, options); } },

    /** Undo everything, in reverse. Idempotent; never throws. */
    end() {
      if (!open) return false;
      open = false;
      for (let i = undo.length - 1; i >= 0; i--) {
        try { undo[i](); } catch { /* one failed undo must not stop the rest */ }
      }
      undo.length = 0;
      shared.liveUsers.delete(s);
      if (!shared.liveUsers.size) env.announce.release();
      return true;
    },
  };
  s.announce.batch = (key, message, options) => { if (open) { shared.liveUsers.add(s); env.announce.batch(key, message, options); } };

  const styles = stylesBlock(s, env);
  s.css = styles.css;
  s.filter = styles.filter;
  s.watch = watchBlock(s, env);
  s.highlight = highlightBlock(s, env);
  s.tooltip = tooltipBlock(s, env);
  s.panel = panelBlock(s, env);
  s.focus = focusBlock(s, env);
  s.keys = keysBlock(s, env);
  s.text = textBlock(s, env);
  s.ai = aiBlock(s, env);
  s.speech = speechBlock(s, env);
  s.media = mediaBlock(s, env);
  s.page = env.page;
  return s;
}
