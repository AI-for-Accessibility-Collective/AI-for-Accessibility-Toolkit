import { selectActiveCue, nextCue, replayCue } from '/player-sync.mjs';
import { viewCaptionsForMode } from '/caption-view.mjs';

const byId = id => document.getElementById(id);
const ids = ['video','video-file','caption-file','caption','caption-wrap','language','mode','pace','size','undo','contrast','replay','next','transcript','message','time-status','provider','generate','provider-note','hosted-consent-wrap','hosted-consent','download-json','download-transcript','demo-warning','caption-status','follow','show-times','transcript-size','transcript-search','search-prev','search-next','search-status'];
const els = Object.fromEntries(ids.map(id => [id, byId(id)]));
let cues = [];
let payload = null;
let source = 'fixture';  // fixture | generated | external
let currentCueId = null;
let lastManualPausedId = null;
let skipManualPauseForCueId = null;
let videoSelectionVersion = 0;
let isGenerating = false;
let objectUrl = null;
let providerAvailability = { fixture: true, local: true, hosted: false };
let matchIds = [];
let matchIndex = -1;
const timeLabel = t => `${Math.floor(t/60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const message = text => {
  els.message.textContent = text;
  els['caption-status'].textContent = text;
};

function validateCues(data) {
  if (!data || !Array.isArray(data.captions) || !data.captions.length) {
    throw new Error('Expected caption output with a nonempty captions array');
  }
  let lastStart = -1;
  const ids = new Set();
  return data.captions.map((cue, i) => {
    if (!cue || typeof cue.id !== 'string' || !cue.id.trim() || ids.has(cue.id) ||
        !Number.isFinite(cue.start) || !Number.isFinite(cue.end) ||
        cue.start < 0 || cue.end <= cue.start || cue.start < lastStart ||
        typeof cue.originalText !== 'string' || !cue.originalText.trim() ||
        typeof cue.displayText !== 'string' || !cue.displayText.trim()) {
      throw new Error(`Invalid caption at index ${i}`);
    }
    ids.add(cue.id);
    lastStart = cue.start;
    return { ...cue };
  });
}

function captionsFromTranscript(data) {
  const transcript = data?.transcript?.segments ? data.transcript : data;
  if (!Array.isArray(transcript?.segments) || transcript.segments.length === 0) throw new Error('No transcript segments found');
  return {
    videoId: transcript.videoId || 'local-transcript',
    sourceLanguage: transcript.sourceLanguage,
    transcript,
    captions: transcript.segments.map(segment => ({
      id: segment.id, start: segment.start, end: segment.end,
      originalText: segment.text, displayText: segment.text,
      language: segment.language || transcript.sourceLanguage,
      mode: 'original', status: 'ready',
    })),
    warnings: [],
  };
}

function renderTranscript() {
  els.transcript.replaceChildren();
  for (const cue of cues) {
    const li = document.createElement('li');
    li.dataset.id = cue.id;
    const button = document.createElement('button');
    button.type = 'button';
    const timestamp = document.createElement('span');
    timestamp.className = 'time';
    timestamp.textContent = timeLabel(cue.start);
    const text = document.createElement('span');
    text.className = 'line-text';
    text.textContent = cue.displayText;
    button.append(timestamp, ' ', text);
    if (cue.status && cue.status !== 'ready') {
      const flag = document.createElement('span');
      flag.className = 'flag';
      flag.textContent = cue.status === 'needs-review' ? ' Unreviewed wording' : ' Original fallback';
      button.append(' ', flag);
    }
    button.addEventListener('click', () => {
      els.video.currentTime = cue.start;
      sync();
      els.video.focus();
    });
    li.append(button);
    els.transcript.append(li);
  }
  applySearch();
}

function appendHighlighted(parent, text, query) {
  parent.replaceChildren();
  if (!query) {
    parent.textContent = text;
    return;
  }
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  let from = 0;
  for (let at = lowerText.indexOf(lowerQuery); at !== -1; at = lowerText.indexOf(lowerQuery, from)) {
    if (at > from) parent.append(text.slice(from, at));
    const mark = document.createElement('mark');
    mark.textContent = text.slice(at, at + query.length);
    parent.append(mark);
    from = at + query.length;
  }
  if (from < text.length) parent.append(text.slice(from));
}

function searchQuery() {
  return els['transcript-search'].value.trim();
}

function applySearch() {
  const query = searchQuery();
  matchIds = query ? cues.filter(cue => cue.displayText.toLowerCase().includes(query.toLowerCase())).map(cue => cue.id) : [];
  matchIndex = -1;
  for (const li of els.transcript.children) {
    const isMatch = matchIds.includes(li.dataset.id);
    li.classList.toggle('match', isMatch);
    li.classList.remove('match-current');
    appendHighlighted(li.querySelector('.line-text'), cues.find(cue => cue.id === li.dataset.id).displayText, query);
  }
  updateSearchControls();
}

function updateSearchControls() {
  const count = matchIds.length;
  els['search-prev'].disabled = count === 0;
  els['search-next'].disabled = count === 0;
  if (!searchQuery()) els['search-status'].textContent = '';
  else if (count === 0) els['search-status'].textContent = 'No matches in this transcript.';
  else if (matchIndex < 0) els['search-status'].textContent = `${count} ${count === 1 ? 'match' : 'matches'}. Press Next match to start.`;
  else els['search-status'].textContent = `Match ${matchIndex + 1} of ${count}.`;
}

function goToMatch(step) {
  if (!matchIds.length) return;
  const count = matchIds.length;
  matchIndex = matchIndex < 0 ? (step > 0 ? 0 : count - 1) : (matchIndex + step + count) % count;
  const id = matchIds[matchIndex];
  const cue = cues.find(item => item.id === id);
  for (const li of els.transcript.children) li.classList.toggle('match-current', li.dataset.id === id);
  els.video.currentTime = cue.start;
  const line = els.transcript.querySelector(`li[data-id="${CSS.escape(id)}"]`);
  scrollLineIntoTranscript(line);
  sync();
  updateSearchControls();
}

function scrollLineIntoTranscript(line) {
  if (!line) return;
  const top = line.offsetTop - els.transcript.clientHeight / 2 + line.offsetHeight / 2;
  els.transcript.scrollTo({ top, behavior: 'auto' });
}

function followActiveLine() {
  scrollLineIntoTranscript(els.transcript.querySelector('.active'));
}

function transcriptText() {
  return cues.map(cue => `[${timeLabel(cue.start)}] ${cue.displayText}`).join('\n');
}

function sync() {
  const cue = selectActiveCue(cues, els.video.currentTime || 0);
  els.caption.textContent = cue?.displayText ?? (cues.length ? ' ' :
    (els['video-file'].files?.length ? 'Captions not loaded yet' : 'Choose a video to begin.'));
  if (skipManualPauseForCueId && cue?.id !== skipManualPauseForCueId) {
    skipManualPauseForCueId = null;
  }
  if (cue?.id !== currentCueId) {
    currentCueId = cue?.id ?? null;
    for (const li of els.transcript.children) {
      const isActive = li.dataset.id === currentCueId;
      li.classList.toggle('active', isActive);
      if (isActive) li.firstElementChild.setAttribute('aria-current', 'true');
      else li.firstElementChild.removeAttribute('aria-current');
    }
    if (currentCueId && els.follow.checked) followActiveLine();
  }
  els['time-status'].textContent = `Playback position: ${timeLabel(els.video.currentTime || 0)}${cue ? ` · Caption ${cue.id}` : ''}`;
  if (cue && els.pace.value === 'manual' && !els.video.paused &&
      cue.id !== lastManualPausedId && cue.id !== skipManualPauseForCueId &&
      els.video.currentTime >= cue.start + 0.06) {
    lastManualPausedId = cue.id;
    els.video.pause();
    message('Paused at a new caption. Read it, then press Play to continue.');
  }
}
function setCaptions(data, nextSource) {
  cues = validateCues(data);
  payload = data;
  source = nextSource;
  currentCueId = null;
  lastManualPausedId = null;
  skipManualPauseForCueId = null;
  renderTranscript();
  sync();
  els['download-json'].disabled = false;
  els['download-transcript'].disabled = false;
  els.replay.disabled = false;
  els.next.disabled = false;
  els['demo-warning'].hidden = nextSource !== 'fixture';
}
function applyGeneratedMode() {
  if (!['generated', 'external'].includes(source) || !payload?.transcript?.segments) return;
  const desiredLanguage = els.language.value;
  const desiredMode = els.mode.value;
  const changed = {
    ...payload,
    captions: viewCaptionsForMode(payload, { language: desiredLanguage, mode: desiredMode }),
  };
  setCaptions(changed, source);
  if (changed.captions.some(c => c.language !== desiredLanguage)) {
    message(`Translation to ${desiredLanguage} is not available. Showing original speech captions, correctly labeled in their source language.`);
  } else if (desiredMode === 'plain') {
    const reviewed = changed.captions.filter(c => c.status === 'needs-review').length;
    message(reviewed
      ? `Showing ${changed.captions.length} timed captions with ${reviewed} experimental wording suggestions. Review the changes; original text is always available.`
      : 'No safe rule-based rewrite was found for these captions. Showing original speech rather than inventing simpler wording.');
  } else {
    message(`Showing ${cues.length} original timed captions from ${payload.provider || 'the selected provider'}.`);
  }
}
async function loadDemoCues() {
  const language = els.language.value === 'sw' ? 'sw' : 'en';
  const params = new URLSearchParams({ lang: language, mode: els.mode.value });
  const response = await fetch(`/api/captions?${params}`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? 'Fixture captions unavailable');
  setCaptions(data, 'fixture');
  message(`${cues.length} fictional sample captions loaded; they are NOT related to an arbitrary selected video.`);
}
function applyScale(value) {
  els['caption-wrap'].style.setProperty('--caption-scale', String(value));
  els.size.value = String(value);
}
function applyPace() {
  els.video.playbackRate = els.pace.value === 'slow' ? 0.75 : 1;
  lastManualPausedId = null;
  sync();
}
function updateProviderUI() {
  const provider = els.provider.value;
  els['hosted-consent-wrap'].hidden = provider !== 'hosted';
  els.generate.textContent = provider === 'fixture' ? 'Load sample captions' : 'Generate captions from this video';
  els.generate.disabled = isGenerating || !providerAvailability[provider];
  els['provider-note'].textContent = provider === 'fixture'
    ? 'Fixture mode loads fictional captions for interface testing. They do not correspond to your selected video.'
    : provider === 'local'
      ? 'Local mode temporarily sends this video to the loopback server running faster-whisper. The temporary file is deleted afterward.'
      : 'Hosted mode sends your video to the configured external ASR endpoint. Use only consented material. Requires a compatible endpoint and token.';
}

els['video-file'].addEventListener('change', () => {
  videoSelectionVersion += 1;
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  const file = els['video-file'].files?.[0];
  if (!file) {
    objectUrl = null;
    els.video.removeAttribute('src');
    els.video.load();
    cues = []; payload = null; currentCueId = null;
    els.transcript.replaceChildren();
    els.caption.textContent = 'Choose a video to begin.';
    els.replay.disabled = true; els.next.disabled = true; els['download-json'].disabled = true; els['download-transcript'].disabled = true;
    message('No video or captions selected. Choose a video to continue.');
    return;
  }
  objectUrl = URL.createObjectURL(file);
  els.video.src = objectUrl;
  els.video.load();
  // Never show unrelated fixture captions against a new video automatically.
  cues = []; payload = null; source = 'external'; currentCueId = null;
  skipManualPauseForCueId = null; lastManualPausedId = null;
  els.transcript.replaceChildren();
  els.caption.textContent = 'No captions yet';
  els.replay.disabled = true; els.next.disabled = true;
  els['download-json'].disabled = true;
  els['download-transcript'].disabled = true;
  els['demo-warning'].hidden = true;
  message('Video opened. Select Local and generate matching timed captions, or load a transcript JSON for this exact clip.');
});

els['caption-file'].addEventListener('change', async () => {
  const file = els['caption-file'].files?.[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const parsed = Array.isArray(data.captions) ? data : captionsFromTranscript(data);
    setCaptions(parsed, 'external');
    message(`Loaded ${cues.length} caption segments from JSON. Verify they match the selected video and its timestamps.`);
  } catch (error) { message(`Unable to load caption JSON: ${error.message}`); }
});

els.generate.addEventListener('click', async () => {
  const provider = els.provider.value;
  if (provider === 'fixture') {
    try { await loadDemoCues(); }
    catch (error) { message(error.message); }
    return;
  }
  const file = els['video-file'].files?.[0];
  if (!file) { message('Choose a video file first.'); return; }
  const selectionVersion = videoSelectionVersion;
  if (provider === 'hosted' && !els['hosted-consent'].checked) {
    message('Please explicitly consent to sending this video to the hosted ASR endpoint.'); return;
  }
  const language = els.language.value;
  const params = new URLSearchParams({ provider, language, mode: els.mode.value, consent: provider === 'hosted' ? 'yes' : 'no' });
  isGenerating = true;
  updateProviderUI();
  message(provider === 'local' ? 'Local faster-whisper is transcribing the selected video. This can take a while on a CPU…' : 'Sending consented video to the configured hosted transcription service…');
  try {
    const response = await fetch(`/api/transcribe?${params}`, {
      method: 'POST', headers: { 'Content-Type': file.type || 'video/mp4' }, body: file,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Transcription failed with status ${response.status}`);
    if (selectionVersion !== videoSelectionVersion || els['video-file'].files?.[0] !== file) {
      message('The video changed while transcription was running. The old result was discarded; generate captions for the new video.');
      return;
    }
    setCaptions(data, 'generated');
    if (['en', 'sw'].includes(data.sourceLanguage)) els.language.value = data.sourceLanguage;
    applyGeneratedMode();
    if (Number.isFinite(els.video.duration) && cues.at(-1)?.end > els.video.duration + 1) {
      message('Warning: generated captions extend past this video duration. Verify the video and ASR output.');
    }
  } catch (error) { message(`Could not transcribe: ${error.message}`); }
  finally { isGenerating = false; updateProviderUI(); }
});

