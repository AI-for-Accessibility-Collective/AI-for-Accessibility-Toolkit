// read-aloud.js — Reads main content or selected text aloud with word highlighting.
// Barrier: Blind people, people with low vision, learning disabilities, or reading
// difficulties need spoken text with visible word tracking to follow along.
//
// Suggested in onboarding for: reading, vision (a suggestion only, never a gate).
// The person's settings it reads: speechRate (speaking rate, 0.5 to 2.0).
// What the person can adjust: speechRate with Slower and Faster buttons in its
// control bar (steps of 0.1, 0.5 to 2), and with the person's shortcut (s.keys.adjust,
// label 'Speech rate', settings ['speechRate']): up faster, down slower. Saved for
// this site and announced.
//
// Options:
//   speechRate: Default speaking rate (0.5 to 2.0). Default: 1.0. Profile overrides.
//   pitch: Speaking pitch (0.0 to 2.0). Default: 1.0.
//   lang: BCP-47 language tag (e.g. 'en-US'). Default: undefined (uses page language).
//   voice: Preferred voice name. Default: null.
//   target: Selector string or element to read. Default: undefined (uses s.page.main()).
//
// Decisions:
//   • Starts speech only from its own Play button, never on load.
//   • Escape stops speech immediately.
//   • Control bar provides Play/Pause, Stop, Slower, Faster controls.
//   • Controls are sized at least 24x24 px (WCAG 2.5.8) with discernible names and 3:1 focus outlines.
//   • Placed fixed at bottom-right with bottom padding on the body so it covers no content (WCAG 2.4.11).
//   • Skips navigation, the toolkit's UI, and hidden text (display:none, aria-hidden, hidden attribute).
//   • Highlighting uses CSS Custom Highlight API via s.highlight.range, clearing on stop.
//   • Speech rate changes while speaking seamlessly continue from the current word at the new rate.
//   • Rate changes are saved for this site (s.profile.set) and announced via s.announce.
//   • Registers s.keys.adjust so the person's shortcut adjusts speech rate.
//
// What it cannot do:
//   • Cannot read content inaccessible to the browser's text walker or inside cross-origin iframes.
//   • Does not provide synthetic voice generation beyond what the browser / OS TTS provides.

