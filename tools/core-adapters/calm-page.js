// calm-page.js — Stops motion that starts on its own: CSS animations, transitions,
// smooth scrolling, autoplaying video, GIF-like animated images, and auto-advancing carousels.
// Barrier: People with vestibular disorders, motion sensitivity, ADHD, or cognitive barriers
// can experience dizziness, nausea, distraction, or lose their reading position when content
// moves, animates, autoplays, or advances automatically (WCAG 2.2.2 Pause, Stop, Hide; 2.3.1).
//
// Suggested in onboarding for: sensory, cognitive (a suggestion only, never a gate).
// The person's settings it reads: motionReducer.
// What the person can adjust: nothing (the shortcut, if given, turns it on and off).
//
// Options:
//   stopAnimations: Whether to stop CSS animations and transitions (default: true).
//   pauseMedia:     Whether to pause autoplaying videos and animated media (default: true).
//   stopCarousels:  Whether to pause auto-advancing carousels and marquees (default: true).
//
// Decisions:
//   • Injects one reversible stylesheet via s.css that sets animation and transition durations
//     and delays to 0s, iteration count to 1, fill mode to forwards, and scroll behavior to auto.
//     Content stays visible in its final state.
//   • Pauses autoplaying video and looping muted media (GIF-like animated images) through s.media.pause,
//     showing controls so the person has a visible way to play them.
//   • Captures late play events: if initiated by the person (s.watch.byPerson), playback continues;
//     if started by the page, pauses with controls.
//   • Pauses running Web Animations API (WAAPI) animations via getAnimations(), resuming on disable.
//   • Stops auto-advancing carousels (WCAG 2.2.2):
//     - When the carousel has its own pause/stop control, uses it to stop advancement and keeps controls.
//     - Otherwise holds the active slide shown by observing class/attribute mutations and scroll events.
//     - If the page attempts to auto-advance more than 4 times, stops holding rather than fight the page.
//     - Measures once per carousel and never reads the scroll width of every element on the page.
//   • Stops <marquee> elements with .stop(), restarting only what was running on disable().
//   • Reversible by construction: disable() ends the session (s.end()), which restores original styles,
//     resumes only media that was playing before enable(), and leaves user-started playback playing.
//   • Announces "Page calmed: animations, autoplay and auto-advancing paused."
//
// What it cannot do:
//   • Cannot freeze GIF animations embedded within Canvas 2D or WebGL surfaces without redrawing.
//   • Cannot prevent external plugin video players (Flash/Silverlight) from executing internal scripts.

const CAROUSEL_SELECTOR = [
  '[aria-roledescription="carousel"]',
  '[class*="carousel" i]',
  '[class*="slider" i]',
  '[class*="rotat" i]',
  '[class*="slideshow" i]',
  '[data-carousel]',
  '[data-slider]',
].join(', ');

