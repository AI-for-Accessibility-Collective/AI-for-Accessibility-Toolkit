// The side panel (the toolbar button opens it) has three tabs: Profile
// (profile.js), Builder (this file) and Settings (settings.js, what the
// toolbar popup held).
//
// The Builder: chats with the account's opencode agent on the
// toolkit (through /v1/agent, see agent-host/README.md), shows its replies
// without code and one line per step (repeats folded into one), and does what
// its browser tools ask on the page the chat works on. That is the tab beside
// the sidebar when the chat's first message is sent; it stays the chat's page
// when the person moves to other tabs, until they choose "Work on this page
// instead":
//
//   page            share the page: the address, the page source (an
//                   outline, runtime/page.js) or also a screenshot. The
//                   person chooses once per site per chat; the agent may ask
//                   again for a screenshot.
//   preview         run an adapter on the page without installing it
//                   (runtime/scripts.js buildPreviewScript), after the person
//                   says yes, or at once while the "Apply previews" switch
//                   is on; with axe-core's WCAG check before and after
//                   (vendor/axe-core.min.js, injected first)
//   remove-preview  take it off again
//
// The person turns the last preview off and on again with the switch under
// the conversation, without asking the agent. The agent's questions
// (ask_questions) are a chat entry, shown as multiple choice with "Other" for
// the person's own words; the answers go back as the person's next message.
// The agent's steps fold into one line ("Working…" while it runs) that opens
// with a button. A finished adapter is usable at once; its background check
// and, on request, its full review run on the agent host
// (agent-host/src/verification.js), and the card shows how they stand. One
// the person added to their account is updated there when a newer version
// passes its background check. What changes is said in a live region, not
// by reading out the whole conversation.
//
// Finished adapters can be added to the account (published privately and
// installed into this browser's runtime) or exported as a file.

import { readConnection } from '../runtime/config.js';
import { pageOutline } from '../runtime/page.js';
import { buildPreviewScript, previewTeardownScript, AXE_FILE, BLOCKS_FILE, PREVIEW_KEY } from '../runtime/scripts.js';
import { createPageTypes, askToolkit, pageFacts } from '../runtime/page-type.js';
import { pageTypeById } from '../vendor/protocol/adapter/index.js';
import { createRegistryClient } from '../vendor/adapter-mcp/registry.js';
import { BROWSER_RUNTIME_APP } from '../vendor/protocol/adapter/index.js';

import { $, say, el, button, activeTab, isWebPage, originOf, hostOf } from './ui.js';
import { initSettings, renderSettings } from './settings.js';
import { initProfile, renderProfileTab, refreshAdapters } from './profile.js';
const LEVELS = ['none', 'url', 'source', 'screenshot'];
const APP = { appId: 'assistant', appName: 'Browser assistant' };
const PREVIEW_STATE = 'assistantPreview'; // the last preview, for this browser session: {chatId, tabId, name, origin, request, on}

let connection = null;
let chats = [];
let chat = null;            // the open chat, in full
const requests = new Map(); // id -> request, for the open chat
let previewing = null;      // the last preview: {chatId, tabId, name, origin, request, on}
let applyOn = false;        // the switch: previews are on the page
let streamAbort = null;
const ADDED_KEY = 'assistantAdded'; // "<chat>/<adapter>" -> the version added to the account

// ── what a screen reader hears ───────────────────────────────────────────────

// Changes are said once, through one polite region (errors through an
// assertive one); lines that arrive together are said together.
const pendingSaid = { polite: [], urgent: [] };
let saidTimer = null;
function announce(text, urgent = false) {
  if (!text) return;
  pendingSaid[urgent ? 'urgent' : 'polite'].push(text);
  clearTimeout(saidTimer);
  saidTimer = setTimeout(() => {
    for (const [kind, id] of [['polite', 'live'], ['urgent', 'alert']]) {
      if (!pendingSaid[kind].length) continue;
      const node = $(id);
      node.textContent = '';
      const words = pendingSaid[kind].join(' ');
      pendingSaid[kind] = [];
      setTimeout(() => { node.textContent = words; }, 30);
    }
  }, 150);
}


async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${connection.url}/v1/agent${path}`, {
    method,
    headers: { authorization: `Bearer ${connection.token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.message || `The toolkit answered ${res.status}.`), { status: res.status, code: data.error });
  return data;
}

// ── the page each chat works on ──────────────────────────────────────────────

const PAGES_KEY = 'assistantPages'; // chat id -> tab id, for this browser session

async function pages() {
  try { return (await chrome.storage.session.get(PAGES_KEY))[PAGES_KEY] || {}; } catch { return {}; }
}
async function setPage(chatId, tabId) {
  const all = await pages();
  all[chatId] = tabId;
  await chrome.storage.session.set({ [PAGES_KEY]: all });
}
/** The chat's page: its tab, or null when it has none yet or the tab was closed. */
async function workingTab() {
  if (!chat) return null;
  const id = (await pages())[chat.id];
  return id == null ? null : chrome.tabs.get(id).catch(() => null);
}
/**
 * The chat's page, choosing the tab beside the sidebar when it has none yet
 * (or, when the person sends a message, when its tab was closed). Never
 * changes a page that is still open: only the person does that.
 */
async function ensureWorkingTab({ replaceClosed = false } = {}) {
  const tab = await workingTab();
  if (tab || !chat) return tab;
  if ((await pages())[chat.id] != null && !replaceClosed) return null;
  const active = await activeTab();
  if (!isWebPage(active)) return null;
  await setPage(chat.id, active.id);
  renderWorking();
  return active;
}

let workingSeq = 0;
async function renderWorking() {
  const seq = ++workingSeq;
  const [hasPage, tab, active] = chat ? await Promise.all([pages().then(p => p[chat.id] != null), workingTab(), activeTab()]) : [false, null, null];
  if (seq !== workingSeq) return;
  $('working').hidden = !hasPage;
  if (!hasPage) return;
  const label = $('working-label');
  if (tab) {
    label.replaceChildren('Working on ', el('strong', '', tab.title || hostOf(tab.url)), el('span', 'where', ` · ${hostOf(tab.url)}`));
  } else label.replaceChildren('The page this chat worked on is closed.');
  const elsewhere = !!tab && tab.id !== active?.id;
  $('go-to-page').hidden = !elsewhere;
  const other = isWebPage(active) && active.id !== tab?.id;
  $('switch-page').hidden = !other;
  if (other) $('switch-page').textContent = `Work on this page instead (${hostOf(active.url)})`;
}
let workingTimer = null;
const renderWorkingSoon = () => { clearTimeout(workingTimer); workingTimer = setTimeout(renderWorking, 100); };

