// Draw numbered highlight boxes on a base64-encoded PNG screenshot using
// the items array from bhEnumerateInteractive. Each bbox is in CSS pixels
// (viewport-relative); `scale` from bhCaptureScreenshot translates to
// image pixels (= scale when cssNormalize is on, 1.0 otherwise).
//
// Visual style intentionally simple and high-contrast: 2 px outline + a
// small numbered badge at the top-left of each box. We rotate through a
// short palette so adjacent boxes are visually distinct, but we do NOT
// vary by index meaning -- the colour is just to make overlapping boxes
// readable. Returns a new base64 PNG; original input is not mutated.
//
// Mirrors browser_use/browser/python_highlights.py in spirit but runs in
// the service-worker via OffscreenCanvas instead of PIL.

import { _BH_HIGHLIGHT_COLORS } from './constants.js';

export async function bhDrawHighlights(base64Png, items, opts = {}) {
  if (!items || !items.length) return base64Png;
  if (typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') {
    return base64Png; // SW environment without canvas; return unchanged
  }
  const scale = (opts.scale && Number.isFinite(opts.scale) && opts.scale > 0) ? opts.scale : 1;
  let bmp;
  try {
    const blob = await (await fetch(`data:image/png;base64,${base64Png}`)).blob();
    bmp = await createImageBitmap(blob);
  } catch (e) {
    console.warn('[BrowserHarness] highlight decode failed:', e.message);
    return base64Png;
  }
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bmp, 0, 0);

  // Outline + badge per item. Filter out invisible/zero-area bboxes that
  // somehow snuck through enumeration. Drawing order: smallest area on top
  // so big containers don't bury small icon buttons.
  const visible = items.filter((it) => it.bbox && it.bbox.w > 0 && it.bbox.h > 0);
  visible.sort((a, b) => (b.bbox.w * b.bbox.h) - (a.bbox.w * a.bbox.h));

  ctx.lineWidth = 2;
  ctx.font = 'bold 12px system-ui, -apple-system, sans-serif';
  ctx.textBaseline = 'top';

  for (let i = 0; i < visible.length; i++) {
    const it = visible[i];
    const color = _BH_HIGHLIGHT_COLORS[it.idx % _BH_HIGHLIGHT_COLORS.length];
    const x = it.bbox.x * scale;
    const y = it.bbox.y * scale;
    const w = it.bbox.w * scale;
    const h = it.bbox.h * scale;
    // Outline. strokeRect is centered on path, offset by lineWidth/2 so
    // we don't draw outside the bbox edge.
    ctx.strokeStyle = color;
    ctx.strokeRect(x + 1, y + 1, Math.max(0, w - 2), Math.max(0, h - 2));
    // Badge: small filled rect at top-left with the index number. Sized
    // to the digits so a 3-digit index gets more room. Anchored INSIDE
    // the bbox top-left corner; if the bbox is so small the badge
    // wouldn't fit, anchor it at the box's outside-top instead so it's
    // not occluding the entire element.
    const label = String(it.idx);
    const padding = 3;
    const metrics = ctx.measureText(label);
    const badgeW = metrics.width + padding * 2;
    const badgeH = 14;
    let bx = x;
    let by = y;
    if (h < badgeH + 4 || w < badgeW + 4) by = Math.max(0, y - badgeH);
    ctx.fillStyle = color;
    ctx.fillRect(bx, by, badgeW, badgeH);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(label, bx + padding, by + 1);
  }

  let out;
  try {
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    const buf = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.byteLength; i++) bin += String.fromCharCode(buf[i]);
    out = btoa(bin);
  } catch (e) {
    console.warn('[BrowserHarness] highlight encode failed:', e.message);
    return base64Png;
  }
  return out;
}
