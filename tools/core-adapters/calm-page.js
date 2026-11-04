// calm-page.js — Stops unrequested visual motion: CSS animations, transitions, smooth scrolling,
// autoplaying videos, animated images, auto-advancing carousels, and marquees.
// Barrier: Unrequested motion can trigger vestibular symptoms, dizziness, nausea, migraines,
// or seizures, and distracts or disorients people with cognitive or attention barriers.
//
// Suggested in onboarding for: sensory, cognitive (a suggestion only, never a gate).
// The person's settings it reads: motionReducer.
// What the person can adjust: nothing (the shortcut, if given, turns it on and off).
//
// Options:
//   animations: boolean (default true). End CSS animations in their final state.
//   transitions: boolean (default true). Collapse CSS transition durations to 0.
//   smoothScroll: boolean (default true). Set scroll-behavior to auto.
//   videos: boolean (default true). Pause autoplaying and looping videos via s.media with controls.
//   carousels: boolean (default true). Pause carousels with their own button or hold active slides.
//   marquees: boolean (default true). Stop scrolling marquee elements.
//
// Decisions:
//   • Motion reduction is applied through one injected stylesheet (via s.css) and s.media.
//   • Never pauses CSS animations with animation-play-state (which stops at frame 0); ends them
//     with duration 0s, delay 0s, iteration-count 1, and animation-fill-mode forwards so content
//     stays visible in its final state.
//   • Collapses transition-duration and transition-delay to 0s so state changes apply immediately.
//   • Sets scroll-behavior to auto so smooth scrolling does not cause motion sickness.
//   • Pauses autoplaying and looping videos through s.media.pause(el, { showControls: true }),
//     giving users a visible control to play them.
//   • Reversible: disable() restarts only what was playing when the adapter enabled; anything
//     the person started or touched stays as they left it.
//   • Listens for late-playing media; leaves media playing if the user activated that media or its controls.
//   • Carousels: pauses via their own control only when inside the carousel, named Pause or Stop,
//     button not in a form or submit, and carousel is playing. Restores via Play on disable().
//     A disabled Pause button means the carousel is not playing: leave it.
//   • Scripted carousels without pause buttons: holds active slide state class, changing only track children.
//     If page forces change more than 5 times without user input, ceases holding rather than fight the page.
//   • Measure once: never reads scrollWidth across all elements on the page.
//   • Says nothing on load to avoid noisy screen reader announcements.
//   • If all features are turned off, cleans up and returns false. Explicit options take precedence.
//
// What it cannot do:
//   • Cannot pause animations drawn directly on <canvas> without altering page scripts.
//   • Cannot freeze animated GIF/WebP images without Canvas redraw or SVG replacement (handled via Flash Guard).
//   • Does not halt Web Animations API instances that do not use CSS keyframes.