async function goToPage() {
  const tab = await workingTab();
  if (!tab) return renderWorking();
  await chrome.tabs.update(tab.id, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
}

async function switchPage() {
  const active = await activeTab();
  if (!chat || !isWebPage(active)) return;
  await setPage(chat.id, active.id);
  await renderWorking();
  renderRequests();
  say(`The assistant now works on ${hostOf(active.url)}.`);
}

/** A screenshot of the tab. One not on screen is shown for a moment, only when the person just said yes. */
async function screenshotOf(tab, interactive) {
  const fresh = await chrome.tabs.get(tab.id);
  const capture = () => chrome.tabs.captureVisibleTab(fresh.windowId, { format: 'jpeg', quality: 70 });
  if (fresh.active) return capture();
  if (!interactive) return undefined;
  const [shown] = await chrome.tabs.query({ active: true, windowId: fresh.windowId });
  await chrome.tabs.update(fresh.id, { active: true });
  await new Promise(r => setTimeout(r, 400));
  try { return await capture(); } finally { if (shown) await chrome.tabs.update(shown.id, { active: true }).catch(() => {}); }
}

// ── what kind of page ────────────────────────────────────────────────────────

let pageTypes = null; // runtime/page-type.js, made once connected
/** What kind of page the tab is (its markup, else the toolkit's model; kept by address), or null. */
async function pageTypeOf(tab) {
  if (!pageTypes || !isWebPage(tab)) return null;
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: pageFacts });
    if (!res?.result) return null;
    const kind = await pageTypes.classify({ ...res.result, url: tab.url.split('#')[0] });
    return kind?.type ? kind : null;
  } catch { return null; }
}

/** What the person agreed to share of this tab, at this level. */
async function collect(tab, level, { interactive = false } = {}) {
  const shared = { level, url: tab.url, title: tab.title };
  if (level === 'source' || level === 'screenshot') {
    const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: pageOutline, args: [40000] });
    Object.assign(shared, res?.result || {});
  }
  if (level === 'screenshot') {
    const shot = await screenshotOf(tab, interactive).catch(() => undefined);
    if (shot) shared.screenshot = shot;
  }
  return shared;
}

// ── requests from the agent's browser tools ──────────────────────────────────

async function answer(request, value) {
  requests.delete(request.id);
  renderRequests();
  try { await api(`/requests/${request.id}`, { method: 'POST', body: value }); } catch (e) { say(`Could not send that to the assistant: ${e.message}`, true); }
}

const CLOSED = 'the page this chat works on was closed; the person can choose another in the sidebar';

async function sharePage(request, level, remember, interactive = true) {
  const tab = await ensureWorkingTab();
  if (!tab) return answer(request, { level: 'none', unavailable: CLOSED });
  if (!isWebPage(tab)) return answer(request, { level: 'none', unavailable: 'the page this chat works on is not a web page' });
  // The card named one site; if the tab has since moved to another, ask about that one.
  if (interactive && request.shownOrigin && request.shownOrigin !== originOf(tab.url)) {
    renderRequests();
    return say('That page moved to another site. Check what you are sharing.', true);
  }
  try {
    const shared = level === 'none' ? { level: 'none' } : await collect(tab, level, { interactive });
    // The kind of page, as the browser will judge it for "this type of page".
    const kind = level === 'none' ? null : await pageTypeOf(tab);
    await answer(request, { ...shared, origin: originOf(tab.url), remember, ...(kind ? { pageType: kind } : {}) });
  } catch (e) {
    await answer(request, { level: 'none', unavailable: `the page could not be read (${e.message})` });
  }
}

/** Run a preview's adapter on the tab; with `audit`, its checks and axe-core too. */
async function applyPreview(request, tab, { audit = true } = {}) {
  try {
    // axe-core and the building blocks first, in the same world. The
    // blocks follow the person's settings as of the runtime's last sync.
    const { runtimeState } = await chrome.storage.session.get('runtimeState').catch(() => ({}));
    const personal = runtimeState?.personal || {};
    const explicit = runtimeState?.explicit || null;
    const [res] = await chrome.userScripts.execute({ target: { tabId: tab.id }, world: 'USER_SCRIPT', injectImmediately: true,
      js: [...(audit ? [{ file: AXE_FILE }] : []), { file: BLOCKS_FILE }, { code: buildPreviewScript({ code: request.code, urlPatterns: request.runsOn, parameters: request.parameters, checks: audit ? request.checks : [], audit, personal, explicit }) }] });
    return res?.result || { status: 'failed', message: res?.error || 'the page gave no result' };
  } catch (e) {
    return { status: 'failed', message: e.message };
  }
}

async function runPreview(request) {
  const tab = await ensureWorkingTab();
  if (!tab) return answer(request, { unavailable: CLOSED });
  if (!isWebPage(tab)) return answer(request, { unavailable: 'the page this chat works on is not a web page' });
  if (typeof chrome.userScripts?.execute !== 'function') {
    say('Previews need user scripts: turn on Allow User Scripts on this extension’s details page.', true);
    return answer(request, { status: 'failed', message: 'User scripts are off in this browser: ask the person to turn on "Allow User Scripts" on the extension’s details page.' });
  }
  const result = await applyPreview(request, tab);
  showPreview({ chatId: chat?.id, name: request.name, tabId: tab.id, origin: hostOf(tab.url), request, on: result.status === 'applied' });
  announce(result.status === 'applied' ? `Previewing “${request.name}” on this page.` : result.status === 'skipped' ? `“${request.name}” found nothing to change on this page.` : `The preview of “${request.name}” did not work.`);
  // The page afterwards, at what the person shares on this site in this chat.
  const level = chat?.consent?.[originOf(tab.url)];
  let after;
  if (result.status === 'applied' && (level === 'source' || level === 'screenshot')) {
    await new Promise(r => setTimeout(r, 300));
    after = await collect(tab, level).catch(() => undefined);
  }
  // Which site it ran on, when the person shares at least the address there.
  const site = level && level !== 'none' ? originOf(tab.url) : undefined;
  // axe names the elements with each problem, and its summary can quote the
  // page: that much only where the person shares the page source.
  if (result.axe?.added && level !== 'source' && level !== 'screenshot') {
    result.axe = { ...result.axe, added: result.axe.added.map(({ targets, summary, ...rule }) => rule) };
  }
  await answer(request, { ...result, ...(after ? { after } : {}), ...(site ? { site } : {}) });
}

/** Take the preview's adapter off its page (its disable()); whether one was on. */
async function takePreviewOff() {
  const tabId = previewing?.tabId ?? (await workingTab())?.id;
  if (tabId == null || typeof chrome.userScripts?.execute !== 'function') return false;
  try {
    const [res] = await chrome.userScripts.execute({ target: { tabId }, world: 'USER_SCRIPT', injectImmediately: true, js: [{ code: previewTeardownScript() }] });
    return res?.result === true;
  } catch { return false; /* the tab is gone */ }
}

/** Take it off and forget it: the adapter is now installed, or the chat is gone. */
async function removePreview() {
  const removed = await takePreviewOff();
  showPreview(null);
  return removed;
}

/**
 * The last preview, and the switch: on while a preview is on the page (and
 * then the agent's next previews go on without asking), off otherwise. Kept
 * for this browser session, so a reload of the sidebar or the page keeps it.
 */
