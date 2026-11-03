'use strict';

async function queryAxNode(page, args) {
  const { targetXpath, x, y } = args || {};
  const cdp = await page.createCDPSession();
  try {
    await cdp.send('DOM.enable').catch(() => {});
    await cdp.send('Accessibility.enable').catch(() => {});
    await cdp.send('DOM.getDocument', { depth: -1 }).catch(() => {});
    let backendNodeId = null, resolvedXpath = targetXpath || null;
    const isCoordPath = Number.isFinite(x) && Number.isFinite(y);
    if (isCoordPath) {
      const { backendNodeId: b } = await cdp.send('DOM.getNodeForLocation', { x: Math.round(x), y: Math.round(y), includeUserAgentShadowDOM: false }).catch(() => ({}));
      backendNodeId = b || null;
    } else if (typeof targetXpath === 'string' && targetXpath) {

      const ev = await cdp.send('Runtime.evaluate', { expression: `(function(){var nsf=function(s){return s.split('/').map(function(p){var m=p.match(/^([a-zA-Z][\\w-]*)(\\[[0-9]+\\])?$/);return m?'*[local-name()="'+m[1]+'"]'+(m[2]||''):p;}).join('/');};if(window.__ia&&window.__ia.resolve)return window.__ia.resolve(${JSON.stringify(targetXpath)});var parts=${JSON.stringify(targetXpath)}.split('>>');var doc=document,el=null;for(var i=0;i<parts.length;i++){if(!doc)return null;var part=parts[i].indexOf('frame/')===0?parts[i].slice(5):parts[i];var r=doc.evaluate(part,doc,null,9,null);el=r.singleNodeValue;if(!el){try{el=doc.evaluate(nsf(part),doc,null,9,null).singleNodeValue;}catch(e){el=null;}}if(!el)return null;if(i<parts.length-1){try{doc=el.contentDocument;}catch(e){return null;}}}return el;})()`, returnByValue: false }).catch(() => ({}));
      if (ev && ev.result && ev.result.objectId) { const { node } = await cdp.send('DOM.describeNode', { objectId: ev.result.objectId }).catch(() => ({})); backendNodeId = node ? node.backendNodeId : null; }
    }
    if (!backendNodeId) return { resolved: false, reason: 'node not found at the given xpath/coordinate' };
    const { nodes } = await cdp.send('Accessibility.getPartialAXTree', { backendNodeId, fetchRelatives: false }).catch(() => ({ nodes: [] }));
    const ax = (nodes || [])[0];
    if (!ax) return { resolved: true, inTree: false, reason: 'node has no accessibility object (ignored / presentational)' };
    const prop = (name) => { const p = (ax.properties || []).find((q) => q.name === name); return p ? p.value && p.value.value : undefined; };

    const nameFrom = ((ax.name && ax.name.sources) || []).filter((s) => s && !s.superseded && s.value && s.value.value != null && String(s.value.value).length).map((s) => s.type || s.attribute).filter(Boolean);
    const role = (ax.role && ax.role.value) || null;

    const ROLE_REQUIRES = { checkbox: ['aria-checked'], radio: ['aria-checked'], switch: ['aria-checked'], menuitemcheckbox: ['aria-checked'], menuitemradio: ['aria-checked'], combobox: ['aria-expanded'] };
    const STATE_ATTRS = ['aria-checked', 'aria-expanded', 'aria-pressed', 'aria-selected'];
    let requiredStatesPresent, requiredStatesMissing;
    if (!isCoordPath && resolvedXpath) {
      const live = await page.evaluate((xp, attrs) => { const el = (window.__ia?.resolve ? window.__ia.resolve(xp) : document.evaluate(xp, document, null, 9, null).singleNodeValue); if (!el) return null; const present = {}; for (const a of attrs) present[a] = el.hasAttribute(a); const nativeConveys = (el.tagName === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio')) || el.tagName === 'DETAILS' || el.tagName === 'OPTION' || el.tagName === 'SELECT'; return { present, explicitRole: el.getAttribute('role'), nativeConveys }; }, resolvedXpath, STATE_ATTRS).catch(() => null);
      if (live) {
        requiredStatesPresent = STATE_ATTRS.filter((a) => live.present[a]).map((a) => a.replace('aria-', ''));

        const need = (live.explicitRole && !live.nativeConveys) ? (ROLE_REQUIRES[role] || []) : [];
        requiredStatesMissing = need.filter((a) => !live.present[a]).map((a) => a.replace('aria-', ''));
      } else { requiredStatesPresent = []; requiredStatesMissing = null; }
    } else {
      requiredStatesPresent = ['checked', 'expanded', 'pressed', 'selected'].filter((s) => prop(s) !== undefined);
      requiredStatesMissing = null;
    }

    const idrefStatus = async (attr) => {
      if (isCoordPath || !resolvedXpath) return 'unresolved-on-coordinate-path';
      const raw = await page.evaluate((xp, a) => {
        const el = (window.__ia?.resolve ? window.__ia.resolve(xp) : document.evaluate(xp, document, null, 9, null).singleNodeValue);
        if (!el) return null;
        const v = el.getAttribute(a); const root = el.getRootNode();
        if (!v) return null;
        return v.trim().split(/\s+/).map((id) => ({ id, present: !!root.getElementById(id), hasText: !!(root.getElementById(id) && (root.getElementById(id).textContent || '').trim()) }));
      }, resolvedXpath, attr).catch(() => null);
      return raw;
    };
    const labelledby = await idrefStatus('aria-labelledby');
    const describedby = await idrefStatus('aria-describedby');

    const cellHeaders = (isCoordPath || !resolvedXpath) ? undefined : await page.evaluate((xp) => {
      const start = (window.__ia?.resolve ? window.__ia.resolve(xp) : document.evaluate(xp, document, null, 9, null).singleNodeValue);
      if (!start || !start.closest) return undefined;
      const root = start.getRootNode();
      const cell = start.closest('td,th,[role=cell],[role=gridcell],[role=columnheader],[role=rowheader]');
      if (!cell) return undefined;
      const table = cell.closest('table,[role=table],[role=grid],[role=treegrid]');
      if (!table) return undefined;
      const txt = (n) => (n && (n.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200)) || '';
      const isHeaderCell = (c) => c.tagName === 'TH' || /\b(columnheader|rowheader)\b/.test(c.getAttribute('role') || '');
      const out = { inDataTable: false, headerSource: 'none', colHeaders: [], rowHeaders: [], cellText: txt(cell), cellIsHeader: isHeaderCell(cell) };
      out.inDataTable = !!table.querySelector('th,[role=columnheader],[role=rowheader]') || /\b(grid|treegrid)\b/.test(table.getAttribute('role') || '');

      const hids = (cell.getAttribute('headers') || '').trim().split(/\s+/).filter(Boolean);
      if (hids.length) {
        out.headerSource = 'headers-attr';
        out.danglingHeaderIds = hids.filter((id) => !root.getElementById(id));
        const hs = hids.map((id) => root.getElementById(id)).filter(Boolean);
        for (const h of hs) {
          const sc = (h.getAttribute('scope') || '').toLowerCase();
          (sc === 'row' ? out.rowHeaders : out.colHeaders).push(txt(h));
        }
        return out;
      }

      const rows = table.rows ? [...table.rows] : [...table.querySelectorAll('[role=row]')];
      const rowCells = (r) => (r.cells ? [...r.cells] : [...r.querySelectorAll('td,th,[role=cell],[role=gridcell],[role=columnheader],[role=rowheader]')]);
      const span = (c, a, b) => Math.max(1, c[a] || parseInt(c.getAttribute(b), 10) || 1);
      const occ = {}, cellPos = new Map();
      for (let r = 0; r < rows.length; r++) {
        let cpos = 0;
        for (const cc of rowCells(rows[r])) {
          while (occ[r + ',' + cpos]) cpos++;
          const cs = span(cc, 'colSpan', 'aria-colspan'), rs = span(cc, 'rowSpan', 'aria-rowspan');
          cellPos.set(cc, { r, c: cpos, rs, cs });
          for (let dr = 0; dr < rs; dr++) for (let dc = 0; dc < cs; dc++) occ[(r + dr) + ',' + (cpos + dc)] = cc;
          cpos += cs;
        }
      }
      const pos = cellPos.get(cell);
      if (pos) {
        const seenC = {}, seenR = {};
        for (const [hc, p] of cellPos) {
          if (hc === cell || !isHeaderCell(hc)) continue;
          const coversCol = p.c <= pos.c && pos.c < p.c + p.cs;
          const coversRow = p.r <= pos.r && pos.r < p.r + p.rs;
          if (p.r < pos.r && coversCol) { const t = txt(hc); if (t && !seenC[t]) { seenC[t] = 1; out.colHeaders.push(t); out.headerSource = 'positional'; } }
          else if (p.c < pos.c && coversRow) { const t = txt(hc); if (t && !seenR[t]) { seenR[t] = 1; out.rowHeaders.push(t); out.headerSource = 'positional'; } }
        }
        if (out.headerSource === 'positional' && (table.querySelector('th[scope=col],th[scope=row]'))) out.headerSource = 'scope';
        out.rowHeaders = out.rowHeaders.slice(0, 4); out.colHeaders = out.colHeaders.slice(0, 4);
      }
      return out;
    }, resolvedXpath).catch(() => undefined);
    return {
      resolved: true,
      inTree: !ax.ignored,
      role,
      roleSource: ax.role && ax.role.type || null,
      headingLevel: prop('level') != null ? prop('level') : null,
      nameFrom,
      labelledby, describedby,
      ...(cellHeaders ? { cellHeaders } : {}),
      focusable: prop('focusable') === true,
      isAriaHidden: (ax.ignoredReasons || []).some((r) => r && (r.name === 'ariaHiddenElement' || r.name === 'ariaHiddenSubtree')),
      requiredStatesPresent,
      requiredStatesMissing,
      ignoredReasons: (ax.ignoredReasons || []).map((r) => r && r.name).filter(Boolean),

      ignoredByActiveModal: (ax.ignoredReasons || []).some((r) => r && (r.name === 'activeModalDialog' || r.name === 'inertSubtree')),
    };
  } finally { try { await cdp.detach(); } catch (e) {} }
}

async function observeStateAfterActivation(page, args, ctx) {
  if (typeof args?.targetXpath !== 'string' || !args.targetXpath) return {error:'targetXpath required'};
  const kind = await page.evaluate(xp => {
    const e = window.__ia?.resolve ? window.__ia.resolve(xp) : document.evaluate(xp,document,null,9,null).singleNodeValue;
    if (!e) return null;
    if (e.closest('a[href]')) return 'navigating-link';
    return e.form && /^(submit|image)$/i.test(e.type) ? 'form-submit' : 'in-page';
  }, args.targetXpath);
  const result = await interactAndObserve(page,{actions:[{op:'click',xpath:args.targetXpath}],settleMs:args.settleMs},ctx);
  if (result.error) return {...result,activationKind:kind};
  if (!result.observationComplete) return {...result,error:'Activation was not achieved; no negative inference is supported.'};
  return {...result,...result.delta,activationKind:kind,navigated:result.blockedNavigations>0,
    newWindow:null,focusMovedToChange:result.delta.focusMovedIntoRevealedContent};
}

const _KEY_MOD = { ctrl: 'Control', control: 'Control', alt: 'Alt', option: 'Alt', shift: 'Shift', cmd: 'Meta', command: 'Meta', meta: 'Meta', win: 'Meta', super: 'Meta' };
function _normKey(k) {
  const m = { esc: 'Escape', escape: 'Escape', enter: 'Enter', return: 'Enter', tab: 'Tab', space: ' ', spacebar: ' ', del: 'Delete', delete: 'Delete', backspace: 'Backspace' };
  const low = String(k).toLowerCase();
  if (m[low]) return m[low];
  if (/^f([1-9]|1[0-2])$/i.test(k)) return k.toUpperCase();
  if (k.length === 1) return /[A-Za-z]/.test(k) ? k.toLowerCase() : k;
  return k;
}

async function pointerTarget(live, xp) {
      await live.evaluate(x => {
        const result = !window.__ia?.resolveAll && document.evaluate(x,document,null,XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,null);
        const nodes = window.__ia?.resolveAll ? window.__ia.resolveAll(x) : Array.from({length:result.snapshotLength},(_,i)=>result.snapshotItem(i));
        if (nodes.length !== 1) throw new Error(`pointer target matched ${nodes.length} nodes`);
        nodes[0].scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      }, xp);
      await new Promise(r => setTimeout(r, 70));
      return live.evaluate(xpath => {
        const result = !window.__ia?.resolveAll && document.evaluate(xpath,document,null,XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,null);
        const nodes = window.__ia?.resolveAll ? window.__ia.resolveAll(xpath) : Array.from({length:result.snapshotLength},(_,i)=>result.snapshotItem(i));
        if (nodes.length !== 1) throw new Error('pointer target changed during scroll');
        const el = nodes[0], doc = el.ownerDocument, win = doc.defaultView;
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1 || !el.checkVisibility({checkVisibilityCSS:true,checkOpacity:true}))
          throw new Error('pointer target is not visible');
        const x = (Math.max(0, r.left) + Math.min(win.innerWidth, r.right)) / 2;
        const y = (Math.max(0, r.top) + Math.min(win.innerHeight, r.bottom)) / 2;
        let hit = doc.elementFromPoint(x, y);
        while (hit?.shadowRoot) { const inner=hit.shadowRoot.elementFromPoint(x,y); if(!inner || inner===hit)break; hit=inner; }
        if (x < 0 || y < 0 || x >= win.innerWidth || y >= win.innerHeight || !hit || !(hit === el || el.contains(hit)))
          throw new Error('pointer target is clipped or occluded');
        let px = x, py = y, w = win;
        while (w !== window) {
          const frame = w.frameElement;
          if (!frame) throw new Error('pointer frame coordinates unavailable');
          const fr = frame.getBoundingClientRect();
          px += fr.left + frame.clientLeft; py += fr.top + frame.clientTop;
          const outerHit = frame.ownerDocument.elementFromPoint(px, py);
          if (outerHit !== frame) throw new Error('pointer frame is occluded');
          w = frame.ownerDocument.defaultView;
        }
        return { x:px, y:py, hitTag:hit.tagName.toLowerCase(), hitId:hit.id || null };
      }, xp);
    }

const _MAX_ACTIONS = 16;
async function interactAndObserve(page, args, ctx) {
  const acts = Array.isArray(args && args.actions) ? args.actions : [];
  if (!acts.length) return { error: 'actions[] required ({op:type|click|press|focus|clear, xpath?, text?, key?})' };
  const cap = Math.max(1, Math.min(_MAX_ACTIONS, Number(args.maxActions) || _MAX_ACTIONS));
  if (acts.length > cap) return { error: `too many actions (${acts.length} > cap ${cap})` };
  const VALID_OPS = new Set(['type', 'click', 'press', 'focus', 'clear', 'hover', 'move', 'drag', 'wait']);
  for (const a of acts) { if (!a || !VALID_OPS.has(a.op)) return { error: `invalid op ${JSON.stringify(a && a.op)} — one of type|click|press|focus|clear|hover|move|drag` }; }
  const MOUSE_OPS = new Set(['hover', 'move', 'drag']);
  if (!ctx || typeof ctx.freshClone !== 'function') return { error: 'fresh clone unavailable — this mutating tool refuses to touch the shared page' };
  const live = await ctx.freshClone();

  const dialogs = [], dialogStart = (live.__dialogs || []).length;
  const onDialog = d => { dialogs.push({ type: d.type(), message: d.message() }); d.dismiss().catch(() => {}); };
  if (!Array.isArray(live.__dialogs)) live.on('dialog', onDialog);
  const LIVE_SEL = '[aria-live="polite"],[aria-live="assertive"],[role=status],[role=alert],[role=log],[role=alertdialog],output';
  let blockedNavigations = 0, onRequest;
  try {
    const startUrl = live.url();

    await live.setRequestInterception(true).catch(() => {});
    onRequest = (req) => {
      let block = false;
      try { if (req.isNavigationRequest() && req.frame() === live.mainFrame()) block = true; } catch (e) { block = false; }
      if (block) { blockedNavigations++; req.abort().catch(() => {}); } else req.continue().catch(() => {});
    };
    live.on('request', onRequest);
    await live.evaluate(() => {
      window.__iaInteractionEvents = [];
      window.__iaInteractionController?.abort();
      window.__iaInteractionController = new AbortController();
      for (const type of ['invalid', 'submit']) document.addEventListener(type, e => {
        const el = e.target;
        window.__iaInteractionEvents.push({ type, tag: el.tagName?.toLowerCase(),
          id: el.id || null, xpath:window.__ia?.xpathOf(el) || null, validationMessage: el.validationMessage || null });
        if (type === 'submit') e.preventDefault();
      }, {capture:true,signal:window.__iaInteractionController.signal});
    });

    const before = await live.evaluate(() => {
      const _vis = (el) => { try { return el.checkVisibility({ checkVisibilityCSS: true, checkOpacity: true }) && !el.closest('[aria-hidden="true"]'); } catch (e) { const cs = getComputedStyle(el); return cs.display !== 'none' && cs.visibility !== 'hidden' && !el.closest('[aria-hidden="true"]'); } };
      const _xp = (el) => { if (!el || el.nodeType !== 1) return null; const p = []; for (let n = el; n && n.nodeType === 1; n = n.parentElement) { let i = 1; for (let s = n.previousElementSibling; s; s = s.previousElementSibling) if (s.tagName === n.tagName) i++; p.unshift(n.tagName.toLowerCase() + '[' + i + ']'); } return '/' + p.join('/'); };
      const texts = new Set();
      window.__iaInteractionBeforeTexts = new WeakMap();
      for (const el of document.querySelectorAll('body *')) {
        el.setAttribute('data-v3-pre', '1');
        const cs = getComputedStyle(el);
        el.setAttribute('data-v3-pv', (cs.display === 'none' ? 'd' : '') + (cs.visibility === 'hidden' ? 'v' : '') + (el.closest('[aria-hidden="true"]') ? 'a' : '') + (!_vis(el) ? 'h' : ''));
        if (_vis(el)) {
          const own=[...el.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent.trim()).filter(Boolean);
          window.__iaInteractionBeforeTexts.set(el,own); for(const t of own)texts.add(t);
        }
      }
      const fieldState = (el) => ({ xpath: _xp(el), ariaInvalid: el.getAttribute('aria-invalid'), valid: (el.validity ? el.validity.valid : null), cssInvalid: (el.matches ? el.matches(':invalid') : null) });
      const fields = [...document.querySelectorAll('input,select,textarea')].map(fieldState);
      return { url: location.href, active: _xp(document.activeElement), texts: [...texts], fields };
    });

    const centerOf = xp => pointerTarget(live,xp);

    const settle = async () => live.evaluate((maxMs) => new Promise(resolve => {
      const begin = performance.now(); let last = begin;
      const observer = new MutationObserver(() => { last = performance.now(); });
      observer.observe(document, {subtree:true,attributes:true,childList:true,characterData:true});
      const tick = setInterval(() => {
        const now = performance.now();
        if ((now-begin >= 500 && now-last >= 150) || now-begin >= maxMs) {
          observer.disconnect(); clearInterval(tick);
          resolve({elapsedMs:Math.round(now-begin),timedOut:now-begin >= maxMs});
        }
      }, 25);
    }), Math.max(500, Math.min(10000, Number(args.settleMs) || 2500)));
    const snapRevealed = () => live.evaluate(() => {
      const _vis = (el) => { try { return el.checkVisibility({ checkVisibilityCSS: true, checkOpacity: true }) && !el.closest('[aria-hidden="true"]'); } catch (e) { const cs = getComputedStyle(el); return cs.display !== 'none' && cs.visibility !== 'hidden' && !el.closest('[aria-hidden="true"]'); } };
      const _xp = (el) => { if (!el || el.nodeType !== 1) return null; const p = []; for (let n = el; n && n.nodeType === 1; n = n.parentElement) { let i = 1; for (let s = n.previousElementSibling; s; s = s.previousElementSibling) if (s.tagName === n.tagName) i++; p.unshift(n.tagName.toLowerCase() + '[' + i + ']'); } return '/' + p.join('/'); };
      const out = [], seen = new Set();
      for (const el of document.querySelectorAll('body *')) {
        if (!_vis(el)) continue;
        const pre = el.hasAttribute('data-v3-pre'), pv = el.getAttribute('data-v3-pv') || '';
        if (pre && !(pv.includes('d') || pv.includes('v') || pv.includes('a') || pv.includes('h'))) continue;
        let t = ''; for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent.trim()) { t = n.textContent.trim(); break; }
        if (!t || seen.has(t)) continue; seen.add(t);
        out.push({ xpath: _xp(el), text: t.slice(0, 60) });
        if (out.length >= 8) break;
      }
      return out;
    });

    const steps = [];
    for (const a of acts) {
      try {
        if (a.op !== 'click' && a.op !== 'wait' && !MOUSE_OPS.has(a.op)) {
          const found = await live.evaluate((xp) => { const el = xp ? (window.__ia?.resolve ? window.__ia.resolve(xp) : document.evaluate(xp, document, null, 9, null).singleNodeValue) : document.activeElement; if (!el) return false; if (xp) { el.focus(); return el.getRootNode().activeElement === el; } return true; }, a.xpath || null);
          if (!found) { steps.push({ op: a.op, xpath: a.xpath || null, ok: false, note: 'element missing or focus not achieved' }); continue; }
        }

        if (MOUSE_OPS.has(a.op)) {
          const c = await centerOf(a.xpath || null);
          if (!c) { steps.push({ op: a.op, xpath: a.xpath || null, ok: false, note: 'element not found / zero-size' }); await new Promise((r) => setTimeout(r, 70)); continue; }
          if (a.op === 'hover') { await live.mouse.move(c.x, c.y, { steps: 3 }); }
          else if (a.op === 'move') { await live.mouse.move(c.x, c.y, { steps: 16 }); }
          else if (a.op === 'drag') {
            await live.mouse.move(c.x,c.y,{steps:2}); await live.mouse.down();
            try { const to=await centerOf(a.toXpath || null); await live.mouse.move(to.x,to.y,{steps:16}); }
            finally { await live.mouse.up(); }
          }
          steps.push({ op: a.op, xpath: a.xpath || null, toXpath: a.op === 'drag' ? (a.toXpath || null) : undefined, pointerAt: { x: c.x, y: c.y }, ok: true });
        }
        else if (a.op === 'wait') await new Promise(r => setTimeout(r, Math.max(0, Math.min(10000, Number(a.waitMs) || 500))));
        else if (a.op === 'clear') await live.evaluate(() => { const el = document.activeElement; if (el && 'value' in el) { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); } });
        else if (a.op === 'type') await live.keyboard.type(String(a.text == null ? '' : a.text).slice(0, 200), { delay: 0 });
        else if (a.op === 'press') {

          const parts = String(a.key || 'Enter').split('+').map((s) => s.trim()).filter(Boolean);
          const mods = [], plain = [];
          for (const pp of parts) { const mm = _KEY_MOD[pp.toLowerCase()]; if (mm) { if (!mods.includes(mm)) mods.push(mm); } else plain.push(pp); }
          const k = plain.length ? _normKey(plain[plain.length - 1]) : null;
          if (!k && !mods.length) { steps.push({ op: a.op, key: a.key || null, ok: false, note: `could not parse a key from "${a.key}"` }); continue; }
          for (const mm of mods) await live.keyboard.down(mm);

          const holdMs = Math.max(0, Math.min(3000, Number(a.holdMs) || 0));
          if (k && holdMs > 0) { await live.keyboard.down(k); await new Promise((r) => setTimeout(r, holdMs)); await live.keyboard.up(k); }
          else if (k) await live.keyboard.press(k);
          for (const mm of [...mods].reverse()) await live.keyboard.up(mm);
        }
        else if (a.op === 'click') { const c = await centerOf(a.xpath); await live.mouse.click(c.x, c.y); }
        if (!MOUSE_OPS.has(a.op)) steps.push({ op: a.op, xpath: a.xpath || null, key: a.key || undefined, typed: a.op === 'type' ? String(a.text == null ? '' : a.text).slice(0, 60) : undefined, ok: true });
      } catch (e) { steps.push({ op: a.op, xpath: a.xpath || null, ok: false, note: String((e && e.message) || e).slice(0, 80) }); }
      let settling;
      try { settling = await settle(); }
      catch (e) {
        return {error:'After-action observation unavailable: '+String(e.message),
          observationComplete:false,afterUnavailable:true,steps,successfulActions:steps.filter(s=>s.ok).length,
          failedActions:steps.filter(s=>!s.ok),blockedNavigations,delta:null};
      }
      if (steps.length) steps[steps.length-1].settling = settling;

      const last = steps[steps.length - 1];

      if (last) last.activeAfter = await live.evaluate(() => {
        const path = (a2) => { const p = []; for (let n = a2; n && n.nodeType === 1; n = n.parentElement) { let i = 1; for (let s = n.previousElementSibling; s; s = s.previousElementSibling) if (s.tagName === n.tagName) i++; p.unshift(n.tagName.toLowerCase() + '[' + i + ']'); } return '/' + p.join('/'); };
        let a2 = document.activeElement; if (!a2 || a2.nodeType !== 1) return null;
        let out = path(a2);
        for (let d = 0; d < 4 && /^i?frame$/i.test(a2.tagName); d++) {
          let doc = null; try { doc = a2.contentDocument; } catch (e) { doc = null; }
          if (!doc) return out + ' (focus is inside a cross-origin frame; movement inside it is not observable)';
          const inner = doc.activeElement;
          if (!inner || inner === doc.body || inner === doc.documentElement) return out;
          out += '>>frame' + path(inner); a2 = inner;
        }
        return out;
      }).catch(() => null);

      if (last && last.ok) last.revealedNow = await snapRevealed().catch(() => undefined);
    }

    const after = await live.evaluate((beforeTexts, beforeFields, liveSel) => {
      const _vis = (el) => { try { return el.checkVisibility({ checkVisibilityCSS: true, checkOpacity: true }) && !el.closest('[aria-hidden="true"]'); } catch (e) { const cs = getComputedStyle(el); return cs.display !== 'none' && cs.visibility !== 'hidden' && !el.closest('[aria-hidden="true"]'); } };
      const _xp = (el) => { if (!el || el.nodeType !== 1) return null; const p = []; for (let n = el; n && n.nodeType === 1; n = n.parentElement) { let i = 1; for (let s = n.previousElementSibling; s; s = s.previousElementSibling) if (s.tagName === n.tagName) i++; p.unshift(n.tagName.toLowerCase() + '[' + i + ']'); } return '/' + p.join('/'); };
      const beforeSet = new Set(beforeTexts), seen = new Set(), newlyVisible = [];
      const activeEl = document.activeElement; let focusMoved = false;
      for (const el of document.querySelectorAll('body *')) {
        if (!_vis(el)) continue;
        for (const n of el.childNodes) {
          if (n.nodeType !== 3) continue; const t = n.textContent.trim();
          const identity = _xp(el)+'|'+t;
          if (!t || (window.__iaInteractionBeforeTexts?.get(el) || []).includes(t) || seen.has(identity)) continue; seen.add(identity);
          if (newlyVisible.length >= 16) continue;
          const preExisted = el.hasAttribute('data-v3-pre');
          const pv = el.getAttribute('data-v3-pv') || '';
          const cause = !preExisted ? 'inserted' : pv.includes('d') ? 'display' : pv.includes('v') ? 'visibility' : pv.includes('a') ? 'aria-hidden' : pv.includes('h') ? 'perceivability' : 'text-changed';
          const liveAnc = el.closest(liveSel);
          newlyVisible.push({ xpath: _xp(el), text: t.slice(0, 80), visibilityCause: cause, inLiveRegion: !!liveAnc, liveRegionPreExisted: !!(liveAnc && liveAnc.hasAttribute('data-v3-pre')) });
        }
      }
      if (activeEl) focusMoved = true;

      const beforeByXp = {}; for (const f of beforeFields) beforeByXp[f.xpath] = f;
      const resolveIds = (el, attr) => (el.getAttribute(attr) || '').split(/\s+/).filter(Boolean).map((id) => { const t = document.getElementById(id); return t ? (t.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120) : null; }).filter(Boolean);
      const invalidFields = [];
      for (const el of [...document.querySelectorAll('input,select,textarea')]) {
        const xp = _xp(el);
        const v = el.validity ? el.validity.valid : null;
        const ai = el.getAttribute('aria-invalid');
        const cssInvalid = el.matches ? el.matches(':invalid') : null;
        const wasValid = !beforeByXp[xp] || beforeByXp[xp].valid !== false;
        const nowInvalid = v === false || ai === 'true' || cssInvalid === true;
        if (!nowInvalid) continue;
        const errFromErrmsg = resolveIds(el, 'aria-errormessage');
        const errFromDesc = resolveIds(el, 'aria-describedby');
        const associatedErrorText = [...errFromErrmsg, ...errFromDesc];
        invalidFields.push({
          xpath: xp, becameInvalid: nowInvalid && wasValid,
          constraintInvalid: v === false, ariaInvalid: ai === 'true', cssInvalid: cssInvalid === true,
          validationMessage: (el.validationMessage || '').slice(0, 160) || null,
          fieldVisible:_vis(el), associatedErrorText, errorAssociated: associatedErrorText.length > 0,
          via: errFromErrmsg.length ? 'aria-errormessage' : errFromDesc.length ? 'aria-describedby' : null,
        });
      }
      let focusMovedIntoRevealedContent=false;
      for(let e=activeEl;e;e=e.parentElement) if(e.hasAttribute('data-v3-pv') && e.getAttribute('data-v3-pv')) focusMovedIntoRevealedContent=true;
      return { url: location.href, active: _xp(activeEl), newlyVisible, focusMoved, invalidFields, focusMovedIntoRevealedContent };
    }, before.texts, before.fields, LIVE_SEL);

    const events = await live.evaluate(() => window.__iaInteractionEvents || []);
    const dialogMessages = Array.isArray(live.__dialogs) ? live.__dialogs.slice(dialogStart) : dialogs;
    return {
      observationComplete: steps.every(s => s.ok && !s.settling?.timedOut), successfulActions: steps.filter(s => s.ok).length,
      failedActions: steps.filter(s => !s.ok), events, dialogMessages,
      ranActions: steps.length, steps,
      blockedNavigations,
      delta: {
        urlChanged: before.url !== after.url,
        focusMovedTo: before.active !== after.active ? after.active : null,
        focusMovedIntoRevealedContent:before.active !== after.active && after.focusMovedIntoRevealedContent,
        newlyVisibleNodes: after.newlyVisible, newVisibleTextCount: after.newlyVisible.length,
        anyNewTextInLiveRegion: after.newlyVisible.some((n) => n.inLiveRegion && n.liveRegionPreExisted),
        anyNewTextInNewLiveRegion: after.newlyVisible.some((n) => n.inLiveRegion && !n.liveRegionPreExisted),
        invalidFields: after.invalidFields,
        feedbackObservation: { status: steps.every(s => s.ok) ? 'observed' : 'incomplete',
          newVisibleText: after.newlyVisible, dialogMessages, validationEvents: events.filter(e => e.type === 'invalid') },

        noErrorSurfaced: null,
      },
      note: 'Raw before/after observations only. Constraint-invalid fields and validationMessage properties do not prove visible error presentation. invalid events show attempted validation, not confirmed browser-bubble visibility. Failed actions or settling limits make negative evidence incomplete. Navigation/submission is blocked; server-side feedback is unobserved.',
    };
  } finally {
    live.off('dialog', onDialog);
    if (onRequest) live.off('request', onRequest);
    await live.setRequestInterception(false).catch(() => {});
    await live.evaluate(() => window.__iaInteractionController?.abort()).catch(() => {});
    try { await live.close(); } catch (e) {}
  }
}

