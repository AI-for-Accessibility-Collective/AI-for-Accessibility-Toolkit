// Side-panel entry. Bootstraps the store, mounts UI, and routes user
// intent into voice* runtime messages.
//
// Lifecycle:
//   - On mount: open a long-lived port to the SW (`name: 'voice-ui'`)
//     so the SW knows a UI surface is alive (used for offscreen
//     teardown decisions). hydrate() reads the latest snapshot from
//     chrome.storage.local.voiceState. installListener() subscribes
//     to live deltas.
//   - On Start: voiceEnsure (SW creates offscreen if needed) ->
//     voiceConnect (offscreen opens Live WS + mic).
//   - On End: voiceTeardown (SW closes offscreen regardless of bg pref).
//   - On unmount (panel close): the port disconnects automatically; the
//     SW decides whether to keep offscreen alive based on backgroundMode.

import { hydrate, subscribe, installListener, get as getStore } from './store.js';
import { mountTranscript } from './ui/transcript.js';
import { mountStatus } from './ui/status.js';
import { mountControls } from './ui/controls.js';

const $ = (id) => document.getElementById(id);

async function main() {
  // Open the heartbeat port. The SW listens on chrome.runtime.onConnect
  // for `voice-ui` and uses the port count to decide offscreen lifecycle.
  // We don't post anything on this port; its existence is the signal.
  chrome.runtime.connect({ name: 'voice-ui' });

  await hydrate();
  installListener();

  // Guard against double-activating Undo: the button is re-created enabled on
  // every re-render (which fires several times a second while the model
  // speaks), so a second click would revert an older, unrelated change. Hold a
  // flag until the round-trip lands (an undo action chip arrives) or a safety
  // timeout elapses.
  let undoInFlight = false;
  let undoTimer = null;
  const transcript = mountTranscript($('vp-transcript'), $('vp-empty'), {
    onUndo: async () => {
      if (undoInFlight) return;
      undoInFlight = true;
      transcript.render({ ...getStore(), undoInFlight });
      if (undoTimer) clearTimeout(undoTimer);
      undoTimer = setTimeout(() => { undoInFlight = false; transcript.render({ ...getStore(), undoInFlight }); }, 8000);
      await send({ type: 'voiceUndoLast' });
    },
  });
  const status = mountStatus($('vp-status'), $('vp-error'));
  const controls = mountControls({
    startBtn: $('vp-start'),
    micBtn: $('vp-mic'),
    endBtn: $('vp-end'),
    restartBtn: $('vp-restart'),
    bgWrapper: $('vp-bg-wrapper'),
    bgToggle: $('vp-bg-toggle'),
    textForm: $('vp-text-form'),
    onStart: handleStart,
    onEnd: handleEnd,
    onRestart: handleRestart,
    onMicToggle: handleMicToggle,
    onBackgroundChange: handleBackgroundChange,
  });

  // Type-instead-of-speak: same conversation, no mic needed. Useful for
  // speech-impaired users, noisy rooms, and deterministic testing.
  const textForm = $('vp-text-form');
  const textInput = $('vp-text-input');
  textForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = textInput.value.trim();
    if (!text) return;
    textInput.value = '';
    const resp = await send({ type: 'voiceTextTurn', text });
    if (resp && resp.error) await _writeError(`Send failed: ${resp.error}`);
  });

  // Pending-proposal pill: a lightweight nudge toward suggestions waiting
  // for consent. Clicking it (while live) asks the agent to read them out —
  // the visual consent cards stay in the popup.
  const proposalPill = $('vp-proposals');
  async function refreshProposalPill() {
    const resp = await send({ type: 'librarianListProposals', status: 'pending' });
    const n = (resp && resp.proposals && resp.proposals.length) || 0;
    proposalPill.hidden = n === 0;
    proposalPill.textContent = n === 1 ? '1 suggestion' : `${n} suggestions`;
  }
  proposalPill.addEventListener('click', async () => {
    if (getStore().connection === 'live') {
      await send({ type: 'voiceTextTurn', text: 'What suggestions are waiting for me?' });
    }
  });
  refreshProposalPill();
  setInterval(refreshProposalPill, 60000);

  // "Open mic settings" deep-link. Visible only after a mic-permission
  // failure (handleStart sets _showMicSettings via the side effect of
  // _writeError + state below). chrome.tabs.create supports chrome://
  // URLs from extension pages.
  const micSettingsBtn = $('vp-open-mic-settings');
  micSettingsBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: 'chrome://settings/content/microphone' });
  });

  let _lastMemoryActionId = null;
  let _lastUndoActionId = null;
  subscribe((snap) => {
    // Clear the in-flight undo lock once its result chip lands.
    const newestAction = [...snap.transcript].reverse().find((e) => e.role === 'action');
    if (undoInFlight && newestAction && newestAction.tool === 'undo_last_change'
        && newestAction.actionId !== _lastUndoActionId) {
      _lastUndoActionId = newestAction.actionId;
      undoInFlight = false;
      if (undoTimer) { clearTimeout(undoTimer); undoTimer = null; }
    }
    transcript.render({ ...snap, undoInFlight });
    status.render(snap);
    controls.render(snap);
    // Show the deep-link whenever the active error involves mic perms.
    const showMic = !!snap.error && /micropho|mic settings/i.test(snap.error);
    micSettingsBtn.hidden = !showMic;
    // A memory-tool chip means the pending-proposal count may have changed.
    const memoryTools = new Set(['respond_to_proposal', 'forget_memory', 'remember']);
    for (let i = snap.transcript.length - 1; i >= 0; i--) {
      const e = snap.transcript[i];
      if (e.role !== 'action') continue;
      if (memoryTools.has(e.tool) && e.actionId !== _lastMemoryActionId) {
        _lastMemoryActionId = e.actionId;
        refreshProposalPill();
      }
      break;
    }
  });
}

