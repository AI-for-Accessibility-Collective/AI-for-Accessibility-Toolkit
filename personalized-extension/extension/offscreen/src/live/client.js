// Direct WebSocket client for the Gemini Live API. We talk JSON-over-WS
// rather than going through google-genai (Python-only). The wire shape
// mirrors the proto definitions surfaced by the SDK (see voicecontrol's
// research notes).
//
// Lifecycle:
//   connect()  -> open WS, send setup (model, tools, transcription,
//                 session_resumption, context_window_compression)
//   recv loop  -> dispatch serverContent / toolCall / toolCallCancellation
//                 / sessionResumptionUpdate / goAway
//   sendAudio  -> realtimeInput.audio (base64 16kHz Int16 PCM)
//   sendText   -> clientContent.turns (used only for [Browser update]
//                 system injections, not user voice)
//   sendToolResponse -> toolResponse.functionResponses (echoes id)
//   close()    -> WS.close(); on abnormal close + cached handle, the
//                 outer reconnect loop reopens with handle preserved.
//
// Best-practice notes baked in:
//   - Server VAD on by default (no automaticActivityDetection block sent).
//   - sessionResumption.transparent so server includes
//     last_consumed_client_message_index in updates.
//   - contextWindowCompression for long sessions.
//   - input + output audio transcription enabled for UI captions.
//   - Don't mix realtimeInput (audio) and clientContent (text) for the
//     same logical turn; clientContent is only for out-of-band injections.

import { TOOL_DECLARATIONS } from './tools.js';
import { SYSTEM_INSTRUCTION } from './prompt.js';
import { getHandle, consumeUpdate, clearHandle, loadHandle } from './session.js';

const LIVE_WS_BASE =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

const DEFAULT_MODEL = 'gemini-3.1-flash-live-preview';