const STYLE_KEYS = ['textDecorationLine', 'fontWeight', 'fontStyle', 'fontSize', 'outlineStyle', 'outlineWidth', 'outlineColor', 'borderStyle', 'borderTopWidth', 'borderColor', 'backgroundColor', 'boxShadow'];
function stateTargetSnapshot(xp, keys, scroll) {
  const el = window.__ia?.resolve ? window.__ia.resolve(xp) : document.evaluate(xp, document, null, 9, null).singleNodeValue;
  if (!el) return null;
  if (scroll) { try { el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }); } catch (_) {} }
  const owner = el.ownerDocument.defaultView;
  const r = el.getBoundingClientRect();
  let x = r.x, y = r.y;
  for (let w = owner; w !== window;) {
    let frame; try { frame = w.frameElement; } catch (_) { break; }
    if (!frame) break;
    const b = frame.getBoundingClientRect(); x += b.x + frame.clientLeft; y += b.y + frame.clientTop; w = frame.ownerDocument.defaultView;
  }
  const style = {}, cs = owner.getComputedStyle(el);
  for (const k of keys) style[k] = cs[k];
  let active = el.ownerDocument.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  const rendered = (!el.checkVisibility || el.checkVisibility({ visibilityProperty: true, opacityProperty: true })) && r.width > 0 && r.height > 0;
  const visible = rendered && x < innerWidth && y < innerHeight && x + r.width > 0 && y + r.height > 0;
  const left = Math.max(0, x - 6), top = Math.max(0, y - 6);
  const right = Math.min(innerWidth, x + r.width + 6), bottom = Math.min(innerHeight, y + r.height + 6);
  return { style, hasText: !!((el.innerText || el.textContent || '').trim()), rendered, visible,
    focused: active === el, matchesFocusVisible: el.matches(':focus-visible'),
    view: { x, y, w: r.width, h: r.height }, scroll: { x: scrollX, y: scrollY },
    clip: visible && right > left && bottom > top ? { x: Math.floor(left + scrollX), y: Math.floor(top + scrollY), width: Math.ceil(right - left), height: Math.ceil(bottom - top) } : null };
}
async function setStateAndCapture(page, args, ctx) {
  const { targetXpath, state } = args || {};
  if (typeof targetXpath !== 'string' || !targetXpath) return { error: 'targetXpath required' };
  const allowed = ['focus', 'hover', 'checked', 'open', 'expanded', 'placeholder-shown'];
  if (!allowed.includes(state)) return { error: `state must be one of: ${allowed.join(', ')}` };
  if (!ctx || typeof ctx.freshClone !== 'function') return { error: 'fresh clone unavailable — this mutating tool refuses to touch the shared page' };
  const live = await ctx.freshClone();

  live.on('dialog', (d) => { d.dismiss().catch(() => {}); });
  try {
    await live.evaluate(stateTargetSnapshot, targetXpath, STYLE_KEYS, true);
    await require('./settle.js').awaitSettle(live, { force: true, floorMs: 220 });
    const meta = await live.evaluate(stateTargetSnapshot, targetXpath, STYLE_KEYS, false);
    if (!meta || !meta.rendered) return { stateReached: false, captureValid: false, reason: 'target not found or has no rendered box' };
    const clip = meta.clip;

    await live.mouse.move(10000, 10000).catch(() => {});
    const before = clip ? await require('./settle.js').robustScreenshot(live, { encoding: 'base64', clip, captureBeyondViewport: false }) : null;

    let driven = { reached: false };
    if (state === 'hover') {
      await live.mouse.move(meta.view.x + meta.view.w / 2, meta.view.y + meta.view.h / 2);
      driven = { reached: null };
    } else if (state === 'focus') {

      const onTarget = async () => !!(await live.evaluate(stateTargetSnapshot, targetXpath, STYLE_KEYS, false))?.focused;
      const focusTarget = xp => {
        const el = window.__ia?.resolve ? window.__ia.resolve(xp) : document.evaluate(xp, document, null, 9, null).singleNodeValue;
        el?.focus({ preventScroll: true });
      };
      await live.evaluate(focusTarget, targetXpath);
      await live.keyboard.press('Shift+Tab').catch(() => {});
      await live.keyboard.press('Tab').catch(() => {});
      const sequential = await onTarget();
      if (!sequential) await live.evaluate(focusTarget, targetXpath);
      driven = { reached: await onTarget(), focusMethod: sequential ? 'sequential-return' : 'programmatic-fallback' };
    } else {
      driven = await live.evaluate((st, xp) => {
        const el = window.__ia?.resolve ? window.__ia.resolve(xp) : document.evaluate(xp, document, null, 9, null).singleNodeValue; if (!el) return { reached: false };
        if (st === 'focus') { el.focus({ preventScroll: true }); return { reached: document.activeElement === el }; }
        if (st === 'checked') {

          if (el.tagName === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio')) { el.checked = true; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return { reached: !!el.checked }; }
          const role = el.getAttribute('role');
          if (role === 'checkbox' || role === 'switch' || el.hasAttribute('aria-checked')) { const b = el.getAttribute('aria-checked'); el.click(); return { reached: el.getAttribute('aria-checked') !== b }; }
          return { reached: false };
        }
        if (st === 'placeholder-shown') {

          const ph = el.getAttribute('placeholder');
          if (!ph || !('value' in el)) return { reached: false };
          if (el.value) { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); }
          return { reached: el.value === '', placeholderText: ph };
        }
        if (st === 'open' || st === 'expanded') {
          const det = el.tagName === 'SUMMARY' ? el.parentElement : (el.tagName === 'DETAILS' ? el : null);
          if (det) { const was = det.open; el.click(); return { reached: det.open !== was }; }
          if (el.hasAttribute('aria-expanded')) { const b = el.getAttribute('aria-expanded'); el.click(); return { reached: el.getAttribute('aria-expanded') !== b }; }
          return { reached: false };
        }
        return { reached: false };
      }, state, targetXpath).catch(() => ({ reached: false }));
    }
    await require('./settle.js').awaitSettle(live, { force: true, floorMs: 220 });
    const afterMeta = await live.evaluate(stateTargetSnapshot, targetXpath, STYLE_KEYS, false);
    const stable = !!(meta.clip && afterMeta?.clip && ['x','y','width','height'].every(k => Math.abs(meta.clip[k] - afterMeta.clip[k]) <= 1));
    const comparisonValid = stable && meta.visible && afterMeta.visible;
    const after = afterMeta?.clip ? await require('./settle.js').robustScreenshot(live, { encoding: 'base64', clip: comparisonValid ? clip : afterMeta.clip, captureBeyondViewport: false }) : null;
    const styleDelta = {};
    if (afterMeta) for (const k of STYLE_KEYS) if (meta.style[k] !== afterMeta.style[k]) styleDelta[k] = { before: meta.style[k], after: afterMeta.style[k] };
    const pixelsChanged = comparisonValid ? before !== after : null;
    const stateReached = state === 'hover' ? (Object.keys(styleDelta).length > 0 || pixelsChanged === true) : state === 'focus' ? !!afterMeta?.focused : !!driven?.reached;
    return {
      stateReached,
      textVisible: !!(afterMeta?.visible && (afterMeta.hasText || driven?.placeholderText)),
      styleDelta,
      pixelsChanged,
      ...(state === 'focus' ? { matchesFocusVisible: !!afterMeta?.matchesFocusVisible, focusMethod: driven.focusMethod, focusWasReached: !!driven.reached, focusEvidenceNote: ':focus-visible is a CSS selector match, not a visible indicator measurement. Programmatic fallback does not prove sequential reachability. An invalid comparison provides no evidence of a missing focus indicator.' } : {}),
      captureValid: !!(before && after && meta.visible && afterMeta?.visible), comparisonValid,
      ...(!comparisonValid ? { inconclusive: 'target-or-capture-region-changed', comparisonNote: 'Frames do not measure the same stable target region; pixelsChanged is unavailable. Reproduce the keyboard state on one retained workflow.' } : {}),
      targetBox: afterMeta?.view || null,
      captureContext: { before: { targetBox: meta.view, clip: meta.clip, scroll: meta.scroll }, after: afterMeta ? { targetBox: afterMeta.view, clip: afterMeta.clip, scroll: afterMeta.scroll } : null },
      screenshots: { before, after },
      ...(stateReached ? {} : { note: `state '${state}' did not reproduce — do not read a pass from it` }),
    };
  } finally { try { await live.close(); } catch (e) {} }
}