async function handleStart() {
  // Trigger the mic permission prompt from THIS surface before the
  // offscreen page touches getUserMedia. chrome.offscreen documents are
  // headless and can't render a permission prompt themselves -- calling
  // getUserMedia from there before the user has granted access just
  // fails silently with NotAllowedError. Browser permission grants are
  // per-origin (chrome-extension://EXTENSION_ID); once the side panel
  // gets a grant, the offscreen page's own getUserMedia call works.
  const micResult = await _ensureMicPermission();
  if (!micResult.granted) {
    await _writeError(micResult.message);
    return;
  }

  // Ensure the offscreen page exists; the SW creates it on first call.
  const ensureResp = await send({ type: 'voiceEnsure' });
  if (ensureResp && ensureResp.error) {
    // Surface SW-side failures (permission missing, manifest mismatch)
    // through the same store the live-error path uses.
    await _writeError(`Offscreen create failed: ${ensureResp.error}`);
    return;
  }
  // chrome.offscreen.createDocument resolves when the document is
  // created, but the bundle inside still has to parse + register its
  // chrome.runtime.onMessage listener. The fixed 100ms wait we had was
  // racy under load. Poll voicePing until it responds (or 5s passes)
  // before sending voiceConnect.
  const ready = await _waitForOffscreenReady(5000);
  if (!ready) {
    await _writeError('Voice engine did not start. Try clicking Start again.');
    return;
  }
  const connectResp = await send({ type: 'voiceConnect' });
  if (connectResp && connectResp.error) {
    // Surface the full stack to the side-panel DevTools console for
    // debugging. The error string in the UI stays terse.
    console.error('[sidepanel] voiceConnect failed:', connectResp.error, connectResp.stack || '');
    await _writeError(`Connect failed: ${connectResp.error}`);
  }
}

async function _ensureMicPermission() {
  // Fast path: if Chrome already records a granted mic permission for
  // this origin, skip the popup-window prompt entirely. This matters
  // for Restart -- without it, every restart would re-open the
  // permission window even though the grant is already in place.
  try {
    const perm = await navigator.permissions.query({ name: 'microphone' });
    if (perm && perm.state === 'granted') return { granted: true };
  } catch {
    // permissions.query may not surface 'microphone' on every Chrome
    // build for extension origins -- fall through to the popup flow.
  }

  // Slow path: open the standalone permission window and have the user
  // click Enable. Required because top-level extension pages (popup,
  // side panel, options) won't render the getUserMedia prompt directly.
  // See https://github.com/GoogleChrome/chrome-extensions-samples/issues/821.
  const result = await _requestMicViaPopup();
  if (result.granted) return result;
  if (result.errorName === 'CancelledByUser') {
    return {
      granted: false,
      message: 'Microphone permission window closed. Click Start again to retry.',
    };
  }

  // Post-hoc: distinguish a fresh deny on the prompt from a remembered
  // prior deny. After a NotAllowedError, permissions.query reports
  // 'denied' for both cases, but the user-facing fix is the same:
  // open the settings page and clear/allow the entry.
  let priorDenial = false;
  try {
    const perm = await navigator.permissions.query({ name: 'microphone' });
    priorDenial = perm.state === 'denied';
  } catch {
    // Some Chrome builds don't expose 'microphone' to permissions.query
    // from extension origins -- fall through.
  }

  const name = result.errorName || '';
  let message;
  if (priorDenial || name === 'NotAllowedError' || name === 'SecurityError') {
    message =
      'Microphone access is blocked for this extension. Open mic settings below, find this extension, set it to Allow, then click Start again.';
  } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    message = 'No microphone found. Plug one in and try again.';
  } else if (name === 'NotReadableError') {
    message = 'Microphone is in use by another app. Close it and try again.';
  } else if (name === 'TimeoutError') {
    message = 'Permission iframe did not respond. Reload the extension and try again.';
  } else {
    message = `Microphone access failed: ${result.errorMessage || name || 'unknown error'}`;
  }
  return { granted: false, message, showSettings: true };
}