export default {
  enable(options = {}, toolkit) {
    if (this.s && !this.s.ended) return;
    this.options = options || {};
    this.toolkit = toolkit || this.toolkit;
    if (!this.toolkit) return false;
    const s = (this.s = this.toolkit.session());
    const doc = document;
    const win = window;

    let currentHandle = null;
    let isPlaying = false;
    let isPaused = false;
    let fullText = '';
    let textMap = [];
    let currentOffsetInFull = 0;
    let currentAbsInUtterance = 0;
    let lastSpokenRate = 1.0;

    const hl = s.highlight.range(null);

    function getRate() {
      const profileRate = s.profile.get('speechRate');
      if (profileRate !== undefined && profileRate !== null && Number.isFinite(Number(profileRate))) {
        return Math.max(0.5, Math.min(2.0, Number(profileRate)));
      }
      const optRate = Number(options.speechRate);
      if (Number.isFinite(optRate)) {
        return Math.max(0.5, Math.min(2.0, optRate));
      }
      return 1.0;
    }

    function buildMap(el) {
      let text = '';
      const map = [];
      for (const node of s.page.textNodes(el)) {
        if (text && !/\s$/.test(text)) text += ' ';
        map.push({ node, start: text.length, end: text.length + node.nodeValue.length });
        text += node.nodeValue;
      }
      return { text, map };
    }

    function findRangeAt(abs) {
      if (!textMap || !textMap.length) return null;
      const entry = textMap.find((m) => abs >= m.start && abs < m.end);
      if (!entry) return null;
      const m = /^[\p{L}\p{N}'’-]+/u.exec(fullText.slice(abs));
      const len = m ? m[0].length : 1;
      const r = doc.createRange();
      const from = abs - entry.start;
      r.setStart(entry.node, from);
      r.setEnd(entry.node, Math.min(entry.node.nodeValue.length, from + Math.max(1, len)));
      return r;
    }

    const stop = () => {
      if (currentHandle) {
        currentHandle.stop();
        currentHandle = null;
      }
      isPlaying = false;
      isPaused = false;
      currentOffsetInFull = 0;
      currentAbsInUtterance = 0;
      hl.clear();
      updateButtons();
    };

    function startSpeaking(inputToSay, offsetInFull) {
      currentOffsetInFull = offsetInFull;
      currentAbsInUtterance = 0;
      const rate = getRate();
      lastSpokenRate = rate;

      const handle = s.speech.say(inputToSay, {
        speechRate: rate,
        pitch: options.pitch,
        lang: options.lang,
        voice: options.voice,
        waitForGesture: false,
        onWord: (range, abs) => {
          if (abs < 0) {
            hl.clear();
            return;
          }
          currentAbsInUtterance = abs;
          if (range) {
            hl.move(range);
          } else if (textMap.length) {
            const r = findRangeAt(currentOffsetInFull + abs);
            if (r) hl.move(r);
          }
        },
      });

      currentHandle = handle;
      isPlaying = true;
      isPaused = false;
      updateButtons();

      handle.done.then(() => {
        if (currentHandle === handle) {
          isPlaying = false;
          isPaused = false;
          currentHandle = null;
          hl.clear();
          updateButtons();
        }
      });
    }

    function playOrPause() {
      // If currently paused, resume
      if (currentHandle && isPaused) {
        currentHandle.resume();
        isPaused = false;
        updateButtons();
        return;
      }

      // If currently speaking, pause
      if (currentHandle && isPlaying) {
        currentHandle.pause();
        isPaused = true;
        updateButtons();
        return;
      }

      // Start speaking: check selection first
      const sel = win.getSelection ? win.getSelection() : null;
      const selText = sel && !sel.isCollapsed ? sel.toString().trim() : '';

      if (selText) {
        fullText = selText;
        textMap = [];
        startSpeaking(selText, 0);
        return;
      }

      // Target main content
      const mainTarget = (typeof options.target === 'string'
        ? doc.querySelector(options.target)
        : options.target) || s.page.main();

      if (!mainTarget) return;

      const mapped = buildMap(mainTarget);
      fullText = mapped.text;
      textMap = mapped.map;
      if (!fullText.trim()) return;

      startSpeaking(mainTarget, 0);
    }

    function restartFromCurrentWord(newRate) {
      if (!currentHandle || !isPlaying || isPaused) return;
      const currentPos = currentOffsetInFull + currentAbsInUtterance;
      const remaining = fullText.slice(currentPos);
      if (!remaining.trim()) {
        stop();
        return;
      }
      currentHandle.stop();
      startSpeaking(remaining, currentPos);
    }

    async function changeRate(delta) {
      const cur = getRate();
      const next = Math.max(0.5, Math.min(2.0, Math.round((cur + delta) * 10) / 10));
      const res = await s.profile.set({ speechRate: next });
      if (res && res.applied) {
        const appliedRate = s.profile.get('speechRate') ?? next;
        s.announce(`Speech rate ${appliedRate} on this site.`);
        if (isPlaying && !isPaused) {
          restartFromCurrentWord(appliedRate);
        }
      }
    }

    s.keys.adjust({
      label: 'Speech rate',
      settings: ['speechRate'],
      up: () => changeRate(0.1),
      down: () => changeRate(-0.1),
    });

    s.listen(doc, 'keydown', (e) => {
      if (e.key === 'Escape' && isPlaying) {
        stop();
      }
    }, true);

    s.profile.onChange((personal, changed) => {
      if (changed && 'speechRate' in changed) {
        const newRate = personal.speechRate;
        if (isPlaying && !isPaused && newRate !== lastSpokenRate) {
          restartFromCurrentWord(newRate);
        }
      }
    });

    s.css('read-aloud-style', `
      .ai4a11y-read-aloud-bar {
        position: fixed;
        bottom: 16px;
        right: 16px;
        z-index: 2147483645;
        display: flex;
        gap: 6px;
        align-items: center;
        padding: 6px 8px;
        background: #ffffff;
        color: #000000;
        border: 2px solid #333333;
        border-radius: 8px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
        font: 14px/1.4 system-ui, -apple-system, sans-serif;
        max-width: calc(100vw - 24px);
        box-sizing: border-box;
      }
      .ai4a11y-read-aloud-bar button {
        min-width: 44px;
        min-height: 28px;
        line-height: 20px;
        padding: 4px 8px;
        font: inherit;
        font-weight: 500;
        color: #000000;
        background: #ffffff;
        border: 1px solid #767676;
        border-radius: 4px;
        cursor: pointer;
        box-sizing: border-box;
      }
      .ai4a11y-read-aloud-bar button:hover {
        background: #f0f0f0;
      }
      .ai4a11y-read-aloud-bar button:focus-visible {
        outline: 2px solid #005fcc;
        outline-offset: 2px;
      }
    `);

    s.setStyle(doc.body, 'paddingBottom', '64px');
    s.focus.keepVisible();

    const bar = s.el('div', {
      attrs: {
        role: 'region',
        'aria-label': 'Read aloud controls',
        class: 'ai4a11y-read-aloud-bar',
      },
    });

    const btnPlay = s.el('button', {
      text: 'Play',
      attrs: { type: 'button', 'aria-label': 'Play', 'data-action': 'play' },
    });

    const btnStop = s.el('button', {
      text: 'Stop',
      attrs: { type: 'button', 'aria-label': 'Stop', 'data-action': 'stop' },
    });

    const btnSlower = s.el('button', {
      text: 'Slower',
      attrs: { type: 'button', 'aria-label': 'Slower', 'data-action': 'slower' },
    });

    const btnFaster = s.el('button', {
      text: 'Faster',
      attrs: { type: 'button', 'aria-label': 'Faster', 'data-action': 'faster' },
    });

    function updateButtons() {
      if (isPlaying && !isPaused) {
        btnPlay.textContent = 'Pause';
        btnPlay.setAttribute('aria-label', 'Pause');
      } else if (isPaused) {
        btnPlay.textContent = 'Play';
        btnPlay.setAttribute('aria-label', 'Play');
      } else {
        btnPlay.textContent = 'Play';
        btnPlay.setAttribute('aria-label', 'Play');
      }
    }

    s.listen(btnPlay, 'click', () => playOrPause());
    s.listen(btnStop, 'click', () => stop());
    s.listen(btnSlower, 'click', () => changeRate(-0.1));
    s.listen(btnFaster, 'click', () => changeRate(0.1));

    bar.append(btnPlay, btnStop, btnSlower, btnFaster);
    s.append(doc.body, bar);

    this.play = playOrPause;
    this.stop = stop;
    this.changeRate = changeRate;
    this.getRate = getRate;
    Object.defineProperty(this, 'speaking', { get: () => isPlaying && !isPaused, configurable: true });
    Object.defineProperty(this, 'paused', { get: () => isPaused, configurable: true });
    Object.defineProperty(this, 'currentHandle', { get: () => currentHandle, configurable: true });
  },

  disable() {
    this.stop?.();
    this.s?.end();
    this.s = null;
  },
};
