// captions-on.js — Turns on captions and subtitles that videos and audio already have.
// Barrier: Deaf and hard-of-hearing people cannot access spoken dialogue and auditory
// cues in media elements that have captions disabled by default.
//
// Suggested in onboarding for: hearing (a suggestion only, never a gate).
// The person's settings it reads: none (language preference may come from profile).
// What the person can adjust: nothing (on or off).
//
// Options:
//   lang: Preferred BCP-47 language tag (e.g. 'en', 'fr'). Defaults to undefined,
//         in which case s.media.captions resolves preference from personal.language,
//         document lang, or navigator.language, falling back to the first captions track.
//
// Decisions:
//   • Uses s.media.captions for each video and audio element with caption or subtitle tracks.
//   • Chooses the track in the page's (or browser's) language, else the first caption track.
//   • Watches for media and track elements added later (s.watch.added) and listens for
//     tracks added via HTMLMediaElement API (addtrack event).
//   • Leaves media with no captions or subtitle tracks untouched and says nothing about it.
//   • Never starts playback on any media element (paused media remains paused, playing continues).
//   • Restores original track modes on disable() through session cleanup (s.onEnd).
//
// What it cannot do:
//   • Cannot generate or transcribe captions for media that lacks tracks (use an auto-transcriber).
//   • Does not manipulate custom third-party player buttons when native TextTracks are absent.

export default {
  enable(options = {}, toolkit) {
    if (this.s && !this.s.ended) return;
    this.options = options || {};
    this.toolkit = toolkit || this.toolkit;
    if (!this.toolkit) return false;
    const s = (this.s = this.toolkit.session());
    const seen = new WeakSet();

    const handleMedia = (media) => {
      if (!media || (media.tagName !== 'VIDEO' && media.tagName !== 'AUDIO')) return;
      try {
        s.media.captions(media, { lang: this.options.lang });
      } catch {
        // Ignore errors from media elements that are not ready or have read-only textTracks
      }
      if (!seen.has(media)) {
        seen.add(media);
        if (media.textTracks && typeof media.textTracks.addEventListener === 'function') {
          s.listen(media.textTracks, 'addtrack', () => {
            try {
              s.media.captions(media, { lang: this.options.lang });
            } catch {}
          });
        }
      }
    };

    const root = document.body || document.documentElement;
    if (root) {
      for (const media of root.querySelectorAll('video, audio')) {
        handleMedia(media);
      }

      s.watch.added(
        root,
        (el) => {
          if (el.tagName === 'TRACK') {
            const media = el.closest('video, audio') || el.parentElement;
            if (media) handleMedia(media);
          } else {
            handleMedia(el);
          }
        },
        { selector: 'video, audio, track' }
      );
    }
  },

  disable() {
    this.s?.end();
    this.s = null;
  },
};
