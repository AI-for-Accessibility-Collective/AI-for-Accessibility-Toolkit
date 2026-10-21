// Stop Auto-Advance — halts content that moves or reloads on its own: meta
// refreshes, auto-rotating carousels, tickers, marquees, and autoplaying
// media (WCAG 2.2.2 Pause/Stop/Hide, 2.2.1 Timing Adjustable). Content that
// advances by itself steals the page out from under screen-reader and
// switch users mid-read, and an auto-refresh throws away their position
// entirely.
//
// Reversible by construction: meta refreshes are removed but their exact
// position is recorded for re-insertion; carousel animations are paused via
// one injected rule; only media WE paused is resumed, and only marquees WE
// stopped are restarted. A MutationObserver catches media that starts
// playing after enable, and is disconnected on disable.
import { announce } from '../utils/ai.js';

// Class-name fragments that indicate auto-rotating content. Paired with the
// injected rule below, matching elements (and their descendants) get their
// CSS animation paused — layout is untouched, so disable() is just removing
// the stylesheet.
const CAROUSEL_SELECTOR = '[class*="carousel"], [class*="slider"], [class*="rotat"], [class*="ticker"], [class*="marquee"], [aria-roledescription="carousel"]';

// Names that mark a group of slides a script rotates (a banner that changes
// every few seconds). Used with the sibling test in isSlide().
const ROTATOR_RE = /carousel|slide|swiper|slick|rotat|hero|banner|ticker|marquee/i;

// How long after a click, key press, touch or wheel a change still counts as
// the person's own doing (an arrow button, a swipe, Tab into a row).
const USER_MS = 1500;

function classNameOf(el) {
  const c = el && el.className;
  if (typeof c === 'string') return c;
  if (c && typeof c.baseVal === 'string') return c.baseVal; // SVG
  return '';
}

function tokensOf(cls) {
  return (cls || '').split(/\s+/).filter(Boolean);
}

// Pause media without breaking the page's own play(): while a play() is
// still loading, pausing rejects its promise and the page logs "The play()
// request was interrupted by a call to pause()". Wait until it plays.
function pauseQuietly(media, stillWanted) {
  if (!media.paused && media.readyState < 3 && media.currentSrc) {
    // If the page pauses it first, stop waiting: a later play is the person's.
    const done = () => { media.removeEventListener('playing', onPlaying); media.removeEventListener('pause', done); };
    const onPlaying = () => { done(); if (stillWanted()) media.pause(); };
    media.addEventListener('playing', onPlaying);
    media.addEventListener('pause', done);
  } else {
    media.pause();
  }
}

