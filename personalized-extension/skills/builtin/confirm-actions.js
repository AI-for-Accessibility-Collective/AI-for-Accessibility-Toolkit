// Confirm Actions — requires a second, deliberate click before destructive or
// final actions (delete, submit, pay, send, …) go through. From the co-design
// study: Made asked for exactly this guard — "please confirm and do not
// execute… it's really dangerous" — because for motor and cognitive users a
// tremor or a misread label can fire an irreversible action.
//
// Reversible by construction: one capture-phase click listener (stored as a
// ref so disable() can remove it), one injected prompt element, and a data
// flag on the armed element — all removed on disable(). The page's own
// handlers are never touched; a confirmed (second) click flows through them
// unchanged.
import { announce } from '../../utils/ai.js';

// Action words that mark a control as destructive or final. Matched against
// the control's textContent / value / aria-label.
const DESTRUCTIVE_RE = /\b(delete|remove|submit|buy|pay|confirm|send|post|publish|unsubscribe|deactivate|close account)\b/i;

export const ConfirmActions = {
  promptId: 'ai4a11y-confirm-prompt',
  armedAttr: 'data-ai4a11y-armed',
  enabled: false,
  clickHandler: null,   // stored ref so disable() removes this exact listener
  prompt: null,         // the injected "Click again to confirm" element
  promptTimer: null,
  armed: null,          // Set of elements currently carrying the data flag
  windowMs: 4000,       // how long a first click stays armed

  enable(options = {}) {
    if (this.enabled) return;
    this.enabled = true;
    this.armed = new Set();
    if (typeof options.windowMs === 'number') this.windowMs = options.windowMs;

    // Capture phase: run before the page's own handlers so a first click on a
    // risky control can be stopped before anything executes.
    this.clickHandler = (e) => this.onClick(e);
    document.addEventListener('click', this.clickHandler, true);

    console.log('[AI4A11y] Confirm Actions enabled');
    announce('Confirm actions on: risky buttons need a second click');
  },

  onClick(e) {
    if (!this.enabled) return;
    const t = e.target;
    if (!t || t.nodeType !== 1) return;
    // Never intercept our own prompt (its text contains "confirm").
    if (this.prompt && (t === this.prompt || this.prompt.contains(t))) return;
    const el = t.closest ? t.closest('button, [type="submit"], a') : null;
    if (!el || !this.looksDestructive(el)) return;

    if (el.hasAttribute(this.armedAttr)) {
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
    this.showPrompt(el);
    this.promptTimer = setTimeout(() => this.clearArmed(), this.windowMs);
  },

  looksDestructive(el) {
    return DESTRUCTIVE_RE.test(el.textContent || '') ||
      DESTRUCTIVE_RE.test(el.value || '') ||
      DESTRUCTIVE_RE.test((el.getAttribute && el.getAttribute('aria-label')) || '');
  },

  showPrompt(el) {
    const prompt = document.createElement('span');
    prompt.id = this.promptId;
    prompt.setAttribute('role', 'status'); // screen readers hear the ask too
    prompt.textContent = 'Click again to confirm';
    prompt.style.cssText = 'display:inline-block;margin:0 6px;padding:2px 8px;border-radius:4px;background:#b91c1c;color:#fff;font:600 12px/1.6 system-ui,sans-serif;';
    if (el.insertAdjacentElement) el.insertAdjacentElement('afterend', prompt);
    else (document.body || document.documentElement).appendChild(prompt);
    this.prompt = prompt;
  },

  // Drop any pending confirmation: timer, prompt, and armed flags.
  clearArmed() {
    if (this.promptTimer) { clearTimeout(this.promptTimer); this.promptTimer = null; }
    if (this.prompt) { this.prompt.remove(); this.prompt = null; }
    if (this.armed) {
      for (const el of this.armed) el.removeAttribute?.(this.armedAttr);
      this.armed.clear();
    }
  },

  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    if (this.clickHandler) {
      document.removeEventListener('click', this.clickHandler, true);
      this.clickHandler = null;
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
