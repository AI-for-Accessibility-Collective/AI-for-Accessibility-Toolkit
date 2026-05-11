// History + URL navigation, plus the "what's the page right now" snapshot.

import { bhAttach, bhCdp } from './lifecycle.js';
import { bhPendingDialog } from './state.js';

export async function bhGotoUrl(tabId, url) {
  await bhAttach(tabId);
  return await bhCdp(tabId, 'Page.navigate', { url });
}

// History navigation. CDP's Page.navigateToHistoryEntry needs a history
// entry id; instead we use Runtime.evaluate('history.go(N)') which works
// regardless of whether the page can navigate back (no-op if not).
export async function bhGoBack(tabId) {
  await bhAttach(tabId);
  await bhCdp(tabId, 'Runtime.evaluate', { expression: 'history.back()' });
}

export async function bhGoForward(tabId) {
  await bhAttach(tabId);
  await bhCdp(tabId, 'Runtime.evaluate', { expression: 'history.forward()' });
}

export async function bhRefresh(tabId, opts = {}) {
  await bhAttach(tabId);
  return await bhCdp(tabId, 'Page.reload', { ignoreCache: !!opts.ignoreCache });
}

export async function bhPageInfo(tabId) {
  await bhAttach(tabId);
  // A native dialog (alert/confirm/prompt/beforeunload) freezes the JS
  // thread, so Runtime.evaluate would hang. Surface the dialog instead --
  // matches browser-harness-orig's daemon meta:pending_dialog branch.
  const dialog = bhPendingDialog(tabId);
  if (dialog) return { dialog };
  const r = await bhCdp(tabId, 'Runtime.evaluate', {
    expression: 'JSON.stringify({url:location.href,title:document.title,w:innerWidth,h:innerHeight,sx:scrollX,sy:scrollY,pw:document.documentElement.scrollWidth,ph:document.documentElement.scrollHeight})',
    returnByValue: true,
  });
  if (r && r.result && r.result.value) return JSON.parse(r.result.value);
  return { url: '', title: '', w: 0, h: 0, sx: 0, sy: 0, pw: 0, ph: 0 };
}
