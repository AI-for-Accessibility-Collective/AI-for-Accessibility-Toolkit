// Deterministic page-action primitives shared by voice-commands.js (Web
// Speech fallback) and the Live voice page_action tool (via content.js
// pageCommand handler). Pure functions: no side-effects beyond the
// requested DOM mutation. Each returns {ok:boolean, detail:string}.

import { isVisible } from '../../utils/dom.js';

// --- scroll primitives ---

export function scrollBy(direction) {
  // direction: 'down'|'up'|'page_down'|'page_up'
  const amounts = {
    down: [0, 300], up: [0, -300],
    page_down: [0, window.innerHeight], page_up: [0, -window.innerHeight],
  };
  const [x, y] = amounts[direction] || [0, 0];
  window.scrollBy(x, y);
  return { ok: true, detail: `scrolled ${direction}` };
}

export function scrollToTop() {
  window.scrollTo(0, 0);
  return { ok: true, detail: 'scrolled to top' };
}

export function scrollToBottom() {
  window.scrollTo(0, document.body.scrollHeight);
  return { ok: true, detail: 'scrolled to bottom' };
}

export function goBack() {
  history.back();
  return { ok: true, detail: 'went back' };
}

export function goForward() {
  history.forward();
  return { ok: true, detail: 'went forward' };
}

// --- click by text ---

// findElementByText: finds a, button, [role=button], input[type=submit|button]
// by textContent/value/aria-label. Prefers exact match then substring.
// Requires isVisible and not disabled.
export function findElementByText(text) {
  const needle = text.toLowerCase().trim();
  const candidates = Array.from(document.querySelectorAll(
    'a, button, [role="button"], input[type="submit"], input[type="button"]'
  ));
  // exact match first
  for (const el of candidates) {
    const label = (el.textContent || el.value || el.getAttribute('aria-label') || '').toLowerCase().trim();
    if (label === needle && isVisible(el) && !el.disabled) return el;
  }
  // substring match
  for (const el of candidates) {
    const label = (el.textContent || el.value || el.getAttribute('aria-label') || '').toLowerCase();
    if (label.includes(needle) && isVisible(el) && !el.disabled) return el;
  }
  return null;
}

export function clickByText(text) {
  const el = findElementByText(text);
  if (!el) return { ok: false, detail: `no visible element found matching "${text}"` };
  el.click();
  el.focus();
  const label = (el.textContent || el.value || el.getAttribute('aria-label') || '').trim().slice(0, 60);
  return { ok: true, detail: `clicked "${label}"` };
}

// --- focus navigation ---

export function focusNextLink() {
  const links = Array.from(document.querySelectorAll('a[href]')).filter(isVisible);
  const idx = links.indexOf(document.activeElement);
  const next = links[idx < links.length - 1 ? idx + 1 : 0];
  if (next) { next.focus(); return { ok: true, detail: 'focused next link' }; }
  return { ok: false, detail: 'no links found' };
}

export function focusPrevLink() {
  const links = Array.from(document.querySelectorAll('a[href]')).filter(isVisible);
  const idx = links.indexOf(document.activeElement);
  const prev = links[idx > 0 ? idx - 1 : links.length - 1];
  if (prev) { prev.focus(); return { ok: true, detail: 'focused previous link' }; }
  return { ok: false, detail: 'no links found' };
}

export function focusNextButton() {
  const buttons = Array.from(document.querySelectorAll(
    'button, [role="button"], input[type="button"], input[type="submit"]'
  )).filter(isVisible);
  const idx = buttons.indexOf(document.activeElement);
  const next = buttons[idx < buttons.length - 1 ? idx + 1 : 0];
  if (next) { next.focus(); return { ok: true, detail: 'focused next button' }; }
  return { ok: false, detail: 'no buttons found' };
}

// --- type text ---

// Uses the native-setter trick so React-controlled inputs receive the value.
// Falls back to execCommand for contenteditable targets.
export function typeText(text) {
  const el = document.activeElement;
  if (!el) return { ok: false, detail: 'no focused element' };
  if (el.matches('input, textarea')) {
    const nativeSetter = Object.getOwnPropertyDescriptor(
      el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
      'value'
    );
    if (nativeSetter && nativeSetter.set) {
      nativeSetter.set.call(el, el.value + text);
    } else {
      el.value += text;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true, detail: `typed "${text.slice(0, 40)}"` };
  }
  if (el.isContentEditable) {
    document.execCommand('insertText', false, text);
    return { ok: true, detail: `typed "${text.slice(0, 40)}"` };
  }
  return { ok: false, detail: 'focused element is not editable' };
}

// --- read aloud pass-throughs ---

export function readPage() {
  if (window.__ai4a11yReadAloud) {
    window.__ai4a11yReadAloud.speakPage();
    return { ok: true, detail: 'reading page' };
  }
  return { ok: false, detail: 'read-aloud not available' };
}

export function stopReading() {
  if (window.__ai4a11yReadAloud) {
    window.__ai4a11yReadAloud.stop();
    return { ok: true, detail: 'stopped reading' };
  }
  return { ok: false, detail: 'read-aloud not active' };
}
