// ui.js — the default Controller web UI. Renders a text + voice control widget
// whose SHAPE is driven by the operator's presentation spec (presentation.js):
// which inputs appear, whether feedback is spoken, how big the targets are.
//
// Dependency-free and feature-detected (Web Speech API optional — the same code
// onboarding/index.html uses). The mounts (page/element/companion) all call
// renderControllerUI; they differ only in WHERE the returned root is placed.

const SR = (typeof window !== 'undefined') && (window.SpeechRecognition || window.webkitSpeechRecognition);
const TTS = (typeof window !== 'undefined') && ('speechSynthesis' in window);

// ── Web Audio earcons (ported from browser-harness) ─────────────────────────
// Short non-verbal cues: a repeating "thinking" pulse while a task runs, and a
// done chime when the result arrives. Non-verbal, so they don't collide with a
// screen reader's speech the way TTS would — they play regardless of the
// Speak-results toggle. One shared AudioContext per page, resumed on use (the
// submit gesture unblocks autoplay).
let _ac = null;
function audioCtx() {
  const AC = (typeof window !== 'undefined') && (window.AudioContext || window.webkitAudioContext);
  if (!AC) return null;
  try { if (!_ac) _ac = new AC(); if (_ac.state === 'suspended') _ac.resume(); } catch { return null; }
  return _ac;
}
function blip(freq, dur, when = 0, vol = 0.05, type = 'sine') {
  const a = audioCtx();
  if (!a) return;
  try {
    const t = a.currentTime + when;
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(a.destination);
    o.start(t); o.stop(t + dur + 0.02);
  } catch { /* audio unavailable */ }
}
const earconThinkPulse = () => { blip(440, 0.12, 0, 0.045); blip(620, 0.12, 0.14, 0.035); };
const earconDone = () => { blip(660, 0.12, 0, 0.06); blip(880, 0.18, 0.11, 0.06); };
const earconError = () => { blip(300, 0.2, 0, 0.07, 'square'); blip(210, 0.26, 0.17, 0.06, 'square'); };

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
  const wantVoiceIn = !!(SR && p.input.voice);

  // "Speak results" is the PERSON'S choice, not an inference (issue #5). It
  // defaults ON — results are spoken unless turned off — and is persisted per
  // browser. A screen-reader operator can switch it OFF to avoid a second voice
  // over their AT; either way the live region always carries the text, so
  // nothing is lost when it's off.
  const SPEAK_KEY = 'aa-controller-speak-results';
  let speakResults = true; // default ON; the toggle + localStorage let anyone turn it off
  if (TTS) { try { const v = localStorage.getItem(SPEAK_KEY); if (v !== null) speakResults = v === '1'; } catch { /* storage blocked */ } }

  const root = el(doc, 'div', { class: 'aa-controller' + (p.targetSize === 'large' ? ' aa-large' : '') });
  root.setAttribute('role', 'region');
  root.setAttribute('aria-label', 'Accessibility controller');

  // Two live regions (issue #6): acknowledgements & errors are ASSERTIVE — they
  // confirm an action just started and are the only chance to catch a mis
  // -recognition, so they must not queue behind a paragraph. Task results and
  // content reads are POLITE — don't interrupt someone mid-sentence. Both sit in
  // the same place; only one holds text at a time (the other collapses empty).
  const feedbackAlert = el(doc, 'div', { class: 'aa-feedback', role: 'alert', 'aria-live': 'assertive' });
  const feedbackStatus = el(doc, 'div', { class: 'aa-feedback', role: 'status', 'aria-live': 'polite' },
    'Type or say what you need — e.g. "bigger text", "dark mode", "read this".');

  // A VISUAL waiting indicator shown while a task runs (the earcon is the audio
  // cue). aria-hidden so a screen reader doesn't read animating dots — the "Ok,
  // running…" ack (assertive) and the earcon carry the non-visual signal.
  const waiting = el(doc, 'div', { class: 'aa-waiting', 'aria-hidden': 'true' });
  waiting.hidden = true;
  for (let i = 0; i < 3; i++) waiting.appendChild(el(doc, 'span', { class: 'aa-dot' }));

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
  root.append(feedbackAlert, feedbackStatus, waiting, row);

  // The Speak-results toggle (only where TTS exists) — keyboard-reachable + labelled.
  if (TTS) {
    const toggle = el(doc, 'label', { class: 'aa-toggle' });
    const cb = el(doc, 'input', { type: 'checkbox' });
    cb.checked = speakResults;
    toggle.append(cb, doc.createTextNode(' Speak results aloud'));
    cb.addEventListener('change', () => { speakResults = cb.checked; try { localStorage.setItem(SPEAK_KEY, speakResults ? '1' : '0'); } catch { /* storage blocked */ } });
    root.append(toggle);
  }

  // ── behavior ──
  function speak(text) {
    if (!TTS || !speakResults || !text) return;
    try { window.speechSynthesis.cancel(); window.speechSynthesis.speak(new SpeechSynthesisUtterance(text)); } catch {}
  }
  // Deliver to the right live region: assertive for acks/errors, polite for results.
  function deliver(text, { assertive = false } = {}) {
    const t = String(text == null ? '' : text);
    if (assertive) { feedbackAlert.textContent = t; feedbackStatus.textContent = ''; }
    else { feedbackStatus.textContent = t; feedbackAlert.textContent = ''; }
  }
  function show(text) { deliver(text, { assertive: false }); } // polite: results, content, notes
  function refocus() { (p.input.primary === 'voice' && wantVoiceIn ? mic : input).focus(); }

  // Waiting state (a task is running): animated dots + a repeating "thinking"
  // earcon, from the ack until a result note arrives (or a safety timeout).
  let thinkTimer = null, waitGuard = null;
  function startWaiting() {
    stopWaiting();
    waiting.hidden = false;
    earconThinkPulse();
    thinkTimer = setInterval(earconThinkPulse, 2400);
    waitGuard = setTimeout(stopWaiting, 120000); // don't pulse forever if no note comes
    if (waitGuard && waitGuard.unref) waitGuard.unref();
  }
  function stopWaiting() {
    waiting.hidden = true;
    if (thinkTimer) { clearInterval(thinkTimer); thinkTimer = null; }
    if (waitGuard) { clearTimeout(waitGuard); waitGuard = null; }
  }

  // A background tab can't make itself active (browsers block that), but it CAN
  // post a system notification whose click returns focus here — so a result that
  // arrives while the operator switched away (e.g. the app drove another tab)
  // isn't missed. For a true auto-switch, the receiver (which drives the browser)
  // should activate the Controller's tab when it emits the note.
  function ensureNotifyPermission() {
    try { if (typeof Notification !== 'undefined' && Notification.permission === 'default') Notification.requestPermission(); } catch {}
  }
  function notifyIfBackground(text) {
    try {
      if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') return; // already on this tab
      const n = new Notification('Result ready', { body: String(text).slice(0, 200), tag: 'aa-controller-result' });
      n.onclick = () => { try { window.focus(); } catch {} try { n.close(); } catch {} };
    } catch { /* notifications unavailable */ }
  }

  let busy = false;
  async function submit(utterance) {
    const u = (utterance || '').trim();
    if (!u || busy) return;
    busy = true;
    stopWaiting();
    show('…');
    try {
      const res = await controller.handle(u);
      // A content read (query → getContent) is a RESULT → polite; everything
      // else (adaptations, task acks, errors) is an acknowledgement → assertive.
      const contentRead = res.intent && res.intent.type === 'query' && res.intent.ask === 'content';
      deliver(res.say, { assertive: !(res.ok && contentRead) });
      speak(res.say);
      // A dispatched task runs in the background (its result arrives via a note).
      // Show the waiting dots + play the thinking earcon until it does, and ask
      // (once) for notification permission so a background result can call the
      // operator back to this tab.
      if (res.ok && res.intent && res.intent.action === 'task') { startWaiting(); ensureNotifyPermission(); }
      else if (!res.ok) earconError();
    } catch (e) {
      deliver('Sorry, something went wrong.', { assertive: true });
      earconError();
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
    recog.onerror = () => deliver('Voice input is unavailable — please type instead.', { assertive: true });
    recog.onend = () => { setMic(false); if (gotText) { gotText = false; submit(input.value); } };
    mic.addEventListener('click', () => {
      if (listening) { recog.stop(); return; }
      try { recog.start(); setMic(true); show('Listening…'); } catch {}
    });
  }

  // Out-of-band notes from a remote receiver — a task result that arrives after
  // the response (see transport/remote.js onNote). Route into the POLITE region
  // (a screen reader announces it in the operator's own voice) and speak() it —
  // speak() is gated on the Speak-results toggle (default from presentation), so
  // a screen-reader operator gets no second voice unless they asked (issues #5/#7).
  let unNote = null;
  if (controller.control && typeof controller.control.onNote === 'function') {
    unNote = controller.control.onNote((text) => {
      stopWaiting();          // the task finished — stop the dots + thinking earcon
      earconDone();
      if (text) { show(String(text)); speak(String(text)); notifyIfBackground(String(text)); }
    });
  }

  return {
    root,
    focus: refocus,
    destroy() { stopWaiting(); try { unNote && unNote(); } catch {} try { recog && recog.abort(); } catch {} root.remove(); },
  };
}

