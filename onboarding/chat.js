// chat.js — the /chat surface: one conversational input that does BOTH halves of
// the toolkit demo.
//
//   • onboarding   — a self-description ("I'm blind", "I have dyslexia") updates
//                    the person's profile via /api/onboard, and the profile pill
//                    at the top refreshes.
//   • controller   — a setting or command ("bigger text", "dark mode", "read
//                    this", "open google and search…") is carried through the
//                    neutral ControlPort to the driven app (a local demo article
//                    here, or a remote receiver like browser-harness).
//
// Routing is DETERMINISTIC-FIRST (grammar + an onboarding heuristic, instant and
// offline); anything unmatched falls to an optional Gemini lane (/api/assist) for
// controller-intent classification and, failing that, a general spoken answer.
// The LLM is best-effort: with no key configured the surface still works fully
// for settings + onboarding.
//
// Reuses the controller core verbatim (served at /controller/lib) — this page is
// just a different SHAPE (a chat window) over the same createController.

import { createController } from '/controller/lib/createController.js';
import { createDomReceiver } from '/controller/lib/web/dom-receiver.js';
import { websocketChannel, remoteControl } from '/controller/lib/transport/remote.js';
import { createLlmLane } from '/controller/lib/llm-lane.js';
import { parse } from '/controller/lib/grammar.js';
import { bestVoice, forSpeech, earconThinkPulse, earconDone, earconError } from '/controller/lib/web/ui.js';

const $ = (id) => document.getElementById(id);
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const TTS = 'speechSynthesis' in window;

// ── profile ──────────────────────────────────────────────────────────────────
function currentUid() { try { return localStorage.getItem('onb-uid') || ''; } catch { return ''; } }
let operatorModel = { supportAreas: [] };

async function loadProfile() {
  const uid = currentUid();
  if (!uid) { operatorModel = { supportAreas: [] }; renderProfile('', null); return; }
  try {
    const d = await (await fetch('/api/ability-model?uid=' + encodeURIComponent(uid))).json();
    operatorModel = (d.exists && d.model) ? d.model : { supportAreas: [] };
    renderProfile(d.exists ? uid : '', operatorModel);
  } catch { operatorModel = { supportAreas: [] }; renderProfile('', null); }
}

// The always-visible profile pill at the top (read-only; editing happens here in
// chat or on the full onboarding page). Built with text nodes — the free text is
// the person's own words and must never be injected as HTML.
function renderProfile(uid, model) {
  const el = $('profile');
  el.textContent = '';
  if (!uid || !model) {
    el.append('No profile yet — tell me about yourself, e.g. ');
    const ex = document.createElement('em'); ex.textContent = '“I’m blind”'; el.append(ex);
    el.append(' or ');
    const l = document.createElement('a'); l.href = '/onboarding'; l.textContent = 'use full onboarding'; el.append(l, '.');
    return;
  }
  const person = document.createElement('span'); person.className = 'who';
  person.textContent = uid; el.append('You: ', person);
  const bits = [];
  if (model.supportAreas && model.supportAreas.length) bits.push(model.supportAreas.join(', '));
  if (model.freeText) bits.push('“' + model.freeText + '”');
  if (bits.length) el.append(' · ' + bits.join(' · '));
}

