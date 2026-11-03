// Block 17, zoom: the browser's own zoom for this site.
//
//   const method = s.zoom.method('zoom')   // 'zoom' or 'font': the person's choice, else yours
//   if (method === 'zoom') await s.zoom.set(1.5); else s.css(...)   // never both
//   await s.zoom.get()                      // the zoom now, or null
//
// The browser's zoom reflows the page the way the person's own zoom does
// (media queries, the narrow layout), which scaling text in CSS cannot. It is
// there only where the host offers it: in the browser runtime, through the
// extension (chrome.tabs.setZoom), which the browser keeps per site. end()
// puts back the zoom from before the adapter zoomed, unless the person
// changed it meanwhile. Without it, `supported` is false and method()
// answers 'font'.

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function zoomBlock(s, env) {
  const t = env.transport.zoom;
  let mine = false;
  const restore = () => { Promise.resolve(t({ op: 'restore' })).catch(() => {}); };

  async function set(factor) {
    const f = Number(factor);
    if (!t || !s.alive() || !Number.isFinite(f)) return false;
    const r = await Promise.resolve(t({ op: 'set', factor: clamp(f, 0.25, 5) })).catch(() => null);
    if (!r || !r.ok) return false;
    if (!s.alive()) { restore(); return false; }
    if (!mine) { mine = true; s.onEnd(restore); }
    return true;
  }

  async function get() {
    if (!t) return null;
    const r = await Promise.resolve(t({ op: 'get' })).catch(() => null);
    return r && Number.isFinite(r.factor) ? r.factor : null;
  }

  /** How to make text bigger here: the person's textSizeMethod, else the builder's, else 'zoom'; 'font' where zoom is not offered. */
  function method(builderDefault = 'zoom') {
    const p = env.personal.textSizeMethod;
    const m = p === 'zoom' || p === 'font' ? p : builderDefault === 'font' ? 'font' : 'zoom';
    return m === 'zoom' && !t ? 'font' : m;
  }

  return { supported: !!t, set, get, method };
}
