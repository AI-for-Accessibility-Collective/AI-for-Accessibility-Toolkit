// The side panel's Profile tab: the person's profile on the toolkit (one
// record per account, toolkit/core/librarian.js), then their adapters.
//
// The person describes their abilities in their own words (typed, or spoken
// with the browser's speech recognition). Saving asks the toolkit's model
// (the `profile` task on /v1/ai, Gemini Flash) what that means for web
// pages: support areas, needs (blocks/profile-words.js) and plain language,
// and writes them with the words in one setProfileFields. A preset (the
// developer console's, /v1/profile/presets) can replace it all.
//
// Needs adapters and apps registered (toolkit/core/needs.js): the profile
// agent decides from the profile whether each fits; what it suggests is
// under Suggested for you, for the person to answer. Adding one switches on
// the adapter that meets it.
//
// Adapters, three sections. Every adapter in this browser has a switch that
// turns it off (and on again) everywhere.
//   Applied on this page  the installed adapters that target the page beside
//                         the panel, what happened when they ran, and a
//                         switch for this site
//   Recommended (folded)  adapters the account can use that are not in this
//                         browser yet, for the profile's support areas
//                         (adapter_search, one area at a time), most areas
//                         in common first
//   All (folded)          every adapter the browser can run, by application
//
// A change of profile anywhere (this tab, the console, another app) comes
// through /v1/profile/events: the tab redraws and the runtime syncs.

import { readConnection } from '../runtime/config.js';
import { createRegistryClient } from '../vendor/adapter-mcp/registry.js';
import { BROWSER_RUNTIME_APP } from '../vendor/protocol/adapter/index.js';
import { PROFILE_AREAS, PROFILE_NEEDS, cleanProfileReading } from '../vendor/blocks/profile-words.js';
import { $, say, el, button, ask, pageTab, keyOf } from './ui.js';

const RESULT_TEXT = { applied: 'Running on this page', failed: 'Failed', skipped: 'Not running', removed: 'Switched off' };

let connection = null;
let registry = null;
let profile = null;   // the record
let selection = null; // {id, name, edited} or null
let presets = [];
let events = null;    // AbortController of /v1/profile/events
let lastRevision = null;
let suggested = [];   // the profile agent's suggestions about them, waiting for an answer

async function service(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${connection.url}${path}`, {
    method,
    headers: { authorization: `Bearer ${connection.token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.message || data.error || `The toolkit answered ${res.status}.`);
  return data;
}
const librarian = async (method, args = []) => (await service(`/v1/librarian/${method}`, { method: 'POST', body: { args } })).result;

// ── the profile ──────────────────────────────────────────────────────────────

const needsOf = (p) => (Array.isArray(p?.fields?.needs) ? p.fields.needs : []);
const areasOf = (p) => (Array.isArray(p?.supportAreas) ? p.supportAreas : []);

async function loadProfile() {
  const [p, sel, pre] = await Promise.all([
    librarian('getProfile'),
    service('/v1/profile/selection').catch(() => null),
    service('/v1/profile/presets').catch(() => null),
  ]);
  profile = p;
  selection = sel?.selected || null;
  presets = pre?.presets || [];
  await loadSuggestions();
}

async function loadSuggestions() {
  const learned = await registry.profile.learned().catch(() => null);
  suggested = (learned?.proposals || []).filter(x => x.change?.op === 'need-add' || x.change?.op === 'need-remove');
}

function renderProfile() {
  // What the person is typing or saying stays.
  if (document.activeElement !== $('profile-words') && !listening) $('profile-words').value = profile?.freeText || '';
  renderSuggestions();
  renderPresets();
}