els.provider.addEventListener('change', () => {
  if (els.provider.value !== 'fixture') els.mode.value = 'original';
  updateProviderUI();
});
for (const name of ['language', 'mode']) els[name].addEventListener('change', () => {
  if (['generated', 'external'].includes(source) && payload?.transcript?.segments) { applyGeneratedMode(); return; }
  if (source === 'fixture') loadDemoCues().catch(error => message(error.message));
  else message('Using selected caption JSON. Change the JSON or re-transcribe to change caption language or wording.');
});
els.pace.addEventListener('change', applyPace);
els['transcript-size'].addEventListener('change', () => { els.transcript.dataset.size = els['transcript-size'].value; });
els['show-times'].addEventListener('change', () => els.transcript.classList.toggle('hide-times', !els['show-times'].checked));
els['transcript-search'].addEventListener('input', applySearch);
els['transcript-search'].addEventListener('keydown', event => {
  if (event.key === 'Enter') {
    event.preventDefault();
    goToMatch(event.shiftKey ? -1 : 1);
  }
});
els['search-next'].addEventListener('click', () => goToMatch(1));
els['search-prev'].addEventListener('click', () => goToMatch(-1));
els['download-transcript'].addEventListener('click', () => {
  if (!cues.length) return;
  const url = URL.createObjectURL(new Blob([transcriptText()], { type: 'text/plain' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${payload?.videoId || 'captionflow'}-transcript.txt`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
els.size.addEventListener('change', async () => {
  try {
    const response = await fetch('/api/font-scale', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: Number(els.size.value) }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    applyScale(data.fontScale);
    message('Caption size saved to the local toolkit profile.');
  } catch (error) { message(`Could not save caption size: ${error.message}`); }
});
els.undo.addEventListener('click', async () => {
  try {
    const response = await fetch('/api/undo-font-scale', { method: 'POST' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    applyScale(data.preferences.fontScale);
    message(data.undone ? 'Previous caption size restored.' : 'There is no earlier caption-size change to undo.');
  } catch (error) { message(`Undo failed: ${error.message}`); }
});
els.contrast.addEventListener('change', () => els['caption-wrap'].classList.toggle('low', !els.contrast.checked));
els.replay.addEventListener('click', () => {
  const cue = replayCue(cues, els.video.currentTime);
  if (!cue) { message('There is no previous caption to replay at this position.'); return; }
  // Do not immediately auto-pause again at the start of a manually replayed cue.
  skipManualPauseForCueId = cue.id;
  els.video.currentTime = cue.start;
  sync();
  els.video.play().then(
    () => message(`Replaying caption ${cue.id}.`),
    error => message(`Unable to resume playback: ${error.message}`),
  );
});
els.next.addEventListener('click', () => {
  const cue = nextCue(cues, els.video.currentTime);
  if (cue) {
    els.video.currentTime = cue.start;
    sync();
    message(`Moved to caption ${cue.id}. Press Play to continue.`);
  } else message('You are already at the last available caption.');
});
els['download-json'].addEventListener('click', () => {
  if (!payload) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${payload.videoId || 'captionflow'}-captions.json`;
  anchor.click();
  // Allow the click to consume its object URL; release after the next task.
  queueMicrotask(() => URL.revokeObjectURL(url));
});
els.video.addEventListener('timeupdate', sync);
els.video.addEventListener('seeking', sync);
els.video.addEventListener('seeked', () => { lastManualPausedId = null; sync(); });
els.video.addEventListener('ratechange', sync);
els.video.addEventListener('loadedmetadata', sync);
els.replay.disabled = true;
els.next.disabled = true;
window.addEventListener('beforeunload', () => { if (objectUrl) URL.revokeObjectURL(objectUrl); });

try {
  const [providersResponse, prefsResponse] = await Promise.all([fetch('/api/providers'), fetch('/api/preferences')]);
  const providers = await providersResponse.json();
  const prefs = await prefsResponse.json();
  if (!providersResponse.ok || !prefsResponse.ok) throw new Error(providers.error || prefs.error || 'Setup failed');
  providerAvailability = providers.providers;
  for (const option of els.provider.options) option.disabled = !providerAvailability[option.value];
  els.provider.value = providerAvailability[providers.defaultProvider] ? providers.defaultProvider : 'fixture';
  applyScale(prefs.fontScale);
  updateProviderUI();
  if (els.provider.value === 'fixture') await loadDemoCues();
  else { els.mode.value = 'original'; message('Select a local video and generate timed captions.'); }
  applyPace();
} catch (error) { message(`Setup failed: ${error.message}`); }