async function probeScreenReaderAfterAction(page, args, ctx) {
  const { triggerXpath } = args || {};
  if (typeof triggerXpath !== 'string' || !triggerXpath) return { error: 'triggerXpath required' };
  if (!ctx || typeof ctx.freshClone !== 'function') return { error: 'fresh clone unavailable — this mutating tool refuses to touch the shared page' };
  const live = await ctx.freshClone();
  const dialogStart=(live.__dialogs || []).length, dialogs=[];
  const onDialog=d=>{dialogs.push({type:d.type(),message:d.message()});d.dismiss().catch(()=>{});};
  if (!Array.isArray(live.__dialogs)) live.on('dialog',onDialog);
  const startUrl=live.url();
  const onRequest=req=>{
    if (req.isNavigationRequest() && req.frame()===live.mainFrame()) req.abort().catch(()=>{});
    else req.continue().catch(()=>{});
  };
  await live.setRequestInterception(true); live.on('request',onRequest);
  await live.evaluate(()=>{
    window.__iaVsrController?.abort(); window.__iaVsrController=new AbortController();
    document.addEventListener('submit',e=>e.preventDefault(),{capture:true,signal:window.__iaVsrController.signal});
    window.__iaVsrArmed=false;
  });
  try {
    const vsr = require('./vsr-collect.js');
    const ok = await vsr.ensureVsr(live);
    if (!ok) return { error: 'vsr-injection-failed', probeFailed: true };
    const point=await pointerTarget(live,triggerXpath);
    const pending = live.evaluate(async (xp, legacy) => {
      const v = window.__vsr;
      const el = (window.__ia?.resolve ? window.__ia.resolve(xp) : document.evaluate(xp, document, null, 9, null).singleNodeValue);
      if (!el) return { found: false };
      try { await v.start({ container: document.body }); } catch (e) { return { found: true, started: false }; }
      try { await v.clearSpokenPhraseLog(); } catch (e) {}

      const LIVE = '[aria-live="polite"],[aria-live="assertive"],[role=status],[role=alert],[role=log],[role=alertdialog],output';
      let liveAt = 0, sawLive = false;
      const hit = (node) => { try { const e = node && (node.nodeType === 1 ? node : node.parentElement); if (!e || !e.closest) return false; const m = e.closest(LIVE); return !!m && m.getAttribute('aria-live') !== 'off'; } catch (er) { return false; } };
      const mo = new MutationObserver((recs) => { for (const r of recs) { let h = hit(r.target); if (!h) for (const an of (r.addedNodes || [])) { if (hit(an) || (an.querySelector && an.querySelector(LIVE))) { h = true; break; } } if (h) { liveAt = performance.now(); sawLive = true; } } });
      try { mo.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['aria-live'] }); } catch (e) {}
      window.__iaVsrArmed=true;
      await new Promise(resolve=>{window.__iaVsrActivate=resolve;});

      { const t0 = performance.now(); let spokenAt = t0, prev = 0;
        for (;;) {
          let n = 0; try { n = (await v.spokenPhraseLog()).length; } catch (e) {}
          const now = performance.now();
          if (n !== prev) { spokenAt = now; prev = n; }
          const lastActivity = (!legacy && liveAt > spokenAt) ? liveAt : spokenAt;
          const awaitingVoice = !legacy && liveAt > spokenAt && (now - liveAt) < 3000;
          if (now - t0 >= 6000) break;
          if (now - t0 >= 1400 && now - lastActivity >= 400 && !awaitingVoice) break;
          await new Promise((r) => setTimeout(r, 80));
        } }
      try { mo.disconnect(); } catch (e) {}
      let log = [];
      try { log = await v.spokenPhraseLog(); } catch (e) {}
      try { await v.stop(); } catch (e) {}
      return { found: true, started: true, sawLiveMutation: sawLive, log: Array.isArray(log) ? log.map(String) : [] };
    }, triggerXpath, process.env.V3_VSR_LEGACY === '1');
    const outcome=await Promise.race([pending.then(result=>({result})),
      live.waitForFunction(()=>window.__iaVsrArmed,{timeout:5000}).then(()=>({armed:true}))]);
    let res=outcome.result;
    if (outcome.armed) {
      await live.mouse.click(point.x,point.y);
      await live.evaluate(()=>window.__iaVsrActivate?.());
      res=await pending;
    }
    if (!res || !res.found) return { error: 'trigger not found', probeFailed: true };
    if (!res.started) return { error: 'vsr-start-failed', probeFailed: true };
    const announcements = (res.log || []).filter(Boolean);

    const spokenBody = (a) => String(a).replace(/^(polite|assertive)\s*:?\s*/i, '').trim();
    const liveRegionAnnouncements = announcements.filter((a) => /^(polite|assertive)\b/i.test(a) && spokenBody(a).length > 0);

    const emptyLiveRegionEvents = announcements.filter((a) => /^(polite|assertive)\b/i.test(a) && spokenBody(a).length === 0).length;

    return { dialogMessages:Array.isArray(live.__dialogs)?live.__dialogs.slice(dialogStart):dialogs, announcements, announcementCount: announcements.length, emptyQueue: announcements.length === 0, liveRegionAnnouncements, noLiveRegionAnnouncement: liveRegionAnnouncements.length === 0, liveRegionMutated: !!res.sawLiveMutation, emptyLiveRegionEvents, ...(emptyLiveRegionEvents > 0 ? { emptyAnnouncementNote: `${emptyLiveRegionEvents} live-region event(s) carried NO spoken text (e.g. the region was emptied on completion). A user hears SILENCE for these — they are NOT evidence that anything was announced.` } : {}) };
  } finally {
    live.off('dialog',onDialog); live.off('request',onRequest);
    await live.setRequestInterception(false).catch(()=>{});
    await live.evaluate(()=>{window.__iaVsrActivate?.();window.__iaVsrController?.abort();}).catch(()=>{});
    try { await live.close(); } catch (e) {}
  }
}

