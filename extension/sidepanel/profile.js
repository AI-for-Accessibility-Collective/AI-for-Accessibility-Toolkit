// The side panel's Profile tab: the person's profile on the toolkit (one
// record per account, toolkit/core/librarian.js) and the preset it started
// from (/v1/profile/selection), editable here; then adapters, shown three ways:
//
//   Applied      the installed adapters that target the page beside the
//                panel, what happened when they ran, and a switch for this
//                site (what the toolbar popup showed)
//   Recommended  adapters the account can use that are not in this browser
//                yet, for the profile's support areas (adapter_search,
//                one area at a time), most areas in common first
//   All          every adapter the browser can run, by application
//
// Saving the profile syncs the runtime, so the adapters follow it at once.

import { readConnection } from '../runtime/config.js';
import { createRegistryClient } from '../vendor/adapter-mcp/registry.js';
import { BROWSER_RUNTIME_APP } from '../vendor/protocol/adapter/index.js';
import { $, say, el, button, ask, pageTab, keyOf } from './ui.js';

const AREAS = [
  ['vision', 'Vision'], ['hearing', 'Hearing'], ['motor', 'Motor'],
  ['cognitive', 'Cognitive'], ['reading', 'Reading'], ['sensory', 'Sensory'],
];
// The neutral needs a web page can meet (platforms/chrome/web-surface.js WEB_DERIVATION).
const NEEDS = [
  { id: 'textSize', name: 'Text size', kind: 'number', min: 1, max: 3, step: 0.1, start: 1.25, show: (v) => `${Math.round(v * 100)}%` },
  { id: 'lineSpacing', name: 'Line spacing', kind: 'number', min: 1, max: 3, step: 0.1, start: 1.5, show: (v) => `${v}` },
  { id: 'letterSpacing', name: 'Letter spacing', kind: 'number', min: 0, max: 0.5, step: 0.02, start: 0.12, show: (v) => `${v} em` },
  { id: 'readAloudRate', name: 'Reading-aloud speed', kind: 'number', min: 0.5, max: 2, step: 0.1, start: 1, show: (v) => `${v}×` },
  { id: 'reduceMotion', name: 'Less motion' },
  { id: 'darkTheme', name: 'Dark pages' },
  { id: 'contrast', name: 'More contrast' },
  { id: 'captions', name: 'Captions' },
  { id: 'simplify', name: 'Simpler words' },
  { id: 'readAloud', name: 'Read pages aloud' },
  { id: 'describeImages', name: 'Describe images' },
  { id: 'labelControls', name: 'Name unlabeled buttons and fields' },
  { id: 'keyboardAccess', name: 'Work by keyboard' },
  { id: 'skipLinks', name: 'Skip links' },
  { id: 'pageStructure', name: 'Page outline' },
  { id: 'repairLandmarks', name: 'Repair page regions' },
  { id: 'announceUpdates', name: 'Announce changes on the page' },
  { id: 'spaAnnounce', name: 'Announce new views in web apps' },
];
const RESULT_TEXT = { applied: 'Running on this page', failed: 'Failed', skipped: 'Not running', removed: 'Switched off' };
const FILTER_KEY = 'profileFilter';

let connection = null;
let registry = null;
let profile = null;   // the record
let selection = null; // {id, name, edited} or null
let presets = [];
let editing = false;
let generation = 0;

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

async function loadProfile() {
  const [p, sel, pre] = await Promise.all([
    librarian('getProfile'),
    service('/v1/profile/selection').catch(() => null),
    service('/v1/profile/presets').catch(() => null),
  ]);
  profile = p;
  selection = sel?.selected || null;
  presets = pre?.presets || [];
}

const needsOf = (p) => (Array.isArray(p?.fields?.needs) ? p.fields.needs : []);
const areasOf = (p) => (Array.isArray(p?.supportAreas) ? p.supportAreas : []);