/** The profile agent's suggestions about registered needs: add (or remove), not now, or never. */
function renderSuggestions() {
  $('profile-suggestions').hidden = !suggested.length;
  $('profile-suggested').replaceChildren(...suggested.map((p) => {
    const li = el('li');
    li.append(el('strong', '', p.change.op === 'need-add' ? p.label : `Stop: ${p.label}`));
    if (p.rationale) li.append(el('span', 'about', p.rationale));
    const row = el('div', 'row');
    const answer = (response, said) => async () => {
      for (const b of row.querySelectorAll('button')) b.disabled = true;
      try {
        const r = await registry.profile.respond(p.id, response);
        if (r?.ok === false) throw new Error(`Could not answer that (${r.reason}).`);
        await loadProfile();
        renderProfile();
        ask('sync').catch(() => {});
        refreshAdapters();
        say(said);
      } catch (e) { say(e.message, true); for (const b of row.querySelectorAll('button')) b.disabled = false; }
    };
    const yes = button(p.change.op === 'need-add' ? 'Add' : 'Remove', 'primary', answer('accept', `${p.change.op === 'need-add' ? 'Added' : 'Removed'}: ${p.label}.`));
    const later = button('Not now', 'secondary', answer('declineOnce', `Not now: ${p.label}.`));
    const never = button('Don’t suggest again', 'secondary', answer('suppress', `Your toolkit won’t suggest this again: ${p.label}.`));
    for (const b of [yes, later, never]) b.setAttribute('aria-label', `${b.textContent}: ${p.label}`);
    row.append(yes, later, never);
    li.append(row);
    return li;
  }));
}

/** Suggestions come a few seconds after the profile changes: look again a little later. */
function lookForSuggestions() {
  for (const ms of [7000, 15000]) setTimeout(async () => { await loadSuggestions(); renderSuggestions(); }, ms);
}

function renderPresets() {
  $('profile-started').textContent = selection ? `Your profile started from ${selection.name}${selection.edited ? ' and has changed since' : ''}.` : 'Your profile did not start from a preset.';
  $('profile-presets').hidden = !presets.length;
  const select = $('profile-preset');
  if (document.activeElement === select) return;
  select.replaceChildren(Object.assign(el('option', '', 'Choose a preset'), { value: '' }),
    ...presets.map(p => Object.assign(el('option', '', p.description ? `${p.name}: ${p.description}` : p.name), { value: p.id })));
}