async function measureGeometryLive(page, args, ctx) {
  const { targetXpath, otherXpath, viewportWidth } = args || {};
  if (typeof targetXpath !== 'string' || !targetXpath) return { error: 'targetXpath required' };

  const useClone = Number.isFinite(viewportWidth) && viewportWidth > 0 && ctx && typeof ctx.freshClone === 'function';
  const live = useClone ? await ctx.freshClone() : page;
  try {
    if (useClone) { await live.setViewport({ width: Math.round(viewportWidth), height: 900, deviceScaleFactor: 1 }).catch(() => {}); await require('./settle.js').awaitSettle(live, { force: true, floorMs: 140 }); }
  const r = await live.evaluate((xp, oxp) => {
    const el = (window.__ia?.resolve ? window.__ia.resolve(xp) : document.evaluate(xp, document, null, 9, null).singleNodeValue);
    if (!el) return { found: false };
    const b = el.getBoundingClientRect();

    const occ = new Map(), GX = 4, GY = 4;
    for (let i = 1; i <= GX; i++) for (let j = 1; j <= GY; j++) {
      const px = b.left + (b.width * i) / (GX + 1), py = b.top + (b.height * j) / (GY + 1);
      if (px < 0 || py < 0 || px >= window.innerWidth || py >= window.innerHeight) continue;
      const stack = document.elementsFromPoint(px, py);
      const ti = stack.findIndex((e) => e === el || el.contains(e) || e.contains(el));
      for (let k = 0; k < (ti < 0 ? stack.length : ti); k++) {
        const o = stack[k]; if (o === el || el.contains(o) || o.contains(el) || occ.has(o)) continue;
        const ob = o.getBoundingClientRect();
        occ.set(o, { tag: o.tagName.toLowerCase(), role: o.getAttribute('role') || null, box: { x: Math.round(ob.x), y: Math.round(ob.y), w: Math.round(ob.width), h: Math.round(ob.height) } });
      }
    }
    const occludedElements = [...occ.values()].slice(0, 8);
    const overflowsH = el.scrollWidth > el.clientWidth + 2;
    let culprit = null;

    const contentRight = b.left + el.clientLeft + el.clientWidth - el.scrollLeft;
    if (overflowsH) { for (const d of el.querySelectorAll('*')) { const dr = d.getBoundingClientRect(); if (dr.right > contentRight + 2) { culprit = { tag: d.tagName.toLowerCase(), role: d.getAttribute('role') || null }; break; } } }
    let overlap = null;
    if (oxp) {
      const o = document.evaluate(oxp, document, null, 9, null).singleNodeValue;
      if (o) {
        const ob = o.getBoundingClientRect();
        const ix = Math.max(0, Math.min(b.right, ob.right) - Math.max(b.left, ob.left)), iy = Math.max(0, Math.min(b.bottom, ob.bottom) - Math.max(b.top, ob.top)), area = ix * iy;
        const gapX = ob.left > b.right ? ob.left - b.right : (b.left > ob.right ? b.left - ob.right : 0);
        const gapY = ob.top > b.bottom ? ob.top - b.bottom : (b.top > ob.bottom ? b.top - ob.bottom : 0);

        overlap = {
          overlapAreaPx: Math.round(area),
          overlapFractionOfTarget: b.width * b.height ? +(area / (b.width * b.height)).toFixed(3) : 0,
          overlapFractionOfOther: ob.width * ob.height ? +(area / (ob.width * ob.height)).toFixed(3) : 0,
          gapX: Math.round(gapX), gapY: Math.round(gapY),
          overlapsOrAdjacent: area > 0 || (gapX === 0 && gapY === 0),
          otherBox: { x: Math.round(ob.x), y: Math.round(ob.y), w: Math.round(ob.width), h: Math.round(ob.height) },
        };
      }
      else overlap = { available: false, reason: 'otherXpath not found' };
    }
    const ambiguous = b.width < 6 || b.height < 6;
    return { found: true, box: { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, overflowsHorizontally: overflowsH, overflowPx: Math.max(0, el.scrollWidth - el.clientWidth), overflowCulprit: culprit, overlap, occludedElements, viewportWidthUsed: window.innerWidth, ambiguous, ambiguityReason: ambiguous ? 'degenerate box (<6px)' : undefined };
  }, targetXpath, otherXpath || null).catch(() => null);
    if (!r) return { error: 'measurement failed' };
    if (!r.found) return { error: 'target not found' };
    return { ...r, targetXpath, stateUsed: useClone ? `viewport-${Math.round(viewportWidth)}px(clone)` : 'as-loaded(shared-page)' };
  } finally { if (useClone) { try { await live.close(); } catch (e) {} } }
}

async function requestHiResCrop(page, args, ctx) {
  const { targetXpath, scale } = args || {};
  if (typeof targetXpath !== 'string' || !targetXpath) return { error: 'targetXpath required' };
  const s = Math.max(1, Math.min(Number(scale) || 3, 4));
  if (!ctx || typeof ctx.freshClone !== 'function') return { error: 'fresh clone unavailable — this mutating tool refuses to touch the shared page' };
  const live = await ctx.freshClone();
  try {
    const vp = live.viewport() || { width: 1280, height: 900 };
    await live.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: s }).catch(() => {});
    const meta = await live.evaluate((xp) => { const el = (window.__ia?.resolve ? window.__ia.resolve(xp) : document.evaluate(xp, document, null, 9, null).singleNodeValue); if (!el) return null; try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch (e) {} const r = el.getBoundingClientRect(); return { box: { x: Math.max(0, r.x + scrollX), y: Math.max(0, r.y + scrollY), w: r.width, h: r.height }, cssW: Math.round(r.width), cssH: Math.round(r.height) }; }, targetXpath).catch(() => null);
    if (!meta || !(meta.box.w > 0 && meta.box.h > 0)) return { error: 'target not found or zero-size' };
    const clip = { x: Math.round(meta.box.x), y: Math.round(meta.box.y), width: Math.round(meta.box.w), height: Math.round(meta.box.h) };
    const screenshot = await require('./settle.js').robustScreenshot(live, { encoding: 'base64', clip });
    if (!screenshot) return { error: 'capture failed' };
    return { screenshot, scaleUsed: s, cssPixelSize: { w: meta.cssW, h: meta.cssH }, devicePixelSize: { w: Math.round(meta.cssW * s), h: Math.round(meta.cssH * s) }, note: 'higher device-scale re-raster of the SAME layout (not page zoom); if still illegible, return PARTIAL — do not invent text' };
  } finally { try { await live.close(); } catch (e) {} }
}

async function renderWithOverrides(page, args, ctx) {
  const { transform, targetXpath } = args || {};
  const VISION = { grayscale: 'achromatopsia', protanopia: 'protanopia', deuteranopia: 'deuteranopia', tritanopia: 'tritanopia' };
  const allowed = [...Object.keys(VISION), 'forced-colors', 'no-author-css'];
  if (!allowed.includes(transform)) return { error: `transform must be one of: ${allowed.join(', ')}` };
  if (!ctx || typeof ctx.freshClone !== 'function') return { error: 'fresh clone unavailable — this mutating tool refuses to touch the shared page' };
  const live = await ctx.freshClone();
  try {
    const cdp = await live.createCDPSession();
    if (VISION[transform]) await cdp.send('Emulation.setEmulatedVisionDeficiency', { type: VISION[transform] }).catch(() => {});
    else if (transform === 'forced-colors') await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }] }).catch(() => {});
    else if (transform === 'no-author-css') await live.evaluate(() => { for (const s of [...document.querySelectorAll('style,link[rel=stylesheet]')]) { try { s.disabled = true; } catch (e) {} } }).catch(() => {});
    await require('./settle.js').awaitSettle(live, { force: true, floorMs: 160 });
    let clip;
    if (typeof targetXpath === 'string' && targetXpath) {
      const meta = await live.evaluate((xp) => { const el = (window.__ia?.resolve ? window.__ia.resolve(xp) : document.evaluate(xp, document, null, 9, null).singleNodeValue); if (!el) return null; try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch (e) {} const r = el.getBoundingClientRect(); return { x: Math.max(0, r.x + scrollX), y: Math.max(0, r.y + scrollY), w: r.width, h: r.height }; }, targetXpath).catch(() => null);

      if (!meta || !(meta.w > 0 && meta.h > 0)) return { error: 'target not found or zero-size', transform };
      clip = { x: Math.round(meta.x), y: Math.round(meta.y), width: Math.round(meta.w), height: Math.round(meta.h) };
    }
    const screenshot = await require('./settle.js').robustScreenshot(live, { encoding: 'base64', ...(clip ? { clip } : {}) });
    if (!screenshot) return { error: 'capture failed', transform };
    return { transform, screenshot, note: 'rendered under one fixed transform; judge from these pixels — do NOT assert a numeric ratio from a grayscale/CVD image' };
  } finally { try { await live.close(); } catch (e) {} }
}

async function computeContrastRatio(page, args) {
  const A = require('./a11y-eval.js');
  const { nodeAXpath, nodeBXpath, threshold, propertyA = 'color', propertyB = 'auto' } = args || {};
  const properties = ['color', 'backgroundColor', 'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor', 'outlineColor', 'fill', 'stroke'];
  if (!properties.includes(propertyA) || !(properties.includes(propertyB) || propertyB === 'auto')) return { error: 'Choose explicit computed color properties; propertyB may also be auto for legacy text/background selection.' };
  if (typeof nodeAXpath !== 'string' || typeof nodeBXpath !== 'string') return { error: 'nodeAXpath and nodeBXpath required (the two flat colour sources to compare)' };
  const cols = await page.evaluate((xa, xb, propertyA, propertyB) => {

    const toRgba = (c) => { if (!CSS.supports('color', c)) return c; try { const cv = document.createElement('canvas'); cv.width = cv.height = 1; const cx = cv.getContext('2d'); cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return `rgba(${d[0]}, ${d[1]}, ${d[2]}, ${(d[3] / 255).toFixed(3)})`; } catch (e) { return c; } };
    const read = (xp, property) => {
      const el = (window.__ia?.resolve ? window.__ia.resolve(xp) : document.evaluate(xp, document, null, 9, null).singleNodeValue);
      if (!el || el.nodeType !== 1) return null;
      const cs = getComputedStyle(el);
      const auto = property === 'auto';
      if (auto) {
        const bg = toRgba(cs.backgroundColor);
        property = /rgba\([^)]*,\s*0(?:\.0+)?\s*\)/.test(bg) ? 'color' : 'backgroundColor';
      }
      let unreliable = null;
      for (let n = el; n; n = n.parentElement) {
        const c = getComputedStyle(n);
        if (Number(c.opacity) < 1 || c.filter !== 'none' || c.mixBlendMode !== 'normal') unreliable = 'compositing-unresolved';
      }
      if ((property === 'backgroundColor' || auto) && cs.backgroundImage !== 'none') unreliable = 'non-flat-background';
      return { color: toRgba(cs[property]), property, unreliable };
    };

    const fontOf = (xp) => {
      const el = (window.__ia?.resolve ? window.__ia.resolve(xp) : document.evaluate(xp, document, null, 9, null).singleNodeValue);
      if (!el || el.nodeType !== 1) return null;
      const cs = getComputedStyle(el);
      return { fontPx: parseFloat(cs.fontSize), fontWeight: cs.fontWeight };
    };

    const shadowsOf = (xp) => {
      const el = (window.__ia?.resolve ? window.__ia.resolve(xp) : document.evaluate(xp, document, null, 9, null).singleNodeValue);
      if (!el || el.nodeType !== 1) return [];
      const ts = getComputedStyle(el).textShadow;
      if (!ts || ts === 'none') return [];
      return ts.split(/,(?![^(]*\))/).map((p) => p.trim()).filter(Boolean).map((p) => {
        const cm = p.match(/rgba?\([^)]*\)|#[0-9a-fA-F]+/);
        const nums = (p.match(/-?[\d.]+px/g) || []).map((v) => parseFloat(v));
        return { color: cm ? toRgba(cm[0]) : null, ox: nums[0] || 0, oy: nums[1] || 0, blur: nums[2] || 0 };
      }).filter((s) => s.color);
    };
    const a = read(xa, propertyA), b = read(xb, propertyB);
    return { a: a?.color, b: b?.color, propertyA: a?.property, propertyB: b?.property, unreliable: a?.unreliable || b?.unreliable, fontA: propertyA === 'color' ? fontOf(xa) : null, shadowsA: propertyA === 'color' ? shadowsOf(xa) : [] };
  }, nodeAXpath, nodeBXpath, propertyA, propertyB).catch(() => null);
  if (!cols || !cols.a || !cols.b) return { error: 'one or both nodes not found' };
  const colorSources = { nodeAXpath, nodeBXpath, propertyA: cols.propertyA, propertyB: cols.propertyB };
  if (cols.unreliable) return { inconclusive: cols.unreliable, colorA: cols.a, colorB: cols.b, colorSources, note: 'CSS colors do not describe the rendered composite. Use rendered pixels; no flat ratio computed.' };
  const pa = A.parseRGB(cols.a), pb = A.parseRGB(cols.b);
  if (!pa || !pb) return { inconclusive: 'unparseable-color', colorA: cols.a, colorB: cols.b, colorSources };
  if ((pa.a != null && pa.a < 1) || (pb.a != null && pb.a < 1)) return { inconclusive: 'alpha-unresolved', colorSources, note: 'a translucent colour cannot be reduced to a sound ratio — defer to the perceptual rubric' };
  const rawRatio = A.contrastRatioRaw([pa.r, pa.g, pa.b], [pb.r, pb.g, pb.b]);

  const fontPx = cols.fontA && Number.isFinite(cols.fontA.fontPx) ? cols.fontA.fontPx : null;
  const textThreshold = fontPx != null ? A.contrastThresholdFor(fontPx, cols.fontA.fontWeight) : null;
  const isLargeText = fontPx != null ? A.isLargeText(fontPx, cols.fontA.fontWeight) : null;
  const th = Number.isFinite(threshold) ? threshold : (textThreshold != null ? textThreshold : 3);

  let shadowAdjacentRatio = null; let shadowColor = null;
  for (const sh of (cols.shadowsA || [])) {
    const ps = A.parseRGB(sh.color);
    if (!ps || (ps.a != null && ps.a < 0.5)) continue;
    if (!(sh.blur >= 1 && Math.abs(sh.ox) <= sh.blur && Math.abs(sh.oy) <= sh.blur)) continue;
    const sr = A.contrastRatioRaw([pa.r, pa.g, pa.b], [ps.r, ps.g, ps.b]);
    if (sr > rawRatio && (shadowAdjacentRatio == null || sr > shadowAdjacentRatio)) { shadowAdjacentRatio = sr; shadowColor = sh.color; }
  }
  const shadowIsContrastEnhancing = shadowAdjacentRatio != null;

  return {
    colorA: cols.a, colorB: cols.b, colorSources, source: 'cssom', contrastRatio: +rawRatio.toFixed(2),
    fontPx, isLargeText, textThreshold,
    ...(shadowIsContrastEnhancing ? { hasContrastEnhancingShadow: true, shadowColor } : {}),
    passesAsText: textThreshold != null ? rawRatio >= textThreshold : null,
    threshold: th, passes: rawRatio >= th,
    note: 'WCAG ratio of two FLAT used-colours. colorSources echoes the actual CSS properties compared. For a background-vs-background cue, explicitly set both properties to backgroundColor; the default compares A text to B background when present. A numeric ratio alone does not establish use-of-color compliance' + (shadowIsContrastEnhancing ? '. hasContrastEnhancingShadow: a centred opaque halo (' + shadowColor + ') may lift real legibility ABOVE this flat worst case, but a blur radius does not guarantee full glyph backing — do NOT treat the shadow as a numeric pass; measure with measure_text_contrast_over_image or judge the crop' : '') + '. For 1.4.3 TEXT contrast use passesAsText (textThreshold font-derived: ' + (isLargeText ? '3.0 large-text' : '4.5 normal') + '); `passes` honours an explicit threshold override. Not an SC disposition.',
  };
}