export function createLiveClient({
  apiKey,
  model = DEFAULT_MODEL,
  onAudio,                  // (base64Pcm, mimeRate) -- model audio chunk
  onInputTranscript,        // ({text, finished}) -- user speech transcript
  onOutputTranscript,       // ({text, finished}) -- model speech transcript
  onInterrupted,            // () -- server says user barged in
  onTurnComplete,           // () -- model finished a turn
  onToolCall,               // ({id, name, args}) -- async; resolve with response object
  onToolCallCancellation,   // ([id, ...]) -- abort matching in-flight tool calls
  onGoAway,                 // ({timeLeft}) -- server about to close; reconnect with handle
  onError,                  // (msg)
  onOpen,                   // () -- WS handshake done (NOT setupComplete)
  onSetupComplete,          // ()
}) {
  if (!apiKey) throw new Error('live: apiKey required');

  let ws = null;
  let closed = false;
  // Pending tool tasks keyed by function-call id, so toolCallCancellation
  // can abort them in flight.
  const pendingTools = new Map(); // id -> AbortController

  function _send(obj) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(obj));
    return true;
  }

  async function connect() {
    if (closed) return;
    // Hydrate the in-memory resumption handle from chrome.storage before
    // we build the setup message. Without this, every offscreen-page
    // teardown loses the handle even though the server may still hold
    // session state for it.
    await loadHandle();
    const url = `${LIVE_WS_BASE}?key=${encodeURIComponent(apiKey)}`;
    ws = new WebSocket(url);

    ws.onopen = () => {
      onOpen?.();
      const setup = {
        setup: {
          model: model.startsWith('models/') ? model : `models/${model}`,
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: 'Charon' },
              },
            },
          },
          systemInstruction: {
            parts: [{ text: SYSTEM_INSTRUCTION }],
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
            triggerTokens: '25600',
            slidingWindow: { targetTokens: '12800' },
          },
        },
      };
      _send(setup);
    };

    ws.onmessage = async (evt) => {
      let msg;
      try {
        // Server sends both binary frames (rare) and text frames; current
        // protocol uses text JSON exclusively for our config.
        const text = typeof evt.data === 'string'
          ? evt.data
          : await evt.data.text();
        msg = JSON.parse(text);
      } catch (e) {
        onError?.(`recv parse failed: ${e.message}`);
        return;
      }
      await _handleMessage(msg);
    };

    ws.onerror = (e) => {
      // Browsers don't surface useful error info on WS errors; log only.
      console.warn('[live] ws error', e);
    };

    ws.onclose = (evt) => {
      // Suppress the onError for closes we initiated ourselves (Restart /
      // disconnect calls close() which sets `closed = true` before issuing
      // ws.close(1000)). The native onclose still fires asynchronously --
      // without this guard the UI would show "ws closed code=1000" every
      // restart even though the close was intentional.
      if (closed) return;
      // Surface the close so the outer driver can update UI state and
      // decide on reconnect. Pretty-print common codes so the user sees
      // an actionable message instead of a raw frame number.
      const explained = _explainClose(evt.code, evt.reason);
      onError?.(`ws closed code=${evt.code} reason=${evt.reason || ''}${explained ? ' (' + explained + ')' : ''}`);
    };
  }

  async function _handleMessage(msg) {
    if (msg.setupComplete) {
      onSetupComplete?.();
      return;
    }
    if (msg.serverContent) {
      const sc = msg.serverContent;
      if (sc.interrupted) onInterrupted?.();
      // modelTurn.parts may carry inlineData (audio) and/or text. We only
      // surface audio here; text answers come via outputTranscription.
      const parts = sc.modelTurn?.parts || [];
      for (const p of parts) {
        const inline = p.inlineData;
        if (inline?.data && (inline.mimeType || '').startsWith('audio/')) {
          const m = /rate=(\d+)/i.exec(inline.mimeType || '');
          onAudio?.(inline.data, m ? Number(m[1]) : 24000);
        }
      }
      if (sc.inputTranscription) onInputTranscript?.(sc.inputTranscription);
      if (sc.outputTranscription) onOutputTranscript?.(sc.outputTranscription);
      if (sc.turnComplete) onTurnComplete?.();
      return;
    }
    if (msg.toolCall) {
      const calls = msg.toolCall.functionCalls || [];
      for (const fc of calls) {
        const ac = new AbortController();
        pendingTools.set(fc.id, ac);
        // Run handler with abort signal so cancellation can preempt long
        // tool work. dispatchToolCall is short -- this is mostly future-
        // proofing.
        Promise.resolve()
          .then(() => onToolCall?.(fc, ac.signal))
          .then((response) => {
            if (ac.signal.aborted) return; // canceled in flight
            pendingTools.delete(fc.id);
            sendToolResponse(fc.id, fc.name, response || {});
          })
          .catch((err) => {
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
        if (ac) { ac.abort(); pendingTools.delete(id); }
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

  // ---- send paths ----------------------------------------------------

  function sendAudioChunk(int16ArrayBuffer) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const u8 = new Uint8Array(int16ArrayBuffer);
    const b64 = _bytesToBase64(u8);
    _send({
      realtimeInput: {
        audio: { data: b64, mimeType: 'audio/pcm;rate=16000' },
      },
    });
  }

  // Out-of-band text injection -- used by the bridge to push
  // [Browser update] notes when the user is silent. clientContent.turns
  // with role=user + turnComplete=true behaves like a quiet user remark
  // the model can choose to react to. Avoid mixing with realtime audio
  // mid-turn (call only when user is silent).
  function sendTextTurn(text, { role = 'user', turnComplete = true } = {}) {
    if (!text) return;
    _send({
      clientContent: {
        turns: [{ role, parts: [{ text }] }],
        turnComplete,
      },
    });
  }

  function sendToolResponse(id, name, response) {
    _send({
      toolResponse: {
        functionResponses: [{ id, name, response }],
      },
    });
  }

  function close() {
    closed = true;
    pendingTools.forEach((ac) => { try { ac.abort(); } catch {} });
    pendingTools.clear();
    if (ws) {
      try { ws.close(1000, 'client closing'); } catch {}
      ws = null;
    }
  }

  function isOpen() { return !!ws && ws.readyState === WebSocket.OPEN; }

  return {
    connect, close, isOpen,
    sendAudioChunk, sendTextTurn, sendToolResponse,
    // Exposed for the driver to clear handle on auth failures so a fresh
    // session is opened next time.
    clearHandle,
  };
}

function _explainClose(code, reason) {
  if (code === 1000 || code === 1001) return null; // normal closures
  if (code === 1006) return 'connection lost (network or server unavailable)';
  if (code === 1007) return 'protocol error -- check setup payload';
  if (code === 1011) return 'server internal error';
  if (code >= 4000 && code < 5000) {
    // 4xxx range = application-level rejections. Anthropic/Google may
    // surface human-readable reasons here; bubble them up verbatim.
    return reason || `server rejected the session (${code})`;
  }
  return reason || `close code ${code}`;
}

function _bytesToBase64(u8) {
  // btoa needs a binary string; build one in chunks to avoid the call-stack
  // limit on very large buffers.
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < u8.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK));
  }
  return btoa(s);
}
