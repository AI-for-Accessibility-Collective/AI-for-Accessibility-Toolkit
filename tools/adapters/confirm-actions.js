// Confirm Actions — requires a second, deliberate click before destructive or
// final actions (delete, submit, pay, send, …) go through. From the co-design
// study: Made asked for exactly this guard — "please confirm and do not
// execute… it's really dangerous" — because for motor and cognitive users a
// tremor or a misread label can fire an irreversible action.
//
// Reversible by construction: one capture-phase click listener and one keydown
// listener for Escape dismissal (stored as refs so disable() can remove them),
// one injected prompt element placed safely outside the control to never obscure
// focus (WCAG 2.4.11), and a data flag on the armed element — all removed on
// disable(). The page's own handlers are never touched; a confirmed (second)
// click flows through them unchanged.
import { announce } from '../utils/ai.js';

// Action words that mark a control as destructive or final. Matched against
// the control's textContent / value / aria-label / title. "Place your order"
// is how most stores word the button that pays, and has none of the other words.
const ACTION_WORDS = 'delete|remove|submit|buy|pay|confirm|send|publish|unsubscribe|deactivate|close account|place (?:your |my |the )?order|complete (?:your |my |the )?(?:order|purchase)';
const DESTRUCTIVE_RE = new RegExp(`\\b(?:${ACTION_WORDS})\\b`, 'i');
// A long name only counts when it starts with the action: a store's "Delete"
// button often carries the product's name for screen readers ("Delete Redbird
// Basics 20W USB-C wall charger"), while a card link only mentions the word.
const STARTS_WITH_ACTION_RE = new RegExp(`^(?:${ACTION_WORDS})\\b`, 'i');
// A second click sooner than this after the first is a double click or a
// tremor, not a decision, so it doesn't confirm.
const MIN_CONFIRM_GAP_MS = 400;

