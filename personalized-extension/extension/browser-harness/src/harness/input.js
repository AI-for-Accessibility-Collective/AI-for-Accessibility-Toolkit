// Coordinate-driven input: click, type, press-key, scroll, plus the
// selector-based fillInput. Index-driven actions live under actions/.

import { BH_KEYS } from './constants.js';
import { bhAttach, bhCdp } from './lifecycle.js';
import { _bhSnapToInteractive, _bhJsClickFallback } from './interactive.js';
import { bhJs } from './runtime.js';
import { bhWait, bhWaitForElement } from './wait.js';

// Click pipeline mirrors browser_use/browser/watchdogs/default_action_watchdog.py:
//   snap -> mouseMoved -> 50ms -> mousePressed -> 50ms -> mouseReleased
// with per-event timeouts so a hung mousePressed (e.g. dialog intercept)
// doesn't kill the whole click. Returns the actual point clicked so the
// caller can place the cursor visualization at the snapped location.
export async function bhClickAt(tabId, x, y, opts = {}) {
  const button = opts.button || 'left';
  const clicks = opts.clicks || 1;
  const wantSnap = opts.snap !== false;
  await bhAttach(tabId);

  const snap = wantSnap
    ? await _bhSnapToInteractive(tabId, x, y)
    : { x, y, snapped: false };
  const cx = snap.x;
  const cy = snap.y;

  // Occluded path: a banner / modal scrim / fixed overlay is on top of the
  // snap target at (cx, cy). CDP coordinate-clicking would hit the overlay,
  // not the target. Skip the mouse-event sequence and synthesise the click
  // via target.click() (bypasses paint/hit-testing). Mirrors browser_use's
  // _check_element_occlusion + JS-click fallback path.
  if (snap.snapped && snap.occluded && opts.fallback !== false) {
    snap.fallback = await _bhJsClickFallback(tabId, cx, cy);
    return snap;
  }

  // mouseMoved fires hover handlers that some sites attach click listeners
  // *behind* (custom dropdowns, tooltips, hover-lazy components). Without
  // it, a press-release pair lands on a button whose click handler hasn't
  // been bound yet.
  let pressFailed = false;
  let releaseFailed = false;
  try {
    await bhCdp(tabId, 'Input.dispatchMouseEvent',
      { type: 'mouseMoved', x: cx, y: cy },
      { timeoutMs: 3000 });
  } catch (e) {
    // Page may be mid-navigation; let the press attempt anyway.
  }
  await bhWait(50);

  try {
    await bhCdp(tabId, 'Input.dispatchMouseEvent',
      { type: 'mousePressed', x: cx, y: cy, button, clickCount: clicks },
      { timeoutMs: 3000 });
    await bhWait(50);
  } catch (e) {
    pressFailed = true;
  }

  try {
    await bhCdp(tabId, 'Input.dispatchMouseEvent',
      { type: 'mouseReleased', x: cx, y: cy, button, clickCount: clicks },
      { timeoutMs: 5000 });
  } catch (e) {
    releaseFailed = true;
  }

  // JS-click fallback. Mirrors browser_use's `this.click()` retry when CDP
  // coordinate dispatch fails (page hit-test region issues or protocol-
  // level errors). Only fires when both press and release threw, since a
  // single-leg failure usually still propagates a click event;
  // double-failure means the renderer didn't see anything.
  if (pressFailed && releaseFailed && snap.snapped && opts.fallback !== false) {
    snap.fallback = await _bhJsClickFallback(tabId, cx, cy);
  }

  return snap;
}

export async function bhTypeText(tabId, text) {
  await bhAttach(tabId);
  await bhCdp(tabId, 'Input.insertText', { text });
}

export async function bhPressKey(tabId, key, modifiers = 0) {
  await bhAttach(tabId);
  const entry = BH_KEYS[key] || [
    key.length === 1 ? key.charCodeAt(0) : 0,
    key,
    key.length === 1 ? key : '',
  ];
  const [vk, code, text] = entry;
  const base = { key, code, modifiers, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk };
  // keyDown without `text` -- when `text` is set, CDP auto-fires keypress
  // + input (which inserts the character) inline, and then the explicit
  // `char` event below fires keypress + input *again*, so every printable
  // key gets typed twice. The right shape: keyDown emits only keydown,
  // char emits keypress + input (single insertion), keyUp emits keyup.
  // Mirrors browser_use _input_text_element_node_impl.
  await bhCdp(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', ...base });
  if (text && text.length === 1) {
    await bhCdp(tabId, 'Input.dispatchKeyEvent', { type: 'char', text, ...base });
  }
  await bhCdp(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', ...base });
}

export async function bhScroll(tabId, x, y, dy = -300, dx = 0) {
  await bhAttach(tabId);
  await bhCdp(tabId, 'Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: dx, deltaY: dy });
}

// Fill a framework-managed input (React/Vue/Ember). bhTypeText uses
// Input.insertText which bypasses framework event listeners, so submit
// buttons stay disabled. This focuses + clears via real Cmd/Ctrl+A and
// Backspace, types via key events, then fires synthetic input+change
// so the framework's controlled-input state actually updates.
//
// Note the rawKeyDown trick: a normal keyDown for 'a' with the modifier
// still emits a `char` event, which Chrome treats as printable input
// (typing literally "a") instead of the select-all shortcut. rawKeyDown
// suppresses the char emission so the modifier+key combo registers.
export async function bhFillInput(tabId, selector, text, { clearFirst = true, timeoutMs = 0 } = {}) {
  if (timeoutMs > 0) {
    if (!(await bhWaitForElement(tabId, selector, { timeoutMs }))) {
      throw new Error(`fill_input: element not found: ${selector}`);
    }
  }
  await bhAttach(tabId);
  const sel = JSON.stringify(selector);
  const focused = await bhJs(
    tabId,
    `(()=>{const e=document.querySelector(${sel});if(!e)return false;e.focus();return true})()`
  );
  if (!focused) throw new Error(`fill_input: element not found: ${selector}`);

  if (clearFirst) {
    const isMac = /Mac|iPhone|iPad|iPod/.test((navigator && navigator.userAgent) || '');
    const mods = isMac ? 4 : 2; // 4=Meta(Cmd), 2=Ctrl
    const selectAll = {
      key: 'a', code: 'KeyA', modifiers: mods,
      windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65,
    };
    await bhCdp(tabId, 'Input.dispatchKeyEvent', { type: 'rawKeyDown', ...selectAll });
    await bhCdp(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', ...selectAll });
    await bhPressKey(tabId, 'Backspace');
  }
  for (const ch of text) {
    await bhPressKey(tabId, ch);
  }
  await bhJs(
    tabId,
    `(()=>{const e=document.querySelector(${sel});if(!e)return;`
    + `e.dispatchEvent(new Event('input',{bubbles:true}));`
    + `e.dispatchEvent(new Event('change',{bubbles:true}))})()`
  );
}
