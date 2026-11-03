'use strict';

const fs = require('fs');
const LIMITS = require('./limits.js');

const TEXT_FALLBACK_ROLES = /^(paragraph|listitem|cell|columnheader|rowheader|term|definition|code|emphasis|strong|mark|time|deletion|insertion|subscript|superscript|heading)$/i;

async function cdpAxName(cdp, xpath) {
  let objectId = null;
  try {
    const ev = await cdp.send('Runtime.evaluate', { expression: `(function(){var r=document.evaluate(${JSON.stringify(xpath)},document,null,9,null);return r.singleNodeValue;})()`, returnByValue: false });
    if (!ev.result || !ev.result.objectId) return null;
    objectId = ev.result.objectId;
    const { node } = await cdp.send('DOM.describeNode', { objectId });
    if (!node || node.backendNodeId == null) return null;
    const { nodes } = await cdp.send('Accessibility.getAXNodeAndAncestors', { backendNodeId: node.backendNodeId });
    const ax = nodes && nodes[0];
    if (!ax || ax.ignored) return '';
    return ax.name && ax.name.value != null ? String(ax.name.value) : '';
  } catch (e) { return null; }
  finally { if (objectId) await cdp.send('Runtime.releaseObject', { objectId }).catch(() => {}); }
}

async function correctNamesViaCdp(page, result, opts = {}) {
  if (!result || !result.ok || !Array.isArray(result.steps) || !page || typeof page.target !== 'function') return result;
  const cdp = await page.target().createCDPSession().catch(() => null);
  if (!cdp) return result;
  try {
    await cdp.send('Accessibility.enable').catch(() => {});
    const deadline = Date.now() + (Number.isFinite(opts.cdpDeadlineMs) ? opts.cdpDeadlineMs : LIMITS.instruments.vsrCdpDeadlineMs);
    for (const step of result.steps) {
      step.rawPhrase = step.phrase; step.rawName = step.name; step.axName = null;
      if (step.boundary || !step.xpath) continue;
      if (Date.now() > deadline) continue;
      const ax = await cdpAxName(cdp, step.xpath);
      if (ax == null) continue;
      step.axName = ax;
      if (ax !== '') step.name = ax;
      else if (TEXT_FALLBACK_ROLES.test(step.role || '')) step.name = step.visibleText || '';
      else step.name = '';
    }
    result.cdpCorrected = true;
  } finally { await cdp.detach().catch(() => {}); }
  return result;
}

const VSR_BUILD = require.resolve('@guidepup/virtual-screen-reader/browser.js');
let vsrSrc = null;
function vsrSource() { if (vsrSrc == null) vsrSrc = fs.readFileSync(VSR_BUILD, 'utf8'); return vsrSrc; }

async function ensureVsr(page) {
  const has = await page.evaluate(() => !!window.__vsr).catch(() => false);
  if (has) return true;
  return page.evaluate(async (src) => {
    try {
      const blob = new Blob([src], { type: 'text/javascript' });
      const url = URL.createObjectURL(blob);
      const mod = await import(url);
      window.__vsr = mod.virtual;
      return !!window.__vsr;
    } catch (e) { return false; }
  }, vsrSource()).catch(() => false);
}

const ROLE_LEAD = '^(heading|navigation|link|button|textbox|searchbox|checkbox|radio|switch|combobox|listbox|list|listitem|article|region|main|banner|contentinfo|complementary|form|search|figure|table|row|cell|columnheader|rowheader|dialog|alertdialog|menu|menuitem|menubar|menuitemcheckbox|menuitemradio|tab|tablist|tabpanel|slider|spinbutton|progressbar|status|alert|img|image|separator|group|document|application|tooltip|tree|treeitem|grid|gridcell|option|paragraph|blockquote|code|emphasis|strong|note|term|definition|generic|section|heading level)\\b';