function showPreview(p) {
  previewing = p;
  applyOn = !!p?.on;
  const label = !p ? 'Previews go on the page when you say so.' : !p.request ? 'The assistant’s next preview goes on the page.'
    : p.on ? `Previewing “${p.name}” on ${p.origin}.` : `“${p.name}” is not on the page.`;
  $('preview-label').textContent = label;
  $('preview-toggle').setAttribute('aria-checked', String(applyOn));
  chrome.storage.session.set({ [PREVIEW_STATE]: p }).catch(() => {});
}

/** Whether the preview is running in the tab now. */
async function previewOnPage(tabId) {
  try {
    const [res] = await chrome.userScripts.execute({ target: { tabId }, world: 'USER_SCRIPT', injectImmediately: true,
      js: [{ code: `!!(globalThis.__ai4a11yRuntime && globalThis.__ai4a11yRuntime.adapters[${JSON.stringify(PREVIEW_KEY)}])` }] });
    return res?.result === true;
  } catch { return false; }
}

/** Put the last preview back on its page (after a reload of either); the switch goes off if it does not apply there. */
let previewTurn = 0; // each press of the switch and each putting-back; only the latest decides
async function reapplyPreview({ quiet = false } = {}) {
  const p = previewing;
  if (!p?.request) return false;
  const turn = ++previewTurn;
  const tab = await chrome.tabs.get(p.tabId).catch(() => null);
  if (!tab) { showPreview({ ...p, on: false }); if (!quiet) say('That tab is closed.', true); return false; }
  const result = await applyPreview(p.request, tab, { audit: false });
  // Switched off while it went on (after a reload): off it stays.
  if (turn !== previewTurn) { if (!applyOn) await takePreviewOff(); return applyOn; }
  const on = result.status === 'applied';
  showPreview({ ...p, origin: hostOf(tab.url), on });
  if (!on && !quiet) say(`It did not apply on this page: ${result.message || result.status}.`, true);
  return on;
}

/** The switch, pressed. */
async function togglePreview() {
  const button = $('preview-toggle');
  button.disabled = true;
  try {
    if (applyOn) {
      previewTurn++;
      await takePreviewOff();
      showPreview(previewing ? { ...previewing, on: false } : null);
      say('Previews are off the page. The assistant asks before its next one.');
      return;
    }
    if (!previewing?.request) {
      // Nothing to put on yet: the next preview goes on without asking.
      showPreview({ chatId: chat?.id, on: true });
      return say('The next preview goes on the page without asking.');
    }
    if (await reapplyPreview()) say('The preview is on the page again.');
  } finally {
    button.disabled = false;
  }
}

/** After the sidebar opens: the last preview of this chat, put back if the switch was on and the page lost it. */
async function restorePreview() {
  const saved = (await chrome.storage.session.get(PREVIEW_STATE).catch(() => ({})))[PREVIEW_STATE];
  if (!saved || saved.chatId !== chat?.id) { showPreview(null); return; }
  showPreview(saved);
  if (saved.on && saved.request && !(await previewOnPage(saved.tabId))) await reapplyPreview({ quiet: true });
}

async function handleRequest(request) {
  if (request.chatId !== chat?.id) return;
  if (request.kind === 'remove-preview') {
    const removed = await takePreviewOff();
    showPreview(previewing ? { ...previewing, on: false } : null);
    return answer(request, { removed });
  }
  if (request.kind === 'preview' && applyOn) return runPreview(request);
  if (request.kind === 'page') {
    const tab = await ensureWorkingTab();
    if (!tab) return answer(request, { level: 'none', unavailable: CLOSED });
    const origin = originOf(tab.url);
    const agreed = origin && chat.consent?.[origin];
    // Once per site per chat; a screenshot may be asked for again.
    if (agreed && !(request.screenshot && LEVELS.indexOf(agreed) < LEVELS.indexOf('screenshot'))) return sharePage(request, agreed, false, false);
    request.again = !!agreed;
  }
  requests.set(request.id, request);
  renderRequests();
  announce(request.kind === 'page' ? (request.again ? 'The assistant asks for a screenshot of this page.' : 'The assistant asks to see this page.') : request.kind === 'preview' ? `The assistant asks to preview “${request.name}”.` : '');
}

function renderRequests() {
  const cards = [];
  for (const request of requests.values()) {
    const card = el('section', 'card');
    card.setAttribute('aria-label', 'The assistant asks');
    if (request.kind === 'page') {
      const tabOrigin = el('strong');
      workingTab().then(t => { request.shownOrigin = originOf(t?.url); tabOrigin.textContent = request.shownOrigin || 'the page'; });
      const again = request.again;
      card.append(el('h2', '', again ? 'May the assistant take a screenshot of this page?' : 'May the assistant see this page?'));
      if (request.reason) card.append(el('p', 'why', request.reason));
      const site = el('p', 'note');
      site.append('Page: ', tabOrigin, again ? '. Just this once.' : '. Your choice holds for this site for the rest of this chat.');
      card.append(site);
      const choices = el('div', 'choices');
      if (again) {
        choices.append(
          button('Share a screenshot', 'primary', () => sharePage(request, 'screenshot', false)),
          button('Not now', 'secondary', async () => { const t = await workingTab(); sharePage(request, chat.consent?.[originOf(t?.url)] || 'none', false); }));
      } else {
        choices.append(
          button('The address only', 'secondary', () => sharePage(request, 'url', true)),
          button('The address and the page source', 'secondary', () => sharePage(request, 'source', true)),
          button('The address, the source and a screenshot', 'primary', () => sharePage(request, 'screenshot', true)),
          button('Don’t share', 'text-button', () => sharePage(request, 'none', true)));
      }
      card.append(choices, el('p', 'note', 'The assistant needs the page source and a screenshot to build the best adapter. What you share is not used to identify you.'));
    } else if (request.kind === 'preview') {
      const where = el('strong');
      workingTab().then(t => { where.textContent = t ? hostOf(t.url) : 'the page'; });
      const note = el('p', 'note');
      note.append('It runs on ', where, ' in that tab only, until you remove it or reload the page. Nothing is installed.');
      card.append(el('h2', '', `Preview “${request.name}”?`), note);
      const row = el('div', 'row');
      row.append(button('Preview', 'primary', () => { requests.delete(request.id); renderRequests(); runPreview(request); }),
        button('Not now', 'secondary', () => answer(request, { status: 'declined' })));
      card.append(row);
    }
    cards.push(card);
  }
  $('requests').replaceChildren(...cards);
}

// ── the agent's questions ────────────────────────────────────────────────────

const AREA_NAMES = { vision: 'Vision', motor: 'Motor', hearing: 'Hearing', cognitive: 'Cognitive', sensory: 'Sensory', reading: 'Reading' };

/** The questions waiting for answers: the last questions entry, if the person has not written since. */
function openQuestions() {
  const entries = chat?.entries || [];
  const i = entries.findLastIndex(e => e.kind === 'questions');
  if (i < 0 || entries[i].answered || entries.slice(i + 1).some(e => e.kind === 'you')) return null;
  return entries[i];
}