// ── onboarding heuristic: is this message a self-description? ──────────────────
// Maps a natural sentence onto {supportAreas, visionKind}. Deliberately gated on
// a self-description lead ("I'm / I have / I use / my …") OR a bare condition
// word, so imperative commands ("read this", "bigger text") are NOT swallowed as
// onboarding — those fall through to the controller grammar.
const SELF = /\b(i['’]?m|i am|i['’]?ve|i have|i use|i get|my|me)\b/i;
const AREA_RULES = [
  { area: 'vision', re: /\bblind\b|low vision|partially sighted|visually impaired|can'?t see|cannot see|screen ?reader|voice ?over|nvda|jaws|talkback|magnif/i },
  { area: 'reading', re: /dyslexi|trouble reading|hard to read|letters (move|jump)|reading/i },
  { area: 'cognitive', re: /cognitive|memory|remember|plain language|simple language|understand|comprehen/i },
  { area: 'motor', re: /motor|tremor|parkinson|keyboard only|can'?t use (a |the )?mouse|switch access|shaky hands|dexterity/i },
  { area: 'hearing', re: /\bdeaf\b|hard of hearing|hearing|captions?/i },
  { area: 'sensory', re: /sensory|overwhelm|overload|autis|too much motion|flashing/i },
  { area: 'attention', re: /adhd|attention|can'?t focus|hard to focus|distracted|can'?t concentrate|concentrat/i },
];
// Blind vs low vision: mirrors the server's isBlindText — a blind screen-reader
// user needs the OPPOSITE of magnification, so we must not guess "vision" once.
function visionKindOf(t) {
  const s = t.toLowerCase();
  if (/colou?r[- ]?blind/.test(s)) return null; // colour-vision deficiency, not blindness
  if (/screen ?reader|voice ?over|nvda|jaws|talkback|can'?t see|cannot see|totally blind|completely blind|\bblind\b/.test(s)
      && !/legally blind/.test(s)) return 'blind';
  if (/low vision|partially sighted|bigger text|magnif|too small|hard to see/.test(s)) return 'lowVision';
  return null;
}
function detectOnboarding(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  const areas = [];
  for (const r of AREA_RULES) if (r.re.test(t)) areas.push(r.area);
  if (!areas.length) return null;
  // Gate: a self-description lead, or the message is essentially just the
  // condition (few words) — so "read this" (command) never counts.
  const bareCondition = t.split(/\s+/).length <= 4;
  if (!SELF.test(t) && !bareCondition) return null;
  const visionKind = areas.includes('vision') ? visionKindOf(t) : undefined;
  return { supportAreas: [...new Set(areas)], freeText: t, visionKind };
}

// Chat onboarding is ADDITIVE and conversational: a new self-description MERGES
// with what's already known rather than replacing it ("I'm blind" then later "I
// also have dyslexia" → vision + reading). Support areas are unioned; the free
// text keeps its history (appended); and the vision kind is recomputed from the
// COMBINED text, so adding an unrelated need can never silently flip a blind
// profile to low-vision (or vice-versa).
async function applyOnboarding(o) {
  const uid = currentUid() || 'demo-user';
  const prevAreas = operatorModel.supportAreas || [];
  const prevText = (operatorModel.freeText || '').trim();
  const supportAreas = [...new Set([...prevAreas, ...o.supportAreas])];
  const freeText = (prevText && !prevText.toLowerCase().includes(o.freeText.toLowerCase()))
    ? prevText.replace(/[.\s]+$/, '') + '. ' + o.freeText
    : (prevText || o.freeText);
  const visionKind = supportAreas.includes('vision') ? (visionKindOf(freeText) || undefined) : undefined;

  const payload = { uid, supportAreas, freeText, visionKind };
  const r = await fetch('/api/onboard', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  const d = await r.json();
  if (!d.ok) throw new Error(d.error || 'onboarding failed');
  try { localStorage.setItem('onb-uid', d.uid); } catch {}
  await loadProfile();
  rebuildController(); // the operator model changed → re-derive presentation
  const areas = d.supportAreas.length ? d.supportAreas.join(', ') : 'none';
  const kind = d.visionKind ? ` (${d.visionKind === 'blind' ? 'screen-reader / no magnification' : 'low vision'})` : '';
  return `Got it — updated your profile. Support areas: ${areas}${kind}. Tell me more any time, or edit it on the onboarding page.`;
}

// ── the driven app (controller half) ─────────────────────────────────────────
let controller = null, currentControl = null, remoteChannel = null;

// The Gemini lane is best-effort: complete() posts to /api/assist, which returns
// { available:false } (→ throw → router treats it as a grammar miss) when no key
// is configured. Never blocks the deterministic path.
async function assistComplete(prompt) {
  const r = await fetch('/api/assist', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt }) });
  const d = await r.json();
  if (!d || d.available === false || typeof d.text !== 'string') throw new Error('assist-unavailable');
  return d.text;
}

