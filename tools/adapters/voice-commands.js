// Voice Commands - navigate and control page using voice
//
// Say "click" and the name of a button or link ("click add to cart"),
// "scroll down", "go to top", "next link", "type hello", "stop listening".
//
// Everything it hears and does is announced through announce(); the little
// "Listening…" box is visual only (aria-hidden). It used to be a polite live
// region too, so a screen reader read every half-heard word as it changed.
//
// Without a microphone (denied, missing, or the speech service unreachable)
// it says so once and stops trying. A 'network' or 'aborted' error used to
// restart recognition straight away from onend, again and again, with no
// limit; now repeated failures back off and then give up.
import { announce } from '../utils/ai.js';

const FATAL = ['not-allowed', 'service-not-allowed', 'audio-capture'];
const MAX_FAILURES = 4;      // consecutive errors without hearing anything, then give up
const NOTICE_MS = 6000;      // how long the "can't use the microphone" note stays up
const CLICKABLE = 'a[href], button, input[type="submit"], input[type="button"], input[type="checkbox"], input[type="radio"], ' +
  'summary, label, select, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="checkbox"], [role="radio"], [onclick], [tabindex]:not([tabindex="-1"])';

function squash(s) { return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase(); }
// What a person would call the control: its label, else its words.
function nameOf(el) {
  return squash(el.getAttribute('aria-label') || el.textContent || el.value || el.getAttribute('title') ||
    el.querySelector?.('img[alt]')?.getAttribute('alt') || '');
}
function visible(el) {
  if (!el.getClientRects().length) return false;
  const s = getComputedStyle(el);
  return s.visibility !== 'hidden' && s.display !== 'none';
}