export default {
  enable(options = {}, toolkit) {
    if (this.s && !this.s.ended) return;
    this.options = options || {};
    this.toolkit = toolkit || this.toolkit;
    if (!this.toolkit) return false;

    const profile = this.toolkit.personal || {};
    const motionReducer = profile.motionReducer === true;

    // Feature toggles: options are separate for animations and transitions
    const resolveOption = (val1, val2) => {
      if (val1 !== undefined) return Boolean(val1);
      if (val2 !== undefined) return Boolean(val2);
      return undefined;
    };

    const optAnimations = resolveOption(this.options.animations, this.options.stopAnimations);
    const optTransitions = resolveOption(this.options.transitions, this.options.stopTransitions);
    const optSmoothScroll = resolveOption(this.options.smoothScroll, this.options.stopSmoothScroll);
    const optVideos = resolveOption(this.options.videos, this.options.pauseVideos);
    const optCarousels = resolveOption(this.options.carousels, this.options.pauseCarousels);
    const optMarquees = resolveOption(this.options.marquees, this.options.stopMarquees);

    // Explicit options take precedence over motionReducer; otherwise fallback to motionReducer or true
    const effectiveAnimations = optAnimations !== undefined ? optAnimations : (motionReducer || true);
    const effectiveTransitions = optTransitions !== undefined ? optTransitions : (motionReducer || true);
    const effectiveSmoothScroll = optSmoothScroll !== undefined ? optSmoothScroll : (motionReducer || true);
    const effectiveVideos = optVideos !== undefined ? optVideos : (motionReducer || true);
    const effectiveCarousels = optCarousels !== undefined ? optCarousels : (motionReducer || true);
    const effectiveMarquees = optMarquees !== undefined ? optMarquees : (motionReducer || true);

    // If every feature is off: nothing to do
    if (!effectiveAnimations && !effectiveTransitions && !effectiveSmoothScroll &&
        !effectiveVideos && !effectiveCarousels && !effectiveMarquees) {
      this.disable();
      return false;
    }

    const s = (this.s = this.toolkit.session());

    // 1. Injected stylesheet: animations, transitions, smooth scrolling
    const cssRules = [];
    if (effectiveAnimations) {
      cssRules.push(
        'body, *:not([data-ai4a11y-ui]):not([data-ai4a11y-ui] *), ' +
        '*:not([data-ai4a11y-ui]):not([data-ai4a11y-ui] *)::before, ' +
        '*:not([data-ai4a11y-ui]):not([data-ai4a11y-ui] *)::after { ' +
        'animation-duration: 0s !important; ' +
        'animation-delay: 0s !important; ' +
        'animation-iteration-count: 1 !important; ' +
        'animation-fill-mode: forwards !important; ' +
        '}'
      );
    }
    if (effectiveTransitions) {
      cssRules.push(
        'body, *:not([data-ai4a11y-ui]):not([data-ai4a11y-ui] *), ' +
        '*:not([data-ai4a11y-ui]):not([data-ai4a11y-ui] *)::before, ' +
        '*:not([data-ai4a11y-ui]):not([data-ai4a11y-ui] *)::after { ' +
        'transition-duration: 0s !important; ' +
        'transition-delay: 0s !important; ' +
        '}'
      );
    }
    if (effectiveSmoothScroll) {
      cssRules.push(
        'html, body, *:not([data-ai4a11y-ui]):not([data-ai4a11y-ui] *) { ' +
        'scroll-behavior: auto !important; ' +
        '}'
      );
    }

    if (cssRules.length > 0) {
      s.css('calm-page', cssRules.join('\n'));
    }

    // Input tracking for user-initiated plays and carousel interactions
    let lastInput = null;
    const userInteractedCarousels = new WeakSet();
    const noteInput = (e) => {
      if (e.isTrusted && e.target) {
        lastInput = { target: e.target, at: Date.now() };
        let el = e.target;
        while (el && el !== document.documentElement) {
          userInteractedCarousels.add(el);
          el = el.parentElement;
        }
      }
    };
    for (const type of ['pointerdown', 'keydown', 'click']) {
      s.listen(document, type, noteInput, true);
    }

    const wasUserActionIn = (container, ms = 1500) => {
      if (!lastInput || !container) return false;
      if (Date.now() - lastInput.at > ms) return false;
      return typeof container.contains === 'function' && container.contains(lastInput.target);
    };

    // 2. Videos and Audio (via s.media)
    if (effectiveVideos) {
      const isControlForMedia = (target, media) => {
        if (!target || !media) return false;
        if (target === media || (typeof media.contains === 'function' && media.contains(target))) return true;
        const btn = target.closest ? target.closest('button, [role="button"], input[type="button"]') : null;
        if (!btn) return false;
        const ariaControls = btn.getAttribute('aria-controls');
        if (media.id && ariaControls && ariaControls.split(/\s+/).includes(media.id)) return true;
        const container = media.closest ? media.closest('figure, [role="region"], [class*="player"], [class*="video"]') : null;
        if (container && container.contains(btn) && container !== document.body && container !== document.documentElement) {
          return true;
        }
        const parent = media.parentElement;
        if (parent && parent.contains(btn) && parent !== document.body && parent !== document.documentElement) {
          const btnName = (s.page?.nameOf?.(btn) || btn.getAttribute('aria-label') || btn.textContent || '').trim();
          if (/\b(play|pause|stop|mute|unmute|video|audio|media|track)\b/i.test(btnName)) {
            return true;
          }
        }
        return false;
      };

      const isPersonInputOnMedia = (media) => {
        if (s.watch && typeof s.watch.byPerson === 'function' && s.watch.byPerson(media, { withinMs: 1500 })) {
          return true;
        }
        if (lastInput && Date.now() - lastInput.at < 1500) {
          if (isControlForMedia(lastInput.target, media)) return true;
        }
        return false;
      };

      const handleMedia = (el) => {
        if (!el || (el.tagName !== 'VIDEO' && el.tagName !== 'AUDIO')) return;
        try {
          s.media.pause(el, { showControls: true });
        } catch {}
      };

      const root = document.body || document.documentElement;
      if (root) {
        for (const el of root.querySelectorAll('video, audio')) {
          handleMedia(el);
        }
        if (s.watch && typeof s.watch.added === 'function') {
          s.watch.added(root, (el) => handleMedia(el), { selector: 'video, audio' });
        }
      }

      // Late play listener: pauses late autoplays/scripted plays, leaves user plays alone
      s.listen(document, 'play', (e) => {
        const el = e.target;
        if (!el || (el.tagName !== 'VIDEO' && el.tagName !== 'AUDIO')) return;
        if (isPersonInputOnMedia(el)) return;
        try {
          s.media.pause(el, { showControls: true });
        } catch {}
      }, true);
    }

    // 3. Marquees
    if (effectiveMarquees) {
      const stoppedMarquees = new Set();
      const handleMarquee = (m) => {
        if (!m || stoppedMarquees.has(m) || typeof m.stop !== 'function') return;
        try {
          m.stop();
          stoppedMarquees.add(m);
        } catch {}
      };

      const root = document.body || document.documentElement;
      if (root) {
        for (const m of root.querySelectorAll('marquee')) {
          handleMarquee(m);
        }
        if (s.watch && typeof s.watch.added === 'function') {
          s.watch.added(root, (m) => handleMarquee(m), { selector: 'marquee' });
        }
      }

      s.onEnd(() => {
        for (const m of stoppedMarquees) {
          try {
            if (typeof m.start === 'function') m.start();
          } catch {}
        }
      });
    }

    // 4. Carousels
    if (effectiveCarousels) {
      const pausedCarousels = [];
      const handledCarousels = new WeakSet();

      const STATE_TOKEN_RE = /^(active|current|is-active|is-current|selected|is-selected|visible|show)$/i;

      const holdCarouselSlides = (carousel) => {
        const candidates = [carousel, ...carousel.querySelectorAll('[class*="track"], [class*="slides"], [class*="list"], div, ul')];
        let track = null;
        let slides = [];
        let stateClass = null;
        let initialActiveSlide = null;

        for (const cand of candidates) {
          const children = Array.from(cand.children).filter((el) => el.nodeType === 1);
          if (children.length < 2) continue;
          const hasSlideAttrs = children.some((el) => {
            const role = (el.getAttribute('role') || '').toLowerCase();
            const roledescription = (el.getAttribute('aria-roledescription') || '').toLowerCase();
            const cls = el.getAttribute('class') || '';
            return roledescription === 'slide' || role === 'tabpanel' || role === 'group' || /\bslide\b/i.test(cls);
          });
          if (!hasSlideAttrs) continue;

          for (const child of children) {
            const cls = child.getAttribute('class') || '';
            const tokens = cls.split(/\s+/).filter(Boolean);
            const found = tokens.find((t) => STATE_TOKEN_RE.test(t));
            if (found) {
              stateClass = found;
              initialActiveSlide = child;
              break;
            }
          }

          if (initialActiveSlide) {
            track = cand;
            slides = children;
            break;
          }
        }

        if (!track || !initialActiveSlide || !stateClass) return;

        let heldSlide = initialActiveSlide;
        let revertCount = 0;
        const MAX_REVERTS = 5;
        let stoppedHolding = false;
        let isOurUpdate = false;

        const observer = new MutationObserver(() => {
          if (stoppedHolding || isOurUpdate) return;

          // Check if person recently interacted inside this carousel
          if (wasUserActionIn(carousel, 1500)) {
            for (const sld of slides) {
              const cls = sld.getAttribute('class') || '';
              const tokens = cls.split(/\s+/).filter(Boolean);
              if (tokens.includes(stateClass)) {
                heldSlide = sld;
                revertCount = 0;
                break;
              }
            }
            return;
          }

          // Automated page advance: check if active slide changed away from heldSlide
          const currentActive = slides.find((sld) => {
            const cls = sld.getAttribute('class') || '';
            return cls.split(/\s+/).filter(Boolean).includes(stateClass);
          });

          if (currentActive && currentActive !== heldSlide) {
            if (revertCount >= MAX_REVERTS) {
              stoppedHolding = true;
              observer.disconnect();
              return;
            }
            revertCount++;

            isOurUpdate = true;
            try {
              for (const sld of slides) {
                const cls = sld.getAttribute('class') || '';
                const tokens = new Set(cls.split(/\s+/).filter(Boolean));
                if (sld === heldSlide) {
                  if (!tokens.has(stateClass)) {
                    tokens.add(stateClass);
                    s.setAttr(sld, 'class', Array.from(tokens).join(' '));
                  }
                } else {
                  if (tokens.has(stateClass)) {
                    tokens.delete(stateClass);
                    s.setAttr(sld, 'class', Array.from(tokens).join(' '));
                  }
                }
              }
            } finally {
              observer.takeRecords();
              isOurUpdate = false;
            }
          }
        });

        observer.observe(track, {
          attributes: true,
          attributeFilter: ['class'],
          subtree: true,
        });

        s.onEnd(() => {
          observer.disconnect();
        });
      };

      const processCarousel = (carousel) => {
        if (!carousel || handledCarousels.has(carousel)) return;
        let parent = carousel.parentElement;
        while (parent && parent !== document.documentElement) {
          if (handledCarousels.has(parent)) return;
          parent = parent.parentElement;
        }
        handledCarousels.add(carousel);

        // Find own pause/stop control
        const buttons = carousel.querySelectorAll('button, [role="button"], input[type="button"]');
        let pauseButton = null;

        for (const btn of buttons) {
          if (btn.closest('form')) continue;
          if (btn.tagName === 'BUTTON' && btn.getAttribute('type')?.toLowerCase() === 'submit') continue;
          if (btn.tagName === 'INPUT' && (btn.type === 'submit' || btn.type === 'image')) continue;

          const name = (s.page?.nameOf?.(btn) || btn.getAttribute('aria-label') || btn.textContent || '').trim();
          if (!/\b(pause|stop)\b/i.test(name)) continue;

          const isDisabled = btn.disabled || btn.getAttribute('aria-disabled') === 'true';
          if (isDisabled) {
            // A disabled Pause button means the carousel is not playing: leave it.
            return;
          }

          const pressed = btn.getAttribute('aria-pressed');
          if (pressed === 'true') continue;

          pauseButton = btn;
          break;
        }

        if (pauseButton) {
          try {
            pauseButton.click();
            pausedCarousels.push({ carousel, button: pauseButton });
          } catch {}
          return;
        }

        // Script-driven carousel without pause button
        holdCarouselSlides(carousel);
      };

      const findAndProcessCarousels = (root) => {
        if (!root) return;
        const list = [];
        const selector = '[aria-roledescription="carousel" i], [role="region"], [role="group"], section, div';
        const candidates = [
          ...(root.matches?.(selector) ? [root] : []),
          ...root.querySelectorAll(selector),
        ];
        for (const el of candidates) {
          const roledescription = (el.getAttribute('aria-roledescription') || '').toLowerCase();
          if (roledescription === 'carousel') {
            list.push(el);
            continue;
          }
          const role = (el.getAttribute('role') || '').toLowerCase();
          const tag = el.tagName.toLowerCase();
          if (role === 'region' || role === 'group' || tag === 'section' || tag === 'div') {
            const name = (s.page?.nameOf?.(el) || el.getAttribute('aria-label') || '').toLowerCase();
            if (/\b(carousel|slideshow)\b/i.test(name)) {
              if (!el.querySelector('[aria-roledescription="carousel" i]')) {
                list.push(el);
              }
            }
          }
        }
        const outermost = list.filter((c) => !list.some((other) => other !== c && other.contains(c)));
        for (const c of outermost) {
          processCarousel(c);
        }
      };

      const root = document.body || document.documentElement;
      if (root) {
        findAndProcessCarousels(root);
        if (s.watch && typeof s.watch.added === 'function') {
          s.watch.added(root, (nodes) => {
            const list = Array.isArray(nodes) ? nodes : [nodes];
            for (const el of list) {
              if (el && el.nodeType === 1) findAndProcessCarousels(el);
            }
          });
        }
      }

      // Restore paused carousels on disable
      s.onEnd(() => {
        for (const { carousel, button } of pausedCarousels) {
          if (!carousel.isConnected) continue;
          if (userInteractedCarousels.has(carousel)) continue;

          const currentName = (s.page?.nameOf?.(button) || button.getAttribute('aria-label') || button.textContent || '').trim();
          const pressed = button.getAttribute('aria-pressed');
          if (/\bplay\b/i.test(currentName) || pressed === 'true') {
            try { button.click(); } catch {}
            continue;
          }
          const playBtn = Array.from(carousel.querySelectorAll('button, [role="button"], input[type="button"]')).find((b) => {
            if (b.closest('form')) return false;
            if (b.tagName === 'BUTTON' && b.getAttribute('type')?.toLowerCase() === 'submit') return false;
            if (b.tagName === 'INPUT' && (b.type === 'submit' || b.type === 'image')) return false;
            if (b.disabled || b.getAttribute('aria-disabled') === 'true') return false;
            const n = (s.page?.nameOf?.(b) || b.getAttribute('aria-label') || b.textContent || '').trim();
            return /\bplay\b/i.test(n);
          });
          if (playBtn) {
            try { playBtn.click(); } catch {}
          }
        }
      });
    }
  },

  disable() {
    this.s?.end();
    this.s = null;
  },
};
