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
//   carousels: boolean (default true). Pause carousels with their own button or hold their slides.
//   marquees: boolean (default true). Stop scrolling marquee elements.
//   ai: boolean (default true). Whether to ask the toolkit's model where the page does not say (below).
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
//   • Late plays: leaves media playing when the person started it: input on the media element
//     itself, or on a button that names it in aria-controls. Where the person pressed a button
//     near it that does not say what it controls, only its name could tell, so the adapter asks
//     the model which of the buttons near it plays or pauses it (once per media element), and
//     leaves it playing only when that is the button pressed. It plays while the model answers;
//     with no answer, or no model, it is paused (as any play the person did not start).
//   • Carousels are what the page marks as one (aria-roledescription "carousel"), or what moves
//     by itself: a class that leaves one of a set of siblings and lands on another while nobody
//     is using the page (no click, key, tap, wheel, scroll or pointer movement for 1.5 s). That
//     alone is not a slideshow (live prices, a list following a song also move), so the adapter
//     asks the model whether it is one (once per moving set), with the part around it; only a yes
//     makes it a carousel. Names ("carousel", "slideshow") decide nothing.
//   • A carousel's own buttons are those not inside one of its slides, or that name the carousel
//     or its slides in aria-controls (s.page.ownControls), and not in a form or submit buttons.
//     Which of them pauses it only their names can tell, so the adapter asks the model (once per
//     carousel and set of buttons): the buttons (those it would see as the same, as a toggle
//     repeated in each slide, once), and "it is paused already". It presses only the
//     button chosen, and only when that button is enabled and not pressed (aria-pressed "true"); a
//     chosen button that is disabled or pressed, or "paused already", means it is not playing:
//     it is left alone. When the carousel has other buttons, it then asks which of them starts it
//     again, for disable(). With no answer, or no model, it presses nothing and holds the slides.
//   • disable() restarts a paused carousel with the button the model said starts it, or else the
//     same button when the page shows it toggled (its name or aria-pressed changed since the
//     click), unless the person used the carousel since.
//   • Holding slides: the slides are the children of the element holding the slides the page
//     marks (aria-roledescription "slide", tab panels), or of the element whose children a class
//     moved between by itself. The classes that say which are shown are those some slides carry
//     and others do not; the hold keeps them on exactly the slides that carried them, changing
//     only the slides' classes. Each advance of the page is held. If the page undoes the hold
//     within 50 ms of our write 5 times in a row (it reacts to our write), ceases holding rather
//     than fight the page. A carousel the person used while it was still, and that then moves by
//     itself, the person started: it is not held.
//   • A carousel whose button was pressed and that still moves by itself 0.5 s later, with no
//     input, did not stop: its slides are held.
//   • Measure once: never reads scrollWidth across all elements on the page.
//   • Says nothing on load to avoid noisy screen reader announcements.
//   • If all features are turned off, cleans up and returns false. Explicit options take precedence.
//   • enable() returns a promise only while it waits on the model for the carousels it found on
//     load; slides may move meanwhile.
//
// What it cannot do:
//   • Cannot pause animations drawn directly on <canvas> without altering page scripts.
//   • Cannot freeze animated GIF/WebP images without Canvas redraw or SVG replacement (handled via Flash Guard).
//   • Does not halt Web Animations API instances that do not use CSS keyframes.
//   • Does not hold slides the page moves by style or transform alone, without a class.
//   • A carousel that moves by itself is found only once it moves (and the model says it is one).

