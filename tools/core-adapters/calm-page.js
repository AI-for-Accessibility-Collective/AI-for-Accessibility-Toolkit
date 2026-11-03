// calm-page.js — Calms interface motion by stopping autoplay, animations, transitions, and auto-advancing carousels.
// Barrier: People with vestibular, photosensitive, cognitive, or attention disorders experience nausea,
// dizziness, distraction, or loss of context from unrequested movement and automatic page changes.
//
// Suggested in onboarding for: sensory, cognitive (a suggestion only, never a gate).
// The person's settings it reads: motionReducer.
// What the person can adjust: nothing (the shortcut, if given, turns it on and off).
//
// Options:
//   animations: boolean (default true) — stops CSS animations, ending them in their final state.
//   transitions: boolean (default true) — eliminates CSS transition delays and durations.
//   smoothScroll: boolean (default true) — forces scroll-behavior to auto.
//   videos: boolean (default true) — pauses autoplaying and looping video, ensuring controls are visible.
//   carousels: boolean (default true) — pauses auto-advancing carousels using their own controls or holding slides.
//   marquees: boolean (default true) — halts marquee-like scrolling content.
//   (Also accepts legacy aliases: stopAnimations, pauseVideos, stopCarousels, stopMarquees).
//
// Decisions:
//   • When every feature is turned off in options, returns false with nothing to do.
//   • Applies one stylesheet via s.css to set animation-duration to 0s and fill-mode forwards,
//     ending animations in their final state so content hidden by animation start states remains visible.
//   • Avoids animation-play-state: paused for general animations because it freezes elements on frame 1.
//   • Pauses autoplaying media and looping GIF-like videos via s.media.pause(v, { showControls: true }).
//   • Leaves videos already paused as they were, and honors user play actions initiated by the person.
//   • Pauses carousels via their own Pause/Stop button when present, properly scoped and playing;
//     resumes them on disable() with their own Play button (or toggled control) if untouched by the person.
//   • For carousels without controls, holds the active slide shown by maintaining state classes (e.g. active)
//     on the track's own children through s.setAttr; stops holding if the page repeatedly fights back.
//   • Measures once: never sweeps every element on the page for scroll dimensions.
//   • Strictly avoids clicking buttons outside carousels (e.g., adjacent slider widgets).
//   • Says nothing on load: screen reader users are not interrupted.
//
// What it cannot do:
//   • Cannot prevent server-side reloads or WebSocket push-driven DOM rewrites.
//   • Cannot pause animations deeply baked into third-party closed-shadow-root or cross-origin canvas streams.

const STATE_RE = /\b(active|current|is-active|is-current|selected|visible|showing)\b/i;

function getClasses(el) {
  const c = el && el.getAttribute ? el.getAttribute('class') : null;
  return c ? c.trim().split(/\s+/).filter(Boolean) : [];
}