export default {
  enable(options = {}, toolkit) {
    if (this.s && !this.s.ended) return;
    this.options = options || {};
    this.toolkit = toolkit || this.toolkit;
    if (!this.toolkit) return false;

    const s = (this.s = this.toolkit.session());
    const root = document.body || document.documentElement;
    if (!root) return false;

    const stopAnimations = this.options.stopAnimations !== false;
    const pauseMediaOpt = this.options.pauseMedia !== false;
    const stopCarouselsOpt = this.options.stopCarousels !== false;

    // 1. One stylesheet that halts CSS animations, transitions and smooth scrolling.
    // Content stays visible in its final state (fill-mode: forwards).
    if (stopAnimations) {
      const cssRules = `
        *, *::before, *::after {
          animation-duration: 0s !important;
          animation-delay: 0s !important;
          animation-iteration-count: 1 !important;
          animation-fill-mode: forwards !important;
          transition-duration: 0s !important;
          transition-delay: 0s !important;
          scroll-behavior: auto !important;
        }
        html {
          scroll-behavior: auto !important;
        }
        [aria-roledescription="carousel"], [aria-roledescription="carousel"] *,
        [class*="carousel" i], [class*="carousel" i] *,
        [class*="slider" i], [class*="slider" i] *,
        [class*="slideshow" i], [class*="slideshow" i] *,
        [class*="rotat" i], [class*="rotat" i] *,
        [class*="ticker" i], [class*="ticker" i] *,
        [class*="marquee" i], [class*="marquee" i] * {
          animation-play-state: paused !important;
        }
      `;
      s.css('calm-page-styles', cssRules);

      // Web Animations API (WAAPI): pause running animations not driven by CSS
      if (typeof document !== 'undefined' && typeof document.getAnimations === 'function') {
        try {
          const runningWaapi = [];
          for (const anim of document.getAnimations()) {
            if (anim.playState === 'running' && anim.constructor && anim.constructor.name !== 'CSSAnimation') {
              try {
                anim.pause();
                runningWaapi.push(anim);
              } catch {}
            }
          }
          if (runningWaapi.length) {
            s.onEnd(() => {
              for (const anim of runningWaapi) {
                try {
                  if (anim.playState === 'paused') anim.play();
                } catch {}
              }
            });
          }
        } catch {}
      }
    }

    // 2. Media handling via s.media
    const seenMedia = new WeakSet();

    const handleMediaElement = (el) => {
      if (!el || (el.tagName !== 'VIDEO' && el.tagName !== 'AUDIO')) return;
      if (seenMedia.has(el)) return;
      seenMedia.add(el);

      const isLoopingMuted = el.hasAttribute('loop') && el.muted;
      const isAuto = el.autoplay || el.hasAttribute('autoplay');
      const isPlaying = !el.paused;

      if (isPlaying || isAuto || isLoopingMuted) {
        s.media.pause(el, { showControls: true });
      }
    };

    if (pauseMediaOpt) {
      for (const m of root.querySelectorAll('video, audio')) {
        handleMediaElement(m);
      }

      // Late play events: if initiated by the person, leave it playing; otherwise pause with controls
      s.listen(
        document,
        'play',
        (e) => {
          const v = e.target;
          if (!v || (v.tagName !== 'VIDEO' && v.tagName !== 'AUDIO')) return;
          if (s.watch.byPerson(v, { withinMs: 1500 })) return;
          if (typeof navigator !== 'undefined' && navigator.userActivation && navigator.userActivation.isActive) return;
          s.media.pause(v, { showControls: true });
        },
        true
      );
    }

    // 3. Marquee elements
    for (const m of root.querySelectorAll('marquee')) {
      try {
        m.stop();
        s.onEnd(() => {
          try { m.start(); } catch {}
        });
      } catch {}
    }

    // 4. Carousels
    const handledCarousels = new WeakSet();

    const findPauseControl = (carousel) => {
      const candidates = [carousel];
      if (carousel.parentElement && carousel.parentElement !== document.body && carousel.parentElement !== document.documentElement) {
        candidates.push(carousel.parentElement);
      }
      const buttons = [];
      for (const c of candidates) {
        buttons.push(...c.querySelectorAll('button, [role="button"], input[type="button"]'));
      }
      for (const btn of buttons) {
        const label = (btn.getAttribute('aria-label') || '').toLowerCase();
        const title = (btn.getAttribute('title') || '').toLowerCase();
        const text = (btn.textContent || '').trim().toLowerCase();
        const cls = (typeof btn.className === 'string' ? btn.className : '').toLowerCase();
        const isPause = (str) => /\b(pause|stop)\b/i.test(str);
        if (isPause(label) || isPause(title) || isPause(text) || isPause(cls)) {
          return btn;
        }
        if (btn.hasAttribute('aria-pressed') && btn.getAttribute('aria-pressed') === 'false' && /play|auto|rotat|slide/i.test(label + ' ' + title + ' ' + text)) {
          return btn;
        }
      }
      return null;
    };

    const handleCarousel = (carousel) => {
      if (!carousel || handledCarousels.has(carousel)) return;
      handledCarousels.add(carousel);

      // Check if carousel has its own pause/stop control
      const pauseBtn = findPauseControl(carousel);
      if (pauseBtn) {
        let userInteracted = false;
        s.listen(carousel, 'pointerdown', () => { userInteracted = true; });
        s.listen(carousel, 'keydown', () => { userInteracted = true; });
        try {
          pauseBtn.click();
        } catch {}

        s.onEnd(() => {
          if (!userInteracted) {
            const label = (pauseBtn.getAttribute('aria-label') || '').toLowerCase();
            const title = (pauseBtn.getAttribute('title') || '').toLowerCase();
            const text = (pauseBtn.textContent || '').trim().toLowerCase();
            const isPlay = (str) => /\b(play|start|resume)\b/i.test(str);
            if (isPlay(label) || isPlay(title) || isPlay(text) || pauseBtn.getAttribute('aria-pressed') === 'true') {
              try { pauseBtn.click(); } catch {}
            }
          }
        });
        return;
      }

      // Otherwise hold the slide shown
      const slideSelector = '[aria-roledescription="slide"], [class*="slide" i], [class*="item" i]';
      let slides = Array.from(carousel.querySelectorAll(slideSelector));
      if (!slides.length && carousel.children.length > 1) {
        slides = Array.from(carousel.children);
      }
      if (!slides.length) return;

      const isActive = (el) => {
        const cls = typeof el.className === 'string' ? el.className.toLowerCase() : '';
        return /\b(active|current|is-active|selected|visible)\b/.test(cls) ||
               el.getAttribute('aria-hidden') === 'false' ||
               el.getAttribute('aria-selected') === 'true';
      };

      let activeSlide = slides.find(isActive) || slides[0];
      let activeClasses = new Set(activeSlide.classList);
      let scrollPos = carousel.scrollLeft; // Measure once per carousel
      let fightCount = 0;
      let givenUp = false;
      let reverting = false;

      s.listen(carousel, 'scroll', () => {
        if (givenUp || reverting) return;
        if (s.watch.byPerson(carousel, { withinMs: 1500 })) {
          scrollPos = carousel.scrollLeft;
          fightCount = 0;
          return;
        }
        fightCount++;
        if (fightCount > 4) {
          givenUp = true;
          return;
        }
        reverting = true;
        try {
          carousel.scrollLeft = scrollPos;
        } catch {}
        reverting = false;
      });

      const observer = new MutationObserver(() => {
        if (givenUp || reverting) return;

        if (s.watch.byPerson(carousel, { withinMs: 1500 })) {
          const nowActive = slides.find(isActive);
          if (nowActive) {
            activeSlide = nowActive;
            activeClasses = new Set(nowActive.classList);
          }
          fightCount = 0;
          return;
        }

        fightCount++;
        if (fightCount > 4) {
          givenUp = true;
          observer.disconnect();
          return;
        }

        reverting = true;
        for (const slide of slides) {
          if (slide === activeSlide) {
            if (!slide.classList.contains('active') && activeClasses.has('active')) slide.classList.add('active');
            if (!slide.classList.contains('is-active') && activeClasses.has('is-active')) slide.classList.add('is-active');
            if (!slide.classList.contains('current') && activeClasses.has('current')) slide.classList.add('current');
            if (slide.hasAttribute('aria-hidden') && slide.getAttribute('aria-hidden') === 'true') {
              slide.setAttribute('aria-hidden', 'false');
            }
          } else {
            slide.classList.remove('active', 'is-active', 'current');
            if (slide.hasAttribute('aria-hidden') && slide.getAttribute('aria-hidden') === 'false') {
              slide.setAttribute('aria-hidden', 'true');
            }
          }
        }
        observer.takeRecords();
        reverting = false;
      });

      observer.observe(carousel, {
        attributes: true,
        attributeFilter: ['class', 'aria-hidden', 'aria-selected', 'hidden'],
        subtree: true,
      });

      s.onEnd(() => observer.disconnect());
    };

    if (stopCarouselsOpt) {
      for (const c of root.querySelectorAll(CAROUSEL_SELECTOR)) {
        handleCarousel(c);
      }
    }

    // 5. Watch for dynamically added media and carousels
    s.watch.added(
      root,
      (el) => {
        if (!el || el.nodeType !== 1) return;
        if (pauseMediaOpt) {
          if (el.tagName === 'VIDEO' || el.tagName === 'AUDIO') {
            handleMediaElement(el);
          } else if (el.querySelectorAll) {
            for (const m of el.querySelectorAll('video, audio')) {
              handleMediaElement(m);
            }
          }
        }
        if (stopCarouselsOpt) {
          if (el.matches && el.matches(CAROUSEL_SELECTOR)) {
            handleCarousel(el);
          } else if (el.querySelectorAll) {
            for (const c of el.querySelectorAll(CAROUSEL_SELECTOR)) {
              handleCarousel(c);
            }
          }
        }
      },
      { selector: `video, audio, ${CAROUSEL_SELECTOR}` }
    );

    s.announce('Page calmed: animations, autoplay and auto-advancing paused.');
    return true;
  },

  disable() {
    this.s?.end();
    this.s = null;
  },
};
