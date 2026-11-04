// InterA11y's tools, rubrics and judge for the verifier's agents (vendored
// in intera11y/; see its README). Each tool runs on a core adapter's page
// with the adapter on, in Puppeteer, and returns InterA11y's measurements,
// never a verdict. The agent judges, with InterA11y's rubric for the
// success criterion and its evidence standard (wcag_rubric).
//
// Limited to what the adapter created, changed or styled (adapter_elements):
// a tool that reads or measures an element refuses one outside that, since
// a problem there is the page's, not the adapter's. Tools that drive the
// page (interact_and_observe, observe_state_after_activation,
// probe_screen_reader_after_action) may start from any control, since the
// adapter may answer what the page does, but only their effects on the
// adapter's elements count. keyboard_audit compares the page without and
// with the adapter and reports only what the adapter brought.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { interA11y } from './harness.mjs';
import { rubricMatches, rubricFile, rubricUrl } from './intera11y-upstream.mjs';

// The tools InterA11y's own runtime offers its judge (src/lib/v3.js).
export const IA_TOOLS = ['query_ax_node', 'observe_state_after_activation', 'interact_and_observe', 'set_state_and_capture',
  'probe_screen_reader_after_action', 'measure_geometry_live', 'request_hi_res_crop', 'resolve_destination', 'compare_named_regions',
  'render_with_overrides', 'compute_contrast_ratio', 'resolve_part_color', 'capture_full_page'];
// The argument that names the element a reading tool reads.
const TARGET = { query_ax_node: 'targetXpath', set_state_and_capture: 'targetXpath', measure_geometry_live: 'targetXpath',
  request_hi_res_crop: 'targetXpath', compare_named_regions: 'targetXpath', render_with_overrides: 'targetXpath',
  capture_full_page: 'targetXpath', compute_contrast_ratio: 'nodeAXpath', resolve_destination: 'linkXpath' };
const DRIVES = new Set(['interact_and_observe', 'observe_state_after_activation', 'probe_screen_reader_after_action']);
export const RUBRIC_SCS = ['1.1.1', '1.4.1', '1.4.13', '2.1.1', '2.1.2', '2.4.3', '2.4.4', '2.4.7', '3.3.1', '4.1.3'];

const COMMON = {
  file: { type: 'string', description: 'The core adapter, such as tools/core-adapters/structure.js.' },
  page: { type: 'string', description: 'Its test page in tools/test/verify-core/pages/ (such as structure.html), or an https URL.' },
  personal: { type: 'object', description: 'The person\'s settings the blocks see, as for verify_adapter.' },
  options: { type: 'object', description: 'The options passed to enable().' },
  ai: { description: 'AI answers, as for verify_adapter.' },
  viewport: { type: 'object', properties: { width: { type: 'number' }, height: { type: 'number' } }, description: 'Default 1280 by 900.' },
  reducedMotion: { type: 'string', enum: ['reduce', 'no-preference'] },
};
const SCOPE_NOTE = ' Runs on your page with your adapter on (in Puppeteer, with the blocks and the stand-in host).';

/** The MCP declarations: InterA11y's tools with their own descriptions, and three of ours. */
export function interA11yTools() {
  const { tools } = interA11y();
  const decl = tools.buildCdpToolDispatch({ page: null, freshClone: null }).declarations.filter((d) => IA_TOOLS.includes(d.name));
  const out = decl.map((d) => {
    const props = { ...d.parameters.properties };
    delete props.stateId;
    const limit = TARGET[d.name] ? ` Only for an element your adapter created, changed or styled (adapter_elements lists them): ${TARGET[d.name]} outside that is refused.`
      : DRIVES.has(d.name) ? ' It may start from any control (your adapter may answer what the page does); judge only its effects on what your adapter created, changed or styled.' : '';
    return {
      name: d.name,
      description: `InterA11y: ${d.description}${SCOPE_NOTE}${limit} XPaths come from adapter_elements.`,
      inputSchema: { type: 'object', required: ['file', 'page', ...(d.parameters.required || [])], properties: { ...COMMON, ...props } },
    };
  });
  out.push(
    {
      name: 'adapter_elements',
      description: 'What your adapter created (its own UI), changed (page elements whose attributes or text it wrote) and styled (what its stylesheets match), on your page with it on, with each element\'s XPath. InterA11y\'s tools and your judgment are limited to these: a problem elsewhere is the page\'s. "everything" is true when a stylesheet of yours matches every element (such as a focus ring on *).',
      inputSchema: { type: 'object', required: ['file', 'page'], properties: { ...COMMON } },
    },
    {
      name: 'keyboard_audit',
      description: 'InterA11y\'s keyboard measurements, on your page without your adapter and with it: the Tab order (and where it departs from the visual order, 2.4.3), keyboard traps (2.1.2), focus that a control refuses or does not let go of, and focus resting inside aria-hidden content. Reports only what is new with your adapter on, and whether each involves what it created, changed or styled. Measurements, never a verdict.',
      inputSchema: { type: 'object', required: ['file', 'page'], properties: { ...COMMON, maxTabs: { type: 'number', description: 'At most this many Tab presses (default 300).' } } },
    },
    {
      name: 'wcag_rubric',
      description: `InterA11y's test rules and rubric for one WCAG 2.2 success criterion (${RUBRIC_SCS.join(', ')}), with the tools that gather each rule's evidence, and its evidence standard for a verdict (FAIL, PASS, NOT_APPLICABLE or UNDETERMINED). Judge what your adapter created, changed or styled against it.`,
      inputSchema: { type: 'object', required: ['sc'], properties: { sc: { type: 'string', enum: RUBRIC_SCS } } },
    },
  );
  return out;
}