function rebuildController() {
  const llm = createLlmLane({ complete: assistComplete });
  controller = createController({
    control: currentControl,
    operator: { abilityModel: operatorModel },
    llm,
    rawToTask: !!remoteChannel, // driving a URL → send free-form straight through as a task
  });
  window.__chat = controller;
}

function useLocal() {
  if (remoteChannel) { remoteChannel.close(); remoteChannel = null; }
  currentControl = localReceiver;
  $('drive-note').textContent = 'Driving the demo preview + this window.';
  rebuildController();
  if (unNote) { unNote(); unNote = null; }
  wireNotes();
}
function useRemote(url) {
  if (!url) return;
  if (remoteChannel) remoteChannel.close();
  remoteChannel = websocketChannel(url);
  currentControl = remoteControl({ channel: remoteChannel });
  $('drive-note').textContent = 'Driving remote receiver ' + url + ' — messages go straight through as tasks.';
  rebuildController();
  if (unNote) { unNote(); unNote = null; }
  wireNotes();
}

// Late results from a remote task arrive as out-of-band notes.
let unNote = null;
function wireNotes() {
  if (currentControl && typeof currentControl.onNote === 'function') {
    unNote = currentControl.onNote((text) => {
      if (!text) return;
      stopWaiting();
      earconDone(); // the task finished — the "done" chime
      addMessage('assistant', String(text));
      speak(String(text));
    });
  }
}

// ── voice output ──────────────────────────────────────────────────────────────
const VOICE_KEY = 'aa-chat-voice', SPEAK_KEY = 'aa-chat-speak', VOICEIN_KEY = 'aa-chat-voice-in';
let speakReplies = true, chosenVoice = '', voices = [], voiceInOn = true;
const LANG = ((navigator.language || 'en').slice(0, 2)).toLowerCase();
try { const v = localStorage.getItem(SPEAK_KEY); if (v !== null) speakReplies = v === '1'; } catch {}
try { chosenVoice = localStorage.getItem(VOICE_KEY) || ''; } catch {}
try { const v = localStorage.getItem(VOICEIN_KEY); if (v !== null) voiceInOn = v === '1'; } catch {}

function pickVoice() {
  if (chosenVoice) { const v = voices.find((x) => x.name === chosenVoice); if (v) return v; }
  return bestVoice(voices, LANG);
}
function speak(text) {
  if (!TTS || !speakReplies) return;
  const clean = forSpeech(text);
  if (!clean) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(clean);
    const v = pickVoice(); if (v) { u.voice = v; if (v.lang) u.lang = v.lang; }
    window.speechSynthesis.speak(u);
  } catch {}
}
function loadVoices() {
  if (!TTS || typeof window.speechSynthesis.getVoices !== 'function') return;
  try { voices = window.speechSynthesis.getVoices() || []; } catch { voices = []; }
  const sel = $('voice-select'); if (!sel) return;
  const inLang = voices.filter((v) => v.lang && v.lang.toLowerCase().startsWith(LANG));
  const list = inLang.length ? inLang : voices;
  sel.textContent = '';
  sel.append(opt('', 'Automatic (best available)'));
  for (const v of list) sel.append(opt(v.name, v.name + (v.localService === false ? ' — network' : '')));
  sel.value = (chosenVoice && list.some((v) => v.name === chosenVoice)) ? chosenVoice : '';
}
function opt(value, label) { const o = document.createElement('option'); o.value = value; o.textContent = label; return o; }

