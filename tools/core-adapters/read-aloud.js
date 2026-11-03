// read-aloud.js — Reads the main content or selected text aloud with word highlighting.
// Barrier: People with visual, reading, or cognitive impairments may have difficulty
// reading on-screen text, tracking their place while reading, or processing dense prose
// without auditory reinforcement.
//
// Suggested in onboarding for: reading, vision (a suggestion only, never a gate).
// The person's settings it reads: speechRate.
// What the person can adjust:
//   • speechRate with Slower and Faster buttons in its control bar (steps of 0.1, 0.5 to 2.0).
//   • With the person's shortcut (s.keys.adjust, label 'Speech rate', settings ['speechRate']):
//     up faster, down slower, saved for this site and announced.
//
// Options:
//   speechRate: Default speaking rate (0.5 to 2.0). Defaults to 1.0 (overridden by profile).
//
// Decisions:
//   • Reads main content (or text the person selected) aloud on request, never on load.
//   • Highlights each word as it is spoken using s.speech.say with onWord and s.highlight.range.
//   • Starts only from its own Play button; Escape stops reading immediately.
//   • Injects a small control bar (Play/Pause, Stop, Slower, Faster) fixed at the bottom.
//   • The bar adds to the page's own bottom padding instead of replacing it, ensuring no content
//     is covered when scrolled to the end.
//   • Uses s.focus.keepVisible() so focused elements are never hidden behind the bar.
//   • Speech uses the browser's own in the runtime (via s.speech.say).
//   • Skips navigation, the toolkit's UI, and hidden text automatically.
//   • No 'every site' button: the person chooses that in the extension popup.
//   • Rate changes restart speech once from the current word (s.speech.say(el, { from }))
//     in s.profile.onChange; a rate changed while paused is used when playback resumes.
//   • Announce the rate set() actually applied via s.announce.
//   • If the page contains no readable text, disables itself and returns false.
//
// What it cannot do:
//   • Cannot read text embedded inside bitmap images or canvas elements without OCR.
//   • Cannot override speech synthesis if browser or system audio is muted.

