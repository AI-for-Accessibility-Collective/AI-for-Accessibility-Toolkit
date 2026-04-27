import { isVisible, wasProcessed } from '../utils/dom.js';

// Find videos without captions
export function findVideosWithoutCaptions() {
  return Array.from(document.querySelectorAll('video'))
    .filter(video => {
      if (wasProcessed(video)) return false;
      if (!isVisible(video)) return false;

      // Check for caption tracks
      const tracks = video.querySelectorAll('track[kind="captions"], track[kind="subtitles"]');
      if (tracks.length > 0) return false;

      // Check for text track API
      if (video.textTracks?.length > 0) {
        for (const track of video.textTracks) {
          if (track.kind === 'captions' || track.kind === 'subtitles') {
            return false;
          }
        }
      }

      return true;
    });
}

// Find audio without transcripts
export function findAudioWithoutTranscripts() {
  return Array.from(document.querySelectorAll('audio'))
    .filter(audio => {
      if (wasProcessed(audio)) return false;
      if (!isVisible(audio)) return false;

      // Check for nearby transcript link or content
      const parent = audio.parentElement;
      if (!parent) return true;

      const text = parent.textContent?.toLowerCase() || '';
      if (text.includes('transcript')) return false;

      // Check for track element
      if (audio.querySelector('track')) return false;

      return true;
    });
}

// Find embedded videos (YouTube, Vimeo, etc.)
export function findEmbeddedVideos() {
  return Array.from(document.querySelectorAll('iframe'))
    .filter(iframe => {
      if (wasProcessed(iframe)) return false;

      const src = iframe.src || '';
      const isVideo =
        src.includes('youtube.com') ||
        src.includes('youtu.be') ||
        src.includes('vimeo.com') ||
        src.includes('dailymotion.com') ||
        src.includes('player.');

      return isVideo;
    });
}
