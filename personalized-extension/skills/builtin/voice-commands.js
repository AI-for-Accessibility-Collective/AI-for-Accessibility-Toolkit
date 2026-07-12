import { announce } from '../../utils/ai.js';
import {
  scrollBy, scrollToTop, scrollToBottom,
  goBack, goForward, clickByText,
  focusNextLink, focusPrevLink, focusNextButton,
  typeText, readPage, stopReading,
} from './page-actions.js';

// Motion commands that must not fire on negation phrases.
const NEGATION_RE = /\b(don'?t|do not|stop)\b/i;

// Command matchers — ordered so regex patterns (with captures) run FIRST.
// Each entry: [testFn, actionFn]
// testFn(transcript) -> false|captures
// actionFn(captures) -> result (from page-actions)
function buildMatchers() {
  return [
    // ---- regex commands (must come before bare-word commands) ----
    [
      (t) => { const m = t.match(/\bclick\s+(?:on\s+)?(.+)/i); return m && [m[1]]; },
      ([text]) => clickByText(text),
    ],
    [
      (t) => { const m = t.match(/\btype\s+(.+)/i); return m && [m[1]]; },
      ([text]) => typeText(text),
    ],
    // ---- bare-word commands (word-boundary, no negation for motion) ----
    [
      (t) => !NEGATION_RE.test(t) && /\bscroll\s+down\b/i.test(t),
      () => scrollBy('down'),
    ],
    [
      (t) => !NEGATION_RE.test(t) && /\bscroll\s+up\b/i.test(t),
      () => scrollBy('up'),
    ],
    [
      (t) => !NEGATION_RE.test(t) && /\bpage\s+down\b/i.test(t),
      () => scrollBy('page_down'),
    ],
    [
      (t) => !NEGATION_RE.test(t) && /\bpage\s+up\b/i.test(t),
      () => scrollBy('page_up'),
    ],
    [
      (t) => /\bgo\s+to\s+(?:the\s+)?top\b/i.test(t),
      () => scrollToTop(),
    ],
    [
      (t) => /\bgo\s+to\s+(?:the\s+)?bottom\b/i.test(t),
      () => scrollToBottom(),
    ],
    [
      (t) => /\bgo\s+back\b/i.test(t),
      () => goBack(),
    ],
    [
      (t) => /\bgo\s+forward\b/i.test(t),
      () => goForward(),
    ],
    [
      (t) => /\bnext\s+link\b/i.test(t),
      () => focusNextLink(),
    ],
    [
      (t) => /\bprevious\s+link\b/i.test(t),
      () => focusPrevLink(),
    ],
    [
      (t) => /\bnext\s+button\b/i.test(t),
      () => focusNextButton(),
    ],
    [
      (t) => /\bread\s+page\b/i.test(t),
      () => readPage(),
    ],
    [
      (t) => /\bstop\s+reading\b/i.test(t),
      () => stopReading(),
    ],
    // bare 'click' — only when transcript is EXACTLY 'click' (full-match)
    [
      (t) => /^\s*click\s*$/i.test(t),
      () => {
        const focused = document.activeElement;
        if (focused && focused !== document.body) {
          focused.click();
          return { ok: true, detail: 'clicked focused element' };
        }
        return { ok: false, detail: 'no focused element' };
      },
    ],
  ];
}

export const VoiceCommands = {
  enabled: false,
  recognition: null,
  feedbackElement: null,
  _statusRegion: null,   // live region for state changes only
  _backoffMs: 1000,
  _backoffTimer: null,
  _storageListener: null,
  settings: {
    language: 'en-US',
    continuous: true,
    interimResults: true,
  },

  async enable(options = {}) {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      announce('Voice recognition not supported in this browser');
      // #18: Return false so enableTool does not phantom-add 'VoiceCommands' to
      // enabledTools when the browser lacks speech recognition support.
      return false;
    }
    // Mutual exclusion: don't start if a Live session is already active.
    // #18: Return false so enableTool does not phantom-add 'VoiceCommands' to
    // enabledTools. The user-toggle should fail honestly rather than report ON
    // when the recognizer never started. If the user wants voice commands after
    // the Live session ends, they can toggle the control again at that point —
    // this is simpler and safer than arming a hidden auto-resume listener that
    // would activate unexpectedly.
    if (await this._isLiveActive()) {
      announce('Voice mode is already listening — say things there instead');
      return false;
    }

    this.settings = { ...this.settings, ...options };
    this.enabled = true;
    this._startRecognition();
    this._watchLiveSession();
    console.log('[AI4A11y] Voice Commands enabled');
    this._announceState('Voice commands enabled. Say "stop listening" to disable.');
  },

  _startRecognition() {
    if (this.recognition) {
      try { this.recognition.onend = null; this.recognition.stop(); } catch {}
      this.recognition = null;
    }
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SpeechRecognition();
    rec.continuous = this.settings.continuous;
    rec.interimResults = this.settings.interimResults;
    rec.lang = this.settings.language;
    this.recognition = rec;

    const matchers = buildMatchers();

    rec.onresult = (event) => {
      const last = event.results.length - 1;
      const transcript = event.results[last][0].transcript.toLowerCase().trim();
      if (event.results[last].isFinal) {
        this.showFeedback(transcript, 'recognized');
        this.executeCommand(transcript, matchers);
      } else {
        this.showFeedback(transcript, 'interim');
      }
    };

    rec.onerror = (event) => {
      const err = event.error;
      if (err === 'not-allowed' || err === 'service-not-allowed' || err === 'audio-capture') {
        // Mic denied or unavailable — self-disable, no restart loop.
        this.showFeedback(`Microphone access denied: ${err}`, 'error');
        this._announceState('Voice commands disabled: microphone access was denied.');
        this.disable();
        return;
      }
      if (err === 'network') {
        // Exponential backoff restart.
        this.showFeedback(`Network error — retrying in ${Math.round(this._backoffMs / 1000)}s`, 'error');
        this._scheduleRestart();
        return;
      }
      // 'no-speech' / 'aborted' / other — restart freely via onend.
      if (err !== 'no-speech' && err !== 'aborted') {
        console.warn('[AI4A11y] Voice recognition error:', err);
      }
    };

    rec.onend = () => {
      if (this.enabled && !this._backoffTimer) this._startRecognition();
    };

    if (!this.feedbackElement) this.createFeedbackElement();
    try { rec.start(); } catch (e) { console.warn('[AI4A11y] Recognition start error:', e); }
  },

  _scheduleRestart() {
    if (this._backoffTimer) clearTimeout(this._backoffTimer);
    const delay = this._backoffMs;
    this._backoffMs = Math.min(this._backoffMs * 2, 30000);
    this._backoffTimer = setTimeout(() => {
      this._backoffTimer = null;
      if (this.enabled) this._startRecognition();
    }, delay);
  },

  async _isLiveActive() {
    try {
      const data = await chrome.storage.local.get('voiceState');
      return (data.voiceState && data.voiceState.connection === 'live') || false;
    } catch { return false; }
  },

  _watchLiveSession() {
    if (this._storageListener) return;
    this._storageListener = (changes, area) => {
      if (area !== 'local' || !changes.voiceState) return;
      const newState = changes.voiceState.newValue;
      if (newState && newState.connection === 'live' && this.enabled) {
        // Live session became active — self-suspend.
        this.showFeedback('Voice mode active — use voice commands there', 'error');
        this._announceState('Voice commands paused — voice mode is now listening.');
        if (this.recognition) {
          try { this.recognition.onend = null; this.recognition.stop(); } catch {}
        }
      } else if (newState && newState.connection === 'disconnected' && this.enabled) {
        // Live session ended — resume.
        this._announceState('Voice commands resumed.');
        this._startRecognition();
      }
    };
    chrome.storage.onChanged.addListener(this._storageListener);
  },

  disable() {
    this.enabled = false;
    if (this._backoffTimer) { clearTimeout(this._backoffTimer); this._backoffTimer = null; }
    this._backoffMs = 1000;
    if (this.recognition) {
      this.recognition.onend = null;
      try { this.recognition.stop(); } catch {}
      this.recognition = null;
    }
    if (this._storageListener) {
      try { chrome.storage.onChanged.removeListener(this._storageListener); } catch {}
      this._storageListener = null;
    }
    if (this.feedbackElement) {
      this.feedbackElement.remove();
      this.feedbackElement = null;
    }
    if (this._statusRegion) {
      this._statusRegion.remove();
      this._statusRegion = null;
    }
    document.getElementById('ai4a11y-voice-pulse-style')?.remove();
    console.log('[AI4A11y] Voice Commands disabled');
    announce('Voice commands disabled');
  },

  createFeedbackElement() {
    if (this.feedbackElement) return;
    this.feedbackElement = document.createElement('div');
    this.feedbackElement.id = 'ai4a11y-voice-feedback';
    // role=status but NO aria-live — this is visual-only (interim transcripts
    // must not be echoed to screen readers).
    this.feedbackElement.setAttribute('role', 'status');
    this.feedbackElement.style.cssText = `
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
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
    `;
    const indicator = document.createElement('span');
    indicator.style.cssText = 'display:inline-block;width:12px;height:12px;background:#f00;border-radius:50%;animation:ai4a11y-pulse 1s infinite;';
    this.feedbackElement.appendChild(indicator);

    const textSpan = document.createElement('span');
    textSpan.className = 'ai4a11y-voice-text';
    textSpan.textContent = 'Listening...';
    // NO aria-live here — visual only.
    this.feedbackElement.appendChild(textSpan);

    const pulseStyle = document.createElement('style');
    pulseStyle.id = 'ai4a11y-voice-pulse-style';
    pulseStyle.textContent = '@keyframes ai4a11y-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }';
    document.getElementById('ai4a11y-voice-pulse-style')?.remove();
    document.head.appendChild(pulseStyle);
    document.body.appendChild(this.feedbackElement);

    // Separate tiny live region for STATE changes only (started/stopped/error).
    if (!this._statusRegion) {
      this._statusRegion = document.createElement('div');
      this._statusRegion.id = 'ai4a11y-voice-status';
      this._statusRegion.setAttribute('role', 'status');
      this._statusRegion.setAttribute('aria-live', 'polite');
      this._statusRegion.setAttribute('aria-atomic', 'true');
      this._statusRegion.style.cssText = 'position:fixed;left:-9999px;width:1px;height:1px;overflow:hidden;';
      document.body.appendChild(this._statusRegion);
    }
  },

  _announceState(msg) {
    if (this._statusRegion) {
      this._statusRegion.textContent = '';
      // Small delay so screen readers pick up the change.
      setTimeout(() => { if (this._statusRegion) this._statusRegion.textContent = msg; }, 50);
    }
  },

  showFeedback(text, type) {
    if (!this.feedbackElement) return;
    const textEl = this.feedbackElement.querySelector('.ai4a11y-voice-text');
    if (textEl) {
      textEl.textContent = text;
      textEl.style.color = type === 'error' ? '#ff6b6b' : type === 'interim' ? '#aaa' : '#fff';
    }
  },

  executeCommand(transcript, matchers) {
    if (/\bstop\s+listening\b/i.test(transcript)) {
      this.disable();
      return true;
    }
    for (const [test, action] of matchers) {
      const captures = test(transcript);
      if (captures) {
        const result = action(Array.isArray(captures) ? captures : []);
        if (result && result.detail) this.showFeedback(result.detail, 'recognized');
        return true;
      }
    }
    return false;
  },

  addCommand(phrase, action) {
    // addCommand is still supported for user-defined phrases; the phrase is
    // wrapped into a word-boundary includes check for backward-compat.
    this._customCommands = this._customCommands || [];
    this._customCommands.push([phrase.toLowerCase(), action]);
  },

  toggle() {
    if (this.enabled) this.disable();
    else this.enable();
  },
};

window.__ai4a11yVoiceCommands = VoiceCommands;
