'use strict';

const { visualOrderDivergence } = require('./order-check.js');
const LIMITS = require('./limits.js');

const REACH_SAFETY_CAP = LIMITS.instruments.reachSafetyCap;

const SEGMENTED_PRESS_CAP = 10;

const EMPTY_RING_SENTINEL_CAP = 5;

function probeActive() {
  const a = document.activeElement;
  if (!a || a === document.body || a === document.documentElement) return { sentinel: true };
  const map = window.__kbdSeen || (window.__kbdSeen = new WeakSet());
  const seen = map.has(a); if (!seen) map.add(a);
  const getXPath = (e) => {
    if (!e || !e.tagName) return '';
    if (e === document.body) return '/html/body';
    const ns = e.namespaceURI; const isHtml = !ns || ns === 'http://www.w3.org/1999/xhtml';
    const t = isHtml ? e.tagName.toLowerCase() : e.tagName;
    let idx = 1, sib = e.previousElementSibling;
    while (sib) { if (sib.tagName === e.tagName) idx++; sib = sib.previousElementSibling; }
    return getXPath(e.parentElement) + (isHtml ? '/' + t + '[' + idx + ']' : "/*[local-name()='" + t + "'][" + idx + "]");
  };
  const r = a.getBoundingClientRect();

  let pinned = false;
  for (let e = a; e && e !== document.body; e = e.parentElement) {
    const pos = getComputedStyle(e).position;
    if (pos === 'fixed' || pos === 'sticky') { pinned = true; break; }
  }

  const clean = (s) => String(s == null ? '' : s).trim().replace(/\s+/g, ' ').slice(0, 60);
  const labelledBy = () => {
    const ids = (a.getAttribute && a.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
    if (!ids.length) return '';
    return clean(ids.map((id) => { const n = document.getElementById(id); return n ? (n.innerText || n.textContent || '') : ''; }).join(' '));
  };
  const forLabel = () => {
    if (!a.id) return '';
    const l = document.querySelector('label[for="' + (window.CSS && CSS.escape ? CSS.escape(a.id) : a.id) + '"]');
    if (l) return clean(l.innerText || l.textContent);
    const anc = a.closest ? a.closest('label') : null;
    return anc ? clean(anc.innerText || anc.textContent) : '';
  };
  const label = clean(a.getAttribute && a.getAttribute('aria-label')) || labelledBy() || forLabel()
    || clean(a.innerText || a.textContent) || clean(a.value)
    || clean(a.getAttribute && a.getAttribute('placeholder')) || clean(a.title)
    || clean(a.getAttribute && a.getAttribute('alt'));

  const modalShowing = (el) => {
    if (!el) return false;
    if (el.closest && el.closest('[aria-hidden="true"]')) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    if (!(el.offsetParent !== null || cs.position === 'fixed')) return false;
    const br = el.getBoundingClientRect();
    return br.width >= 1 && br.height >= 1;
  };
  let openModal = null;
  for (const m of document.querySelectorAll('dialog[open], [aria-modal="true"]')) { if (modalShowing(m)) { openModal = m; break; } }
  let ownModal = a.closest ? a.closest('dialog[open], [aria-modal="true"]') : null;
  if (ownModal && !modalShowing(ownModal)) ownModal = null;

  let occludedBy = null, occluderPosition = null, occluderRect = null, occluderViewportCoverage = null;
  try {
    const cxv = r.left + r.width / 2, cyv = r.top + r.height / 2;
    if (cxv >= 0 && cyv >= 0 && cxv < window.innerWidth && cyv < window.innerHeight) {
      const top = document.elementFromPoint(cxv, cyv);
      if (top && top !== a && !a.contains(top) && !top.contains(a)) {
        occludedBy = getXPath(top);
        const tcs = getComputedStyle(top);
        occluderPosition = tcs.position || null;
        const tr = top.getBoundingClientRect();
        occluderRect = { x: Math.round(tr.left + window.scrollX), y: Math.round(tr.top + window.scrollY), w: Math.round(tr.width), h: Math.round(tr.height) };

        const ix = Math.max(0, Math.min(tr.right, window.innerWidth) - Math.max(tr.left, 0));
        const iy = Math.max(0, Math.min(tr.bottom, window.innerHeight) - Math.max(tr.top, 0));
        const vpArea = window.innerWidth * window.innerHeight;
        occluderViewportCoverage = vpArea > 0 ? Math.round(((ix * iy) / vpArea) * 1000) / 1000 : null;
      }
    }
  } catch (e) {                                       }
  return { sentinel: false, seen, xpath: getXPath(a), tag: a.tagName.toLowerCase(),
    rect: { x: Math.round(pinned ? r.left : r.left + window.scrollX), y: Math.round(pinned ? r.top : r.top + window.scrollY), w: Math.round(r.width), h: Math.round(r.height) },
    label,

    role: (a.getAttribute && a.getAttribute('role')) || null,
    tabindexAttr: (a.getAttribute && a.getAttribute('tabindex')) || null,

    segmented: a.tagName === 'INPUT' && /^(time|date|datetime-local|month|week)$/.test(a.type || ''),
    modalOpen: !!openModal,
    insideOpenModal: !!ownModal,
    modalXpath: ownModal ? getXPath(ownModal) : null,
    occludedBy, occluderPosition, occluderRect, occluderViewportCoverage };
}

const occlusionSpread = (o) => (o && o.occludedBy ? {
  occludedBy: o.occludedBy,
  occluderPosition: o.occluderPosition || null,
  occluderRect: o.occluderRect || null,
  occluderViewportCoverage: Number.isFinite(o.occluderViewportCoverage) ? o.occluderViewportCoverage : null,
} : {});

async function collectTabOrder(page, opts = {}) {
  const cap = Number.isFinite(opts.safetyCap) ? opts.safetyCap : REACH_SAFETY_CAP;
  const backward = opts.backward === true;

  await page.evaluate(() => { window.__kbdSeen = new WeakSet(); }).catch(() => {});

  const liveness = [];
  const note = (where, e) => liveness.push({ collector: 'probeActive@' + where, error: String((e && e.message) || e).replace(/\s+/g, ' ').slice(0, 300) });

  const entry = await page.evaluate(probeActive).catch((e) => { note('entry', e); return { sentinel: true }; });
  const order = [];
  let wrapped = false, exhausted = false, sawNode = false, sentinelStreak = 0, emptySentinelStreak = 0;
  let boundaryAt = -1;

  let lastXpath = entry.sentinel ? null : entry.xpath;
  let segPresses = 0;
  if (!entry.sentinel) {

    order.push({ index: 0, xpath: entry.xpath, tag: entry.tag, rect: entry.rect, label: entry.label, role: entry.role || null, tabindexAttr: entry.tabindexAttr || null, modalOpen: entry.modalOpen, insideOpenModal: entry.insideOpenModal, modalXpath: entry.modalXpath, initialFocus: true, ...occlusionSpread(entry) });
    sawNode = true;
  }
  for (let i = 0; i < cap; i++) {
    if (backward) { await page.keyboard.down('Shift'); await page.keyboard.press('Tab'); await page.keyboard.up('Shift'); }
    else { await page.keyboard.press('Tab'); }
    if (process.env.V3_SETTLE_KBD !== '0') await require('./settle.js').awaitFocusSettle(page);
    const info = await page.evaluate(probeActive).catch((e) => { note('walk', e); return { sentinel: true, err: true }; });

    if (info.sentinel) {
      if (sawNode) {
        if (boundaryAt < 0) boundaryAt = order.length - 1;
        if (++sentinelStreak >= 2) { wrapped = true; break; }
      } else if (++emptySentinelStreak >= EMPTY_RING_SENTINEL_CAP) {
        break;
      }
      continue;
    }
    sentinelStreak = 0;
    if (info.seen) {

      if (info.segmented && info.xpath === lastXpath) {
        if (segPresses < SEGMENTED_PRESS_CAP) { segPresses++; continue; }
        exhausted = true; break;
      }
      wrapped = true; break;
    }
    segPresses = 0;
    lastXpath = info.xpath;
    sawNode = true;
    order.push({ index: order.length, xpath: info.xpath, tag: info.tag, rect: info.rect, label: info.label, role: info.role || null, tabindexAttr: info.tabindexAttr || null, modalOpen: info.modalOpen, insideOpenModal: info.insideOpenModal, modalXpath: info.modalXpath, ...occlusionSpread(info) });
  }
  if (!wrapped && order.length >= cap) exhausted = true;

  let startAnchored = entry.sentinel === true;
  if (boundaryAt >= 0 && boundaryAt < order.length - 1) {
    const rotated = [...order.slice(boundaryAt + 1), ...order.slice(0, boundaryAt + 1)];
    order.length = 0;
    rotated.forEach((o, i) => order.push({ ...o, index: i }));
    startAnchored = true;
  } else if (boundaryAt >= 0) {
    startAnchored = true;
  }

  const initialFocus = entry.sentinel ? null
    : { xpath: entry.xpath, tag: entry.tag, label: entry.label, rect: entry.rect, ...occlusionSpread(entry) };
  return { order, wrapped, exhausted, count: order.length, backward, startAnchored, boundaryAt, initialFocus, liveness };
}

function tabOrderFindings(tab, opts = {}) {
  const items = (tab.order || []).map((s) => ({ xpath: s.xpath, rect: s.rect, label: s.label }));
  const r = visualOrderDivergence(items, { sc: '2.4.3', kind: 'tab-order', rowBand: opts.rowBand });
  return { findings: r.findings, comparable: r.comparable };
}

const GENERIC_TAGS = new Set(['div', 'span', 'p', 'section', 'article', 'li', 'td', 'th', 'label', 'figure', 'header', 'footer', 'main', 'aside', 'nav', 'ul', 'ol', 'dl', 'dd', 'dt', 'blockquote', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

const INTERACTIVE_ROLES = /^(button|link|checkbox|radio|switch|tab|menuitem|menuitemcheckbox|menuitemradio|option|combobox|listbox|slider|spinbutton|textbox|searchbox|treeitem|gridcell|columnheader|rowheader|scrollbar|separator|application|toolbar|tablist|menu|menubar|tree|grid|table|radiogroup|group|region|dialog|alertdialog|navigation|banner|main|contentinfo|complementary|form|search|article|list|listitem|figure|img|document|feed|log|status|marquee|timer|tooltip|progressbar|meter|tabpanel|treegrid|row|rowgroup)$/i;

const FIELD_TAGS = new Set(['input', 'select', 'textarea']);
const FIELD_ROLES = /^(textbox|searchbox|combobox|spinbutton|slider|listbox|checkbox|radio|switch)$/i;
const norm = (s) => String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim();
const isFieldStop = (s) => !!s && (FIELD_TAGS.has(String(s.tag || '').toLowerCase()) || (s.role && FIELD_ROLES.test(s.role)));

const commonAncestorTag = (xpaths) => {
  const parts = xpaths.map((x) => String(x || '').split('/').filter(Boolean));
  if (parts.some((p) => !p.length)) return null;
  const lim = Math.min(...parts.map((p) => p.length));
  let i = 0;
  for (; i < lim; i++) { const s = parts[0][i]; if (!parts.every((p) => p[i] === s)) break; }
  return i ? String(parts[0][i - 1]).replace(/\[\d+\]$/, '').toLowerCase() : null;
};

function redundantStopFacts(tab) {
  const order = (tab && Array.isArray(tab.order)) ? tab.order : [];
  const byXpath = {};
  const encloses = (a, b) => !!(a && b) && a.w * a.h >= b.w * b.h
    && a.x <= b.x + 1 && a.y <= b.y + 1 && a.x + a.w >= b.x + b.w - 1 && a.y + a.h >= b.y + b.h - 1;
  for (let i = 0; i < order.length; i++) {
    const cur = order[i];
    if (!cur || !cur.xpath) continue;
    const next = order[i + 1];

    if (next && next.xpath && next.xpath.startsWith(cur.xpath + '/')) {
      const a = norm(cur.label), b = norm(next.label);
      const f = byXpath[cur.xpath] || (byXpath[cur.xpath] = {});
      f.wrapsNextStop = true;
      f.rectEnclosesNextStop = encloses(cur.rect, next.rect);
      f.nameCoversNextStop = !!(a && b && (a === b || a.includes(b)));
    }

    const ti = cur.tabindexAttr == null ? null : parseInt(cur.tabindexAttr, 10);
    if (GENERIC_TAGS.has(String(cur.tag || '').toLowerCase()) && Number.isFinite(ti) && ti >= 0
        && !(cur.role && INTERACTIVE_ROLES.test(cur.role))) {
      const f = byXpath[cur.xpath] || (byXpath[cur.xpath] = {});
      f.genericContainerStop = true;

      const prev = order[i - 1];
      f.interruptsCoupledSequence = !!(isFieldStop(prev) && isFieldStop(next)
        && ['form', 'fieldset'].includes(commonAncestorTag([prev.xpath, cur.xpath, next.xpath])));
    }
  }
  return byXpath;
}

const FOCUSABLE_SEL = 'a[href],button,input:not([type=hidden]),select,textarea,[tabindex],[contenteditable=true]';

const TRAP_REGION_SEL = '[role=dialog],dialog,[aria-modal=true],[role=menu],[role=listbox],[role=grid],[role=tablist],[class*=modal i],[class*=overlay i],[class*=dialog i],[class*=popup i],[class*=lightbox i]';
const CLOSE_RE = /close|dismiss|cancel|done|\bok\b|×|✕|✖|⨉/i;

const ADVISORY_MODS = '(?:ctrl|control|alt|option|shift|cmd|command|meta)';

const ADVISORY_VERB = '(?:leave|exit|close|escape|dismiss|continue|return|go|move|get|jump|step|skip|bypass|advance)';
const ADVISORY_KEY = '["\']?(F(?:1[0-2]|[1-9])|Esc(?:ape)?|Enter|Spacebar|Space|Tab|[A-Za-z0-9])["\']?(?![A-Za-z0-9])';
const ADVISORY_COMBO = '((?:' + ADVISORY_MODS + '\\s*\\+\\s*)*)';

const ADVISORY_GAP = '(?:\\s+[^\\s.!?]+){0,4}?\\s+';

const ADVISORY_HINT_RE = /\bto\s+(?:leave|exit|escape|dismiss|close|get\s+out|skip\s+(?:past|over|ahead)|bypass|(?:move|return|take|send|put)\s+(?:the\s+)?focus)\b/i;

const ADVISORY_RESERVED = new Set(['ctrl+w', 'meta+w', 'ctrl+t', 'meta+t', 'ctrl+n', 'meta+n', 'ctrl+q', 'meta+q', 'alt+f4', 'ctrl+shift+q']);

function parseAdvisory(text) {
  const t = String(text || '');
  if (!t) return null;
  const hinted = ADVISORY_HINT_RE.test(t);
  let m = t.match(new RegExp('press\\s+(?:the\\s+)?' + ADVISORY_COMBO + ADVISORY_KEY + ADVISORY_GAP + 'to\\s+' + ADVISORY_VERB, 'i'));
  if (!m) m = t.match(new RegExp('to\\s+' + ADVISORY_VERB + '(?:\\s+[^\\s.!?]+){0,16}?[,:]?\\s+press(?:ing)?\\s+(?:the\\s+)?' + ADVISORY_COMBO + ADVISORY_KEY, 'i'));
  if (!m) return hinted ? { advised: true, key: null, mods: [], reserved: false } : null;
  const mods = (m[1] || '').split('+').map((x) => x.trim().toLowerCase()).filter(Boolean);

  if (!mods.length && /^a$/i.test(m[2])) return { advised: true, key: null, mods: [], reserved: false };
  const key = normalizeAdvisedKey(m[2]);
  const canon = mods.map((x) => ({ control: 'ctrl', option: 'alt', command: 'meta', cmd: 'meta' }[x] || x)).sort().concat(String(m[2]).toLowerCase()).join('+');
  return { advised: true, key, mods, reserved: ADVISORY_RESERVED.has(canon) };
}

function normalizeAdvisedKey(raw) {
  const k = String(raw || '');
  if (/^f\d+$/i.test(k)) return 'F' + k.toUpperCase().slice(1);
  const named = { esc: 'Escape', escape: 'Escape', enter: 'Enter', space: 'Space', spacebar: 'Space', tab: 'Tab' };
  if (named[k.toLowerCase()]) return named[k.toLowerCase()];

  return k.length === 1 ? k.toLowerCase() : k;
}

async function pressAdvised(page, advised) {
  if (!advised || !advised.key || advised.reserved) return false;
  const MOD = { ctrl: 'Control', control: 'Control', alt: 'Alt', option: 'Alt', shift: 'Shift', cmd: 'Meta', command: 'Meta', meta: 'Meta' };
  const mods = (advised.mods || []).map((k) => MOD[k]).filter(Boolean);
  for (const mod of mods) await page.keyboard.down(mod);
  try { await page.keyboard.press(advised.key); }
  finally { for (const mod of mods.slice().reverse()) await page.keyboard.up(mod); }
  return true;
}

async function focusFirstIn(page, regId) {
  return page.evaluate((id, sel) => {
    const reg = document.querySelector(`[data-v3-trapreg="${id}"]`);
    const f = reg && reg.querySelector(sel);
    if (f) { f.focus(); return document.activeElement === f; }
    return false;
  }, regId, FOCUSABLE_SEL);
}

async function focusPositionFor(page, regId) {
  return page.evaluate((id) => {
    const reg = document.querySelector(`[data-v3-trapreg="${id}"]`);
    const a = document.activeElement;
    if (!a || a === document.body || a === document.documentElement) return 'boundary';
    return (reg && reg.contains(a)) ? 'inside' : 'outside';
  }, regId);
}
async function stillInside(page, regId) {
  return (await focusPositionFor(page, regId)) === 'inside';
}

async function probeDirectionalEscape(page, regId, budget, backward) {
  if (!(await focusFirstIn(page, regId))) return { trapped: false, undetermined: true };
  let boundaryHits = 0;
  for (let i = 0; i < budget; i++) {
    if (backward) { await page.keyboard.down('Shift'); await page.keyboard.press('Tab'); await page.keyboard.up('Shift'); }
    else { await page.keyboard.press('Tab'); }

    const pos = await focusPositionFor(page, regId);
    if (pos === 'outside') return { trapped: false };
    if (pos === 'boundary') {

      if (++boundaryHits > 2) return { trapped: false, undetermined: true };
    }
  }
  return { trapped: true };
}

async function regionEscaped(page, regId, attr = 'data-v3-trapreg') {
  return page.evaluate((id, a2) => {
    const reg = document.querySelector(`[${a2}="${id}"]`);
    const a = document.activeElement;

    const dialogClosed = !!reg && reg.tagName === 'DIALOG' && !reg.hasAttribute('open');
    const gone = !reg || !reg.isConnected || reg.hidden || dialogClosed || getComputedStyle(reg).display === 'none';
    return gone || !(reg && a && reg.contains(a));
  }, regId, attr);
}

async function probeCloseEscape(page, regId, closeRe, attr = 'data-v3-trapreg') {
  const closeIds = await page.evaluate((id, reSrc, a2) => {
    const re = new RegExp(reSrc, 'i');
    const reg = document.querySelector(`[${a2}="${id}"]`);
    if (!reg) return [];
    const cands = [...reg.querySelectorAll('button,a[href],[role=button],[tabindex]')].filter((el) => {
      const t = (el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('title') || '') + ' ' + (el.textContent || '');
      return re.test(t) || el.hasAttribute('data-dismiss');
    });
    return cands.map((el, i) => { const cid = id + '-c' + i; el.setAttribute('data-v3-close', cid); return cid; });
  }, regId, closeRe.source, attr);
  for (const cid of closeIds) {
    const focused = await page.evaluate((cid2) => { const el = document.querySelector(`[data-v3-close="${cid2}"]`); if (el) { el.focus(); return document.activeElement === el; } return false; }, cid);
    if (!focused) continue;
    await page.keyboard.press('Enter');
    await page.evaluate(() => new Promise((r) => setTimeout(r, 60)));
    if (await regionEscaped(page, regId, attr)) return true;
  }
  return false;
}

async function detectKeyboardTraps(page, opts = {}) {
  const reachable = Array.isArray(opts.reachableXpaths) ? opts.reachableXpaths : null;
  const scan = await page.evaluate((regSel, focSel, reach) => {
    const getXPath = (e) => {
      if (!e || !e.tagName) return '';
      if (e === document.body) return '/html/body';
      const ns = e.namespaceURI; const isHtml = !ns || ns === 'http://www.w3.org/1999/xhtml';
      const t = isHtml ? e.tagName.toLowerCase() : e.tagName;
      let idx = 1, sib = e.previousElementSibling;
      while (sib) { if (sib.tagName === e.tagName) idx++; sib = sib.previousElementSibling; }
      return getXPath(e.parentElement) + (isHtml ? '/' + t + '[' + idx + ']' : "/*[local-name()='" + t + "'][" + idx + "]");
    };
    const reachSet = reach ? new Set(reach) : null;

    const focusableNow = (f) => {
      if (!(f.offsetParent !== null || getComputedStyle(f).position === 'fixed')) return false;
      if (typeof f.checkVisibility === 'function' && !f.checkVisibility({ visibilityProperty: true })) return false;
      return !(f.closest('[inert]') || f.disabled === true);
    };
    const isEntry = (f) => { const ti = f.getAttribute('tabindex'); return !(ti !== null && parseInt(ti, 10) < 0); };
    const out = []; const unreachable = []; let n = 0; const seenEl = new Set();
    document.querySelectorAll(regSel).forEach((reg) => {
      if (seenEl.has(reg)) return; seenEl.add(reg);
      const fs = [...reg.querySelectorAll(focSel)].filter(focusableNow);
      const entries = fs.filter(isEntry);
      if (fs.length < 2 || !entries.length) return;
      if (reachSet && !entries.some((f) => reachSet.has(getXPath(f)))) { if (unreachable.length < 20) unreachable.push({ xpath: getXPath(reg), focusableCount: fs.length }); return; }
      const id = 'tr' + (n++); reg.setAttribute('data-v3-trapreg', id); out.push({ id, xpath: getXPath(reg), focusableCount: fs.length });
    });
    return { out, unreachable };
  }, TRAP_REGION_SEL, FOCUSABLE_SEL, reachable);
  const regions = scan.out;

  const candidates = [];
  for (const reg of regions) {
    const budget = reg.focusableCount + LIMITS.instruments.escapeBudgetMargin;
    const fwd = await probeDirectionalEscape(page, reg.id, budget, false);
    const bwd = await probeDirectionalEscape(page, reg.id, budget, true);
    let escEscapes = false, closeEscapes = false;
    const looksTrapped = fwd.trapped === true || bwd.trapped === true;
    if (looksTrapped) {
      if (await focusFirstIn(page, reg.id)) {
        await page.keyboard.press('Escape');
        await page.evaluate(() => new Promise((r) => setTimeout(r, 60)));
        escEscapes = await regionEscaped(page, reg.id);
      }
      if (!escEscapes && fwd.trapped === true && bwd.trapped === true) closeEscapes = await probeCloseEscape(page, reg.id, CLOSE_RE);
    }

    const confirmed = fwd.trapped === true && bwd.trapped === true && !escEscapes && !closeEscapes;

    const directional = (fwd.trapped === true) !== (bwd.trapped === true) && !escEscapes;
    candidates.push({ regionXpath: reg.xpath, focusableCount: reg.focusableCount,
      forwardTrapped: !!fwd.trapped, backwardTrapped: !!bwd.trapped, escEscapes, closeEscapes,
      confirmed, directional, sc: '2.1.2' });
  }
  return {
    traps: candidates.filter((t) => t.confirmed),
    directionalTraps: candidates.filter((t) => t.directional && !t.confirmed),
    candidates, regionCount: regions.length, unreachableRegions: scan.unreachable,
  };
}

const REFOCUS_SETTLE_MS = 180;

const RETENTION_CAP = 60;
const settleMs = (page, ms) => page.evaluate((t) => new Promise((r) => setTimeout(r, t)), ms);

const RETURN_POLL_MS = 20;
const RETURN_MAX_MS = 1500;
const MIN_REFOCUS_WAIT_MS = 200;
const SETTLED_ELSEWHERE_MS = 140;

function tagFocusables(focSel) {
  const getXPath = (e) => {
    if (!e || !e.tagName) return '';
    if (e === document.body) return '/html/body';
    const ns = e.namespaceURI; const isHtml = !ns || ns === 'http://www.w3.org/1999/xhtml';
    const t = isHtml ? e.tagName.toLowerCase() : e.tagName;
    let idx = 1, sib = e.previousElementSibling;
    while (sib) { if (sib.tagName === e.tagName) idx++; sib = sib.previousElementSibling; }
    return getXPath(e.parentElement) + (isHtml ? '/' + t + '[' + idx + ']' : "/*[local-name()='" + t + "'][" + idx + "]");
  };
  const out = [];
  document.querySelectorAll(focSel).forEach((el, i) => {
    const ti = el.getAttribute('tabindex');
    if (ti !== null && parseInt(ti, 10) < 0) return;
    if (!(el.offsetParent !== null || getComputedStyle(el).position === 'fixed')) return;
    const id = 'fr' + i; el.setAttribute('data-v3-foc', id);
    out.push({ id, xpath: getXPath(el), tag: el.tagName.toLowerCase(),
      label: (el.innerText || el.textContent || el.value || '').trim().replace(/\s+/g, ' ').slice(0, 60) });
  });
  return out;
}
const activeFocId = () => { const a = document.activeElement; return a && a.getAttribute ? (a.getAttribute('data-v3-foc') || '') : ''; };

async function detectFocusRetentionTraps(page, opts = {}) {
  const focs = await page.evaluate(tagFocusables, FOCUSABLE_SEL).catch(() => []);
  if (!Array.isArray(focs) || focs.length < 2) return { traps: [], focusableCount: (focs || []).length, candidates: [] };
  const byId = new Map(focs.map((f) => [f.id, f]));
  const scan = focs.slice(0, RETENTION_CAP);

  await page.evaluate(() => {
    if (window.__frInstalled) { window.__frLog = []; return; }
    window.__frInstalled = true; window.__frLog = [];
    document.addEventListener('focusin', (e) => {
      const t = e.target; window.__frLog.push((t && t.getAttribute && t.getAttribute('data-v3-foc')) || '');
    }, true);
  }).catch(() => null);

  const scanPress = (winMs) => page.evaluate(async (w) => {
    const carried = (window.__frLog || []).slice(); window.__frLog = [];
    const read = () => { const a = document.activeElement; return a && a.getAttribute ? (a.getAttribute('data-v3-foc') || '') : ''; };
    const t0 = Date.now(); const imm = read(); let cur = imm, changedAt = null;
    while (Date.now() - t0 < w) {
      await new Promise((r) => setTimeout(r, 16));
      const now = read();
      if (now !== cur) { cur = now; changedAt = (now !== imm) ? Date.now() : null; }
      else if (changedAt != null && Date.now() - changedAt >= 64) break;
    }
    return { imm, cur, carried };
  }, winMs);
  let scanAsyncSeen = false;
  async function scanWalk(forceFull) {
    await page.evaluate(() => { const b = document.body; if (b) { b.tabIndex = -1; b.focus(); } });
    await page.evaluate(() => { window.__frLog = []; }).catch(() => null);
    const ids = new Set();
    let prevRead = null, prevId = '', usedShort = false;
    for (let i = 0; i < scan.length + 4; i++) {
      await page.keyboard.press('Tab');
      const full = forceFull || scanAsyncSeen || i < CONFINE_CALIBRATION_PRESSES;
      if (!full) usedShort = true;
      const r = await scanPress(full ? REFOCUS_SETTLE_MS : CONFINE_SHORT_SETTLE_MS).catch(() => null);
      const cur = r ? r.cur : '';
      const carriedForeign = r && prevRead ? r.carried.some((id) => id !== prevRead.imm && id !== prevRead.cur && id !== r.imm && id !== r.cur) : false;
      if (r && (r.cur !== r.imm || carriedForeign) && !scanAsyncSeen) {
        scanAsyncSeen = true;
        if (usedShort) return scanWalk(true);
      }
      if (cur && cur === prevId) ids.add(cur);
      prevId = cur; prevRead = r;
    }
    return ids;
  }
  const candIds = await scanWalk(false);

  const focusBody = () => page.evaluate(() => { const b = document.body; if (b) { b.tabIndex = -1; b.focus(); } });
  const focusId = (id) => page.evaluate((i) => { const el = document.querySelector(`[data-v3-foc="${i}"]`); if (el) { el.focus(); return document.activeElement === el; } return false; }, id);
  async function dirReturns(id, backward) {
    await focusBody(); await settleMs(page, 50);
    if (!(await focusId(id))) return { returns: false, leftSync: false };
    await page.evaluate(() => { window.__frLog = []; }).catch(() => null);
    if (backward) { await page.keyboard.down('Shift'); await page.keyboard.press('Tab'); await page.keyboard.up('Shift'); }
    else { await page.keyboard.press('Tab'); }

    const t0 = Date.now();
    let returns = false, sawNonId = false, elsewhere = '', elsewhereSince = 0;
    while (Date.now() - t0 < RETURN_MAX_MS) {
      const cur = await page.evaluate(activeFocId).catch(() => null);
      if (cur === id) { returns = true; break; }
      if (cur != null) {
        sawNonId = true;
        if (cur && byId.has(cur)) {
          if (cur !== elsewhere) { elsewhere = cur; elsewhereSince = Date.now(); }
          else if (Date.now() - t0 >= MIN_REFOCUS_WAIT_MS && Date.now() - elsewhereSince >= SETTLED_ELSEWHERE_MS) break;
        } else { elsewhere = ''; }
      }
      await settleMs(page, RETURN_POLL_MS);
    }
    if (!returns) { await settleMs(page, REFOCUS_SETTLE_MS); returns = (await page.evaluate(activeFocId).catch(() => '')) === id; }

    const log = await page.evaluate(() => (window.__frLog || []).slice()).catch(() => []);
    const leftSync = sawNonId || log.some((x) => x && x !== id);
    return { returns, leftSync };
  }
  const traps = [];
  for (const id of candIds) {
    const f = byId.get(id); if (!f) continue;
    const fwd = await dirReturns(id, false);
    const bwd = await dirReturns(id, true);
    if (fwd.returns && bwd.returns && (fwd.leftSync || bwd.leftSync)) {
      traps.push({ sc: '2.1.2', xpath: f.xpath, tag: f.tag, label: f.label });
    }
  }
  return { traps, focusableCount: focs.length, coverageTruncated: focs.length > RETENTION_CAP, candidates: [...candIds] };
}

const CONFINE_MULTIPLE = 4;
const CONFINE_FLOOR = 16;
const CONFINE_CALIBRATION_PRESSES = 4;
const CONFINE_SHORT_SETTLE_MS = 24;

const escSettle = REFOCUS_SETTLE_MS;

function installCfFocusinLog() {
  if (window.__cfInstalled) { window.__cfLog = []; return; }
  window.__cfInstalled = true; window.__cfLog = [];
  document.addEventListener('focusin', (e) => {
    const t = e.target; window.__cfLog.push((t && t.getAttribute && t.getAttribute('data-v3-foc')) || '');
  }, true);
}

async function cfPressSettleRead(winMs, earlyExitOk) {
  const carried = (window.__cfLog || []).slice(); window.__cfLog = [];
  const read = () => { const a = document.activeElement; return a && a.getAttribute ? (a.getAttribute('data-v3-foc') || '') : ''; };
  const t0 = Date.now();
  const imm = read();
  let cur = imm, changedAt = null;
  while (Date.now() - t0 < winMs) {
    await new Promise((r) => setTimeout(r, 16));
    const now = read();
    if (now !== cur) { cur = now; changedAt = (now !== imm) ? Date.now() : null; }
    else if (earlyExitOk && changedAt != null && Date.now() - changedAt >= 64) break;
  }
  return { imm, cur, carried };
}

async function detectFixedSetConfinementTraps(page, opts = {}) {
  const focs = await page.evaluate(tagFocusables, FOCUSABLE_SEL).catch(() => []);

  if (!Array.isArray(focs) || focs.length < 3) return { traps: [], focusableCount: (focs || []).length };
  const cap = Number.isFinite(opts.safetyCap) ? opts.safetyCap : REACH_SAFETY_CAP;
  const byId = new Map(focs.map((f) => [f.id, f]));
  const total = focs.length;

  const settleWindowMs = Number.isFinite(opts.refocusSettleMs) ? opts.refocusSettleMs : REFOCUS_SETTLE_MS;
  const adaptive = opts.adaptiveSettle !== false;
  await page.evaluate(installCfFocusinLog).catch(() => null);
  const pressSettleRead = (windowMs, allowEarlyExit) => page.evaluate(cfPressSettleRead, windowMs, allowEarlyExit === true);
  const window = Math.min(cap, Math.max(CONFINE_FLOOR, total * CONFINE_MULTIPLE));
  let asyncSeen = false;
  async function sweep(backward, budget, forceFull) {
    await page.evaluate(() => { const b = document.body; if (b) { b.tabIndex = -1; b.focus(); } }).catch(() => null);
    await page.evaluate(() => { window.__cfLog = []; }).catch(() => null);
    const seq = [], imm = [];
    let usedShort = false, prev = null;
    for (let i = 0; i < budget; i++) {
      if (backward) { await page.keyboard.down('Shift'); await page.keyboard.press('Tab'); await page.keyboard.up('Shift'); }
      else { await page.keyboard.press('Tab'); }
      const full = !adaptive || forceFull || asyncSeen || i < CONFINE_CALIBRATION_PRESSES;

      const r = await pressSettleRead(full ? settleWindowMs : CONFINE_SHORT_SETTLE_MS, !full).catch(() => null);
      if (!r) return null;
      if (!full) usedShort = true;

      const carriedForeign = prev ? r.carried.some((id) => id !== prev.imm && id !== prev.cur && id !== r.imm && id !== r.cur) : false;
      if (r.cur !== r.imm || carriedForeign) {
        if (!asyncSeen) {
          asyncSeen = true;

          if (usedShort) return sweep(backward, budget, true);
        }
      }
      prev = r;
      seq.push(r.cur); imm.push(r.imm);
    }
    return { seq, imm };
  }
  const fwd = await sweep(false, window);
  if (!fwd) return { traps: [], focusableCount: total, undetermined: true };
  const fwdSeq = fwd.seq;

  const tail = fwdSeq.slice(Math.floor(fwdSeq.length / 2)).filter((id) => id && byId.has(id));
  const S = new Set(tail);
  if (S.size < 2 || S.size >= total) return { traps: [], focusableCount: total };

  const firstInS = fwdSeq.findIndex((id) => S.has(id));
  if (firstInS < 0) return { traps: [], focusableCount: total };
  const fwdConfined = fwdSeq.slice(firstInS).every((id) => S.has(id));
  if (!fwdConfined) return { traps: [], focusableCount: total };

  const confinedSettles = fwdSeq.slice(firstInS).filter((id) => id && byId.has(id)).length;
  if (confinedSettles < S.size * 2) return { traps: [], focusableCount: total };

  if (fwd.imm.slice(firstInS).some((id) => id && byId.has(id) && !S.has(id))) return { traps: [], focusableCount: total };

  const reachedForward = new Set([...fwdSeq, ...fwd.imm].filter((id) => id && byId.has(id)));
  const unreachedForward = focs.filter((f) => !reachedForward.has(f.id));
  const onewayReturn = () => {
    if (!unreachedForward.length) return { traps: [], focusableCount: total };
    const members = [...S].map((id) => byId.get(id)).filter(Boolean);
    if (!members.length) return { traps: [], focusableCount: total };
    const anchor = members[0];
    return {
      traps: [], focusableCount: total,
      onewayTraps: [{ sc: '2.1.2', kind: 'keyboard-trap-oneway', direction: 'forward', review: true,
        xpath: anchor.xpath, tag: anchor.tag, label: anchor.label,
        memberXpaths: members.map((m) => m.xpath), setSize: S.size,
        unreached: unreachedForward.slice(0, 5).map((f) => ({ tag: f.tag, label: f.label })),
        unreachedCount: unreachedForward.length }],
    };
  };

  const bwd = await sweep(true, window);
  if (!bwd) return { traps: [], focusableCount: total, undetermined: true };
  const bwdFirstInS = bwd.seq.findIndex((id) => S.has(id));
  const bwdConfined = bwdFirstInS >= 0
    && bwd.seq.slice(bwdFirstInS).filter((id) => id && byId.has(id)).every((id) => S.has(id))

    && !bwd.imm.slice(bwdFirstInS).some((id) => id && byId.has(id) && !S.has(id));

  if (!bwdConfined) return onewayReturn();

  const entered = await page.evaluate((id) => { const el = document.querySelector(`[data-v3-foc="${id}"]`); if (el) { el.focus(); return document.activeElement === el; } return false; }, [...S][0]).catch(() => null);
  if (entered === null) return { traps: [], focusableCount: total, undetermined: true };
  let escEscapes = false;
  if (entered) {
    await page.keyboard.press('Escape');
    await settleMs(page, escSettle);
    const after = await page.evaluate(activeFocId).catch(() => null);
    if (after === null) return { traps: [], focusableCount: total, undetermined: true };
    escEscapes = !S.has(after);
  } else {
    return { traps: [], focusableCount: total, undetermined: true };
  }
  if (escEscapes) return { traps: [], focusableCount: total };

  const tryAdvised = async () => {

    const text = await page.evaluate(() => (document.body && (document.body.innerText || document.body.textContent)) || '').catch(() => null);
    if (text === null) return 'undetermined';
    const advised = parseAdvisory(text);
    if (!advised) return 'none';

    if (!advised.key || advised.reserved) return 'none';
    await page.evaluate((id) => { const el = document.querySelector(`[data-v3-foc="${id}"]`); if (el) el.focus(); }, [...S][0]).catch(() => null);
    await pressAdvised(page, advised);
    await settleMs(page, escSettle);
    const after = await page.evaluate(activeFocId).catch(() => null);
    if (after === null) return 'undetermined';
    return S.has(after) ? 'lying' : 'clear';
  };

  const r1 = await tryAdvised();
  if (r1 === 'clear') return { traps: [], focusableCount: total };
  if (r1 === 'undetermined') return { traps: [], focusableCount: total, undetermined: true };
  const lyingAdvisory = (r1 === 'lying');

  const members = [...S].map((id) => byId.get(id)).filter(Boolean);
  const anchor = members[0];
  return {
    traps: [{ sc: '2.1.2', xpath: anchor.xpath, tag: anchor.tag, label: anchor.label,
      memberXpaths: members.map((m) => m.xpath), setSize: S.size,
      deterministicTrapConfirmed: true, lyingAdvisory }],
    focusableCount: total, candidateSet: members.map((m) => m.xpath),
  };
}

async function focusRejectionProbeOnce(i, w, gap) {
  const b = document.body; if (b) { b.tabIndex = -1; b.focus(); }
  if (gap > 0) await new Promise((r) => setTimeout(r, gap));
  const el = document.querySelector(`[data-v3-foc="${i}"]`);
  if (!el) return null;
  if (el.disabled || el.getAttribute('aria-disabled') === 'true') return { skip: true };
  const inlineHandler = !!(el.getAttribute('onfocus') || el.getAttribute('onblur') || el.getAttribute('onfocusout'));
  window.__fojLog = [];
  el.focus();
  await new Promise((r) => setTimeout(r, w));
  const lateBlur = (window.__fojLog || []).includes(i);
  return { skip: false, inlineHandler, lateBlur, took: document.activeElement === el || el.contains(document.activeElement), onBody: document.activeElement === document.body };
}

async function detectFocusRejection(page, opts = {}) {
  const focs = await page.evaluate(tagFocusables, FOCUSABLE_SEL).catch(() => []);
  if (!Array.isArray(focs) || !focs.length) return { rejections: [], focusableCount: (focs || []).length };
  const scan = focs.slice(0, RETENTION_CAP);

  await page.evaluate(() => {
    if (window.__fojInstalled) { window.__fojLog = []; return; }
    window.__fojInstalled = true; window.__fojLog = [];
    document.addEventListener('focusout', (e) => {
      const t = e.target; window.__fojLog.push((t && t.getAttribute && t.getAttribute('data-v3-foc')) || '');
    }, true);
  }).catch(() => null);
  const probeOnce = (id, winMs, interCandidateSettleMs) => page.evaluate(focusRejectionProbeOnce, id, winMs,
    Number.isFinite(interCandidateSettleMs) ? interCandidateSettleMs : CONFINE_SHORT_SETTLE_MS).catch(() => null);
  const rejections = [];
  const confirmFull = async (f, inlineHandler) => {
    const s1 = await probeOnce(f.id, REFOCUS_SETTLE_MS);
    if (!s1 || s1.skip || s1.took || !s1.onBody) return;
    const s2 = await probeOnce(f.id, REFOCUS_SETTLE_MS);
    if (s2 && !s2.skip && !s2.took && s2.onBody) rejections.push({ sc: '2.1.1', xpath: f.xpath, tag: f.tag, label: f.label, inlineHandler: !!(inlineHandler != null ? inlineHandler : s1.inlineHandler) });
  };
  const suspects = [];
  for (const f of scan) {
    const q = await probeOnce(f.id, CONFINE_SHORT_SETTLE_MS);
    if (!q || q.skip) continue;

    if ((!q.took && q.onBody) || q.lateBlur || q.inlineHandler) suspects.push({ f, inlineHandler: q.inlineHandler });
  }

  const lateIds = await page.evaluate(() => { const l = (window.__fojLog || []).slice(); window.__fojLog = []; return l; }).catch(() => []);
  for (const f of scan) if (lateIds.includes(f.id) && !suspects.some((s) => s.f.id === f.id)) suspects.push({ f, inlineHandler: null });
  for (const s of suspects) await confirmFull(s.f, s.inlineHandler);
  return { rejections, focusableCount: focs.length, coverageTruncated: focs.length > RETENTION_CAP };
}

async function detectFocusRestsInAriaHidden(page, opts = {}) {
  const focs = await page.evaluate(tagFocusables, FOCUSABLE_SEL).catch(() => []);
  if (!Array.isArray(focs) || !focs.length) return { traps: [], focusableCount: (focs || []).length };

  const candidateIds = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('[data-v3-foc]').forEach((el) => {
      let p = el.parentElement;
      while (p) { if (p.getAttribute && p.getAttribute('aria-hidden') === 'true') { out.push(el.getAttribute('data-v3-foc')); break; } p = p.parentElement; }
    });
    return out;
  }).catch(() => []);
  const byId = new Map(focs.map((f) => [f.id, f]));
  const traps = [];
  for (const id of candidateIds) {
    const f = byId.get(id); if (!f) continue;
    await page.evaluate(() => { const b = document.body; if (b) { b.tabIndex = -1; b.focus(); } }).catch(() => null);
    const focused = await page.evaluate((i) => { const el = document.querySelector(`[data-v3-foc="${i}"]`); if (!el) return false; el.focus(); return true; }, id).catch(() => null);
    if (focused === null) continue;
    await settleMs(page, REFOCUS_SETTLE_MS);
    const settledId = await page.evaluate(activeFocId).catch(() => null);
    if (settledId === null) continue;
    if (settledId === id) traps.push({ sc: '4.1.2', xpath: f.xpath, tag: f.tag, label: f.label });
  }
  return { traps, focusableCount: focs.length };
}

const OPENER_VERB_RE = /\b(open|show|view|edit|create|add|new|settings?|filters?|menu|options?|configure|manage|details?|preview|select|choose|pick|sign in|log in)\b/i;

async function findRevealOpeners(page, maxOpeners = 2) {
  return page.evaluate((max) => {
    const VERB = /\b(open|show|view|edit|create|add|new|settings?|filters?|menu|options?|configure|manage|details?|preview|select|choose|pick|sign in|log in)\b/i;
    const NAV_RE = /location\s*[.=]|\.href|window\.open|\.submit\s*\(|history\.(push|replace|go|back|forward)/i;
    const getXPath = (e) => {
      if (!e || !e.tagName) return '';
      if (e === document.body) return '/html/body';
      const t = e.tagName.toLowerCase();
      let idx = 1, sib = e.previousElementSibling;
      while (sib) { if (sib.tagName === e.tagName) idx++; sib = sib.previousElementSibling; }
      return getXPath(e.parentElement) + '/' + t + '[' + idx + ']';
    };
    const visible = (el) => (el.offsetParent !== null || getComputedStyle(el).position === 'fixed')
      && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[aria-hidden="true"]');
    const out = [];
    for (const el of document.querySelectorAll('button,[role="button"],input[type="button"]')) {
      if (!visible(el) || el.disabled) continue;
      if (el.closest('a[href]')) continue;
      const type = (el.getAttribute('type') || '').toLowerCase();
      if (type === 'submit' || type === 'reset' || type === 'image') continue;
      if (el.tagName === 'BUTTON' && !type && el.form) continue;
      if (NAV_RE.test(el.getAttribute('onclick') || '')) continue;

      if (el.closest('[role=dialog],dialog,[aria-modal="true"],[role=menu],[role=listbox]')) continue;
      const name = (el.getAttribute('aria-label') || el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
      const controlled = (el.getAttribute('aria-controls') || '').split(/\s+/).filter(Boolean)
        .map((id) => document.getElementById(id)).filter(Boolean);
      const controlsHidden = controlled.some((c) => c.offsetParent === null || c.hidden || c.getAttribute('aria-hidden') === 'true');
      let rank = 3;
      if (el.getAttribute('aria-haspopup')) rank = 0;
      else if (el.getAttribute('aria-expanded') === 'false' || controlsHidden) rank = 1;
      else if (VERB.test(name)) rank = 2;
      out.push({ xpath: getXPath(el), name: name.slice(0, 40), rank });
    }
    out.sort((a, b) => a.rank - b.rank);
    return out.slice(0, max);
  }, maxOpeners).catch(() => []);
}

const REVEAL_ACT_SETTLE_MS = 250;

function tagHiddenRegionsInPage(focSel, mark) {
  const isHidden = (el) => {
    if (!el || el.nodeType !== 1) return false;
    if (el.hidden) return true;
    if (el.getAttribute && el.getAttribute('aria-hidden') === 'true') return true;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return true;
    if (!(el.offsetParent !== null || cs.position === 'fixed')) return true;
    const r = el.getBoundingClientRect();
    return r.width < 1 && r.height < 1;
  };
  let n = 0;
  const seen = new Set();
  for (const f of document.querySelectorAll(focSel)) {
    for (let p = f; p && p !== document.documentElement; p = p.parentElement) {
      if (seen.has(p) || p.hasAttribute('data-v3-revhidden')) break;
      seen.add(p);
      if (isHidden(p)) { if (mark) p.setAttribute('data-v3-revhidden', '1'); n++; }
    }
  }
  return n;
}

const REVEAL_XPATH_FN = `(e) => { const gx = (n) => { if (!n || !n.tagName) return ''; if (n === document.body) return '/html/body';
  const ns = n.namespaceURI, isHtml = !ns || ns === 'http://www.w3.org/1999/xhtml', t = isHtml ? n.tagName.toLowerCase() : n.tagName;
  let i = 1; for (let s = n.previousElementSibling; s; s = s.previousElementSibling) if (s.tagName === n.tagName) i++;
  return gx(n.parentElement) + (isHtml ? '/' + t + '[' + i + ']' : "/*[local-name()='" + t + "'][" + i + "]"); }; return gx(e); }`;

const REVEAL_MARKER_SEL = '[data-v3-revopener],[data-v3-revregion],[data-v3-revfocus],[data-v3-revhidden]';

async function collectRevealedFocusOrder(page, url, opts = {}) {
  const maxOpeners = Number.isFinite(opts.maxOpeners) ? opts.maxOpeners : 2;
  const gotoTimeoutMs = opts.gotoTimeoutMs || 20000;

  const progress = (opts.progress && typeof opts.progress === 'object') ? opts.progress : {};
  progress.ran = true;
  const settle = require('./settle.js');
  const wait = (ms) => page.evaluate((t) => new Promise((r) => setTimeout(r, t)), ms).catch(() => null);
  const activeXpath = () => page.evaluate(`(${REVEAL_XPATH_FN})(document.activeElement)`).catch(() => null);
  const reload = async () => {
    await page.goto(url, { waitUntil: 'load', timeout: gotoTimeoutMs });
    await settle.awaitSettle(page).catch(() => {});
  };

  const hiddenRegions = await page.evaluate(tagHiddenRegionsInPage, FOCUSABLE_SEL, false).catch(() => 0);
  progress.hiddenRegions = hiddenRegions;
  if (!hiddenRegions) return { states: [], openers: 0, hiddenRegions: 0 };

  const hiddenDialogShaped = await page.evaluate((focSel) => {
    for (const reg of document.querySelectorAll('dialog,[role="dialog"],[role="alertdialog"],[aria-modal="true"]')) {
      const hidden = reg.offsetParent === null || reg.hidden || getComputedStyle(reg).visibility === 'hidden'
        || (reg.tagName === 'DIALOG' && !reg.hasAttribute('open'));
      if (!hidden) continue;
      if (reg.querySelectorAll(focSel).length >= 2) return true;
    }
    return false;
  }, FOCUSABLE_SEL).catch(() => false);
  const openers = (await findRevealOpeners(page, 8)).filter((o) => o && (o.rank <= 2 || hiddenDialogShaped)).slice(0, maxOpeners);
  progress.openersFound = openers.length;
  if (!openers.length) return { states: [], openers: 0, hiddenRegions };

  const states = [];

  let fresh = opts.pageIsFresh === true;
  for (const op of openers) {
    try {
      if (!fresh) await reload();
      fresh = false;
      await page.evaluate(tagHiddenRegionsInPage, FOCUSABLE_SEL, true).catch(() => 0);
      const here = page.url();

      let restXpaths = Array.isArray(opts.restingXpaths) && opts.restingXpaths.length ? opts.restingXpaths : null;
      if (!restXpaths) {
        const t0 = await collectTabOrder(page).catch(() => null);
        restXpaths = t0 ? (t0.order || []).map((o) => o.xpath) : [];
      }
      const restSet = new Set(restXpaths);

      progress.activated = true;
      const clicked = await page.evaluate((xp) => {
        const el = document.evaluate(xp, document, null, 9, null).singleNodeValue;
        if (!el) return false;
        el.setAttribute('data-v3-revopener', '1');
        if (el.focus) el.focus();
        el.click();
        return true;
      }, op.xpath).catch(() => false);
      if (!clicked) continue;
      await wait(REVEAL_ACT_SETTLE_MS);
      if (page.url() !== here) continue;

      const afterOpen = await page.evaluate(() => {
        const gx = (n) => { if (!n || !n.tagName) return ''; if (n === document.body) return '/html/body';
          const ns = n.namespaceURI, isHtml = !ns || ns === 'http://www.w3.org/1999/xhtml', t = isHtml ? n.tagName.toLowerCase() : n.tagName;
          let i = 1; for (let s = n.previousElementSibling; s; s = s.previousElementSibling) if (s.tagName === n.tagName) i++;
          return gx(n.parentElement) + (isHtml ? '/' + t + '[' + i + ']' : "/*[local-name()='" + t + "'][" + i + "]"); };
        const a = document.activeElement;
        if (a && a.setAttribute && a !== document.body && a !== document.documentElement) a.setAttribute('data-v3-revfocus', '1');
        const op2 = document.querySelector('[data-v3-revopener]');
        return { focusXpath: gx(a), openerXpathNow: op2 ? gx(op2) : null };
      }).catch(() => ({ focusXpath: null, openerXpathNow: null }));
      const opened = await collectTabOrder(page).catch(() => null);
      if (!opened) continue;
      const openedXpaths = (opened.order || []).map((o) => o.xpath);
      const newStops = openedXpaths.map((x, i) => ({ x, i })).filter((s) => !restSet.has(s.x));
      const openerIndex = openedXpaths.indexOf(afterOpen.openerXpathNow || op.xpath);
      const firstNewStopIndex = newStops.length ? newStops[0].i : -1;

      const modalStops = (opened.order || []).filter((s) => s && s.modalOpen === true);
      const leakedStops = modalStops.filter((s) => s.insideOpenModal !== true);
      const containmentLeak = modalStops.length ? {
        modalXpath: (modalStops.find((s) => s.modalXpath) || {}).modalXpath || null,
        openedStops: openedXpaths.length,
        leakedStops: leakedStops.length,
        leakedSample: leakedStops.slice(0, 6).map((s) => ({ xpath: s.xpath, label: s.label || null })),
      } : null;

      const region = newStops.length ? await page.evaluate((xp) => {
        const gx = (n) => { if (!n || !n.tagName) return ''; if (n === document.body) return '/html/body';
          const ns = n.namespaceURI, isHtml = !ns || ns === 'http://www.w3.org/1999/xhtml', t = isHtml ? n.tagName.toLowerCase() : n.tagName;
          let i = 1; for (let s = n.previousElementSibling; s; s = s.previousElementSibling) if (s.tagName === n.tagName) i++;
          return gx(n.parentElement) + (isHtml ? '/' + t + '[' + i + ']' : "/*[local-name()='" + t + "'][" + i + "]"); };
        const vis = (el) => { const cs = getComputedStyle(el);
          if (cs.display === 'none' || cs.visibility === 'hidden') return false;
          if (!(el.offsetParent !== null || cs.position === 'fixed')) return false;
          const r = el.getBoundingClientRect(); return r.width >= 1 && r.height >= 1; };
        const el = document.evaluate(xp, document, null, 9, null).singleNodeValue;
        if (!el) return null;
        let best = null;
        for (let p = el; p && p !== document.documentElement; p = p.parentElement) {
          if (p.getAttribute && p.getAttribute('data-v3-revhidden') === '1' && vis(p)) best = p;
        }
        if (!best) return null;
        best.setAttribute('data-v3-revregion', '1');
        return { xpath: gx(best), role: best.getAttribute('role') || null, tag: best.tagName.toLowerCase(),
          focusables: best.querySelectorAll('a[href],button,input:not([type=hidden]),select,textarea,[tabindex],[contenteditable=true]').length };
      }, newStops[0].x).catch(() => null) : null;

      const st = {
        openerXpath: op.xpath, openerName: op.name || null,
        restingStops: restXpaths.length, openedStops: openedXpaths.length, newStops: newStops.length,
        revealedRegionXpath: region ? region.xpath : null,
        revealedRegionRole: region ? (region.role || region.tag) : null,
        openerIndex: openerIndex >= 0 ? openerIndex : null,
        firstNewStopIndex: firstNewStopIndex >= 0 ? firstNewStopIndex : null,

        adjacent: (region && openerIndex >= 0 && firstNewStopIndex >= 0) ? (firstNewStopIndex === openerIndex + 1) : null,
        focusMovedIntoRevealed: null,
        focusAfterOpen: afterOpen.focusXpath || null,
        newStopLabels: newStops.slice(0, 6).map((s) => (opened.order[s.i] || {}).label || null),

        containmentLeak,
      };
      if (region) {
        st.focusMovedIntoRevealed = await page.evaluate(() => {
          const reg = document.querySelector('[data-v3-revregion]');
          const el = document.querySelector('[data-v3-revfocus]');
          if (!reg) return null;
          return !!(el && reg.contains(el));
        }).catch(() => null);
      }

      if (region && region.focusables > 0) {
        const entered = await page.evaluate((focSel) => {
          const reg = document.querySelector('[data-v3-revregion]');
          if (!reg) return false;
          for (const f of reg.querySelectorAll(focSel)) {
            const cs = getComputedStyle(f);
            if (!(f.offsetParent !== null || cs.position === 'fixed') || cs.visibility === 'hidden') continue;
            const ti = f.getAttribute('tabindex');
            if (ti !== null && parseInt(ti, 10) < 0) continue;
            f.focus();
            if (reg.contains(document.activeElement)) return true;
          }
          return false;
        }, FOCUSABLE_SEL).catch(() => false);
        if (entered) {
          const regionHidden = () => page.evaluate(() => {
            const reg = document.querySelector('[data-v3-revregion]');
            if (!reg || !reg.isConnected) return true;
            const cs = getComputedStyle(reg);
            if (cs.display === 'none' || cs.visibility === 'hidden' || reg.hidden) return true;
            if (reg.getAttribute('aria-hidden') === 'true') return true;
            if (!(reg.offsetParent !== null || cs.position === 'fixed')) return true;
            const r = reg.getBoundingClientRect(); return r.width < 1 && r.height < 1;
          }).catch(() => null);
          await page.keyboard.press('Escape').catch(() => {});
          await wait(REVEAL_ACT_SETTLE_MS);
          let hidden = await regionHidden();
          let via = hidden ? 'escape' : null, control = null;
          if (!hidden) {

            control = await page.evaluate((reSrc) => {
              const re = new RegExp(reSrc, 'i');
              const reg = document.querySelector('[data-v3-revregion]');
              if (!reg) return null;
              for (const b of reg.querySelectorAll('button,[role=button],input[type=button]')) {
                const cs = getComputedStyle(b);
                if (!(b.offsetParent !== null || cs.position === 'fixed') || cs.visibility === 'hidden') continue;
                if (b.disabled) continue;
                const n = ((b.getAttribute('aria-label') || '') + ' ' + (b.getAttribute('title') || '') + ' ' + (b.textContent || '')).replace(/\s+/g, ' ').trim();
                if (re.test(n) || b.hasAttribute('data-dismiss')) { b.click(); return n.slice(0, 40) || '(unnamed)'; }
              }
              return null;
            }, CLOSE_RE.source).catch(() => null);
            if (control) {
              await wait(REVEAL_ACT_SETTLE_MS);
              hidden = await regionHidden();
              if (hidden) via = 'close-control';
            }
          }
          st.dismissAttempted = true;
          st.dismissedVia = via;
          st.dismissControlName = control;

          st.regionHiddenAfterDismiss = hidden === true;
          if (hidden === true) {
            st.focusAfterDismiss = await activeXpath();

            const back = await page.evaluate(() => {
              const el = document.querySelector('[data-v3-revopener]');
              if (!el || !el.isConnected) return { present: false, returned: false };
              const cs = getComputedStyle(el);
              return {
                present: (el.offsetParent !== null || cs.position === 'fixed') && cs.visibility !== 'hidden' && !el.disabled,
                returned: document.activeElement === el,
              };
            }).catch(() => null);
            st.returnedToOpener = back ? back.returned : null;

            st.openerStillPresent = back ? back.present : null;
          }
        }
      }
      states.push(st);
    } catch (e) {                                                                       }
  }
  return { states, openers: openers.length, hiddenRegions };
}

async function detectTrapsAfterReveal(page, url, opts = {}) {
  const maxOpeners = Number.isFinite(opts.maxOpeners) ? opts.maxOpeners : 2;

  const reloaded = await page.goto(url, { waitUntil: 'load', timeout: opts.gotoTimeoutMs || 20000 }).then(() => true).catch(() => false);
  if (!reloaded) return null;
  await require('./settle.js').awaitSettle(page).catch(() => {});

  const hasHiddenRegion = await page.evaluate((regSel, focSel) => {
    for (const reg of document.querySelectorAll(regSel)) {
      const hidden = reg.offsetParent === null || reg.hidden || getComputedStyle(reg).visibility === 'hidden'
        || (reg.tagName === 'DIALOG' && !reg.hasAttribute('open'));
      if (!hidden) continue;
      if (reg.querySelectorAll(focSel).length >= 2) return true;
    }
    return false;
  }, TRAP_REGION_SEL, FOCUSABLE_SEL).catch(() => false);
  if (!hasHiddenRegion) return null;
  const openers = await findRevealOpeners(page, maxOpeners);
  let firstReview = null;
  for (const op of openers) {
    try {

      const openState = async () => {
        await page.goto(url, { waitUntil: 'load', timeout: opts.gotoTimeoutMs || 20000 });
        await require('./settle.js').awaitSettle(page);
        const clicked = await page.evaluate((xp) => {
          const el = document.evaluate(xp, document, null, 9, null).singleNodeValue;
          if (!el) return false; el.click(); return true;
        }, op.xpath).catch(() => false);
        if (clicked) await page.evaluate(() => new Promise((r) => setTimeout(r, 250))).catch(() => {});
        return clicked;
      };
      if (!(await openState())) continue;
      const traps = await detectKeyboardTraps(page, opts).catch(() => null);
      if (traps && Array.isArray(traps.traps) && traps.traps.length) return { opener: op, traps };
      const self = await detectFocusRetentionTraps(page, opts).catch(() => null);
      if (self && Array.isArray(self.traps) && self.traps.length) return { opener: op, selfTraps: self };

      if (!(await openState())) continue;

      const embed = await detectEmbeddedFormatTraps(page, opts).catch(() => null);
      if (embed && Array.isArray(embed.traps) && embed.traps.length) {
        if (embed.traps.some((t) => t.sameOrigin === true)) return { opener: op, embedTraps: embed };
        if (!firstReview) firstReview = { opener: op, embedTraps: embed };
      } else if (embed && Array.isArray(embed.directional) && embed.directional.length && !firstReview) {
        firstReview = { opener: op, embedTraps: embed };
      }

      const embedDrove = !embed || !Number.isFinite(embed.boundaries) || embed.boundaries > 0;
      if (embedDrove && !(await openState())) continue;

      const confine = await detectFixedSetConfinementTraps(page, opts).catch(() => null);
      if (confine && Array.isArray(confine.traps) && confine.traps.length) {
        if (confine.traps.some((t) => t.lyingAdvisory === true)) return { opener: op, confinement: confine };
        if (!firstReview) firstReview = { opener: op, confinement: confine };
      } else if (confine && Array.isArray(confine.onewayTraps) && confine.onewayTraps.length && !firstReview) {
        firstReview = { opener: op, confinement: confine };
      }
    } catch (e) {                                                   }
  }
  return firstReview;
}

const EMBED_SEL = 'iframe,object,embed,frame';

async function detectEmbeddedFormatTraps(page, opts = {}) {
  const margin = Number.isFinite(opts.escapeMargin) ? opts.escapeMargin : LIMITS.instruments.escapeBudgetMargin;
  const boundaries = await page.evaluate((embedSel, focSel) => {
    const getXPath = (e) => {
      if (!e || !e.tagName) return '';
      if (e === document.body) return '/html/body';
      const t = e.tagName.toLowerCase();
      let i = 1; for (let s = e.previousElementSibling; s; s = s.previousElementSibling) if (s.tagName === e.tagName) i++;
      return getXPath(e.parentElement) + '/' + t + '[' + i + ']';
    };
    const visible = (e) => {
      const cs = getComputedStyle(e); const r = e.getBoundingClientRect();
      return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 1 && r.height > 1;
    };
    const out = [];
    let n = 0;

    for (const el of document.querySelectorAll(embedSel)) {
      if (!visible(el)) continue;
      const ti = el.getAttribute('tabindex');
      if (ti !== null && +ti < 0) continue;

      let inner = null, sameOrigin = false;
      try { const d = el.contentDocument; if (d) { sameOrigin = true; inner = d.querySelectorAll(focSel).length; } } catch (e) {                    }
      const id = 'emb' + (n++);
      el.setAttribute('data-v3-embed', id);
      out.push({ id, xpath: getXPath(el), kind: el.tagName.toLowerCase(), innerFocusables: inner, sameOrigin });
    }

    const walk = (root) => {
      for (const el of root.querySelectorAll('*')) {
        if (!el.shadowRoot) continue;
        if (!visible(el)) continue;
        const inner = el.shadowRoot.querySelectorAll(focSel).length;
        if (inner < 1) continue;
        const id = 'emb' + (n++);
        el.setAttribute('data-v3-embed', id);
        out.push({ id, xpath: getXPath(el), kind: 'shadow-root', innerFocusables: inner, sameOrigin: true });
      }
    };
    walk(document);
    return out;
  }, EMBED_SEL, FOCUSABLE_SEL).catch(() => []);

  for (const b of boundaries) {
    if (Number.isFinite(b.innerFocusables)) continue;
    if (b.kind === 'shadow-root') continue;
    let handle = null;
    try {
      handle = await page.$(`[data-v3-embed="${b.id}"]`);
      if (!handle) continue;
      const frame = await handle.contentFrame();
      if (!frame) continue;
      const n = await frame.evaluate((sel) => document.querySelectorAll(sel).length, FOCUSABLE_SEL);
      if (Number.isFinite(n)) { b.innerFocusables = n; b.countedViaCdp = true; b.sameOrigin = true; }
    } catch (e) {                                                              }

    finally { if (handle) { try { await handle.dispose(); } catch (e) {} } }
  }

  const atBoundary = (id) => page.evaluate((bid) => {
    const el = document.querySelector(`[data-v3-embed="${bid}"]`);
    const a = document.activeElement;
    return !!(el && a && (a === el || el.contains(a)));
  }, id);

  const enterShadow = (id) => page.evaluate((bid) => {
    const el = document.querySelector(`[data-v3-embed="${bid}"]`);
    if (!el || !el.shadowRoot) return false;
    const f = el.shadowRoot.querySelector('a[href],button,input:not([type=hidden]),select,textarea,[tabindex],[contenteditable=true]');
    if (f && f.focus) { f.focus(); return true; }
    return false;
  }, id);
  const ENTER_STEPS = 40;
  const enterByTab = async (id) => {
    await page.evaluate(() => { const a = document.activeElement; if (a && a.blur) a.blur(); }).catch(() => {});
    for (let i = 0; i < ENTER_STEPS; i++) {
      await page.keyboard.press('Tab');
      await page.evaluate(() => new Promise((r) => setTimeout(r, 25))).catch(() => {});
      if (await atBoundary(id)) return true;
    }
    return false;
  };
  const enter = async (b) => (b.kind === 'shadow-root' ? enterShadow(b.id) : enterByTab(b.id));

  const deepKey = async () => {
    let frame = page.mainFrame(); const parts = [];
    for (let depth = 0; depth < 6; depth++) {
      const r = await frame.evaluate(() => {
        let a = document.activeElement; let path = '';
        while (a && a.shadowRoot && a.shadowRoot.activeElement) { path += a.tagName + '>'; a = a.shadowRoot.activeElement; }
        if (!a) return { key: 'none', frame: false };
        const all = a.getRootNode().querySelectorAll('*'); let i = 0; for (; i < all.length; i++) if (all[i] === a) break;
        return { key: path + a.tagName + '#' + i, frame: /^(IFRAME|FRAME|OBJECT|EMBED)$/.test(a.tagName) };
      }).catch(() => null);
      if (!r) return null;
      parts.push(r.key);
      if (!r.frame) break;
      const h = await frame.evaluateHandle(() => document.activeElement).catch(() => null);
      const child = h && h.asElement() ? await h.asElement().contentFrame().catch(() => null) : null;
      if (h) await h.dispose().catch(() => {});

      if (!child) return null;
      frame = child;
    }
    return parts.join('/');
  };
  const HARD_CAP = 150;
  const walkOut = async (b, backward) => {
    if (!(await enter(b))) return { escaped: null };
    if (!(await atBoundary(b.id))) return { escaped: null };
    const budget = (Number.isFinite(b.innerFocusables) ? b.innerFocusables : 8) + margin;
    const seen = new Set();
    for (let i = 0; i < HARD_CAP; i++) {
      if (backward) { await page.keyboard.down('Shift'); await page.keyboard.press('Tab'); await page.keyboard.up('Shift'); }
      else { await page.keyboard.press('Tab'); }
      await page.evaluate(() => new Promise((r) => setTimeout(r, 25))).catch(() => {});
      if (!(await atBoundary(b.id))) return { escaped: true };
      const key = await deepKey();

      if (key == null) { if (i + 1 >= budget) return { escaped: false }; continue; }
      if (seen.has(key)) return { escaped: false };
      seen.add(key);
    }
    return { escaped: null };
  };

  const traps = [];
  const directional = [];
  for (const b of boundaries) {
    const fwd = await walkOut(b, false).catch(() => ({ escaped: null }));
    if (fwd.escaped !== false) continue;
    const bwd = await walkOut(b, true).catch(() => ({ escaped: null }));
    const row = { sc: '2.1.2', xpath: b.xpath, kind: b.kind, innerFocusables: b.innerFocusables, sameOrigin: b.sameOrigin };
    if (bwd.escaped === true) { directional.push(row); continue; }

    let escEscapes = false;
    if (await enter(b)) {
      await page.keyboard.press('Escape');
      await page.evaluate(() => new Promise((r) => setTimeout(r, 60))).catch(() => {});
      escEscapes = !(await atBoundary(b.id));
    }
    if (escEscapes) continue;
    traps.push(row);
  }
  return { traps, directional, boundaries: boundaries.length };
}

module.exports = { parseAdvisory, normalizeAdvisedKey, pressAdvised, ADVISORY_RESERVED, collectTabOrder, tabOrderFindings, redundantStopFacts, detectKeyboardTraps, detectFocusRetentionTraps, detectFixedSetConfinementTraps, detectFocusRejection, detectFocusRestsInAriaHidden, findRevealOpeners, collectRevealedFocusOrder, detectTrapsAfterReveal, detectEmbeddedFormatTraps, REACH_SAFETY_CAP, REFOCUS_SETTLE_MS, TRAP_REGION_SEL, FOCUSABLE_SEL, OPENER_VERB_RE, REVEAL_MARKER_SEL,

  cfPressSettleRead, installCfFocusinLog, tagFocusables,

  probeCloseEscape, regionEscaped, CLOSE_RE,

  focusRejectionProbeOnce };