/** The default stylesheet for the widget (+ the DOM receiver's adaptation
 *  classes/vars). Injected once by the mounts; a host may override. */
export const CONTROLLER_CSS = `
.aa-controller { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  border: 1px solid rgba(128,128,128,.4); border-radius: 12px; padding: .75rem; background: Canvas; color: CanvasText;
  box-shadow: 0 6px 24px rgba(0,0,0,.18); max-width: 32rem; }
.aa-feedback { font-size: .95rem; margin-bottom: .5rem; min-height: 1.4em; }
.aa-feedback:empty { min-height: 0; margin: 0; }   /* the inactive live region collapses */
.aa-toggle { display: inline-flex; align-items: center; gap: .35rem; margin-top: .5rem; font-size: .85rem; cursor: pointer; }
.aa-toggle input:focus-visible { outline: 3px solid #ff8c00; outline-offset: 2px; }
/* Waiting indicator: three dots pulsing while a task runs. */
.aa-waiting { display: flex; gap: .3rem; align-items: center; margin-bottom: .5rem; }
.aa-waiting[hidden] { display: none; }
.aa-dot { width: .5rem; height: .5rem; border-radius: 50%; background: currentColor; opacity: .3; animation: aa-blink 1.2s infinite ease-in-out; }
.aa-dot:nth-child(2) { animation-delay: .2s; }
.aa-dot:nth-child(3) { animation-delay: .4s; }
@keyframes aa-blink { 0%, 80%, 100% { opacity: .25; } 40% { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .aa-dot { animation: none; opacity: .6; } }
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