function renderProfileView() {
  const view = $('profile-view');
  const items = [];
  const started = selection ? `${selection.name}${selection.edited ? ', changed since' : ''}` : 'Your own';
  items.push(['Started from', started]);
  const areas = areasOf(profile).map(a => AREAS.find(([id]) => id === a)?.[1] || a);
  items.push(['Support areas', areas.length ? areas.join(', ') : 'None chosen']);
  const needs = needsOf(profile).map((n) => {
    const d = NEEDS.find(x => x.id === n.dimension);
    if (!d) return null;
    return d.kind === 'number' ? `${d.name} ${d.show(Number(n.value))}` : n.value ? d.name : null;
  }).filter(Boolean);
  items.push(['What pages should do', needs.length ? needs.join(', ') : 'Nothing yet']);
  if (profile?.metaPreferences?.language === 'plain') items.push(['Language', 'Plain language']);
  if (profile?.freeText) items.push(['In your words', profile.freeText]);
  const list = el('ul', 'profile-list');
  for (const [label, value] of items) {
    const li = el('li');
    li.append(el('strong', '', label), el('span', 'value', value));
    list.append(li);
  }
  view.replaceChildren(list);
}

function renderProfileForm() {
  const form = $('profile-form');
  const parts = [];

  // A preset replaces the whole profile; loading one is a separate action.
  if (presets.length) {
    const field = el('div', 'field');
    const label = el('label', '', 'Start again from a preset');
    label.htmlFor = 'profile-preset';
    const select = el('select');
    select.id = 'profile-preset';
    select.append(Object.assign(el('option', '', 'Choose a preset'), { value: '' }));
    for (const p of presets) select.append(Object.assign(el('option', '', p.description ? `${p.name}: ${p.description}` : p.name), { value: p.id }));
    const row = el('div', 'row');
    row.append(button('Use this preset', 'secondary', () => usePreset(select.value)));
    field.append(label, select, el('p', 'hint', 'This replaces what is below.'), row);
    parts.push(field);
  }

  const areas = el('fieldset');
  areas.append(el('legend', '', 'Support areas'));
  for (const [id, name] of AREAS) {
    const row = el('label', 'option');
    const box = Object.assign(document.createElement('input'), { type: 'checkbox', name: 'area', value: id, checked: areasOf(profile).includes(id) });
    row.append(box, document.createTextNode(name));
    areas.append(row);
  }
  parts.push(areas);

  const needs = el('fieldset');
  needs.append(el('legend', '', 'What pages should do'));
  const have = new Map(needsOf(profile).map(n => [n.dimension, n]));
  for (const d of NEEDS) {
    const n = have.get(d.id);
    const row = el('div', 'option');
    const box = Object.assign(document.createElement('input'), { type: 'checkbox', id: `need-${d.id}`, checked: d.kind === 'number' ? !!n : !!n?.value });
    box.dataset.need = d.id;
    const label = el('label', '', d.name);
    label.htmlFor = box.id;
    row.append(box, label);
    if (d.kind === 'number') {
      const value = Object.assign(document.createElement('input'), { type: 'number', min: d.min, max: d.max, step: d.step, value: n ? Number(n.value) : d.start });
      value.id = `need-${d.id}-value`;
      value.dataset.needValue = d.id;
      value.setAttribute('aria-label', `${d.name} value`);
      value.disabled = !box.checked;
      box.addEventListener('change', () => { value.disabled = !box.checked; });
      row.append(value);
    }
    needs.append(row);
  }
  parts.push(needs);

  const plain = el('label', 'option');
  plain.append(Object.assign(document.createElement('input'), { type: 'checkbox', id: 'profile-plain', checked: profile?.metaPreferences?.language === 'plain' }), document.createTextNode('Plain language'));
  parts.push(plain);

  const words = el('div', 'field');
  const wordsLabel = el('label', '', 'In your own words (optional)');
  wordsLabel.htmlFor = 'profile-words';
  const area = Object.assign(document.createElement('textarea'), { id: 'profile-words', rows: 3, value: profile?.freeText || '' });
  words.append(wordsLabel, area);
  parts.push(words);

  const actions = el('div', 'row');
  const save = el('button', 'primary', 'Save profile');
  save.type = 'submit';
  actions.append(save, button('Cancel', 'secondary', () => setEditing(false)));
  parts.push(actions);
  form.replaceChildren(...parts);
}

function setEditing(on) {
  editing = on;
  $('profile-edit').setAttribute('aria-expanded', String(on));
  $('profile-edit').textContent = on ? 'Close' : 'Edit';
  $('profile-form').hidden = !on;
  $('profile-view').hidden = on;
  if (on) { renderProfileForm(); $('profile-form').querySelector('input, select')?.focus(); }
}