/**
 * One question: its options, then "Other", which opens what else there is
 * (a box for their own words; for areas, the other areas too). Each option
 * says what it answers with `answer`.
 */
function questionSet(q, i, site, kind) {
  const set = el('fieldset');
  set.append(el('legend', '', q.question));
  if (q.multiSelect) set.append(el('p', 'note', 'Choose any that apply.'));
  const type = q.multiSelect ? 'checkbox' : 'radio';
  const option = (label, about, answer) => {
    const row = el('label', 'option');
    const input = Object.assign(document.createElement('input'), { type, name: `q${i}`, value: label });
    input.dataset.answer = answer ?? label;
    row.append(input, el('span', '', label));
    if (about) row.append(el('span', 'about', about));
    return { row, input };
  };
  if (q.kind === 'pages') {
    const origin = originOf(site?.url);
    const type = kind && pageTypeById(kind.type);
    if (type && origin) {
      const o = option(`This type of page: ${type.name} on ${hostOf(site.url)}`, `Pages the browser finds are ${type.about}.`,
        `This type of page: ${type.name} on ${origin} (page type: ${type.id}; runs on ${origin}/* where the page is that type)`);
      o.input.dataset.pages = 'type';
      o.input.dataset.pageType = type.id;
      set.append(o.row);
      // The same kind of page anywhere: the browser sorts each page as it is visited.
      const anywhere = option(`This type of page: ${type.name} on all websites`, `Wherever the browser finds ${type.about}.`,
        `This type of page: ${type.name} on all websites (page type: ${type.id}; runs on every website where the page is that type)`);
      anywhere.input.dataset.pages = 'type-all';
      anywhere.input.dataset.pageType = type.id;
      set.append(anywhere.row);
    }
    if (origin) {
      const o = option(`This website: ${hostOf(site.url)}`, `${origin}/`, `This website (${origin}/*)`);
      o.input.dataset.pages = 'site';
      set.append(o.row);
    }
    const all = option('All websites', 'Every site you visit.');
    all.input.dataset.pages = 'all';
    set.append(all.row);
  } else {
    for (const o of q.options) {
      const made = option(q.kind === 'areas' ? AREA_NAMES[o.label] || o.label : o.label, o.description);
      if (q.kind === 'areas') made.input.dataset.area = o.label;
      set.append(made.row);
    }
  }
  const other = option('Other');
  other.input.dataset.other = '1';
  if (q.kind === 'pages') other.input.dataset.pages = 'other';
  const more = el('div', 'more');
  more.id = `q${i}-more`;
  more.hidden = true;
  other.input.setAttribute('aria-controls', more.id);
  if (q.kind === 'areas') {
    const picked = new Set(q.options.map(o => o.label));
    for (const [area, name] of Object.entries(AREA_NAMES)) {
      if (picked.has(area)) continue;
      const row = el('label', 'option');
      const input = Object.assign(document.createElement('input'), { type: 'checkbox', name: `q${i}-more`, value: name });
      input.dataset.area = area;
      row.append(input, el('span', '', name));
      more.append(row);
    }
  }
  const words = Object.assign(document.createElement('input'), { type: 'text', name: `q${i}-other` });
  words.setAttribute('aria-label', q.kind === 'areas' ? 'Someone else' : `Your own answer: ${q.question}`);
  words.placeholder = q.kind === 'areas' ? 'Someone else' : q.kind === 'pages' ? 'Which pages, in your words' : 'Your own answer';
  more.append(words);
  const otherBox = el('div', 'other-box');
  otherBox.append(other.row, more);
  set.append(otherBox);
  // "Other" opens its part; choosing another option (one of radios) closes it.
  set.addEventListener('change', () => {
    const open = other.input.checked;
    if (more.hidden === open) { more.hidden = !open; if (open) words.focus(); }
  });
  return set;
}

let shownQuestions = null; // the entry id the form shows, so a re-render keeps what the person chose
async function renderQuestions() {
  const entry = openQuestions();
  const box = $('questions');
  if (!entry) { shownQuestions = null; box.replaceChildren(); return; }
  if (shownQuestions === entry.id) return renderBusy();
  shownQuestions = entry.id;
  // The pages question names this website (the chat's page, or the tab beside
  // the sidebar) and the kind of page it is, as the browser will judge it.
  const site = entry.questions.some(q => q.kind === 'pages') ? (await workingTab() || await activeTab()) : null;
  const kind = isWebPage(site) ? await Promise.race([pageTypeOf(site), new Promise(r => setTimeout(() => r(null), 10_000))]) : null;
  if (shownQuestions !== entry.id) return;
  const form = el('form', 'card questions');
  form.setAttribute('aria-label', 'The assistant asks');
  entry.questions.forEach((q, i) => form.append(questionSet(q, i, isWebPage(site) ? site : null, kind)));
  const row = el('div', 'row');
  const send = el('button', 'primary', 'Send answers');
  send.type = 'submit';
  send.id = 'send-answers';
  row.append(send);
  form.append(row);
  form.addEventListener('submit', (e) => { e.preventDefault(); sendAnswers(entry, form); });
  box.replaceChildren(form);
  $('conversation').scrollTop = $('conversation').scrollHeight;
  renderBusy();
}

async function sendAnswers(entry, form) {
  const parts = [];
  let answered = 0, pages, pageType, areas;
  entry.questions.forEach((q, i) => {
    const chosen = [];
    if (q.kind === 'areas') areas = [];
    for (const input of form.querySelectorAll(`input[name="q${i}"]:checked`)) {
      if (q.kind === 'pages') { pages = input.dataset.pages; pageType = input.dataset.pageType; }
      if (input.dataset.area) areas.push(input.dataset.area);
      if (!input.dataset.other) { chosen.push(input.dataset.answer); continue; }
      for (const extra of form.querySelectorAll(`input[name="q${i}-more"]:checked`)) { chosen.push(extra.value); if (extra.dataset.area) areas.push(extra.dataset.area); }
      const words = form.querySelector(`input[name="q${i}-other"]`).value.trim();
      if (words) chosen.push(words);
    }
    if (chosen.length) answered++;
    parts.push(`${q.question}\n→ ${chosen.length ? chosen.join('; ') : '(no answer)'}`);
  });
  if (!answered) return say('Choose an answer, or write your own under Other.', true);
  $('send-answers').disabled = true;
  try {
    await ensureWorkingTab({ replaceClosed: true });
    await api(`/chats/${chat.id}/messages`, { method: 'POST', body: { text: parts.join('\n\n'), answers: entry.id, ...(pages ? { pages } : {}), ...(pageType ? { pageType } : {}), ...(areas ? { areas } : {}) } });
    say('');
  } catch (err) {
    say(err.message, true);
    $('send-answers').disabled = false;
  }
}

// ── chats ────────────────────────────────────────────────────────────────────

function renderChats() {
  const select = $('chat-select');
  select.replaceChildren(...chats.map(c => {
    const o = el('option', '', `${c.title}${c.busy ? ' (working)' : ''}`);
    o.value = c.id;
    return o;
  }));
  if (chat) select.value = chat.id;
}

