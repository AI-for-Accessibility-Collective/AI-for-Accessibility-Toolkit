// calm-page.js — Stops animations, smooth scrolling, autoplaying media, carousels, and marquees.
// Barrier: People with vestibular disorders, photosensitive epilepsy, motion sensitivity,
// or cognitive/attention impairments experience dizziness, nausea, distraction, or loss
// of position when content moves, scrolls, loops, or advances on its own (WCAG 2.2.2, 2.3.1).
//
// Suggested in onboarding for: sensory, cognitive (a suggestion only, never a gate).
// The person's settings it reads: motionReducer.
// What the person can adjust: nothing (the shortcut, if given, turns it on and off).
//
// Options:
//   stopAnimations: boolean, stops CSS animations and transitions (defaults to true).
//   pauseVideos: boolean, pauses autoplaying and looping videos with controls (defaults to true).
//   stopCarousels: boolean, pauses auto-advancing carousels and keeps controls (defaults to true).
//   stopMarquees: boolean, halts marquee elements and scrolling tickers (defaults to true).
//
// Decisions:
//   • Injects one stylesheet (s.css) setting animation-duration: 0s !important,
//     animation-delay: 0s !important, animation-iteration-count: 1 !important,
//     animation-fill-mode: both !important, transition-duration: 0s !important,
//     transition-delay: 0s !important, and scroll-behavior: auto !important.
//   • Guarantees content hidden by an animation start state stays visible in its final state.
//   • Pauses autoplaying, playing, and muted looping videos via s.media.pause(v, { showControls: true }),
//     adding native controls so the person has a visible way to play them.
//   • Never touches videos that the person starts or plays after enable().
//   • On disable(), restarts only what was playing before enable(); anything the person
//     played or started stays as they left it.
//   • For carousels: uses the carousel's own pause or stop button when present (WCAG 2.2.2).
//     Clicks the control ONLY when:
//       1) It is inside the carousel (aria-roledescription="carousel", or a region/group
//          whose accessible name contains "carousel" or "slideshow").
//       2) Its accessible name contains "pause" or "stop" (never by class name).
//       3) It is a button, not a submit button, and not inside a form.
//       4) The carousel is playing (accessible name or aria-pressed indicates playing).
//     Never clicks any button outside a carousel, even if named Stop or Pause.
//   • If a carousel has no pause control: holds the shown slide by keeping only the track's
//     direct children (slides) in their current state; never changes other elements' classes.
//     If the page script fights back more than 3 times, stops holding rather than fight the page.
//   • Measure once: never reads the scroll width of every element on the page.
//   • Stops running <marquee> elements via .stop() and restarts them on disable() via .start().
//   • Says nothing on load: no announcements are made so screen readers remain uninterrupted.
//
// What it cannot do:
//   • Cannot pause frame-by-frame animations rendered entirely inside an inaccessible HTML5
//     <canvas> or WebGL canvas that does not expose external playback controls.
//   • Cannot intercept background network refreshes or server-sent data updates that modify DOM
//     without triggering standard motion or media APIs.

