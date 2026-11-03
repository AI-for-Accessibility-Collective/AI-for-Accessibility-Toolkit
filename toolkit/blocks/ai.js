// Blocks 11 and 12, ai.text and ai.vision: ask the toolkit's model.
//
//   const plain = await s.ai.text('simplify', para.textContent, { context: heading, keep: ['Medicare'] });
//   if (plain) s.text.replaceBlock(para, plain);
//   const alt = await s.ai.vision('describe', img, { purpose: 'alt' });
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
import { TASKS } from './ai/prompts.js';

export const AI_DEFAULTS = { budget: 40, maxInputChars: 6000 };
// Personal fields: the person's profile wins over the builder's value.
const PERSONAL = { readingLevel: 'readingLevel', language: 'language' };
const OPTION_KEYS = ['readingLevel', 'language', 'tone', 'audience', 'context', 'keep', 'glossary', 'instructions', 'template', 'maxSentences', 'maxChars', 'purpose', 'minRatio', 'maxRatio'];
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

  return {
    text, vision,
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