function entryNode(entry, count = 1) {
  if (entry.kind === 'step') {
    const li = el('li', `step ${entry.state || 'done'}`);
    const words = el('span', '', entry.text);
    if (count > 1) words.append(el('span', 'times', ` (${count} times)`));
    li.append(words);
    li.dataset.id = entry.id;
    return li;
  }
  if (entry.kind === 'questions') {
    const n = entry.questions?.length || 0;
    const li = el('li', 'step done', `${entry.answered ? 'Answered' : 'The assistant asks'} ${n === 1 ? 'a question' : `${n} questions`}`);
    li.dataset.id = entry.id;
    return li;
  }
  const li = el('li', `msg ${entry.kind}`, entry.text);
  li.dataset.id = entry.id;
  if (entry.kind === 'agent') li.setAttribute('aria-label', `Assistant: ${entry.text}`);
  return li;
}

/** Entries as shown: a step that repeats the one before it (same words, same state) folds into it. */
function foldedEntries(entries) {
  const out = [];
  for (const entry of entries) {
    const last = out.at(-1);
    if (entry.kind === 'step' && last?.entry.kind === 'step' && last.entry.text === entry.text && (last.entry.state || 'done') === (entry.state || 'done')) last.count++;
    else out.push({ entry, count: 1 });
  }
  return out;
}

const isBusy = () => !!chats.find(c => c.id === chat?.id)?.busy;
const openSteps = new Set(); // the groups of steps the person opened, by their first step's id

/**
 * What the transcript shows: messages, and each run of steps as one group,
 * shut unless the person opened it. While the agent works, the last line
 * says so.
 */
function transcriptItems(entries, busy) {
  const items = [];
  for (const f of foldedEntries(entries)) {
    if (f.entry.kind !== 'step') { items.push(f); continue; }
    const last = items.at(-1);
    if (last?.steps) last.steps.push(f); else items.push({ steps: [f], key: f.entry.id });
  }
  if (busy) { const last = items.at(-1); if (last?.steps) last.working = true; else items.push({ working: true }); }
  return items;
}

function stepsNode(item) {
  const li = el('li', 'steps-group');
  const open = openSteps.has(item.key);
  const failed = item.steps.filter(s => s.entry.state === 'failed').length;
  const n = item.steps.reduce((sum, s) => sum + s.count, 0);
  const head = el('div', `steps-head${item.working ? ' running' : ''}`);
  head.append(el('span', '', item.working ? 'Working…' : `${n} step${n === 1 ? '' : 's'}${failed ? ` · ${failed} did not work` : ''}`));
  const list = el('ol', 'steps');
  list.id = `steps-${item.key}`;
  list.hidden = !open;
  list.append(...item.steps.map(({ entry, count }) => entryNode(entry, count)));
  const toggle = button(open ? 'Hide steps' : 'Show steps', 'text-button', () => {
    const now = !openSteps.has(item.key);
    if (now) openSteps.add(item.key); else openSteps.delete(item.key);
    list.hidden = !now;
    toggle.textContent = now ? 'Hide steps' : 'Show steps';
    toggle.setAttribute('aria-expanded', String(now));
    li.dataset.sig = itemSig(item);
  });
  toggle.setAttribute('aria-expanded', String(open));
  toggle.setAttribute('aria-controls', list.id);
  head.append(toggle);
  li.append(head, list);
  return li;
}

const itemSig = (item) => item.steps
  ? JSON.stringify(['steps', item.key, openSteps.has(item.key), !!item.working, item.steps.map(s => [s.entry.id, s.entry.text, s.entry.state, s.count])])
  : item.working ? '["working"]'
    : JSON.stringify([item.entry.id, item.entry.kind, item.entry.text, item.entry.state, item.entry.answered, item.count]);

// Only the lines that changed are replaced.
function renderTranscript() {
  const list = $('transcript');
  if (!chat?.entries.length) {
    renderQuestions();
    list.replaceChildren(el('li', 'empty', 'Say what gets in your way on the page beside this sidebar, for example “the buttons are too small to tap” or “I can’t read the gray text”. The assistant asks a few questions, then builds an adapter and previews it here.'));
    return;
  }
  list.querySelector('.empty')?.remove();
  const shown = [...list.children];
  const items = transcriptItems(chat.entries, isBusy());
  items.forEach((item, i) => {
    const sig = itemSig(item);
    if (shown[i]?.dataset.sig === sig) return;
    const node = item.steps ? stepsNode(item) : item.working ? el('li', 'steps-group working', 'Working…') : entryNode(item.entry, item.count);
    node.dataset.sig = sig;
    // Keep the person's place: a toggle they are on stays focused.
    const focused = shown[i]?.contains(document.activeElement) && document.activeElement.matches('.steps-head button');
    if (shown[i]) shown[i].replaceWith(node); else list.append(node);
    if (focused) node.querySelector('.steps-head button')?.focus();
  });
  for (const extra of shown.slice(items.length)) extra.remove();
  $('conversation').scrollTop = $('conversation').scrollHeight;
  renderQuestions();
}

/** An entry from the event stream: shown, and what is new about it said. */
function addEntry(entry) {
  const i = chat.entries.findIndex(e => e.id === entry.id);
  const before = i >= 0 ? chat.entries[i] : null;
  if (i >= 0) chat.entries[i] = { ...chat.entries[i], ...entry };
  else chat.entries.push(entry);
  const e = i >= 0 ? chat.entries[i] : entry;
  if (!before) {
    if (e.kind === 'agent') announce(`Assistant: ${e.text}`);
    else if (e.kind === 'notice' || e.kind === 'warning') announce(e.text);
    else if (e.kind === 'error') announce(e.text, true);
    else if (e.kind === 'questions') { const n = e.questions?.length || 0; announce(`The assistant asks ${n === 1 ? 'a question' : `${n} questions`}. Answer them below the conversation.`); }
  }
  if (e.kind === 'step' && e.state === 'failed' && before?.state !== 'failed') announce(`Did not work: ${e.text}`);
  renderTranscript();
}

// ── finished adapters: the card ──────────────────────────────────────────────

function ordinal(n) {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  return `${n}${teen ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th')}`;
}

