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
const DESTRUCTIVE_RE = /\b(delete|remove|submit|buy|pay|confirm|send|publish|unsubscribe|deactivate|close account)\b/i;

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
    this.windowMs = typeof options.windowMs === 'number' ? options.windowMs : 4000;

    // Capture phase: run before the page's own handlers so a first click on a
    // risky control can be stopped before anything executes.
    this.clickHandler = (e) => this.onClick(e);
    document.addEventListener('click', this.clickHandler, true);

    console.log('[AI4A11y] Confirm Actions enabled');
    announce('Confirm actions on: risky buttons need a second click');
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
    // Match the control's accessible NAME, not its full subtree text: a whole
    // card wrapped in one <a> would otherwise match a keyword buried anywhere
    // inside it. Long text is prose or a card, not an action control, so cap it.
    const name = ((el.getAttribute && el.getAttribute('aria-label')) || el.value || el.textContent || '')
      .replace(/\s+/g, ' ').trim();
    if (!name || name.length > 40) return false;
    return DESTRUCTIVE_RE.test(name);
  },

  showPrompt(el) {
    const prompt = document.createElement('span');
    prompt.id = this.promptId;
    prompt.setAttribute('role', 'status'); // screen readers hear the ask too
    prompt.textContent = 'Click again to confirm';
    // Fixed overlay near the control, NOT inserted after it: an in-flow prompt
    // reflows the row and can shift the armed button out from under the pointer
    // before the confirming second click lands.
    prompt.style.cssText = 'position:fixed;z-index:2147483647;margin:0;padding:2px 8px;border-radius:4px;background:#b91c1c;color:#fff;font:600 12px/1.6 system-ui,sans-serif;pointer-events:none;';
    (document.body || document.documentElement).appendChild(prompt);
    let rect = null;
    try { rect = el.getBoundingClientRect(); } catch { /* detached */ }
    prompt.style.left = `${rect ? Math.max(4, rect.left) : 4}px`;
    prompt.style.top = `${rect ? Math.max(4, rect.top - 24) : 4}px`;
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
