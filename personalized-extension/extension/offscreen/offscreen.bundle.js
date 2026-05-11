(() => {
  // extension/offscreen/src/live/tools.js
  var TOOL_DECLARATIONS = [
    {
      functionDeclarations: [
        {
          name: "start_browser_task",
          description: 'Start the browser agent on a single concise task. Returns once the task has been launched (the agent runs asynchronously after this call). Call this once per user-initiated task; do NOT call it again to "stop" or "redirect" -- you have no such capability.',
          parameters: {
            type: "object",
            properties: {
              task: {
                type: "string",
                description: 'A one-sentence description of what the user wants done, in their words. Example: "find the top trending Python repo on GitHub".'
              }
            },
            required: ["task"]
          }
        },
        {
          name: "get_browser_status",
          description: "Read the current browser-agent state. Use when the user asks what is happening or you need to confirm a state before responding. Returns task, status, and the last log entry.",
          parameters: { type: "object", properties: {} }
        }
      ]
    }
  ];
  async function dispatchToolCall(name, args) {
    switch (name) {
      case "start_browser_task": {
        const task = args && typeof args.task === "string" ? args.task.trim() : "";
        if (!task)
          return { error: "no task supplied" };
        const resp = await sendRuntime({ type: "bhAgentStart", task });
        if (resp && resp.error)
          return { error: resp.error };
        return { status: "started", task };
      }
      case "get_browser_status": {
        const data = await chrome.storage.local.get("bhAgent");
        const s = data.bhAgent || {};
        const lastLog = s.log && s.log.length ? s.log[s.log.length - 1] : null;
        return {
          task: s.task || null,
          status: s.status || "idle",
          startedAt: s.startedAt || null,
          endedAt: s.endedAt || null,
          summary: s.summary || null,
          error: s.error || null,
          lastLog: lastLog ? { kind: lastLog.kind, text: lastLog.text } : null
        };
      }
      default:
        return { error: `unknown tool ${name}` };
    }
  }
  function sendRuntime(msg) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(msg, (resp) => {
        const err = chrome.runtime.lastError;
        if (err)
          return resolve({ error: err.message });
        resolve(resp || {});
      });
    });
  }

  // extension/offscreen/src/live/prompt.js
  var SYSTEM_INSTRUCTION = `You are the voice companion for an accessibility browser agent. You help the user by:

1. Listening to a spoken task and starting the browser agent on it via the start_browser_task tool. Capture the user's intent in one concise sentence -- don't add steps the user didn't ask for.
2. Narrating what the browser agent is doing in real time. You receive periodic [Browser update] messages describing the agent's actions (navigation, clicks, errors, completion). Translate them into short conversational updates. Don't read URLs or coordinates aloud verbatim; describe them ("opening GitHub", "clicking the search bar").
3. Answering questions about the current state via get_browser_status when the user asks "what's happening" or similar.

Rules:
- Speak briefly. This is voice; one or two short sentences per turn.
- Don't try to control the browser agent beyond starting a task. You cannot click, type, scroll, or stop on the user's behalf -- if the user asks you to, say "I can't do that yet; the browser agent is in charge once it starts."
- If a [Browser update] arrives mid-thought, finish your current sentence, then summarize what changed.
- If the agent finishes ("status: done"), tell the user the result in one sentence based on the summary you received.
- If the agent errors, tell the user briefly what went wrong; offer to start a new task.
- If you don't have enough info to act on a request, ask one short follow-up question.
- Never invent browser state. If you weren't told something happened, you don't know it happened.

The user may interrupt you any time. When that happens, stop talking and listen.`;

  // extension/offscreen/src/storage.js
  var HAS_STORAGE = !!(globalThis.chrome && chrome.storage);
  if (!HAS_STORAGE) {
    console.info("[voice] chrome.storage not exposed to offscreen; using SW-proxy fallback (this is expected on some Chrome builds).");
  }
  var _changeListeners = /* @__PURE__ */ new Set();
  var _forwarderInstalled = false;
  function _ensureForwarder() {
    if (HAS_STORAGE || _forwarderInstalled)
      return;
    _forwarderInstalled = true;
    chrome.runtime.onMessage.addListener((msg) => {
      if (!msg || msg.type !== "voiceProxyStorageChange")
        return;
      console.log("[voice] storage forwarder received change:", Object.keys(msg.changes || {}));
      for (const fn of _changeListeners) {
        try {
          fn(msg.changes || {}, msg.area || "local");
        } catch (e) {
          console.warn("[voice] storage listener threw:", e && e.message);
        }
      }
    });
  }
  function _proxy(op, area, payload) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(
          { type: "voiceProxyStorage", op, area, payload },
          (resp) => {
            const err = chrome.runtime.lastError;
            if (err)
              resolve({ error: err.message });
            else
              resolve(resp || {});
          }
        );
      } catch (e) {
        resolve({ error: e.message || String(e) });
      }
    });
  }
  async function get(area, keys) {
    if (HAS_STORAGE) {
      try {
        return await chrome.storage[area].get(keys);
      } catch (e) {
        console.warn(`[voice] storage.${area}.get failed:`, e && e.message);
        return {};
      }
    }
    const resp = await _proxy("get", area, keys);
    if (resp.error) {
      console.warn(`[voice] proxy storage.${area}.get failed:`, resp.error);
      return {};
    }
    return resp.data || {};
  }
  async function set(area, payload) {
    if (HAS_STORAGE) {
      try {
        await chrome.storage[area].set(payload);
      } catch (e) {
        console.warn(`[voice] storage.${area}.set failed:`, e && e.message);
      }
      return;
    }
    const resp = await _proxy("set", area, payload);
    if (resp.error)
      console.warn(`[voice] proxy storage.${area}.set failed:`, resp.error);
  }
  async function remove(area, key) {
    if (HAS_STORAGE) {
      try {
        await chrome.storage[area].remove(key);
      } catch (e) {
        console.warn(`[voice] storage.${area}.remove failed:`, e && e.message);
      }
      return;
    }
    const resp = await _proxy("remove", area, key);
    if (resp.error)
      console.warn(`[voice] proxy storage.${area}.remove failed:`, resp.error);
  }
  function onChanged(fn) {
    if (HAS_STORAGE) {
      chrome.storage.onChanged.addListener(fn);
      return () => chrome.storage.onChanged.removeListener(fn);
    }
    _ensureForwarder();
    _changeListeners.add(fn);
    return () => _changeListeners.delete(fn);
  }

  // extension/offscreen/src/live/session.js
  var STORAGE_KEY = "voiceResumeHandle";
  var WRITE_DEBOUNCE_MS = 1e3;
  var _handle = null;
  var _writeTimer = null;
  async function loadHandle() {
    const data = await get("local", STORAGE_KEY);
    _handle = data[STORAGE_KEY] || null;
    return _handle;
  }
  function getHandle() {
    return _handle;
  }
  function consumeUpdate(update) {
    if (!update)
      return;
    if (update.resumable && update.newHandle) {
      _handle = update.newHandle;
      _scheduleWrite(_handle);
    }
  }
  async function clearHandle() {
    _handle = null;
    if (_writeTimer) {
      clearTimeout(_writeTimer);
      _writeTimer = null;
    }
    await remove("local", STORAGE_KEY);
  }
  function _scheduleWrite(value) {
    if (_writeTimer)
      clearTimeout(_writeTimer);
    _writeTimer = setTimeout(() => {
      _writeTimer = null;
      set("local", { [STORAGE_KEY]: value });
    }, WRITE_DEBOUNCE_MS);
  }

  // extension/offscreen/src/live/client.js
  var LIVE_WS_BASE = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";
  var DEFAULT_MODEL = "gemini-3.1-flash-live-preview";
  function createLiveClient({
    apiKey,
    model = DEFAULT_MODEL,
    onAudio,
    // (base64Pcm, mimeRate) -- model audio chunk
    onInputTranscript,
    // ({text, finished}) -- user speech transcript
    onOutputTranscript,
    // ({text, finished}) -- model speech transcript
    onInterrupted,
    // () -- server says user barged in
    onTurnComplete,
    // () -- model finished a turn
    onToolCall,
    // ({id, name, args}) -- async; resolve with response object
    onToolCallCancellation,
    // ([id, ...]) -- abort matching in-flight tool calls
    onGoAway,
    // ({timeLeft}) -- server about to close; reconnect with handle
    onError,
    // (msg)
    onOpen,
    // () -- WS handshake done (NOT setupComplete)
    onSetupComplete
    // ()
  }) {
    if (!apiKey)
      throw new Error("live: apiKey required");
    let ws = null;
    let closed = false;
    const pendingTools = /* @__PURE__ */ new Map();
    function _send(obj) {
      if (!ws || ws.readyState !== WebSocket.OPEN)
        return false;
      ws.send(JSON.stringify(obj));
      return true;
    }
    async function connect2() {
      if (closed)
        return;
      await loadHandle();
      const url = `${LIVE_WS_BASE}?key=${encodeURIComponent(apiKey)}`;
      ws = new WebSocket(url);
      ws.onopen = () => {
        onOpen?.();
        const setup = {
          setup: {
            model: model.startsWith("models/") ? model : `models/${model}`,
            generationConfig: {
              responseModalities: ["AUDIO"]
            },
            systemInstruction: {
              parts: [{ text: SYSTEM_INSTRUCTION }]
            },
            tools: TOOL_DECLARATIONS,
            // Both transcription configs always on for UI captions; cheap.
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            // Resumption: pass the cached handle on reconnect so context
            // is preserved across goAway / WS drop. Empty object on first
            // connect tells the server to start emitting resumption
            // updates we can cache.
            //
            // The Python SDK exposes a `transparent: bool` flag here; the
            // v1beta WebSocket schema rejects it ("Unknown name
            // 'transparent' ... Cannot find field"). Stick to `handle`
            // only on the wire; the server defaults are fine for our
            // catch-up flow (we don't replay buffered client messages).
            sessionResumption: getHandle() ? { handle: getHandle() } : {},
            // Slide context out so long sessions don't terminate when the
            // window fills. Numbers chosen conservatively; tune later.
            contextWindowCompression: {
              triggerTokens: "25600",
              slidingWindow: { targetTokens: "12800" }
            }
          }
        };
        _send(setup);
      };
      ws.onmessage = async (evt) => {
        let msg;
        try {
          const text = typeof evt.data === "string" ? evt.data : await evt.data.text();
          msg = JSON.parse(text);
        } catch (e) {
          onError?.(`recv parse failed: ${e.message}`);
          return;
        }
        await _handleMessage(msg);
      };
      ws.onerror = (e) => {
        console.warn("[live] ws error", e);
      };
      ws.onclose = (evt) => {
        const explained = _explainClose(evt.code, evt.reason);
        onError?.(`ws closed code=${evt.code} reason=${evt.reason || ""}${explained ? " (" + explained + ")" : ""}`);
      };
    }
    async function _handleMessage(msg) {
      if (msg.setupComplete) {
        onSetupComplete?.();
        return;
      }
      if (msg.serverContent) {
        const sc = msg.serverContent;
        if (sc.interrupted)
          onInterrupted?.();
        const parts = sc.modelTurn?.parts || [];
        for (const p of parts) {
          const inline = p.inlineData;
          if (inline?.data && (inline.mimeType || "").startsWith("audio/")) {
            const m = /rate=(\d+)/i.exec(inline.mimeType || "");
            onAudio?.(inline.data, m ? Number(m[1]) : 24e3);
          }
        }
        if (sc.inputTranscription)
          onInputTranscript?.(sc.inputTranscription);
        if (sc.outputTranscription)
          onOutputTranscript?.(sc.outputTranscription);
        if (sc.turnComplete)
          onTurnComplete?.();
        return;
      }
      if (msg.toolCall) {
        const calls = msg.toolCall.functionCalls || [];
        for (const fc of calls) {
          const ac = new AbortController();
          pendingTools.set(fc.id, ac);
          Promise.resolve().then(() => onToolCall?.(fc, ac.signal)).then((response) => {
            if (ac.signal.aborted)
              return;
            pendingTools.delete(fc.id);
            sendToolResponse(fc.id, fc.name, response || {});
          }).catch((err) => {
            if (!ac.signal.aborted) {
              pendingTools.delete(fc.id);
              sendToolResponse(fc.id, fc.name, { error: String(err && err.message || err) });
            }
          });
        }
        return;
      }
      if (msg.toolCallCancellation) {
        const ids = msg.toolCallCancellation.ids || [];
        for (const id of ids) {
          const ac = pendingTools.get(id);
          if (ac) {
            ac.abort();
            pendingTools.delete(id);
          }
        }
        onToolCallCancellation?.(ids);
        return;
      }
      if (msg.sessionResumptionUpdate) {
        consumeUpdate(msg.sessionResumptionUpdate);
        return;
      }
      if (msg.goAway) {
        onGoAway?.(msg.goAway);
        return;
      }
    }
    function sendAudioChunk(int16ArrayBuffer) {
      if (!ws || ws.readyState !== WebSocket.OPEN)
        return;
      const u8 = new Uint8Array(int16ArrayBuffer);
      const b64 = _bytesToBase64(u8);
      _send({
        realtimeInput: {
          audio: { data: b64, mimeType: "audio/pcm;rate=16000" }
        }
      });
    }
    function sendTextTurn(text, { role = "user", turnComplete = true } = {}) {
      if (!text)
        return;
      _send({
        clientContent: {
          turns: [{ role, parts: [{ text }] }],
          turnComplete
        }
      });
    }
    function sendToolResponse(id, name, response) {
      _send({
        toolResponse: {
          functionResponses: [{ id, name, response }]
        }
      });
    }
    function close() {
      closed = true;
      pendingTools.forEach((ac) => {
        try {
          ac.abort();
        } catch {
        }
      });
      pendingTools.clear();
      if (ws) {
        try {
          ws.close(1e3, "client closing");
        } catch {
        }
        ws = null;
      }
    }
    function isOpen() {
      return !!ws && ws.readyState === WebSocket.OPEN;
    }
    return {
      connect: connect2,
      close,
      isOpen,
      sendAudioChunk,
      sendTextTurn,
      sendToolResponse,
      // Exposed for the driver to clear handle on auth failures so a fresh
      // session is opened next time.
      clearHandle
    };
  }
  function _explainClose(code, reason) {
    if (code === 1e3 || code === 1001)
      return null;
    if (code === 1006)
      return "connection lost (network or server unavailable)";
    if (code === 1007)
      return "protocol error -- check setup payload";
    if (code === 1011)
      return "server internal error";
    if (code >= 4e3 && code < 5e3) {
      return reason || `server rejected the session (${code})`;
    }
    return reason || `close code ${code}`;
  }
  function _bytesToBase64(u8) {
    let s = "";
    const CHUNK = 32768;
    for (let i = 0; i < u8.length; i += CHUNK) {
      s += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK));
    }
    return btoa(s);
  }

  // extension/offscreen/src/live/audio-input.js
  var SILENCE_RMS_THRESHOLD = 0.012;
  var SILENT_FRAMES_TO_END = 10;
  function createMicCapture({ onAudio, onSpeechStart, onSpeechEnd }) {
    let audioCtx = null;
    let stream = null;
    let source = null;
    let workletNode = null;
    let speechActive = false;
    let silentFrames = 0;
    let running = false;
    async function start() {
      if (running)
        return;
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      audioCtx = new AudioContext();
      if (audioCtx.state === "suspended")
        await audioCtx.resume();
      const url = chrome.runtime.getURL("offscreen/pcm-processor.js");
      await audioCtx.audioWorklet.addModule(url);
      source = audioCtx.createMediaStreamSource(stream);
      workletNode = new AudioWorkletNode(audioCtx, "pcm-processor", {
        processorOptions: { inputSampleRate: audioCtx.sampleRate }
      });
      workletNode.port.onmessage = (e) => {
        const buffer = e.data;
        onAudio?.(buffer);
        const int16 = new Int16Array(buffer);
        let sumSquares = 0;
        for (let i = 0; i < int16.length; i++) {
          const sample = int16[i] / 32768;
          sumSquares += sample * sample;
        }
        const rms = Math.sqrt(sumSquares / int16.length);
        const isSpeech = rms >= SILENCE_RMS_THRESHOLD;
        if (isSpeech) {
          silentFrames = 0;
          if (!speechActive) {
            speechActive = true;
            onSpeechStart?.();
          }
        } else {
          silentFrames++;
          if (speechActive && silentFrames >= SILENT_FRAMES_TO_END) {
            speechActive = false;
            onSpeechEnd?.();
          }
        }
      };
      workletNode.onprocessorerror = stop;
      stream.getAudioTracks().forEach((t) => {
        t.onended = stop;
      });
      source.connect(workletNode);
      workletNode.connect(audioCtx.destination);
      running = true;
    }
    function stop() {
      if (!running)
        return;
      try {
        workletNode?.disconnect();
      } catch {
      }
      try {
        source?.disconnect();
      } catch {
      }
      stream?.getTracks().forEach((t) => t.stop());
      if (audioCtx && audioCtx.state !== "closed") {
        audioCtx.close().catch(() => {
        });
      }
      workletNode = null;
      source = null;
      stream = null;
      audioCtx = null;
      if (speechActive) {
        speechActive = false;
        onSpeechEnd?.();
      }
      silentFrames = 0;
      running = false;
    }
    return {
      start,
      stop,
      isRunning: () => running
    };
  }

  // extension/offscreen/src/live/audio-output.js
  function createAudioPlayer({ sampleRate = 24e3 } = {}) {
    let ctx = null;
    let nextPlayTime = 0;
    const activeSources = /* @__PURE__ */ new Set();
    let onIdle = null;
    async function ensureCtx() {
      if (!ctx || ctx.state === "closed") {
        ctx = new AudioContext({ sampleRate });
        nextPlayTime = ctx.currentTime;
      }
      if (ctx.state === "suspended") {
        try {
          await ctx.resume();
        } catch {
        }
      }
      return ctx;
    }
    function _b64ToBytes(b64) {
      const norm = b64.replace(/-/g, "+").replace(/_/g, "/");
      const padded = norm.length % 4 ? norm.padEnd(norm.length + (4 - norm.length % 4), "=") : norm;
      const raw = atob(padded);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++)
        bytes[i] = raw.charCodeAt(i);
      return bytes;
    }
    async function enqueue(base64Pcm, mimeRate) {
      const c = await ensureCtx();
      const bytes = _b64ToBytes(base64Pcm);
      const byteLen = bytes.length - bytes.length % 2;
      if (!byteLen)
        return;
      const int16 = new Int16Array(bytes.buffer, bytes.byteOffset, byteLen / 2);
      const float32 = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++)
        float32[i] = int16[i] / 32768;
      const rate = Number(mimeRate) || sampleRate;
      const buffer = c.createBuffer(1, float32.length, rate);
      buffer.copyToChannel(float32, 0);
      const src = c.createBufferSource();
      src.buffer = buffer;
      src.connect(c.destination);
      activeSources.add(src);
      src.onended = () => {
        activeSources.delete(src);
        if (activeSources.size === 0 && onIdle) {
          const cb = onIdle;
          setTimeout(() => {
            if (activeSources.size === 0)
              cb();
          }, 0);
        }
      };
      const startAt = Math.max(nextPlayTime, c.currentTime);
      src.start(startAt);
      nextPlayTime = startAt + buffer.duration;
    }
    function flush() {
      for (const s of activeSources) {
        try {
          s.stop();
        } catch {
        }
        try {
          s.disconnect();
        } catch {
        }
      }
      activeSources.clear();
      if (ctx && ctx.state !== "closed")
        nextPlayTime = ctx.currentTime;
      if (onIdle)
        onIdle();
    }
    function close() {
      flush();
      if (ctx && ctx.state !== "closed")
        ctx.close().catch(() => {
        });
      ctx = null;
    }
    return {
      enqueue,
      flush,
      close,
      isPlaying: () => activeSources.size > 0,
      setOnIdle: (fn) => {
        onIdle = fn;
      }
    };
  }

  // extension/offscreen/src/bridge/agent-bridge.js
  var NOTABLE_LOG_KINDS = /* @__PURE__ */ new Set(["action"]);
  var NOISY_ACTIONS = /* @__PURE__ */ new Set([
    "wait",
    "wait_for_element",
    "wait_for_network_idle",
    "browser_screenshot",
    "browser_read_page",
    "browser_list_tabs"
  ]);
  var MAJOR_ACTIONS = /* @__PURE__ */ new Set([
    "navigate",
    "go_back",
    "go_forward",
    "refresh",
    "open_tab",
    "switch_tab",
    "close_tab"
  ]);
  function _isMajor(event) {
    if (event.kind === "status")
      return true;
    if (event.kind === "log") {
      if (event.logKind === "action" && MAJOR_ACTIONS.has(event.action))
        return true;
    }
    return false;
  }
  var LAST_SEEN_KEY = "voiceBridgeLastSeen";
  var CATCHUP_MAX_AGE_MS = 60 * 60 * 1e3;
  var CATCHUP_MAX_ENTRIES = 8;
  var WRITE_DEBOUNCE_MS2 = 500;
  function createAgentBridge({ onEvent }) {
    let lastSnapshot = null;
    let installed = false;
    let lastEmittedT = 0;
    let writeTimer = null;
    let unsubscribe = null;
    function _persistLastSeen(t) {
      if (!t)
        return;
      lastEmittedT = Math.max(lastEmittedT, t);
      if (writeTimer)
        clearTimeout(writeTimer);
      writeTimer = setTimeout(() => {
        writeTimer = null;
        set("local", { [LAST_SEEN_KEY]: lastEmittedT });
      }, WRITE_DEBOUNCE_MS2);
    }
    function _emit(evt) {
      const major = _isMajor(evt);
      console.log("[voice] bridge emit:", evt.kind, evt.logKind || evt.status || "", evt.action || "", "(major=" + major + ")");
      onEvent({ ...evt, major });
    }
    function _listener(changes, area) {
      if (area !== "local" || !changes.bhAgent)
        return;
      console.log("[voice] bridge sees bhAgent change");
      const next = changes.bhAgent.newValue || null;
      const prev = lastSnapshot;
      lastSnapshot = next;
      if (!next)
        return;
      _diff(prev, next);
    }
    function _diff(prev, next) {
      if (!prev || prev.status !== next.status) {
        _emit({
          kind: "status",
          prev: prev ? prev.status : null,
          status: next.status,
          task: next.task,
          summary: next.summary || null,
          error: next.error || null,
          // Status flips don't have a stored timestamp -- use now.
          // This is the real "when it happened" since the storage
          // change just fired, modulo a few ms of relay latency.
          ts: Date.now()
        });
      }
      const prevLog = prev && prev.log || [];
      const nextLog = next.log || [];
      if (!nextLog.length)
        return;
      const anchorT = prevLog.length ? prevLog[prevLog.length - 1].t : lastEmittedT;
      let i = nextLog.length - 1;
      while (i >= 0 && nextLog[i].t > anchorT)
        i--;
      const newEntries = nextLog.slice(i + 1);
      for (const e of newEntries) {
        _maybeEmitLog(e);
      }
    }
    function _maybeEmitLog(e) {
      if (!NOTABLE_LOG_KINDS.has(e.kind))
        return;
      if (e.kind === "action" && NOISY_ACTIONS.has(e.action))
        return;
      _emit({ kind: "log", logKind: e.kind, action: e.action, text: e.text, ts: e.t });
      _persistLastSeen(e.t || Date.now());
    }
    async function _replayCatchUp(cur) {
      const data = await get("local", LAST_SEEN_KEY);
      const lastSeen = data[LAST_SEEN_KEY] || 0;
      lastEmittedT = lastSeen;
      if (!cur || !Array.isArray(cur.log) || !cur.log.length)
        return;
      const now = Date.now();
      const cutoff = Math.max(lastSeen, now - CATCHUP_MAX_AGE_MS);
      const fresh = cur.log.filter((e) => e && e.t > cutoff).filter((e) => NOTABLE_LOG_KINDS.has(e.kind)).filter((e) => !(e.kind === "action" && NOISY_ACTIONS.has(e.action)));
      if (!fresh.length)
        return;
      const slice = fresh.slice(-CATCHUP_MAX_ENTRIES);
      for (const e of slice) {
        _emit({ kind: "log", logKind: e.kind, action: e.action, text: e.text, ts: e.t, catchup: true });
      }
      _persistLastSeen(slice[slice.length - 1].t || now);
    }
    async function start() {
      if (installed)
        return;
      unsubscribe = onChanged(_listener);
      installed = true;
      try {
        const data = await get("local", "bhAgent");
        const cur = data.bhAgent || null;
        lastSnapshot = cur;
        await _replayCatchUp(cur);
        if (cur && cur.status === "running") {
          _emit({ kind: "status", status: cur.status, task: cur.task });
        }
      } catch (e) {
        console.warn("[bridge] prime failed", e);
      }
    }
    function stop() {
      if (!installed)
        return;
      if (typeof unsubscribe === "function") {
        try {
          unsubscribe();
        } catch {
        }
        unsubscribe = null;
      }
      if (writeTimer) {
        clearTimeout(writeTimer);
        writeTimer = null;
      }
      installed = false;
      lastSnapshot = null;
    }
    return { start, stop };
  }

  // extension/offscreen/src/bridge/event-router.js
  var SILENT_WAIT_MS = 400;
  var MINOR_FLUSH_MS = 7e3;
  var MAX_DEFER_MS = 12e3;
  function createEventRouter({
    sendTextTurn,
    isUserSpeaking,
    isModelSpeaking,
    onMajorBubble
    // ({summary, details, ts}) -- transcript event entry
  }) {
    let minorBuffer = [];
    let pendingMajor = [];
    let flushTimer = null;
    let minorFlushTimer = null;
    function ingest(event) {
      if (!event)
        return;
      console.log("[voice] router ingest:", event.kind, event.logKind || event.status || "", event.action || "", "(major=" + !!event.major + ")");
      if (event.major) {
        pendingMajor.push({
          event,
          minors: minorBuffer.slice(),
          queuedAt: Date.now()
        });
        minorBuffer = [];
        if (minorFlushTimer) {
          clearTimeout(minorFlushTimer);
          minorFlushTimer = null;
        }
        _scheduleFlush();
        return;
      }
      minorBuffer.push(event);
      if (minorFlushTimer)
        clearTimeout(minorFlushTimer);
      minorFlushTimer = setTimeout(_synthesizeProgress, MINOR_FLUSH_MS);
    }
    function _synthesizeProgress() {
      minorFlushTimer = null;
      if (!minorBuffer.length)
        return;
      const last = minorBuffer[minorBuffer.length - 1];
      const synthetic = {
        kind: "progress",
        text: _phraseProgress(minorBuffer),
        ts: last && last.ts || Date.now(),
        _lastAction: last && last.action
      };
      pendingMajor.push({
        event: synthetic,
        minors: minorBuffer.slice(),
        queuedAt: Date.now()
      });
      minorBuffer = [];
      _scheduleFlush();
    }
    function flushNow() {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      if (minorFlushTimer) {
        clearTimeout(minorFlushTimer);
        minorFlushTimer = null;
      }
      if (minorBuffer.length) {
        _synthesizeProgress();
      }
      while (pendingMajor.length)
        _emitOne(pendingMajor.shift());
    }
    function _scheduleFlush() {
      if (flushTimer)
        return;
      flushTimer = setTimeout(_tryFlush, SILENT_WAIT_MS);
    }
    function _tryFlush() {
      flushTimer = null;
      if (!pendingMajor.length)
        return;
      const head = pendingMajor[0];
      const overBudget = head && head.queuedAt && Date.now() - head.queuedAt > MAX_DEFER_MS;
      if (!overBudget) {
        if (isUserSpeaking?.()) {
          flushTimer = setTimeout(_tryFlush, SILENT_WAIT_MS);
          return;
        }
        if (isModelSpeaking?.()) {
          flushTimer = setTimeout(_tryFlush, SILENT_WAIT_MS);
          return;
        }
      } else {
        console.log(`[voice] router force-flush ${pendingMajor.length} events (over ${MAX_DEFER_MS}ms defer budget)`);
      }
      while (pendingMajor.length)
        _emitOne(pendingMajor.shift());
    }
    function _emitOne({ event, minors }) {
      const summary = event.kind === "progress" ? event.text : _phraseMajor(event);
      if (!summary)
        return;
      const ts = event.ts || Date.now();
      console.log("[voice] router emit bubble:", summary, "ts=", new Date(ts).toLocaleTimeString());
      onMajorBubble?.({
        summary,
        details: _detailLines(event, minors),
        ts
      });
      let text = `[Browser update] ${summary}`;
      if (event.catchup) {
        text = `[Browser update] Catch-up since you were last here: ${summary}`;
      }
      if (minors.length) {
        const ctx = minors.map(_phraseMinor).filter(Boolean).slice(-5).join(" \xB7 ");
        if (ctx)
          text += ` (recent activity: ${ctx})`;
      }
      sendTextTurn(text, { role: "user", turnComplete: true });
    }
    return { ingest, flushNow };
  }
  function _phraseMajor(event) {
    if (event.kind === "status") {
      if (event.status === "running") {
        return event.task ? `Started task: ${event.task}` : "Task started";
      }
      if (event.status === "done") {
        return event.summary ? `Task done: ${event.summary}` : "Task done";
      }
      if (event.status === "error") {
        return event.error ? `Task error: ${event.error}` : "Task errored";
      }
      if (event.status === "stopped")
        return "Task stopped";
      return null;
    }
    if (event.kind === "log") {
      if (event.logKind === "error")
        return `Error: ${event.text || ""}`.trim();
      if (event.logKind === "done")
        return event.text || "Done";
      if (event.logKind === "action") {
        switch (event.action) {
          case "navigate":
            return `Navigating: ${event.text || ""}`.trim();
          case "go_back":
            return "Went back";
          case "go_forward":
            return "Went forward";
          case "refresh":
            return "Refreshed page";
          case "open_tab":
            return `Opened tab: ${event.text || ""}`.trim();
          case "switch_tab":
            return `Switched tab: ${event.text || ""}`.trim();
          case "close_tab":
            return "Closed tab";
          case "done":
            return event.text || "Done";
          default:
            return event.text || event.action || "Action";
        }
      }
    }
    return null;
  }
  function _phraseProgress(minors) {
    const last = minors[minors.length - 1];
    if (!last)
      return "Progress";
    if (last.kind === "log") {
      if (last.action) {
        const verb = _verbForAction(last.action);
        return verb || `${last.action}: ${last.text || ""}`.trim();
      }
      return last.text || "Progress";
    }
    return "Progress";
  }
  function _verbForAction(action) {
    switch (action) {
      case "click_index":
      case "click":
        return "Clicking";
      case "type_index":
      case "type":
        return "Typing";
      case "fill_input":
        return "Filling input";
      case "press_key":
        return "Pressing key";
      case "scroll":
        return "Scrolling";
      case "select_dropdown":
        return "Selecting option";
      case "dropdown_options":
        return "Reading dropdown";
      case "upload_file":
        return "Uploading file";
      case "handle_dialog":
        return "Handling dialog";
      case "js":
        return "Reading page";
      case "read_skill":
      case "write_skill":
        return "Loading playbook";
      default:
        return null;
    }
  }
  function _phraseMinor(event) {
    if (event.kind === "log") {
      return event.text || event.action || event.logKind;
    }
    if (event.kind === "status")
      return `status -> ${event.status}`;
    return null;
  }
  function _detailLines(major, minors) {
    const rows = [];
    rows.push({
      when: "now",
      kind: major.kind,
      sub: major.logKind || major.status || "",
      action: major.action || "",
      text: _phraseMajor(major) || ""
    });
    for (let i = minors.length - 1; i >= 0; i--) {
      const m = minors[i];
      rows.push({
        when: "",
        kind: m.kind,
        sub: m.logKind || m.status || "",
        action: m.action || "",
        text: _phraseMinor(m) || ""
      });
    }
    return rows;
  }

  // extension/offscreen/src/state.js
  var STATE_KEY = "voiceState";
  var TRANSCRIPT_LIMIT = 200;
  var _state = {
    connection: "disconnected",
    // 'disconnected' | 'connecting' | 'live' | 'error'
    recording: false,
    speaking: false,
    // model audio playing
    micActivity: false,
    // user speech detected by RMS
    transcript: [],
    // [{role:'user'|'agent', text, ts, partial?}]
    backgroundMode: false,
    // user toggle: keep voice alive while panel closed
    error: null
  };
  function _writeStorage(payload) {
    set("local", payload);
  }
  function _broadcastState() {
    try {
      chrome.runtime.sendMessage({
        type: "voiceState",
        state: {
          connection: _state.connection,
          recording: _state.recording,
          speaking: _state.speaking,
          micActivity: _state.micActivity,
          backgroundMode: _state.backgroundMode,
          error: _state.error
        }
      }).catch(() => {
      });
    } catch {
    }
  }
  function _persist() {
    _broadcastState();
    _writeStorage({
      [STATE_KEY]: {
        connection: _state.connection,
        recording: _state.recording,
        speaking: _state.speaking,
        backgroundMode: _state.backgroundMode,
        error: _state.error,
        transcript: _state.transcript.slice(-TRANSCRIPT_LIMIT)
      }
    });
  }
  function get2() {
    return { ..._state, transcript: _state.transcript.slice() };
  }
  function setConnection(s) {
    _state.connection = s;
    _persist();
  }
  function setRecording(b) {
    _state.recording = !!b;
    _persist();
  }
  function setSpeaking(b) {
    _state.speaking = !!b;
    _persist();
  }
  function setMicActivity(b) {
    _state.micActivity = !!b;
    _persist();
  }
  function setBackgroundMode(b) {
    _state.backgroundMode = !!b;
    _persist();
  }
  function setError(msg) {
    _state.error = msg || null;
    _persist();
  }
  function appendEvent({ summary, details, ts }) {
    const entry = {
      role: "event",
      text: summary || "",
      details: Array.isArray(details) ? details : [],
      ts: ts || Date.now()
    };
    _state.transcript.push(entry);
    while (_state.transcript.length > TRANSCRIPT_LIMIT)
      _state.transcript.shift();
    try {
      chrome.runtime.sendMessage({
        type: "voiceTranscript",
        delta: { role: entry.role, text: entry.text, details: entry.details, finished: true, ts: entry.ts }
      }).catch(() => {
      });
    } catch {
    }
    _writeStorage({
      [STATE_KEY]: {
        connection: _state.connection,
        recording: _state.recording,
        speaking: _state.speaking,
        backgroundMode: _state.backgroundMode,
        error: _state.error,
        transcript: _state.transcript.slice(-TRANSCRIPT_LIMIT)
      }
    });
  }
  function appendTranscript({ role, text, finished }) {
    if (!text)
      return;
    const last = _state.transcript[_state.transcript.length - 1];
    if (last && last.role === role && last.partial) {
      if (text.startsWith(last.text) && text.length >= last.text.length) {
        last.text = text;
      } else {
        last.text += text;
      }
      if (finished)
        last.partial = false;
    } else {
      _state.transcript.push({
        role,
        text,
        ts: Date.now(),
        partial: !finished
      });
    }
    while (_state.transcript.length > TRANSCRIPT_LIMIT)
      _state.transcript.shift();
    try {
      chrome.runtime.sendMessage({
        type: "voiceTranscript",
        delta: { role, text, finished: !!finished, ts: Date.now() }
      }).catch(() => {
      });
    } catch {
    }
    _writeStorage({
      [STATE_KEY]: {
        connection: _state.connection,
        recording: _state.recording,
        speaking: _state.speaking,
        backgroundMode: _state.backgroundMode,
        error: _state.error,
        transcript: _state.transcript.slice(-TRANSCRIPT_LIMIT)
      }
    });
  }
  function clearTranscript() {
    _state.transcript = [];
    _persist();
  }

  // extension/offscreen/src/index.js
  var SETUP_TIMEOUT_MS = 15e3;
  var live = null;
  var setupTimer = null;
  var lastAudioChunkAt = 0;
  var SPEAKING_GRACE_MS = 1500;
  var player = createAudioPlayer({ sampleRate: 24e3 });
  player.setOnIdle(() => {
    console.log("[voice] player idle (was speaking=", get2().speaking, ")");
    if (get2().speaking) {
      setSpeaking(false);
    }
  });
  var mic = createMicCapture({
    onAudio: (buf) => live?.sendAudioChunk(buf),
    onSpeechStart: () => {
      setMicActivity(true);
      player.flush();
      setSpeaking(false);
    },
    onSpeechEnd: () => {
      setMicActivity(false);
    }
  });
  var router = createEventRouter({
    sendTextTurn: (text, opts) => live?.sendTextTurn(text, opts),
    isUserSpeaking: () => get2().micActivity,
    isModelSpeaking: () => {
      if (player.isPlaying())
        return true;
      return Date.now() - lastAudioChunkAt < SPEAKING_GRACE_MS;
    },
    // Each major bridge event -> one transcript bubble with expandable
    // details. The agent's spoken narration of that event lands as a
    // separate "agent" bubble immediately after.
    onMajorBubble: (entry) => appendEvent(entry)
  });
  var bridge = createAgentBridge({
    onEvent: (e) => {
      router.ingest(e);
      if (e.kind === "status" && (e.status === "done" || e.status === "error" || e.status === "stopped")) {
        router.flushNow();
      }
    }
  });
  async function connect() {
    if (live && live.isOpen())
      return;
    setConnection("connecting");
    setError(null);
    const apiKey = await _getApiKey();
    if (!apiKey) {
      setConnection("error");
      setError("Gemini API key not set. Open the popup \u2192 AI keys to add one.");
      return;
    }
    const model = await _getModel();
    if (setupTimer)
      clearTimeout(setupTimer);
    setupTimer = setTimeout(() => {
      setupTimer = null;
      if (get2().connection === "connecting") {
        setConnection("error");
        setError("Connection timed out before setup completed. Check API key and network, then try again.");
        try {
          live?.close();
        } catch {
        }
        live = null;
      }
    }, SETUP_TIMEOUT_MS);
    live = createLiveClient({
      apiKey,
      model,
      onAudio: (b64, rate) => {
        if (Date.now() - lastAudioChunkAt > SPEAKING_GRACE_MS) {
          console.log("[voice] turn START");
        }
        lastAudioChunkAt = Date.now();
        setSpeaking(true);
        player.enqueue(b64, rate).catch((err) => {
          console.warn("[voice] enqueue failed", err);
        });
      },
      onInterrupted: () => {
        console.log("[voice] turn INTERRUPTED");
        player.flush();
        setSpeaking(false);
      },
      onTurnComplete: () => {
        console.log("[voice] turn COMPLETE");
        if (!player.isPlaying())
          setSpeaking(false);
      },
      onInputTranscript: (t) => {
        console.log("[voice] input transcript chunk:", JSON.stringify({ text: t.text || "", finished: !!t.finished }).slice(0, 200));
        appendTranscript({ role: "user", text: t.text || "", finished: t.finished });
      },
      onOutputTranscript: (t) => {
        appendTranscript({ role: "agent", text: t.text || "", finished: t.finished });
      },
      onToolCall: async (fc) => {
        return await dispatchToolCall(fc.name, fc.args || {});
      },
      onToolCallCancellation: () => {
      },
      onGoAway: ({ timeLeft }) => {
        console.log("[voice] goAway, time_left=", timeLeft);
        setConnection("connecting");
        try {
          live?.close();
        } catch {
        }
        live = null;
        setTimeout(() => connect().catch((e) => {
          setConnection("error");
          setError(`reconnect failed: ${e.message || e}`);
        }), 250);
      },
      onSetupComplete: () => {
        if (setupTimer) {
          clearTimeout(setupTimer);
          setupTimer = null;
        }
        setConnection("live");
        bridge.start();
        mic.start().catch((err) => {
          setError(`mic: ${err.message || err}`);
        });
        setRecording(true);
      },
      onError: (msg) => {
        console.warn("[voice]", msg);
        if (!/^ws closed/.test(msg))
          return;
        if (setupTimer) {
          clearTimeout(setupTimer);
          setupTimer = null;
        }
        if (/code=4\d{3}/.test(msg)) {
          clearHandle();
          const expired = /handle/i.test(msg) || /resum/i.test(msg);
          setError(expired ? "Previous session couldn't resume \u2014 press Start again to begin a fresh one." : msg);
        } else {
          setError(msg);
        }
        setConnection("error");
      }
    });
    live.connect();
  }
  async function disconnect() {
    bridge.stop();
    mic.stop();
    player.flush();
    if (live) {
      try {
        live.close();
      } catch {
      }
      live = null;
    }
    setConnection("disconnected");
    setRecording(false);
    setSpeaking(false);
  }
  async function restart() {
    bridge.stop();
    mic.stop();
    player.flush();
    if (live) {
      try {
        live.close();
      } catch {
      }
      live = null;
    }
    await clearHandle();
    clearTranscript();
    setError(null);
    setRecording(false);
    setSpeaking(false);
    try {
      await set("local", { voiceBridgeLastSeen: Date.now() });
    } catch {
    }
    await connect();
  }
  async function _getApiKey() {
    const data = await get("sync", ["geminiApiKey", "geminiKey"]);
    return data.geminiApiKey || data.geminiKey || null;
  }
  async function _getModel() {
    const data = await get("sync", ["voiceModel"]);
    return data.voiceModel || "gemini-3.1-flash-live-preview";
  }
  var OFFSCREEN_MSG_TYPES = /* @__PURE__ */ new Set([
    "voicePing",
    "voiceConnect",
    "voiceDisconnect",
    "voiceRestart",
    "voiceMicToggle",
    "voiceBackgroundMode",
    "voiceClearTranscript"
  ]);
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || typeof msg.type !== "string")
      return;
    if (!OFFSCREEN_MSG_TYPES.has(msg.type))
      return;
    (async () => {
      try {
        switch (msg.type) {
          case "voicePing":
            sendResponse({ ok: true, state: get2() });
            break;
          case "voiceConnect":
            await connect();
            sendResponse({ ok: true });
            break;
          case "voiceDisconnect":
            await disconnect();
            sendResponse({ ok: true });
            break;
          case "voiceRestart":
            await restart();
            sendResponse({ ok: true });
            break;
          case "voiceMicToggle":
            if (mic.isRunning()) {
              mic.stop();
              setRecording(false);
            } else {
              await mic.start();
              setRecording(true);
            }
            sendResponse({ ok: true, recording: mic.isRunning() });
            break;
          case "voiceBackgroundMode":
            setBackgroundMode(!!msg.enabled);
            await set("local", { voiceBackgroundMode: !!msg.enabled });
            sendResponse({ ok: true });
            break;
          case "voiceClearTranscript":
            clearTranscript();
            sendResponse({ ok: true });
            break;
        }
      } catch (e) {
        console.error(`[voice] ${msg.type} handler threw:`, e);
        sendResponse({
          error: e && e.message || String(e),
          stack: e && e.stack ? String(e.stack) : null
        });
      }
    })();
    return true;
  });
  chrome.runtime.sendMessage({ type: "voiceHello" }).catch(() => {
  });
})();