/** How the background check, or the full review, stands, in a sentence; with what failed. */
function checkWords(a, kind) {
  const c = a[kind];
  if (!c) return null;
  const what = kind === 'review' ? 'Full review' : 'Background check';
  const runs = (n) => `${n} run${n === 1 ? '' : 's'}`;
  switch (c.status) {
    case 'unavailable': return { state: 'idle', text: kind === 'review' ? 'This toolkit has no full review.' : 'This toolkit does not check adapters in the background.' };
    case 'queued': return { state: 'running', text: `${what}: waiting${c.position ? `, ${ordinal(c.position)} in line` : ''}.` };
    case 'running': return { state: 'running', text: kind === 'review' ? 'Full review running: the background check, then an independent reviewer. This can take up to an hour.' : 'Checking in the background: on test pages and copies of real sites, narrow and with reduced motion. This takes a few minutes.' };
    case 'cancelled': return { state: 'idle', text: c.why === 'changed' ? `${what} stopped: the assistant is changing the adapter. Its next version is checked.` : `${what} stopped.` };
    case 'failed': return { state: 'failed', text: `${what} could not run: ${c.error}` };
    case 'passed': return { state: 'passed', text: kind === 'review' ? 'Full review: no issues found.' : `Background check passed: ${runs(c.passed)} passed${c.skipped ? `, ${c.skipped} skipped` : ''}; it applied on ${c.appliedOn} of ${c.testPages} test pages.` };
    case 'problems': {
      const fix = a.gaveUp ? ` The assistant could not fix ${kind === 'review' ? 'them' : 'all of them'} after ${a.fixes} tries: ask it, or use this version as it is.`
        : a.fixing ? (isBusy() ? ' The assistant is fixing them.' : ' The assistant tried to fix them: see its reply.') : '';
      return { state: 'problems', text: `${kind === 'review' ? 'Full review found issues' : `Background check found problems in ${runs(c.failed)}`}.${fix}`, failing: c.failing, report: c.report };
    }
    default: return null;
  }
}

function statusNode(w) {
  const box = el('div', `check-status ${w.state}`);
  box.append(el('p', '', w.text));
  if (w.failing?.length || w.report) {
    const more = el('details');
    more.append(el('summary', '', 'What it found'));
    if (w.failing?.length) {
      const ul = el('ul');
      for (const f of w.failing) ul.append(el('li', '', `${f.name}: ${f.problems.join('; ') || 'failed'}`));
      more.append(ul);
    }
    if (w.report) more.append(el('p', 'report', w.report));
    box.append(more);
  }
  return box;
}

let added = {}; // ADDED_KEY, loaded at start
const addedKey = (a) => `${chat?.id}/${a.id}`;

function renderReady() {
  const list = $('ready-list');
  const adapters = chat?.adapters || [];
  $('ready').hidden = !adapters.length;
  list.replaceChildren(...adapters.map(a => {
    const li = el('li');
    const title = el('strong', '', a.name);
    if (a.version > 1) title.append(el('span', 'version', ` · version ${a.version}`));
    li.append(title, el('p', 'about', a.about), el('p', 'where', `Runs on ${a.pageTypes?.length ? `${a.pageTypes.map(t => pageTypeById(t)?.name || t).join(', ')} on ` : ''}${a.runsOn.map(p => (p === '*://*/*' ? 'all websites' : p)).join(', ')}`));
    for (const kind of ['check', 'review']) { const w = checkWords(a, kind); if (w) li.append(statusNode(w)); }
    const mine = added[addedKey(a)];
    if (mine) li.append(el('p', 'where', mine.version >= (a.version || 1) ? 'In your account. A newer version that passes its background check replaces it there.' : `Your account has version ${mine.version}: it is updated once this version passes its background check.`));
    const row = el('div', 'row');
    const reviewing = ['queued', 'running'].includes(a.review?.status);
    const review = button(a.review && !reviewing ? 'Full review again' : 'Full review', 'secondary', () => askReview(a, review));
    review.disabled = reviewing || a.review?.status === 'unavailable';
    row.append(button(mine ? 'Add this version' : 'Add to my account', 'primary', (e) => addToAccount(a, e.currentTarget)), button('Export', 'secondary', () => exportAdapter(a)), review);
    li.append(row);
    return li;
  }));
}

async function askReview(a, btn) {
  btn.disabled = true;
  try {
    await api(`/chats/${chat.id}/adapters/${a.id}/review`, { method: 'POST' });
    say(`Started the full review of “${a.name}”. It runs in the background.`);
  } catch (e) {
    btn.disabled = false;
    say(`Could not start the review: ${e.message}`, true);
  }
}

/** An adapter's news, said: a new version, and how its checks went. */
function adapterNews(before, a) {
  if (!before) return;
  if (a.version > before.version) announce(`“${a.name}” version ${a.version} is ready to use.`);
  for (const kind of ['check', 'review']) {
    const was = before.version === a.version ? before[kind]?.status : undefined;
    const now = a[kind]?.status;
    if (!now || now === was) continue;
    const what = kind === 'review' ? 'full review' : 'background check';
    const said = {
      running: was === 'queued' ? null : `Checking “${a.name}”: the ${what} started.`,
      queued: `The ${what} of “${a.name}” is waiting to start.`,
      passed: `“${a.name}” passed the ${what}.`,
      problems: `The ${what} found problems in “${a.name}”.`,
      failed: `The ${what} of “${a.name}” could not run.`,
    }[now];
    announce(said);
  }
}

/** One the person added that has a newer version which passed its background check: update their account. */
function updateAdded() {
  for (const a of chat?.adapters || []) {
    const mine = added[addedKey(a)];
    if (mine && a.version > mine.version && ['passed', 'unavailable'].includes(a.check?.status)) addToAccount(a, null, { auto: true });
  }
}

function renderBusy() {
  const busy = isBusy();
  $('stop').hidden = !busy;
  $('send').disabled = busy;
  if ($('send-answers')) $('send-answers').disabled = busy;
  $('state').textContent = busy ? 'Working' : 'Ready';
  $('state').className = `badge ${busy ? 'busy' : 'ok'}`;
}

async function openChat(id) {
  resetDelete();
  chat = (await api(`/chats/${id}`)).chat;
  shownQuestions = null;
  requests.clear();
  $('transcript').replaceChildren();
  renderChats(); renderTranscript(); renderReady(); renderRequests(); renderBusy(); renderWorking();
  updateAdded();
  // A preview belongs to its chat: another chat's comes off the page.
  if (previewing?.on && previewing.chatId !== id) await takePreviewOff();
  await restorePreview();
  try { await chrome.storage.local.set({ assistantChat: id }); } catch { /* fine */ }
}

let confirmTimer = null;
function resetDelete() {
  clearTimeout(confirmTimer);
  $('delete-chat').textContent = 'Delete';
  delete $('delete-chat').dataset.confirm;
}

/** Delete the open chat: the first press asks, a second within a few seconds deletes. */
async function deleteChat() {
  if (!chat) return;
  const b = $('delete-chat');
  if (!b.dataset.confirm) {
    b.dataset.confirm = '1';
    b.textContent = 'Confirm delete';
    say(`Press Confirm delete to delete “${chat.title}”. This cannot be undone.`);
    confirmTimer = setTimeout(() => { resetDelete(); say(''); }, 6000);
    return;
  }
  resetDelete();
  const { id, title } = chat;
  try {
    await api(`/chats/${id}`, { method: 'DELETE' });
    await chatGone(id);
    say(`Deleted “${title}”.`);
  } catch (e) {
    say(`Could not delete it: ${e.message}`, true);
  }
}

