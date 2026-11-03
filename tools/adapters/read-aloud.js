// Read Aloud - text-to-speech with word highlighting
import { announce } from '../utils/ai.js';

// Not read: page furniture, things hidden from listeners, form menus (a
// <select> would read every option), and live regions (their messages are
// read by the screen reader already).
const SKIP_SEL = 'script, style, noscript, template, select, textarea, nav, header, footer, aside, ' +
  '[role="navigation"], [role="banner"], [role="contentinfo"], [role="complementary"], ' +
  '[aria-hidden="true"], [hidden], [aria-live]:not([aria-live="off"]), [role="status"], [role="alert"], [role="log"]';
// Elements that start a new line of text: the speech pauses between them.
const BLOCK_TAGS = new Set(['P', 'DIV', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TD', 'TH', 'TR', 'DT', 'DD',
  'SECTION', 'ARTICLE', 'BLOCKQUOTE', 'FIGCAPTION', 'CAPTION', 'LEGEND', 'FIELDSET', 'LABEL', 'BUTTON', 'SUMMARY', 'BR']);
// Chrome stops some voices partway through a long utterance, and one
// utterance for a whole page is many minutes long. Speak sentence-sized pieces.
const CHUNK_CHARS = 220;

export const ReadAloud = {
  speaking: false,
  paused: false,
  utterance: null,
  currentWord: 0,
  words: [],
  run: 0,              // bumped by stop(); callbacks from an older run are ignored
  gestureHandler: null, // waiting for a click or key to start (see waitForGesture)
  settings: {
    rate: 1.0,
    pitch: 1.0,
    volume: 1.0,
    voice: null,
    highlightColor: '#ffeb3b'
  },

  getVoices() {
    try {
      return (typeof speechSynthesis !== 'undefined') ? speechSynthesis.getVoices() : [];
    } catch {
      return [];
    }
  },

  setVoice(voiceName) {
    const voices = this.getVoices();
    this.settings.voice = voices.find(v => v.name === voiceName) || null;
  },

  setRate(rate) {
    const num = Number(rate);
    if (!Number.isNaN(num) && Number.isFinite(num)) {
      this.settings.rate = Math.max(0.5, Math.min(2.0, num));
    }
  },

  speakSelection() {
    const selection = (typeof window !== 'undefined' && window.getSelection) ? window.getSelection() : null;
    const text = selection ? selection.toString().trim() : '';
    if (text) {
      this.speak(text);
    } else {
      announce('No text selected');
    }
  },

  speakPage(options = {}) {
    if (options.rate !== undefined) this.setRate(options.rate);
    if (options.voice !== undefined) this.setVoice(options.voice);
    // #main: the usual id of a main region built from a plain div.
    const main = (typeof document !== 'undefined') ? document.querySelector('main, article, [role="main"], #main, .content, #content') : null;
    const target = (typeof options.target === 'string' && typeof document !== 'undefined')
      ? document.querySelector(options.target)
      : (options.target || main || (typeof document !== 'undefined' ? document.body : null));
    const text = this.extractReadableText(target);
    if (text) {
      this.speak(text);
    } else {
      announce('Read aloud: no text to read on this page');
    }
  },

  // The text a sighted reader sees in element, in order, with a pause between
  // blocks. Text hidden on the page (closed menus, error boxes not shown yet)
  // is left out; visually hidden text meant for listeners is kept.
  extractReadableText(element) {
    if (!element) return '';
    const visible = (el) => {
      try {
        return typeof el.checkVisibility !== 'function' || el.checkVisibility({ visibilityProperty: true });
      } catch {
        return true;
      }
    };
    if (element.nodeType === 1 && ((element.matches && element.matches(SKIP_SEL)) || !visible(element))) return '';
    const parts = [];
    let lastBlock = null;
    let lastChar = '';
    const blockOf = (el) => {
      for (let e = el; e && e !== element; e = e.parentElement) {
        if (BLOCK_TAGS.has(e.tagName?.toUpperCase())) return e;
      }
      return element;
    };
    const walk = (el) => {
      for (let n = el.firstChild; n; n = n.nextSibling) {
        if (n.nodeType === 3) {
          const t = n.nodeValue.replace(/\s+/g, ' ');
          if (!t.trim()) { if (parts.length) parts.push(' '); continue; }
          const block = blockOf(el);
          if (block !== lastBlock && parts.length) {
            // A heading or label with no full stop runs into the next line when spoken.
            const addPeriod = !/[.!?:;,]$/.test(lastChar);
            parts.push(addPeriod ? '. ' : ' ');
            if (addPeriod) lastChar = '.';
          }
          lastBlock = block;
          parts.push(t);
          const trimmed = t.trim();
          if (trimmed) lastChar = trimmed[trimmed.length - 1];
        } else if (n.nodeType === 1 && !(n.matches && n.matches(SKIP_SEL)) && visible(n)) {
          walk(n);
        }
      }
    };
    try { walk(element); } catch { /* read what was gathered */ }
    return parts.join('').replace(/\s+/g, ' ').replace(/\s+([.,;:!?])/g, '$1').trim();
  },

  // Sentence-sized pieces, none longer than CHUNK_CHARS where a space allows.
  chunk(text) {
    if (!text || typeof text !== 'string') return [];
    const sentences = text.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) || [text];
    const out = [];
    let cur = '';
    for (let s of sentences) {
      while (s.length > CHUNK_CHARS) {
        const cut = s.lastIndexOf(' ', CHUNK_CHARS);
        const at = cut > 40 ? cut : CHUNK_CHARS;
        if (cur) { out.push(cur); cur = ''; }
        out.push(s.slice(0, at));
        s = s.slice(at);
      }
      if ((cur + s).length > CHUNK_CHARS && cur) { out.push(cur); cur = ''; }
      cur += s;
    }
    if (cur.trim()) out.push(cur);
    return out.map((c) => c.trim()).filter(Boolean);
  },

  // Browsers only start speech after the person has clicked or pressed a key
  // on the page. When reading was switched on as the page loaded (a saved
  // setting, a profile), wait for that first click or key, then start.
  waitForGesture(text, run) {
    if (this.gestureHandler || typeof document === 'undefined') return;
    this.speaking = false;
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
    announce('Read aloud is ready: click anywhere on the page or press a key to start');
    console.log('[AI4A11y] Read Aloud: waiting for a click or key press before speaking');
    this.gestureHandler = () => {
      this.clearGesture();
      if (run === this.run) this.speak(text);
    };
    document.addEventListener('pointerdown', this.gestureHandler, true);
    document.addEventListener('keydown', this.gestureHandler, true);
  },

  clearGesture() {
    if (!this.gestureHandler) return;
    if (typeof document !== 'undefined') {
      document.removeEventListener('pointerdown', this.gestureHandler, true);
      document.removeEventListener('keydown', this.gestureHandler, true);
    }
    this.gestureHandler = null;
  },

  async speak(text) {
    this.stop();
    if (!text) return;
    if (typeof EasySpeech === 'undefined' && typeof speechSynthesis === 'undefined') {
      announce('Text-to-speech is not available in this browser');
      return;
    }

    this.speaking = true;
    this.paused = false;
    this.words = text.split(/\s+/);
    this.currentWord = 0;

    if (typeof EasySpeech !== 'undefined') {
      try {
        await EasySpeech.init({ maxTimeout: 5000 });
        await EasySpeech.speak({
          text,
          rate: this.settings.rate,
          pitch: this.settings.pitch,
          volume: this.settings.volume,
          voice: this.settings.voice,
          boundary: (event) => {
            if (event.name === 'word' && this.words.length > 0 && text.length > 0) {
              const avgWordLength = text.length / this.words.length;
              if (avgWordLength > 0) {
                this.currentWord = Math.min(
                  Math.floor(event.charIndex / avgWordLength),
                  this.words.length - 1
                );
              }
            }
          },
          end: () => {
            this.speaking = false;
            announce('Finished reading');
          },
          error: (event) => {
            console.error('[AI4A11y] Speech error:', event);
            this.speaking = false;
          }
        });
        console.log('[AI4A11y] Read Aloud started (EasySpeech)');
        announce('Reading started');
        return;
      } catch (e) {
        console.warn('[AI4A11y] EasySpeech failed, falling back to native:', e);
      }
    }

    if (typeof speechSynthesis === 'undefined' || typeof SpeechSynthesisUtterance === 'undefined') {
      announce('Text-to-speech is not available in this browser');
      this.speaking = false;
      return;
    }
    const run = this.run;
    const chunks = this.chunk(text);
    if (!chunks.length) {
      announce('Read aloud: no text to read on this page');
      this.speaking = false;
      return;
    }
    let started = false, offset = 0;
    chunks.forEach((part, i) => {
      const u = new SpeechSynthesisUtterance(part);
      u.rate = this.settings.rate;
      u.pitch = this.settings.pitch;
      u.volume = this.settings.volume;
      if (this.settings.voice) u.voice = this.settings.voice;
      const base = offset;
      offset += part.length + 1;
      u.onboundary = (event) => {
        if (run !== this.run || event.name !== 'word' || !this.words.length) return;
        const avgWordLength = text.length / this.words.length;
        if (avgWordLength > 0) {
          this.currentWord = Math.min(Math.floor((base + event.charIndex) / avgWordLength), this.words.length - 1);
        }
      };
      // Say it started only once speech really starts: a blocked start used
      // to announce "Reading started" with nothing playing.
      u.onstart = () => {
        if (run !== this.run) return;
        this.utterance = u;
        if (started) return;
        started = true;
        console.log('[AI4A11y] Read Aloud started');
        announce('Reading started');
      };
      u.onend = () => {
        if (run !== this.run || i !== chunks.length - 1) return;
        this.speaking = false;
        this.utterance = null;
        announce('Finished reading');
      };
      u.onerror = (event) => {
        if (run !== this.run) return;
        // Stopping on purpose cancels the queue; that is not an error.
        if (event.error === 'interrupted' || event.error === 'canceled') return;
        if (event.error === 'not-allowed' && !started) { this.waitForGesture(text, run); return; }
        console.warn('[AI4A11y] Speech error:', event.error);
        if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
        this.speaking = false;
        this.utterance = null;
      };
      this.utterance = u;
      speechSynthesis.speak(u);
    });
  },

  pause() {
    if (this.speaking && !this.paused) {
      if (typeof EasySpeech !== 'undefined' && EasySpeech.pause) {
        try { EasySpeech.pause(); } catch (e) { /* ignore */ }
      }
      if (typeof speechSynthesis !== 'undefined') {
        speechSynthesis.pause();
      }
      this.paused = true;
      announce('Reading paused');
    }
  },

  resume() {
    if (this.paused) {
      if (typeof EasySpeech !== 'undefined' && EasySpeech.resume) {
        try { EasySpeech.resume(); } catch (e) { /* ignore */ }
      }
      if (typeof speechSynthesis !== 'undefined') {
        speechSynthesis.resume();
      }
      this.paused = false;
      announce('Reading resumed');
    }
  },

  stop() {
    this.run++;
    this.clearGesture();
    // Cancel EasySpeech if it was used
    if (typeof EasySpeech !== 'undefined' && EasySpeech.cancel) {
      try { EasySpeech.cancel(); } catch (e) { /* ignore */ }
    }
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
    this.speaking = false;
    this.paused = false;
    this.currentWord = 0;
    this.words = [];
    this.utterance = null;
  },

  toggle() {
    if (this.speaking) {
      if (this.paused) {
        this.resume();
      } else {
        this.pause();
      }
    } else {
      this.speakPage();
    }
  },

  presets: {
    slow: { rate: 0.7, pitch: 1.0 },
    normal: { rate: 1.0, pitch: 1.0 },
    fast: { rate: 1.5, pitch: 1.0 },
    veryFast: { rate: 2.0, pitch: 1.0 }
  },

  applyPreset(presetName) {
    if (this.presets[presetName]) {
      this.settings = { ...this.settings, ...this.presets[presetName] };
    }
  }
};

if (typeof window !== 'undefined') window.__ai4a11yReadAloud = ReadAloud;