export const isInterA11yTool = (name) => IA_TOOLS.includes(name) || ['adapter_elements', 'keyboard_audit', 'wcag_rubric'].includes(name);

const spec = (args) => ({ file: args.file, page: args.page, personal: args.personal, options: args.options, ai: args.ai, viewport: args.viewport, reducedMotion: args.reducedMotion });
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(`${what} took over ${ms / 1000} s`)), ms))]);

// Images in a tool's result (base64 PNGs) come back as images; the JSON says where each was.
function splitImages(value) {
  const images = [];
  const walk = (v, key) => {
    if (typeof v === 'string') {
      const m = /^data:image\/(png|jpeg);base64,(.+)$/s.exec(v);
      const b64 = m ? m[2] : (v.length > 2000 && /^[A-Za-z0-9+/=\s]+$/.test(v.slice(0, 4000)) ? v : null);
      if (b64) { images.push({ data: b64.replace(/\s+/g, ''), mimeType: m && m[1] === 'jpeg' ? 'image/jpeg' : 'image/png', label: key }); return `[image ${images.length}: ${key}]`; }
      return v;
    }
    if (Array.isArray(v)) return v.map((x, i) => walk(x, `${key}[${i}]`));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, key ? `${key}.${k}` : k)]));
    return v;
  };
  return { json: walk(value, ''), images };
}

function reply(value, extra = '') {
  const { json, images } = splitImages(value);
  const body = JSON.stringify(json, null, 1);
  const content = [{ type: 'text', text: (extra ? `${extra}\n` : '') + (body.length > 60000 ? `${body.slice(0, 60000)}\n… (cut at 60000 characters)` : body) }];
  for (const im of images.slice(0, 4)) content.push({ type: 'image', data: im.data, mimeType: im.mimeType });
  if (images.length > 4) content[0].text += `\n(${images.length - 4} more image${images.length - 4 === 1 ? '' : 's'} not sent)`;
  return { content };
}
const fail = (t) => ({ content: [{ type: 'text', text: t }], isError: true });

// The rules InterA11y adapted from GenA11y (GPL-3.0-only; marked
// from: 'gena11y') are left blank in intera11y/rubrics/. When a rubric
// that has them is asked for, their text is read from InterA11y itself, at
// the vendored commit: a checkout (INTERA11Y_DIR, else ../InterA11y beside
// this repository), else GitHub. The file must hash as recorded in
// intera11y-upstream.mjs, and it is evaluated with nothing but a module object.
const blankRule = (r) => r.from === 'gena11y' && !r.text;

async function upstreamRubricSource(sc) {
  const ok = (src) => rubricMatches(sc, src);
  const dir = process.env.INTERA11Y_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'InterA11y');
  const local = await readFile(rubricFile(dir, sc), 'utf8').catch(() => null);
  if (ok(local)) return local;
  const res = await fetch(rubricUrl(sc), { signal: AbortSignal.timeout(15_000) });
  const remote = res.ok ? await res.text() : null;
  if (ok(remote)) return remote;
  throw new Error(res.ok ? 'the file from GitHub does not match the vendored commit' : `GitHub answered ${res.status}`);
}