export const VoiceCommands = {
  enabled: false,
  recognition: null,
  feedbackElement: null,
  _fatal: false,
  _failures: 0,
  _restartTimer: null,
  _noticeTimer: null,
  settings: {
    language: 'en-US',
    continuous: true,
    interimResults: true
  },

  commands: {
    'scroll down': () => window.scrollBy(0, 300),
    'scroll up': () => window.scrollBy(0, -300),
    'page down': () => window.scrollBy(0, window.innerHeight),
    'page up': () => window.scrollBy(0, -window.innerHeight),
    'go to top': () => window.scrollTo(0, 0),
    'go to bottom': () => window.scrollTo(0, document.body.scrollHeight),
    'go back': () => history.back(),
    'go forward': () => history.forward(),
    'refresh': () => location.reload(),
    'click': () => {
      const focused = document.activeElement;
      if (focused && focused !== document.body) {
        focused.click();
      }
    },
    'next link': () => {
      const links = Array.from(document.querySelectorAll('a[href]')).filter(visible);
      const current = document.activeElement;
      const idx = links.indexOf(current);
      if (idx < links.length - 1) links[idx + 1].focus();
      else if (links.length > 0) links[0].focus();
    },
    'previous link': () => {
      const links = Array.from(document.querySelectorAll('a[href]')).filter(visible);
      const current = document.activeElement;
      const idx = links.indexOf(current);
      if (idx > 0) links[idx - 1].focus();
      else if (links.length > 0) links[links.length - 1].focus();
    },
    'next button': () => {
      const buttons = Array.from(document.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"]')).filter(visible);
      const current = document.activeElement;
      const idx = buttons.indexOf(current);
      if (idx < buttons.length - 1) buttons[idx + 1].focus();
      else if (buttons.length > 0) buttons[0].focus();
    },
    'read page': () => window.__ai4a11yReadAloud?.speakPage(),
    'stop reading': () => window.__ai4a11yReadAloud?.stop()
  },

  enable(options = {}) {
    // Idempotent: a second enable() would spawn a second SpeechRecognition
    // (two mic streams, each command firing twice) while the first keeps
    // restarting itself via onend.
    if (this.enabled) return;
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      announce('Voice recognition not supported in this browser');
      return;
    }

    this.settings = { ...this.settings, ...options };
    this._fatal = false;
    this._failures = 0;
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.recognition = new SpeechRecognition();
    this.recognition.continuous = this.settings.continuous;
    this.recognition.interimResults = this.settings.interimResults;
    this.recognition.lang = this.settings.language;

    this.recognition.onresult = (event) => {
      this._failures = 0; // it hears: the microphone works
      const last = event.results.length - 1;
      const transcript = event.results[last][0].transcript.toLowerCase().trim();
      if (event.results[last].isFinal) {
        this.showFeedback(transcript, 'recognized');
        this.executeCommand(transcript);
      } else {
        this.showFeedback(transcript, 'interim');
      }
    };

    this.recognition.onerror = (event) => {
      if (event.error === 'no-speech') return; // silence is normal
      // Permission/hardware failures won't fix themselves — stop the restart
      // loop instead of spinning start→error→end→start until manual disable.
      this._failures++;
      if (FATAL.includes(event.error) || this._failures >= MAX_FAILURES) this._giveUp(event.error);
      else this.showFeedback('Trouble hearing. Trying again…', 'error');
    };

    this.recognition.onend = () => {
      if (!this.enabled || this._fatal) return;
      // Chrome ends recognition after a silence; start again, slower after errors.
      clearTimeout(this._restartTimer);
      this._restartTimer = setTimeout(() => {
        this._restartTimer = null;
        if (!this.enabled || this._fatal || !this.recognition) return;
        try { this.recognition.start(); } catch { /* already started / stopping */ }
      }, this._failures ? 500 * this._failures : 0);
    };

    this.createFeedbackElement();
    this.enabled = true;
    try {
      this.recognition.start();
    } catch (e) {
      this._giveUp(e && e.name);
      return;
    }
    console.log('[AI4A11y] Voice Commands enabled');
    announce('Voice commands on. Say "click" and a button\'s name, "scroll down", or "stop listening".');
  },

  // The microphone can't be used: say so once, stop listening, and take the
  // note down after a moment instead of leaving a pulsing "Error" on the page.
  _giveUp(error) {
    if (this._fatal) return;
    this._fatal = true;
    const msg = /not-allowed|NotAllowed|service-not-allowed/.test(String(error))
      ? 'Voice commands can\'t use the microphone. Allow it in the browser to use them'
      : 'Voice commands can\'t hear anything: no microphone or speech service';
    announce(msg);
    this.showFeedback(msg, 'error');
    if (this.feedbackElement) this.feedbackElement.classList.add('ai4a11y-voice-off');
    try { this.recognition && this.recognition.abort(); } catch { /* already stopped */ }
    clearTimeout(this._noticeTimer);
    this._noticeTimer = setTimeout(() => {
      this._noticeTimer = null;
      if (this.feedbackElement) this.feedbackElement.style.display = 'none';
    }, NOTICE_MS);
  },

  disable() {
    if (!this.enabled && !this.recognition && !this.feedbackElement) return;
    this.enabled = false;
    clearTimeout(this._restartTimer); this._restartTimer = null;
    clearTimeout(this._noticeTimer); this._noticeTimer = null;
    if (this.recognition) {
      this.recognition.onend = null;
      this.recognition.onresult = null;
      this.recognition.onerror = null;
      try { this.recognition.stop(); } catch { /* never started */ }
      this.recognition = null;
    }
    if (this.feedbackElement) {
      this.feedbackElement.remove();
      this.feedbackElement = null;
    }
    document.getElementById('ai4a11y-voice-pulse-style')?.remove();
    console.log('[AI4A11y] Voice Commands disabled');
    announce('Voice commands off');
  },

  createFeedbackElement() {
    if (this.feedbackElement) return;

    this.feedbackElement = document.createElement('div');
    this.feedbackElement.id = 'ai4a11y-voice-feedback';
    // Visual only: what it heard and did is announced through announce().
    this.feedbackElement.setAttribute('aria-hidden', 'true');
    this.feedbackElement.style.cssText = `
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      width: max-content;
      max-width: calc(100vw - 32px);
      box-sizing: border-box;
      background: rgba(0, 0, 0, 0.85);
      color: white;
      padding: 12px 24px;
      border-radius: 8px;
      font-family: system-ui, sans-serif;
      font-size: 16px;
      z-index: 999999;
      display: flex;
      align-items: center;
      gap: 10px;
      pointer-events: none;
    `;

    const indicator = document.createElement('span');
    indicator.className = 'ai4a11y-voice-dot';
    indicator.style.cssText = 'display:inline-block;flex:none;width:12px;height:12px;background:#f00;border-radius:50%;';
    this.feedbackElement.appendChild(indicator);

    const textSpan = document.createElement('span');
    textSpan.className = 'ai4a11y-voice-text';
    textSpan.textContent = 'Listening...';
    this.feedbackElement.appendChild(textSpan);

    const pulseStyle = document.createElement('style');
    pulseStyle.id = 'ai4a11y-voice-pulse-style';
    pulseStyle.textContent = '@keyframes ai4a11y-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }' +
      '.ai4a11y-voice-dot { animation: ai4a11y-pulse 1s infinite; }' +
      '.ai4a11y-voice-off .ai4a11y-voice-dot { animation: none; background: #888 !important; }' +
      '@media (prefers-reduced-motion: reduce) { .ai4a11y-voice-dot { animation: none; } }';
    document.getElementById('ai4a11y-voice-pulse-style')?.remove();
    document.head.appendChild(pulseStyle);
    document.body.appendChild(this.feedbackElement);
  },

  showFeedback(text, type) {
    if (!this.feedbackElement) return;
    const textEl = this.feedbackElement.querySelector('.ai4a11y-voice-text');
    if (textEl) {
      textEl.textContent = text;
      textEl.style.color = type === 'error' ? '#ff9b9b' : type === 'interim' ? '#ccc' : '#fff';
    }
  },

  executeCommand(transcript) {
    transcript = squash(transcript);
    if (transcript.includes('stop listening')) {
      this.disable();
      return true;
    }

    // "click add to cart" before the bare "click" command, which would
    // otherwise match first and click whatever had focus.
    const clickMatch = transcript.match(/^(?:click|press|tap)(?: on)? (.+)$/);
    if (clickMatch && !/^(it|this|that)$/.test(clickMatch[1])) {
      const el = this.findElementByText(clickMatch[1]);
      if (el) {
        el.click();
        if (el.isConnected) el.focus({ preventScroll: true });
        announce(`Clicked ${nameOf(el).slice(0, 60)}`);
      } else {
        announce(`Nothing called "${clickMatch[1]}" to click`);
      }
      return !!el;
    }

    const typeMatch = transcript.match(/^type (.+)/);
    if (typeMatch) {
      const field = document.activeElement;
      if (field && field.matches('input, textarea')) {
        field.value += typeMatch[1];
        field.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      }
      announce('Go to a text field first, then say "type" and the words');
      return false;
    }

    for (const [phrase, action] of Object.entries(this.commands)) {
      if (transcript === phrase || transcript.includes(phrase)) {
        action();
        return true;
      }
    }
    announce(`No command for "${transcript}"`);
    return false;
  },

  // The visible control whose name matches best: the exact name, then one
  // that starts with it, then one that contains it. Includes things a page
  // made clickable with a script (a pointer cursor), like a <div> button.
  findElementByText(text) {
    const want = squash(text);
    if (!want) return null;
    const seen = new Set(document.querySelectorAll(CLICKABLE));
    for (const el of document.querySelectorAll('div, span, li, img')) {
      if (!seen.has(el) && getComputedStyle(el).cursor === 'pointer' && !el.parentElement?.closest(CLICKABLE)) seen.add(el);
    }
    const tiers = [[], [], []];
    for (const el of seen) {
      if (el.closest('#ws-root, #ai4a11y-voice-feedback')) continue;
      const name = nameOf(el);
      if (!name) continue;
      const tier = name === want ? 0 : name.startsWith(want) ? 1 : name.includes(want) ? 2 : -1;
      if (tier >= 0 && visible(el)) tiers[tier].push(el);
    }
    return tiers[0][0] || tiers[1][0] || tiers[2][0] || null;
  },

  addCommand(phrase, action) {
    this.commands[phrase.toLowerCase()] = action;
  },

  toggle() {
    if (this.enabled) this.disable();
    else this.enable();
  }
};

if (typeof window !== 'undefined') window.__ai4a11yVoiceCommands = VoiceCommands;
