// Blocks 13 and 14, speech: speak to the person, and listen for commands.
//
//   const r = s.speech.say(article, { speechRate: 1.2, onWord: (range) => hl.move(range) });
//   r.pause(); r.resume(); r.stop();
//   s.speech.listen({ commands: { 'next heading': () => ..., 'click *': (name) => s.page.find(name)?.click() } });
//
// say(): one voice at a time, page-wide, so two adapters never talk over each
// other. Where the host has its own speech (the browser runtime: the
// extension's chrome.tts, the voices the person set up in their system) it
// speaks with that; otherwise with the page's speechSynthesis. Either way it
// waits for the person's first click or key in the page, and Escape always
// stops it. Long text is spoken in chunks
// (browsers cut long utterances off). Given an element, a Range or the
// person's Selection, onWord gets a DOM Range of each word as it is
// spoken, for highlight.range().
// The speaking rate comes from the person's profile when it has one.
//
// listen(): a visible indicator with a Stop button shows while the
// microphone is on; after repeated errors it stops and says why.

import { resolveConfig } from './shared.js';

export const SAY_DEFAULTS = { speechRate: 1, pitch: 1, voice: null, lang: null, chunkChars: 220, waitForGesture: true };
export const LISTEN_DEFAULTS = { lang: null, feedback: 'announce', maxErrors: 3 };

