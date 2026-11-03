// CaptionFlow demo player. Plays a video with large captions and slows the
// video, segment by segment, to the viewer's reading speed. Works the same on
// a phone and a laptop browser.
//
// The pacing decisions come from tools/utils/caption-pacing.js; the
// transcript format and parsing from tools/utils/timed-transcript.js. This
// file only wires them to a <video> element and the page.

import { readTranscript, segmentAt } from '../../../tools/utils/timed-transcript.js';
import { planPacing, pacingSummary, wpmFromReadingCheck, READING_SPEEDS } from '../../../tools/utils/caption-pacing.js';

const $ = (id) => document.getElementById(id);
const video = $('video');
const captionEl = $('caption');
const pill = $('pill');
const statusText = $('status-text');
const holdbar = $('holdbar');

// ---------------------------------------------------------------------------
// settings (remembered on this device only)
// ---------------------------------------------------------------------------

const STORE_KEY = 'captionflow.settings';
const settings = {
  wpm: READING_SPEEDS.medium,
  pacing: true,
  minRate: 0.5,
  hold: true,
  size: '1.75rem',
  colors: '#000000,#ffffff',
  ...loadSettings(),
};
function loadSettings() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); } catch { return {}; }
}
function saveSettings() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(settings)); } catch { /* private mode: keep in memory */ }
}

// ---------------------------------------------------------------------------
// state
// ---------------------------------------------------------------------------

let transcript = null;   // { segments, language, source }
let paced = [];          // segments + { rate, holdSec, readSec }
let shownIndex = -2;     // segment currently on screen
let holdTimer = null;    // a pause in progress
let holdUntil = 0;
const held = new Set();  // segments already held at, this play-through
let objectUrls = [];

// ---------------------------------------------------------------------------
// choosing a video
// ---------------------------------------------------------------------------

async function loadServerList() {
  const list = $('media-list');
  let items = [];
  try {
    const resp = await fetch('/api/media', { cache: 'no-store' });
    if (resp.ok) items = await resp.json();
  } catch { /* opened without serve.mjs: files only */ }
  list.replaceChildren();
  const ready = items.filter((i) => i.captions);
  $('media-empty').classList.toggle('hidden', ready.length > 0);
  for (const item of items) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.disabled = !item.captions;
    b.innerHTML = '<span></span><span class="tag"></span>';
    b.firstChild.textContent = item.name;
    b.lastChild.textContent = item.captions ? 'Watch' : 'No captions yet';
    b.addEventListener('click', () => openFromUrls(item.video, item.captions));
    li.append(b);
    list.append(li);
  }
}

async function openFromUrls(videoUrl, captionsUrl) {
  try {
    const resp = await fetch(captionsUrl, { cache: 'no-store' });
    if (!resp.ok) throw new Error(`Could not load captions (${resp.status})`);
    start(videoUrl, readTranscript(await resp.text()));
    history.replaceState(null, '', `?video=${encodeURIComponent(videoUrl)}&captions=${encodeURIComponent(captionsUrl)}`);
  } catch (e) { showPickerError(e); }
}

function tryOpenFiles() {
  const v = $('video-file').files[0];
  const c = $('captions-file').files[0];
  if (!v || !c) return;
  c.text().then((text) => {
    objectUrls.forEach(URL.revokeObjectURL);
    const url = URL.createObjectURL(v);
    objectUrls = [url];
    start(url, readTranscript(text));
  }).catch(showPickerError);
}

function showPickerError(e) {
  $('picker-error').textContent = e.message || String(e);
}

// ---------------------------------------------------------------------------
// watching
// ---------------------------------------------------------------------------

function start(videoUrl, t) {
  if (!t.segments.length) throw new Error('That captions file has no captions in it.');
  transcript = t;
  $('picker-error').textContent = '';
  video.src = videoUrl;
  captionEl.lang = langTag(t.language);
  replan();
  renderTranscript();
  $('picker').classList.add('hidden');
  $('stage').classList.remove('hidden');
  $('panel').classList.remove('hidden');
  $('main').classList.add('watching');
  resetPlayback();
  video.focus();
}

