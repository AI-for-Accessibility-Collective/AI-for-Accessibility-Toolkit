// Read aloud: reads the main content or selected text aloud with word-by-word
// highlighting, helping people who experience reading or vision barriers.
//
// Suggested in onboarding for: reading, vision (a suggestion only, never a gate).
//
// The person's settings it reads:
//   - speechRate (0.5 to 2.0, default 1.0)
//
// What the person can adjust:
//   - speechRate: adjusted with Slower and Faster buttons in steps of 0.1
//     (range 0.5 to 2.0), saved for this site via s.profile.set({ speechRate }).
//   - 'Use on every site' button: saves the current speechRate for every site
//     via s.profile.set({ speechRate }, { scope: 'all' }).
//
// Options:
//   - speechRate: default speaking rate if not set in person's profile (default 1.0).
//
// Decisions it makes:
//   - Starts speech only from its own Play button or keyboard shortcut Alt+Shift+R;
//     never speaks automatically on page load.
//   - Escape stops speech immediately and clears highlighting.
//   - Controls are in a compact control bar placed directly before the main
//     content in normal layout flow so it covers nothing the person is reading.
//   - Words are highlighted as spoken using the CSS Custom Highlight API via
//     s.highlight.range, keeping the page's text nodes untouched.
//   - Skips navigation, the toolkit's own UI, form controls, code, and hidden text.
//   - Slower and Faster adjust speed by 0.1 within the [0.5, 2.0] range.
//   - Pausing and resuming preserves the speech session.
//
// What it cannot do:
//   - Cannot speak if the browser or runtime does not support text-to-speech.
//   - Cannot highlight individual words if the CSS Custom Highlight API is
//     unsupported in the browser.
//   - Cannot speak images without accessible names or alt text.