/** A chat deleted here or in another sidebar: open the next one, or a new one. */
async function chatGone(id) {
  // Here and from the event stream: the second call finds it gone already.
  const wasOpen = chat?.id === id;
  chats = chats.filter(c => c.id !== id);
  if (wasOpen) chat = null;
  try { const all = await pages(); delete all[id]; await chrome.storage.session.set({ [PAGES_KEY]: all }); } catch { /* fine */ }
  if (!wasOpen) return renderChats();
  if (previewing) await removePreview();
  if (!chats.length) chats = [(await api('/chats', { method: 'POST' })).chat];
  await openChat(chats[0].id);
}

async function loadChats() {
  chats = (await api('/chats')).chats;
  if (!chats.length) chats = [(await api('/chats', { method: 'POST' })).chat];
  const { assistantChat } = await chrome.storage.local.get('assistantChat');
  await openChat(chats.some(c => c.id === assistantChat) ? assistantChat : chats[0].id);
}

// ── the event stream ─────────────────────────────────────────────────────────

// The host writes a heartbeat every 25 s: a stream silent for longer has gone
// away without saying so (a sleeping laptop, a dropped tunnel).
// The host sends a comment every 25 s (agent-host/src/events.js): this long
// with nothing means the connection died without closing (a laptop that slept,
// a proxy that dropped it).
const SILENT_MS = 45_000;
// An attempt with no answer this long is given up, and the next one starts.
const CONNECT_MS = 10_000;
// Between attempts: 1 s, 2 s, 4 s, then every 5 s.
const RETRY_MAX_MS = 5_000;
let wakeStream = null; // ends the wait before the next attempt (Try now, the panel shown again, back online)
function reconnectNow() { wakeStream?.(); }

// Back on screen, focused or online: do not wait out the timer.
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reconnectNow(); });
window.addEventListener('focus', reconnectNow);
window.addEventListener('online', reconnectNow);
$('reconnect').addEventListener('click', reconnectNow);

async function stream() {
  streamAbort?.abort();
  const ctl = new AbortController();
  streamAbort = ctl;
  let wait = 1000;
  let first = true, dropped = false;
  while (!ctl.signal.aborted) {
    const conn = new AbortController();
    const stop = () => conn.abort();
    ctl.signal.addEventListener('abort', stop);
    let silence = null;
    const listen = (ms = SILENT_MS) => { clearTimeout(silence); silence = setTimeout(stop, ms); };
    try {
      listen(CONNECT_MS);
      if (dropped) { $('state').textContent = 'Reconnecting…'; $('reconnect').disabled = true; }
      const res = await fetch(`${connection.url}/v1/agent/events`, { headers: { authorization: `Bearer ${connection.token}` }, signal: conn.signal });
      if (!res.ok) throw new Error(`The toolkit answered ${res.status}.`);
      listen();
      wait = 1000;
      $('reconnect').hidden = true;
      // Open requests come again at the start of the stream; the rest is fetched.
      if (!first) { requests.clear(); renderRequests(); catchUp().catch(e => say(e.message, true)); }
      if (dropped) announce('Connected to the assistant again.');
      first = false;
      dropped = false;
      renderBusy();
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        listen();
        buf += decoder.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          const data = block.split('\n').find(l => l.startsWith('data: '));
          if (data) onEvent(JSON.parse(data.slice(6)));
        }
      }
    } catch { /* reconnect below */ } finally {
      clearTimeout(silence);
      ctl.signal.removeEventListener('abort', stop);
    }
    if (ctl.signal.aborted) return;
    if (!dropped) announce('Lost the connection to the assistant. Reconnecting.');
    dropped = true;
    $('state').className = 'badge warn';
    $('reconnect').hidden = false;
    $('reconnect').disabled = false;
    // Wait, saying when the next attempt is; Try now (or the panel shown again) ends the wait.
    const until = Date.now() + wait;
    const tick = () => { $('state').textContent = `Reconnecting in ${Math.max(1, Math.ceil((until - Date.now()) / 1000))} s`; };
    tick();
    const counter = setInterval(tick, 1000);
    await new Promise(r => { wakeStream = r; setTimeout(r, wait); ctl.signal.addEventListener('abort', r, { once: true }); });
    clearInterval(counter);
    wakeStream = null;
    wait = Math.min(wait * 2, RETRY_MAX_MS);
  }
}

/** After a reconnect: what changed while the stream was down. */
async function catchUp() {
  chats = (await api('/chats')).chats;
  renderChats();
  if (!chat) return renderBusy();
  if (!chats.some(c => c.id === chat.id)) return chatGone(chat.id);
  const fresh = (await api(`/chats/${chat.id}`)).chat;
  if (fresh.id !== chat?.id) return;
  chat = fresh;
  renderTranscript(); renderReady(); renderBusy();
  updateAdded();
}

function onEvent(event) {
  if (event.type === 'chat') {
    const i = chats.findIndex(c => c.id === event.chat.id);
    const was = i >= 0 ? chats[i].busy : undefined;
    if (i >= 0) chats[i] = event.chat; else chats.unshift(event.chat);
    renderChats(); renderBusy();
    if (event.chat.id === chat?.id && was !== undefined && was !== event.chat.busy) {
      announce(event.chat.busy ? 'The assistant is working.' : 'The assistant is done.');
      renderTranscript(); renderReady();
    }
    return;
  }
  if (event.type === 'chat-deleted') { chatGone(event.chatId).catch(e => say(e.message, true)); return; }
  if (event.chatId !== chat?.id) return;
  if (event.type === 'entry') addEntry(event.entry);
  else if (event.type === 'request') handleRequest(event.request);
  else if (event.type === 'request-closed') { requests.delete(event.id); renderRequests(); }
  else if (event.type === 'consent') chat.consent = event.consent;
  else if (event.type === 'adapter') {
    const i = chat.adapters.findIndex(a => a.id === event.adapter.id);
    adapterNews(i >= 0 ? chat.adapters[i] : null, event.adapter);
    if (i >= 0) chat.adapters[i] = event.adapter; else chat.adapters.push(event.adapter);
    renderReady();
    updateAdded();
  }
}

// ── finished adapters ────────────────────────────────────────────────────────

const updating = new Set();
async function addToAccount(a, btn, { auto = false } = {}) {
  const key = addedKey(a);
  if (updating.has(key)) return;
  updating.add(key);
  if (btn) btn.disabled = true;
  if (!auto) say(`Adding “${a.name}” to your account…`);
  try {
    const { adapter } = await api(`/chats/${chat.id}/adapters/${a.id}`);
    const registry = createRegistryClient({ url: connection.url, token: connection.token });
    const r = await registry.publish({
      appName: APP.appName, code: adapter.code,
      descriptor: { appId: APP.appId, id: a.id, name: a.name, description: a.about, targets: [{ platforms: ['*'], urls: a.runsOn }], supportAreas: a.supportAreas || [], ...(a.pageTypes?.length ? { pageTypes: a.pageTypes } : {}) },
    });
    await registry.install(BROWSER_RUNTIME_APP, { appId: APP.appId, id: a.id });
    // The installed copy takes over from the preview.
    if (previewing) await removePreview();
    await chrome.runtime.sendMessage({ type: 'sync' }).catch(() => {});
    added = { ...added, [key]: { version: a.version || 1 } };
    try { await chrome.storage.local.set({ [ADDED_KEY]: added }); } catch { /* fine */ }
    say(auto ? `Updated “${a.name}” in your account to version ${a.version}.` : `“${a.name}” is in your account (revision ${r.revision}), private to you, and runs in this browser on the pages it targets.`);
    renderReady();
  } catch (e) {
    say(`Could not ${auto ? 'update' : 'add'} it: ${e.message}`, true);
  } finally {
    updating.delete(key);
    if (btn) btn.disabled = false;
  }
}