export function speechBlock(s, env) {
  const { win, doc, shared } = env;

  // The text to speak, and where each piece of it is in the page: an
  // element, a Range (or the person's Selection) or a string (no map).
  function source(input) {
    if (typeof input === 'string') return { text: input, map: null };
    if (input && typeof input.getRangeAt === 'function') input = input.rangeCount ? input.getRangeAt(0) : null;
    const range = input && input.startContainer && typeof input.intersectsNode === 'function' ? input : null;
    let root = range ? range.commonAncestorContainer : input;
    if (root && root.nodeType === 3) root = root.parentElement;
    if (!root || root.nodeType !== 1) return { text: String(input ?? ''), map: null };
    let text = '';
    const map = [];
    // The block each text is in (a heading, a paragraph, a list item, a cell): a new one is a
    // new sentence to the voice, so a heading is not read into the text after it.
    const blocks = new Map();
    const blockOf = (node) => {
      let el = node.parentElement;
      while (el && el !== root) {
        if (!blocks.has(el)) blocks.set(el, !/^(inline|contents|ruby)/.test(win.getComputedStyle(el).display || 'inline'));
        if (blocks.get(el)) return el;
        el = el.parentElement;
      }
      return root;
    };
    let lastBlock = null;
    for (const node of env.page.textNodes(root)) {
      let base = 0, stop = node.nodeValue.length;
      if (range) {
        if (!range.intersectsNode(node)) continue;
        if (node === range.startContainer) base = range.startOffset;
        if (node === range.endContainer) stop = range.endOffset;
        if (stop <= base) continue;
      }
      // Within a block the text runs on as the page shows it (<em>found</em>s is one word);
      // between blocks, a space, and a full stop where the last one has no punctuation of its own.
      const block = blockOf(node);
      if (text && block !== lastBlock) text = /[^\s.!?:;。！？]\s*$/.test(text) ? text.replace(/\s*$/, '. ') : text.replace(/\s*$/, ' ');
      lastBlock = block;
      map.push({ node, base, start: text.length, end: text.length + stop - base });
      text += node.nodeValue.slice(base, stop);
    }
    if (range && !map.length) return { text: String(range), map: null };
    return { text, map };
  }

  // Sentences, merged up to chunkChars; each remembers where it starts.
  function chunks(text, max) {
    const out = [];
    const parts = text.match(/[^.!?。！？\n]+[.!?。！？]*[\s]*|\n+/g) || [text];
    let cur = '', start = 0, pos = 0;
    for (const p of parts) {
      if (cur && cur.length + p.length > max) { out.push({ text: cur, start }); start = pos; cur = ''; }
      cur += p;
      pos += p.length;
    }
    if (cur.trim()) out.push({ text: cur, start });
    return out.filter((c) => c.text.trim());
  }

  function say(input, opts = {}) {
    const c = resolveConfig(SAY_DEFAULTS, opts, env.personal, { speechRate: 'speechRate' });
    const remote = env.transport.speak;
    const synth = win.speechSynthesis;
    const Utterance = win.SpeechSynthesisUtterance;
    let resolveDone;
    const done = new Promise((r) => { resolveDone = r; });
    let current = null; // the host's speech for the chunk being spoken
    const handle = {
      supported: !!remote || !!(synth && Utterance),
      done,
      get speaking() { return state === 'speaking' || state === 'paused'; },
      pause() { if (state === 'speaking') { state = 'paused'; if (remote) current?.pause(); else synth.pause(); } },
      resume() { if (state === 'paused') { state = 'speaking'; if (remote) current?.resume(); else synth.resume(); } },
      stop() { finish(true); },
    };
    let state = 'waiting';
    if (!s.alive() || !handle.supported) { resolveDone(false); return handle; }
    const { text, map } = source(input);
    // from: where in the text to start (the offset onWord gave), so a change
    // of rate goes on from the word it was at.
    const from = Math.max(0, Math.min(text.length, Math.floor(Number(opts.from) || 0)));
    const parts = chunks(text.slice(from), Math.max(40, Number(c.chunkChars) || 220)).map((p) => ({ ...p, start: p.start + from }));
    if (!parts.length) { resolveDone(false); return handle; }
    const rate = Math.max(0.5, Math.min(2, Number(c.speechRate) || 1));
    const pitch = Math.max(0, Math.min(2, Number(c.pitch) || 1));
    const lang = c.lang || doc.documentElement.lang || '';

    const rangeAt = (abs, len) => {
      if (!map) return null;
      const entry = map.find((m) => abs >= m.start && abs < m.end);
      if (!entry) return null;
      const r = doc.createRange();
      const from = entry.base + abs - entry.start;
      r.setStart(entry.node, from);
      r.setEnd(entry.node, Math.min(entry.base + entry.end - entry.start, from + Math.max(1, len)));
      return r;
    };
    const wordLength = (abs) => { const m = /^[\p{L}\p{N}'’-]+/u.exec(text.slice(abs)); return m ? m[0].length : 1; };
    const word = (abs, len) => {
      if (state === 'done' || !c.onWord) return;
      try { c.onWord(rangeAt(abs, len || wordLength(abs)), abs); } catch { /* the builder's callback */ }
    };
    const next = (i) => { if (state !== 'done' && s.alive()) { try { c.onChunk?.(i + 1, parts.length); } catch { /* callback */ } speak(i + 1); } };
    const voice = () => {
      const voices = synth.getVoices ? synth.getVoices() : [];
      return voices.find((v) => v.name === c.voice) || (c.lang && voices.find((v) => v.lang && v.lang.toLowerCase().startsWith(String(c.lang).toLowerCase()))) || null;
    };

    function finish(stopped) {
      if (state === 'done') return;
      const wasActive = state !== 'waiting';
      state = 'done';
      if (shared.voice === handle) {
        shared.voice = null;
        if (wasActive) { if (remote) { try { current?.stop(); } catch { /* gone */ } } else synth.cancel(); }
      }
      current = null;
      if (c.onWord) try { c.onWord(null, -1); } catch { /* the builder's callback */ }
      resolveDone(!stopped);
    }

    function speak(i) {
      if (state === 'done' || !s.alive()) return;
      if (i >= parts.length) { finish(false); return; }
      const part = parts[i];
      if (remote) {
        let ended = false;
        current = remote({ text: part.text, speechRate: rate, pitch, lang, voice: c.voice || null }, (e) => {
          if (ended || state === 'done' || !e) return;
          if (e.type === 'word') word(part.start + (Number(e.charIndex) || 0), Number(e.length) || 0);
          else if (e.type === 'end') { ended = true; next(i); } else if (['error', 'interrupted', 'cancelled'].includes(e.type)) { ended = true; finish(true); }
        });
        return;
      }
      const u = new Utterance(part.text);
      u.rate = rate;
      u.pitch = pitch;
      u.lang = lang;
      const v = voice();
      if (v) u.voice = v;
      u.onboundary = (e) => {
        if (e.name && e.name !== 'word') return;
        word(part.start + e.charIndex, e.charLength);
      };
      u.onend = () => next(i);
      u.onerror = (e) => { if (e.error !== 'interrupted' && e.error !== 'canceled') finish(true); };
      synth.speak(u);
    }

    function start() {
      if (state !== 'waiting' || !s.alive()) return;
      // One voice page-wide: whoever spoke before stops.
      if (shared.voice && shared.voice !== handle) shared.voice.stop();
      shared.voice = handle;
      state = 'speaking';
      if (!remote) synth.cancel();
      speak(0);
    }

    s.listen(doc, 'keydown', (e) => { if (e.key === 'Escape' && handle.speaking) handle.stop(); }, true);
    s.onEnd(() => finish(true));
    const activation = win.navigator && win.navigator.userActivation;
    if (c.waitForGesture && activation && !activation.hasBeenActive) {
      // Nothing talks before the person has used the page (and browsers
      // block the page's own speech until then).
      const go = (e) => { if (e.isTrusted && e.key !== 'Escape') { off1(); off2(); start(); } };
      const off1 = s.listen(doc, 'pointerdown', go, true);
      const off2 = s.listen(doc, 'keydown', go, true);
    } else {
      start();
    }
    return handle;
  }

  function listen(opts = {}) {
    const c = resolveConfig(LISTEN_DEFAULTS, opts, env.personal, {});
    const Recognition = win.SpeechRecognition || win.webkitSpeechRecognition;
    const handle = { supported: !!Recognition, listening: false, stop() {} };
    if (!s.alive() || !Recognition) return handle;
    const commands = Object.entries(c.commands || {}).map(([phrase, fn]) => {
      const p = phrase.toLowerCase().trim();
      const re = p.includes('*') ? new RegExp('^' + p.split('*').map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('(.+?)') + '$') : null;
      return { p, re, fn };
    });
    const say = (m) => { if (c.feedback === 'announce') s.announce(m); };

    // The indicator: visible while the microphone is on, with a way to stop it.
    const badge = s.el('div', { attrs: { role: 'group', 'aria-label': 'Voice commands' } });
    const label = s.el('span', { text: 'Listening' });
    const stopButton = s.el('button', { text: 'Stop listening', attrs: { type: 'button' } });
    badge.append(label, stopButton);
    badge.setAttribute('style', 'position:fixed;left:16px;bottom:16px;z-index:2147483646;display:flex;gap:8px;align-items:center;padding:6px 10px;background:#1f1f1f;color:#fff;border:2px solid #fff;border-radius:8px;font:14px/1.4 system-ui,sans-serif;');
    stopButton.setAttribute('style', 'min-height:32px;min-width:44px;padding:2px 10px;font:inherit;color:#fff;background:transparent;border:2px solid #fff;border-radius:6px;cursor:pointer;');
    s.append(doc.body, badge);
    s.listen(stopButton, 'click', () => stop('Stopped listening.'));

    const rec = new Recognition();
    rec.continuous = true;
    rec.interimResults = false;
    rec.lang = c.lang || doc.documentElement.lang || (win.navigator && win.navigator.language) || 'en-US';
    let errors = 0;
    let restart = 0;

    function stop(message) {
      if (!handle.listening && badge.hidden) return;
      handle.listening = false;
      win.clearTimeout(restart);
      try { rec.abort(); } catch { /* already stopped */ }
      badge.hidden = true;
      if (message) say(message);
    }
    handle.stop = () => stop('Stopped listening.');

    rec.onresult = (e) => {
      const result = e.results[e.results.length - 1];
      if (!result || !result.isFinal) return;
      errors = 0;
      const heard = String(result[0].transcript || '').toLowerCase().replace(/[.,!?]/g, '').trim();
      for (const cmd of commands) {
        const m = cmd.re ? cmd.re.exec(heard) : heard === cmd.p ? [heard] : null;
        if (!m) continue;
        try { cmd.fn(m[1], heard); } catch { /* the builder's command */ }
        return;
      }
      if (typeof c.onUnknown === 'function') c.onUnknown(heard); else say(`No command "${heard}".`);
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { stop('Voice commands are off: this site may not use the microphone.'); return; }
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      errors++;
      if (errors >= c.maxErrors) stop('Voice commands stopped after repeated errors. Turn them on again to retry.');
    };
    rec.onend = () => {
      if (!handle.listening || !s.alive()) return;
      // Browsers end recognition after a silence: start again, slower after errors.
      restart = win.setTimeout(() => { if (handle.listening && s.alive()) { try { rec.start(); } catch { /* starting */ } } }, 250 + Math.min(errors, 5) * 500);
    };
    s.onEnd(() => stop());
    handle.listening = true;
    try { rec.start(); } catch { stop('Voice commands could not start.'); return handle; }
    say('Listening for voice commands.');
    return handle;
  }

  return { say, listen };
}