export const ConfirmActions = {
  promptId: 'ai4a11y-confirm-prompt',
  armedAttr: 'data-ai4a11y-armed',
  enabled: false,
  clickHandler: null,   // stored ref so disable() removes this exact listener
  keydownHandler: null, // stored ref for Escape dismissal
  prompt: null,         // the injected "Click again to confirm" element
  promptTimer: null,
  armed: null,          // Set of elements currently carrying the data flag
  armedAt: null,        // timeStamp of the click that armed it
  windowMs: 4000,       // how long a first click stays armed

  enable(options = {}) {
    if (this.enabled) return;
    this.enabled = true;
    this.armed = new Set();
    this.windowMs = typeof options.windowMs === 'number' ? options.windowMs : 4000;

    // Capture phase: run before the page's own handlers so a first click on a
    // risky control can be stopped before anything executes.
    this.clickHandler = (e) => this.onClick(e);
    document.addEventListener('click', this.clickHandler, true);

    // Escape dismisses any pending confirmation (WCAG 1.4.13).
    this.keydownHandler = (e) => this.onKeyDown(e);
    document.addEventListener('keydown', this.keydownHandler, true);

    console.log('[AI4A11y] Confirm Actions enabled');
    announce('Confirm actions on: risky buttons need a second click');
  },

  // Escape cancels the armed control, and still reaches the page's own Escape
  // handling (closing its dialog or menu).
  onKeyDown(e) {
    if (!this.enabled) return;
    if (e.key === 'Escape' && (this.armed?.size || this.prompt)) {
      this.clearArmed();
      announce('Confirmation cancelled');
    }
  },

  onClick(e) {
    if (!this.enabled) return;
    // Only guard real user clicks. A page's own programmatic .click() (e.g. a
    // custom control forwarding to a hidden submit button) is not a tremor or a
    // misread label — intercepting it would silently break the site's own flow.
    if (e.isTrusted === false) return;
    const t = e.target;
    if (!t || t.nodeType !== 1) return;
    // Never intercept our own prompt (its text contains "confirm").
    if (this.prompt && (t === this.prompt || this.prompt.contains(t))) return;

    const el = t.closest ? t.closest('button, [type="submit"], [type="button"], [type="reset"], [role="button"], a') : null;

    // If an action was armed and the user clicked outside of it, cancel the
    // previous pending confirmation.
    if (this.armed?.size && (!el || !this.armed.has(el))) {
      this.clearArmed();
    }

    if (!el || !this.looksDestructive(el)) return;

    if (el.hasAttribute(this.armedAttr)) {
      const gap = typeof e.timeStamp === 'number' && this.armedAt != null ? e.timeStamp - this.armedAt : Infinity;
      if (gap < MIN_CONFIRM_GAP_MS) {
        // Too quick to be a decision: keep holding it, and keep it armed.
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      // Second click within the window: the user confirmed — let it through.
      this.clearArmed();
      return;
    }

    // First click: block it and ask for confirmation.
    e.preventDefault();
    e.stopImmediatePropagation();
    this.clearArmed(); // only one pending confirmation at a time
    el.setAttribute(this.armedAttr, 'true');
    this.armed.add(el);
    this.armedAt = typeof e.timeStamp === 'number' ? e.timeStamp : null;
    // A click made with Enter or Space has detail 0: say "press", not "click".
    this.showPrompt(el, e.detail === 0);
    this.promptTimer = setTimeout(() => this.clearArmed(), this.windowMs);
  },

  // The control's accessible name, as matched and as said back to the person.
  nameOf(el) {
    if (!el) return '';
    let name = (el.getAttribute && el.getAttribute('aria-label')) || '';
    if (!name && el.getAttribute && el.getAttribute('aria-labelledby') && typeof document !== 'undefined') {
      const ids = el.getAttribute('aria-labelledby').split(/\s+/);
      name = ids.map(id => document.getElementById(id)?.textContent || '').join(' ').trim();
    }
    if (!name && el.value && el.value.trim()) name = el.value.trim();
    if (!name && el.textContent && el.textContent.trim()) name = el.textContent.trim();
    if (!name && el.getAttribute && el.getAttribute('title')) name = el.getAttribute('title').trim();
    if (!name && el.querySelector) {
      const img = el.querySelector('img[alt]');
      if (img) name = (img.getAttribute('alt') || '').trim();
    }
    return (name || '').replace(/\s+/g, ' ').trim();
  },

  looksDestructive(el) {
    // Match the control's accessible NAME, not its full subtree text: a whole
    // card wrapped in one <a> would otherwise match a keyword buried anywhere
    // inside it. Long text is prose or a card, not an action control, unless
    // it starts with the action word.
    const name = this.nameOf(el);
    if (!name) return false;
    if (name.length > 40) return STARTS_WITH_ACTION_RE.test(name);
    return DESTRUCTIVE_RE.test(name);
  },

  showPrompt(el, byKeyboard = false) {
    const prompt = document.createElement('span');
    prompt.id = this.promptId;
    // The ask is read out once through announce() (the page's live region).
    // A role="status" element made on the spot, already holding its words,
    // is often not read at all, and when it is, the ask is heard twice.
    prompt.setAttribute('aria-hidden', 'true');
    prompt.textContent = byKeyboard ? 'Press again to confirm' : 'Click again to confirm';
    let name = this.nameOf(el);
    if (name.length > 60) name = name.slice(0, 59) + '…';
    announce(`${name}: ${byKeyboard ? 'press' : 'click'} again to confirm`);

    // Fixed overlay positioned safely near the control without obscuring it
    // or its focus indicator (WCAG 2.4.11).
    prompt.style.cssText = 'position:fixed;z-index:2147483647;margin:0;padding:2px 8px;border-radius:4px;background:#b91c1c;color:#fff;font:600 12px/1.6 system-ui,sans-serif;pointer-events:none;white-space:nowrap;max-width:calc(100vw - 8px);box-sizing:border-box;';
    (document.body || document.documentElement).appendChild(prompt);

    const promptRect = prompt.getBoundingClientRect();
    const promptHeight = promptRect.height || 24;
    const promptWidth = promptRect.width || 140;

    let rect = null;
    try { rect = el.getBoundingClientRect(); } catch { /* detached */ }

    const winWidth = (typeof window !== 'undefined' && window.innerWidth) || 1280;
    const winHeight = (typeof window !== 'undefined' && window.innerHeight) || 800;

    let top = 4;
    let left = 4;

    if (rect) {
      // Place above the control with a 4px gap so it doesn't touch or cover
      // the control or its focus indicator (WCAG 2.4.11). If there is not
      // enough room above (near top of viewport), place it below the control.
      if (rect.top >= promptHeight + 6) {
        top = rect.top - promptHeight - 4;
      } else {
        top = rect.bottom + 4;
      }
      left = rect.left;
    }

    // Keep within viewport boundaries horizontally and vertically
    const maxLeft = Math.max(4, winWidth - promptWidth - 4);
    left = Math.max(4, Math.min(left, maxLeft));

    const maxTop = Math.max(4, winHeight - promptHeight - 4);
    top = Math.max(4, Math.min(top, maxTop));

    prompt.style.left = `${Math.round(left)}px`;
    prompt.style.top = `${Math.round(top)}px`;
    this.prompt = prompt;
  },

  // Drop any pending confirmation: timer, prompt, and armed flags.
  clearArmed() {
    if (this.promptTimer) { clearTimeout(this.promptTimer); this.promptTimer = null; }
    if (this.prompt) { this.prompt.remove(); this.prompt = null; }
    const stray = typeof document !== 'undefined' ? document.getElementById(this.promptId) : null;
    if (stray) stray.remove();
    this.armedAt = null;
    if (this.armed) {
      for (const el of this.armed) el.removeAttribute?.(this.armedAttr);
      this.armed.clear();
    }
    if (typeof document !== 'undefined') {
      const remaining = document.querySelectorAll(`[${this.armedAttr}]`);
      for (const el of remaining) el.removeAttribute(this.armedAttr);
    }
  },

  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    if (this.clickHandler) {
      document.removeEventListener('click', this.clickHandler, true);
      this.clickHandler = null;
    }
    if (this.keydownHandler) {
      document.removeEventListener('keydown', this.keydownHandler, true);
      this.keydownHandler = null;
    }
    this.clearArmed();
    this.armed = null;
    console.log('[AI4A11y] Confirm Actions disabled');
    announce('Confirm actions off');
  },

  toggle() {
    if (this.enabled) this.disable();
    else this.enable();
  },
};

if (typeof window !== 'undefined') window.__ai4a11yConfirmActions = ConfirmActions;
