// Read Aloud - text-to-speech with word highlighting
import { announce } from '../utils/ai.js';

export const ReadAloud = {
  speaking: false,
  paused: false,
  utterance: null,
  currentWord: 0,
  words: [],
  settings: {
    rate: 1.0,
    pitch: 1.0,
    volume: 1.0,
    voice: null,
    highlightColor: '#ffeb3b'
  },

  getVoices() {
    return (typeof speechSynthesis !== 'undefined') ? speechSynthesis.getVoices() : [];
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
    clone.querySelectorAll('script, style, nav, header, footer, aside, [aria-hidden="true"]').forEach(el => el.remove());
    return clone.textContent?.replace(/\s+/g, ' ').trim() || '';
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

    this.utterance = new SpeechSynthesisUtterance(text);
    this.utterance.rate = this.settings.rate;
    this.utterance.pitch = this.settings.pitch;
    this.utterance.volume = this.settings.volume;
    if (this.settings.voice) {
      this.utterance.voice = this.settings.voice;
    }

    this.utterance.onboundary = (event) => {
      if (event.name === 'word' && this.words.length > 0 && text.length > 0) {
        const avgWordLength = text.length / this.words.length;
        if (avgWordLength > 0) {
          this.currentWord = Math.min(
            Math.floor(event.charIndex / avgWordLength),
            this.words.length - 1
          );
        }
      }
    };

    this.utterance.onend = () => {
      this.speaking = false;
      announce('Finished reading');
    };

    this.utterance.onerror = (event) => {
      console.error('[AI4A11y] Speech error:', event.error);
      this.speaking = false;
    };

    if (typeof speechSynthesis !== 'undefined') speechSynthesis.speak(this.utterance);
    console.log('[AI4A11y] Read Aloud started');
    announce('Reading started');
  },

  pause() {
    if (this.speaking && !this.paused && typeof speechSynthesis !== 'undefined') {
      speechSynthesis.pause();
      this.paused = true;
      announce('Reading paused');
    }
  },

  resume() {
    if (this.paused && typeof speechSynthesis !== 'undefined') {
      speechSynthesis.resume();
      this.paused = false;
      announce('Reading resumed');
    }
  },

  stop() {
    // Cancel EasySpeech if it was used
    if (typeof EasySpeech !== 'undefined' && EasySpeech.cancel) {
      try { EasySpeech.cancel(); } catch (e) { /* ignore */ }
    }
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
    this.speaking = false;
    this.paused = false;
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
