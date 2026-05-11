// User-visible feedback: chrome.notifications + the live-page cursor
// breadcrumb that lets a human watching the browser see exactly where the
// agent clicked.

import { _bhAgentTruncate } from './state.js';

export function _bhAgentNotify(outcome, task, message) {
  if (!chrome.notifications || !chrome.notifications.create) return;
  const titles = {
    done: 'Browser agent finished',
    error: 'Browser agent failed',
    stopped: 'Browser agent stopped',
  };
  try {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: titles[outcome] || 'Browser agent',
      message: _bhAgentTruncate(`${task}\n\n${message || ''}`),
      priority: outcome === 'error' ? 2 : 1,
    });
  } catch (e) {
    console.warn('[BrowserAgent] notify failed:', e.message);
  }
}

// Inject an animated SVG arrow cursor + red ripple at the given CSS-pixel
// position into the *live page* (not the screenshot) so a human watching
// the browser can see exactly where the agent clicked. pointer-events
// is set to none so the marker can't intercept any subsequent input the
// agent dispatches. Fire-and-forget: any injection failure (CSP, frozen
// dialog thread) is swallowed.
export async function _bhAgentShowPageCursor(tabId, cssX, cssY) {
  const H = globalThis.BrowserHarness;
  if (!H || !H.js) return;
  const x = Number(cssX) | 0;
  const y = Number(cssY) | 0;
  const arrowSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 13 19" width="22" height="32">'
    + '<path d="M 0 0 L 0 17 L 5 13 L 8 19 L 10 18 L 7 12 L 13 12 Z" fill="white" stroke="black" stroke-width="1"/>'
    + '</svg>';
  // Self-contained injection: builds + animates + cleans up. Uses
  // dataset.bhAgent so an external observer can recognise our overlays.
  const expr = `(()=>{
    const x=${x}, y=${y};
    const cur=document.createElement('div');
    cur.dataset.bhAgent='cursor';
    cur.style.cssText='position:fixed;left:'+x+'px;top:'+y+'px;width:22px;height:32px;pointer-events:none;z-index:2147483647;transform:scale(1.4);transform-origin:0 0;transition:opacity .55s ease-out, transform .55s ease-out;opacity:0;filter:drop-shadow(0 1px 3px rgba(0,0,0,.45));';
    cur.innerHTML=${JSON.stringify(arrowSvg)};
    const rip=document.createElement('div');
    rip.dataset.bhAgent='ripple';
    rip.style.cssText='position:fixed;left:'+(x-14)+'px;top:'+(y-14)+'px;width:28px;height:28px;border-radius:50%;background:rgba(234,67,53,.55);box-shadow:0 0 0 2px rgba(234,67,53,.85);pointer-events:none;z-index:2147483646;transform:scale(.4);opacity:0;transition:transform .5s ease-out, opacity .5s ease-out;';
    document.documentElement.appendChild(rip);
    document.documentElement.appendChild(cur);
    requestAnimationFrame(()=>{
      cur.style.opacity='1'; cur.style.transform='scale(1)';
      rip.style.opacity='1'; rip.style.transform='scale(2)';
      setTimeout(()=>{
        cur.style.opacity='0'; rip.style.opacity='0';
        setTimeout(()=>{ cur.remove(); rip.remove(); }, 650);
      }, 1100);
    });
  })()`;
  try { await H.js(tabId, expr); } catch {}
}
