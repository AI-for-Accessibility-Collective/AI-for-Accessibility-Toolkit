'use strict';

async function awaitSettle(page, opts = {}) {
  if (process.env.V3_SETTLE_WAIT === '0' && !opts.force) return;
  if (!page || typeof page.evaluate !== 'function') return;
  const maxFrames = Number(opts.maxFrames) || 60;
  const fontsTimeoutMs = Number(opts.fontsTimeoutMs) || 1000;

  const floorMs = opts.floorMs != null ? Number(opts.floorMs) : (Number(process.env.V3_SETTLE_MS) || 0);
  try {

    const settleWork = page.evaluate(async (maxFrames, fontsTimeoutMs) => {
      try { await Promise.race([document.fonts && document.fonts.ready, new Promise((r) => setTimeout(r, fontsTimeoutMs))]); } catch (e) {}
      const de = document.documentElement;

      const sig = () => { const b = document.body; if (!b) return '0'; const r = b.getBoundingClientRect(); return r.width + 'x' + r.height + ':' + b.scrollHeight + ':' + de.scrollWidth + 'x' + de.scrollHeight + ':' + (window.scrollX | 0) + ',' + (window.scrollY | 0); };

      let prev = sig(), stable = 0;
      for (let i = 0; i < maxFrames; i++) { await new Promise((r) => requestAnimationFrame(r)); const s = sig(); if (s === prev) { if (++stable >= 2) return; } else stable = 0; prev = s; }
    }, maxFrames, fontsTimeoutMs).catch(() => {});
    const hardCapMs = Number.isFinite(opts.hardCapMs) ? opts.hardCapMs : 5000;
    await Promise.race([settleWork, new Promise((r) => setTimeout(r, hardCapMs))]);
    if (floorMs > 0) await new Promise((r) => setTimeout(r, floorMs));
  } catch (e) {                                    }
}

async function awaitFocusSettle(page, opts = {}) {
  if (!page || typeof page.evaluate !== 'function') return;
  const maxFrames = Number(opts.maxFrames) || 16;
  const floorMs = opts.floorMs != null ? Number(opts.floorMs) : (Number(process.env.V3_SETTLE_KBD_MS) || 0);
  try {
    await page.evaluate(async (maxFrames) => {

      const active = () => { let a = document.activeElement; while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement; return a; };

      const geom = () => { const b = document.body; const r = b ? b.getBoundingClientRect() : { width: 0, height: 0 }; return (r.width | 0) + 'x' + (r.height | 0) + ':' + (b ? b.scrollHeight : 0) + 'x' + document.documentElement.scrollWidth; };
      let pa = active(), pg = geom();

      await new Promise((r) => requestAnimationFrame(r));
      let a = active(), g = geom();
      if (a === pa && g === pg) return;

      let stable = 0; pa = a; pg = g;
      for (let i = 1; i < maxFrames; i++) {
        await new Promise((r) => requestAnimationFrame(r));
        a = active(); g = geom();
        if (a === pa && g === pg) { if (++stable >= 2) return; } else stable = 0;
        pa = a; pg = g;
      }
    }, maxFrames).catch(() => {});
    if (floorMs > 0) await new Promise((r) => setTimeout(r, floorMs));
  } catch (e) {                                       }
}

async function robustScreenshot(page, opts = {}, tries = 3) {
  if (!page || typeof page.screenshot !== 'function') return null;
  for (let i = 0; i < tries; i++) {
    const s = await page.screenshot(opts).catch(() => null);
    if (s) return s;
    if (i < tries - 1) await new Promise((r) => setTimeout(r, 80));
  }
  return null;
}

module.exports = { awaitSettle, awaitFocusSettle, robustScreenshot };
