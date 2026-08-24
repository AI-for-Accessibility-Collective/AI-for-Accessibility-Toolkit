// The demo client: the content-script half of the demo.
//
// It does two jobs and owns no story logic at all:
//   * reads the page (booking-facts) whenever it settles or mutates, and
//     sends the facts to the director in the service worker;
//   * renders whatever the director fired, through the overlay, and sends
//     her answers back.
//
// State lives in `aa.demo` storage, written only by the director. Rendering
// off storage rather than off messages means a page reload mid-run rebuilds
// the surface from the same record every other surface reads - the content
// script dies on every navigation, so this is the only shape that survives.

import { createOverlay } from './overlay.js';
import { readPage } from './booking-facts.js';
import { AgentWatch } from '../../../skills/builtin/agent-watch.js';

const KEY = 'aa.demo';

// The demo lives on booking.com. Without this gate the observer, heartbeat
// and overlay ran on EVERY open tab while armed - dashboards included.
const ON_STAGE = /(^|\.)booking\.com$/.test(location.hostname);

// After an extension reload, tabs opened earlier keep running THIS dead
// copy of the script, and any chrome API call from it throws "Extension
// context invalidated" - uncaught, every heartbeat, in every stale tab.
// A dead copy detects itself and cleans up instead.
function contextAlive() {
  try { return !!chrome.runtime?.id; } catch { return false; }
}

let overlay = null;
let rendered = 0;        // how far into st.fired this page has drawn
let observer = null;
let pushTimer = null;
let lastSent = '';
let runStamp = null;     // st.startedAt - a new stamp means a new take
let openWidgets = {};    // beat id -> true while this tab shows the dialog
let heartbeat = null;    // periodic read: sweeps must not wait for a mutation

export async function isDemoArmed() {
  try { return !!(await chrome.storage.local.get(KEY))[KEY]?.armed; }
  catch { return false; }
}

function pushFacts() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    if (!contextAlive()) { teardown(); return; }
    let facts;
    try { facts = readPage(document, location.href); } catch { return; }
    // Booking mutates constantly; only a read that changed is worth a send.
    const sig = JSON.stringify([facts.page, facts.resultCount, facts.total,
      facts.cards?.length, facts.rooms?.length, facts.destOptions?.length,
      facts.hasForm, facts.freeCancelBefore]);
    if (sig === lastSent) return;
    lastSent = sig;
    try { chrome.runtime.sendMessage({ type: 'demoFacts', facts }).catch(() => {}); }
    catch { teardown(); }
  }, 600);
}

// The spotlight: when a beat names something on the page (the ad, the
// closest hotel, the total), outline it while the card shows - the visible
// proof that the layer reads the real page. Sighted-audience only; the
// spoken line already carries every fact (speech parity).
const SPOT_STYLE_ID = 'vd-spot-style';
function spotlight(anchor) {
  if (!anchor) return;
  if (!document.getElementById(SPOT_STYLE_ID)) {
    const st = document.createElement('style');
    st.id = SPOT_STYLE_ID;
    st.textContent = '.vd-spot{outline:3px solid #18181b !important;'
      + 'outline-offset:3px;border-radius:8px;transition:outline-color .3s}';
    document.head.appendChild(st);
  }
  let el = null;
  for (const card of document.querySelectorAll('[data-testid="property-card"]')) {
    if ((card.textContent || '').includes(anchor)) { el = card; break; }
  }
  if (!el) {
    el = [...document.querySelectorAll('h1,h2,td,div,span')]
      .filter((n) => !n.closest('[data-ai4a11y-ui]')
        && (n.textContent || '').trim().includes(anchor)
        && (n.textContent || '').length < 300)
      .sort((a, b) => a.textContent.length - b.textContent.length)[0];
  }
  if (!el) return;
  el.classList.add('vd-spot');
  setTimeout(() => el.classList.remove('vd-spot'), 7000);
}

// Booking's map view swallows the whole results page; the agent sometimes
// opens it by accident and the demo drowns. Close it the moment it appears.
function closeMapIfOpen() {
  const close = [...document.querySelectorAll('button')]
    .find((b) => /close map/i.test(b.getAttribute('aria-label') || b.textContent || ''));
  if (close) { close.click(); return true; }
  return false;
}

// After an answer, bring the agent's next target into view - its next
// screenshot then already contains the thing, instead of 2-4 scroll turns.
let lastAssist = '';
function assistFor(st) {
  const a = st.answers || {};
  if (a.compare && !a.room && lastAssist !== 'zen') {
    lastAssist = 'zen';
    const el = [...document.querySelectorAll('[data-testid="property-card"]')]
      .find((c) => /zen/i.test(c.textContent || ''));
    try { el?.scrollIntoView({ block: 'center' }); } catch { /* fine */ }
  }
  if (a.room && lastAssist !== 'reserve') {
    lastAssist = 'reserve';
    const el = document.querySelector('.hprt-reservation-cta, [class*="hprt-table"]');
    try { el?.scrollIntoView({ block: 'center' }); } catch { /* fine */ }
  }
}