/** Save the words: the toolkit's model reads them, then all of it is written at once. */
async function saveWords(event) {
  event.preventDefault();
  stopListening();
  const words = $('profile-words').value.trim();
  if (!words) { say('Describe your abilities first, in a sentence or two.', true); return; }
  const save = $('words-save');
  save.disabled = true;
  $('profile-working').hidden = false;
  say('Understanding what you wrote…');
  try {
    const res = await fetch(`${connection.url}/v1/ai/text`, {
      method: 'POST',
      headers: { authorization: `Bearer ${connection.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ task: 'profile', input: words, adapter: 'toolkit/profile' }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.message || body.error || `The toolkit answered ${res.status}.`);
    const reading = cleanProfileReading(body.text);
    if (!reading) {
      // Keep the words, so nothing said is lost.
      profile = await librarian('setProfileFields', [{ freeText: words }]);
      renderProfile();
      say(body.reason === 'no-answer' ? 'Saved your words. Say a little more about what gets in your way, like the example, and save again.' : 'Saved your words, but the toolkit could not work out what pages should do. Say a little more and save again.', true);
      return;
    }
    // Needs this tab does not show stay as they were.
    const kept = needsOf(profile).filter(n => !PROFILE_NEEDS.some(d => d.id === n.dimension));
    profile = await librarian('setProfileFields', [{
      freeText: words,
      supportAreas: reading.supportAreas,
      'fields.needs': [...reading.needs.map(n => ({ ...n, strength: 'preference', source: 'person-words' })), ...kept],
      'fields.wordsSummary': reading.summary,
      'metaPreferences.language': reading.plainLanguage ? 'plain' : 'standard',
    }]);
    renderProfile();
    lookForSuggestions();
    say(`Saved. ${reading.summary || 'Your adapters follow it now.'}`);
    ask('sync').catch(() => {});
    refreshAdapters();
  } catch (e) {
    say(e.message, true);
  } finally {
    save.disabled = false;
    $('profile-working').hidden = true;
  }
}

async function usePreset() {
  const id = $('profile-preset').value;
  if (!id) { say('Choose a preset first.', true); return; }
  try {
    const got = await service('/v1/profile/select', { method: 'POST', body: { id } });
    profile = got.profile || await librarian('getProfile');
    selection = got.selected || null;
    renderProfile();
    say(`Your profile now starts from ${selection?.name || 'that preset'}.`);
    ask('sync').catch(() => {});
    refreshAdapters();
  } catch (e) { say(e.message, true); }
}

// ── speaking instead of typing ───────────────────────────────────────────────

let recognition = null;
let listening = false;
function stopListening() { if (listening) recognition?.stop(); }
function toggleVoice() {
  const Recognition = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
  if (!Recognition) { say('Speaking needs a browser with speech recognition. Type instead.', true); return; }
  if (listening) { stopListening(); return; }
  const area = $('profile-words');
  const before = area.value.trim();
  recognition = new Recognition();
  recognition.lang = navigator.language || 'en-US';
  recognition.interimResults = true;
  recognition.continuous = true;
  recognition.onresult = (e) => {
    const heard = [...e.results].map(r => r[0].transcript).join(' ').replace(/\s+/g, ' ').trim();
    area.value = [before, heard].filter(Boolean).join(' ');
  };
  recognition.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      // A side panel cannot ask for the microphone itself: a page of the extension asks once.
      say('Allow the microphone in the tab that opened, then press Speak again.', true);
      chrome.tabs.create({ url: chrome.runtime.getURL('sidepanel/microphone.html') });
    } else if (e.error !== 'aborted' && e.error !== 'no-speech') say(`Speaking stopped: ${e.error}.`, true);
  };
  recognition.onend = () => {
    listening = false;
    $('words-voice').setAttribute('aria-pressed', 'false');
    $('words-voice').textContent = 'Speak';
  };
  recognition.start();
  listening = true;
  $('words-voice').setAttribute('aria-pressed', 'true');
  // The button says so (Stop speaking, pressed); no line at the bottom of the panel.
  $('words-voice').textContent = 'Stop speaking';
}

// ── adapters ─────────────────────────────────────────────────────────────────

const empty = (text) => { const ul = el('ul', 'adapters'); ul.append(el('li', 'empty', text)); return ul; };
const SECTIONS = {
  applied: { about: 'applied-about', list: 'applied-list', make: appliedList },
  recommended: { about: 'recommended-about', list: 'recommended-list', make: recommendedList, box: 'recommended-box' },
  all: { about: 'all-about', list: 'all-list', make: allList, box: 'all-box' },
};
const generations = {};

/** Draw one section (a folded one only while it is open). */
async function renderSection(name) {
  const sec = SECTIONS[name];
  if (sec.box && !$(sec.box).open) return;
  const mine = generations[name] = (generations[name] || 0) + 1;
  const box = $(sec.list);
  if (!box.childElementCount) box.replaceChildren(el('p', 'hint', 'Looking…'));
  try {
    const { state } = await ask('status');
    const { about, parts } = await sec.make(state);
    if (mine !== generations[name]) return;
    $(sec.about).textContent = about;
    box.replaceChildren(...parts);
  } catch (e) {
    if (mine !== generations[name]) return;
    box.replaceChildren(el('p', 'hint', `Could not list adapters: ${e.message}`));
  }
}

async function appliedList(state) {
  const tab = await pageTab();
  if (!tab?.url || !/^https?:/.test(tab.url)) {
    return { about: 'The installed adapters that run on the page beside this panel.', parts: [empty('Adapters run on web pages (http and https).')] };
  }
  const { adapters, origin } = await ask('forUrl', { url: tab.url });
  const about = `On ${new URL(origin).host}.`;
  if (!adapters.length) return { about, parts: [empty('None of your adapters runs on this page. Recommended and All show more.')] };
  const results = state.tabs?.[tab.id] || {};
  // What runs first, then the rest.
  const order = (a) => (results[keyOf(a)]?.status === 'applied' ? 0 : 1);
  const list = el('ul', 'adapters');
  for (const a of [...adapters].sort((x, y) => order(x) - order(y))) list.append(appliedItem(a, state, origin, results[keyOf(a)]));
  return { about, parts: [list] };
}

/** The switch that turns an adapter in this browser off, or on again, everywhere. */
function onSwitch(a, enabled) {
  const name = a.name || a.adapter.id;
  const label = el('label', 'site-switch');
  const box = Object.assign(document.createElement('input'), { type: 'checkbox', checked: enabled });
  box.setAttribute('role', 'switch');
  box.setAttribute('aria-label', name);
  box.addEventListener('change', async () => {
    box.disabled = true;
    try {
      await ask('setEnabled', { key: keyOf(a), on: box.checked });
      say(box.checked ? `${name} is on.` : `${name} is off.`);
    } catch (e) { say(e.message, true); box.checked = !box.checked; }
    box.disabled = false;
    refreshAdapters();
  });
  label.append(box, document.createTextNode('On'));
  return label;
}

function appliedItem(a, state, origin, r) {
  const key = keyOf(a);
  const item = el('li');
  const top = el('div', 'adapter-top');
  top.append(el('strong', '', a.name || a.adapter.id), onSwitch(a, a.enabled));
  const on = a.sites?.[origin] !== false;
  const label = el('label', 'site-switch');
  const box = Object.assign(document.createElement('input'), { type: 'checkbox', checked: on && a.enabled && a.available, disabled: !a.available || !a.enabled });
  box.setAttribute('role', 'switch');
  box.setAttribute('aria-label', `${a.name || a.adapter.id} on ${origin}`);
  box.addEventListener('change', async () => {
    box.disabled = true;
    try {
      await ask('setSite', { key, origin, on: box.checked });
      say(box.checked ? `${a.name} is on for ${origin}.` : `${a.name} is off for ${origin}.`);
    } catch (e) { say(e.message, true); box.checked = !box.checked; }
    renderSection('applied');
  });
  label.append(box, document.createTextNode('This site'));
  top.append(label);
  item.append(top, el('span', 'from', `${a.appName || a.adapter.appId} · ${a.mine ? 'yours' : `shared by ${a.owner}`}`));
  if (!a.available) item.append(el('span', 'result failed', a.reason === 'not-shared' ? 'No longer shared by its owner.' : 'Deleted by its owner.'));
  else if (!a.enabled) item.append(el('span', 'result', 'Switched off.'));
  else if (!on) item.append(el('span', 'result', 'Off on this site.'));
  else if (r) item.append(el('span', `result ${r.status}`, `${RESULT_TEXT[r.status] || r.status}${r.message ? `: ${r.message}` : ''}`));
  else item.append(el('span', 'result', 'Runs when the page loads. Reload the page if it was open before.'));
  // What the person adjusted with it here, for every site.
  const adj = state.adjustable?.[key];
  const site = new URL(origin).hostname.toLowerCase().replace(/^www\./, '');
  const setHere = (adj?.settings || []).filter(k => state.explicit?.sites?.[site]?.[k] !== undefined);
  if (setHere.length) {
    const every = button(`Use my ${adj.label.toLowerCase()} on every site`, 'secondary every-site', async () => {
      every.disabled = true;
      try { await ask('everySite', { key, origin }); say(`Your ${adj.label.toLowerCase()} from ${site} is now used on every site.`); } catch (e) { say(e.message, true); every.disabled = false; }
    });
    item.append(every);
  }
  return item;
}

const installedKeys = (state) => new Set((state.adapters || []).map(keyOf));
const areaName = (id) => PROFILE_AREAS.find(a => a.id === id)?.name || id;

async function recommendedList(state) {
  const areas = areasOf(profile);
  const about = areas.length
    ? `For ${areas.map(a => areaName(a).toLowerCase()).join(', ')}, not in this browser yet.`
    : 'Describe your abilities above to see adapters for you.';
  if (!areas.length) return { about, parts: [empty('No support areas in your profile yet.')] };
  const found = new Map();
  for (const area of areas) {
    const { adapters } = await registry.search({ supportArea: area, portable: true });
    for (const a of adapters) {
      const k = keyOf(a);
      const hit = found.get(k) || { a, areas: 0 };
      hit.areas++;
      found.set(k, hit);
    }
  }
  const have = installedKeys(state);
  const list = [...found.values()].filter(({ a }) => !have.has(keyOf(a))).sort((x, y) => y.areas - x.areas || (x.a.name || '').localeCompare(y.a.name || ''));
  if (!list.length) return { about, parts: [empty(found.size ? 'Every adapter for your support areas is already in this browser.' : 'No adapters for your support areas yet. Build one in the Builder tab.')] };
  const ul = el('ul', 'adapters');
  for (const { a } of list.slice(0, 30)) ul.append(registryItem(a, null));
  return { about, parts: [ul] };
}

async function allList(state) {
  const about = 'Every adapter this browser can run, by the application it came from.';
  const { adapters } = await registry.search({ portable: true });
  if (!adapters.length) return { about, parts: [empty('No adapters yet. Build one in the Builder tab.')] };
  const have = new Map((state.adapters || []).map(a => [keyOf(a), a]));
  const groups = new Map();
  for (const a of adapters) {
    const app = a.appName || a.adapter.appId;
    if (!groups.has(app)) groups.set(app, []);
    groups.get(app).push(a);
  }
  return { about, parts: [...groups.entries()].sort(([x], [y]) => x.localeCompare(y)).map(([app, list]) => {
    const group = el('section', 'app-group');
    const id = `app-${app.replace(/[^a-z0-9]+/gi, '-')}`;
    const heading = el('h3', '', `${app} (${list.length})`);
    heading.id = id;
    group.setAttribute('aria-labelledby', id);
    const ul = el('ul', 'adapters');
    for (const a of list.sort((x, y) => (x.name || '').localeCompare(y.name || ''))) ul.append(registryItem(a, have.get(keyOf(a)) || null));
    group.append(heading, ul);
    return group;
  }) };
}

/** An adapter from the registry; `installed` is its entry in this browser, if it is in it. */
function registryItem(a, installed) {
  const item = el('li');
  const top = el('div', 'adapter-top');
  top.append(el('strong', '', a.name || a.adapter.id));
  if (installed) top.append(onSwitch(a, installed.enabled));
  else {
    const add = button('Add', 'secondary', async () => {
      add.disabled = true;
      try {
        await registry.install(BROWSER_RUNTIME_APP, a.adapter);
        await ask('sync');
        say(`Added ${a.name || a.adapter.id} to this browser.`);
        refreshAdapters();
      } catch (e) { say(e.message, true); add.disabled = false; }
    });
    add.setAttribute('aria-label', `Add ${a.name || a.adapter.id}`);
    top.append(add);
  }
  item.append(top);
  if (a.description) item.append(el('span', 'about', a.description));
  const areas = (a.supportAreas || []).map(areaName);
  item.append(el('span', 'from', [a.appName || a.adapter.appId, a.mine ? 'yours' : `shared by ${a.owner}`, areas.length ? areas.join(', ') : null].filter(Boolean).join(' · ')));
  return item;
}

// ── a change of profile elsewhere ────────────────────────────────────────────

/** Follow /v1/profile/events while the panel is open: redraw, and have the runtime sync. */
async function follow() {
  events?.abort();
  const mine = events = new AbortController();
  let wait = 1000;
  while (!mine.signal.aborted) {
    try {
      const res = await fetch(`${connection.url}/v1/profile/events`, { headers: { authorization: `Bearer ${connection.token}`, accept: 'text/event-stream' }, signal: mine.signal });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      wait = 1000;
      const reader = res.body.getReader(), decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let cut;
        while ((cut = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 2);
          const data = block.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('\n');
          let event = null;
          try { event = JSON.parse(data); } catch { continue; }
          if (event?.revision == null || event.revision === lastRevision) continue;
          const first = lastRevision === null;
          lastRevision = event.revision;
          if (first) continue; // the stream's opening state
          await loadProfile().catch(() => {});
          renderProfile();
          refreshAdapters();
          ask('sync').catch(() => {});
        }
      }
    } catch { if (mine.signal.aborted) return; }
    await new Promise(r => setTimeout(r, wait));
    wait = Math.min(wait * 2, 30_000);
  }
}

// ── wiring ───────────────────────────────────────────────────────────────────

export async function renderProfileTab() {
  connection = await readConnection();
  $('profile-not-connected').hidden = !!connection;
  $('profile-main').hidden = !connection;
  if (!connection) { events?.abort(); events = null; return; }
  registry = createRegistryClient({ url: connection.url, token: connection.token });
  try {
    await loadProfile();
    renderProfile();
  } catch (e) { say(`Could not read your profile: ${e.message}`, true); }
  if (!events) follow();
  refreshAdapters();
}

/** Redraw what depends on the page beside the panel or the runtime's state. */
export function refreshAdapters({ appliedOnly = false } = {}) {
  if (!connection) return;
  renderSection('applied');
  if (!appliedOnly) { renderSection('recommended'); renderSection('all'); }
}

export function initProfile() {
  $('words-form').addEventListener('submit', saveWords);
  $('words-voice').addEventListener('click', toggleVoice);
  $('profile-use-preset').addEventListener('click', usePreset);
  for (const name of ['recommended', 'all']) $(SECTIONS[name].box).addEventListener('toggle', () => renderSection(name));
}
