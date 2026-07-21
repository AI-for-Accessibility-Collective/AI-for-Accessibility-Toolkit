// Save Reading Spot — remembers how far down the page the reader has
// scrolled and, on returning to that page, offers a one-tap "Jump back to
// where you were" button. COGA memory support: cognitive and older-adult
// users described losing their place in long pages after an interruption
// and having to re-skim from the top to find it again.
//
// Reversible by construction: enable() adds one debounced scroll listener
// and (at most) one small fixed button; disable() removes both. The saved
// position itself is deliberately KEPT on disable — forgetting the spot is
// exactly the failure this adapter exists to prevent, and it must survive
// until the next visit.
import { announce } from '../../utils/ai.js';

const KEY_PREFIX = 'ai4a11y-spot:';
const SAVE_DELAY_MS = 500;

export const ReadingSpot = {
  buttonId: 'ai4a11y-spot-restore',
  enabled: false,
  key: null,
  savedY: null,          // the spot from a previous visit, if any
  restorePending: false, // a jump-back button is showing and not yet used
  scrollHandler: null,   // stored ref so disable() can removeEventListener
  saveTimer: null,       // debounce timeout, cleared on disable

  // localStorage can throw on ANY access in private mode or a sandboxed
  // frame, so every touch goes through these two guarded helpers. Access is
  // via `window.localStorage` (never the bare global) so tests can stub it.
  readSpot() {
    try {
      if (typeof window.localStorage === 'undefined') return null;
      const raw = window.localStorage.getItem(this.key);
      const y = raw === null ? NaN : Number(raw);
      return Number.isFinite(y) ? y : null;
    } catch { return null; }
  },

  saveSpot(y) {
    try {
      if (typeof window.localStorage === 'undefined') return;
      window.localStorage.setItem(this.key, String(y));
    } catch { /* storage unavailable: the spot just isn't saved */ }
  },

  enable(options = {}) {
    if (this.enabled) return;
    this.enabled = true;
    // Include the query string: sites that route by query (e.g. /watch?v=aaa
    // vs /watch?v=bbb) are different pages and must not share one spot.
    this.key = options.key || KEY_PREFIX + window.location.pathname + window.location.search;

    // A spot saved on a previous visit → offer to jump back. 0 (the top) is
    // where a fresh load already sits, so only a real offset earns a button.
    const savedY = this.readSpot();
    this.savedY = savedY;
    this.restorePending = false;
    if (savedY !== null && savedY > 0 && !document.getElementById(this.buttonId)) {
      this.restorePending = true; // a far spot the reader hasn't returned to yet
      const btn = document.createElement('button');
      btn.id = this.buttonId;
      btn.type = 'button';
      btn.textContent = 'Jump back to where you were';
      btn.style.cssText =
        'position: fixed; bottom: 16px; right: 16px; z-index: 2147483647;' +
        'padding: 10px 16px; font-size: 16px; border-radius: 8px;' +
        'border: 2px solid #1a5fb4; background: #ffffff; color: #1a5fb4; cursor: pointer;';
      btn.addEventListener('click', () => {
        window.scrollTo(0, savedY);
        this.restorePending = false;
        btn.remove();
      });
      (document.body || document.documentElement).appendChild(btn);
    }

    // Save the position as the reader scrolls, debounced so a long scroll
    // writes once at rest instead of on every frame. Guarded by `enabled`
    // so a disable() between event and timeout is a no-op.
    this.scrollHandler = () => {
      if (!this.enabled) return;
      if (this.saveTimer) clearTimeout(this.saveTimer);
      this.saveTimer = setTimeout(() => {
        this.saveTimer = null;
        if (!this.enabled) return;
        const y = window.scrollY;
        // While a jump-back button is still pending, a small accidental scroll
        // must not overwrite the far spot the reader hasn't returned to yet —
        // only record a position beyond it (they have genuinely read further).
        if (this.restorePending && this.savedY != null && y <= this.savedY) return;
        this.restorePending = false;
        this.saveSpot(y);
      }, SAVE_DELAY_MS);
    };
    window.addEventListener('scroll', this.scrollHandler, { passive: true });

    console.log('[AI4A11y] Save Reading Spot enabled');
    announce(savedY !== null && savedY > 0
      ? 'Found your last reading spot — a jump-back button was added'
      : 'Saving your reading spot as you scroll');
  },

  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    if (this.scrollHandler) {
      window.removeEventListener('scroll', this.scrollHandler);
      this.scrollHandler = null;
    }
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
    this.restorePending = false;
    this.savedY = null;
    document.getElementById(this.buttonId)?.remove();
    // The saved spot itself stays in storage for the next visit.
    console.log('[AI4A11y] Save Reading Spot disabled');
    announce('Reading spot saving turned off');
  },

  toggle() {
    if (this.enabled) this.disable();
    else this.enable();
  },
};

if (typeof window !== 'undefined') window.__ai4a11yReadingSpot = ReadingSpot;