// ── transcript ────────────────────────────────────────────────────────────────
function addMessage(role, text) {
  const wrap = $('transcript');
  const row = document.createElement('div'); row.className = 'msg ' + role;
  const bubble = document.createElement('div'); bubble.className = 'bubble';
  bubble.textContent = text;
  row.append(bubble);
  wrap.append(row);
  wrap.scrollTop = wrap.scrollHeight;
  return bubble;
}
let waitingRow = null, thinkTimer = null;
function startWaiting() {
  stopWaiting();
  const wrap = $('transcript');
  waitingRow = document.createElement('div'); waitingRow.className = 'msg assistant';
  const b = document.createElement('div'); b.className = 'bubble waiting';
  b.setAttribute('aria-label', 'Working…');
  for (let i = 0; i < 3; i++) { const d = document.createElement('span'); d.className = 'dot'; b.append(d); }
  waitingRow.append(b); wrap.append(waitingRow); wrap.scrollTop = wrap.scrollHeight;
  // A repeating "thinking" earcon while the task runs — the audio counterpart of
  // the dots (same cue the floating Controller plays).
  earconThinkPulse();
  thinkTimer = setInterval(earconThinkPulse, 2400);
}
function stopWaiting() {
  if (waitingRow) { waitingRow.remove(); waitingRow = null; }
  if (thinkTimer) { clearInterval(thinkTimer); thinkTimer = null; }
}

// ── composer history (shell-style Up/Down recall) ─────────────────────────────
// Sent messages are remembered (per browser) and recalled with the arrow keys —
// Up walks back through older messages, Down walks forward, and Down past the
// newest restores whatever draft you were typing.
const HIST_KEY = 'aa-chat-history';
const HIST_MAX = 100;
let history = [];
try { const h = JSON.parse(localStorage.getItem(HIST_KEY) || '[]'); if (Array.isArray(h)) history = h.filter((x) => typeof x === 'string'); } catch { history = []; }
let histIndex = history.length; // points one past the newest = "the current draft"
let histDraft = '';             // the in-progress line, restored when you arrow past newest

function pushHistory(text) {
  const t = String(text || '').trim();
  if (t && history[history.length - 1] !== t) { // skip empty + consecutive dupes
    history.push(t);
    if (history.length > HIST_MAX) history = history.slice(-HIST_MAX);
    try { localStorage.setItem(HIST_KEY, JSON.stringify(history)); } catch {}
  }
  histIndex = history.length;
  histDraft = '';
}
function caretToEnd(ta) { const n = ta.value.length; try { ta.setSelectionRange(n, n); } catch {} }
// Only recall when the caret is on the first line (Up) / last line (Down), so a
// multi-line draft still moves the cursor normally.
function onFirstLine(ta) { return ta.selectionStart === ta.selectionEnd && ta.value.slice(0, ta.selectionStart).indexOf('\n') === -1; }
function onLastLine(ta) { return ta.selectionStart === ta.selectionEnd && ta.value.slice(ta.selectionEnd).indexOf('\n') === -1; }
function recallPrev(ta) {
  if (!history.length || histIndex === 0) return;
  if (histIndex === history.length) histDraft = ta.value; // remember the live draft
  histIndex--;
  ta.value = history[histIndex] || '';
  caretToEnd(ta);
}
function recallNext(ta) {
  if (histIndex >= history.length) return;
  histIndex++;
  ta.value = histIndex === history.length ? histDraft : (history[histIndex] || '');
  caretToEnd(ta);
}
function onComposerKey(e) {
  const ta = e.target;
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleTurn(ta.value); return; }
  if (e.key === 'ArrowUp' && onFirstLine(ta) && history.length) { e.preventDefault(); recallPrev(ta); }
  else if (e.key === 'ArrowDown' && onLastLine(ta) && histIndex < history.length) { e.preventDefault(); recallNext(ta); }
}

// ── the main turn ─────────────────────────────────────────────────────────────
let busy = false;
async function handleTurn(text) {
  const u = String(text || '').trim();
  if (!u || busy) return;
  busy = true;
  addMessage('user', u);
  pushHistory(u); // remember for Up/Down recall
  $('composer-input').value = '';
  try {
    // Routing precedence:
    //   1) a deterministic CONTROLLER command wins ("bigger text", "hide
    //      distractions", "read this", "undo") — these are actions, never a
    //      profile edit, even though a word like "distractions" also appears in
    //      the onboarding vocabulary.
    //   2) otherwise a self-description → onboarding ("I'm blind").
    //   3) otherwise back to the controller (LLM lane / task / a general answer).
    const grammarHit = parse(u);
    if (!grammarHit) {
      const onb = detectOnboarding(u);
      if (onb) {
        const reply = await applyOnboarding(onb);
        addMessage('assistant', reply); speak(reply);
        return;
      }
    }
    const res = await controller.handle(u, { returnToController: true });
    if (res.intent && res.intent.action === 'task' && res.ok) {
      addMessage('assistant', res.say); speak(res.say);
      startWaiting(); // the real result comes back as a note
      return;
    }
    if (res.intent && res.intent.type === 'unrecognized') {
      // 3) nothing deterministic matched → a general spoken answer (best-effort).
      const answer = await generalAnswer(u);
      addMessage('assistant', answer); speak(answer);
      return;
    }
    addMessage('assistant', res.say); speak(res.say);
  } catch (e) {
    stopWaiting(); earconError();
    const m = 'Sorry — ' + (e && e.message ? e.message : 'something went wrong') + '.';
    addMessage('assistant', m); speak(m);
  } finally {
    busy = false;
    $('composer-input').focus();
  }
}

