// generate-captions.js — AI-generated captions and transcripts for media.
//
// For media with NO captions or transcript: transcribes reachable audio via
// cloud AI (transcribeVideo, transcribeAudio) and attaches an AI-generated
// <track kind="captions"> to <video> elements or an expandable <details>
// transcript to <audio> elements.
//
// Decisions:
//   • Leave captioned media alone: videos that already have a caption or subtitle
//     track are untouched (no duplicate tracks or unnecessary AI calls).
//   • Persistent track with showing mode: dynamically added tracks are marked
//     default and switched to 'showing' so users actually see the captions.
//   • Accessible disclosure: audio transcripts use native <details>/<summary>
//     with >= 24px target size, visible focus styling, and semantic disclosure state.
//   • Reversible: restoreOriginal() removes added tracks, transcripts, styles,
//     and processing flags to return the DOM to its exact prior state.
//
import { transcribeVideo, transcribeAudio, announce } from '../utils/ai.js';

const logFix = globalThis.ai4a11yLogFix || (() => {});
const incrementStat = globalThis.ai4a11yIncrementStat || (() => {});

const STYLE_ID = 'ai4a11y-generate-captions-styles';

function ensureStyles() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .ai4a11y-transcript {
      margin-top: 8px;
      margin-bottom: 8px;
      font-family: inherit;
      font-size: inherit;
      color: inherit;
    }
    .ai4a11y-transcript summary {
      display: list-item;
      min-height: 24px;
      min-width: 24px;
      padding: 4px 8px;
      cursor: pointer;
      font-family: inherit;
      font-size: inherit;
      color: inherit;
      line-height: 1.5;
      box-sizing: border-box;
    }
    .ai4a11y-transcript summary:focus {
      outline: 2px solid currentColor;
      outline-offset: 2px;
    }
    .ai4a11y-transcript-content {
      padding: 8px;
      margin-top: 4px;
      white-space: pre-wrap;
      font-family: inherit;
      font-size: inherit;
      line-height: 1.5;
      border-left: 2px solid currentColor;
    }
  `;
  (document.head || document.documentElement).appendChild(style);
}

// Generate and add captions to video
export async function generateVideoCaptions(video) {
  if (!video || video.dataset.ai4a11yCaptioned) return null;

  // Leave media alone if it already has captions or subtitles
  const hasCaptions = video.querySelector('track[kind="captions" i], track[kind="subtitles" i]') ||
    Array.from(video.textTracks || []).some(t => t.kind === 'captions' || t.kind === 'subtitles');
  if (hasCaptions) return null;

  video.dataset.ai4a11yCaptioned = 'pending';

  const src = video.currentSrc || video.src || video.querySelector('source')?.src;
  if (!src || !src.trim()) {
    video.dataset.ai4a11yCaptioned = 'failed';
    return null;
  }

  try {
    const result = await transcribeVideo(src);

    if (result?.text && result.text.trim()) {
      const text = result.text.trim();
      addCaptionTrack(video, text);
      video.dataset.ai4a11yCaptioned = 'done';
      incrementStat('captions');
      logFix('captions', video, '(none)', '(generated)');
      announce('Captions added to video');
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

// Generate and add captions to audio
export async function generateAudioCaptions(audio) {
  if (!audio || audio.dataset.ai4a11yCaptioned) return null;
  audio.dataset.ai4a11yCaptioned = 'pending';

  const src = audio.currentSrc || audio.src || audio.querySelector('source')?.src;
  if (!src || !src.trim()) {
    audio.dataset.ai4a11yCaptioned = 'failed';
    return null;
  }

  try {
    const result = await transcribeAudio(src);

    if (result?.text && result.text.trim()) {
      const text = result.text.trim();
      addTranscriptBlock(audio, text);
      audio.dataset.ai4a11yCaptioned = 'done';
      incrementStat('captions');
      logFix('transcript', audio, '(none)', '(generated)');
      announce('Audio transcript added');
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

// Add caption track to video element
function addCaptionTrack(video, text) {
  const track = document.createElement('track');
  track.kind = 'captions';
  track.label = 'Auto-generated';
  const lang = (typeof document !== 'undefined' && document.documentElement?.lang?.slice(0, 2).toLowerCase()) || 'en';
  track.srclang = lang;
  track.default = true;
  track.dataset.ai4a11yTrack = 'true';

  // Create simple VTT format
  const vtt = createSimpleVTT(text);
  track.src = 'data:text/vtt;charset=utf-8,' + encodeURIComponent(vtt);

  video.appendChild(track);
  try {
    if (track.track) {
      track.track.mode = 'showing';
    }
  } catch (e) {
    // Mode may be read-only in some environments
  }
}

// Add transcript block near audio element
function addTranscriptBlock(audio, text) {
  ensureStyles();

  const container = document.createElement('details');
  container.className = 'ai4a11y-transcript';
  container.dataset.ai4a11yTranscript = 'true';

  const summary = document.createElement('summary');
  summary.textContent = 'Transcript';
  container.appendChild(summary);

  const content = document.createElement('div');
  content.className = 'ai4a11y-transcript-content';
  content.textContent = text;
  container.appendChild(content);

  audio.parentElement?.insertBefore(container, audio.nextSibling);
}

// Restore original page elements and attributes
export function restoreOriginal(element) {
  if (typeof document === 'undefined') return;

  if (!element) {
    document.querySelectorAll('.ai4a11y-transcript, [data-ai4a11y-transcript]').forEach(el => el.remove());
    document.querySelectorAll('track[data-ai4a11y-track]').forEach(t => t.remove());
    document.querySelectorAll('[data-ai4a11y-captioned]').forEach(el => {
      delete el.dataset.ai4a11yCaptioned;
    });
    document.getElementById(STYLE_ID)?.remove();
    return;
  }

  if (element.tagName === 'VIDEO') {
    element.querySelectorAll('track[data-ai4a11y-track]').forEach(t => t.remove());
    delete element.dataset.ai4a11yCaptioned;
  } else if (element.tagName === 'AUDIO') {
    const next = element.nextElementSibling;
    if (next?.classList.contains('ai4a11y-transcript') || next?.dataset.ai4a11yTranscript) {
      next.remove();
    }
    delete element.dataset.ai4a11yCaptioned;
  } else if (element.classList?.contains('ai4a11y-transcript') || element.dataset?.ai4a11yTranscript) {
    element.remove();
  }

  if (!document.querySelector('.ai4a11y-transcript, [data-ai4a11y-track]')) {
    document.getElementById(STYLE_ID)?.remove();
  }
}

// Create simple WebVTT from text
function createSimpleVTT(text) {
  const words = (text || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 'WEBVTT\n\n';

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

// Format seconds to VTT timestamp
function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.000`;
}

// Axe rule ID to handler mapping
export const axeHandlers = {
  'video-caption': generateVideoCaptions,
  'audio-caption': generateAudioCaptions
};