export default {
  enable(options = {}, toolkit) {
    if (this.s && !this.s.ended) return;
    this.options = options || {};
    this.toolkit = toolkit || this.toolkit;
    if (!this.toolkit) return false;

    const s = (this.s = this.toolkit.session());

    // Check readable text
    const main = this.toolkit.page.main();
    const text = main ? this.toolkit.page.readableText(main) : '';
    if (!text || !text.trim()) {
      this.disable();
      return false;
    }

    this.currentOffset = 0;
    this.currentSource = null;
    this._paused = false;
    this._rateChangedWhilePaused = false;
    this._restarting = false;
    this.handle = null;
    this.hl = s.highlight.range(null);

    // Keys adjust
    s.keys.adjust({
      label: 'Speech rate',
      settings: ['speechRate'],
      up: () => this.faster(),
      down: () => this.slower(),
    });

    // Profile onChange
    s.profile.onChange((personal, changed) => {
      if (changed && changed.speechRate !== undefined) {
        if (this.speaking && !this.paused) {
          this._startSpeaking(this.currentOffset);
        } else if (this.paused) {
          this._rateChangedWhilePaused = true;
        }
      }
    });

    // Keep visible so bar never hides focus
    s.focus.keepVisible();

    // Escape listener
    s.listen(document, 'keydown', (e) => {
      if (e.key === 'Escape' && (this.speaking || this.paused)) {
        this.stop();
      }
    }, true);

    // CSS for bar and controls
    s.css('read-aloud', `
.ai4a11y-read-aloud-bar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 2147483646;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 8px 12px;
  background-color: #1f1f1f;
  color: #ffffff;
  border-top: 2px solid #555555;
  box-shadow: 0 -2px 10px rgba(0, 0, 0, 0.25);
  box-sizing: border-box;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 14px;
}
.ai4a11y-read-aloud-bar button {
  min-width: 44px;
  min-height: 32px;
  padding: 4px 12px;
  font-family: inherit;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.4;
  color: #ffffff;
  background-color: #2e2e2e;
  border: 2px solid #cccccc;
  border-radius: 6px;
  cursor: pointer;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  text-decoration: none;
}
.ai4a11y-read-aloud-bar button:hover {
  background-color: #444444;
  border-color: #ffffff;
}
.ai4a11y-read-aloud-bar button:focus {
  outline: 3px solid #ffffff !important;
  outline-offset: 2px !important;
}
.ai4a11y-read-aloud-bar button:focus:not(:focus-visible) {
  outline: none !important;
}
.ai4a11y-read-aloud-bar button:focus-visible {
  outline: 3px solid #ffffff !important;
  outline-offset: 2px !important;
}
`);

    // Build the bar
    const bar = (this.bar = s.el('div', {
      attrs: {
        class: 'ai4a11y-read-aloud-bar',
        role: 'region',
        'aria-label': 'Read aloud controls',
      },
    }));

    const btnPlay = (this.btnPlay = s.el('button', {
      text: 'Play',
      attrs: {
        type: 'button',
        'data-action': 'play',
        'aria-label': 'Play',
      },
    }));

    const btnStop = s.el('button', {
      text: 'Stop',
      attrs: {
        type: 'button',
        'data-action': 'stop',
        'aria-label': 'Stop',
      },
    });

    const btnSlower = s.el('button', {
      text: 'Slower',
      attrs: {
        type: 'button',
        'data-action': 'slower',
        'aria-label': 'Slower',
      },
    });

    const btnFaster = s.el('button', {
      text: 'Faster',
      attrs: {
        type: 'button',
        'data-action': 'faster',
        'aria-label': 'Faster',
      },
    });

    bar.append(btnPlay, btnStop, btnSlower, btnFaster);

    s.listen(btnPlay, 'click', () => this.toggle());
    s.listen(btnStop, 'click', () => this.stop());
    s.listen(btnSlower, 'click', () => this.slower());
    s.listen(btnFaster, 'click', () => this.faster());

    const doc = document;
    const body = doc.body || doc.documentElement;
    const origPaddingBottom = (doc.body && window.getComputedStyle(doc.body).paddingBottom) || '0px';
    const origPaddingVal = parseFloat(origPaddingBottom) || 0;

    s.append(body, bar);

    const barHeight = bar.offsetHeight || 48;
    if (doc.body) {
      s.setStyle(doc.body, 'padding-bottom', `${origPaddingVal + barHeight + 8}px`);
    }

    return true;
  },

  disable() {
    this.stop();
    this.s?.end();
    this.s = null;
    this.handle = null;
    this.hl = null;
    this.bar = null;
    this.btnPlay = null;
    this.currentSource = null;
  },

  getRate() {
    const p = this.s?.profile?.get('speechRate');
    if (p !== undefined && p !== null && Number.isFinite(Number(p))) {
      return Math.round(Number(p) * 10) / 10;
    }
    const opt = this.options?.speechRate;
    if (opt !== undefined && opt !== null && Number.isFinite(Number(opt))) {
      return Math.round(Number(opt) * 10) / 10;
    }
    return 1.0;
  },

  get speaking() {
    return Boolean(this.handle && this.handle.speaking && !this._paused);
  },

  get paused() {
    return Boolean(this._paused);
  },

  _updateButtons(speaking, paused) {
    if (!this.btnPlay) return;
    if (speaking && !paused) {
      this.btnPlay.textContent = 'Pause';
      this.btnPlay.setAttribute('aria-label', 'Pause');
    } else {
      this.btnPlay.textContent = 'Play';
      this.btnPlay.setAttribute('aria-label', 'Play');
    }
  },

  _startSpeaking(from = 0) {
    if (!this.s || !this.s.alive()) return;
    this._restarting = true;
    if (this.handle) {
      this.handle.stop();
      this.handle = null;
    }
    this._restarting = false;

    const source = this.currentSource || this.toolkit?.page?.main() || document.body;
    const rate = this.getRate();

    this.handle = this.s.speech.say(source, {
      speechRate: rate,
      from,
      onWord: (range, offset) => {
        if (!range) {
          if (!this._restarting && !this.paused) {
            this.hl?.clear();
            this.handle = null;
            this.currentOffset = 0;
            this._updateButtons(false, false);
          }
          return;
        }
        this.currentOffset = offset;
        this.hl?.move(range);
      },
    });

    if (this.handle && this.handle.done) {
      this.handle.done.then((completed) => {
        if (completed) {
          this._paused = false;
          this._rateChangedWhilePaused = false;
          this.currentOffset = 0;
          this.handle = null;
          this.hl?.clear();
          this._updateButtons(false, false);
        }
      });
    }

    this._updateButtons(true, false);
  },

  play() {
    const sel = (typeof window !== 'undefined' && window.getSelection) ? window.getSelection() : null;
    const hasSelection = sel && !sel.isCollapsed && sel.toString().trim().length > 0;
    this.currentSource = hasSelection
      ? (sel.rangeCount ? sel.getRangeAt(0).cloneRange() : sel)
      : (this.toolkit?.page?.main() || document.body);
    this.currentOffset = 0;
    this._paused = false;
    this._rateChangedWhilePaused = false;
    this._startSpeaking(0);
  },

  pause() {
    if (!this.speaking || this.paused) return;
    this._paused = true;
    if (this.handle) {
      this.handle.pause();
    }
    this._updateButtons(false, true);
  },

  resume() {
    if (!this.paused) return;
    this._paused = false;
    if (this._rateChangedWhilePaused) {
      this._rateChangedWhilePaused = false;
      this._startSpeaking(this.currentOffset);
    } else if (this.handle) {
      this.handle.resume();
      this._updateButtons(true, false);
    } else {
      this._startSpeaking(this.currentOffset);
    }
  },

  toggle() {
    if (this.speaking) {
      this.pause();
    } else if (this.paused) {
      this.resume();
    } else {
      this.play();
    }
  },

  stop() {
    this._paused = false;
    this._rateChangedWhilePaused = false;
    this.currentOffset = 0;
    if (this.handle) {
      this.handle.stop();
      this.handle = null;
    }
    this.hl?.clear();
    this._updateButtons(false, false);
  },

  async faster() {
    if (!this.s || !this.s.alive()) return;
    const current = this.getRate();
    const next = Math.min(2.0, Math.round((current + 0.1) * 10) / 10);
    if (next !== current) {
      const res = await this.s.profile.set({ speechRate: next });
      if (res && res.applied) {
        this.s.announce(`Speech rate ${next} on this site.`);
      }
    }
  },

  async slower() {
    if (!this.s || !this.s.alive()) return;
    const current = this.getRate();
    const next = Math.max(0.5, Math.round((current - 0.1) * 10) / 10);
    if (next !== current) {
      const res = await this.s.profile.set({ speechRate: next });
      if (res && res.applied) {
        this.s.announce(`Speech rate ${next} on this site.`);
      }
    }
  },
};