async function measureTextContrastOverImage(page, args, ctx) {
  const A = require('./a11y-eval.js');
  const { targetXpath, threshold } = args || {};
  if (typeof targetXpath !== 'string' || !targetXpath) return { error: 'targetXpath required (a TEXT element rendered over a background image/gradient)' };
  if (!ctx || typeof ctx.freshClone !== 'function') return { error: 'fresh clone unavailable — this recolours text, so it needs a clone' };
  const live = await ctx.freshClone();
  const SS = require('./settle.js').robustScreenshot;
  try {

    await live.evaluate(xp => {
      const el = (window.__ia?.resolve ? window.__ia.resolve(xp) : document.evaluate(xp, document, null, 9, null).singleNodeValue);
      window.__iaContrastMeasuredElement = el;
      if (el && el.nodeType === 1) el.scrollIntoView({ block: 'center', inline: 'center' });
    }, targetXpath);
    await live.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const meta = await live.evaluate((xp) => {
      const el = (window.__ia?.resolve ? window.__ia.resolve(xp) : document.evaluate(xp, document, null, 9, null).singleNodeValue);
      if (!el || el.nodeType !== 1) return null;
      if (el !== window.__iaContrastMeasuredElement)
        return { inconclusive: 'target-changed-after-scroll', suggestedTargets: [] };
      const pathOf = node => {
        const parts = [];
        for (let n = node; n && n.nodeType === 1; n = n.parentElement) {
          let i = 1; for (let p = n.previousElementSibling; p; p = p.previousElementSibling) if (p.localName === n.localName) i++;
          parts.unshift(n.localName + '[' + i + ']');
        }
        return '/' + parts.join('/');
      };
      const textOwners = [];
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const parent = n.parentElement;
        if (!n.nodeValue.trim() || ['SCRIPT', 'STYLE'].includes(parent.tagName) || textOwners.includes(parent)) continue;
        const r = parent.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && parent.checkVisibility({visibilityProperty:true,opacityProperty:true})) textOwners.push(parent);
      }
      const suggestedTargets = textOwners.slice(0, 24).map(n => {
        const c = getComputedStyle(n), r = n.getBoundingClientRect();
        return { xpath: pathOf(n), text: [...n.childNodes].filter(x => x.nodeType === 3).map(x => x.nodeValue).join('').trim().slice(0, 160),
          color: c.color, fontPx: parseFloat(c.fontSize), fontWeight: c.fontWeight, box: {x:r.x,y:r.y,w:r.width,h:r.height} };
      });
      const cs = getComputedStyle(el), r = el.getBoundingClientRect();
      const colorCanvas = document.createElement('canvas'); colorCanvas.width = colorCanvas.height = 1;
      const colorContext = colorCanvas.getContext('2d'); colorContext.fillStyle = cs.color; colorContext.fillRect(0, 0, 1, 1);
      const translucentText = colorContext.getImageData(0, 0, 1, 1).data[3] < 255;
      const mixed = textOwners.some(n => {
        const c = getComputedStyle(n);
        return ['color','fontSize','fontWeight','textShadow','webkitTextStrokeWidth'].some(k => c[k] !== cs[k]);
      });
      let compositing = false;
      for (let n = el; n; n = n.parentElement) {
        const c = getComputedStyle(n);
        if (Number(c.opacity) < 1 || c.filter !== 'none' || c.mixBlendMode !== 'normal') compositing = true;
      }

      if (!textOwners.length || mixed || translucentText || textOwners.some(n => {
        for (let p = n; p && p !== el; p = p.parentElement) {
          const c = getComputedStyle(p);
          if (Number(c.opacity) < 1 || c.filter !== 'none' || c.mixBlendMode !== 'normal') return true;
        }
        return false;
      }) || compositing || r.width < 2 || r.height < 2)
        return { inconclusive: compositing ? 'compositing-unresolved' : translucentText ? 'alpha-unresolved' : mixed ? 'mixed-text-styles' : !textOwners.length ? 'no-visible-text' : 'text-not-measurable', suggestedTargets, suggestionsTruncated: textOwners.length > 24 };
      let bgKind = 'flat'; for (let n = el, i = 0; n && i < 6; n = n.parentElement, i++) { const c = getComputedStyle(n); if (c.backgroundImage && c.backgroundImage !== 'none') { bgKind = /gradient/i.test(c.backgroundImage) ? 'gradient' : 'image'; break; } }
      return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height, color: cs.color, fontPx: parseFloat(cs.fontSize), fontWeight: cs.fontWeight, bgKind, textShadow: cs.textShadow,
        textOwnerPaths: textOwners.map(pathOf), suggestedTargets, suggestionsTruncated: textOwners.length > 24 };
    }, targetXpath).catch(() => null);
    if (!meta) return { error: 'target not found' };
    if (meta.inconclusive) return { ...meta, note: 'No ratio measured. Select an appropriate visible text node from suggestedTargets or inspect rendered pixels; container color is not evidence of descendant text color.' };
    const clip = { x: Math.max(0, Math.round(meta.x)), y: Math.max(0, Math.round(meta.y)), width: Math.round(meta.w), height: Math.round(meta.h) };
    const th = A.contrastThresholdFor(meta.fontPx, meta.fontWeight);
    const requestedThreshold = Number.isFinite(threshold) ? threshold : null;

    await live.evaluate(paths => { for (const xp of paths) {
      const el = (window.__ia?.resolve ? window.__ia.resolve(xp) : document.evaluate(xp, document, null, 9, null).singleNodeValue);
      el.style.setProperty('color', '#ff00fe', 'important'); el.style.setProperty('text-shadow', 'none', 'important'); el.style.setProperty('-webkit-text-stroke', '0', 'important');
    } }, meta.textOwnerPaths);
    const maskB64 = await SS(live, { encoding: 'base64', clip });

    await live.evaluate((paths, ts) => { for (const xp of paths) {
      const el = (window.__ia?.resolve ? window.__ia.resolve(xp) : document.evaluate(xp, document, null, 9, null).singleNodeValue);
      el.style.setProperty('color', 'transparent', 'important'); el.style.setProperty('text-shadow', ts || 'none', 'important');
    } }, meta.textOwnerPaths, meta.textShadow);
    const bgB64 = await SS(live, { encoding: 'base64', clip });
    if (!maskB64 || !bgB64) return { error: 'capture failed' };

    const stats = await live.evaluate(async (maskUrl, bgUrl, textColor, thr) => {
      const load = (u) => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = 'data:image/png;base64,' + u; });
      let mi, bi; try { [mi, bi] = await Promise.all([load(maskUrl), load(bgUrl)]); } catch (e) { return { err: 'image-load' }; }
      const w = mi.naturalWidth, h = mi.naturalHeight;
      if (!w || !h || w !== bi.naturalWidth || h !== bi.naturalHeight) return { err: 'dim-mismatch' };
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const cx = cv.getContext('2d', { willReadFrequently: true });
      cx.drawImage(mi, 0, 0); const md = cx.getImageData(0, 0, w, h).data;
      cx.clearRect(0, 0, w, h); cx.drawImage(bi, 0, 0); const bd = cx.getImageData(0, 0, w, h).data;
      const tcv = document.createElement('canvas'); tcv.width = tcv.height = 1; const tcx = tcv.getContext('2d'); tcx.fillStyle = textColor; tcx.fillRect(0, 0, 1, 1); const td = tcx.getImageData(0, 0, 1, 1).data;
      const lum = (r, g, b) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
      const ratio = (l1, l2) => { const a = Math.max(l1, l2), b = Math.min(l1, l2); return (a + 0.05) / (b + 0.05); };
      const tl = lum(td[0], td[1], td[2]);
      let glyph = 0, below = 0, worst = Infinity, sum = 0; const all = [];
      for (let i = 0; i < md.length; i += 4) {
        if (md[i] > 180 && md[i + 1] < 90 && md[i + 2] > 180) {
          glyph++; const rr = ratio(tl, lum(bd[i], bd[i + 1], bd[i + 2]));
          if (rr < worst) worst = rr; if (rr < thr) below++; sum += rr; if (all.length < 5000) all.push(rr);
        }
      }
      if (!glyph) return { glyphPixels: 0 };
      all.sort((a, b) => a - b);
      return { glyphPixels: glyph, worst, median: all[Math.floor(all.length / 2)], best: all[all.length - 1], mean: sum / glyph, fracBelow: below / glyph };
    }, maskB64, bgB64, meta.color, th).catch(() => null);
    if (!stats || stats.err) return { inconclusive: stats && stats.err === 'dim-mismatch' ? 'capture-dimension-mismatch' : 'pixel-read-failed', bgKind: meta.bgKind };
    if (!stats.glyphPixels) return { inconclusive: 'no-glyph-pixels', suggestedTargets: meta.suggestedTargets, suggestionsTruncated: meta.suggestionsTruncated, note: 'could not isolate the text glyphs (sentinel mask empty — the element may have no own text, or it is occluded) — defer to the perceptual rubric', bgKind: meta.bgKind };
    return {
      bgKind: meta.bgKind, textColor: meta.color, fontPx: meta.fontPx, fontWeight: meta.fontWeight,
      isLargeText: A.isLargeText(meta.fontPx, meta.fontWeight), textThreshold: th,
      threshold: th, requestedThreshold, glyphPixels: stats.glyphPixels,
      passesRequestedThreshold: requestedThreshold == null ? null : stats.worst >= requestedThreshold,
      ...(meta.textShadow && meta.textShadow !== 'none' ? { textShadow: meta.textShadow } : {}),
      worstCaseRatio: +stats.worst.toFixed(2), medianRatio: +stats.median.toFixed(2), bestCaseRatio: +stats.best.toFixed(2),
      fractionBelowThreshold: +stats.fracBelow.toFixed(3), worstCasePasses: stats.worst >= th,
      note: 'PER-PIXEL worst-case text-vs-backdrop contrast sampled UNDER the glyph footprint over a ' + meta.bgKind + ' backdrop' + (meta.textShadow && meta.textShadow !== 'none' ? ' (the backdrop includes the text\'s own text-shadow, painted beneath the glyphs)' : '') + '. threshold/textThreshold are derived from the rendered font for SC 1.4.3 (3:1 for large text; 4.5:1 otherwise). A caller override is reported separately as requestedThreshold/passesRequestedThreshold and cannot change the text threshold. worstCasePasses and fractionBelowThreshold use the font-derived threshold. Raw numbers, never an SC disposition.',
    };
  } finally { try { await live.close(); } catch (e) {} }
}

async function resolvePartColor(page, args) {
  const A = require('./a11y-eval.js');
  const { x, y } = args || {};
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { error: 'x,y (screenshot coordinates) required' };
  const cssInfo = await page.evaluate((px, py) => {
    const el = document.elementFromPoint(px, py);
    if (!el) return null;
    const cs = getComputedStyle(el);
    const pc = (sel) => { const p = getComputedStyle(el, sel); return (p && p.content && p.content !== 'none' && p.content !== 'normal') ? { color: p.color, backgroundColor: p.backgroundColor } : null; };
    return {
      part: el.tagName.toLowerCase(),
      color: cs.color, backgroundColor: cs.backgroundColor, borderTopColor: cs.borderTopColor, outlineColor: cs.outlineColor, fill: cs.fill, stroke: cs.stroke,

      hasGradient: /gradient/i.test(cs.backgroundImage || ''),
      hasBackgroundImage: !!(cs.backgroundImage && cs.backgroundImage !== 'none'),
      hasFilter: !!((cs.filter && cs.filter !== 'none') || (cs.backdropFilter && cs.backdropFilter !== 'none')),
      opacity: parseFloat(cs.opacity),
      pseudo: { before: pc('::before'), after: pc('::after') },
    };
  }, x, y).catch(() => null);
  if (!cssInfo) return { error: 'no element at the given point' };

  const clip = { x: Math.max(0, Math.round(x) - 2), y: Math.max(0, Math.round(y) - 2), width: 5, height: 5 };
  const shot = await require('./settle.js').robustScreenshot(page, { encoding: 'base64', clip });
  let renderedPixelRGBA = null;
  if (shot) {
    renderedPixelRGBA = await page.evaluate(async (b64) => {
      try {
        const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
        const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
        const d = ctx.getImageData(Math.floor(img.width / 2), Math.floor(img.height / 2), 1, 1).data;
        return { r: d[0], g: d[1], b: d[2], a: d[3] };
      } catch (e) { return null; }
    }, shot).catch(() => null);
  }

  let divergence = null;
  if (renderedPixelRGBA) {
    const candidates = [['color', cssInfo.color], ['backgroundColor', cssInfo.backgroundColor], ['borderTopColor', cssInfo.borderTopColor], ['outlineColor', cssInfo.outlineColor], ['fill', cssInfo.fill], ['stroke', cssInfo.stroke]];
    let best = null;
    for (const [prop, val] of candidates) {
      const c = A.parseRGB(val);
      if (!c || c.a === 0) continue;
      const dist = Math.hypot(c.r - renderedPixelRGBA.r, c.g - renderedPixelRGBA.g, c.b - renderedPixelRGBA.b);
      if (!best || dist < best.dist) best = { prop, dist };
    }
    if (best) divergence = { sourceProperty: best.prop, distFromSourceColor: +best.dist.toFixed(1), divergent: best.dist > 40 };
  }

  const PAINT_PROPS = ['color', 'backgroundColor', 'borderTopColor', 'outlineColor', 'fill', 'stroke'];
  const translucentPart = PAINT_PROPS.some((k) => { const c = A.parseRGB(cssInfo[k]); return !!(c && c.a != null && c.a > 0 && c.a < 1); });
  const usedColourReliable = !(cssInfo.hasGradient || cssInfo.hasFilter || (Number.isFinite(cssInfo.opacity) && cssInfo.opacity < 1) || translucentPart);
  return { ...cssInfo, renderedPixelRGBA, cssVsRenderedDivergence: divergence, translucentPart, usedColourReliable, note: 'BOTH the CSS used-colours AND the rendered pixel are returned. sourceProperty is the used-colour the pixel best matches. If divergent, NO used-colour explains the pixel (CSS misleads). If usedColourReliable is false (gradient/filter/opacity<1/translucent) OR translucentPart, trust ONLY the rendered pixel and treat the CSS colour as INCONCLUSIVE. pseudo.before/after carry ::before/::after colours when those pseudo-elements paint the indicator.' };
}

