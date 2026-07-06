(() => {
  // extension/sidepanel/src/store.js
  var STATE_KEY = "voiceState";
  var RESUME_HANDLE_KEY = "voiceResumeHandle";
  var _store = {
    connection: "disconnected",
    recording: false,
    speaking: false,
    micActivity: false,
    backgroundMode: false,
    error: null,
    transcript: [],
    // True when chrome.storage holds a session-resumption handle from a
    // prior offscreen instance. Drives the "Resume" vs "Start" button
    // label so the user knows the conversation will pick up where it
    // left off.
    hasResumeHandle: false
  };
  var _listeners = /* @__PURE__ */ new Set();
  function get() {
    return { ..._store, transcript: _store.transcript.slice() };
  }
  function subscribe(fn) {
    _listeners.add(fn);
    try {
      fn(get());
    } catch {
    }
    return () => _listeners.delete(fn);
  }
  function _emit() {
    const snap = get();
    for (const fn of _listeners) {
      try {
        fn(snap);
      } catch {
      }
    }
  }
  async function hydrate() {
    const data = await chrome.storage.local.get([STATE_KEY, RESUME_HANDLE_KEY]);
    const s = data[STATE_KEY];
    _store.hasResumeHandle = !!data[RESUME_HANDLE_KEY];
    if (s) {
      _store.connection = s.connection || "disconnected";
      _store.recording = !!s.recording;
      _store.speaking = !!s.speaking;
      _store.backgroundMode = !!s.backgroundMode;
      _store.error = s.error || null;
      _store.transcript = Array.isArray(s.transcript) ? s.transcript.slice() : [];
    }
    _emit();
  }
  function installListener() {
    chrome.runtime.onMessage.addListener((msg) => {
      if (!msg || typeof msg.type !== "string") return;
      if (msg.type === "voiceState" && msg.state) {
        Object.assign(_store, msg.state);
        _emit();
        return;
      }
      if (msg.type === "voiceTranscript" && msg.delta) {
        _appendTranscript(msg.delta);
        _emit();
        return;
      }
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (RESUME_HANDLE_KEY in changes) {
        _store.hasResumeHandle = !!changes[RESUME_HANDLE_KEY].newValue;
        _emit();
      }
      if (STATE_KEY in changes) {
        const s = changes[STATE_KEY].newValue;
        if (s) {
          _store.connection = s.connection || "disconnected";
          _store.recording = !!s.recording;
          _store.speaking = !!s.speaking;
          _store.backgroundMode = !!s.backgroundMode;
          _store.error = s.error || null;
          if (Array.isArray(s.transcript)) _store.transcript = s.transcript.slice();
          _emit();
        }
      }
    });
  }
  function _appendTranscript({ role, text, finished, details, ts, tool, ok, undoable, actionId }) {
    if (role === "event") {
      _store.transcript.push({
        role,
        text,
        details: Array.isArray(details) ? details : [],
        ts: ts || Date.now()
      });
      return;
    }
    if (role === "action") {
      _store.transcript.push({
        role,
        text,
        tool: tool || null,
        ok: ok !== false,
        undoable: !!undoable,
        actionId: actionId || null,
        ts: ts || Date.now()
      });
      return;
    }
    const last = _store.transcript[_store.transcript.length - 1];
    if (last && last.role === role && last.partial) {
      if (text.startsWith(last.text) && text.length >= last.text.length) {
        last.text = text;
      } else {
        last.text += text;
      }
      if (finished) last.partial = false;
    } else {
      _store.transcript.push({ role, text, ts: ts || Date.now(), partial: !finished });
    }
  }

  // extension/sidepanel/src/ui/transcript.js
  var _openDetails = /* @__PURE__ */ new Set();
  function mountTranscript(rootEl, emptyEl, { onUndo } = {}) {
    function render(snap) {
      const list = snap.transcript || [];
      const last = list[list.length - 1];
      const hasUserPartial = last && last.role === "user" && last.partial;
      const showListening = !!snap.micActivity && !hasUserPartial;
      if (!list.length && !showListening) {
        emptyEl.hidden = false;
        rootEl.innerHTML = "";
        return;
      }
      emptyEl.hidden = true;
      let newestUndoable = null;
      if (snap.connection === "live" && !snap.undoInFlight) {
        for (let i = list.length - 1; i >= 0; i--) {
          const e = list[i];
          if (e.role === "action" && e.undoable && e.ok) {
            newestUndoable = e;
            break;
          }
          if (e.role === "action" && e.tool === "undo_last_change") break;
        }
      }
      const scroller = rootEl.parentElement;
      const atBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 40;
      const frag = document.createDocumentFragment();
      for (const entry of list) {
        frag.appendChild(_renderEntry(entry, { canUndo: entry === newestUndoable, onUndo }));
      }
      if (showListening) {
        frag.appendChild(_renderListeningPlaceholder());
      }
      rootEl.replaceChildren(frag);
      if (atBottom) scroller.scrollTop = scroller.scrollHeight;
    }
    return { render };
  }
  function _renderListeningPlaceholder() {
    const li = document.createElement("li");
    li.className = "vp-msg vp-msg-user vp-msg-listening";
    const icon = document.createElement("span");
    icon.className = "vp-listening-icon";
    icon.textContent = "\u{1F3A4}";
    const text = document.createElement("span");
    text.textContent = " Listening\u2026";
    li.appendChild(icon);
    li.appendChild(text);
    return li;
  }
  function _renderEntry(entry, opts = {}) {
    if (entry.role === "event") return _renderEventBubble(entry);
    if (entry.role === "action") return _renderActionChip(entry, opts);
    return _renderSpeechBubble(entry);
  }
  function _renderActionChip(entry, { canUndo, onUndo } = {}) {
    const li = document.createElement("li");
    li.className = "vp-msg vp-msg-action" + (entry.ok ? "" : " vp-msg-action-failed");
    const icon = document.createElement("span");
    icon.className = "vp-action-icon";
    icon.textContent = entry.ok ? "\u2713" : "\u26A0";
    icon.setAttribute("aria-hidden", "true");
    li.appendChild(icon);
    const text = document.createElement("span");
    text.className = "vp-action-text";
    text.textContent = entry.text || "(action)";
    li.appendChild(text);
    if (canUndo && typeof onUndo === "function") {
      const btn = document.createElement("button");
      btn.className = "vp-btn vp-undo-btn";
      btn.textContent = "Undo";
      btn.setAttribute("aria-label", `Undo: ${entry.text || "last change"}`);
      btn.addEventListener("click", () => {
        btn.disabled = true;
        onUndo(entry);
      });
      li.appendChild(btn);
    }
    li.appendChild(_timeEl(entry.ts));
    return li;
  }
  function _renderSpeechBubble(entry) {
    const li = document.createElement("li");
    li.className = `vp-msg vp-msg-${entry.role}` + (entry.partial ? " vp-msg-partial" : "");
    li.textContent = entry.text;
    li.appendChild(_timeEl(entry.ts));
    return li;
  }
  function _renderEventBubble(entry) {
    const li = document.createElement("li");
    li.className = "vp-msg vp-msg-event";
    const det = document.createElement("details");
    det.open = _openDetails.has(entry.ts);
    det.addEventListener("toggle", () => {
      if (det.open) _openDetails.add(entry.ts);
      else _openDetails.delete(entry.ts);
    });
    const summary = document.createElement("summary");
    summary.className = "vp-event-summary";
    const icon = document.createElement("span");
    icon.className = "vp-event-icon";
    icon.textContent = "\u{1F310}";
    summary.appendChild(icon);
    const title = document.createElement("span");
    title.className = "vp-event-title";
    title.textContent = entry.text || "(event)";
    summary.appendChild(title);
    det.appendChild(summary);
    if (entry.details && entry.details.length) {
      const ul = document.createElement("ul");
      ul.className = "vp-event-details";
      for (const row of entry.details) {
        const item = document.createElement("li");
        item.className = "vp-event-row";
        const tag = document.createElement("span");
        tag.className = "vp-event-tag";
        tag.textContent = row.action || row.sub || row.kind || "\xB7";
        const txt = document.createElement("span");
        txt.className = "vp-event-text";
        txt.textContent = row.text || "";
        item.appendChild(tag);
        item.appendChild(txt);
        ul.appendChild(item);
      }
      det.appendChild(ul);
    }
    li.appendChild(det);
    li.appendChild(_timeEl(entry.ts));
    return li;
  }
  function _timeEl(ts) {
    const t = document.createElement("span");
    t.className = "vp-msg-time";
    t.textContent = _fmtTime(ts);
    return t;
  }
  function _fmtTime(ts) {
    if (!ts) return "";
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  // extension/sidepanel/src/ui/status.js
  function mountStatus(statusEl, errorEl) {
    function render(snap) {
      statusEl.className = `vp-status ${snap.connection || "disconnected"}`;
      statusEl.textContent = snap.connection || "disconnected";
      if (snap.error) {
        errorEl.hidden = false;
        errorEl.textContent = snap.error;
      } else {
        errorEl.hidden = true;
        errorEl.textContent = "";
      }
    }
    return { render };
  }

  // extension/sidepanel/src/ui/controls.js
  function mountControls({
    startBtn,
    micBtn,
    endBtn,
    restartBtn,
    bgWrapper,
    bgToggle,
    textForm,
    onStart,
    onEnd,
    onRestart,
    onMicToggle,
    onBackgroundChange
  }) {
    startBtn.addEventListener("click", () => onStart());
    endBtn.addEventListener("click", () => onEnd());
    restartBtn.addEventListener("click", () => onRestart());
    micBtn.addEventListener("click", () => onMicToggle());
    bgToggle.addEventListener("change", (e) => onBackgroundChange(!!e.target.checked));
    function render(snap) {
      const live = snap.connection === "live" || snap.connection === "connecting";
      if (textForm) {
        textForm.hidden = snap.connection !== "live";
      }
      const showRestart = live || !live && !!snap.hasResumeHandle;
      startBtn.hidden = live;
      micBtn.hidden = !live;
      endBtn.hidden = !live;
      restartBtn.hidden = !showRestart;
      bgWrapper.hidden = !live;
      const connecting = snap.connection === "connecting";
      restartBtn.disabled = connecting;
      micBtn.disabled = connecting;
      if (live) {
        micBtn.classList.toggle("muted", !snap.recording);
        micBtn.title = snap.recording ? "Mute mic" : "Unmute mic";
        bgToggle.checked = !!snap.backgroundMode;
      }
      if (connecting) {
        startBtn.textContent = snap.hasResumeHandle ? "Resuming\u2026" : "Connecting\u2026";
        startBtn.disabled = true;
      } else {
        startBtn.textContent = snap.hasResumeHandle ? "Resume" : "Start";
        startBtn.disabled = false;
      }
    }
    return { render };
  }

  // extension/sidepanel/src/index.js
  var $ = (id) => document.getElementById(id);
  async function main() {
    chrome.runtime.connect({ name: "voice-ui" });
    await hydrate();
    installListener();
    let undoInFlight = false;
    let undoTimer = null;
    const transcript = mountTranscript($("vp-transcript"), $("vp-empty"), {
      onUndo: async () => {
        if (undoInFlight) return;
        undoInFlight = true;
        transcript.render({ ...get(), undoInFlight });
        if (undoTimer) clearTimeout(undoTimer);
        undoTimer = setTimeout(() => {
          undoInFlight = false;
          transcript.render({ ...get(), undoInFlight });
        }, 8e3);
        await send({ type: "voiceUndoLast" });
      }
    });
    const status = mountStatus($("vp-status"), $("vp-error"));
    const controls = mountControls({
      startBtn: $("vp-start"),
      micBtn: $("vp-mic"),
      endBtn: $("vp-end"),
      restartBtn: $("vp-restart"),
      bgWrapper: $("vp-bg-wrapper"),
      bgToggle: $("vp-bg-toggle"),
      textForm: $("vp-text-form"),
      onStart: handleStart,
      onEnd: handleEnd,
      onRestart: handleRestart,
      onMicToggle: handleMicToggle,
      onBackgroundChange: handleBackgroundChange
    });
    const textForm = $("vp-text-form");
    const textInput = $("vp-text-input");
    textForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const text = textInput.value.trim();
      if (!text) return;
      textInput.value = "";
      const resp = await send({ type: "voiceTextTurn", text });
      if (resp && resp.error) await _writeError(`Send failed: ${resp.error}`);
    });
    const proposalPill = $("vp-proposals");
    async function refreshProposalPill() {
      const resp = await send({ type: "librarianListProposals", status: "pending" });
      const n = resp && resp.proposals && resp.proposals.length || 0;
      proposalPill.hidden = n === 0;
      proposalPill.textContent = n === 1 ? "1 suggestion" : `${n} suggestions`;
    }
    proposalPill.addEventListener("click", async () => {
      if (get().connection === "live") {
        await send({ type: "voiceTextTurn", text: "What suggestions are waiting for me?" });
      }
    });
    refreshProposalPill();
    setInterval(refreshProposalPill, 6e4);
    const micSettingsBtn = $("vp-open-mic-settings");
    micSettingsBtn.addEventListener("click", () => {
      chrome.tabs.create({ url: "chrome://settings/content/microphone" });
    });
    let _lastMemoryActionId = null;
    let _lastUndoActionId = null;
    subscribe((snap) => {
      const newestAction = [...snap.transcript].reverse().find((e) => e.role === "action");
      if (undoInFlight && newestAction && newestAction.tool === "undo_last_change" && newestAction.actionId !== _lastUndoActionId) {
        _lastUndoActionId = newestAction.actionId;
        undoInFlight = false;
        if (undoTimer) {
          clearTimeout(undoTimer);
          undoTimer = null;
        }
      }
      transcript.render({ ...snap, undoInFlight });
      status.render(snap);
      controls.render(snap);
      const showMic = !!snap.error && /micropho|mic settings/i.test(snap.error);
      micSettingsBtn.hidden = !showMic;
      const memoryTools = /* @__PURE__ */ new Set(["respond_to_proposal", "forget_memory", "remember"]);
      for (let i = snap.transcript.length - 1; i >= 0; i--) {
        const e = snap.transcript[i];
        if (e.role !== "action") continue;
        if (memoryTools.has(e.tool) && e.actionId !== _lastMemoryActionId) {
          _lastMemoryActionId = e.actionId;
          refreshProposalPill();
        }
        break;
      }
    });
  }
  async function handleStart() {
    const micResult = await _ensureMicPermission();
    if (!micResult.granted) {
      await _writeError(micResult.message);
      return;
    }
    const ensureResp = await send({ type: "voiceEnsure" });
    if (ensureResp && ensureResp.error) {
      await _writeError(`Offscreen create failed: ${ensureResp.error}`);
      return;
    }
    const ready = await _waitForOffscreenReady(5e3);
    if (!ready) {
      await _writeError("Voice engine did not start. Try clicking Start again.");
      return;
    }
    const connectResp = await send({ type: "voiceConnect" });
    if (connectResp && connectResp.error) {
      console.error("[sidepanel] voiceConnect failed:", connectResp.error, connectResp.stack || "");
      await _writeError(`Connect failed: ${connectResp.error}`);
    }
  }
  async function _ensureMicPermission() {
    try {
      const perm = await navigator.permissions.query({ name: "microphone" });
      if (perm && perm.state === "granted") return { granted: true };
    } catch {
    }
    const result = await _requestMicViaPopup();
    if (result.granted) return result;
    if (result.errorName === "CancelledByUser") {
      return {
        granted: false,
        message: "Microphone permission window closed. Click Start again to retry."
      };
    }
    let priorDenial = false;
    try {
      const perm = await navigator.permissions.query({ name: "microphone" });
      priorDenial = perm.state === "denied";
    } catch {
    }
    const name = result.errorName || "";
    let message;
    if (priorDenial || name === "NotAllowedError" || name === "SecurityError") {
      message = "Microphone access is blocked for this extension. Open mic settings below, find this extension, set it to Allow, then click Start again.";
    } else if (name === "NotFoundError" || name === "OverconstrainedError") {
      message = "No microphone found. Plug one in and try again.";
    } else if (name === "NotReadableError") {
      message = "Microphone is in use by another app. Close it and try again.";
    } else if (name === "TimeoutError") {
      message = "Permission iframe did not respond. Reload the extension and try again.";
    } else {
      message = `Microphone access failed: ${result.errorMessage || name || "unknown error"}`;
    }
    return { granted: false, message, showSettings: true };
  }
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
        if (!msg || msg.type !== "micPermissionResult") return;
        safeResolve({
          granted: !!msg.granted,
          errorName: msg.errorName,
          errorMessage: msg.errorMessage
        });
      };
      const onWinClosed = (winId) => {
        if (popupWinId != null && winId === popupWinId) {
          safeResolve({ granted: false, errorName: "CancelledByUser" });
        }
      };
      chrome.runtime.onMessage.addListener(onMessage);
      chrome.windows.onRemoved.addListener(onWinClosed);
      chrome.windows.create({
        url: chrome.runtime.getURL("permission/permission.html"),
        type: "popup",
        width: 460,
        height: 280
      }, (win) => {
        if (chrome.runtime.lastError || !win) {
          safeResolve({
            granted: false,
            errorName: "PopupOpenError",
            errorMessage: chrome.runtime.lastError?.message || "could not open permission window"
          });
          return;
        }
        popupWinId = win.id;
      });
      const timer = setTimeout(() => {
        safeResolve({ granted: false, errorName: "TimeoutError" });
      }, 12e4);
    });
  }
  async function _waitForOffscreenReady(timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const resp = await send({ type: "voicePing" });
      if (resp && resp.ok) return true;
      await wait(150);
    }
    return false;
  }
  async function _writeError(text) {
    await chrome.storage.local.set({
      voiceState: {
        ...(await chrome.storage.local.get("voiceState")).voiceState,
        connection: "error",
        error: text
      }
    });
  }
  async function handleEnd() {
    await send({ type: "voiceTeardown" });
  }
  async function handleRestart() {
    const snap = get();
    if (snap.connection === "live" || snap.connection === "connecting") {
      await send({ type: "voiceRestart" });
      return;
    }
    const micResult = await _ensureMicPermission();
    if (!micResult.granted) {
      await _writeError(micResult.message);
      return;
    }
    const ensureResp = await send({ type: "voiceEnsure" });
    if (ensureResp && ensureResp.error) {
      await _writeError(`Offscreen create failed: ${ensureResp.error}`);
      return;
    }
    const ready = await _waitForOffscreenReady(5e3);
    if (!ready) {
      await _writeError("Voice engine did not start. Try clicking Restart again.");
      return;
    }
    const restartResp = await send({ type: "voiceRestart" });
    if (restartResp && restartResp.error) {
      console.error("[sidepanel] voiceRestart failed:", restartResp.error, restartResp.stack || "");
      await _writeError(`Restart failed: ${restartResp.error}`);
    }
  }
  async function handleMicToggle() {
    await send({ type: "voiceMicToggle" });
  }
  async function handleBackgroundChange(enabled) {
    await send({ type: "voiceBackgroundMode", enabled });
  }
  function send(msg) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(msg, (resp) => {
        const _ = chrome.runtime.lastError;
        resolve(resp || {});
      });
    });
  }
  function wait(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }
  main().catch((e) => {
    console.error("[sidepanel] init failed", e);
  });
})();
