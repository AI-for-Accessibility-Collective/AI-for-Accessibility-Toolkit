// ui.js — the default Controller web UI. Renders a text + voice control widget
// whose SHAPE is driven by the operator's presentation spec (presentation.js):
// which inputs appear, whether feedback is spoken, how big the targets are.
//
// Dependency-free and feature-detected (Web Speech API optional — the same code
// onboarding/index.html uses). The mounts (page/element/companion) all call
// renderControllerUI; they differ only in WHERE the returned root is placed.

const SR = (typeof window !== 'undefined') && (window.SpeechRecognition || window.webkitSpeechRecognition);
const TTS = (typeof window !== 'undefined') && ('speechSynthesis' in window);

function el(doc, tag, attrs = {}, text) {
  const n = doc.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('aria') || k === 'role' || k === 'type' || k === 'placeholder') n.setAttribute(k, v);
    else n[k] = v;
  }
  if (text != null) n.textContent = text;
  return n;
}

/**
 * Build the Controller UI into a fresh root element and wire its behavior.
 * @param {ReturnType<import('../createController.js').createController>} controller
 * @param {{doc?: Document}} [opts]
 * @returns {{ root: HTMLElement, focus: () => void, destroy: () => void }}
 */
export function renderControllerUI(controller, { doc = document } = {}) {
  const p = controller.presentation;
  const speakOut = !!(TTS && p.output.speech);
  const wantVoiceIn = !!(SR && p.input.voice);

  const root = el(doc, 'div', { class: 'aa-controller' + (p.targetSize === 'large' ? ' aa-large' : '') });
  root.setAttribute('role', 'region');
  root.setAttribute('aria-label', 'Accessibility controller');

  const feedback = el(doc, 'div', { class: 'aa-feedback', role: 'status', 'aria-live': 'polite' },
    'Type or say what you need — e.g. "bigger text", "dark mode", "read this".');

  const row = el(doc, 'div', { class: 'aa-row' });
  const input = el(doc, 'input', { type: 'text', class: 'aa-input', placeholder: 'What do you need?', 'aria-label': 'What do you need?' });
  const go = el(doc, 'button', { type: 'button', class: 'aa-btn aa-go' }, 'Go');
  const help = el(doc, 'button', { type: 'button', class: 'aa-btn aa-help', 'aria-label': 'What can I say?' }, '?');
  row.append(input, go);
  if (wantVoiceIn) {
    var mic = el(doc, 'button', { type: 'button', class: 'aa-btn aa-mic', 'aria-pressed': 'false', 'aria-label': 'Speak your need' }, '🎤 Speak');
    row.append(mic);
  }
  row.append(help);
  root.append(feedback, row);

  // ── behavior ──
  function speak(text) {
    if (!speakOut || !text) return;
    try { window.speechSynthesis.cancel(); window.speechSynthesis.speak(new SpeechSynthesisUtterance(text)); } catch {}
  }
  function show(text) { feedback.textContent = text; }
  function refocus() { (p.input.primary === 'voice' && wantVoiceIn ? mic : input).focus(); }

  let busy = false;
  async function submit(utterance) {
    const u = (utterance || '').trim();
    if (!u || busy) return;
    busy = true;
    show('…');
    try {
      const res = await controller.handle(u);
      show(res.say);
      speak(res.say);
    } catch (e) {
      show('Sorry, something went wrong.');
    }
    input.value = '';
    busy = false;
    refocus();
  }

  go.addEventListener('click', () => submit(input.value));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(input.value); } });
  help.addEventListener('click', () => submit('help'));

  // ── voice input (optional) ──
  let recog = null, listening = false, gotText = false;
  if (wantVoiceIn) {
    recog = new SR(); recog.lang = 'en-US'; recog.interimResults = true; recog.maxAlternatives = 1;
    const setMic = (on) => { listening = on; mic.textContent = on ? '⏹ Stop' : '🎤 Speak'; mic.setAttribute('aria-pressed', on ? 'true' : 'false'); };
    recog.onresult = (e) => {
      let txt = ''; for (let i = 0; i < e.results.length; i++) txt += e.results[i][0].transcript;
      input.value = txt.replace(/\s+/g, ' ').trim();
      gotText = !!input.value;
    };
    recog.onerror = () => show('Voice input is unavailable — please type instead.');
    recog.onend = () => { setMic(false); if (gotText) { gotText = false; submit(input.value); } };
    mic.addEventListener('click', () => {
      if (listening) { recog.stop(); return; }
      try { recog.start(); setMic(true); show('Listening…'); } catch {}
    });
  }

  return {
    root,
    focus: refocus,
    destroy() { try { recog && recog.abort(); } catch {} root.remove(); },
  };
}

/** The default stylesheet for the widget (+ the DOM receiver's adaptation
 *  classes/vars). Injected once by the mounts; a host may override. */
export const CONTROLLER_CSS = `
.aa-controller { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  border: 1px solid rgba(128,128,128,.4); border-radius: 12px; padding: .75rem; background: Canvas; color: CanvasText;
  box-shadow: 0 6px 24px rgba(0,0,0,.18); max-width: 32rem; }
.aa-feedback { font-size: .95rem; margin-bottom: .5rem; min-height: 1.4em; }
.aa-row { display: flex; gap: .4rem; align-items: stretch; }
.aa-input { flex: 1; padding: .5rem .6rem; font-size: 1rem; border: 1px solid #99a; border-radius: 8px;
  background: transparent; color: inherit; }
.aa-btn { padding: .5rem .7rem; font-size: 1rem; font-weight: 600; border: 0; border-radius: 8px;
  background: #1f6feb; color: #fff; cursor: pointer; white-space: nowrap; }
.aa-btn.aa-mic, .aa-btn.aa-help { background: transparent; color: inherit; border: 1px solid #99a; }
.aa-mic[aria-pressed="true"] { background: #b3261e; color: #fff; border-color: #b3261e; }
.aa-btn:focus-visible, .aa-input:focus-visible { outline: 3px solid #ff8c00; outline-offset: 2px; }
.aa-large .aa-btn, .aa-large .aa-input { padding: .8rem 1.1rem; font-size: 1.2rem; }

/* Adaptation classes/vars the dom-receiver sets on the driven app root. */
[style*="--aa-font-scale"] { font-size: calc(1rem * var(--aa-font-scale, 1)); }
[style*="--aa-line-height"] { line-height: var(--aa-line-height, 1.5); }
[style*="--aa-letter-spacing"] { letter-spacing: var(--aa-letter-spacing, 0); }
.aa-dark { filter: invert(1) hue-rotate(180deg); background: #111; }
.aa-dyslexia { font-family: "Comic Sans MS", "OpenDyslexic", sans-serif; }
.aa-big-targets a, .aa-big-targets button { padding: .5em .8em; display: inline-block; }
.aa-reduce-motion * { animation: none !important; transition: none !important; scroll-behavior: auto !important; }
.aa-hide-distractions .ad, .aa-hide-distractions [data-ad], .aa-hide-distractions aside { display: none !important; }
.aa-focus-mode p { opacity: .55; } .aa-focus-mode p:hover { opacity: 1; }
[data-aa-contrast="yellow-black"] { background: #000 !important; color: #ff0 !important; }
.aa-reading-guide { cursor: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="4" height="24"><rect width="4" height="24" fill="orange"/></svg>') 2 12, auto; }
`;
