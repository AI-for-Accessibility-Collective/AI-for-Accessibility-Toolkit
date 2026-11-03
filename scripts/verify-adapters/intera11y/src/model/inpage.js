'use strict';

function installHelpers() {
  const segment = (e) => {
    const tag = e.tagName.toLowerCase();
    let i = 1;
    for (let s = e.previousElementSibling; s; s = s.previousElementSibling) if (s.tagName === e.tagName) i++;
    return tag + '[' + i + ']';
  };
  const xpathOf = (e) => {
    if (!e || e.nodeType !== 1) return null;
    const parts = [];
    let n = e;
    while (n && n.nodeType === 1) {
      parts.unshift(segment(n));
      const p = n.parentNode;
      if (p && p.nodeType === 11 && p.host) return xpathOf(p.host) + '>>/' + parts.join('/');
      n = n.parentElement;
    }
    return '/' + parts.join('/');
  };
  const query = (doc, xp) => {
    const evaluate = expression => {
      const result = doc.evaluate(expression, doc, null, 7, null);
      return Array.from({ length: result.snapshotLength }, (_, i) => result.snapshotItem(i)).filter(e => e.nodeType === 1);
    };
    try {
      const found = evaluate(xp);
      if (found.length) return found;

      const namespaced = xp.split(/('[^']*'|"[^"]*")/g).map((part, i) => i % 2 ? part :
        part.replace(/(^|\/|::)([a-zA-Z][\w-]*)(?=[\[/)|\s]|$)/g,
          (_, prefix, tag) => `${prefix}*[translate(local-name(),"ABCDEFGHIJKLMNOPQRSTUVWXYZ","abcdefghijklmnopqrstuvwxyz")="${tag.toLowerCase()}"]`)).join('');
      return namespaced === xp ? [] : evaluate(namespaced);
    } catch (e) { return []; }
  };
  const resolveAll = (xp) => {
    const steps = String(xp || '').split('>>');
    let elements = query(document, steps[0]);
    for (let i = 1; i < steps.length; i++) {

      if (/^frame\//.test(steps[i])) {
        elements = elements.flatMap(el => {
          let doc = null; try { doc = el.contentDocument; } catch (e) {                    }
          return doc ? query(doc, steps[i].slice(5)) : [];
        });
        continue;
      }
      elements = elements.flatMap(el => {
        let cur = el.shadowRoot;
        for (const seg of steps[i].split('/').filter(Boolean)) {
          const m = /^([a-zA-Z0-9-]+)\[(\d+)\]$/.exec(seg);
          if (!m || !cur) return [];
          cur = [...cur.children].filter(c => c.tagName.toLowerCase() === m[1].toLowerCase())[Number(m[2]) - 1];
        }
        return cur?.nodeType === 1 ? [cur] : [];
      });
    }
    return elements;
  };
  const resolve = xp => { const found = resolveAll(xp); return found.length === 1 ? found[0] : null; };
  const deepActive = () => {
    let a = document.activeElement;
    while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
    return a;
  };
  const composedContains = (ancestor, node) => {
    const seen = new Set();
    for (let n = node; n && !seen.has(n);) {
      if (n === ancestor) return true;
      seen.add(n);
      if (n.assignedSlot) n = n.assignedSlot;
      else if (n.parentNode) n = n.parentNode;
      else if (n.host) n = n.host;
      else { try { n = n.defaultView?.frameElement || null; } catch (_) { n = null; } }
    }
    return false;
  };
  Object.defineProperty(window, '__ia', { value: { xpathOf, resolve, resolveAll, deepActive, composedContains }, configurable: false, enumerable: false });
}

function installListenerLog() {
  const orig = EventTarget.prototype.addEventListener;
  const TYPES = /^(click|mousedown|mouseup|pointerdown|pointerup|keydown|keyup|keypress|mouseover|mouseenter|pointerenter|focus|focusin|blur|touchstart|dblclick|dragstart|dragover|drop)$/;
  EventTarget.prototype.addEventListener = function (type, fn, opts) {
    try {
      if (this && this.nodeType === 1 && TYPES.test(type)) {
        const cur = this.getAttribute('data-ia-l') || '';
        if (!cur.split(',').includes(type)) this.setAttribute('data-ia-l', cur ? cur + ',' + type : type);
      }
    } catch (e) {                            }
    return orig.call(this, type, fn, opts);
  };
}

