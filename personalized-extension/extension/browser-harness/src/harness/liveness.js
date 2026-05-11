// Per-tab liveness probe + alarm-driven sweep. chrome.alarms is the
// MV3-correct way to schedule periodic work in a service worker that may
// be evicted between firings; setInterval would die with the SW.
//
// Three failed pings in a row (~6s, given BH_PING_TIMEOUT_MS=2s) flips
// the tab into BH_HEALTH.unresponsive, which the agent loop reads via
// healthSnapshot. The per-iteration network-stall scan reuses the same
// alarm so we don't pay for two separate periodic budgets.

import {
  BH_LIVENESS_PERIOD_MIN,
  BH_NETWORK_STALL_MS,
  BH_PING_TIMEOUT_MS,
  BH_UNRESPONSIVE_THRESHOLD,
} from './constants.js';
import {
  BH_ATTACHED,
  BH_HEALTH,
  BH_NET_INFLIGHT,
  BH_UNRESP_COUNT,
  bhAgentIsBusy,
  bhHealthIsEnabled,
} from './state.js';
import { bhCdp } from './lifecycle.js';

// Single-tab liveness probe. A tight Runtime.evaluate('1') with a 2s cap;
// failure increments the consecutive-failure counter, success resets it.
async function _bhPing(tabId) {
  if (!bhHealthIsEnabled()) return;
  if (bhAgentIsBusy()) return;
  if (!BH_ATTACHED.has(tabId)) return;
  try {
    await bhCdp(
      tabId,
      'Runtime.evaluate',
      { expression: '1', returnByValue: true },
      { timeoutMs: BH_PING_TIMEOUT_MS },
    );
    BH_UNRESP_COUNT.delete(tabId);
    BH_HEALTH.unresponsive.delete(tabId);
  } catch {
    const n = (BH_UNRESP_COUNT.get(tabId) || 0) + 1;
    BH_UNRESP_COUNT.set(tabId, n);
    if (n >= BH_UNRESPONSIVE_THRESHOLD) BH_HEALTH.unresponsive.add(tabId);
  }
}

if (typeof chrome !== 'undefined' && chrome.alarms && !chrome.alarms.onAlarm._bhInstalled) {
  chrome.alarms.create('bhLiveness', { periodInMinutes: BH_LIVENESS_PERIOD_MIN });
  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name !== 'bhLiveness' || !bhHealthIsEnabled()) return;
    // Network-stall scan: find requests in-flight past the threshold and
    // record the oldest age per tab so the agent can mention it.
    const now = Date.now();
    BH_HEALTH.networkStall.clear();
    for (const { tabId, t } of BH_NET_INFLIGHT.values()) {
      const age = now - t;
      if (age >= BH_NETWORK_STALL_MS) {
        const prev = BH_HEALTH.networkStall.get(tabId) || 0;
        if (age > prev) BH_HEALTH.networkStall.set(tabId, age);
      }
    }
    // Liveness ping every attached tab in parallel.
    await Promise.all(Array.from(BH_ATTACHED).map(_bhPing));
  });
  chrome.alarms.onAlarm._bhInstalled = true;
}