const _dnsLookup = (host, o) => require('dns').promises.lookup(host, o);
function isPrivateIp(ip) {
  const net = require('net');
  if (net.isIPv4(ip)) {
    const o = ip.split('.').map(Number);
    if (o.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
    if (o[0] === 0 || o[0] === 10 || o[0] === 127) return true;
    if (o[0] === 169 && o[1] === 254) return true;
    if (o[0] === 172 && o[1] >= 16 && o[1] <= 31) return true;
    if (o[0] === 192 && o[1] === 168) return true;
    if (o[0] === 100 && o[1] >= 64 && o[1] <= 127) return true;
    if (o[0] >= 224) return true;
    return false;
  }
  if (net.isIPv6(ip)) {
    const a = ip.toLowerCase().replace(/^\[|\]$/g, '');
    if (a === '::1' || a === '::') return true;
    if (a.startsWith('::ffff:') && net.isIPv4(a.slice(7))) return isPrivateIp(a.slice(7));
    if (/^f[cd][0-9a-f]{2}:/.test(a) || a.startsWith('fc') || a.startsWith('fd')) return true;
    if (a.startsWith('fe8') || a.startsWith('fe9') || a.startsWith('fea') || a.startsWith('feb')) return true;
    return false;
  }
  return true;
}
async function ssrfSafeUrl(u, lookup = _dnsLookup) {
  if (!u || !/^https?:$/.test(u.protocol)) return { safe: false, reason: 'non-http' };
  if (u.username || u.password) return { safe: false, reason: 'credentials-in-url' };
  const port = u.port ? Number(u.port) : (u.protocol === 'https:' ? 443 : 80);
  if (port !== 80 && port !== 443) return { safe: false, reason: 'non-standard-port' };
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (!host || /^(localhost|.*\.local|.*\.localhost|.*\.internal|metadata|metadata\.google\.internal)$/i.test(host)) return { safe: false, reason: 'local-hostname' };
  let addrs;
  try { addrs = await lookup(host, { all: true }); } catch (e) { return { safe: false, reason: 'dns-failed' }; }
  if (!Array.isArray(addrs) || !addrs.length) return { safe: false, reason: 'no-address' };
  for (const a of addrs) if (isPrivateIp(a.address)) return { safe: false, reason: 'private-ip', ip: a.address };
  return { safe: true, addresses: addrs.map((a) => a.address) };
}

const _DEST_CACHE = new Map();
async function resolveDestination(page, args, opts = {}) {

  const allowCrossOrigin = opts.allowCrossOrigin !== false;
  const ssrfCheck = opts.ssrfCheck || ((u) => ssrfSafeUrl(u, opts.lookup));
  const { linkXpath, linkXpaths } = args || {};

  const knownGroup = (!Array.isArray(linkXpaths) || !linkXpaths.length) && typeof linkXpath === 'string' && linkXpath
    && opts.linkPeerGroups && typeof opts.linkPeerGroups.get === 'function' ? opts.linkPeerGroups.get(linkXpath) : null;
  const xpaths = (Array.isArray(linkXpaths) && linkXpaths.length) ? linkXpaths
    : (knownGroup && knownGroup.length) ? knownGroup
    : (typeof linkXpath === 'string' && linkXpath ? [linkXpath] : []);
  if (!xpaths.length) return { error: 'linkXpath (string) or linkXpaths (array) required' };
  const dir = (u) => u.pathname.slice(0, u.pathname.lastIndexOf('/') + 1);

  const ROOT_DEPTH = 3;
  const ancestorDir = (pathname, up) => { let d = pathname.slice(0, pathname.lastIndexOf('/') + 1); for (let i = 0; i < up; i++) { const t = d.replace(/\/+$/, ''); const cut = t.lastIndexOf('/'); d = cut > 0 ? t.slice(0, cut + 1) : '/'; } return d; };
  const sameLocalRoot = (t, b) => { const root = ancestorDir(b.pathname, ROOT_DEPTH); return root.length > 1 && t.pathname.startsWith(root); };
  const browser = page.browser();

  const resolveOne = async (xp) => {
    const info = await page.evaluate((x) => {
      const el = window.__ia?.resolve ? window.__ia.resolve(x)
        : document.evaluate(x, document, null, 9, null).singleNodeValue;
      if (!el) return { found: false };
      const a = (el.closest && el.closest('a[href]')) || el;
      let href = a.href || null;

      if (!href) {
        const oc = (el.getAttribute && el.getAttribute('onclick')) || (a.getAttribute && a.getAttribute('onclick')) || '';
        const m = oc.match(/(?:location\.href|location\.assign|location\.replace|location|window\.open)\s*(?:=|\()\s*['"]([^'"]+)['"]/i);
        const fragment = oc.match(/(?:document\.|window\.)?location(?:\.href)?\s*\+=\s*['"](#[^'"]*)['"]/i);
        const destination = m ? m[1] : fragment ? fragment[1] : null;
        if (destination !== null) { try { href = new URL(destination, location.href).href; } catch (e) {                                                           } }
      }
      return { found: true, href, pageUrl: location.href };
    }, xp).catch(() => null);
    if (!info || !info.found) return { linkXpath: xp, error: 'link not found' };
    if (!info.href) return { linkXpath: xp, error: 'no href or onclick-nav target on the link' };
    let target, base;
    try { target = new URL(info.href); base = new URL(info.pageUrl); } catch (e) { return { linkXpath: xp, refused: 'unparseable-url' }; }
    if (!/^https?:$/.test(target.protocol) && target.protocol !== 'file:') return { linkXpath: xp, refused: 'non-http-or-file' };
    const sameOrigin = target.protocol === 'file:' ? (base.protocol === 'file:' && sameLocalRoot(target, base)) : (target.origin === base.origin);
    let crossOrigin = false;
    if (!sameOrigin) {

      if (target.protocol === 'file:') return { linkXpath: xp, refused: 'cross-origin', destinationOrigin: target.origin };
      if (!allowCrossOrigin) return { linkXpath: xp, refused: 'cross-origin', destinationOrigin: target.origin };
      const guard = await ssrfCheck(target);
      if (!guard.safe) return { linkXpath: xp, refused: 'cross-origin-unsafe', destinationOrigin: target.origin, reason: guard.reason };
      crossOrigin = true;
    }
    if (_DEST_CACHE.has(target.href)) return { linkXpath: xp, ..._DEST_CACHE.get(target.href), cached: true };
    let bctx = null, p = null;
    try {
      bctx = browser.createBrowserContext ? await browser.createBrowserContext() : await browser.createIncognitoBrowserContext();
      p = await bctx.newPage();
      await p.setRequestInterception(true).catch(() => {});
      p.on('request', (req) => {
        let ok = false;
        try { const u = new URL(req.url()); if (u.protocol === 'data:' || u.protocol === 'about:' || u.protocol === 'blob:') ok = true; else if (target.protocol === 'file:') ok = (u.protocol === 'file:' && sameLocalRoot(u, base)); else ok = (u.origin === target.origin); } catch (e) { ok = false; }
        if (ok) req.continue().catch(() => {}); else req.abort().catch(() => {});
      });
      const resp = await p.goto(target.href, { waitUntil: 'load', timeout: 15000 }).catch(() => null);
      let finalU = null; try { finalU = new URL(p.url()); } catch (e) {}

      const expectOrigin = crossOrigin ? target.origin : base.origin;
      const finalSameOrigin = finalU && (target.protocol === 'file:' ? (finalU.protocol === 'file:' && sameLocalRoot(finalU, base)) : (finalU.origin === expectOrigin));
      if (!finalSameOrigin) return { linkXpath: xp, refused: crossOrigin ? 'cross-origin-redirect-offsite' : 'cross-origin-redirect', finalOrigin: finalU ? finalU.origin : null };
      const httpChain = (() => { try { return resp ? resp.request().redirectChain().length : 0; } catch (e) { return 0; } })();
      const meta = await p.evaluate(() => { const m = document.querySelector('meta[http-equiv="refresh" i]'); if (!m) return null; const c = (m.getAttribute('content') || '').trim(); const mm = c.match(/^(\d+(?:\.\d+)?)\s*(?:;|$)/); return mm ? { delay: parseFloat(mm[1]) } : null; }).catch(() => null);
      let instantRedirect = httpChain > 0, redirectDelayMs = httpChain > 0 ? 0 : null, interstitial = false;
      if (meta) { redirectDelayMs = Math.round(meta.delay * 1000); instantRedirect = httpChain > 0 || meta.delay === 0; interstitial = meta.delay > 0; }
      const fp = await p.evaluate(() => {

        const vis = (el) => { if (!el) return false; const s = getComputedStyle(el); if (s.display === 'none' || s.visibility === 'hidden') return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
        const m = document.querySelector('main') || document.body;
        const h1 = [...document.querySelectorAll('h1')].find(vis) || document.querySelector('h1');
        const para = [...((m || document).querySelectorAll('p'))].find(vis) || (m && m.querySelector('p'));
        const vt = ((document.body && document.body.innerText) || '').replace(/\s+/g, ' ').trim().slice(0, 240);
        return { title: document.title, h1: h1 ? h1.textContent : null, mainFirstParagraph: para ? (para.textContent || '').trim().slice(0, 160) : null, visibleText: vt };
      }).catch(() => ({}));
      const fingerprint = { finalUrl: p.url().slice(0, 300), httpStatus: resp ? resp.status() : null, title: (fp.title || '').slice(0, 200), h1: fp.h1 ? String(fp.h1).trim().slice(0, 160) : null, mainFirstParagraph: fp.mainFirstParagraph || null, visibleText: fp.visibleText || null, instantRedirect, redirectDelayMs, ...(interstitial ? { interstitialPage: true } : {}), ...(crossOrigin ? { crossOrigin: true } : {}) };
      _DEST_CACHE.set(target.href, fingerprint);
      return { linkXpath: xp, ...fingerprint };
    } catch (e) { return { linkXpath: xp, error: String(e && e.message || e).slice(0, 200) }; }
    finally { try { if (p) await p.close(); } catch (e) {} try { if (bctx && bctx.close) await bctx.close(); } catch (e) {} }
  };
  if (xpaths.length === 1) {
    const { linkXpath: _lx, ...rest } = await resolveOne(xpaths[0]);
    return { ...rest, note: 'raw destination fingerprint; same-origin always, cross-origin http(s) resolved behind an SSRF guard (crossOrigin:true on the result; refused:"cross-origin-unsafe" if the target is private/credentialed/non-80-443, "cross-origin" for a file:// off-root link). instantRedirect=true only for a 3xx or meta-refresh delay 0 (only instant redirects count); a delayed redirect sets interstitialPage (the fingerprint is the PRE-redirect page). The model judges "same purpose?" — never equivalent/same/different.' };
  }

  const fingerprints = [];
  for (const xp of xpaths.slice(0, 8)) fingerprints.push(await resolveOne(xp));
  const ok = fingerprints.filter((f) => f && !f.error && !f.refused);

  const eqOf = (field) => ok.length >= 2 ? ok.every((f) => f[field] === ok[0][field]) : null;
  return { fingerprints, resolvedCount: ok.length, equality: { finalUrlEqual: eqOf('finalUrl'), titleEqual: eqOf('title'), h1Equal: eqOf('h1'), mainFirstParagraphEqual: eqOf('mainFirstParagraph'), visibleTextEqual: eqOf('visibleText') }, note: 'each link resolved to a raw fingerprint (+ redirect timing) + a per-field byte-EQUALITY grid across the resolved set. Equality is string-equality only (the model judges "same purpose?"); an equality field is null when fewer than 2 links resolved (could not compare — NOT "different"). visibleText/h1 are read from the RENDERED page (post client-side JS), so two same-named links to different query branches differ here even when the static URL/title match.' };
}

function wordDiff(a, b) {
  const A = String(a || '').split(/\s+/).filter(Boolean).slice(0, 800), B = String(b || '').split(/\s+/).filter(Boolean).slice(0, 800);
  const L = Array.from({ length: A.length + 1 }, () => new Uint16Array(B.length + 1));
  for (let i = A.length - 1; i >= 0; i--) for (let j = B.length - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const onlyA = [], onlyB = [];
  let i = 0, j = 0, ra = [], rb = [];
  const flush = () => { if (ra.length) onlyA.push(ra.join(' ')); if (rb.length) onlyB.push(rb.join(' ')); ra = []; rb = []; };
  while (i < A.length || j < B.length) {
    if (i < A.length && j < B.length && A[i] === B[j]) { flush(); i++; j++; }
    else if (j >= B.length || (i < A.length && L[i + 1][j] >= L[i][j + 1])) ra.push(A[i++]);
    else rb.push(B[j++]);
  }
  flush();
  const shared = L[0][0];
  return { onlyInFirst: onlyA.slice(0, 12), onlyInSecond: onlyB.slice(0, 12), sharedWordFraction: +(A.length + B.length ? (2 * shared) / (A.length + B.length) : 1).toFixed(2) };
}

async function compareIframeContent(page, args) {
  const { iframeXpath, iframeXpaths } = args || {};
  const xpaths = (Array.isArray(iframeXpaths) && iframeXpaths.length) ? iframeXpaths : (typeof iframeXpath === 'string' && iframeXpath ? [iframeXpath] : []);
  if (!xpaths.length) return { error: 'iframeXpath (string) or iframeXpaths (array) required' };
  const frames = await page.evaluate((xps) => {
    const vis = (doc, e) => { if (!e) return false; try { const s = doc.defaultView.getComputedStyle(e); if (s.display === 'none' || s.visibility === 'hidden') return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; } catch (x) { return true; } };
    return xps.slice(0, 8).map((xp) => {
      const el = (window.__ia?.resolve ? window.__ia.resolve(xp) : document.evaluate(xp, document, null, 9, null).singleNodeValue);
      if (!el || (el.tagName !== 'IFRAME' && el.tagName !== 'FRAME')) return { iframeXpath: xp, found: false };
      const src = el.getAttribute('src') || '';
      let doc = null; try { doc = el.contentDocument; } catch (e) { doc = null; }
      if (!doc) return { iframeXpath: xp, found: true, src, crossOrigin: true };
      const h1 = [...doc.querySelectorAll('h1')].find((e) => vis(doc, e)) || doc.querySelector('h1');
      const para = [...doc.querySelectorAll('p')].find((e) => vis(doc, e)) || doc.querySelector('p');
      const text = ((doc.body && doc.body.innerText) || '').replace(/\s+/g, ' ').trim();
      return { iframeXpath: xp, found: true, src, crossOrigin: false, title: (doc.title || '').slice(0, 200), h1: h1 ? (h1.textContent || '').trim().slice(0, 160) : null, firstParagraph: para ? (para.textContent || '').trim().slice(0, 160) : null, textLen: text.length, visibleText: text.slice(0, 240), fullText: text.slice(0, 4000) };
    });
  }, xpaths).catch(() => null);
  if (!frames) return { error: 'could not read iframes' };

  for (const f of frames) {
    if (!f || !f.found || !f.crossOrigin) continue;
    try {
      const h = await page.evaluateHandle((xp) => (window.__ia?.resolve ? window.__ia.resolve(xp) : document.evaluate(xp, document, null, 9, null).singleNodeValue), f.iframeXpath);
      const fr = h.asElement() ? await h.asElement().contentFrame() : null;
      await h.dispose();
      if (!fr) continue;
      const got = await fr.evaluate(() => {
        const vis = (e) => { if (!e) return false; const s = getComputedStyle(e); if (s.display === 'none' || s.visibility === 'hidden') return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
        const h1 = [...document.querySelectorAll('h1')].find(vis) || document.querySelector('h1');
        const para = [...document.querySelectorAll('p')].find(vis) || document.querySelector('p');
        const text = ((document.body && document.body.innerText) || '').replace(/\s+/g, ' ').trim();
        return { title: (document.title || '').slice(0, 200), h1: h1 ? (h1.textContent || '').trim().slice(0, 160) : null, firstParagraph: para ? (para.textContent || '').trim().slice(0, 160) : null, textLen: text.length, visibleText: text.slice(0, 240), fullText: text.slice(0, 4000) };
      });
      Object.assign(f, got, { readViaFrameTarget: true });
    } catch (e) {                    }
  }
  const ok = frames.filter((f) => f && f.found && (f.crossOrigin === false || f.readViaFrameTarget));

  const eqOf = (field) => ok.length >= 2 ? ok.every((f) => f[field] === ok[0][field]) : null;

  const differences = {};
  for (const [field, key] of [['title', 'title'], ['h1', 'h1'], ['firstParagraph', 'firstParagraph'], ['visibleText', 'fullText']]) {
    if (eqOf(field) !== false) continue;
    differences[field] = ok.slice(1).map((f) => ({ iframes: [ok[0].iframeXpath, f.iframeXpath], ...wordDiff(ok[0][key], f[key]) }));
  }
  for (const f of frames) if (f) delete f.fullText;
  return { iframes: frames, comparedCount: ok.length, equality: { titleEqual: eqOf('title'), h1Equal: eqOf('h1'), firstParagraphEqual: eqOf('firstParagraph'), visibleTextEqual: eqOf('visibleText') }, ...(Object.keys(differences).length ? { differences } : {}), note: 'each same-named iframe\'s RENDERED content (read from its contentDocument, or through its frame target when the page may not read it: readViaFrameTarget) + a per-field string-EQUALITY grid; for each unequal field, `differences` lists the words only in each iframe and the fraction of words shared (visibleText compared over the first 4000 characters). Equality and differences are about strings only (you judge "equivalent purpose?"); a field is null when fewer than 2 iframes were readable (could NOT compare — NOT "different"). An iframe without content fields could not be read — judge it from src + crops or return PARTIAL.' };
}

function rgbToLab(r, g, b) {
  const f = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const R = f(r), G = f(g), B = f(b);
  let X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047, Y = R * 0.2126 + G * 0.7152 + B * 0.0722, Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const k = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = k(X), fy = k(Y), fz = k(Z);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), bb: 200 * (fy - fz) };
}

function deltaE2000(c1, c2) {
  const l1 = rgbToLab(c1.r, c1.g, c1.b), l2 = rgbToLab(c2.r, c2.g, c2.b);
  const d2r = (d) => d * Math.PI / 180, r2d = (r) => r * 180 / Math.PI;
  const L1 = l1.L, A1 = l1.a, B1 = l1.bb, L2 = l2.L, A2 = l2.a, B2 = l2.bb;
  const C1 = Math.hypot(A1, B1), C2 = Math.hypot(A2, B2), Cbar = (C1 + C2) / 2;
  const C7 = Math.pow(Cbar, 7), G = 0.5 * (1 - Math.sqrt(C7 / (C7 + Math.pow(25, 7))));
  const a1p = (1 + G) * A1, a2p = (1 + G) * A2;
  const C1p = Math.hypot(a1p, B1), C2p = Math.hypot(a2p, B2);
  const hp = (b, ap) => { if (b === 0 && ap === 0) return 0; const h = r2d(Math.atan2(b, ap)); return h >= 0 ? h : h + 360; };
  const h1p = hp(B1, a1p), h2p = hp(B2, a2p);
  const dLp = L2 - L1, dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) { dhp = h2p - h1p; if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360; }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(d2r(dhp) / 2);
  const Lbarp = (L1 + L2) / 2, Cbarp = (C1p + C2p) / 2;
  let hbarp;
  if (C1p * C2p === 0) hbarp = h1p + h2p;
  else if (Math.abs(h1p - h2p) <= 180) hbarp = (h1p + h2p) / 2;
  else hbarp = (h1p + h2p + (h1p + h2p < 360 ? 360 : -360)) / 2;
  const T = 1 - 0.17 * Math.cos(d2r(hbarp - 30)) + 0.24 * Math.cos(d2r(2 * hbarp)) + 0.32 * Math.cos(d2r(3 * hbarp + 6)) - 0.20 * Math.cos(d2r(4 * hbarp - 63));
  const dtheta = 30 * Math.exp(-Math.pow((hbarp - 275) / 25, 2));
  const Cbarp7 = Math.pow(Cbarp, 7), Rc = 2 * Math.sqrt(Cbarp7 / (Cbarp7 + Math.pow(25, 7)));
  const Sl = 1 + (0.015 * Math.pow(Lbarp - 50, 2)) / Math.sqrt(20 + Math.pow(Lbarp - 50, 2));
  const Sc = 1 + 0.045 * Cbarp, Sh = 1 + 0.015 * Cbarp * T;
  const Rt = -Math.sin(d2r(2 * dtheta)) * Rc;
  return Math.sqrt(Math.pow(dLp / Sl, 2) + Math.pow(dCp / Sc, 2) + Math.pow(dHp / Sh, 2) + Rt * (dCp / Sc) * (dHp / Sh));
}

async function compareNamedRegions(page, args) {
  const { targetXpath, regions } = args || {};
  if (typeof targetXpath !== 'string' || !targetXpath) return { error: 'targetXpath required' };
  if (!Array.isArray(regions) || regions.length < 2) return { error: 'at least 2 named regions required (each {name,x,y,w,h} as fractions 0-1 of the element)' };

  const box = await page.evaluate((xp) => { const el = (window.__ia?.resolve ? window.__ia.resolve(xp) : document.evaluate(xp, document, null, 9, null).singleNodeValue); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.max(0, r.x + window.scrollX), y: Math.max(0, r.y + window.scrollY), w: r.width, h: r.height }; }, targetXpath).catch(() => null);
  if (!box || !(box.w > 0 && box.h > 0)) return { error: 'target not found or zero-size' };
  const clip = { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.w), height: Math.round(box.h) };
  const shot = await require('./settle.js').robustScreenshot(page, { encoding: 'base64', clip, captureBeyondViewport: true });
  if (!shot) return { error: 'capture failed' };
  const colors = await page.evaluate(async (b64, regs) => {
    try {
      const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
      return regs.map((reg) => {
        const rx = Math.max(0, Math.floor((reg.x || 0) * img.width)), ry = Math.max(0, Math.floor((reg.y || 0) * img.height));
        const rw = Math.min(img.width - rx, Math.max(1, Math.floor((reg.w || 0.2) * img.width))), rh = Math.min(img.height - ry, Math.max(1, Math.floor((reg.h || 0.2) * img.height)));
        if (rw <= 0 || rh <= 0) return { name: reg.name, error: 'region out of bounds' };
        const d = ctx.getImageData(rx, ry, rw, rh).data; let R = 0, G = 0, B = 0, R2 = 0, G2 = 0, B2 = 0, n = 0;
        for (let i = 0; i < d.length; i += 4) { R += d[i]; G += d[i + 1]; B += d[i + 2]; R2 += d[i] * d[i]; G2 += d[i + 1] * d[i + 1]; B2 += d[i + 2] * d[i + 2]; n++; }
        const mr = R / n, mg = G / n, mb = B / n;
        const colorSpread = Math.sqrt(Math.max(0, R2 / n - mr * mr) + Math.max(0, G2 / n - mg * mg) + Math.max(0, B2 / n - mb * mb));

        return { name: reg.name, r: Math.round(mr), g: Math.round(mg), b: Math.round(mb), colorSpread: +colorSpread.toFixed(1) };
      });
    } catch (e) { return null; }
  }, shot, regions).catch(() => null);
  if (!colors) return { error: 'pixel sampling failed' };
  const pairs = [];
  for (let i = 0; i < colors.length; i++) for (let j = i + 1; j < colors.length; j++) {
    if (colors[i].error || colors[j].error) continue;
    const dE = deltaE2000(colors[i], colors[j]);
    const lumDelta = Math.abs(rgbToLab(colors[i].r, colors[i].g, colors[i].b).L - rgbToLab(colors[j].r, colors[j].g, colors[j].b).L);
    pairs.push({ a: colors[i].name, b: colors[j].name, deltaE2000: +dE.toFixed(1), luminanceDelta: +lumDelta.toFixed(1), perceptiblyDistinct: dE > 11 });
  }
  return { regionColors: colors, pairs, note: 'per-region MEAN colour (+ colorSpread; high spread ⇒ mean is unrepresentative) and the perceptual ΔE2000 + luminanceDelta between named regions (F13). perceptiblyDistinct = ΔE2000 > 11 (conservative "clearly distinct" bound). Derived measure only — never raw pixels, never a 1.4.3/1.4.11 contrast ratio, never a verdict.' };
}