function collectElements(maxElements) {
  const out = [];
  let seq = 0;
  const docW = Math.max(document.documentElement.scrollWidth, innerWidth);
  const docH = Math.max(document.documentElement.scrollHeight, innerHeight);
  const xpathOf = window.__ia.xpathOf;
  const openTag = (e) => {
    const attrs = [];
    for (const a of e.attributes) {
      if (a.name.startsWith('data-ia-')) continue;
      const v = a.value.length > 120 ? a.value.slice(0, 117) + '…' : a.value;
      attrs.push(a.name + '="' + v.replace(/"/g, '&quot;') + '"');
    }
    const s = '<' + e.tagName.toLowerCase() + (attrs.length ? ' ' + attrs.join(' ') : '') + '>';
    return s.length > 400 ? s.slice(0, 399) + '…>' : s;
  };
  const ownText = (e) => {
    let t = '';
    for (const c of e.childNodes) if (c.nodeType === 3) t += c.textContent;
    return t.replace(/\s+/g, ' ').trim().slice(0, 160);
  };
  const clippedOutOf = (e, r) => {
    for (let a = e.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
      const s = getComputedStyle(a);
      if (!/(hidden|clip|auto|scroll)/.test(s.overflowX + ' ' + s.overflowY)) continue;
      const c = a.getBoundingClientRect();
      const ix = Math.min(r.right, c.right) - Math.max(r.left, c.left);
      const iy = Math.min(r.bottom, c.bottom) - Math.max(r.top, c.top);
      if (ix > 0 && iy > 0) continue;
      return true;
    }
    return false;
  };

  const scrollRegionOf = (e, r) => {
    for (let a = e.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
      const s = getComputedStyle(a);
      if (!/(hidden|auto|scroll)/.test(s.overflowX + ' ' + s.overflowY)) continue;
      const c = a.getBoundingClientRect();
      const inside = Math.min(r.right, c.right) - Math.max(r.left, c.left) > 0 && Math.min(r.bottom, c.bottom) - Math.max(r.top, c.top) > 0;
      if (inside) continue;
      const onPage = c.width > 0 && c.height > 0 && c.right + scrollX > 0 && c.left + scrollX < docW && c.bottom + scrollY > 0 && c.top + scrollY < docH;
      const scrolls = a.scrollWidth > a.clientWidth + 1 || a.scrollHeight > a.clientHeight + 1;

      const dx = r.left - c.left + a.scrollLeft, dy = r.top - c.top + a.scrollTop;
      const within = dx > -r.width && dy > -r.height && dx < a.scrollWidth && dy < a.scrollHeight;
      return onPage && scrolls && within ? a : null;
    }
    return null;
  };

  const offPage = (r) => { const L = r.left + scrollX, T = r.top + scrollY; return (L + r.width <= 0) || (T + r.height <= 0) || (L >= docW) || (T >= docH); };
  const visuallyHidden = (e, r, cs) => {
    for (let a = e, d = 0; a && a !== document.body && d < 6; a = a.parentElement, d++) {
      const s = a === e ? cs : getComputedStyle(a);
      const m = /rect\(\s*([-\d.]+)px[,\s]+([-\d.]+)px[,\s]+([-\d.]+)px[,\s]+([-\d.]+)px/.exec(s.clip || '');
      if (/absolute|fixed/.test(s.position) && m && (Math.abs(+m[2] - +m[4]) <= 1 || Math.abs(+m[3] - +m[1]) <= 1)) return true;
      if (/inset\(\s*(50|100)%/.test(s.clipPath || '')) return true;
      if ((a.offsetWidth <= 1 || a.offsetHeight <= 1) && /(hidden|clip)/.test(s.overflow || '')) return true;
    }
    if (typeof e.checkVisibility === 'function' && !e.checkVisibility({ opacityProperty: true })) return true;
    return offPage(r) && !scrollRegionOf(e, r);
  };
  const NATIVE_FOCUSABLE = 'a[href],area[href],button,input:not([type="hidden"]),select,textarea,summary,iframe,[contenteditable=""],[contenteditable="true"]';

  const inactiveLabels = new Set();
  for (const c of document.querySelectorAll(':disabled, [aria-disabled="true"]')) {
    for (const l of c.labels || []) inactiveLabels.add(l);
    for (const id of (c.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean)) { const t = document.getElementById(id); if (t) inactiveLabels.add(t); }
  }

  let modal = null;
  try { modal = document.querySelector(':modal'); } catch (e) {                         }
  const visit = (root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    for (let e = root.nodeType === 1 ? root : walker.nextNode(); e; e = walker.nextNode()) {
      if (out.length >= maxElements) return;
      const tag = e.tagName.toLowerCase();
      if (tag === 'script' || tag === 'style' || tag === 'noscript' || tag === 'template' || tag === 'head' || tag === 'meta' || tag === 'link' || tag === 'title') continue;
      const id = ++seq;
      e.setAttribute('data-ia-id', String(id));
      const cs = getComputedStyle(e);
      const r = e.getBoundingClientRect();

      const renders = typeof e.checkVisibility === 'function' ? e.checkVisibility({ visibilityProperty: true, contentVisibilityAuto: true }) : cs.display !== 'none' && cs.visibility !== 'hidden';
      const boxed = r.width > 0 || r.height > 0;
      const ti = e.getAttribute('tabindex');
      const tabindex = ti === null || Number.isNaN(parseInt(ti, 10)) ? null : parseInt(ti, 10);
      const hiddenAncestor = !!(e.parentElement && e.parentElement.closest('[aria-hidden="true"]'));
      const rec = {
        id, xpath: xpathOf(e), tag,
        role: e.getAttribute('role'),
        type: e.getAttribute('type'),
        openTag: openTag(e),
        text: ownText(e),
        rect: { x: Math.round(r.left + scrollX), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height) },
        rendered: renders,
        boxed,
        tabindex,
        nativeFocusable: e.matches(NATIVE_FOCUSABLE) && !e.disabled,
        disabled: e.disabled === true || e.getAttribute('aria-disabled') === 'true',
        inert: !!e.closest('[inert]'),

        modalBlocked: !!(modal && e.getRootNode() === document && !modal.contains(e) && !e.contains(modal)),
        labelsInactiveControl: inactiveLabels.has(e),
        ariaHiddenSelf: e.getAttribute('aria-hidden') === 'true',
        ariaHiddenAncestor: hiddenAncestor,
        listeners: e.getAttribute('data-ia-l') || null,
        inlineHandlers: ['onclick', 'onmousedown', 'onkeydown', 'onkeyup', 'onkeypress', 'onmouseover'].filter((h) => e.hasAttribute(h)),
        cursorPointer: cs.cursor === 'pointer',
        inShadow: e.getRootNode() !== document,
      };
      if (renders && boxed) {
        rec.visuallyHidden = visuallyHidden(e, r, cs);
        if (!rec.visuallyHidden) rec.clippedOut = clippedOutOf(e, r) || offPage(r);

        if (rec.clippedOut) { const sr = scrollRegionOf(e, r); if (sr) rec.revealedByScrolling = xpathOf(sr); }
      }
      out.push(rec);
      if (e.shadowRoot) visit(e.shadowRoot);
    }
  };
  visit(document.documentElement);
  const bodyText = document.body ? (document.body.innerText || '').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim() : '';
  return { elements: out, truncated: out.length >= maxElements, doc: { width: docW, height: docH, title: document.title, lang: document.documentElement.lang || null, url: location.href, dir: document.body ? getComputedStyle(document.body).direction : 'ltr', text: bodyText.slice(0, 6000), textLength: bodyText.length } };
}

module.exports = { installHelpers, installListenerLog, collectElements };