/** Fill a rubric's blank GenA11y rules from InterA11y; a note when they could not be read (they are then left out). */
async function fillGenA11yRules(r) {
  const blank = r.rules.filter(blankRule);
  if (!blank.length) return null;
  try {
    const mod = { exports: {} };
    vm.runInNewContext(await upstreamRubricSource(r.sc), { module: mod, exports: mod.exports }, { timeout: 1000 });
    const up = mod.exports;
    r.rules.forEach((rule, i) => {
      if (!blankRule(rule)) return;
      const o = up.rules && up.rules[i];
      if (!o || o.from !== 'gena11y' || JSON.stringify(o.tools) !== JSON.stringify(rule.tools)) throw new Error(`rule ${i + 1} does not match InterA11y's`);
      rule.text = o.text; if (o.rubric) rule.rubric = o.rubric;
    });
    return null;
  } catch (e) {
    return `(${blank.length} of these rules, adapted from GenA11y, could not be read from InterA11y: ${String(e.message || e).slice(0, 160)}. They are left out.)`;
  }
}

/** Run one of the InterA11y tools, adapter_elements, keyboard_audit or wcag_rubric. */
export async function runInterA11yTool(verifier, name, args = {}) {
  const ia = interA11y();
  if (name === 'wcag_rubric') {
    if (!RUBRIC_SCS.includes(String(args.sc))) return fail(`sc must be one of ${RUBRIC_SCS.join(', ')}.`);
    const r = ia.rubric.load(String(args.sc));
    const missing = await fillGenA11yRules(r);
    const all = r.rules;
    let rendered;
    try { r.rules = all.filter((x) => !blankRule(x)); rendered = ia.rubric.render(String(args.sc), 'v2', { tools: true }); } finally { r.rules = all; }
    return { content: [{ type: 'text', text: [
      rendered,
      ...(missing ? [missing] : []),
      '',
      '# How to judge (InterA11y\'s evidence standard)',
      'Your candidates are what adapter_elements lists for your adapter on the page; a failure elsewhere is the page\'s and is not yours to report. Gather the evidence with the tools each rule names, then give each candidate one verdict with the observation it rests on. InterA11y\'s judge instructions follow; where they ask for a JSON answer, put the same verdicts and evidence in your report instead.',
      '',
      ia.prompt.SYSTEM,
    ].join('\n') }] };
  }
  if (!args.file || !args.page) return fail('file and page are required.');

  if (name === 'keyboard_audit') {
    const r = await keyboardAudit(verifier, args);
    if (r.error) return fail(`keyboard_audit: ${r.error}`);
    return reply(r, 'What is new with your adapter on (inScope says whether it involves what your adapter created, changed or styled). The page\'s own problems, there before, are left out.');
  }

  let session;
  try { session = await verifier.inspector(spec(args)); } catch (e) { return fail(`Could not open the page: ${e.message.slice(0, 300)}`); }
  try {
    if (session.status?.status !== 'applied') return fail(`The adapter did not apply on this page: ${session.status?.status}${session.status?.message ? ` (${session.status.message})` : ''}.`);
    if (name === 'adapter_elements') return reply(await session.scope());
    const key = TARGET[name];
    if (key && args[key]) {
      const where = await session.scope(args[key]);
      if (!where.inScope) return fail(`${key} ${args[key]}: ${where.why}. InterA11y's tools here are for what your adapter created, changed or styled (adapter_elements); a problem elsewhere is the page's.`);
    }
    if (name === 'resolve_part_color' && Number.isFinite(args.x) && Number.isFinite(args.y)) {
      const xp = await session.page.evaluate((x, y) => { const el = document.elementFromPoint(x, y); if (!el) return null; const p = (e) => !e || e.nodeType !== 1 ? '' : e === document.body ? '/html/body' : e === document.documentElement ? '/html' : p(e.parentElement) + '/' + e.tagName.toLowerCase() + '[' + (1 + [...e.parentElement.children].filter((s) => s.tagName === e.tagName).indexOf(e)) + ']'; return p(el); }, args.x, args.y);
      const where = xp ? await session.scope(xp) : { inScope: false, why: 'nothing at that point' };
      if (!where.inScope) return fail(`The element at ${args.x},${args.y} (${xp}): ${where.why}.`);
    }
    const fnName = Object.entries({ query_ax_node: 'queryAxNode', observe_state_after_activation: 'observeStateAfterActivation', interact_and_observe: 'interactAndObserve',
      set_state_and_capture: 'setStateAndCapture', probe_screen_reader_after_action: 'probeScreenReaderAfterAction', measure_geometry_live: 'measureGeometryLive',
      request_hi_res_crop: 'requestHiResCrop', resolve_destination: 'resolveDestination', compare_named_regions: 'compareNamedRegions', render_with_overrides: 'renderWithOverrides',
      compute_contrast_ratio: 'computeContrastRatio', resolve_part_color: 'resolvePartColor', capture_full_page: 'captureFullPage' }).find(([k]) => k === name)?.[1];
    const toolArgs = Object.fromEntries(Object.entries(args).filter(([k]) => !(k in COMMON) && k !== 'stateId'));
    const r = await withTimeout(ia.tools[fnName](session.page, toolArgs, { freshClone: () => session.freshClone(args.viewport) }), 180_000, name);
    return reply(r, DRIVES.has(name) ? 'Judge only the effects on what your adapter created, changed or styled (adapter_elements).' : '');
  } catch (e) {
    return fail(`${name}: ${String(e.message || e).slice(0, 400)}`);
  } finally {
    await session.close();
  }
}

