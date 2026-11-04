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
//     button not in a form or submit, and carousel is playing. Its own controls are the buttons
//     that are not inside one of its slides, or that name the carousel or its slides in
//     aria-controls (s.page.ownControls): a slide's "Play trailer" or "Pause audio" is the slide's.
//     On disable(), restarts with its own separate Play button, or else the same button when it
//     toggled (its name or aria-pressed changed since the click).
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
          const btnName = (s.page?.nameOf?.(btn) || btn.getAttribute('aria-label') || btn.textContent || '').trim();
          if (/\b(play|pause|stop|mute|unmute|video|audio|media|track)\b/i.test(btnName)) {
            return true;
          }
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
      const BUTTONS = 'button, [role="button"], input[type="button"]';
      const tokensOf = (el) => (el.getAttribute('class') || '').split(/\s+/).filter(Boolean);
      const nameOf = (el) => (s.page.nameOf(el) || '').trim();
      const isDisabled = (el) => el.disabled === true || el.getAttribute('aria-disabled') === 'true';
      const stateOf = (el) => ({ name: nameOf(el), pressed: el.getAttribute('aria-pressed') });

      // The carousel's slides. Where the page marks them (aria-roledescription
      // "slide", tab panels), the track is their parent; where it marks none,
      // the first element whose children look like slides (role group, or a
      // "slide" class). The slides are the track's own children, and the one
      // shown carries a state class. Without such a track, the slides are the
      // marked ones only (maybe none).
      const findSlides = (carousel) => {
        const marked = s.page.widgetParts(carousel);
        const tracks = marked.length
          ? [...new Set(marked.map((el) => el.parentElement).filter(Boolean))]
          : [carousel, ...carousel.querySelectorAll('[class*="track"], [class*="slides"], [class*="list"], div, ul')];
        for (const cand of tracks) {
          const children = Array.from(cand.children);
          if (children.length < 2) continue;
          if (!marked.length && !children.some((el) => {
            const role = (el.getAttribute('role') || '').toLowerCase();
            return role === 'group' || /\bslide\b/i.test(el.getAttribute('class') || '');
          })) continue;
          for (const child of children) {
            const stateClass = tokensOf(child).find((t) => STATE_TOKEN_RE.test(t));
            if (stateClass) return { track: cand, slides: children, stateClass, active: child };
          }
        }
        return { track: null, slides: marked };
      };

      // The carousel's own buttons (its pause, play, next), not those inside
      // its slides ("Play trailer", "Pause audio"): from aria-controls and
      // where they sit (s.page.ownControls), never from what they say. Of
      // those, only buttons that are not submit buttons and not in a form.
      const ownButtons = (carousel, slides) => s.page.ownControls(carousel, { parts: slides, selector: BUTTONS }).filter((btn) => {
        if (btn.closest('form')) return false;
        if (btn.tagName === 'BUTTON' && btn.getAttribute('type')?.toLowerCase() === 'submit') return false;
        if (btn.tagName === 'INPUT' && (btn.type === 'submit' || btn.type === 'image')) return false;
        return true;
      });

      const holdCarouselSlides = (carousel, { track, slides, stateClass, active }) => {
        let heldSlide = active;
        let revertCount = 0;
        const MAX_REVERTS = 5;
        let stoppedHolding = false;
        let isOurUpdate = false;
        const shown = () => slides.find((sld) => tokensOf(sld).includes(stateClass));

        const observer = new MutationObserver(() => {
          if (stoppedHolding || isOurUpdate) return;

          // Check if person recently interacted inside this carousel
          if (wasUserActionIn(carousel, 1500)) {
            const current = shown();
            if (current) {
              heldSlide = current;
              revertCount = 0;
            }
            return;
          }

          // Automated page advance: check if active slide changed away from heldSlide
          const currentActive = shown();

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
                const tokens = new Set(tokensOf(sld));
                if (sld === heldSlide) {
                  if (!tokens.has(stateClass)) {
                    tokens.add(stateClass);
                    s.setAttr(sld, 'class', Array.from(tokens).join(' '));
                  }
                } else if (tokens.has(stateClass)) {
                  tokens.delete(stateClass);
                  s.setAttr(sld, 'class', Array.from(tokens).join(' '));
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

        const found = findSlides(carousel);
        let pauseButton = null;
        let hasPlayButton = false;

        // Its own pause or stop control, and whether it says the carousel plays.
        for (const btn of ownButtons(carousel, found.slides)) {
          const disabled = isDisabled(btn);
          const name = nameOf(btn);

          if (/\b(pause|stop)\b/i.test(name)) {
            // A disabled Pause button, or one pressed already, means the
            // carousel is not playing: leave it.
            if (disabled || btn.getAttribute('aria-pressed') === 'true') return;
            if (!pauseButton) pauseButton = btn;
          } else if (/\bplay\b/i.test(name) && !disabled) {
            hasPlayButton = true;
          }
        }

        if (pauseButton) {
          const before = stateOf(pauseButton);
          try {
            pauseButton.click();
            pausedCarousels.push({ carousel, button: pauseButton, before });
          } catch {}
          return;
        }

        // Carousel currently stopped/paused with its own Play button: leave it alone.
        if (hasPlayButton) return;

        // Script-driven carousel without pause button
        if (found.track) holdCarouselSlides(carousel, found);
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


      // Restore paused carousels on disable: with the carousel's own separate
      // Play button, or else the same button when it toggles (it says
      // something else since it was clicked: its name or aria-pressed).
      s.onEnd(() => {
        for (const { carousel, button, before } of pausedCarousels) {
          if (!carousel.isConnected) continue;
          if (userInteractedCarousels.has(carousel)) continue;

          const playBtn = ownButtons(carousel, findSlides(carousel).slides)
            .find((b) => b !== button && !isDisabled(b) && /\bplay\b/i.test(nameOf(b)));
          if (playBtn) {
            try { playBtn.click(); } catch {}
            continue;
          }

          const now = stateOf(button);
          if (button.isConnected && !isDisabled(button) && (now.name !== before.name || now.pressed !== before.pressed)) {
            try { button.click(); } catch {}
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
