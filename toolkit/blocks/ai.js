// Blocks 11 and 12, ai.text and ai.vision: ask the toolkit's model.
//
//   const plain = await s.ai.text('simplify', para.textContent, { context: heading, keep: ['Medicare'] });
//   if (plain) s.text.replaceBlock(para, plain);
//   const alt = await s.ai.vision('describe', img, { purpose: 'alt' });
//   const main = await s.ai.choose('Which of these is the page's main content?', [boxA, boxB]);
//   if (main) s.setAttr(main, 'role', 'main');
//
// choose is for where an adapter's rules run out: the page does not say,
// and only what its parts contain could tell. The model picks one of the
// options the adapter found (an element, outlined for it, or { value, about
// }), or says the page does not make it clear: then null, and the adapter
// does less. It never writes anything into the page.
//
// The prompt is the toolkit's own for the task (./ai/prompts.js), adapted by
// the builder's fields. The host runs the model and gates the answer: in
// the browser runtime, the toolkit service does both with its own key, so the
// page never holds one. An answer is a string, or null when there is none:
// no model, a refusal, a guess, an answer of the wrong length, the budget
// spent, or the session ended while it was on its way. null means "leave the
// page as it is".
//
// Answers are cached for the page and shared between calls in flight, and
// each session has a budget of calls.

import { resolveConfig } from './shared.js';
import { TASKS, PROMPT_FIELDS } from './ai/prompts.js';

export const AI_DEFAULTS = { budget: 40, maxInputChars: 6000 };
// Personal fields: the person's profile wins over the builder's value.
const PERSONAL = { readingLevel: 'readingLevel', translateTo: 'translateTo' };
const OPTION_KEYS = ['readingLevel', 'translateTo', 'language', 'tone', 'audience', 'context', 'keep', 'glossary', 'instructions', 'template', 'maxSentences', 'maxChars', 'purpose', 'minRatio', 'maxRatio', 'question', 'choices'];
const MAX_CHOICES = 12;
const CACHE_MAX = 300;