export const StopAutoAdvance = {
  styleId: 'ai4a11y-stop-autoadvance-styles',
  enabled: false,
  removedMetas: null,    // Array of { node, parent, nextSibling } for exact restore
  pausedMedia: null,     // Set of media elements we paused (resume exactly these)
  stoppedMarquees: null, // Set of <marquee> elements we stopped
  addedControls: null,   // Set of paused videos we showed controls on
  observer: null,
  slideObserver: null,   // watches slides' classes, see onClassChange
  rotating: null,        // WeakMap slides' parent -> the classes that move between them
  pageHas: null,         // Map slide -> which of those classes the page last gave it
  scrollPins: null,      // WeakMap sideways scroller -> its held scrollLeft
  scrollHandler: null,
  inputHandler: null,     // these three remember the person's last click or key,
  focusHandler: null,     // focus and pointer move, with where it happened
  hoverHandler: null,
  lastInput: null,
  lastFocus: null,
  lastHover: null,

  enable() {
    if (this.enabled) return;
    this.enabled = true;
    this.removedMetas = [];
    this.pausedMedia = new Set();
    this.stoppedMarquees = new Set();
    this.addedControls = new Set();

    // Remove <meta http-equiv="refresh"> so the page won't reload or
    // redirect out from under the reader. Recorded for exact re-insertion.
    let metas = [];
    try { metas = Array.from(document.querySelectorAll('meta[http-equiv]')); } catch { /* no DOM */ }
    for (const meta of metas) {
      try {
        if ((meta.getAttribute('http-equiv') || '').trim().toLowerCase() !== 'refresh') continue;
        this.removedMetas.push({ node: meta, parent: meta.parentNode, nextSibling: meta.nextSibling });
        meta.remove();
      } catch { /* skip */ }
    }

    // One rule pauses CSS-driven rotation on carousel-like containers and
    // everything inside them.
    const style = document.createElement('style');
    style.id = this.styleId;
    const descendants = CAROUSEL_SELECTOR.split(', ').map((s) => `${s} *`).join(', ');
    // Rows also lose smooth scrolling, so a row a timer nudges is put back
    // (onScroll) before it is drawn, instead of after a frame of sliding.
    style.textContent = `${CAROUSEL_SELECTOR}, ${descendants} { animation-play-state: paused !important; }\n` +
      `${CAROUSEL_SELECTOR} { scroll-behavior: auto !important; }`;
    (document.head || document.documentElement).appendChild(style);

    const stilled = this.sweep(document);

    // Catch media injected (or set playing) after enable — ad players and
    // lazy-loaded heroes typically start late. Guarded by `enabled` so a
    // disable() mid-callback is a no-op.
    if (typeof MutationObserver !== 'undefined') {
      this.observer = new MutationObserver((mutations) => {
        if (!this.enabled) return;
        for (const m of mutations) {
          for (const node of m.addedNodes) {
            if (node.nodeType === 1) this.considerLate(node);
          }
        }
      });
      this.observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
    }

    this.holdScriptedCarousels();

    const total = this.removedMetas.length + stilled;
    console.log(`[AI4A11y] Stop Auto-Advance enabled (${total} stopped)`);
    announce(total
      ? `Stopped ${total} auto-advancing item${total === 1 ? '' : 's'}; carousels paused`
      : 'Paused carousels; watching for auto-playing media');
  },

  // Still every playing media element and running marquee under root.
  // Returns how many were stopped.
  sweep(root) {
    let n = 0;
    let media = [];
    try { media = root.querySelectorAll('video, audio'); } catch { return 0; }
    for (const el of media) if (this.considerMedia(el)) n++;
    let marquees = [];
    try { marquees = root.querySelectorAll('marquee'); } catch { return n; }
    for (const el of marquees) if (this.considerMarquee(el)) n++;
    return n;
  },

  // Pause one media element if it is currently playing. Returns true if we
  // paused it (and will therefore resume it on disable).
  considerMedia(el) {
    try {
      if (!el || el.paused !== false || this.pausedMedia.has(el)) return false;
      if (typeof el.pause === 'function') pauseQuietly(el, () => this.enabled);
      this.pausedMedia.add(el);
      // A video that played by itself often has no controls, so once paused
      // there is no way to start it. Show them; disable() takes them off.
      if (el.tagName === 'VIDEO' && !el.controls) { el.controls = true; this.addedControls.add(el); }
      return true;
    } catch { return false; }
  },

  considerMarquee(el) {
    try {
      if (!el || this.stoppedMarquees.has(el)) return false;
      if (typeof el.stop === 'function') el.stop(); // jsdom/old engines may lack it
      this.stoppedMarquees.add(el);
      return true;
    } catch { return false; }
  },

  // A node added after enable: still it if it is itself media/marquee,
  // otherwise sweep whatever it contains.
  considerLate(el) {
    const tag = (el.tagName || '').toLowerCase();
    if (tag === 'video' || tag === 'audio') { this.considerMedia(el); return; }
    if (tag === 'marquee') { this.considerMarquee(el); return; }
    if (el.querySelectorAll) { this.sweep(el); this.pinScrollers(el); }
  },

  // Carousels a script moves on a timer: the stylesheet above can't reach
  // them. Two kinds are held still, each time they move with no click, key
  // press, touch, wheel or focus inside that carousel just before: a row
  // whose scrollLeft a timer steps along, and slides where a timer moves a
  // class such as "is-current" or "active" from one slide to the next. Its
  // arrow buttons, swipes, the wheel and the keyboard still move it. Only
  // boxes named like a carousel, slider, banner or ticker are held, so a
  // page scrolling its own tab strip to the open tab is left alone.
  holdScriptedCarousels() {
    if (typeof document === 'undefined' || !document.addEventListener || !document.body) return;
    this.lastInput = this.lastFocus = this.lastHover = null;
    const note = (key) => (e) => { if (e.isTrusted) this[key] = { at: Date.now(), target: e.target }; };
    this.inputHandler = note('lastInput');
    this.focusHandler = note('lastFocus');
    this.hoverHandler = note('lastHover');
    for (const type of ['pointerdown', 'keydown', 'wheel', 'touchstart']) {
      document.addEventListener(type, this.inputHandler, { capture: true, passive: true });
    }
    document.addEventListener('focusin', this.focusHandler, true);
    // Slides that switch while the pointer moves over a thumbnail are the
    // person's doing too; that change lands in the same moment as the event.
    document.addEventListener('mouseover', this.hoverHandler, { capture: true, passive: true });

    this.scrollPins = new WeakMap();
    this.pinScrollers(document.body);
    this.scrollHandler = (e) => this.onScroll(e);
    document.addEventListener('scroll', this.scrollHandler, { capture: true, passive: true });

    this.rotating = new WeakMap();
    this.pageHas = new Map();
    if (typeof MutationObserver !== 'undefined') {
      this.slideObserver = new MutationObserver((records) => this.onClassChange(records));
      this.slideObserver.observe(document.body, { attributes: true, attributeFilter: ['class'], attributeOldValue: true, subtree: true });
    }
  },

  // The carousel around a node: the outermost of it and its two parents
  // named like one (arrow buttons usually sit there), or null.
  carouselOf(node) {
    let box = null;
    for (let n = node, i = 0; n && n.nodeType === 1 && n !== document.body && i < 3; n = n.parentElement, i++) {
      if (ROTATOR_RE.test(classNameOf(n)) || /carousel|slide/i.test(n.getAttribute('aria-roledescription') || '')) box = n;
    }
    return box;
  },

  // Did the person just click, press a key, touch, scroll or focus inside this carousel?
  byUser(box, hoverToo) {
    const near = (rec, ms) => !!rec && Date.now() - rec.at < ms && rec.target && rec.target.nodeType === 1 && box.contains(rec.target);
    return near(this.lastInput, USER_MS) || near(this.lastFocus, USER_MS) || (hoverToo && near(this.lastHover, 50));
  },

  // Remember where each carousel row that scrolls sideways is now.
  pinScrollers(root) {
    if (!this.scrollPins || !root || !root.querySelectorAll) return;
    for (const el of [root, ...root.querySelectorAll('*')]) {
      if (el.scrollWidth > el.clientWidth + 1 && !this.scrollPins.has(el) && this.carouselOf(el)) this.scrollPins.set(el, el.scrollLeft);
    }
  },

  onScroll(e) {
    const el = e.target;
    if (!this.enabled || !el || el.nodeType !== 1) return; // the page itself scrolling is the person's
    const box = this.carouselOf(el);
    if (!box) return;
    const pin = this.scrollPins.get(el);
    if (pin === undefined || this.byUser(box, false)) { this.scrollPins.set(el, el.scrollLeft); return; }
    if (Math.abs(el.scrollLeft - pin) < 0.5) return; // up and down is left alone
    // "instant" so the row jumps back instead of sliding back.
    try { el.scrollTo({ left: pin, behavior: 'instant' }); } catch { el.scrollLeft = pin; }
  },

  // A class moved from one slide to the next. Only such moving classes are
  // touched (other adapters' classes on the same elements are left alone),
  // and each move is put back unless the person made it.
  onClassChange(records) {
    if (!this.enabled) return;
    const before = new Map();
    for (const r of records) if (r.target.nodeType === 1 && !before.has(r.target)) before.set(r.target, r.oldValue);
    const changes = [];
    for (const [el, was] of before) {
      const now = el.getAttribute('class');
      const a = tokensOf(was), b = tokensOf(now);
      changes.push({ el, now, gained: b.filter((t) => !a.includes(t)), lost: a.filter((t) => !b.includes(t)) });
    }
    // Learn the moving class: lost by one like sibling and gained by another at once.
    for (const c of changes) {
      const parent = c.el.parentElement;
      for (const t of c.gained) {
        if (/^ai4a11y-/.test(t) || (this.rotating.get(parent) || new Set()).has(t)) continue;
        if (changes.some((d) => d !== c && d.el.parentElement === parent && d.lost.includes(t)) && this.isSlide(c.el)) {
          if (!this.rotating.has(parent)) this.rotating.set(parent, new Set());
          this.rotating.get(parent).add(t);
        }
      }
    }
    let wrote = false;
    for (const c of changes) {
      const moving = c.el.parentElement && this.rotating.get(c.el.parentElement);
      if (!moving) continue;
      // What the page wants this slide to be, shown again on disable.
      this.pageHas.set(c.el, new Set(tokensOf(c.now).filter((t) => moving.has(t))));
      if (!c.gained.concat(c.lost).some((t) => moving.has(t))) continue;
      if (this.byUser(this.carouselOf(c.el) || c.el.parentElement, true)) {
        // The person moved it: show what the page thinks every slide in this
        // group is now, which may differ from the slide held still so far.
        this.showPageView(c.el.parentElement);
      } else {
        for (const t of c.gained) if (moving.has(t)) c.el.classList.remove(t);
        for (const t of c.lost) if (moving.has(t)) c.el.classList.add(t);
      }
      wrote = true;
    }
    // Our own writes are not the page's: drop them before they come back here.
    if (wrote && this.slideObserver) this.slideObserver.takeRecords();
  },

  showPageView(parent) {
    const moving = this.rotating.get(parent);
    if (!moving) return;
    for (const sib of Array.from(parent.children)) {
      const has = this.pageHas.get(sib);
      if (has) for (const t of moving) sib.classList.toggle(t, has.has(t));
    }
  },

  // One of two or more like siblings (same tag, a class in common) in
  // something named like a carousel, slider or banner.
  isSlide(el) {
    const parent = el.parentElement;
    if (!parent || el === document.body || parent === document.documentElement || !this.carouselOf(el)) return false;
    const mine = tokensOf(classNameOf(el));
    return Array.from(parent.children).some((s) => s !== el && s.tagName === el.tagName &&
      tokensOf(classNameOf(s)).some((t) => mine.includes(t)));
  },

  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    if (this.observer) { this.observer.disconnect(); this.observer = null; }
    try { document.getElementById(this.styleId)?.remove(); } catch { /* no DOM */ }

    // Put each meta refresh back exactly where it was.
    if (this.removedMetas) {
      for (const { node, parent, nextSibling } of this.removedMetas) {
        if (!parent) continue;
        try { parent.insertBefore(node, nextSibling); }
        catch { try { parent.appendChild(node); } catch { /* parent gone */ } }
      }
      this.removedMetas = null;
    }

    // Resume only the media we paused; the user's own pauses stay paused.
    if (this.pausedMedia) {
      for (const el of this.pausedMedia) {
        try {
          if (typeof el.play === 'function') el.play()?.catch?.(() => {});
        } catch { /* autoplay policy may refuse */ }
      }
      this.pausedMedia.clear();
      this.pausedMedia = null;
    }

    if (this.stoppedMarquees) {
      for (const el of this.stoppedMarquees) {
        try { if (typeof el.start === 'function') el.start(); } catch { /* skip */ }
      }
      this.stoppedMarquees.clear();
      this.stoppedMarquees = null;
    }

    if (this.addedControls) {
      for (const el of this.addedControls) { try { el.controls = false; } catch { /* skip */ } }
      this.addedControls = null;
    }

    // Stop holding script-driven carousels, and show each slide as the page
    // last set it, so its own timer carries on from where it thinks it is.
    if (this.slideObserver) { this.slideObserver.disconnect(); this.slideObserver = null; }
    if (this.pageHas) {
      for (const [el, has] of this.pageHas) {
        const moving = el.parentElement && this.rotating.get(el.parentElement);
        if (moving) for (const t of moving) el.classList.toggle(t, has.has(t));
      }
      this.pageHas = null;
      this.rotating = null;
    }
    if (this.scrollHandler) { document.removeEventListener('scroll', this.scrollHandler, { capture: true }); this.scrollHandler = null; }
    if (this.inputHandler) {
      for (const type of ['pointerdown', 'keydown', 'wheel', 'touchstart']) document.removeEventListener(type, this.inputHandler, { capture: true });
      this.inputHandler = null;
    }
    if (this.hoverHandler) { document.removeEventListener('mouseover', this.hoverHandler, { capture: true }); this.hoverHandler = null; }
    if (this.focusHandler) { document.removeEventListener('focusin', this.focusHandler, true); this.focusHandler = null; }
    this.scrollPins = null;
    this.lastInput = this.lastFocus = this.lastHover = null;

    console.log('[AI4A11y] Stop Auto-Advance disabled');
    announce('Auto-advancing content resumed');
  },

  toggle() {
    if (this.enabled) this.disable();
    else this.enable();
  },
};

if (typeof window !== 'undefined') window.__ai4a11yStopAutoAdvance = StopAutoAdvance;
