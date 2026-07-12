import { announce } from '../../utils/ai.js';

// read-aloud — fix-then-freeze (Phase 3).
// Fixes applied:
//   (a) No "Reading started" announce that races TTS start (SR double-speak).
//   (b) Text split into ~250-char sentence chunks — survives Chrome's ~15 s
//       remote-voice stall on a single long utterance.
//   (c) extractReadableText strips sr-only/visually-hidden/<noscript> too.
//   (d) announce on stop-by-user only (disable).
// No further investment: no word highlighting, no voice pickers beyond setVoice.
// Alternatives: OS/browser read-aloud tools; voice mode's read-page.

// Split text into sentence-boundary chunks of ≤ maxChars characters.
// Keeps sentences whole; falls back to splitting on whitespace if a single
// sentence exceeds maxChars.
function sentenceChunks(text, maxChars = 250) {
  if (!text) return [];
  // Sentence boundaries: . ! ? followed by space or end, or newlines.
  const sentences = text.match(/[^.!?\n]+[.!?\n]*\s*/g) || [text];
  const chunks = [];
  let current = '';
  for (const s of sentences) {
    if ((current + s).length > maxChars && current) {
      chunks.push(current.trim());
      current = s;
    } else {
      current += s;
    }
    // Safety: if a single sentence overflows, flush it.
    while (current.length > maxChars) {
      chunks.push(current.slice(0, maxChars).trim());
      current = current.slice(maxChars);
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

export const ReadAloud = {
  speaking: false,
  paused: false,
  _chunks: [],
  _chunkIndex: 0,
  _stopByUser: false,
  settings: {
    rate: 1.0,
    pitch: 1.0,
    volume: 1.0,
    voice: null,
  },

  getVoices() {
    return speechSynthesis.getVoices();
  },

  setVoice(voiceName) {
    const voices = this.getVoices();
    this.settings.voice = voices.find(v => v.name === voiceName) || null;
  },

  setRate(rate) {
    this.settings.rate = Math.max(0.5, Math.min(2.0, rate));
  },

  speakSelection() {
    const selection = window.getSelection();
    const text = selection.toString().trim();
    if (text) {
      this.speak(text);
    } else {
      announce('No text selected');
    }
  },

  speakPage(options = {}) {
    if (options.rate) this.settings.rate = options.rate;
    const main = document.querySelector('main, article, [role="main"], .content, #content');
    const target = main || document.body;
    const text = this.extractReadableText(target);
    if (text) {
      this.speak(text);
    }
  },

  extractReadableText(element) {
    const clone = element.cloneNode(true);
    // Remove non-readable content including screen-reader-only elements
    // (their text is not intended for linear reading aloud).
    clone.querySelectorAll([
      'script', 'style', 'nav', 'header', 'footer', 'aside',
      '[aria-hidden="true"]',
      '.sr-only', '.visually-hidden',
      '[class*="screen-reader"]',
      'noscript',
    ].join(', ')).forEach(el => el.remove());
    return clone.textContent?.replace(/\s+/g, ' ').trim() || '';
  },

  speak(text) {
    this.stop();
    if (!text) return;

    this._stopByUser = false;
    this._chunks = sentenceChunks(text);
    this._chunkIndex = 0;
    this.speaking = true;
    this.paused = false;

    this._speakNextChunk();
  },

  _speakNextChunk() {
    if (!this.speaking || this._chunkIndex >= this._chunks.length) {
      this.speaking = false;
      return;
    }

    const chunk = this._chunks[this._chunkIndex];
    const utt = new SpeechSynthesisUtterance(chunk);
    utt.rate = this.settings.rate;
    utt.pitch = this.settings.pitch;
    utt.volume = this.settings.volume;
    if (this.settings.voice) utt.voice = this.settings.voice;

    utt.onend = () => {
      if (!this.speaking) return; // cancelled
      this._chunkIndex++;
      this._speakNextChunk();
    };

    utt.onerror = (event) => {
      // 'interrupted' fires on cancel() — treat as clean stop.
      if (event.error !== 'interrupted') {
        console.error('[AI4A11y] Speech error:', event.error);
      }
      this.speaking = false;
    };

    speechSynthesis.speak(utt);
  },

  pause() {
    if (this.speaking && !this.paused) {
      speechSynthesis.pause();
      this.paused = true;
      announce('Reading paused');
    }
  },

  resume() {
    if (this.paused) {
      speechSynthesis.resume();
      this.paused = false;
      announce('Reading resumed');
    }
  },

  stop() {
    speechSynthesis.cancel();
    this.speaking = false;
    this.paused = false;
    this._chunks = [];
    this._chunkIndex = 0;
  },

  enable() {
    this.speakPage();
  },

  disable() {
    this._stopByUser = true;
    this.stop();
    announce('Reading stopped');
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

window.__ai4a11yReadAloud = ReadAloud;

// Exported for unit tests.
export { sentenceChunks };