async function ocrImageText(page, args, ctx) {
  const { targetXpath, x, y, width, height } = args || {};
  if (!ctx || !ctx.ocr || (ctx.ocr.available && !ctx.ocr.available())) return { error: 'ocr-unavailable — PP-OCRv6 sidecar not configured; treat as INCONCLUSIVE, not empty' };
  let clip = null, clampedToViewport = false;
  if (typeof targetXpath === 'string' && targetXpath) {

    const box = await page.evaluate((xp) => { const el = (window.__ia?.resolve ? window.__ia.resolve(xp) : document.evaluate(xp, document, null, 9, null).singleNodeValue); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.max(0, r.x + window.scrollX), y: Math.max(0, r.y + window.scrollY), w: r.width, h: r.height }; }, targetXpath).catch(() => null);
    if (!box || !(box.w > 0 && box.h > 0)) return { error: 'target not found or zero-size' };
    clip = { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.w), height: Math.round(box.h) };
  } else if ([x, y, width, height].every((v) => Number.isFinite(v)) && width > 0 && height > 0) {

    const vp = await page.evaluate(() => ({ w: Math.max(document.documentElement.scrollWidth, window.innerWidth), h: Math.max(document.documentElement.scrollHeight, window.innerHeight) })).catch(() => ({ w: 4096, h: 8192 }));
    const cx = Math.max(0, Math.round(x)), cy = Math.max(0, Math.round(y));
    const cw = Math.min(Math.round(width), vp.w - cx), ch = Math.min(Math.round(height), vp.h - cy);
    if (!(cw > 0 && ch > 0)) return { error: 'explicit rect is outside the page bounds' };
    clampedToViewport = (cx !== Math.round(x) || cy !== Math.round(y) || cw !== Math.round(width) || ch !== Math.round(height));
    clip = { x: cx, y: cy, width: cw, height: ch };
  } else {
    return { error: 'provide targetXpath OR an explicit x/y/width/height rect' };
  }
  const b64 = await require('./settle.js').robustScreenshot(page, { encoding: 'base64', clip, captureBeyondViewport: true });
  if (!b64) return { error: 'capture failed' };
  const r = await ctx.ocr.recognize(b64);
  if (r.error) return { error: r.error, note: 'OCR could not run — do NOT infer the crop is empty; treat as INCONCLUSIVE.' };
  const lines = r.lines || [];
  const scored = lines.map((l) => (typeof l.score === 'number' ? l.score : null)).filter((s) => s != null);
  const minLineScore = scored.length ? +Math.min(...scored).toFixed(3) : null;
  const lowConfidenceLineCount = lines.filter((l) => typeof l.score === 'number' && l.score < 0.6).length;
  return { text: r.text || '', lines, lineCount: lines.length, minLineScore, lowConfidenceLineCount, engine: (ctx.ocr && ctx.ocr.engine && ctx.ocr.engine()) || null, ...(clampedToViewport ? { clampedToViewport: true } : {}), note: 'recognised text + PER-LINE boxes/confidence (PP-OCRv6 is a 50-language unified model; confidence is per-LINE, not per-glyph). Empty text OR a low minLineScore/low-confidence lines ≠ "no text" — treat a low-confidence read as INCONCLUSIVE (try request_hi_res_crop). NEVER a verdict.' };
}

async function captureFullPage(page, args, ctx) {
  const { targetXpath } = args || {};
  if (!ctx || typeof ctx.freshClone !== 'function') return { error: 'fresh clone unavailable — this screenshot tool refuses to resize the shared page' };
  const live = await ctx.freshClone();
  try {
    const info = await live.evaluate((xp) => {
      try { window.scrollTo(0, 0); } catch (e) {}
      const doc = document.documentElement;
      const pageSize = { w: Math.max(doc.scrollWidth, window.innerWidth), h: Math.max(doc.scrollHeight, window.innerHeight) };
      const viewport = { w: window.innerWidth, h: window.innerHeight };
      let target = null;
      if (xp) {
        const el = (window.__ia?.resolve ? window.__ia.resolve(xp) : document.evaluate(xp, document, null, 9, null).singleNodeValue);
        if (el && el.getBoundingClientRect) {
          const r = el.getBoundingClientRect();

          const offDocument = r.y < 0 || r.x < 0 || r.y > pageSize.h || r.x > pageSize.w;
          target = {
            box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
            tag: (el.tagName || '').toLowerCase(), role: el.getAttribute && el.getAttribute('role') || null,
            text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 120),
            inViewport: r.y < window.innerHeight && (r.y + r.height) > 0 && r.x < window.innerWidth && (r.x + r.width) > 0,
            offDocument,
            verticalPositionPct: pageSize.h ? Math.round(100 * (r.y / pageSize.h)) : null,
          };
        }
      }
      return { pageSize, viewport, target, hadTarget: !!xp };
    }, targetXpath || null).catch(() => null);
    if (!info) return { error: 'page introspection failed' };
    if (info.hadTarget && !info.target) return { error: 'target not found' };
    const screenshot = await require('./settle.js').robustScreenshot(live, { encoding: 'base64', fullPage: true });
    if (!screenshot) return { error: 'capture failed' };
    return { screenshot, fullPage: true, pageSize: info.pageSize, viewport: info.viewport, target: info.target,
      note: 'the WHOLE scrollable document (below the fold included). A target box is in PAGE coordinates (origin = document top); a NEGATIVE y or offDocument:true means the element is positioned OUTSIDE the document (e.g. top:-9999px → visually hidden) and is NOT in the captured pixels. Use to confirm an off-viewport element exists and judge WHERE it sits relative to surrounding content — never infer a barrier from position alone.' };
  } finally { try { await live.close(); } catch (e) {} }
}

