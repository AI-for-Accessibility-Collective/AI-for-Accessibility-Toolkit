import { announce } from '../../utils/ai.js';

export const VoiceCommands = {
  enabled: false,
  recognition: null,
  feedbackElement: null,
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
      const links = Array.from(document.querySelectorAll('a[href]'));
      const current = document.activeElement;
      const idx = links.indexOf(current);
      if (idx < links.length - 1) links[idx + 1].focus();
      else if (links.length > 0) links[0].focus();
    },
    'previous link': () => {
      const links = Array.from(document.querySelectorAll('a[href]'));
      const current = document.activeElement;
      const idx = links.indexOf(current);
      if (idx > 0) links[idx - 1].focus();
      else if (links.length > 0) links[links.length - 1].focus();
    },
    'next button': () => {
      const buttons = Array.from(document.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"]'));
      const current = document.activeElement;
      const idx = buttons.indexOf(current);
      if (idx < buttons.length - 1) buttons[idx + 1].focus();
      else if (buttons.length > 0) buttons[0].focus();
    },
    'read page': () => window.__ai4a11yReadAloud?.speakPage(),
    'stop reading': () => window.__ai4a11yReadAloud?.stop()
  },

  enable(options = {}) {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      announce('Voice recognition not supported in this browser');
      return;
    }

    this.settings = { ...this.settings, ...options };
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.recognition = new SpeechRecognition();
    this.recognition.continuous = this.settings.continuous;
    this.recognition.interimResults = this.settings.interimResults;
    this.recognition.lang = this.settings.language;

    this.recognition.onresult = (event) => {
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
      if (event.error !== 'no-speech') {
        this.showFeedback(`Error: ${event.error}`, 'error');
      }
    };

    this.recognition.onend = () => {
      if (this.enabled) this.recognition.start();
    };

    this.createFeedbackElement();
    this.recognition.start();
    this.enabled = true;
    console.log('[AI4A11y] Voice Commands enabled');
    announce('Voice commands enabled. Say "stop listening" to disable.');
  },

  disable() {
    if (this.recognition) {
      this.enabled = false;
      this.recognition.onend = null;
      this.recognition.stop();
      this.recognition = null;
    }
    if (this.feedbackElement) {
      this.feedbackElement.remove();
      this.feedbackElement = null;
    }
    document.getElementById('ai4a11y-voice-pulse-style')?.remove();
    console.log('[AI4A11y] Voice Commands disabled');
    announce('Voice commands disabled');
  },

  createFeedbackElement() {
    if (this.feedbackElement) return;

    this.feedbackElement = document.createElement('div');
    this.feedbackElement.id = 'ai4a11y-voice-feedback';
    this.feedbackElement.setAttribute('role', 'status');
    this.feedbackElement.setAttribute('aria-live', 'polite');
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
    this.feedbackElement.appendChild(textSpan);

    const pulseStyle = document.createElement('style');
    pulseStyle.id = 'ai4a11y-voice-pulse-style';
    pulseStyle.textContent = '@keyframes ai4a11y-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }';
    document.getElementById('ai4a11y-voice-pulse-style')?.remove();
    document.head.appendChild(pulseStyle);
    document.body.appendChild(this.feedbackElement);
  },

  showFeedback(text, type) {
    if (!this.feedbackElement) return;
    const textEl = this.feedbackElement.querySelector('.ai4a11y-voice-text');
    if (textEl) {
      textEl.textContent = text;
      textEl.style.color = type === 'error' ? '#ff6b6b' : type === 'interim' ? '#aaa' : '#fff';
    }
  },

  executeCommand(transcript) {
    if (transcript.includes('stop listening')) {
      this.disable();
      return true;
    }

    for (const [phrase, action] of Object.entries(this.commands)) {
      if (transcript.includes(phrase)) {
        action();
        return true;
      }
    }

    const clickMatch = transcript.match(/click (?:on )?(.+)/);
    if (clickMatch) {
      const el = this.findElementByText(clickMatch[1]);
      if (el) {
        el.click();
        el.focus();
        return true;
      }
    }

    const typeMatch = transcript.match(/type (.+)/);
    if (typeMatch && document.activeElement.matches('input, textarea')) {
      document.activeElement.value += typeMatch[1];
      document.activeElement.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }

    return false;
  },

  findElementByText(text) {
    const elements = document.querySelectorAll('a, button, [role="button"], input[type="submit"]');
    for (const el of elements) {
      const elText = (el.textContent || el.value || el.getAttribute('aria-label') || '').toLowerCase();
      if (elText.includes(text.toLowerCase())) return el;
    }
    return null;
  },

  addCommand(phrase, action) {
    this.commands[phrase.toLowerCase()] = action;
  },

  toggle() {
    if (this.enabled) this.disable();
    else this.enable();
  }
};

window.__ai4a11yVoiceCommands = VoiceCommands;