async function saveProfile(event) {
  event.preventDefault();
  const form = $('profile-form');
  const have = new Map(needsOf(profile).map(n => [n.dimension, n]));
  const needs = [];
  for (const d of NEEDS) {
    const on = form.querySelector(`[data-need="${d.id}"]`)?.checked;
    if (!on) continue;
    const value = d.kind === 'number' ? Number(form.querySelector(`[data-need-value="${d.id}"]`).value) : true;
    if (d.kind === 'number' && !(value >= d.min && value <= d.max)) { say(`${d.name}: choose a value from ${d.min} to ${d.max}.`, true); return; }
    // What the person did not change keeps where it came from.
    const before = have.get(d.id);
    needs.push(before && before.value === value ? before : { dimension: d.id, value, strength: before?.strength || 'preference', source: 'person' });
  }
  // Needs this form does not show stay as they were.
  for (const n of needsOf(profile)) if (!NEEDS.some(d => d.id === n.dimension)) needs.push(n);
  const fields = {
    supportAreas: [...form.querySelectorAll('input[name=area]:checked')].map(b => b.value),
    'fields.needs': needs,
    'metaPreferences.language': $('profile-plain').checked ? 'plain' : 'standard',
    freeText: $('profile-words').value.trim(),
  };
  try {
    profile = await librarian('setProfileFields', [fields]);
    selection = (await service('/v1/profile/selection').catch(() => null))?.selected || selection;
    setEditing(false);
    renderProfileView();
    say('Saved your profile. Your adapters follow it now.');
    ask('sync').catch(() => {});
    renderAdapters();
  } catch (e) { say(e.message, true); }
}

async function usePreset(id) {
  if (!id) { say('Choose a preset first.', true); return; }
  try {
    const got = await service('/v1/profile/select', { method: 'POST', body: { id } });
    profile = got.profile || await librarian('getProfile');
    selection = got.selected || null;
    setEditing(false);
    renderProfileView();
    say(`Your profile now starts from ${selection?.name || 'that preset'}.`);
    ask('sync').catch(() => {});
    renderAdapters();
  } catch (e) { say(e.message, true); }
}

// ── adapters ─────────────────────────────────────────────────────────────────

function filter() { return document.querySelector('input[name=adapter-filter]:checked')?.value || 'applied'; }

let shownFilter = null;
async function renderAdapters() {
  const mine = ++generation;
  const which = filter();
  const box = $('adapter-lists');
  // A new view says so until its list arrives; the same view redraws in place.
  if (which !== shownFilter) {
    shownFilter = which;
    $('adapters-about').textContent = '';
    box.replaceChildren(el('p', 'hint', 'Looking…'));
  }
  try {
    const { state } = await ask('status');
    if (mine !== generation) return;
    const { about, parts } = which === 'applied' ? await appliedList(state) : which === 'recommended' ? await recommendedList(state) : await allList(state);
    if (mine !== generation) return;
    $('adapters-about').textContent = about;
    box.replaceChildren(...parts);
  } catch (e) {
    if (mine !== generation) return;
    box.replaceChildren(el('p', 'hint', `Could not list adapters: ${e.message}`));
  }
}

const empty = (text) => { const ul = el('ul', 'adapters'); ul.append(el('li', 'empty', text)); return ul; };

async function appliedList(state) {
  const tab = await pageTab();
  if (!tab?.url || !/^https?:/.test(tab.url)) {
    return { about: 'The installed adapters that run on the page beside this panel.', parts: [empty('Adapters run on web pages (http and https).')] };
  }
  const { adapters, origin } = await ask('forUrl', { url: tab.url });
  const about = `On ${new URL(origin).host}: the installed adapters for this page.`;
  if (!adapters.length) return { about, parts: [empty('None of your adapters runs on this page. Recommended and All show more.')] };
  const results = state.tabs?.[tab.id] || {};
  // What runs first, then the rest.
  const order = (a) => (results[keyOf(a)]?.status === 'applied' ? 0 : 1);
  const list = el('ul', 'adapters');
  for (const a of [...adapters].sort((x, y) => order(x) - order(y))) list.append(appliedItem(a, state, origin, results[keyOf(a)]));
  return { about, parts: [list] };
}