function renderNew(st) {
  if (!overlay || !st) return;
  assistFor(st);
  // A widget answered in ANOTHER tab must close here too - this page's copy
  // would otherwise stand as a stale focus trap, answerable a second time.
  for (const id of Object.keys(openWidgets)) {
    if (st.answers?.[id]) { overlay.dismissWidget(id); delete openWidgets[id]; }
  }
  const fired = st.fired || [];
  for (; rendered < fired.length; rendered += 1) {
    const b = fired[rendered];
    if (b.kind === 'checkpoint') { overlay.checkpoint(b); spotlight(b.spot); }
    else if (b.kind === 'log') overlay.log(b);
    else if (b.kind === 'widget' && !st.answers?.[b.id]) {
      openWidgets[b.id] = true;
      spotlight(b.spot);
      overlay.widget(b).then((a) => {
        delete openWidgets[b.id];
        if (a.dismissed) return;
        try {
          chrome.runtime.sendMessage({
            type: 'demoAnswer', id: b.id, response: a.typed || a.choice,
          }).catch(() => {});
        } catch { teardown(); return; }
        // The page a widget paused on often never mutates again, and the
        // worker may have restarted (losing its lastFacts) - a fresh read
        // right after the answer keeps the story moving either way.
        lastSent = '';
        pushFacts();
      });
    }
  }
  if (st.done) {
    overlay.report();
    // The run is over; stop reading the page. The drawer stays.
    observer?.disconnect(); observer = null;
    clearInterval(heartbeat); heartbeat = null;
  }
}

function arm(st) {
  if (overlay) { renderNew(st); return; }
  runStamp = st.startedAt ?? null;
  // The demo's surfaces are the only voice; the generic on-page panel would
  // talk over the story in its own register.
  try { if (AgentWatch.enabled) AgentWatch.disable(); } catch { /* not fatal */ }
  // aa.demo.voiced === false silences our TTS for real-VoiceOver
  // presentations, so the two voices never talk over each other.
  overlay = createOverlay({ voiced: st.voiced !== false });
  // Everything already fired belongs to earlier pages and was heard there -
  // except a widget she has not answered, which must survive the navigation.
  const fired = st.fired || [];
  rendered = fired.length;
  const lastWidget = [...fired].reverse().find((f) => f.kind === 'widget');
  if (lastWidget && !st.answers?.[lastWidget.id]) {
    rendered = fired.indexOf(lastWidget);
  }
  // The drawer replays the whole run's log so the end report is complete on
  // whatever page the run ends on.
  for (const f of fired.slice(0, rendered)) if (f.kind === 'log') overlay.log(f);
  renderNew(st);

  observer = new MutationObserver(() => { closeMapIfOpen(); pushFacts(); });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  // A page that stops mutating must not stop the director: the stale-hold
  // sweep and the beat guards both run on facts ticks, so a quiet page gets
  // a heartbeat read every few seconds while the run is live.
  heartbeat = setInterval(() => { lastSent = ''; pushFacts(); }, 5000);
  // The stage lever, invisible: Alt+Shift+N plays the next beat on its
  // rehearsal fallbacks. A keyboard chord instead of a button because
  // nothing on screen may name the demo (David, 2026-08-24).
  document.addEventListener('keydown', (e) => {
    if (e.altKey && e.shiftKey && (e.key === 'N' || e.key === 'n')) {
      try { chrome.runtime.sendMessage({ type: 'demoForce' }).catch(() => {}); }
      catch { teardown(); }
    }
  });
  pushFacts();
}

function teardown() {
  observer?.disconnect(); observer = null;
  clearInterval(heartbeat); heartbeat = null;
  overlay?.destroy(); overlay = null;
  rendered = 0;
  runStamp = null;
  openWidgets = {};
  lastSent = '';
}

/** Idempotent; safe to call on every page. Wakes only when the demo arms. */
export function initDemoClient() {
  if (!ON_STAGE) return;
  chrome.storage.local.get(KEY).then((r) => { if (r[KEY]?.armed) arm(r[KEY]); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[KEY]) return;
    const st = changes[KEY].newValue;
    if (!st?.armed) { teardown(); return; }
    // A fresh startedAt is a new take: rebuild instead of appending, or the
    // second run stays silent until it out-fires the first one's count.
    if (overlay && runStamp != null && st.startedAt !== runStamp) {
      teardown();
    }
    if (!overlay) arm(st);
    else renderNew(st);
  });
}