export default {
  enable(options, toolkit) {
    if (this.s && !this.s.ended) return;
    const s = (this.s = toolkit.session());

    const doc = document;
    const win = window;

    const main = s.page.main();
    if (!main || !s.page.readableText(main)) return false;

    const getRate = () => {
      const p = s.profile.get('speechRate');
      const r = p !== undefined && p !== null ? Number(p) : (options?.speechRate !== undefined ? Number(options.speechRate) : 1.0);
      return Math.max(0.5, Math.min(2.0, Math.round(r * 10) / 10));
    };

    s.css(
      'read-aloud',
      `#ai4a11y-read-aloud-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 6px;
  padding: 4px 8px;
  margin: 0 0 8px 0;
  background: #1e293b;
  color: #ffffff;
  border: 2px solid #334155;
  border-radius: 6px;
  font-family: system-ui, -apple-system, sans-serif;
  font-size: 13px;
  line-height: 1.3;
  box-sizing: border-box;
  max-width: 100%;
}
#ai4a11y-read-aloud-bar button {
  min-width: 28px;
  min-height: 26px;
  padding: 2px 8px;
  background: #334155;
  color: #ffffff;
  border: 1px solid #64748b;
  border-radius: 4px;
  font: inherit;
  font-weight: 500;
  cursor: pointer;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
#ai4a11y-read-aloud-bar button:hover {
  background: #475569;
}
#ai4a11y-read-aloud-bar button:focus-visible {
  outline: 3px solid #38bdf8 !important;
  outline-offset: 2px !important;
}
#ai4a11y-read-aloud-bar .ai4a11y-rate-label {
  font-weight: 600;
  padding: 0 2px;
  min-width: 32px;
  text-align: center;
  color: #ffffff;
}`
    );

    const bar = s.el('div', {
      attrs: {
        role: 'group',
        'aria-label': 'Read aloud',
        id: 'ai4a11y-read-aloud-bar',
      },
    });

    const playBtn = s.el('button', {
      text: 'Play',
      attrs: {
        type: 'button',
        id: 'ai4a11y-read-aloud-play',
        'aria-label': 'Play reading',
      },
    });

    const stopBtn = s.el('button', {
      text: 'Stop',
      attrs: {
        type: 'button',
        id: 'ai4a11y-read-aloud-stop',
        'aria-label': 'Stop reading',
      },
    });

    const slowerBtn = s.el('button', {
      text: 'Slower',
      attrs: {
        type: 'button',
        id: 'ai4a11y-read-aloud-slower',
        'aria-label': 'Read slower',
      },
    });

    const rateLabel = s.el('span', {
      text: `${getRate().toFixed(1)}x`,
      attrs: {
        id: 'ai4a11y-read-aloud-rate',
        class: 'ai4a11y-rate-label',
        'aria-hidden': 'true',
      },
    });

    const fasterBtn = s.el('button', {
      text: 'Faster',
      attrs: {
        type: 'button',
        id: 'ai4a11y-read-aloud-faster',
        'aria-label': 'Read faster',
      },
    });

    const useAllBtn = s.el('button', {
      text: 'Use on every site',
      attrs: {
        type: 'button',
        id: 'ai4a11y-read-aloud-all',
        'aria-label': 'Use speed on every site',
      },
    });

    bar.append(playBtn, stopBtn, slowerBtn, rateLabel, fasterBtn, useAllBtn);

    if (main && main !== doc.body && main !== doc.documentElement) {
      s.insert(main, bar, main.firstChild);
    } else if (doc.body) {
      s.insert(doc.body, bar, doc.body.firstChild);
    }

    const hl = s.highlight.range(null);
    let state = 'stopped'; // 'stopped' | 'speaking' | 'paused'
    let currentSpeech = null;

    function updateUi() {
      const rate = getRate();
      rateLabel.textContent = `${rate.toFixed(1)}x`;
      if (state === 'speaking') {
        playBtn.textContent = 'Pause';
        playBtn.setAttribute('aria-label', 'Pause reading');
      } else if (state === 'paused') {
        playBtn.textContent = 'Play';
        playBtn.setAttribute('aria-label', 'Resume reading');
      } else {
        playBtn.textContent = 'Play';
        playBtn.setAttribute('aria-label', 'Play reading');
      }
    }

    function speak() {
      if (state === 'paused' && currentSpeech) {
        currentSpeech.resume();
        state = 'speaking';
        updateUi();
        return;
      }

      if (currentSpeech) {
        currentSpeech.stop();
        currentSpeech = null;
      }

      const sel = win.getSelection ? win.getSelection() : null;
      const selectedText = sel && !sel.isCollapsed ? sel.toString().trim() : '';
      const target = selectedText || s.page.main() || doc.body;

      const rate = getRate();
      state = 'speaking';
      updateUi();

      const handle = s.speech.say(target, {
        speechRate: rate,
        onWord: (range) => {
          if (state === 'done' || state === 'stopped') return;
          if (range) {
            hl.move(range);
          } else {
            hl.clear();
          }
        },
      });

      currentSpeech = handle;
      handle.done.then((completed) => {
        if (currentSpeech === handle) {
          currentSpeech = null;
          state = 'stopped';
          hl.clear();
          updateUi();
          if (completed) {
            s.announce('Finished reading.');
          }
        }
      });
    }

    function pause() {
      if (state === 'speaking' && currentSpeech) {
        currentSpeech.pause();
        state = 'paused';
        updateUi();
      }
    }

    function stop() {
      if (currentSpeech) {
        const h = currentSpeech;
        currentSpeech = null;
        h.stop();
      }
      state = 'stopped';
      hl.clear();
      updateUi();
    }

    function togglePlay() {
      if (state === 'speaking') {
        pause();
      } else {
        speak();
      }
    }

    s.listen(playBtn, 'click', () => {
      togglePlay();
    });

    s.listen(stopBtn, 'click', () => {
      stop();
    });

    s.listen(slowerBtn, 'click', async () => {
      const cur = getRate();
      const next = Math.max(0.5, Math.min(2.0, Math.round((cur - 0.1) * 10) / 10));
      await s.profile.set({ speechRate: next });
      updateUi();
      s.announce(`Speaking speed ${next.toFixed(1)} on this site.`);
    });

    s.listen(fasterBtn, 'click', async () => {
      const cur = getRate();
      const next = Math.max(0.5, Math.min(2.0, Math.round((cur + 0.1) * 10) / 10));
      await s.profile.set({ speechRate: next });
      updateUi();
      s.announce(`Speaking speed ${next.toFixed(1)} on this site.`);
    });

    s.listen(useAllBtn, 'click', async () => {
      const cur = getRate();
      await s.profile.set({ speechRate: cur }, { scope: 'all' });
      s.announce(`Speaking speed ${cur.toFixed(1)} for every site.`);
    });

    s.keys.shortcut({ code: 'KeyR', alt: true, shift: true }, () => {
      togglePlay();
    });

    s.listen(doc, 'keydown', (e) => {
      if (e.key === 'Escape') {
        if (state !== 'stopped') {
          stop();
        }
      }
    }, true);

    s.profile.onChange((personal, changed) => {
      if (changed && 'speechRate' in changed) {
        updateUi();
      }
    });

    s.onEnd(() => {
      stop();
    });

    return true;
  },

  disable() {
    this.s?.end();
  },
};