function buildCdpToolDispatch(session) {
  const page = session.page;
  const ctx = { freshClone: session.freshClone, ocr: session.ocr, linkPeerGroups: session.linkPeerGroups };
  const HANDLERS = {
    query_ax_node: queryAxNode, observe_state_after_activation: observeStateAfterActivation,
    set_state_and_capture: setStateAndCapture, probe_screen_reader_after_action: probeScreenReaderAfterAction,
    measure_geometry_live: measureGeometryLive, request_hi_res_crop: requestHiResCrop,
    render_with_overrides: renderWithOverrides, compute_contrast_ratio: computeContrastRatio, measure_text_contrast_over_image: measureTextContrastOverImage,
    resolve_part_color: resolvePartColor, resolve_destination: resolveDestination,
    compare_iframe_content: compareIframeContent,
    compare_named_regions: compareNamedRegions, ocr_image_text: ocrImageText, capture_full_page: captureFullPage,
    interact_and_observe: interactAndObserve,
  };
  const S = (properties, required) => ({ type: 'object', properties, ...(required && required.length ? { required } : {}) });
  const declarations = [
    { name: 'query_ax_node', description: 'Read-only: resolve a node (by xpath OR by a screenshot pixel x/y) to its live accessibility facts — role, role source, heading level, name provenance (nameFrom), aria-labelledby/describedby IDREF resolve status, required states, focusability, aria-hidden, and — when the node sits in a data-table cell — its associated column/row HEADER text (cellHeaders: colHeaders/rowHeaders/headerSource/danglingHeaderIds), the programmatic header context for a cell or a link inside one. Returns raw facts, NEVER a pass/fail.',
      parameters: S({ targetXpath: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' } }) },
    { name: 'observe_state_after_activation', description: 'Mutating (runs on a FRESH page clone): activate ONE control (by xpath) and return the OBJECTIVE before/after delta — each newly-visible text with its visibilityCause (inserted | display | visibility | aria-hidden | text-changed), whether it landed in a live region AND whether that region PRE-EXISTED (4.1.3: a region created with its message is NOT a reliable announcement → anyNewTextInNewLiveRegion, INCONCLUSIVE), whether focus moved into the revealed content (focusMovedToChange), and whether the page navigated/opened a window. Refuses a non-perceivable target. Reports WHAT changed and HOW, never whether it is conformant.',
      parameters: S({ targetXpath: { type: 'string' } }, ['targetXpath']) },
    { name: 'interact_and_observe', description: 'Mutating: actions are type, click, press, focus, clear, hover, move, drag or wait (waitMs). Maximum 16 per call; use a retained stateId to continue longer workflows. Pointer actions scroll and verify the hit target; failed focus/activation is reported, never a successful negative observation. settleMs bounds asynchronous settling (500-10000 ms, default 2500). Each step records success, focus and revealed content; results include successfulActions, failedActions, observationComplete, dialogs, validation/submit events and objective DOM deltas. Constraint-invalid state and validationMessage are available properties, not proof of presented error feedback. noErrorSurfaced is unknown (null). No conformance verdict. Navigation/submit blocked.',
      parameters: S({ actions: { type: 'array', items: { type: 'object', properties: { op: { type: 'string', enum: ['type', 'click', 'press', 'focus', 'clear', 'hover', 'move', 'drag', 'wait'] }, xpath: { type: 'string' }, toXpath: { type: 'string' }, text: { type: 'string' }, key: { type: 'string' }, holdMs: { type: 'number' }, waitMs: { type: 'number' } }, required: ['op'] } }, maxActions: { type: 'number' }, settleMs: { type: 'number' } }, ['actions']) },
    { name: 'set_state_and_capture', description: 'Mutating (FRESH clone): drive ONE element into an interaction state (focus|hover|checked|open|expanded|placeholder-shown) and return before/after screenshots of the same region + the computed-style DELTA (which outline/border/decoration/background props changed) + stateReached/textVisible. Use for state-specific indicators (1.4.11/1.4.1/1.4.3). matchesFocusVisible is only the CSS :focus-visible match; targetBox is the element bounds, not a measured ring. Determine visible indicators from screenshots and styleDelta. Returns PIXELS + objective style deltas, never a contrast number or a verdict. Check captureValid/comparisonValid and captureContext: if the target moved or a frame is unavailable, pixelsChanged is null and the comparison is inconclusive. focusMethod distinguishes a sequential return from programmatic fallback. If stateReached is false, the requested state was not observed.',
      parameters: S({ targetXpath: { type: 'string' }, state: { type: 'string', enum: ['focus', 'hover', 'checked', 'open', 'expanded', 'placeholder-shown'] } }, ['targetXpath', 'state']) },
    { name: 'probe_screen_reader_after_action', description: 'Mutating (FRESH clone): run a screen reader, clear its log, activate ONE control (by xpath), settle, and return the VERBATIM spoken-phrase queue. Returns BOTH the full announcements queue AND liveRegionAnnouncements (the polite/assertive subset — the ONLY 4.1.3-relevant phrases; focus/change-of-context phrases are excluded by 4.1.3). emptyQueue/noLiveRegionAnnouncement flag a genuine silence; an instrument failure returns {error,probeFailed:true} instead (never a fake emptyQueue). Raw phrases, never an adequacy/announced verdict.',
      parameters: S({ triggerXpath: { type: 'string' } }, ['triggerXpath']) },
    { name: 'measure_geometry_live', description: 'Read-only on the shared page (unless viewportWidth is given): box, horizontal overflow + culprit, occludedElements[] (what paints on top of the target — 1.4.13 Dismissible), and (if otherXpath) overlapFractionOfTarget/OfOther + gapX/gapY between the two boxes. Pass viewportWidth to re-measure on a CLONE at that width (1.4.10 reflow) — stateUsed echoes which. Raw numbers; marks degenerate boxes ambiguous; never a pass/fail.',
      parameters: S({ targetXpath: { type: 'string' }, otherXpath: { type: 'string' }, viewportWidth: { type: 'number' } }, ['targetXpath']) },
    { name: 'request_hi_res_crop', description: 'Mutating (FRESH clone): re-raster ONE element at a higher DEVICE scale (2-4x, NOT page zoom) and return the PNG + the actual scale + CSS-pixel and device-pixel sizes. Use when a small wordmark/chart label is unreadable in the 1x crop (1.1.1/1.4.5). Covers the whole element. If the result is still illegible, return PARTIAL — never invent text.',
      parameters: S({ targetXpath: { type: 'string' }, scale: { type: 'number' } }, ['targetXpath']) },
    { name: 'render_with_overrides', description: 'Mutating (FRESH clone): re-render under ONE transform (grayscale|protanopia|deuteranopia|tritanopia|forced-colors|no-author-css) and return the screenshot (whole element if targetXpath given, else viewport). For 1.4.1 (which colour cue is load-bearing after grayscale/CVD) and forced-colors survival. Judge from pixels; never assert a numeric ratio from a transformed image.',
      parameters: S({ transform: { type: 'string', enum: ['grayscale', 'protanopia', 'deuteranopia', 'tritanopia', 'forced-colors', 'no-author-css'] }, targetXpath: { type: 'string' } }, ['transform']) },
    { name: 'compute_contrast_ratio', description: 'Read-only: specify propertyA/propertyB to select each node color source (color|backgroundColor|borderTopColor|borderRightColor|borderBottomColor|borderLeftColor|outlineColor|fill|stroke; B also auto). Defaults A=color, B=own backgroundColor if nontransparent else color. For two background cues choose backgroundColor for BOTH. colorSources echoes the properties. The WCAG contrast ratio for TWO flat used-colours the model chooses (e.g. an in-text link colour vs the surrounding text colour — G183 for 1.4.1). Returns colorA/colorB/contrastRatio/threshold/passes from CSSOM. REFUSES (inconclusive) translucent/unparseable colours — it never sweeps a photo/gradient. `passes` is a mechanical compare, not a verdict.',
      parameters: S({ nodeAXpath: { type: 'string' }, nodeBXpath: { type: 'string' }, threshold: { type: 'number' }, propertyA: { type: 'string', enum: ['color', 'backgroundColor', 'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor', 'outlineColor', 'fill', 'stroke'] }, propertyB: { type: 'string', enum: ['auto', 'color', 'backgroundColor', 'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor', 'outlineColor', 'fill', 'stroke'] } }, ['nodeAXpath', 'nodeBXpath']) },
    { name: 'measure_text_contrast_over_image', description: 'Mutating (FRESH clone): PER-PIXEL worst-case TEXT-vs-BACKGROUND contrast under the glyph footprint when text sits over a background IMAGE/gradient (1.4.3 — the case compute_contrast_ratio refuses). Returns worstCaseRatio/medianRatio/bestCaseRatio, fractionBelowThreshold, glyphPixels, fontPx/fontWeight/isLargeText, threshold/textThreshold (font-derived), worstCasePasses, bgKind. Caller threshold is a separate requestedThreshold/passesRequestedThreshold comparison; it cannot override SC 1.4.3. worstCaseRatio governs (ALL text must meet the threshold). Containers with independently styled text return inconclusive plus bounded suggestedTargets; select actual text nodes. Raw numbers, never a verdict.',
      parameters: S({ targetXpath: { type: 'string' }, threshold: { type: 'number' } }, ['targetXpath']) },
    { name: 'resolve_part_color', description: 'Read-only: for a NON-TEXT part at a screenshot pixel (x,y) — a border/indicator/SVG fill — return the CSS used-colours (incl. ::before/::after pseudo) AND the RENDERED pixel AND cssVsRenderedDivergence (sourceProperty = the used-colour the pixel best matches). usedColourReliable is false when a gradient/filter/opacity<1/translucent part means no single flat colour is sound ⇒ trust ONLY the rendered pixel. If divergent, no used-colour explains the pixel ⇒ INCONCLUSIVE. Raw RGBA + flags, never a ratio/verdict.',
      parameters: S({ x: { type: 'number' }, y: { type: 'number' } }, ['x', 'y']) },
    { name: 'resolve_destination', description: 'Read-only: follow a SAME-ORIGIN link in an isolated incognito GET and return a RAW fingerprint (finalUrl/httpStatus/title/h1/mainFirstParagraph + instantRedirect/redirectDelayMs/interstitialPage) — for 2.4.4. Pass linkXpaths[] (the SET of same-named links — fd3a94 is a set test) to resolve all in one call + get a per-field byte-EQUALITY grid. instantRedirect is true only for a 3xx or meta-refresh delay-0 (only instant redirects count). NEVER same/equivalent/different — your judgment. Cross-origin http(s) IS resolved (behind an SSRF guard, crossOrigin:true on the result); non-http and private/credentialed/off-port targets are refused.',
      parameters: S({ linkXpath: { type: 'string' }, linkXpaths: { type: 'array', items: { type: 'string' } } }) },
    { name: 'compare_iframe_content', description: 'Read-only: for 4.1.2 (same-named iframes must serve an EQUIVALENT purpose). Pass iframeXpaths[] (the SET of same-named iframes) and get each one\'s RENDERED content read from its SAME-ORIGIN contentDocument (title/h1/firstParagraph/visibleText) + a per-field byte-EQUALITY grid across the set — the rendered-content comparison the raw `src` string cannot give (page-one.html vs page-two.html look interchangeable as strings but render DIFFERENT content). A crossOrigin iframe cannot be read (reported crossOrigin:true — judge from src/crops or PARTIAL). NEVER equivalent/same/different — your judgment.',
      parameters: S({ iframeXpath: { type: 'string' }, iframeXpaths: { type: 'array', items: { type: 'string' } } }) },
    { name: 'compare_named_regions', description: 'Read-only: for an image/chart, given >=2 named regions (each {name,x,y,w,h} as fractions 0-1 of the element), return each region MEAN colour (+ colorSpread; high ⇒ multi-coloured, mean unrepresentative) and the perceptual ΔE2000 + luminanceDelta + perceptiblyDistinct between them (1.1.1 F13 — a colour-encoded distinction the alt omits). Derived measure only — never raw pixels, never a contrast ratio, never a verdict.',
      parameters: S({ targetXpath: { type: 'string' }, regions: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' } }, required: ['name', 'x', 'y', 'w', 'h'] } } }, ['targetXpath', 'regions']) },
    { name: 'ocr_image_text', description: 'Read-only: OCR a crop of the page — an element (targetXpath) OR an explicit x/y/width/height rect — via PP-OCRv6 and return the recognised text + per-line boxes + confidences. For images-of-text (1.4.5), a wordmark/label the vision pass cannot read, or comparing rendered text to the alt/accessible name. Objective reading of the pixels, NEVER a verdict; empty text on a low-res crop does NOT mean "no text" (use request_hi_res_crop first). Returns {error} when the OCR sidecar is not set up — treat as INCONCLUSIVE.',
      parameters: S({ targetXpath: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' } }) },
    { name: 'capture_full_page', description: 'Mutating (FRESH clone): a screenshot of the WHOLE scrollable document — beyond the viewport / below the fold. Optional targetXpath additionally returns that element\'s box in PAGE coordinates (origin = document top) + tag/role/text + verticalPositionPct + inViewport. Use to confirm an OFF-VIEWPORT heading/element exists and judge WHERE it sits relative to content (does an h1 introduce the prose or sit over the nav/TOC? — 2.4.10/2.4.6/1.3.1). Returns PIXELS + geometry, never a verdict; never infer a barrier from position alone.',
      parameters: S({ targetXpath: { type: 'string' } }) },
  ];

  const call = async (name, args) => {
    const fn = HANDLERS[name];
    if (!fn) return { error: `unknown tool: ${name}` };
    try { return await fn(page, args || {}, ctx); }
    catch (e) { return { error: String((e && e.message) || e) }; }
  };
  const supported = new Set(['query_ax_node','observe_state_after_activation','interact_and_observe','set_state_and_capture','probe_screen_reader_after_action','measure_geometry_live','request_hi_res_crop','render_with_overrides','compute_contrast_ratio','resolve_part_color','resolve_destination','compare_named_regions','capture_full_page']);
  return { declarations: declarations.filter(d => supported.has(d.name)), call: (name, args) => supported.has(name) ? call(name, args) : Promise.resolve({error: 'unknown tool: ' + name}) };
}

module.exports={queryAxNode,observeStateAfterActivation,interactAndObserve,setStateAndCapture,probeScreenReaderAfterAction,measureGeometryLive,requestHiResCrop,renderWithOverrides,computeContrastRatio,resolvePartColor,resolveDestination,compareNamedRegions,captureFullPage,buildCdpToolDispatch,ssrfSafeUrl,isPrivateIp};