export default {
  enable(options = {}, toolkit) {
    if (this.s && !this.s.ended) return;
    this.options = options || {};
    this.toolkit = toolkit || this.toolkit;
    if (!this.toolkit) return false;

    const doc = document;
    if (!doc || (!doc.body && !doc.documentElement)) return false;

    const s = (this.s = this.toolkit.session());

    // Respect person's profile setting: if motionReducer is set, motion reduction is forced.
    const motionReducerPref = s.profile.get('motionReducer');

    // Options (defaults all true unless explicitly disabled and motionReducer not set)
    const stopAnimations = motionReducerPref || this.options.stopAnimations !== false;
    const pauseVideos = this.options.pauseVideos !== false;
    const stopCarousels = this.options.stopCarousels !== false;
    const stopMarquees = this.options.stopMarquees !== false;

    // 1. One stylesheet for CSS animations, transitions, smooth scrolling, and carousels
    if (stopAnimations) {
      const cssRules = `
*, *::before, *::after {
  animation-duration: 0s !important;
  animation-delay: 0s !important;
  animation-iteration-count: 1 !important;
  animation-fill-mode: both !important;
  transition-duration: 0s !important;
  transition-delay: 0s !important;
  scroll-behavior: auto !important;
}
html {
  scroll-behavior: auto !important;
}
[class*="carousel" i], [class*="slider" i], [class*="rotat" i], [class*="ticker" i], [class*="marquee" i], [aria-roledescription="carousel" i],
[class*="carousel" i] *, [class*="slider" i] *, [class*="rotat" i] *, [class*="ticker" i] *, [class*="marquee" i] *, [aria-roledescription="carousel" i] * {
  animation-play-state: paused !important;
}
marquee {
  overflow: hidden !important;
}
`;
      s.css('calm-page', cssRules);

      // Finish or pause WAAPI animations so content hidden at start reaches final state
      try {
        if (typeof doc.getAnimations === 'function') {
          for (const anim of doc.getAnimations()) {
            try {
              if (anim.playState === 'running') {
                const timing = anim.effect?.getTiming?.();
                if (timing && timing.iterations === Infinity) {
                  anim.pause();
                  s.onEnd(() => {
                    try { if (anim.playState === 'paused') anim.play(); } catch {}
                  });
                } else {
                  anim.finish();
                }
              }
            } catch {
              try { anim.pause(); } catch {}
            }
          }
        }
      } catch {}
    }

    // 2. Videos and media
    if (pauseVideos) {
      const handleMedia = (el) => {
        if (!el || (el.tagName !== 'VIDEO' && el.tagName !== 'AUDIO')) return;
        const isAutoplayingOrPlaying = !el.paused || el.autoplay || el.hasAttribute('autoplay') || el.loop;
        if (isAutoplayingOrPlaying) {
          s.media.pause(el, { showControls: true });
        }
      };

      for (const el of doc.querySelectorAll('video, audio')) {
        handleMedia(el);
      }

      // Watch for added media
      s.watch.added(
        doc.body || doc.documentElement,
        (el) => {
          if (el.tagName === 'VIDEO' || el.tagName === 'AUDIO') {
            handleMedia(el);
          } else if (el.querySelectorAll) {
            for (const v of el.querySelectorAll('video, audio')) handleMedia(v);
          }
        },
        { selector: 'video, audio' }
      );

      // Catch media that starts playing later without user interaction
      s.listen(doc, 'play', (e) => {
        const v = e.target;
        if (!v || (v.tagName !== 'VIDEO' && v.tagName !== 'AUDIO')) return;
        if (s.watch.byPerson(v, { withinMs: 1500 }) || s.watch.byPerson(doc.body, { withinMs: 1500 })) return;
        handleMedia(v);
      }, true);
    }

    // 3. Marquees
    if (stopMarquees) {
      const handleMarquee = (m) => {
        if (!m || m.tagName !== 'MARQUEE') return;
        try {
          if (typeof m.stop === 'function') {
            m.stop();
            s.onEnd(() => { try { m.start(); } catch {} });
          }
        } catch {}
      };

      for (const m of doc.querySelectorAll('marquee')) {
        handleMarquee(m);
      }

      s.watch.added(
        doc.body || doc.documentElement,
        (el) => {
          if (el.tagName === 'MARQUEE') handleMarquee(el);
          else if (el.querySelectorAll) {
            for (const m of el.querySelectorAll('marquee')) handleMarquee(m);
          }
        },
        { selector: 'marquee' }
      );
    }

    // 4. Carousels
    if (stopCarousels) {
      // Find enclosing carousel container for a control
      const findEnclosingCarousel = (el) => {
        let curr = el.parentElement;
        while (curr && curr !== doc.body && curr !== doc.documentElement) {
          const roleDesc = (curr.getAttribute('aria-roledescription') || '').toLowerCase();
          if (roleDesc === 'carousel') return curr;
          const role = (curr.getAttribute('role') || '').toLowerCase();
          if (role === 'region' || role === 'group') {
            const name = (s.page.nameOf(curr) || curr.getAttribute('aria-label') || '').toLowerCase();
            if (/carousel|slideshow/i.test(name)) return curr;
          }
          curr = curr.parentElement;
        }
        return null;
      };

      // Gather candidate carousels
      const carousels = new Set();
      for (const c of doc.querySelectorAll('[aria-roledescription="carousel" i]')) {
        carousels.add(c);
      }
      for (const r of doc.querySelectorAll('[role="region" i], [role="group" i]')) {
        const name = (s.page.nameOf(r) || r.getAttribute('aria-label') || '').toLowerCase();
        if (/carousel|slideshow/i.test(name)) carousels.add(r);
      }
      for (const c of doc.querySelectorAll('[class*="carousel" i], [class*="swiper" i], [class*="slick" i]')) {
        carousels.add(c);
      }

      const handledCarousels = new WeakSet();

      const handleCarousel = (carousel) => {
        if (!carousel || handledCarousels.has(carousel)) return;
        handledCarousels.add(carousel);

        // Check if this carousel qualifies for clicking its own pause/stop control
        const isQualifiedCarousel = (() => {
          const roleDesc = (carousel.getAttribute('aria-roledescription') || '').toLowerCase();
          if (roleDesc === 'carousel') return true;
          const role = (carousel.getAttribute('role') || (carousel.tagName === 'SECTION' ? 'region' : '')).toLowerCase();
          if (role === 'region' || role === 'group') {
            const name = (s.page.nameOf(carousel) || carousel.getAttribute('aria-label') || '').toLowerCase();
            return /carousel|slideshow/i.test(name);
          }
          return false;
        })();

        let pauseBtn = null;
        if (isQualifiedCarousel) {
          const buttons = carousel.querySelectorAll('button, [role="button"]');
          for (const btn of buttons) {
            // Must be inside the carousel
            if (findEnclosingCarousel(btn) !== carousel && !carousel.contains(btn)) continue;
            // Must be a button
            const isBtn = btn.tagName === 'BUTTON' || btn.getAttribute('role') === 'button';
            if (!isBtn) continue;
            // Must not be a submit button and not in a form
            if (btn.closest('form') || btn.form) continue;
            if ((btn.getAttribute('type') || '').toLowerCase() === 'submit') continue;
            // Accessible name says pause or stop (not its class)
            const btnName = (s.page.nameOf(btn) || btn.getAttribute('aria-label') || btn.innerText || btn.textContent || '').trim();
            if (!/\b(pause|stop)\b/i.test(btnName)) continue;
            // Carousel is playing (its name or aria-pressed says so)
            if (btn.getAttribute('aria-pressed') === 'true') continue;

            pauseBtn = btn;
            break;
          }
        }

        if (pauseBtn) {
          // WCAG 2.2.2: Use its own pause control
          let userTouched = false;
          const markTouch = () => {
            if (s.watch.byPerson(carousel, { withinMs: 1500 })) userTouched = true;
          };
          s.listen(carousel, 'click', markTouch);
          s.listen(carousel, 'keydown', markTouch);

          try {
            pauseBtn.click();
          } catch {}

          // On disable: restart only what was playing
          s.onEnd(() => {
            if (!userTouched && pauseBtn && pauseBtn.isConnected) {
              try { pauseBtn.click(); } catch {}
            }
          });
        } else {
          // Otherwise hold the slide shown
          holdSlides(carousel);
        }
      };

      const holdSlides = (carousel) => {
        const findTrack = () => {
          const candidates = [
            ...carousel.querySelectorAll('[class*="track" i], [class*="slides" i], ul, ol, div'),
            carousel,
          ];
          for (const c of candidates) {
            const children = Array.from(c.children);
            if (children.length >= 2 && children.every(ch =>
              ch.getAttribute('aria-roledescription') === 'slide' ||
              ch.getAttribute('role') === 'group' ||
              /\bslide\b/i.test(ch.className || '') ||
              ch.classList.contains('slide')
            )) {
              return c;
            }
          }
          // Fallback: look for container with 2+ slide-like children
          for (const c of candidates) {
            const children = Array.from(c.children);
            if (children.length >= 2 && children.some(ch =>
              ch.getAttribute('aria-roledescription') === 'slide' ||
              ch.classList.contains('slide')
            )) {
              return c;
            }
          }
          return null;
        };

        const track = findTrack();
        if (!track) return;

        const findActive = () => {
          const currentSlides = Array.from(track.children);
          const byClass = currentSlides.find(s => /\b(active|is-active|current|selected|visible|show)\b/i.test(s.className || ''));
          if (byClass) return byClass;
          const byAria = currentSlides.find(s => s.getAttribute('aria-hidden') === 'false' || s.getAttribute('aria-selected') === 'true');
          if (byAria) return byAria;
          const byDisplay = currentSlides.find(s => s.style.display && s.style.display !== 'none');
          if (byDisplay) return byDisplay;
          return currentSlides[0];
        };

        let heldSlide = findActive();
        let fights = 0;
        let stopped = false;

        const mo = new MutationObserver(() => {
          if (!s.alive() || stopped) return;

          // If the person just interacted with the carousel, accept their slide change
          if (s.watch.byPerson(carousel, { withinMs: 1500 })) {
            heldSlide = findActive();
            fights = 0;
            return;
          }

          const currentActive = findActive();
          if (currentActive && currentActive !== heldSlide) {
            fights++;
            if (fights > 3) {
              // Stop holding rather than fight the page
              stopped = true;
              mo.disconnect();
              return;
            }

            // Revert state: change ONLY the slides (track's own children), never another element
            mo.disconnect();
            try {
              // Revert classes
              const activeTokens = (currentActive.className || '').split(/\s+/).filter(Boolean);
              const heldTokens = (heldSlide.className || '').split(/\s+/).filter(Boolean);
              for (const token of activeTokens) {
                if (/\b(active|is-active|current|selected|visible|show)\b/i.test(token) || (!heldTokens.includes(token) && !token.startsWith('ai4a11y-'))) {
                  currentActive.classList.remove(token);
                  heldSlide.classList.add(token);
                }
              }

              // Revert aria-hidden
              if (currentActive.getAttribute('aria-hidden') === 'false' && heldSlide.getAttribute('aria-hidden') === 'true') {
                currentActive.setAttribute('aria-hidden', 'true');
                heldSlide.setAttribute('aria-hidden', 'false');
              }

              // Revert aria-selected
              if (currentActive.getAttribute('aria-selected') === 'true' && heldSlide.getAttribute('aria-selected') === 'false') {
                currentActive.setAttribute('aria-selected', 'false');
                heldSlide.setAttribute('aria-selected', 'true');
              }

              // Revert display
              if (currentActive.style.display && currentActive.style.display !== 'none' && heldSlide.style.display === 'none') {
                currentActive.style.display = 'none';
                heldSlide.style.display = '';
              }
            } finally {
              if (!stopped && s.alive()) {
                mo.observe(track, {
                  attributes: true,
                  attributeFilter: ['class', 'style', 'aria-hidden', 'aria-selected'],
                  subtree: true,
                });
              }
            }
          }
        });

        mo.observe(track, {
          attributes: true,
          attributeFilter: ['class', 'style', 'aria-hidden', 'aria-selected'],
          subtree: true,
        });

        s.onEnd(() => mo.disconnect());
      };

      for (const carousel of carousels) {
        handleCarousel(carousel);
      }

      s.watch.added(
        doc.body || doc.documentElement,
        (el) => {
          if (!el) return;
          const roleDesc = (el.getAttribute?.('aria-roledescription') || '').toLowerCase();
          if (roleDesc === 'carousel') handleCarousel(el);
          else if (el.querySelectorAll) {
            for (const c of el.querySelectorAll('[aria-roledescription="carousel" i]')) handleCarousel(c);
          }
        },
        { selector: '[aria-roledescription="carousel" i], [class*="carousel" i]' }
      );
    }
  },

  disable() {
    this.s?.end();
    this.s = null;
  },
};