function langTag(lang) {
  return lang === 'sw' ? 'sw' : lang === 'en' ? 'en' : '';
}

function replan() {
  if (!transcript) return;
  paced = planPacing(transcript.segments, { wpm: settings.wpm, minRate: settings.minRate, holdIfNeeded: settings.hold });
  updateSummary();
  shownIndex = -2; // force the caption and rate to refresh
}

function updateSummary() {
  if (!paced.length) return;
  const dur = video.duration || transcript.segments[transcript.segments.length - 1].end;
  const s = pacingSummary(paced, dur);
  if (!settings.pacing) {
    $('summary').textContent = 'The video plays at normal speed. Turn on "Slow the video so I can read" to give yourself more time.';
    return;
  }
  if (!s.slowedCount && !s.heldCount) {
    $('summary').textContent = `At ${settings.wpm} words a minute you can read every caption at normal speed.`;
    return;
  }
  $('summary').textContent =
    `At ${settings.wpm} words a minute, ${s.slowedCount} of ${s.segmentCount} captions play slower` +
    (s.heldCount ? ` and ${s.heldCount} pause briefly` : '') +
    `. The video takes about ${fmtDuration(s.pacedDurationSec)} instead of ${fmtDuration(dur)}.`;
}

function resetPlayback() {
  cancelHold();
  held.clear();
  shownIndex = -2;
  video.playbackRate = 1;
}

// ---------------------------------------------------------------------------
// the pacing loop: every frame, show the right caption at the right speed
// ---------------------------------------------------------------------------

function tick() {
  if (paced.length && !holdTimer) {
    const t = video.currentTime;
    let i = segmentAt(paced, t);

    // Keep the last caption up through short gaps so it is not snatched away.
    if (i === -1 && shownIndex >= 0) {
      const prev = paced[shownIndex];
      const next = paced[shownIndex + 1];
      if (prev && t >= prev.end && t - prev.end < 1.5 && (!next || t < next.start)) i = shownIndex;
    }

    if (i !== shownIndex) {
      shownIndex = i;
      showCaption(i);
      highlightTranscript(i);
    }

    const seg = i >= 0 ? paced[i] : null;
    const inSpeech = seg && t < seg.end;
    const rate = settings.pacing && inSpeech ? seg.rate : 1;
    if (Math.abs(video.playbackRate - rate) > 0.01) video.playbackRate = rate;

    // Hold at the end of a segment that even the slowest speed can't cover.
    if (settings.pacing && settings.hold && inSpeech && seg.holdSec > 0 && !video.paused
        && t >= seg.end - 0.06 && !held.has(i)) {
      held.add(i);
      startHold(seg.holdSec);
      requestAnimationFrame(tick);
      return; // the hold owns the status line now
    }
    updateStatus(seg, inSpeech);
  }
  requestAnimationFrame(tick);
}

function startHold(sec) {
  video.pause();
  holdUntil = performance.now() + sec * 1000;
  holdbar.classList.remove('hidden');
  setPill('hold', 'Paused so you can finish reading');
  statusText.textContent = `${sec.toFixed(1)} s`;
  const bar = holdbar.firstElementChild;
  const total = sec * 1000;
  const step = () => {
    if (!holdTimer) return;
    const left = holdUntil - performance.now();
    bar.style.width = `${Math.min(100, (1 - left / total) * 100)}%`;
    if (left <= 0) {
      holdTimer = null;
      holdbar.classList.add('hidden');
      video.play().catch(() => {});
      return;
    }
    requestAnimationFrame(step);
  };
  holdTimer = true;
  requestAnimationFrame(step);
}

function cancelHold() {
  if (!holdTimer) return;
  holdTimer = null;
  holdbar.classList.add('hidden');
}

function setPill(kind, text) {
  if (pill.dataset.kind === kind && pill.textContent === text) return;
  pill.className = `pill ${kind}`;
  pill.dataset.kind = kind;
  pill.textContent = text;
}