// Open the standalone permission window (extension/permission/permission.html)
// and await its result. A real chrome.windows.create('popup') gives us
// a top-level browsing context whose Permissions-Policy permits
// getUserMedia, so the prompt actually renders -- iframes inside side
// panels and direct calls from extension pages both fail silently in
// current Chrome MV3.
//
// Result paths:
//   - permission.js -> chrome.runtime.sendMessage({type:'micPermissionResult', ...})
//   - user closes window without clicking -> chrome.windows.onRemoved fires
//   - 2-minute safety timeout if neither happens (rare)
function _requestMicViaPopup() {
  return new Promise((resolve) => {
    let resolved = false;
    let popupWinId = null;
    const safeResolve = (val) => {
      if (resolved) return;
      resolved = true;
      chrome.runtime.onMessage.removeListener(onMessage);
      chrome.windows.onRemoved.removeListener(onWinClosed);
      clearTimeout(timer);
      resolve(val);
    };
    const onMessage = (msg) => {
      if (!msg || msg.type !== 'micPermissionResult') return;
      // After getting a result, give the popup a moment to self-close.
      safeResolve({
        granted: !!msg.granted,
        errorName: msg.errorName,
        errorMessage: msg.errorMessage,
      });
    };
    const onWinClosed = (winId) => {
      if (popupWinId != null && winId === popupWinId) {
        // User closed without resolving -- treat as cancellation. If
        // a message already arrived this is a no-op (resolved=true).
        safeResolve({ granted: false, errorName: 'CancelledByUser' });
      }
    };
    chrome.runtime.onMessage.addListener(onMessage);
    chrome.windows.onRemoved.addListener(onWinClosed);
    chrome.windows.create({
      url: chrome.runtime.getURL('permission/permission.html'),
      type: 'popup',
      width: 460,
      height: 280,
    }, (win) => {
      if (chrome.runtime.lastError || !win) {
        safeResolve({
          granted: false,
          errorName: 'PopupOpenError',
          errorMessage: chrome.runtime.lastError?.message || 'could not open permission window',
        });
        return;
      }
      popupWinId = win.id;
    });
    const timer = setTimeout(() => {
      safeResolve({ granted: false, errorName: 'TimeoutError' });
    }, 120000);
  });
}

async function _waitForOffscreenReady(timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const resp = await send({ type: 'voicePing' });
    if (resp && resp.ok) return true;
    await wait(150);
  }
  return false;
}

async function _writeError(text) {
  // Side panel doesn't own voiceState -- writing through chrome.storage
  // is the cleanest way to surface a "client-side only" error message,
  // and the store's onChanged listener will pick it up.
  await chrome.storage.local.set({
    voiceState: {
      ...(await chrome.storage.local.get('voiceState')).voiceState,
      connection: 'error',
      error: text,
    },
  });
}

async function handleEnd() {
  await send({ type: 'voiceTeardown' });
}

async function handleRestart() {
  // Two cases the button covers:
  //   1. Live/connecting -- offscreen is up; voiceRestart is the
  //      single-shot atomic close+clear+reconnect.
  //   2. Disconnected with a cached resume handle ("Resume" state) --
  //      no offscreen yet. Run the same boot path as handleStart but
  //      send voiceRestart instead of voiceConnect at the end so the
  //      offscreen drops the handle + transcript before connecting.
  const snap = getStore();
  if (snap.connection === 'live' || snap.connection === 'connecting') {
    await send({ type: 'voiceRestart' });
    return;
  }

  const micResult = await _ensureMicPermission();
  if (!micResult.granted) {
    await _writeError(micResult.message);
    return;
  }
  const ensureResp = await send({ type: 'voiceEnsure' });
  if (ensureResp && ensureResp.error) {
    await _writeError(`Offscreen create failed: ${ensureResp.error}`);
    return;
  }
  const ready = await _waitForOffscreenReady(5000);
  if (!ready) {
    await _writeError('Voice engine did not start. Try clicking Restart again.');
    return;
  }
  const restartResp = await send({ type: 'voiceRestart' });
  if (restartResp && restartResp.error) {
    console.error('[sidepanel] voiceRestart failed:', restartResp.error, restartResp.stack || '');
    await _writeError(`Restart failed: ${restartResp.error}`);
  }
}

async function handleMicToggle() {
  await send({ type: 'voiceMicToggle' });
}

async function handleBackgroundChange(enabled) {
  await send({ type: 'voiceBackgroundMode', enabled });
}

function send(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (resp) => {
      // chrome.runtime.lastError swallowed: the offscreen page may not
      // be up yet during the very first voiceEnsure round-trip.
      const _ = chrome.runtime.lastError;
      resolve(resp || {});
    });
  });
}

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

main().catch((e) => {
  console.error('[sidepanel] init failed', e);
});
