/**
 * AudioWorklet processor: accumulates input samples at the AudioContext's
 * sample rate, resamples to 16 kHz, and posts 800-sample (~50 ms) Int16
 * (s16le) buffers to the main thread.
 *
 *   800 samples × 2 bytes = 1600 bytes per chunk (~50 ms at 16 kHz).
 *   Gemini Live API expects 50-100 ms chunks of 16 kHz mono PCM.
 *
 * Linear interpolation is fast and good enough for speech. For lossless
 * downsampling consider a windowed-sinc filter, but the artifacts are not
 * audible in transcripts at this rate.
 *
 * Loaded by audio-input.js via audioWorklet.addModule(); resolves to
 * chrome.runtime.getURL('offscreen/pcm-processor.js') at runtime.
 */
class PCMProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const inputRate = options.processorOptions?.inputSampleRate || sampleRate;
    this._ratio = inputRate / 16000;
    this._outputSize = 800;
    this._inputNeeded = Math.ceil(this._outputSize * this._ratio);
    this._inputBuf = new Float32Array(this._inputNeeded + 128);
    this._inputOffset = 0;
  }

  _resample(inputBuf, inputLen, outputLen) {
    const ratio = inputLen / outputLen;
    const out = new Int16Array(outputLen);
    for (let i = 0; i < outputLen; i++) {
      const pos = i * ratio;
      const idx = Math.floor(pos);
      const frac = pos - idx;
      const s0 = inputBuf[idx] || 0;
      const s1 = inputBuf[Math.min(idx + 1, inputLen - 1)] || 0;
      const sample = s0 + frac * (s1 - s0);
      const clamped = Math.max(-1, Math.min(1, sample));
      out[i] = clamped * 32767;
    }
    return out;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const channelData = input[0];

    if (this._inputOffset + channelData.length > this._inputBuf.length) {
      const newBuf = new Float32Array(this._inputOffset + channelData.length + 128);
      newBuf.set(this._inputBuf.subarray(0, this._inputOffset));
      this._inputBuf = newBuf;
    }
    this._inputBuf.set(channelData, this._inputOffset);
    this._inputOffset += channelData.length;

    while (this._inputOffset >= this._inputNeeded) {
      const int16 = this._resample(this._inputBuf, this._inputNeeded, this._outputSize);
      this.port.postMessage(int16.buffer, [int16.buffer]);

      const remaining = this._inputOffset - this._inputNeeded;
      if (remaining > 0) {
        this._inputBuf.copyWithin(0, this._inputNeeded, this._inputOffset);
      }
      this._inputOffset = remaining;
    }
    return true;
  }
}

registerProcessor('pcm-processor', PCMProcessor);
