// JS evaluation + iframe targeting + selector-based file upload + selector-
// based KeyboardEvent dispatch. The selector-based actions predate the
// indexed actions and are still useful for skill scripts that already
// know their CSS selectors.

import { BH_DEBUGGER_VERSION, BH_KC } from './constants.js';
import { BH_ATTACHED } from './state.js';
import { _bhSendCmd } from './cdp.js';
import { bhAttach, bhCdp } from './lifecycle.js';

// Match python's helpers._decode_unserializable_js_value: NaN/Infinity/
// BigInt come over the wire as strings on `unserializableValue` because
// JSON can't represent them. Round-trip them to native JS values so
// callers don't get `undefined` for `js("NaN")` or `js("0n")`.
function _bhDecodeUnserializable(v) {
  if (v === 'NaN') return NaN;
  if (v === 'Infinity') return Infinity;
  if (v === '-Infinity') return -Infinity;
  if (v === '-0') return -0;
  if (typeof v === 'string' && /^-?\d+n$/.test(v)) {
    try { return BigInt(v.slice(0, -1)); } catch { return v; }
  }
  return v;
}

export async function bhJs(tabId, expression, { iframeTargetId = null } = {}) {
  let send;
  if (iframeTargetId) {
    if (!BH_ATTACHED.has(iframeTargetId)) {
      await chrome.debugger.attach({ targetId: iframeTargetId }, BH_DEBUGGER_VERSION);
      BH_ATTACHED.add(iframeTargetId);
    }
    const target = { targetId: iframeTargetId };
    send = (method, params) => _bhSendCmd(target, method, params);
  } else {
    await bhAttach(tabId);
    send = (method, params) => bhCdp(tabId, method, params);
  }
  let exp = expression;
  if (/\breturn\b/.test(exp) && !exp.trim().startsWith('(')) {
    exp = `(function(){${exp}})()`;
  }
  const r = await send('Runtime.evaluate', {
    expression: exp,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r && r.exceptionDetails) {
    const msg = r.exceptionDetails.exception?.description
      || r.exceptionDetails.text
      || 'js evaluation failed';
    throw new Error(msg);
  }
  if (r && r.result) {
    if ('value' in r.result) return r.result.value;
    if ('unserializableValue' in r.result) return _bhDecodeUnserializable(r.result.unserializableValue);
  }
  return undefined;
}

// First iframe whose URL contains `urlSubstr`. Use the returned targetId
// with bhJs(tabId, expr, {iframeTargetId}) to evaluate inside the frame.
// Coordinate clicks already pass through iframes at the compositor level
// (Input.dispatchMouseEvent), so iframe targeting is mainly for DOM reads.
export async function bhIframeTarget(tabId, urlSubstr) {
  await bhAttach(tabId);
  const r = await bhCdp(tabId, 'Target.getTargets');
  for (const t of (r.targetInfos || [])) {
    if (t.type === 'iframe' && (t.url || '').includes(urlSubstr)) {
      return t.targetId;
    }
  }
  return null;
}

export async function bhDispatchKey(tabId, selector, key = 'Enter', event = 'keypress') {
  const kc = key in BH_KC ? BH_KC[key] : (key.length === 1 ? key.charCodeAt(0) : 0);
  const sel = JSON.stringify(selector);
  const k = JSON.stringify(key);
  const ev = JSON.stringify(event);
  await bhJs(
    tabId,
    `(()=>{const e=document.querySelector(${sel});if(e){e.focus();e.dispatchEvent(new KeyboardEvent(${ev},{key:${k},code:${k},keyCode:${kc},which:${kc},bubbles:true}));}})()`
  );
}

export async function bhUploadFile(tabId, selector, files) {
  await bhAttach(tabId);
  const doc = await bhCdp(tabId, 'DOM.getDocument', { depth: -1 });
  const { nodeId } = await bhCdp(tabId, 'DOM.querySelector', { nodeId: doc.root.nodeId, selector });
  if (!nodeId) throw new Error(`no element for ${selector}`);
  await bhCdp(tabId, 'DOM.setFileInputFiles', {
    files: Array.isArray(files) ? files : [files],
    nodeId,
  });
}

export async function bhHttpGet(url, headers = null) {
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', ...(headers || {}) } });
  return await r.text();
}
