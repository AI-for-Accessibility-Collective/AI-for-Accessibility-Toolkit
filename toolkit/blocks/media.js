// Block 15, media: pause, mute and caption audio and video, and put them back
// as the person left them.
//
//   s.media.pause(video, { showControls: true })
//   s.media.pauseAll(root)        every <video> and <audio> under root
//   s.media.mute(el)
//   s.media.captions(video, { lang })
//
// Not configurable: end() never starts what the person paused, never
// re-mutes what the person unmuted, and never touches the page's own play()
// promise. It plays again only what was playing, or was about to autoplay,
// when the block paused it, and only if the person has not paused or played
// it since.

import { resolveConfig } from './shared.js';

export const PAUSE_DEFAULTS = { showControls: false };

export function mediaBlock(s, env) {
  const isMedia = (el) => !!el && (el.tagName === 'VIDEO' || el.tagName === 'AUDIO');
  const chosen = new WeakMap(); // video → { track } this session turned on
  const paused = new WeakMap(); // media → { playing } this session paused

  function pause(el, opts = {}) {
    if (!s.alive() || !isMedia(el)) return false;
    const c = resolveConfig(PAUSE_DEFAULTS, opts, env.personal, {});
    // Again on an element this session already paused: pause it, nothing more.
    if (paused.has(el)) {
      if (c.showControls) s.setAttr(el, 'controls', '');
      try { el.pause(); } catch { /* not ready */ }
      return paused.get(el).playing;
    }
    // Playing, or an autoplay that has not started yet.
    const playing = !el.paused || (el.autoplay && !(el.played && el.played.length) && !el.currentTime);
    let personTouched = false;
    // A play or pause the person made after ours: theirs wins on end(). It
    // can come from the player's own button outside the element, so one
    // right after the person activated a control anywhere counts too (not
    // typing, not a click on text).
    const CONTROL = 'button, [role="button"], input[type="button"], input[type="submit"], summary';
    const mark = () => {
      const last = env.shared.lastInput;
      const onControl = last && Date.now() - last.at < 1500 && last.target && last.target.closest && last.target.closest(CONTROL);
      if (s.watch.byPerson(el, { withinMs: 1500 }) || onControl) personTouched = true;
    };
    s.setAttr(el, 'autoplay', null);
    if (c.showControls) s.setAttr(el, 'controls', '');
    try { el.pause(); } catch { /* a media element that is not ready */ }
    paused.set(el, { playing });
    s.onEnd(() => paused.delete(el));
    s.listen(el, 'play', mark);
    s.listen(el, 'pause', mark);
    s.onEnd(() => {
      if (!playing || personTouched || !el.paused || !el.isConnected) return;
      const p = el.play();
      if (p && typeof p.catch === 'function') p.catch(() => { /* the browser said no to autoplay */ });
    });
    return playing;
  }

  function pauseAll(root = env.doc, opts = {}) {
    let n = 0;
    for (const el of root.querySelectorAll('video, audio')) if (pause(el, opts)) n++;
    return n;
  }

  function mute(el) {
    if (!s.alive() || !isMedia(el) || el.muted) return false;
    let personTouched = false;
    el.muted = true;
    s.listen(el, 'volumechange', () => { if (!el.muted && s.watch.byPerson(el, { withinMs: 1500 })) personTouched = true; });
    s.onEnd(() => { if (!personTouched && el.muted) el.muted = false; });
    return true;
  }

  function captions(video, { lang } = {}) {
    if (!s.alive() || !video || !video.textTracks) return null;
    const want = String(lang || env.personal.language || env.doc.documentElement.lang || (env.win.navigator && env.win.navigator.language) || '').toLowerCase().split('-')[0];
    const tracks = [...video.textTracks].filter((t) => t.kind === 'captions' || t.kind === 'subtitles');
    if (!tracks.length) return null;
    const inLang = want && tracks.find((t) => (t.language || '').toLowerCase().split('-')[0] === want);
    const showing = tracks.find((t) => t.mode === 'showing');
    const ours = chosen.get(video);
    // One the page or the person turned on stays. One this block turned on
    // gives way to a track in the person's language added since.
    if (showing && !(ours && ours.track === showing && inLang && inLang !== showing)) return showing;
    const choice = inLang || tracks.find((t) => t.kind === 'captions') || tracks[0];
    if (ours) { ours.track.mode = 'disabled'; ours.track = choice; choice.mode = 'showing'; return choice; }
    const before = tracks.map((t) => [t, t.mode]);
    const rec = { track: choice };
    chosen.set(video, rec);
    choice.mode = 'showing';
    s.onEnd(() => {
      chosen.delete(video);
      if (rec.track.mode !== 'showing') return;
      rec.track.mode = 'disabled';
      for (const [t, mode] of before) t.mode = mode;
    });
    return choice;
  }

  return { pause, pauseAll, mute, captions };
}
