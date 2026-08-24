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

let overlay = null;
let rendered = 0;        // how far into st.fired this page has drawn
let observer = null;
let pushTimer = null;
let lastSent = '';
let runStamp = null;     // st.startedAt - a new stamp means a new take
let openWidgets = {};    // beat id -> true while this tab shows the dialog

export async function isDemoArmed() {
  try { return !!(await chrome.storage.local.get(KEY))[KEY]?.armed; }
  catch { return false; }
}

function pushFacts() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    let facts;
    try { facts = readPage(document, location.href); } catch { return; }
    // Booking mutates constantly; only a read that changed is worth a send.
    const sig = JSON.stringify([facts.page, facts.resultCount, facts.total,
      facts.cards?.length, facts.rooms?.length, facts.destOptions?.length,
      facts.hasForm, facts.freeCancelBefore]);
    if (sig === lastSent) return;
    lastSent = sig;
    chrome.runtime.sendMessage({ type: 'demoFacts', facts }).catch(() => {});
  }, 600);
}

function renderNew(st) {
  if (!overlay || !st) return;
  // A widget answered in ANOTHER tab must close here too - this page's copy
  // would otherwise stand as a stale focus trap, answerable a second time.
  for (const id of Object.keys(openWidgets)) {
    if (st.answers?.[id]) { overlay.dismissWidget(id); delete openWidgets[id]; }
  }
  const fired = st.fired || [];
  for (; rendered < fired.length; rendered += 1) {
    const b = fired[rendered];
    if (b.kind === 'checkpoint') overlay.checkpoint(b);
    else if (b.kind === 'log') overlay.log(b);
    else if (b.kind === 'widget' && !st.answers?.[b.id]) {
      openWidgets[b.id] = true;
      overlay.widget(b).then((a) => {
        delete openWidgets[b.id];
        if (a.dismissed) return;
        chrome.runtime.sendMessage({
          type: 'demoAnswer', id: b.id, response: a.typed || a.choice,
        }).catch(() => {});
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
  }
}

function arm(st) {
  if (overlay) { renderNew(st); return; }
  runStamp = st.startedAt ?? null;
  // The demo's surfaces are the only voice; the generic on-page panel would
  // talk over the story in its own register.
  try { if (AgentWatch.enabled) AgentWatch.disable(); } catch { /* not fatal */ }
  overlay = createOverlay();
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

  observer = new MutationObserver(pushFacts);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  pushFacts();
}

function teardown() {
  observer?.disconnect(); observer = null;
  overlay?.destroy(); overlay = null;
  rendered = 0;
  runStamp = null;
  openWidgets = {};
  lastSent = '';
}

/** Idempotent; safe to call on every page. Wakes only when the demo arms. */
export function initDemoClient() {
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