export function aiBlock(s, env) {
  let used = 0;
  const transport = env.transport || {};

  function cached(key, make) {
    const cache = env.shared.cache;
    let p = cache.get(key);
    if (p) return { p, fresh: false };
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    p = make();
    cache.set(key, p);
    // A failed or empty answer is not kept: the next call may succeed.
    p.then((v) => { if (v === null) cache.delete(key); });
    return { p, fresh: true };
  }

  function options(opts) {
    const c = resolveConfig(AI_DEFAULTS, opts, env.personal, PERSONAL);
    const o = {};
    for (const k of OPTION_KEYS) if (c[k] !== undefined && c[k] !== null && c[k] !== '') o[k] = c[k];
    // Terms to keep, and a glossary, are hints, often gathered from the
    // page: past the service's limits they are cut to fit, not refused
    // (a refused request is no answer, and still a call).
    if (Array.isArray(o.keep)) {
      const f = PROMPT_FIELDS.keep;
      o.keep = [...new Set(o.keep.filter((x) => typeof x === 'string' && x.trim() && x.length <= f.items.maxLength).map((x) => x.trim()))].slice(0, f.maxItems);
      if (!o.keep.length) delete o.keep;
    }
    if (o.glossary && typeof o.glossary === 'object' && !Array.isArray(o.glossary)) {
      const f = PROMPT_FIELDS.glossary;
      o.glossary = Object.fromEntries(Object.entries(o.glossary).filter(([, v]) => typeof v === 'string' && v.length <= 200).slice(0, f.maxProperties));
    }
    return { c, o };
  }

  async function ask(kind, task, input, opts, extra) {
    if (!s.alive()) return null;
    if (!TASKS[task] || TASKS[task].kind !== kind) throw new Error(`ai.${kind} has no task "${task}". Tasks: ${Object.entries(TASKS).filter(([, t]) => t.kind === kind).map(([k]) => k).join(', ')}.`);
    if (typeof transport.ai !== 'function') return null;
    const { c, o } = options(opts);
    const key = `${kind}\u0000${task}\u0000${JSON.stringify(o)}\u0000${input}\u0000${extra.cacheKey || ''}`;
    const hit = env.shared.cache.has(key);
    if (!hit && used >= c.budget) return null;
    const { p, fresh } = cached(key, () => Promise.resolve()
      .then(() => transport.ai({ kind, task, input, options: o, ...extra.request }))
      .then((r) => (r && typeof r.text === 'string' && r.text.trim() ? r.text.trim() : null), () => null));
    if (fresh) used++;
    const out = await p;
    return s.alive() ? out : null;
  }

  async function text(task, input, opts = {}) {
    const t = String(input ?? '').trim();
    const max = Number(opts.maxInputChars) || AI_DEFAULTS.maxInputChars;
    // Too long is no answer, not a cut: a cut passage would come back
    // simplified with its end missing. Send one block at a time.
    if (!t || t.length > max) return null;
    return ask('text', task, t, opts, {});
  }

  async function vision(task, el, opts = {}) {
    if (!s.alive() || !el) return null;
    let image = null, rect = null;
    try { image = typeof env.capture === 'function' ? await env.capture(el) : null; } catch { image = null; }
    if (!image) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return null;
      rect = { x: r.left, y: r.top, width: r.width, height: r.height, viewportWidth: env.win.innerWidth, viewportHeight: env.win.innerHeight };
    }
    const note = String(opts.about || '').slice(0, 500);
    const id = image ? `${image.data.length}:${image.data.slice(0, 64)}:${image.data.slice(-64)}` : JSON.stringify(rect);
    return ask('vision', task, note, opts, { cacheKey: id, request: image ? { image } : { rect } });
  }

  /** One of the options, the one the model says answers the question from
   *  what the page shows of each; null when it cannot tell (or no model).
   *  An option is an element (outlined for the model) or { value, about }. */
  async function choose(question, options, opts = {}) {
    if (!s.alive() || !String(question || '').trim() || !Array.isArray(options)) return null;
    const list = options.slice(0, MAX_CHOICES)
      .map((o) => (o && o.nodeType === 1 ? { value: o, about: outline(o) } : o))
      .filter((o) => o && o.value !== undefined && String(o.about || '').trim());
    if (!list.length || list.length < Math.min(options.length, MAX_CHOICES)) return null;
    const max = Number(opts.maxInputChars) || AI_DEFAULTS.maxInputChars;
    const each = Math.floor(max / list.length) - 20;
    const input = list.map((o, i) => `Option ${i + 1}:\n${String(o.about).trim().slice(0, each)}`).join('\n\n');
    const { maxInputChars, ...rest } = opts;
    const answer = await ask('text', 'choose', input, { ...rest, question: String(question).trim().slice(0, 500), choices: list.length }, {});
    const n = Number(answer);
    return Number.isInteger(n) && n >= 1 && n <= list.length ? list[n - 1].value : null;
  }

  /** What the page shows of an element, for the model: its tag and role, how
   *  much text and how many links, and each part inside with its first words. */
  function outline(el, { maxChars = 1500 } = {}) {
    if (!el || el.nodeType !== 1) return '';
    const text = (n) => String(n.innerText ?? n.textContent ?? '').replace(/\s+/g, ' ').trim();
    const links = (n) => n.querySelectorAll('a[href]').length;
    const what = (n) => {
      const role = n.getAttribute('role');
      const names = [n.id && `id "${n.id}"`, n.getAttribute('class') && `class "${String(n.getAttribute('class')).trim().slice(0, 60)}"`].filter(Boolean);
      return `<${n.localName}>${role ? ` role ${role}` : ''}${names.length ? ` (${names.join(', ')})` : ''}`;
    };
    const all = text(el);
    const lines = [`${what(el)}: ${all.length} characters of text, ${links(el)} links. It begins: "${all.slice(0, 160)}"`];
    let shown = 0;
    for (const c of el.children) {
      if (shown >= 15) { lines.push('  …'); break; }
      const t = text(c);
      if (!t && !c.querySelector('img, svg, video, canvas, iframe')) continue;
      shown++;
      const k = links(c);
      lines.push(`  ${what(c)}${t ? `: "${t.slice(0, 100)}"` : ': no text'}${k ? `, ${k} link${k === 1 ? '' : 's'}` : ''}`);
    }
    return lines.join('\n').slice(0, maxChars);
  }

  return {
    text, vision, choose, outline,
    get used() { return used; },
    get available() { return typeof transport.ai === 'function'; },
  };
}

/** An image of an element the page can draw itself: an <img> it may read,
 *  a <canvas>, or an inline <svg>. null when it cannot (another origin's
 *  image without CORS): then the host captures the element from the screen. */
export async function captureInPage(el, win) {
  const doc = el.ownerDocument;
  const MAX = 1024;
  const toPayload = (dataUrl) => {
    const m = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(dataUrl || '');
    return m ? { mimeType: m[1], data: m[2] } : null;
  };
  const draw = (source, w, h) => {
    const scale = Math.min(1, MAX / Math.max(w, h));
    const canvas = doc.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
    return toPayload(canvas.toDataURL('image/png'));
  };
  try {
    if (el.tagName === 'CANVAS') return draw(el, el.width, el.height);
    if (el.tagName === 'IMG' && el.complete && el.naturalWidth) return draw(el, el.naturalWidth, el.naturalHeight);
    if (el.tagName && el.tagName.toLowerCase() === 'svg') {
      // Models take raster images: draw the SVG at its size on the page.
      const r = el.getBoundingClientRect();
      const xml = new win.XMLSerializer().serializeToString(el);
      const img = new win.Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = 'data:image/svg+xml;base64,' + win.btoa(unescape(encodeURIComponent(xml)));
      });
      return draw(img, r.width || img.naturalWidth || 300, r.height || img.naturalHeight || 150);
    }
  } catch { /* a tainted canvas: another origin's image */ }
  return null;
}