// The page's tab stops, one per element. InterA11y's walk ends at the first
// element focused twice, so a native control that takes several presses
// (a <video controls>) ends it; here a run of presses on one element is one
// stop, and the walk ends when an earlier element comes back.
async function tabStopsOf(p, cap) {
  const order = []; const seen = new Set(); let last = null; let same = 0; let empty = 0; let wrapped = false;
  for (let i = 0; i < cap * 2 && order.length < cap; i++) {
    await p.keyboard.press('Tab');
    const a = await p.evaluate(() => globalThis.__verifyActive()).catch(() => null);
    if (!a) { if (order.length && ++empty >= 2) { wrapped = true; break; } continue; }
    empty = 0;
    if (a.xpath === last) { if (++same > 12) break; continue; }
    same = 0; last = a.xpath;
    if (seen.has(a.xpath)) { wrapped = true; break; }
    seen.add(a.xpath); order.push({ index: order.length, ...a });
  }
  return { order, count: order.length, wrapped };
}

/**
 * InterA11y counts focus as refused when it lands on the body after focus().
 * So does a control the page hides at that moment (a slide that moves on), and
 * on a page that changes by itself that is chance, on either side of the
 * comparison. Keep a refusal only when focusing it again, three times, refuses
 * every time it stayed shown throughout (and it stayed shown at least once).
 */
export async function confirmRefusals(p, r) {
  if (!r || !Array.isArray(r.rejections) || !r.rejections.length) return r;
  const keep = await p.evaluate(async (xps) => {
    const wait = (ms) => new Promise((res) => setTimeout(res, ms));
    const out = [];
    for (const xp of xps) {
      const el = document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
      const shown = () => el.isConnected && el.checkVisibility({ visibilityProperty: true });
      let tried = 0, refused = 0;
      for (let k = 0; el && k < 3; k++) {
        document.body.tabIndex = -1; document.body.focus();
        if (!shown()) { await wait(150); continue; }
        el.focus();
        let stayed = true;
        for (let t = 0; t < 6; t++) { await wait(25); if (!shown()) stayed = false; }
        if (!stayed) continue;
        tried++;
        if (document.activeElement !== el && !el.contains(document.activeElement)) refused++;
      }
      out.push(tried > 0 && refused === tried);
    }
    return out;
  }, r.rejections.map((x) => x.xpath)).catch(() => null);
  return keep ? { ...r, rejections: r.rejections.filter((_, i) => keep[i]) } : r;
}

