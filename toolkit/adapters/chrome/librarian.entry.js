// Chrome adapter — Librarian. Bundled by personalized-extension/build.js to
// extension/lib/librarian.js (classic script). Builds the chrome-backed
// ports, instantiates the core, installs the periodic alarms, and assigns
// globalThis.Librarian — exactly the surface the pre-toolkit file exposed.
// Loaded by background.js via importScripts after datastore.js.
import { createLibrarian } from '../../core/librarian.js';
import { createBroker } from '../../core/broker.js';

// Bulk local-storage access for memory-shard enumeration.
const kv = {
  getAll: () => chrome.storage.local.get(null),
  set: (items) => chrome.storage.local.set(items),
};

// Pending-proposal count → action badge.
const notifier = {
  async pending(count) {
    await chrome.action.setBadgeText({ text: count ? String(count) : '' });
    if (count) await chrome.action.setBadgeBackgroundColor({ color: '#1a73e8' });
  },
};

// Demo hooks read the service-worker globals dynamically so demo tooling
// (demo-trace.js, AA_DEMO_MODE) keeps working unchanged.
const demo = {
  active: () => !!globalThis.AA_DEMO_MODE,
  trace: (diagram, region, label) => {
    if (globalThis.aaDemoTrace) globalThis.aaDemoTrace(diagram, region, label);
  },
};

const librarian = createLibrarian({
  datastore: () => globalThis.Datastore,
  taxonomy: () => globalThis.AA_TAXONOMY,
  kv,
  notifier,
  demo,
  clock: { now: () => Date.now() },
});

globalThis.Librarian = librarian;

// Cross-app permission broker (Phase 3): the policy layer for sharing the
// person's understanding with other apps. Transport (cross-extension
// messaging, export blobs) is wired by the host per grant; the broker
// enforces scopes and routes incoming insights through the proposal queue.
globalThis.Broker = createBroker({
  datastore: () => globalThis.Datastore,
  librarian,
  clock: { now: () => Date.now() },
});

// Periodic safety nets (the debounced in-process timer is the fast path;
// alarms survive service-worker death). Same ids/cadence as before.
if (chrome.alarms && !globalThis._aaLibrarianAlarmsInstalled) {
  chrome.alarms.create('aaLibrarianExtract', { periodInMinutes: 30 });
  chrome.alarms.create('aaLibrarianReflect', { periodInMinutes: 60 * 24 });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'aaLibrarianExtract') {
      librarian.extract().catch(e => console.warn('[Librarian] extract failed:', e.message));
    } else if (alarm.name === 'aaLibrarianReflect') {
      librarian.reflect().catch(e => console.warn('[Librarian] reflect failed:', e.message));
    }
  });
  globalThis._aaLibrarianAlarmsInstalled = true;
}