// A general assistant answer for anything that isn't a setting, command, or
// self-description. Best-effort via Gemini; a helpful canned reply if no key.
async function generalAnswer(u) {
  try {
    const prompt = `You are the accessibility assistant inside a control surface. Answer the user's question briefly and plainly (2-3 sentences, no markdown). If it's about changing the page, remind them they can say things like "bigger text", "dark mode", "high contrast", "read this", or describe their needs like "I'm blind".\n\nUser: ${u.replace(/"/g, "'")}\nAnswer:`;
    return (await assistComplete(prompt)).trim() || fallbackHelp();
  } catch {
    return fallbackHelp();
  }
}
function fallbackHelp() {
  return 'I can change this page for you — try “bigger text”, “dark mode”, “high contrast”, “reduce motion”, or “read this”. Tell me about your needs (like “I’m blind” or “I have dyslexia”) and I’ll set up your profile. To send a full task to a connected app, describe what you want done.';
}

// ── voice input ───────────────────────────────────────────────────────────────
let recog = null, listening = false, gotText = false;
function setMic(on) {
  listening = on;
  const b = $('mic'); if (!b) return;
  b.setAttribute('aria-pressed', on ? 'true' : 'false');
  b.classList.toggle('listening', on);
  b.title = on ? 'Stop listening (Ctrl+Space)' : 'Speak (Ctrl+Space)';
}
// Start/stop dictation. Shared by the mic button and the Ctrl+Space shortcut.
function toggleMic() {
  if (!recog) return;
  if (listening) { recog.stop(); return; }
  try { recog.start(); setMic(true); } catch {}
}
function initVoiceInput() {
  const b = $('mic');
  if (!SR || !voiceInOn) { if (b) b.hidden = true; return; }
  if (b) b.hidden = false;
  recog = new SR(); recog.lang = 'en-US'; recog.interimResults = true; recog.maxAlternatives = 1;
  recog.onresult = (e) => { let t = ''; for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript; $('composer-input').value = t.replace(/\s+/g, ' ').trim(); gotText = !!$('composer-input').value; };
  recog.onerror = () => setMic(false);
  recog.onend = () => { setMic(false); if (gotText) { gotText = false; handleTurn($('composer-input').value); } };
  b.addEventListener('click', toggleMic);
}

