// Calm page: stops unexpected motion, animations, transitions, autoplaying media,
// and auto-advancing carousels, for people with sensory and cognitive barriers.
//
// Suggested in onboarding for: sensory, cognitive (a suggestion only, never a gate).
// The person's settings it reads: motionReducer.
// What the person can adjust: nothing (on or off).
// Options: none required.
// Decisions:
// - Uses s.media and one stylesheet (s.css), making all changes reversible.
// - Sets animation and transition durations to 0s, with animation-fill-mode: both,
//   so content that animates into view stays visible in its final state rather than
//   getting stuck hidden.
// - Neutralizes smooth scrolling to auto so page jumps and anchor navigation do not
//   cause scrolling sickness.
// - Pauses autoplaying video and GIF-like muted looping media via s.media, showing
//   standard controls so the person can choose to play them.
// - Pauses auto-advancing carousels while keeping their interactive controls intact.
// - Marquees are stopped cleanly and resume only on disable() if they were running.
// - On disable(), s.media and s.end() restore only what was originally running before
//   enable(), leaving anything the person played or paused untouched.
// What it cannot do:
// - Cannot stop animations rendered within canvas contexts without replacing canvas
//   elements, and cannot control third-party cross-origin iframes lacking API control.

export default {
  enable(options = {}, toolkit) {
    if (this.s && !this.s.ended) return;
    const s = (this.s = toolkit.session());

    // 1. One stylesheet for CSS animations, transitions, scrolling, and marquee
    const css = `
      *:not([id^="ai4a11y-"]):not([class^="ai4a11y-"]):not([data-ai4a11y-ui]),
      *:not([id^="ai4a11y-"]):not([class^="ai4a11y-"]):not([data-ai4a11y-ui])::before,
      *:not([id^="ai4a11y-"]):not([class^="ai4a11y-"]):not([data-ai4a11y-ui])::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        animation-iteration-count: 1 !important;
        animation-fill-mode: both !important;
        animation-play-state: paused !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
        scroll-behavior: auto !important;
      }
      html, body {
        scroll-behavior: auto !important;
      }
      [class*="parallax"], [style*="background-attachment: fixed"] {
        background-attachment: scroll !important;
      }
      marquee {
        overflow-x: hidden !important;
      }
    `;
    s.css('calm-page', css);

    // 2. Pause autoplaying videos and animated GIF-like video loops, showing controls
    const seenMedia = new WeakSet();
    const pauseMedia = (el) => {
      if (!el || seenMedia.has(el)) return;
      seenMedia.add(el);
      s.media.pause(el, { showControls: true });
    };

    for (const v of document.querySelectorAll('video, audio')) {
      pauseMedia(v);
    }

    // 3. Stop running marquees
    const seenMarquees = new WeakSet();
    const stopMarquee = (el) => {
      if (!el || seenMarquees.has(el)) return;
      seenMarquees.add(el);
      try {
        if (typeof el.stop === 'function') {
          el.stop();
          s.onEnd(() => {
            try { if (typeof el.start === 'function') el.start(); } catch {}
          });
        }
      } catch {}
    };

    for (const m of document.querySelectorAll('marquee')) {
      stopMarquee(m);
    }

    // 4. Hold scripted carousels (tickers, sliders, rotators)
    const ROTATOR_RE = /carousel|slide|swiper|slick|rotat|hero|banner|ticker|marquee/i;
    let lastUserAction = 0;
    let lastUserTarget = null;
    const noteUser = (e) => {
      if (e.isTrusted) {
        lastUserAction = Date.now();
        lastUserTarget = e.target;
      }
    };
    for (const type of ['pointerdown', 'keydown', 'touchstart', 'wheel']) {
      s.listen(document, type, noteUser, { capture: true, passive: true });
    }
    s.listen(document, 'focusin', noteUser, true);

    const carouselOf = (node) => {
      for (let n = node, i = 0; n && n.nodeType === 1 && n !== document.body && i < 4; n = n.parentElement, i++) {
        const cls = typeof n.className === 'string' ? n.className : (n.className?.baseVal || '');
        const role = n.getAttribute('aria-roledescription') || '';
        if (ROTATOR_RE.test(cls) || /carousel|slide/i.test(role)) return n;
      }
      return null;
    };

    const byUser = (box) => {
      if (!box) return false;
      if (s.watch.byPerson(box, { withinMs: 1500 })) return true;
      if (Date.now() - lastUserAction < 1500 && lastUserTarget && box.contains(lastUserTarget)) return true;
      return false;
    };

    const scrollPins = new WeakMap();
    const pinScrollers = (root) => {
      if (!root || !root.querySelectorAll) return;
      for (const el of [root, ...root.querySelectorAll('*')]) {
        if (el.scrollWidth > el.clientWidth + 1 && !scrollPins.has(el) && carouselOf(el)) {
          scrollPins.set(el, el.scrollLeft);
        }
      }
    };
    pinScrollers(document.body);

    s.listen(document, 'scroll', (e) => {
      const el = e.target;
      if (!s.alive() || !el || el.nodeType !== 1) return;
      const box = carouselOf(el);
      if (!box) return;
      const pin = scrollPins.get(el);
      if (pin === undefined || byUser(box)) {
        scrollPins.set(el, el.scrollLeft);
        return;
      }
      if (Math.abs(el.scrollLeft - pin) < 0.5) return;
      try { el.scrollTo({ left: pin, behavior: 'instant' }); } catch { el.scrollLeft = pin; }
    }, { capture: true, passive: true });

    const rotating = new WeakMap();

    const isSlide = (el) => {
      const parent = el.parentElement;
      if (!parent || el === document.body || parent === document.documentElement || !carouselOf(el)) return false;
      const cls = typeof el.className === 'string' ? el.className : (el.className?.baseVal || '');
      const tokens = cls.split(/\s+/).filter(Boolean);
      return Array.from(parent.children).some((s) => s !== el && s.tagName === el.tagName &&
        (typeof s.className === 'string' ? s.className : (s.className?.baseVal || '')).split(/\s+/).filter(Boolean).some((t) => tokens.includes(t)));
    };

    if (typeof MutationObserver !== 'undefined' && document.body) {
      const slideObserver = new MutationObserver((records) => {
        if (!s.alive()) return;
        const before = new Map();
        for (const r of records) if (r.target.nodeType === 1 && !before.has(r.target)) before.set(r.target, r.oldValue);
        const changes = [];
        for (const [el, was] of before) {
          const now = el.getAttribute('class') || '';
          const a = (was || '').split(/\s+/).filter(Boolean);
          const b = now.split(/\s+/).filter(Boolean);
          changes.push({ el, now, gained: b.filter((t) => !a.includes(t)), lost: a.filter((t) => !b.includes(t)) });
        }
        for (const c of changes) {
          const parent = c.el.parentElement;
          if (!parent) continue;
          for (const t of c.gained) {
            if (/^ai4a11y-/.test(t) || (rotating.get(parent) || new Set()).has(t)) continue;
            if (changes.some((d) => d !== c && d.el.parentElement === parent && d.lost.includes(t)) && isSlide(c.el)) {
              if (!rotating.has(parent)) rotating.set(parent, new Set());
              rotating.get(parent).add(t);
            }
          }
        }
        let wrote = false;
        for (const c of changes) {
          const moving = c.el.parentElement && rotating.get(c.el.parentElement);
          if (!moving) continue;
          if (!c.gained.concat(c.lost).some((t) => moving.has(t))) continue;
          const box = carouselOf(c.el) || c.el.parentElement;
          if (!byUser(box)) {
            for (const t of c.gained) if (moving.has(t)) c.el.classList.remove(t);
            for (const t of c.lost) if (moving.has(t)) c.el.classList.add(t);
            wrote = true;
          }
        }
        if (wrote) slideObserver.takeRecords();
      });
      slideObserver.observe(document.body, { attributes: true, attributeFilter: ['class'], attributeOldValue: true, subtree: true });
      s.onEnd(() => {
        slideObserver.disconnect();
      });
    }

    // 5. Watch for dynamic elements added after enable
    s.watch.added(document, (el) => {
      if (el.tagName === 'VIDEO' || el.tagName === 'AUDIO') {
        pauseMedia(el);
      } else if (el.tagName === 'MARQUEE') {
        stopMarquee(el);
      } else if (el.querySelectorAll) {
        for (const v of el.querySelectorAll('video, audio')) pauseMedia(v);
        for (const m of el.querySelectorAll('marquee')) stopMarquee(m);
        pinScrollers(el);
      }
    });

    return true;
  },

  disable() {
    this.s?.end();
    this.s = null;
  },
};
