import { transcribeVideo, transcribeAudio } from '../../utils/ai.js';
import { markProcessed } from '../../utils/dom.js';

const logFix = (...a) => (globalThis.ai4a11yLogFix || (() => {}))(...a);
const incrementStat = (...a) => (globalThis.ai4a11yIncrementStat || (() => {}))(...a);

export async function generateVideoCaptions(video) {
  if (video.dataset.ai4a11yCaptioned) return null;
  video.dataset.ai4a11yCaptioned = 'pending';

  const src = video.src || video.querySelector('source')?.src;
  if (!src) {
    video.dataset.ai4a11yCaptioned = 'failed';
    return null;
  }

  try {
    const result = await transcribeVideo(src);

    if (result?.text) {
      const text = result.text;
      addCaptionTrack(video, text);
      video.dataset.ai4a11yCaptioned = 'done';
      incrementStat('wcag');
      logFix('captions', video, '(none)', '(generated)');
      console.log('[AI4A11y] Added video captions');
      return text;
    }

    video.dataset.ai4a11yCaptioned = 'failed';
    return null;
  } catch (e) {
    console.warn('[AI4A11y] Failed to caption video:', e);
    video.dataset.ai4a11yCaptioned = 'failed';
    return null;
  }
}

export async function generateAudioCaptions(audio) {
  if (audio.dataset.ai4a11yCaptioned) return null;
  audio.dataset.ai4a11yCaptioned = 'pending';

  const src = audio.src || audio.querySelector('source')?.src;
  if (!src) {
    audio.dataset.ai4a11yCaptioned = 'failed';
    return null;
  }

  try {
    const result = await transcribeAudio(src);

    if (result?.text) {
      const text = result.text;
      addTranscriptBlock(audio, text);
      audio.dataset.ai4a11yCaptioned = 'done';
      incrementStat('wcag');
      logFix('transcript', audio, '(none)', '(generated)');
      console.log('[AI4A11y] Added audio transcript');
      return text;
    }

    audio.dataset.ai4a11yCaptioned = 'failed';
    return null;
  } catch (e) {
    console.warn('[AI4A11y] Failed to transcribe audio:', e);
    audio.dataset.ai4a11yCaptioned = 'failed';
    return null;
  }
}

function addCaptionTrack(video, text) {
  const track = document.createElement('track');
  track.kind = 'captions';
  track.label = 'Auto-generated';
  track.srclang = 'en';
  track.default = true;

  const vtt = createSimpleVTT(text);
  track.src = 'data:text/vtt;charset=utf-8,' + encodeURIComponent(vtt);

  video.appendChild(track);
}

function addTranscriptBlock(audio, text) {
  const container = document.createElement('details');
  container.className = 'ai4a11y-transcript';

  const summary = document.createElement('summary');
  summary.textContent = 'Transcript';
  container.appendChild(summary);

  const content = document.createElement('div');
  content.className = 'ai4a11y-transcript-content';
  content.textContent = text;
  container.appendChild(content);

  audio.parentElement?.insertBefore(container, audio.nextSibling);
}

function createSimpleVTT(text) {
  const words = text.split(/\s+/);
  const chunks = [];

  for (let i = 0; i < words.length; i += 10) {
    chunks.push(words.slice(i, i + 10).join(' '));
  }

  let vtt = 'WEBVTT\n\n';
  const secondsPerChunk = 5;

  chunks.forEach((chunk, index) => {
    const start = formatTime(index * secondsPerChunk);
    const end = formatTime((index + 1) * secondsPerChunk);
    vtt += `${start} --> ${end}\n${chunk}\n\n`;
  });

  return vtt;
}

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.000`;
}

export const axeHandlers = {
  'video-caption': generateVideoCaptions,
  'audio-caption': generateAudioCaptions
};

export const GenerateCaptions = {
  enabled: false,

  async enable() {
    this.enabled = true;
    const videos = document.querySelectorAll('video');
    for (const video of videos) {
      if (!this.enabled) break;
      const tracks = video.querySelectorAll('track[kind="captions"], track[kind="subtitles"]');
      if (tracks.length === 0) {
        await generateVideoCaptions(video);
      }
    }

    const audios = document.querySelectorAll('audio');
    for (const audio of audios) {
      if (!this.enabled) break;
      await generateAudioCaptions(audio);
    }
  },

  disable() {
    this.enabled = false;
  },

  toggle() {
    if (this.enabled) this.disable();
    else this.enable();
  }
};
