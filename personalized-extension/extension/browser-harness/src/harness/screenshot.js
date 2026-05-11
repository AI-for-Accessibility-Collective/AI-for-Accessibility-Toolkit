// Page.captureScreenshot returns the viewport in DEVICE pixels -- on a 2x
// display a 1920x1080 CSS viewport produces a 3840x2160 PNG. That's
// hostile to coordinate-driven agents: Input.dispatchMouseEvent expects
// CSS pixels, but a vision LLM looking at a 3840-wide image will report
// pixel positions in image space, not CSS space.
//
// `cssNormalize: true` re-renders the screenshot at the page's CSS-pixel
// dimensions, so 1 image pixel = 1 CSS pixel and the model's coordinates
// are directly clickable. `maxDim` further caps the longer side and
// returns a `scale` factor (image-pixels-per-CSS-pixel) the caller can
// divide model coordinates by to recover CSS pixels.
//
// Backwards-compatible: with no options the function returns the raw
// base64 string as before. With either option set, returns
// `{data, width, height, cssWidth, cssHeight, dpr, scale}`.

import { bhAttach, bhCdp } from './lifecycle.js';

export async function bhCaptureScreenshot(tabId, { full = false, maxDim = null, cssNormalize = false, timeoutMs = null, attempts = null } = {}) {
  await bhAttach(tabId);
  // Viewport captures should fail fast and retry: a 60s hang on a slow paint
  // wedges the agent loop, but a hung paint usually clears within a second
  // if you re-issue the command. Full-page captures legitimately take longer
  // on large docs and can't be retried as cheaply.
  const tm = (timeoutMs != null) ? timeoutMs : (full ? 120000 : 5000);
  const tries = (attempts != null) ? attempts : (full ? 1 : 3);
  let r, lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      r = await bhCdp(tabId, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: full }, { timeoutMs: tm });
      break;
    } catch (e) {
      lastErr = e;
      if (i + 1 >= tries) throw e;
      // Tiny backoff: enough for an in-flight paint to settle, short enough
      // that 3 attempts stay well under the original 60s budget.
      await new Promise((res) => setTimeout(res, 250));
    }
  }
  const original = r.data; // base64 PNG, no data: prefix

  if (!maxDim && !cssNormalize) return original;
  if (typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') {
    return { data: original, width: 0, height: 0, cssWidth: 0, cssHeight: 0, dpr: 1, scale: 1 };
  }

  // Read the viewport metrics so we know what "CSS-pixel size" means.
  // Falls back to no-normalisation if the read fails (mid-navigation, etc).
  let cssWidth = 0, cssHeight = 0, dpr = 1;
  try {
    const info = await bhCdp(tabId, 'Runtime.evaluate', {
      expression: 'JSON.stringify({w:innerWidth,h:innerHeight,dpr:devicePixelRatio||1})',
      returnByValue: true,
    });
    const m = JSON.parse(info && info.result && info.result.value || '{}');
    cssWidth = m.w || 0; cssHeight = m.h || 0; dpr = m.dpr || 1;
  } catch {}

  let bmp;
  try {
    const blob = await (await fetch(`data:image/png;base64,${original}`)).blob();
    bmp = await createImageBitmap(blob);
  } catch (e) {
    console.warn('[BrowserHarness] screenshot decode failed:', e.message);
    return { data: original, width: 0, height: 0, cssWidth, cssHeight, dpr, scale: 1 };
  }

  // Decide target dimensions.
  let targetW = bmp.width;
  let targetH = bmp.height;
  if (cssNormalize && cssWidth && cssHeight) {
    targetW = cssWidth;
    targetH = cssHeight;
  }
  if (maxDim && Math.max(targetW, targetH) > maxDim) {
    const k = maxDim / Math.max(targetW, targetH);
    targetW = Math.max(1, Math.round(targetW * k));
    targetH = Math.max(1, Math.round(targetH * k));
  }

  let data = original;
  if (targetW !== bmp.width || targetH !== bmp.height) {
    try {
      const canvas = new OffscreenCanvas(targetW, targetH);
      canvas.getContext('2d').drawImage(bmp, 0, 0, targetW, targetH);
      const out = await canvas.convertToBlob({ type: 'image/png' });
      const buf = new Uint8Array(await out.arrayBuffer());
      let bin = '';
      for (let i = 0; i < buf.byteLength; i++) bin += String.fromCharCode(buf[i]);
      data = btoa(bin);
    } catch (e) {
      console.warn('[BrowserHarness] screenshot resize failed:', e.message);
    }
  }

  // image-pixels-per-CSS-pixel. 1.0 means model coordinates are CSS
  // pixels directly; <1.0 means caller must divide model coords by scale.
  const scale = (cssWidth > 0) ? (targetW / cssWidth) : 1;

  return { data, width: targetW, height: targetH, cssWidth, cssHeight, dpr, scale };
}