/** The keyboard measurements without and with the adapter: what is new with it on ({ error } when it could not run). */
export async function keyboardAudit(verifier, args) {
  const { kbd } = interA11y();
  const cap = Math.max(20, Math.min(2000, Number(args.maxTabs) || 300));
  const measure = async (adapter) => {
    const s = await verifier.inspector({ ...spec(args), adapter });
    try {
      if (adapter && s.status?.status !== 'applied') { await s.close(); return { error: `the adapter did not apply (${s.status?.status}${s.status?.message ? `: ${s.status.message}` : ''})` }; }
      // Each measurement on its own clone; every XPath it reports is also
      // given as the page's own (stable), so the two pages compare.
      const run = async (what, fn) => {
        const p = await s.freshClone(args.viewport);
        try {
          const r = await withTimeout(fn(p), 120_000, what);
          const found = [];
          const walk = (v) => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') { if (typeof v.xpath === 'string') found.push(v); Object.values(v).forEach(walk); } };
          walk(r);
          const stable = found.length ? await p.evaluate((xs) => globalThis.__verifyStable(xs), found.map((x) => x.xpath)) : [];
          found.forEach((x, i) => { x.stable = stable[i]; });
          return r;
        } catch (e) { return { error: String(e.message || e).slice(0, 200) }; } finally { await p.close().catch(() => {}); }
      };
      const tab = await run('tab order', (p) => kbd.collectTabOrder(p, { safetyCap: cap }));
      const stopsWalk = await run('tab stops', (p) => tabStopsOf(p, cap));
      const out = {
        tab,
        stopsWalk,
        orderFindings: tab.error ? [] : kbd.tabOrderFindings(tab).findings || [],
        traps: await run('keyboard traps', (p) => kbd.detectKeyboardTraps(p)),
        retention: await run('focus kept', (p) => kbd.detectFocusRetentionTraps(p)),
        rejection: await run('focus refused', async (p) => confirmRefusals(p, await kbd.detectFocusRejection(p))),
        ariaHidden: await run('focus in aria-hidden', (p) => kbd.detectFocusRestsInAriaHidden(p)),
      };
      if (adapter) out.scopeOf = async (xp) => (xp ? s.scope(xp) : { inScope: false });
      out.session = s;
      return out;
    } catch (e) { await s.close(); return { error: String(e.message || e).slice(0, 300) }; }
  };
  let before, after;
  try {
    before = await measure(false);
    after = await measure(true);
    if (before.error || after.error) return { error: before.error || after.error };
    const keyOf = (x) => x && (x.stable || x.xpath || JSON.stringify(x).slice(0, 200)) + '|' + (x.kind || x.sc || '');
    const listOf = (r, k) => (r && Array.isArray(r[k]) ? r[k] : []);
    const fresh = (a, b) => { const seen = new Set(b.map(keyOf)); return a.filter((x) => !seen.has(keyOf(x))); };
    const mark = async (items) => Promise.all(items.slice(0, 30).map(async (x) => { const { stable, ...rest } = x; return { ...rest, ...(await after.scopeOf(x.xpath)) }; }));
    const walkOf = (r) => (r.stopsWalk && !r.stopsWalk.error ? r.stopsWalk : { order: [], count: 0 });
    const stops = (r) => walkOf(r).order.map((o) => o.stable || o.xpath);
    const beforeStops = new Set(stops(before));
    const newStops = walkOf(after).order.filter((o) => !beforeStops.has(o.stable || o.xpath));
    const afterStops = new Set(stops(after));
    const goneStops = walkOf(before).order.filter((o) => !afterStops.has(o.stable || o.xpath));
    // Where InterA11y's own walk stopped short of ours (its order findings
    // then cover only the stops before that).
    const cut = (r) => (r.tab.count < walkOf(r).count ? `InterA11y's Tab walk stopped after ${r.tab.count} of ${walkOf(r).count} stops (an element that takes several presses, such as a video's controls)` : null);
    const result = {
      tabStops: { before: walkOf(before).count, after: walkOf(after).count,
        ...(cut(before) || cut(after) ? { interA11yWalk: { before: cut(before), after: cut(after) } } : {}),
        newWithAdapter: await mark(newStops.map((o) => ({ index: o.index, xpath: o.xpath, tag: o.tag, role: o.role, label: o.label }))),
        goneWithAdapter: goneStops.slice(0, 30).map((o) => ({ index: o.index, xpath: o.stable || o.xpath, tag: o.tag, label: o.label })),
        orderChanged: JSON.stringify(stops(before)) !== JSON.stringify(stops(after).filter((x) => !String(x).startsWith('toolkit:'))) },
      newOrderFindings: await mark(fresh(after.orderFindings, before.orderFindings)),
      newKeyboardTraps: await mark(fresh(listOf(after.traps, 'traps'), listOf(before.traps, 'traps'))),
      newFocusKept: await mark(fresh(listOf(after.retention, 'traps'), listOf(before.retention, 'traps'))),
      newFocusRefused: await mark(fresh(listOf(after.rejection, 'rejections'), listOf(before.rejection, 'rejections'))),
      newFocusInAriaHidden: await mark(fresh(listOf(after.ariaHidden, 'traps'), listOf(before.ariaHidden, 'traps'))),
      undetermined: ['traps', 'retention', 'rejection', 'ariaHidden'].filter((k) => after[k]?.undetermined || after[k]?.error).map((k) => `${k}: ${after[k].error || 'undetermined'}`),
    };
    return result;
  } finally {
    await before?.session?.close();
    await after?.session?.close();
  }
}
