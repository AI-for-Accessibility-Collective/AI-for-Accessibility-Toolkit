// Microphone capture + AudioWorklet driver + client-side speech detector.
// Posts 50 ms of 16 kHz Int16 PCM (1600 bytes) per frame; caller sends
// each frame to Gemini as a realtime audio Blob.
//
// onSpeechStart fires the first time RMS crosses SILENCE_RMS_THRESHOLD
// after a quiet period; it's the barge-in signal -- the playback queue
// flushes immediately so the user doesn't hear themselves talked over.

const SILENCE_RMS_THRESHOLD = 0.012;
// How many consecutive silent frames (each ~50ms) before we declare
// speech-end. ~10 frames = ~500ms of silence, matches server VAD's
// typical end-of-speech threshold and keeps the "Listening..."
// indicator from flickering on natural pauses within an utterance.
const SILENT_FRAMES_TO_END = 10;

export function createMicCapture({ onAudio, onSpeechStart, onSpeechEnd }) {
  let audioCtx = null;
  let stream = null;
  let source = null;
  let workletNode = null;
  let speechActive = false;
  let silentFrames = 0;
  let running = false;

  async function start() {
    if (running) return;
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    audioCtx = new AudioContext();
    if (audioCtx.state === 'suspended') await audioCtx.resume();

    // The AudioWorklet ships as a separate file (extension/offscreen/
    // pcm-processor.js) because esbuild can't bundle worklet code into
    // the main page bundle -- worklets execute in their own realm and
    // load via URL. chrome.runtime.getURL gives us an extension://-
    // scheme URL the AudioContext can fetch.
    const url = chrome.runtime.getURL('offscreen/pcm-processor.js');
    await audioCtx.audioWorklet.addModule(url);

    source = audioCtx.createMediaStreamSource(stream);
    workletNode = new AudioWorkletNode(audioCtx, 'pcm-processor', {
      processorOptions: { inputSampleRate: audioCtx.sampleRate },
    });

    workletNode.port.onmessage = (e) => {
      const buffer = e.data;
      onAudio?.(buffer);

      // RMS for barge-in. Single threshold with no hysteresis; flickers
      // are harmless because onSpeechStart is idempotent (the playback
      // queue is already empty after the first call).
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
    stream.getAudioTracks().forEach((t) => { t.onended = stop; });

    source.connect(workletNode);
    workletNode.connect(audioCtx.destination);
    running = true;
  }

  function stop() {
    if (!running) return;
    try { workletNode?.disconnect(); } catch {}
    try { source?.disconnect(); } catch {}
    stream?.getTracks().forEach((t) => t.stop());
    if (audioCtx && audioCtx.state !== 'closed') {
      audioCtx.close().catch(() => {});
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
    isRunning: () => running,
  };
}