function updateStatus(seg, inSpeech) {
  if (!settings.pacing) { setPill('normal', 'Normal speed'); statusText.textContent = 'Slowing is off'; return; }
  if (seg && inSpeech && seg.slowed) {
    setPill('slow', `Slowed to ${Math.round(seg.rate * 100)}%`);
    statusText.textContent = 'so you can read this caption';
  } else {
    setPill('normal', 'Normal speed');
    statusText.textContent = video.paused ? 'Paused' : '';
  }
}

function showCaption(i) {
  if (i < 0) {
    captionEl.classList.add('empty');
    captionEl.textContent = video.currentTime < 0.5 ? 'Captions appear here' : '';
    return;
  }
  const seg = paced[i];
  captionEl.classList.remove('empty');
  captionEl.lang = seg.lang ? langTag(seg.lang) : langTag(transcript.language);
  captionEl.replaceChildren();
  const span = document.createElement('span');
  span.textContent = seg.text;
  // The engine wasn't sure it heard this right: say so, quietly.
  if (seg.confidence != null && seg.confidence < 0.5) {
    span.className = 'unsure';
    span.title = 'The computer was not sure it heard this correctly';
  }
  captionEl.append(span);
}

// ---------------------------------------------------------------------------
// transcript list
// ---------------------------------------------------------------------------

function renderTranscript() {
  const ol = $('transcript');
  ol.replaceChildren();
  transcript.segments.forEach((s, i) => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.index = String(i);
    const time = document.createElement('time');
    time.textContent = fmtTime(s.start);
    const text = document.createElement('span');
    text.textContent = s.text;
    b.append(time, text);
    b.addEventListener('click', () => { video.currentTime = s.start + 0.01; video.play().catch(() => {}); });
    li.append(b);
    ol.append(li);
  });
}

let lastHighlighted = null;
function highlightTranscript(i) {
  if (lastHighlighted) lastHighlighted.classList.remove('current');
  lastHighlighted = i >= 0 ? $('transcript').querySelector(`[data-index="${i}"]`) : null;
  if (lastHighlighted) {
    lastHighlighted.classList.add('current');
    if (lastHighlighted.closest('details')?.open) lastHighlighted.scrollIntoView({ block: 'nearest' });
  }
}

// ---------------------------------------------------------------------------
// settings controls
// ---------------------------------------------------------------------------