async function collectVsrTranscript(page, opts = {}) {
  const ok = await ensureVsr(page);
  if (!ok) return { ok: false, reason: 'vsr-injection-failed', steps: [], totalSteps: 0, reachedEnd: false, stoppedEarly: false, wrapped: false, stuckXpath: null };
  const cap = Number.isFinite(opts.maxSteps) ? opts.maxSteps : LIMITS.instruments.vsrMaxSteps;
  const deadlineMs = Number.isFinite(opts.deadlineMs) ? opts.deadlineMs : LIMITS.instruments.vsrWalkDeadlineMs;
  const result = await page.evaluate(async (cap, deadlineMs, ROLE_SRC) => {
    const ROLE_RE = new RegExp(ROLE_SRC, 'i');
    const vsr = window.__vsr;
    const getXPath = (e) => {
      if (!e || !e.tagName) return '';
      if (e === document.body) return '/html/body';
      if (e === document.documentElement) return '/html';
      const ns = e.namespaceURI;
      const isHtml = !ns || ns === 'http://www.w3.org/1999/xhtml';
      const t = isHtml ? e.tagName.toLowerCase() : e.tagName;
      let idx = 1, sib = e.previousElementSibling;
      while (sib) { if (sib.tagName === e.tagName) idx++; sib = sib.previousElementSibling; }
      return getXPath(e.parentElement) + (isHtml ? '/' + t + '[' + idx + ']' : "/*[local-name()='" + t + "'][" + idx + ']');
    };
    const toEl = (n) => { while (n && !n.tagName) n = n.parentNode; return n; };
    const inNoscript = (n) => { const e = toEl(n); return !!(e && e.closest && e.closest('noscript')); };

    const STATE_RE = /^(has popup\b|not expanded|expanded|collapsed|not checked|checked|partially checked|mixed|not selected|selected|not pressed|pressed|disabled|required|invalid|busy|read[ -]?only|multi[ -]?line|not editable|editable|current\b|level \d|position \d|set ?size \d|out of \d|orientation\b|value \d)/i;

    const parse = (phrase) => {
      const p = (phrase || '').trim();
      const low = p.toLowerCase();
      if (low === 'document' || low === 'web area') return { boundary: 'enter', role: low, name: '', states: '' };
      if (low.startsWith('end of ')) return { boundary: 'exit', role: low.slice(7), name: '', states: '' };
      const ci = p.indexOf(', ');
      if (ci > 0 && ROLE_RE.test(p.slice(0, ci))) {
        const role = p.slice(0, ci);
        const parts = p.slice(ci + 2).split(', ');

        if (STATE_RE.test(parts[0] || '')) return { boundary: null, role, name: '', states: parts.join(', ') };
        return { boundary: null, role, name: parts[0] || '', states: parts.slice(1).join(', ') };
      }
      if (ROLE_RE.test(p) && !p.includes(' ')) return { boundary: null, role: p, name: '', states: '' };
      return { boundary: null, role: '', name: p, states: '' };
    };

    try { await vsr.start({ container: document.body }); }
    catch (e) { return { ok: false, reason: 'vsr-start-failed', steps: [], totalSteps: 0, reachedEnd: false, stoppedEarly: false, wrapped: false, stuckXpath: null }; }

    const steps = [];
    const seenKeys = new Set();

    let reachedEnd = false, stoppedEarly = false, wrapped = false, stuckXpath = null, timedOut = false;
    const t0 = Date.now();
    for (let i = 0; i < cap; i++) {
      if (Date.now() - t0 > deadlineMs) { timedOut = true; break; }
      const node = vsr.activeNode;
      const phrase = await vsr.lastSpokenPhrase();
      const low = (phrase || '').toLowerCase();
      if (low === 'end of document' || low.startsWith('end of web area')) { reachedEnd = true; break; }
      if (node && inNoscript(node)) {
        await vsr.next();
        if (!vsr.activeNode) { reachedEnd = true; break; }
        continue;
      }
      const el = toEl(node);
      const xp = el ? getXPath(el) : '';

      const key = xp + '|' + (phrase || '');
      if (seenKeys.has(key)) { wrapped = true; break; }
      seenKeys.add(key);
      const pr = parse(phrase);

      let rect = null, visibleText = '', interactive = false;
      if (el && el.getBoundingClientRect) {
        const r = el.getBoundingClientRect();

        let pinned = false;
        for (let e = el; e && e !== document.body; e = e.parentElement) {
          const pos = getComputedStyle(e).position;
          if (pos === 'fixed' || pos === 'sticky') { pinned = true; break; }
        }
        rect = { x: Math.round(pinned ? r.left : r.left + window.scrollX), y: Math.round(pinned ? r.top : r.top + window.scrollY), w: Math.round(r.width), h: Math.round(r.height) };
        visibleText = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80);
        interactive = !!(el.matches && el.matches('a[href],button,input,select,textarea,summary,[tabindex],[role=button],[role=link],[role=checkbox],[role=tab],[role=menuitem],[onclick]'));
      }
      steps.push({ index: steps.length, xpath: xp, tag: (el && el.tagName) ? el.tagName.toLowerCase() : null, phrase: phrase || '', role: pr.role, name: pr.name, states: pr.states, boundary: pr.boundary, rect, visibleText, interactive });

      const before = node;
      await vsr.next();
      const nn = vsr.activeNode;
      if (!nn) { reachedEnd = true; break; }
      if (nn === before) { stoppedEarly = true; stuckXpath = xp; break; }
    }
    try { await vsr.stop(); } catch (e) {}
    if (!reachedEnd && !stoppedEarly && !wrapped) timedOut = true;
    return { ok: true, steps, totalSteps: steps.length, reachedEnd, stoppedEarly, wrapped, stuckXpath, timedOut };
  }, cap, deadlineMs, ROLE_LEAD).catch((e) => ({ ok: false, reason: 'evaluate-failed: ' + (e && e.message), steps: [], totalSteps: 0, reachedEnd: false, stoppedEarly: false, wrapped: false, stuckXpath: null, timedOut: false }));

  if (opts.cdpCorrect === false) return result;
  return correctNamesViaCdp(page, result, opts);
}

module.exports = { ensureVsr, collectVsrTranscript, correctNamesViaCdp, cdpAxName, TEXT_FALLBACK_ROLES, VSR_BUILD };