export default {
  enable(options = {}, toolkit) {
    if (this.s && !this.s.ended) return;
    this.options = options || {};
    this.toolkit = toolkit || this.toolkit;
    if (!this.toolkit) return false;

    const o = this.options;
    const anims = o.animations !== false && o.stopAnimations !== false;
    const transitions = o.transitions !== false;
    const smoothScroll = o.smoothScroll !== false;
    const videos = o.videos !== false && o.pauseVideos !== false;
    const carousels = o.carousels !== false && o.stopCarousels !== false;
    const marquees = o.marquees !== false && o.stopMarquees !== false;

    if (!anims && !transitions && !smoothScroll && !videos && !carousels && !marquees) {
      this.disable();
      return false;
    }

    const s = (this.s = this.toolkit.session());
    const doc = document;
    const win = doc.defaultView || globalThis;

    // 1. One stylesheet for CSS animations, transitions, and smooth scrolling
    if (anims || transitions || smoothScroll) {
      let rules = '';
      if (anims || transitions) {
        rules += `
*, *::before, *::after {
  animation-duration: 0s !important;
  animation-delay: 0s !important;
  animation-iteration-count: 1 !important;
  animation-fill-mode: forwards !important;
  transition-duration: 0s !important;
  transition-delay: 0s !important;
}
`;
      }
      if (smoothScroll) {
        rules += `
*, html {
  scroll-behavior: auto !important;
}
`;
      }
      s.css('calm-page-motion', rules);
    }

    // Finish any running Web Animations API animations in their final state
    if (anims && typeof doc.getAnimations === 'function') {
      try {
        for (const a of doc.getAnimations()) {
          if (a.playState === 'running') {
            try { a.finish(); } catch { try { a.pause(); } catch {} }
          }
        }
      } catch {}
    }

    // 2. Video and audio handling through s.media
    if (videos) {
      let lastUserTarget = null;
      let lastUserTime = 0;
      const noteUser = (e) => {
        if (e.isTrusted) {
          lastUserTarget = e.target;
          lastUserTime = Date.now();
        }
      };
      for (const evt of ['pointerdown', 'click', 'keydown', 'touchstart']) {
        s.listen(doc, evt, noteUser, { capture: true, passive: true });
      }

      const isPlayByPerson = (media) => {
        if (s.watch.byPerson(media, { withinMs: 1500 })) return true;
        if (media.parentElement && s.watch.byPerson(media.parentElement, { withinMs: 1500 })) return true;
        if (Date.now() - lastUserTime < 1500 && lastUserTarget) {
          if (media.contains(lastUserTarget)) return true;
          if (lastUserTarget.getAttribute('aria-controls') === media.id) return true;
          if (media.parentElement && media.parentElement.contains(lastUserTarget)) return true;
          const playerBox = media.closest('[class*="player" i], [class*="video" i], [class*="media" i]');
          if (playerBox && playerBox.contains(lastUserTarget)) return true;
        }
        return false;
      };

      const pauseIfAutoplayOrPlaying = (media) => {
        if (!media || (media.tagName !== 'VIDEO' && media.tagName !== 'AUDIO')) return;
        const isAutoplay = media.autoplay || media.hasAttribute('autoplay');
        const isPlaying = !media.paused;
        if (isPlaying || isAutoplay) {
          s.media.pause(media, { showControls: true });
        }
      };

      const root = doc.body || doc.documentElement;
      if (root) {
        for (const m of root.querySelectorAll('video, audio')) {
          pauseIfAutoplayOrPlaying(m);
        }

        s.watch.added(
          root,
          (el) => {
            if (el.tagName === 'VIDEO' || el.tagName === 'AUDIO') {
              pauseIfAutoplayOrPlaying(el);
            } else if (el.querySelectorAll) {
              for (const m of el.querySelectorAll('video, audio')) {
                pauseIfAutoplayOrPlaying(m);
              }
            }
          },
          { selector: 'video, audio' }
        );
      }

      s.listen(
        doc,
        'play',
        (e) => {
          const media = e.target;
          if (!media || (media.tagName !== 'VIDEO' && media.tagName !== 'AUDIO')) return;
          if (isPlayByPerson(media)) return;
          s.media.pause(media, { showControls: true });
        },
        true
      );
    }

    // 3. Marquee scrolling handling
    if (marquees) {
      const root = doc.body || doc.documentElement;
      if (root) {
        const handleMarquee = (m) => {
          if (!m || m.tagName !== 'MARQUEE') return;
          try {
            m.stop();
            s.onEnd(() => {
              try { m.start(); } catch {}
            });
          } catch {}
        };

        for (const m of root.querySelectorAll('marquee')) {
          handleMarquee(m);
        }

        s.watch.added(root, handleMarquee, { selector: 'marquee' });
      }
    }

    // 4. Carousels handling
    if (carousels) {
      const root = doc.body || doc.documentElement;
      if (root) {
        this.handleCarousels(s, root, win);
      }
    }
  },

  handleCarousels(s, root, win) {
    const isClickableCarousel = (carousel) => {
      const roleDesc = (carousel.getAttribute('aria-roledescription') || '').toLowerCase();
      if (roleDesc === 'carousel') return true;
      const role = carousel.getAttribute('role') || carousel.tagName.toLowerCase();
      const isRegionOrGroup = role === 'region' || role === 'group' || carousel.tagName === 'SECTION' || carousel.tagName === 'ASIDE';
      if (isRegionOrGroup) {
        const name = (carousel.getAttribute('aria-label') || s.page.nameOf(carousel) || '').toLowerCase();
        if (name.includes('carousel') || name.includes('slideshow')) return true;
      }
      return false;
    };

    // 1. Explicit carousels with aria-roledescription="carousel"
    const explicit = Array.from(root.querySelectorAll('[aria-roledescription="carousel"]'));

    // 2. Other region/group/class carousels that do not contain an explicit carousel and are not inside one
    const otherCandidates = [];
    for (const el of root.querySelectorAll('[role="region"], [role="group"], section, aside, [class*="carousel" i], [class*="slideshow" i]')) {
      if (el.querySelector('[aria-roledescription="carousel"]')) continue;
      if (explicit.some((c) => c.contains(el))) continue;

      const role = (el.getAttribute('role') || el.tagName).toLowerCase();
      const name = (el.getAttribute('aria-label') || s.page.nameOf(el) || '').toLowerCase();
      const cls = (el.getAttribute('class') || '').toLowerCase();
      const isRegion = role === 'region' || role === 'group' || el.tagName === 'SECTION' || el.tagName === 'ASIDE';

      if (isRegion && (name.includes('carousel') || name.includes('slideshow'))) {
        otherCandidates.push(el);
      } else if (/\b(carousel|slideshow)\b/i.test(cls)) {
        if (el.querySelectorAll('[aria-roledescription="slide"], [class*="slide" i]').length > 1) {
          otherCandidates.push(el);
        }
      }
    }

    // One carousel is handled once, even when its inner parts' classes also say carousel
    const allCarousels = [...explicit];
    for (const cand of otherCandidates) {
      if (!allCarousels.some((c) => c.contains(cand))) {
        allCarousels.push(cand);
      }
    }

    for (const carousel of allCarousels) {
      let pauseBtn = null;
      if (isClickableCarousel(carousel)) {
        for (const btn of carousel.querySelectorAll('button, [role="button"]')) {
          if (btn.tagName === 'INPUT' && btn.type === 'submit') continue;
          if (btn.type === 'submit') continue;
          if (btn.closest('form')) continue;

          const name = (btn.getAttribute('aria-label') || btn.getAttribute('title') || s.page.nameOf(btn) || btn.textContent || '').trim().toLowerCase();
          const saysPauseOrStop = /\b(pause|stop)\b/i.test(name);
          if (!saysPauseOrStop) continue;

          const pressed = btn.getAttribute('aria-pressed');
          if (pressed !== 'true') {
            pauseBtn = btn;
            break;
          }
        }
      }

      if (pauseBtn) {
        let personInteracted = false;
        s.listen(carousel, 'click', (e) => {
          if (e.isTrusted) personInteracted = true;
        }, true);
        s.listen(carousel, 'keydown', (e) => {
          if (e.isTrusted) personInteracted = true;
        }, true);

        pauseBtn.click();

        s.onEnd(() => {
          if (personInteracted) return;
          const nameNow = (pauseBtn.getAttribute('aria-label') || pauseBtn.getAttribute('title') || s.page.nameOf(pauseBtn) || pauseBtn.textContent || '').trim().toLowerCase();
          const toggledToPlay = /\b(play|start|resume)\b/i.test(nameNow) || pauseBtn.getAttribute('aria-pressed') === 'true';
          if (toggledToPlay) {
            try { pauseBtn.click(); return; } catch {}
          }
          for (const b of carousel.querySelectorAll('button, [role="button"]')) {
            if (b.type === 'submit' || b.closest('form')) continue;
            const bName = (b.getAttribute('aria-label') || b.getAttribute('title') || s.page.nameOf(b) || b.textContent || '').trim().toLowerCase();
            if (/\b(play|start|resume)\b/i.test(bName)) {
              try { b.click(); return; } catch {}
            }
          }
        });
      } else {
        // No pause button: find slides and hold the active slide
        let track = null;
        const slidesWithRole = Array.from(carousel.querySelectorAll('[aria-roledescription="slide"]'));
        if (slidesWithRole.length > 1) {
          track = slidesWithRole[0].parentElement;
        }
        if (!track) {
          const trackEl = carousel.querySelector('[class*="track" i], [class*="slides" i]');
          if (trackEl && trackEl.children.length > 1) {
            track = trackEl;
          }
        }
        if (!track) {
          for (const child of carousel.querySelectorAll('*')) {
            const cls = child.getAttribute('class') || '';
            if (/\b(slides?|item)\b/i.test(cls) && !/\b(track|container|wrapper|controls)\b/i.test(cls)) {
              if (child.parentElement && child.parentElement.children.length > 1) {
                track = child.parentElement;
                break;
              }
            }
          }
        }
        if (!track || track.children.length < 2) continue;

        const slides = Array.from(track.children);
        const hasState = (el) => getClasses(el).some((cls) => STATE_RE.test(cls));

        let heldSlide = slides.find(hasState) || slides[0];
        let heldStateClasses = getClasses(heldSlide).filter((cls) => STATE_RE.test(cls));
        if (heldStateClasses.length === 0) heldStateClasses = ['active'];

        let personMoved = false;
        let fightCount = 0;
        const MAX_FIGHTS = 8;
        let stoppedHolding = false;

        s.listen(carousel, 'click', (e) => {
          if (e.isTrusted) {
            personMoved = true;
            win.setTimeout(() => {
              if (!s.alive()) return;
              const newActive = slides.find(hasState);
              if (newActive) {
                heldSlide = newActive;
                heldStateClasses = getClasses(newActive).filter((cls) => STATE_RE.test(cls));
                fightCount = 0;
              }
            }, 50);
          }
        }, true);

        if (typeof win.MutationObserver === 'function') {
          const mo = new win.MutationObserver(() => {
            if (!s.alive() || stoppedHolding) return;

            if (personMoved || s.watch.byPerson(carousel, { withinMs: 1500 })) {
              personMoved = false;
              const newActive = slides.find(hasState);
              if (newActive) {
                heldSlide = newActive;
                heldStateClasses = getClasses(newActive).filter((cls) => STATE_RE.test(cls));
                fightCount = 0;
              }
              return;
            }

            let diverged = false;
            for (const slide of slides) {
              const isHeld = (slide === heldSlide);
              const classes = getClasses(slide);
              const hasSt = classes.some((c) => STATE_RE.test(c));
              if (isHeld && !hasSt) diverged = true;
              if (!isHeld && hasSt) diverged = true;
            }

            if (!diverged) return;

            fightCount++;
            if (fightCount > MAX_FIGHTS) {
              stoppedHolding = true;
              mo.disconnect();
              return;
            }

            for (const slide of slides) {
              const isHeld = (slide === heldSlide);
              let classes = getClasses(slide);
              let changed = false;

              if (isHeld) {
                for (const st of heldStateClasses) {
                  if (!classes.includes(st)) {
                    classes.push(st);
                    changed = true;
                  }
                }
              } else {
                const filtered = classes.filter((c) => !STATE_RE.test(c));
                if (filtered.length !== classes.length) {
                  classes = filtered;
                  changed = true;
                }
              }

              if (changed) {
                s.setAttr(slide, 'class', classes.join(' '));
              }
            }

            mo.takeRecords();
          });

          mo.observe(track, {
            attributes: true,
            attributeFilter: ['class'],
            subtree: true
          });

          s.onEnd(() => {
            mo.disconnect();
          });
        }
      }
    }
  },

  disable() {
    this.s?.end();
    this.s = null;
  },
};