function appliedItem(a, state, origin, r) {
  const key = keyOf(a);
  const item = el('li');
  const top = el('div', 'adapter-top');
  top.append(el('strong', '', a.name || a.adapter.id));
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
    renderAdapters();
  });
  label.append(box, document.createTextNode('This site'));
  top.append(label);
  item.append(top, el('span', 'from', `${a.appName || a.adapter.appId} · ${a.mine ? 'yours' : `shared by ${a.owner}`}`));
  if (!a.available) item.append(el('span', 'result failed', a.reason === 'not-shared' ? 'No longer shared by its owner.' : 'Deleted by its owner.'));
  else if (!a.enabled) item.append(el('span', 'result', 'Switched off in the console.'));
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

async function recommendedList(state) {
  const areas = areasOf(profile);
  const about = areas.length
    ? `Adapters for ${areas.map(a => AREAS.find(([id]) => id === a)?.[1].toLowerCase() || a).join(', ')} that are not in this browser yet.`
    : 'Choose support areas in your profile to see adapters for them.';
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
  for (const { a } of list.slice(0, 30)) ul.append(registryItem(a, false));
  return { about, parts: [ul] };
}

async function allList(state) {
  const about = 'Every adapter this browser can run, yours and those shared with you, by the application it came from.';
  const { adapters } = await registry.search({ portable: true });
  if (!adapters.length) return { about, parts: [empty('No adapters yet. Build one in the Builder tab.')] };
  const have = installedKeys(state);
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
    for (const a of list.sort((x, y) => (x.name || '').localeCompare(y.name || ''))) ul.append(registryItem(a, have.has(keyOf(a))));
    group.append(heading, ul);
    return group;
  }) };
}

function registryItem(a, installed) {
  const item = el('li');
  const top = el('div', 'adapter-top');
  top.append(el('strong', '', a.name || a.adapter.id));
  if (installed) top.append(el('span', 'result applied', 'In this browser'));
  else {
    const add = button('Add', 'secondary', async () => {
      add.disabled = true;
      try {
        await registry.install(BROWSER_RUNTIME_APP, a.adapter);
        await ask('sync');
        say(`Added ${a.name || a.adapter.id} to this browser.`);
        renderAdapters();
      } catch (e) { say(e.message, true); add.disabled = false; }
    });
    add.setAttribute('aria-label', `Add ${a.name || a.adapter.id}`);
    top.append(add);
  }
  item.append(top);
  if (a.description) item.append(el('span', 'about', a.description));
  const areas = (a.supportAreas || []).map(x => AREAS.find(([id]) => id === x)?.[1] || x);
  const where = (a.urlPatterns || []).slice(0, 2).join(', ') + ((a.urlPatterns || []).length > 2 ? ', …' : '');
  item.append(el('span', 'from', [a.appName || a.adapter.appId, a.mine ? 'yours' : `shared by ${a.owner}`, areas.length ? areas.join(', ') : null, where ? `runs on ${where}` : null].filter(Boolean).join(' · ')));
  return item;
}

// ── wiring ───────────────────────────────────────────────────────────────────

export async function renderProfile() {
  connection = await readConnection();
  $('profile-not-connected').hidden = !!connection;
  $('profile-main').hidden = !connection;
  if (!connection) return;
  registry = createRegistryClient({ url: connection.url, token: connection.token });
  try {
    await loadProfile();
    if (!editing) renderProfileView();
  } catch (e) { $('profile-view').replaceChildren(el('p', 'hint', `Could not read your profile: ${e.message}`)); }
  await renderAdapters();
}

/** Redraw what depends on the page beside the panel or the runtime's state. */
export const refreshAdapters = () => { if (connection) renderAdapters(); };

export function initProfile() {
  $('profile-edit').addEventListener('click', () => setEditing(!editing));
  $('profile-form').addEventListener('submit', saveProfile);
  for (const radio of document.querySelectorAll('input[name=adapter-filter]')) {
    radio.addEventListener('change', () => {
      try { localStorage.setItem(FILTER_KEY, radio.value); } catch { /* storage off */ }
      renderAdapters();
    });
  }
  let saved = null;
  try { saved = localStorage.getItem(FILTER_KEY); } catch { /* storage off */ }
  const radio = saved && document.querySelector(`input[name=adapter-filter][value="${saved}"]`);
  if (radio) radio.checked = true;
}