async function exportAdapter(a) {
  try {
    const { adapter } = await api(`/chats/${chat.id}/adapters/${a.id}`);
    const header = [
      `// ${a.name}: ${a.about}`,
      `// Runs on: ${a.runsOn.join(', ')}${a.supportAreas?.length ? `. Helps with: ${a.supportAreas.join(', ')}` : ''}.`,
      '// Made with the AI for Accessibility toolkit’s assistant. Unvalidated: check what it changes.',
      `// Publish it with the toolkit skill: node <skill folder>/scripts/adapter.mjs publish ${a.id}.js --name "${a.name}" ${a.runsOn.map(p => `--runs-on "${p}"`).join(' ')}`,
      '',
    ].join('\n');
    const url = URL.createObjectURL(new Blob([header, adapter.code], { type: 'text/javascript' }));
    const link = Object.assign(document.createElement('a'), { href: url, download: `${a.id}.js` });
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    say(`Saved ${a.id}.js.`);
  } catch (e) {
    say(`Could not export it: ${e.message}`, true);
  }
}

// ── start ────────────────────────────────────────────────────────────────────

$('composer').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = $('message').value.trim();
  if (!text || !chat) return;
  $('send').disabled = true;
  try {
    await ensureWorkingTab({ replaceClosed: true });
    await api(`/chats/${chat.id}/messages`, { method: 'POST', body: { text } });
    $('message').value = '';
    say('');
  } catch (err) {
    say(err.message, true);
    $('send').disabled = false;
  }
});
$('message').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('composer').requestSubmit(); }
});
$('stop').addEventListener('click', () => api(`/chats/${chat.id}/stop`, { method: 'POST' }).catch(e => say(e.message, true)));
$('new-chat').addEventListener('click', async () => {
  const created = (await api('/chats', { method: 'POST' })).chat;
  chats.unshift(created);
  await openChat(created.id);
  $('message').focus();
});
$('chat-select').addEventListener('change', (e) => openChat(e.target.value).catch(err => say(err.message, true)));
$('preview-toggle').addEventListener('click', () => togglePreview().catch(e => say(e.message, true)));
$('delete-chat').addEventListener('click', () => deleteChat());
$('go-to-page').addEventListener('click', () => goToPage().catch(e => say(e.message, true)));
$('switch-page').addEventListener('click', () => switchPage().catch(e => say(e.message, true)));
// A reload or a new page in the preview's tab drops it; with the switch on, it goes back on.
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (previewing?.tabId === tabId && previewing.on && info.status === 'complete') reapplyPreview({ quiet: true }).then((on) => { if (!on) announce(`“${previewing?.name}” does not apply on this page.`); });
  if (info.url || info.title || info.status === 'complete') renderWorkingSoon();
});
chrome.tabs.onActivated.addListener(renderWorkingSoon);
chrome.tabs.onRemoved.addListener((tabId) => { if (previewing?.tabId === tabId) showPreview({ ...previewing, on: false }); renderWorkingSoon(); });
chrome.windows.onFocusChanged.addListener(renderWorkingSoon);

// ── the tabs: Profile, Builder, Settings ─────────────────────────────────────

const TABS = ['profile', 'builder', 'settings'];
const TAB_SUB = { profile: 'Your profile and adapters', builder: 'Build adapters', settings: 'Connection and shortcut' };
const TAB_KEY = 'panelTab'; // the tab last open, for this browser session
let shownTab = null;

function showTab(name, { focus = false } = {}) {
  shownTab = name;
  for (const t of TABS) {
    const tab = $(`tab-${t}`);
    tab.setAttribute('aria-selected', String(t === name));
    tab.tabIndex = t === name ? 0 : -1;
    $(`panel-${t}`).hidden = t !== name;
  }
  $('tab-sub').textContent = TAB_SUB[name];
  if (focus) $(`tab-${name}`).focus();
  chrome.storage.session.set({ [TAB_KEY]: name }).catch(() => {});
  if (name === 'profile') renderProfileTab().catch(e => say(e.message, true));
  if (name === 'settings') renderSettings().catch(e => say(e.message, true));
}
for (const t of TABS) {
  $(`tab-${t}`).addEventListener('click', () => showTab(t));
  $(`tab-${t}`).addEventListener('keydown', (e) => {
    const i = TABS.indexOf(t);
    const to = { ArrowRight: TABS[(i + 1) % TABS.length], ArrowLeft: TABS[(i + TABS.length - 1) % TABS.length], Home: TABS[0], End: TABS[TABS.length - 1] }[e.key];
    if (!to) return;
    e.preventDefault();
    showTab(to, { focus: true });
  });
}
initSettings({ refresh: () => renderSettings() });
initProfile();
// What the Profile and Settings tabs show depends on the page beside the panel and the runtime.
const refreshSide = () => {
  if (shownTab === 'profile') refreshAdapters();
  if (shownTab === 'settings') renderSettings().catch(() => {});
};
chrome.tabs.onActivated.addListener(refreshSide);
chrome.tabs.onUpdated.addListener((tabId, info) => { if (info.status === 'complete') refreshSide(); });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes.runtimeState && shownTab === 'settings') renderSettings().catch(() => {});
  if (area === 'session' && changes.runtimeState && shownTab === 'profile') refreshAdapters({ appliedOnly: true });
});

async function start() {
  connection = await readConnection();
  $('not-connected').hidden = !!connection;
  $('main').hidden = !connection;
  $('builder-unavailable').hidden = true;
  // Connecting happens in Settings; afterwards the tab last open, or Profile.
  const last = (await chrome.storage.session.get(TAB_KEY).catch(() => ({})))[TAB_KEY];
  showTab(!connection ? 'settings' : TABS.includes(last) ? last : 'profile');
  if (!connection) { $('state').textContent = 'Not connected'; return; }
  pageTypes = createPageTypes({ storage: chrome.storage.local, ask: askToolkit(connection) });
  added = (await chrome.storage.local.get(ADDED_KEY).catch(() => ({})))[ADDED_KEY] || {};
  try {
    await api('/status');
    await loadChats();
    stream();
  } catch (e) {
    $('state').textContent = 'Unavailable';
    $('state').className = 'badge warn';
    // Said in the Builder tab: the status line belongs to whichever tab is open.
    $('main').hidden = true;
    $('builder-unavailable').textContent = e.code === 'agent-unavailable' ? 'The assistant is not set up on this toolkit.' : `The assistant is unavailable: ${e.message}`;
    $('builder-unavailable').hidden = false;
  }
}
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.connection) start(); });
start();