// ── settings drawer ───────────────────────────────────────────────────────────
function initSettings() {
  const drawer = $('drawer'), ham = $('hamburger');
  const toggleDrawer = (open) => { drawer.hidden = !open; ham.setAttribute('aria-expanded', open ? 'true' : 'false'); };
  ham.addEventListener('click', () => toggleDrawer(drawer.hidden));
  $('drawer-close').addEventListener('click', () => { toggleDrawer(false); ham.focus(); });

  // Speak replies
  const speakCb = $('speak-cb'); speakCb.checked = speakReplies;
  speakCb.addEventListener('change', () => { speakReplies = speakCb.checked; try { localStorage.setItem(SPEAK_KEY, speakReplies ? '1' : '0'); } catch {} });
  // Voice output
  if (TTS && typeof window.speechSynthesis.getVoices === 'function') {
    loadVoices();
    const ss = window.speechSynthesis;
    if (typeof ss.addEventListener === 'function') ss.addEventListener('voiceschanged', loadVoices);
    else if ('onvoiceschanged' in ss) ss.onvoiceschanged = loadVoices;
    $('voice-select').addEventListener('change', (e) => { chosenVoice = e.target.value; try { localStorage.setItem(VOICE_KEY, chosenVoice); } catch {} });
  } else { $('voice-row').hidden = true; }
  // Voice input on/off
  const viCb = $('voicein-cb'); viCb.checked = voiceInOn && !!SR;
  if (!SR) { viCb.checked = false; viCb.disabled = true; $('voicein-row').title = 'Speech recognition is not available in this browser.'; }
  viCb.addEventListener('change', () => {
    voiceInOn = viCb.checked; try { localStorage.setItem(VOICEIN_KEY, voiceInOn ? '1' : '0'); } catch {}
    if (recog) { try { recog.abort(); } catch {} recog = null; }
    initVoiceInput();
  });
  // Drive: connect a remote receiver (default is the local demo app + window).
  $('connect-remote').addEventListener('click', () => useRemote($('ws-url').value.trim()));
  $('use-local-harness').addEventListener('click', () => { $('ws-url').value = 'ws://127.0.0.1:9333'; useRemote('ws://127.0.0.1:9333'); });

  // Reset profile: forget the current user and clear every applied setting — a
  // reload gives a fresh receiver (no adaptations), an empty transcript, and no
  // profile, i.e. starting from scratch as no specific person.
  $('reset-profile').addEventListener('click', () => {
    try { localStorage.removeItem('onb-uid'); localStorage.removeItem(HIST_KEY); } catch {}
    location.reload();
  });
}

// ── mirror adaptations onto the chat window itself ────────────────────────────
// The controller drives #demo-app (in the drawer). A setting the person asks for
// should also change the UI they're actually using, so we mirror the receiver's
// applied classes/vars from #demo-app onto #surface (the chat window). Driven by
// a MutationObserver, so it tracks apply AND undo, however the change was made.
const AA_CLASSES = ['aa-dark', 'aa-dyslexia', 'aa-reduce-motion', 'aa-hide-distractions', 'aa-focus-mode'];
const AA_VARS = ['--aa-font-scale', '--aa-line-height', '--aa-letter-spacing'];
function syncSurface() {
  const src = $('demo-app'), dst = $('surface');
  if (!src || !dst) return;
  for (const c of AA_CLASSES) dst.classList.toggle(c, src.classList.contains(c));
  for (const v of AA_VARS) { const val = src.style.getPropertyValue(v); if (val) dst.style.setProperty(v, val); else dst.style.removeProperty(v); }
  const contrast = src.getAttribute('data-aa-contrast');
  if (contrast) dst.setAttribute('data-aa-contrast', contrast); else dst.removeAttribute('data-aa-contrast');
}

// ── boot ──────────────────────────────────────────────────────────────────────
const localReceiver = createDomReceiver($('demo-app'), { scrollTarget: document.scrollingElement || document.documentElement });
currentControl = localReceiver;
new MutationObserver(syncSurface).observe($('demo-app'), { attributes: true, attributeFilter: ['class', 'style', 'data-aa-contrast'] });

async function boot() {
  await loadProfile();
  rebuildController();
  wireNotes();
  initSettings();
  initVoiceInput();

  $('composer-form').addEventListener('submit', (e) => { e.preventDefault(); handleTurn($('composer-input').value); });
  $('composer-input').addEventListener('keydown', onComposerKey); // Enter to send, Up/Down to recall history

  // Ctrl+Space anywhere starts/stops voice input (only when the mic is available
  // and enabled). Note: on macOS Ctrl+Space may also be the OS input-source
  // switcher; the toggle here fires regardless.
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && (e.code === 'Space' || e.key === ' ')) {
      if (SR && voiceInOn && recog) { e.preventDefault(); toggleMic(); }
    }
  });

  addMessage('assistant', 'Hi — I set up your ability profile and adapt your connected application. Try “I’m blind”, “I need bigger text”, “dark mode”, or tell me what you need. Say “help” for more.');
  $('composer-input').focus();
}
boot();