function applyLook() {
  document.documentElement.style.setProperty('--cap-size', settings.size);
  const [bg, fg] = settings.colors.split(',');
  document.documentElement.style.setProperty('--cap-bg', bg);
  document.documentElement.style.setProperty('--cap-fg', fg);
  document.querySelectorAll('[data-size]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.size === settings.size)));
  document.querySelectorAll('[data-colors]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.colors === settings.colors)));
}

function syncControls() {
  $('wpm').value = settings.wpm;
  $('wpm-value').textContent = settings.wpm;
  $('pacing').checked = settings.pacing;
  $('min-rate').value = Math.round(settings.minRate * 100);
  $('min-rate-value').textContent = `${Math.round(settings.minRate * 100)}%`;
  $('hold').checked = settings.hold;
  applyLook();
}

function setWpm(wpm) {
  settings.wpm = Math.max(50, Math.min(240, Math.round(wpm)));
  syncControls();
  saveSettings();
  replan();
}

$('wpm').addEventListener('input', (e) => setWpm(Number(e.target.value)));
$('pacing').addEventListener('change', (e) => { settings.pacing = e.target.checked; saveSettings(); if (!settings.pacing) cancelHold(); replan(); });
$('min-rate').addEventListener('input', (e) => { settings.minRate = Number(e.target.value) / 100; syncControls(); saveSettings(); replan(); });
$('hold').addEventListener('change', (e) => { settings.hold = e.target.checked; saveSettings(); replan(); });
document.querySelectorAll('[data-size]').forEach((b) => b.addEventListener('click', () => { settings.size = b.dataset.size; saveSettings(); applyLook(); }));
document.querySelectorAll('[data-colors]').forEach((b) => b.addEventListener('click', () => { settings.colors = b.dataset.colors; saveSettings(); applyLook(); }));
$('change').addEventListener('click', () => {
  video.pause();
  $('stage').classList.add('hidden');
  $('panel').classList.add('hidden');
  $('picker').classList.remove('hidden');
  $('main').classList.remove('watching');
  history.replaceState(null, '', location.pathname);
  loadServerList();
});

// The person takes over: pressing play/pause or seeking ends any hold.
video.addEventListener('play', () => { if (holdTimer && performance.now() < holdUntil) cancelHold(); });
video.addEventListener('pause', () => { /* a hold pauses too; leave it */ });
video.addEventListener('seeking', () => {
  cancelHold();
  const t = video.currentTime;
  for (const i of [...held]) if (paced[i] && paced[i].end > t) held.delete(i);
  shownIndex = -2;
});
video.addEventListener('loadedmetadata', updateSummary);
video.addEventListener('ended', () => { held.clear(); });
if ('preservesPitch' in video) video.preservesPitch = true; // slowed speech keeps its pitch

$('video-file').addEventListener('change', tryOpenFiles);
$('captions-file').addEventListener('change', tryOpenFiles);

// ---------------------------------------------------------------------------
// reading-speed check
// ---------------------------------------------------------------------------

const CHECK_TEXT = {
  en: 'The county health office will open a free clinic at the market on Saturday morning. Bring your child\'s clinic card. Nurses will give vaccines, check weight and answer questions. The clinic closes at four in the afternoon.',
  sw: 'Ofisi ya afya ya kaunti itafungua kliniki ya bure sokoni Jumamosi asubuhi. Lete kadi ya kliniki ya mtoto wako. Wauguzi watatoa chanjo, watapima uzito na kujibu maswali. Kliniki itafungwa saa kumi jioni.',
};
let checkLang = 'en';
let checkStart = 0;
let checkWpm = null;
const dialog = $('check');
const step = (n) => [1, 2, 3].forEach((k) => $(`check-step-${k}`).classList.toggle('hidden', k !== n));

$('check-open').addEventListener('click', () => { video.pause(); step(1); dialog.showModal(); });
document.querySelectorAll('[data-check-lang]').forEach((b) => b.addEventListener('click', () => {
  checkLang = b.dataset.checkLang;
  document.querySelectorAll('[data-check-lang]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
}));
$('check-start').addEventListener('click', () => {
  $('check-text').textContent = CHECK_TEXT[checkLang];
  $('check-text').lang = checkLang;
  step(2);
  checkStart = performance.now();
  $('check-done').focus();
});
$('check-done').addEventListener('click', () => {
  checkWpm = wpmFromReadingCheck(CHECK_TEXT[checkLang], (performance.now() - checkStart) / 1000);
  $('check-result').textContent = checkWpm
    ? `You read about ${checkWpm} words a minute.`
    : 'That was too quick to measure. Try again?';
  $('check-use').disabled = !checkWpm;
  step(3);
});
$('check-use').addEventListener('click', () => { if (checkWpm) setWpm(checkWpm); dialog.close(); });
$('check-again').addEventListener('click', () => step(1));
$('check-cancel').addEventListener('click', () => dialog.close());

// ---------------------------------------------------------------------------
// helpers + boot
// ---------------------------------------------------------------------------

function fmtTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
function fmtDuration(sec) {
  if (!Number.isFinite(sec)) return '—';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m ? `${m} min ${s} s` : `${s} s`;
}

syncControls();
requestAnimationFrame(tick);
const params = new URLSearchParams(location.search);
if (params.get('video') && params.get('captions')) openFromUrls(params.get('video'), params.get('captions'));
else loadServerList();

// For tests and debugging in the console.
window.captionflow = { get paced() { return paced; }, get settings() { return settings; }, setWpm };