// The questions it asks the model (s.ai.choose). Fixed text: what the page shows is in the options.
const PAUSE_Q = 'Which of these buttons pauses or stops this slideshow from moving on by itself? If it is paused or stopped already, choose the option that says so.';
const RESTART_Q = 'The adapter pressed one of these buttons to pause this slideshow. Which of them starts it moving on by itself again?';
const REGION_Q = 'This part of the page changed which of its items it shows, by itself, while nobody was using the page. Is it a slideshow or carousel that moves on by itself?';
const MEDIA_Q = 'A video or sound on the page started playing just after a button near it was pressed. Which of these buttons plays or pauses that video or sound?';
const STOPPED = { value: 'stopped', about: 'None of the buttons: the slideshow is paused or stopped already. Its button offers to play or start it, or its pause button is pressed or disabled.' };
const IS_SLIDESHOW = { value: true, about: 'Yes: a slideshow or carousel. It shows one or a few items at a time (pictures, offers, stories, quotes) and moves on to the next by itself.' };
const NOT_SLIDESHOW = { value: false, about: 'No: something else that changes by itself, such as live data (prices, scores, times), a progress or status indicator, a menu, or words highlighted as audio or video plays.' };
const MAX_ASKS = 16;         // questions per page load
const MAX_REGION_ASKS = 4;   // of them, about parts that move by themselves
const IDLE_MS = 1500;        // nobody used the page for this long: a change is the page's own
const PRESS_GRACE_MS = 500;  // after our press, the page may finish the move it started

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

    const BUTTONS = 'button, [role="button"], input[type="button"]';
    const nameOf = (el) => (s.page.nameOf(el) || '').trim();
    const isDisabled = (el) => el.disabled === true || el.getAttribute('aria-disabled') === 'true';

    // Input tracking for user-initiated plays and carousel interactions
    let lastInput = null;
    let lastActivity = 0;
    const carouselStates = new Map(); // carousel → its state, this session (section 4)
    const noteInput = (e) => {
      if (!e.isTrusted || !e.target) return;
      lastInput = { target: e.target, at: Date.now() };
      lastActivity = lastInput.at;
      for (const st of carouselStates.values()) {
        if (!st.firstTouch && st.el.contains(e.target)) st.firstTouch = lastInput.at;
      }
    };
    for (const type of ['pointerdown', 'keydown', 'click']) {
      s.listen(document, type, noteInput, true);
    }
    // Anything else the person does that a page may answer by moving a class (hover menus,
    // scroll-spy navigation): while they do, nothing the page changes is "by itself".
    const noteActivity = (e) => { if (e.isTrusted) lastActivity = Date.now(); };
    for (const type of ['pointerover', 'pointermove', 'wheel', 'touchstart', 'scroll', 'input', 'focusin']) {
      s.listen(document, type, noteActivity, { capture: true, passive: true });
    }
    const idle = () => Date.now() - lastActivity > IDLE_MS;

    const wasUserActionIn = (container, ms = 1500) => {
      if (!lastInput || !container) return false;
      if (Date.now() - lastInput.at > ms) return false;
      return typeof container.contains === 'function' && container.contains(lastInput.target);
    };

    // Asking the model. Once per element and what it is asked about, per page (the answers stay
    // with the adapter across enable and disable); never when options.ai is false.
    const memory = (this.memory ||= { pause: new WeakMap(), restart: new WeakMap(), region: new WeakMap(), media: new WeakMap() });
    let asks = 0;
    const canAsk = () => this.options.ai !== false && !!s.ai && s.ai.available && s.alive();
    const sameSig = (a, b) => (Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((x, i) => x === b[i]) : a === b);
    const askOnce = (kind, key, sig, make) => {
      const known = memory[kind].get(key);
      if (known && sameSig(known.sig, sig)) return known.answer;
      if (!canAsk() || asks >= MAX_ASKS) return null;
      asks++;
      const entry = { sig, answer: null };
      entry.answer = Promise.resolve().then(make).catch(() => null).then((v) => {
        // An answer cut off by disable() is no answer: ask again next time.
        if (!s.alive() && memory[kind].get(key) === entry) memory[kind].delete(key);
        return v === undefined ? null : v;
      });
      memory[kind].set(key, entry);
      return entry.answer;
    };
    // A button as the model sees it: its name and state, and the outline of what it holds.
    const describeButton = (btn) => {
      const name = nameOf(btn);
      const bits = [name ? `A button named "${name.slice(0, 100)}"` : 'A button with no name'];
      const pressed = btn.getAttribute('aria-pressed');
      if (pressed === 'true') bits.push('shown as pressed');
      if (pressed === 'false') bits.push('shown as not pressed');
      if (isDisabled(btn)) bits.push('disabled');
      const title = (btn.getAttribute('title') || '').trim();
      if (title && title !== name) bits.push(`its title "${title.slice(0, 100)}"`);
      return `${bits.join(', ')}.\n${s.ai.outline(btn, { maxChars: 300 })}`;
    };

    // 2. Videos and Audio (via s.media)
    if (effectiveVideos) {
      // What the page says about the input: it was on the media element, or on a button that
      // names the media in aria-controls.
      const isControlForMedia = (target, media) => {
        if (!target || !media) return false;
        if (target === media || (typeof media.contains === 'function' && media.contains(target))) return true;
        const btn = target.closest ? target.closest(BUTTONS) : null;
        if (!btn) return false;
        const ariaControls = btn.getAttribute('aria-controls');
        return !!(media.id && ariaControls && ariaControls.split(/\s+/).includes(media.id));
      };

      // The buttons near the media: those in the closest element holding both it and the button
      // pressed, at most three levels above the media's parent, never the page's body or main.
      const buttonsNear = (btn, media) => {
        let around = media.parentElement;
        for (let i = 0; around && i < 3 && !around.contains(btn); i++) around = around.parentElement;
        if (!around || !around.contains(btn)) return null;
        if (around === document.body || around === document.documentElement || around.matches('main, [role="main"]')) return null;
        const buttons = [...around.querySelectorAll(BUTTONS)].filter((b) => !b.closest('[data-ai4a11y-ui]'));
        return buttons.includes(btn) && buttons.length <= 12 ? { around, buttons } : null;
      };

      const describeMedia = (media) => {
        const bits = [`<${media.localName}>`];
        for (const attr of ['title', 'aria-label']) {
          const v = (media.getAttribute(attr) || '').trim();
          if (v) bits.push(`${attr} "${v.slice(0, 100)}"`);
        }
        for (const attr of ['controls', 'autoplay', 'loop', 'muted']) if (media.hasAttribute(attr)) bits.push(attr);
        return bits.join(', ');
      };

      const pauseMedia = (el) => {
        try {
          s.media.pause(el, { showControls: true });
        } catch {}
      };

      const handleMedia = (el) => {
        if (!el || (el.tagName !== 'VIDEO' && el.tagName !== 'AUDIO')) return;
        pauseMedia(el);
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
        if (s.watch && typeof s.watch.byPerson === 'function' && s.watch.byPerson(el, { withinMs: 1500 })) return;
        const input = lastInput && Date.now() - lastInput.at < 1500 ? lastInput.target : null;
        if (input && isControlForMedia(input, el)) return;
        // A button near it that does not say what it controls: ask which of them is its control.
        const btn = input && input.closest ? input.closest(BUTTONS) : null;
        const near = btn && canAsk() ? buttonsNear(btn, el) : null;
        const asked = near && askOnce('media', el, near.buttons, () => s.ai.choose(MEDIA_Q,
          near.buttons.map((b) => ({ value: b, about: describeButton(b) })),
          { context: `The video or sound: ${describeMedia(el)}\n\nThe part of the page around them:\n${s.ai.outline(near.around, { maxChars: 1200 })}` }));
        if (!asked) {
          pauseMedia(el);
          return;
        }
        asked.then((control) => {
          if (s.alive() && control !== btn) pauseMedia(el);
        });
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
    const asking = [];
    if (effectiveCarousels) {
      const pausedCarousels = [];
      const heldTracks = new WeakSet();
      const askedTracks = new WeakSet();
      let regionAsks = 0;

      const tokensIn = (cls) => String(cls || '').split(/\s+/).filter(Boolean);
      const tokensOf = (el) => tokensIn(el.getAttribute('class'));
      const stateOf = (el) => ({ name: nameOf(el), pressed: el.getAttribute('aria-pressed') });

      // A carousel's state: status 'asking' (the model has not answered), 'open' (held where it
      // moves), 'paused' (its button pressed) or 'left' (it is not playing: leave it).
      // firstTouch: when the person first used it; firstMove: when it first moved by itself.
      const stateFor = (el) => {
        const st = { el, status: 'open', firstTouch: 0, firstMove: 0, pressed: null, restart: null, seen: [] };
        carouselStates.set(el, st);
        return st;
      };
      const carouselOf = (el) => {
        for (let p = el; p && p !== document.documentElement; p = p.parentElement) {
          const st = carouselStates.get(p);
          if (st) return st;
        }
        return null;
      };
      // It moved by itself: true when the person started it (used it while it was still).
      const movedByItself = (st) => {
        if (!st.firstMove) st.firstMove = Date.now();
        return !!st.firstTouch && st.firstTouch < st.firstMove;
      };

      // The slides the page marks (aria-roledescription "slide", tab panels): the track is their
      // parent, the slides its own children.
      const markedTrack = (carousel) => {
        const marked = s.page.widgetParts(carousel);
        for (const track of new Set(marked.map((el) => el.parentElement).filter(Boolean))) {
          if (carousel.contains(track) && track.children.length >= 2) return track;
        }
        return null;
      };

      // The carousel's own buttons (its pause, play, next), not those inside its slides ("Play
      // trailer", "Pause audio"): from aria-controls and where they sit (s.page.ownControls),
      // never from what they say. Of those, only buttons that are not submit buttons and not in
      // a form.
      const ownButtons = (carousel, slides) => s.page.ownControls(carousel, { parts: slides, selector: BUTTONS }).filter((btn) => {
        if (btn.closest('form')) return false;
        if (btn.tagName === 'BUTTON' && btn.getAttribute('type')?.toLowerCase() === 'submit') return false;
        if (btn.tagName === 'INPUT' && (btn.type === 'submit' || btn.type === 'image')) return false;
        return true;
      });
      const slidesOf = (st) => (st.track ? [...st.track.children] : s.page.widgetParts(st.el));

      // What the model is told about a carousel besides its buttons.
      const carouselContext = (st) => {
        const lines = [`The slideshow:\n${s.ai.outline(st.el, { maxChars: 1500 })}`];
        const live = st.track && st.track.closest('[aria-live]');
        const politeness = live && st.el.contains(live) ? live.getAttribute('aria-live') : null;
        if (politeness === 'off') lines.push('Its slides are in a live region set to "off", as a carousel that moves on by itself marks them.');
        else if (politeness === 'polite' || politeness === 'assertive') lines.push(`Its slides are in a live region set to "${politeness}", as a carousel that is not moving marks them.`);
        return lines.join('\n\n');
      };

      // Hold what the slides show. The classes that say which slides are shown are those some
      // slides carry and others do not; the hold keeps each on exactly the slides that carried it
      // (before: the slides' classes before the move that found the track; else as they are now).
      // The page fights the hold when it undoes our write at once (within FIGHT_MS: its own
      // observer, a re-render or a frame reacting to ours); after MAX_FIGHTS of those in a row,
      // stop holding. A page that advances again later (a timer tick) is not fighting: each
      // advance is held, however many there are.
      const holdTrack = (st, track, before = null) => {
        if (!track || heldTracks.has(track) || !track.isConnected) return;
        const slides = [...track.children];
        if (slides.length < 2) return;
        const was = (sld) => (before && before.has(sld) ? before.get(sld) : new Set(tokensOf(sld)));
        const counts = new Map();
        for (const sld of slides) for (const t of was(sld)) counts.set(t, (counts.get(t) || 0) + 1);
        const marks = [...counts].filter(([, n]) => n < slides.length).map(([t]) => t);
        if (!marks.length) return;
        heldTracks.add(track);
        let held = new Map(marks.map((t) => [t, new Set(slides.filter((sld) => was(sld).has(t)))]));
        let fights = 0;
        let lastWrite = -Infinity;
        const MAX_FIGHTS = 5;
        const FIGHT_MS = 50;
        let stoppedHolding = false;
        let isOurUpdate = false;
        const has = (sld, t) => tokensOf(sld).includes(t);
        const isHeld = () => marks.every((t) => slides.every((sld) => has(sld, t) === held.get(t).has(sld)));
        let observer = null;

        const put = () => {
          isOurUpdate = true;
          try {
            for (const sld of slides) {
              const tokens = new Set(tokensOf(sld));
              let changed = false;
              for (const t of marks) {
                const want = held.get(t).has(sld);
                if (tokens.has(t) === want) continue;
                if (want) tokens.add(t);
                else tokens.delete(t);
                changed = true;
              }
              if (changed) s.setAttr(sld, 'class', Array.from(tokens).join(' '));
            }
          } finally {
            if (observer) observer.takeRecords();
            isOurUpdate = false;
            lastWrite = Date.now();
          }
        };
        const stop = () => {
          stoppedHolding = true;
          observer.disconnect();
        };

        observer = new MutationObserver(() => {
          if (stoppedHolding || isOurUpdate) return;

          // The person moved it (input inside the carousel): hold what it shows now.
          if (wasUserActionIn(st.el, 1500)) {
            held = new Map(marks.map((t) => [t, new Set(slides.filter((sld) => has(sld, t)))]));
            return;
          }

          if (isHeld()) return;
          // The person used it while it was still, and now it moves: they started it.
          if (movedByItself(st)) {
            stop();
            return;
          }
          fights = Date.now() - lastWrite < FIGHT_MS ? fights + 1 : 0;
          if (fights >= MAX_FIGHTS) {
            stop();
            return;
          }
          put();
        });

        observer.observe(track, {
          attributes: true,
          attributeFilter: ['class'],
          subtree: true,
        });
        if (before && !isHeld()) put();

        s.onEnd(() => {
          observer.disconnect();
        });
      };

      // Buttons as options for the model. Buttons it would see as the same (a toggle repeated in
      // each slide) are one option, the first of them: it could not choose between them.
      const buttonOptions = (buttons, pressed = null) => {
        const seen = new Set();
        const out = [];
        for (const b of buttons) {
          const about = `${describeButton(b)}${b === pressed ? '\nThe adapter pressed this button.' : ''}`;
          if (seen.has(about)) continue;
          seen.add(about);
          out.push({ value: b, about });
        }
        return out;
      };

      // Press the button the model chose; then, when the carousel has other buttons, ask which
      // of them starts it again (for disable()).
      const press = (st, button) => {
        const before = stateOf(button);
        try {
          button.click();
        } catch {
          return false;
        }
        st.status = 'paused';
        st.pressed = { button, before, at: Date.now() };
        pausedCarousels.push(st);
        s.timer(() => {
          const others = buttonOptions(ownButtons(st.el, slidesOf(st)).filter((b) => !isDisabled(b)), button);
          if (!others.some((o) => o.value !== button) || others.length > 12) return;
          const asked = askOnce('restart', st.el, others.map((o) => o.about).join('\n'),
            () => s.ai.choose(RESTART_Q, others, { context: carouselContext(st) }));
          if (asked) asked.then((again) => { if (again && others.some((o) => o.value === again)) st.restart = again; });
        }, 150);
        return true;
      };

      // A carousel: ask which of its own buttons pauses it, and press that one; with no answer,
      // or no buttons, hold its slides. Returns a promise while it waits on the model.
      const processCarousel = (carousel, track = null) => {
        if (!carousel || carouselStates.has(carousel)) return null;
        for (let p = carousel.parentElement; p && p !== document.documentElement; p = p.parentElement) {
          if (carouselStates.has(p)) return null;
        }
        const st = stateFor(carousel);
        st.track = track || markedTrack(carousel);
        const open = () => {
          st.status = 'open';
          if (st.track) holdTrack(st, st.track);
          for (const t of st.seen) holdTrack(st, t);
          st.seen = [];
        };

        const buttons = ownButtons(carousel, slidesOf(st));
        if (!buttons.length || buttons.length > 40 || !canAsk()) {
          open();
          return null;
        }
        const options = [...buttonOptions(buttons), STOPPED];
        if (options.length > 12) {
          open();
          return null;
        }
        const asked = askOnce('pause', carousel, options.map((o) => o.about).join('\n'),
          () => s.ai.choose(PAUSE_Q, options, { context: carouselContext(st) }));
        if (!asked) {
          open();
          return null;
        }
        st.status = 'asking';
        return asked.then((answer) => {
          if (!s.alive() || st.status !== 'asking') return;
          // The person used it meanwhile: what it does now is theirs.
          if (st.firstTouch) {
            st.status = 'left';
            return;
          }
          if (answer === 'stopped') {
            st.status = 'left';
            return;
          }
          if (answer && buttons.includes(answer) && answer.isConnected && carousel.contains(answer)) {
            // A chosen button that is disabled or pressed says the carousel is not playing.
            if (isDisabled(answer) || answer.getAttribute('aria-pressed') === 'true') {
              st.status = 'left';
              return;
            }
            if (press(st, answer)) return;
          }
          open();
        }).catch(() => {});
      };

      // A set of siblings a class moved between by itself (track), with their classes before.
      const sawMove = (track, before) => {
        const st = carouselOf(track);
        if (st) {
          if (st.status === 'left' || heldTracks.has(track)) return;
          if (st.status === 'asking') {
            if (!st.seen.includes(track)) st.seen.push(track);
            return;
          }
          if (st.status === 'paused' && Date.now() - st.pressed.at < PRESS_GRACE_MS) return;
          if (movedByItself(st)) return;
          holdTrack(st, track, before);
          return;
        }
        // Not in a carousel the page marks: ask whether it is a slideshow, once per track.
        if (askedTracks.has(track) || regionAsks >= MAX_REGION_ASKS) return;
        askedTracks.add(track);
        const region = regionOf(track);
        if (!region || carouselOf(region)) return;
        const asked = askOnce('region', track, '', () => s.ai.choose(REGION_Q, [IS_SLIDESHOW, NOT_SLIDESHOW], {
          context: `The part of the page:\n${s.ai.outline(region, { maxChars: 1200 })}\n\nThe items it moved between:\n${s.ai.outline(track, { maxChars: 900 })}`,
        }));
        if (!asked) return;
        regionAsks++;
        asked.then((yes) => {
          if (yes === true && s.alive() && track.isConnected && !carouselOf(region)) processCarousel(region, track);
        });
      };

      // Around a moving track, the part with its buttons: the closest of the three elements above
      // it (never the body or main) holding a button outside the track; else the track's parent.
      const regionOf = (track) => {
        const stop = (el) => !el || el === document.body || el === document.documentElement || el.matches('main, [role="main"]');
        let el = track;
        for (let i = 0; i < 3 && !stop(el.parentElement); i++) {
          el = el.parentElement;
          if (ownButtons(el, [...track.children]).some((b) => !track.contains(b))) return el;
        }
        return stop(track.parentElement) ? track : track.parentElement;
      };

      // What moves by itself: a class leaving one child of an element and landing on another
      // (within a second: some pages show the next before they hide the last), while nobody is
      // using the page.
      const pending = new Map(); // parent → { olds: child → its class before, at }
      const pageObserver = new MutationObserver((records) => {
        if (!s.alive()) return;
        if (!idle()) {
          pending.clear();
          return;
        }
        // With no model to ask, only moves inside the carousels the page marks matter.
        if (!canAsk() && !carouselStates.size) return;
        const now = Date.now();
        const touched = new Set();
        for (const r of records.slice(0, 500)) {
          const el = r.target;
          const p = el.parentElement;
          if (!p || p === document.documentElement || p.children.length < 2 || heldTracks.has(p)) continue;
          if (el.closest('[data-ai4a11y-ui]')) continue;
          let entry = pending.get(p);
          if (!entry || now - entry.at > 1000) {
            entry = { olds: new Map(), at: now };
            pending.set(p, entry);
          }
          if (!entry.olds.has(el)) entry.olds.set(el, r.oldValue || '');
          touched.add(p);
        }
        for (const p of touched) {
          const entry = pending.get(p);
          const lost = new Set();
          const gained = new Set();
          for (const [el, old] of entry.olds) {
            if (el.parentElement !== p) continue;
            const was = new Set(tokensIn(old));
            const is = new Set(tokensOf(el));
            for (const t of was) if (!is.has(t)) lost.add(t);
            for (const t of is) if (!was.has(t)) gained.add(t);
          }
          if (![...lost].some((t) => gained.has(t))) continue;
          pending.delete(p);
          const before = new Map([...p.children].map((c) => [c, new Set(entry.olds.has(c) ? tokensIn(entry.olds.get(c)) : tokensOf(c))]));
          sawMove(p, before);
        }
        if (pending.size > 200) {
          for (const [p, entry] of pending) if (now - entry.at > 1000) pending.delete(p);
        }
      });

      const findAndProcessCarousels = (root) => {
        if (!root) return;
        const selector = '[aria-roledescription="carousel" i]';
        const list = [
          ...(root.matches?.(selector) ? [root] : []),
          ...root.querySelectorAll(selector),
        ];
        const outermost = list.filter((c) => !list.some((other) => other !== c && other.contains(c)));
        for (const c of outermost) {
          const waiting = processCarousel(c);
          if (waiting) asking.push(waiting);
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
        pageObserver.observe(root, { attributes: true, attributeFilter: ['class'], attributeOldValue: true, subtree: true });
        s.onEnd(() => pageObserver.disconnect());
      }

      // Restore paused carousels on disable: with the button the model said starts it, or else
      // the same button when it toggles (it says something else since it was clicked: its name
      // or aria-pressed); never one the person used since.
      s.onEnd(() => {
        for (const st of pausedCarousels) {
          if (!st.el.isConnected || st.firstTouch) continue;
          const { button, before } = st.pressed;
          const again = st.restart;
          if (again && again.isConnected && !isDisabled(again) && st.el.contains(again)) {
            try { again.click(); } catch {}
            continue;
          }
          const now = stateOf(button);
          if (button.isConnected && !isDisabled(button) && (now.name !== before.name || now.pressed !== before.pressed)) {
            try { button.click(); } catch {}
          }
        }
      });
    }

    // Waiting on the model for the carousels found on load: enable() is done when it answered.
    if (asking.length) return Promise.all(asking).then(() => true);
  },

  disable() {
    this.s?.end();
    this.s = null;
  },
};
