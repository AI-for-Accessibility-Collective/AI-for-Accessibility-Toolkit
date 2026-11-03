// The building blocks, described for the builder: what each gives an
// adapter, how to call it, what a builder can configure (and what comes from
// the person's profile instead), and what no configuration can change.
//
// The skill's reference/building-blocks.md is generated from this file
// (toolkit/scripts/generate-skill.mjs), and toolkit/test/blocks.test.mjs
// checks that every call listed here exists.

import { TOOLTIP_DEFAULTS } from './tooltip.js';
import { PANEL_DEFAULTS } from './panel.js';
import { HIGHLIGHT_DEFAULTS, FOLLOW_DEFAULTS, RING_DEFAULTS } from './highlight.js';
import { SAY_DEFAULTS, LISTEN_DEFAULTS } from './speech.js';
import { AI_DEFAULTS } from './ai.js';
import { WRAP_DEFAULTS, REPLACE_DEFAULTS } from './text.js';
import { PAUSE_DEFAULTS } from './media.js';

export { BLOCKS_VERSION, BLOCK_NAMES } from './names.js';

const cfg = (defaults, described) => Object.fromEntries(Object.entries(described).map(([k, d]) => [k, { default: defaults[k], description: d }]));

export const CATALOG = /* @__PURE__ */ Object.freeze([
  {
    name: 'session',
    title: 'Session: reversible changes',
    summary: 'Every change goes through a session, and disable() is s.end(): it undoes them all, in reverse. Every other block is made from the session.',
    api: [
      'const s = toolkit.session({ restore })',
      's.setAttr(el, name, value)            // value null removes it',
      's.setStyle(el, prop, value, priority)',
      's.addClass(el, ...names)',
      's.insert(parent, node, before) / s.append(parent, node)',
      's.replace(oldNode, newNode) / s.remove(node) / s.setText(textNode, text)',
      's.listen(target, type, fn, options)   // returns a function that removes it',
      's.timer(fn, ms) / s.every(fn, ms) / s.frame(fn)',
      's.el(tag, { text, attrs })            // a new element marked as the toolkit\'s own',
      'await s.guard(promise)                // throws Ended if the session ended meanwhile',
      's.onEnd(fn) / s.alive() / s.ended / s.end()',
    ],
    config: { restore: { default: 'unless-changed', description: "'unless-changed' puts a value back only if the page has not changed it since; 'always' puts it back regardless." } },
    invariants: [
      'end() undoes everything in reverse, is idempotent and never throws.',
      'After end(), every change and every callback is a no-op: a late answer or timer never writes to the page.',
      'A value the page changed since the session set it stays as the page set it.',
    ],
  },
  {
    name: 'styles',
    title: 'Styles',
    summary: 'Stylesheets the adapter adds, and the one page filter all adapters share.',
    api: [
      's.css(name, cssText, { scope })       // one <style> per name; scope adds that class to <html> while open',
      's.filter(name, value)                 // e.g. s.filter("dim", "brightness(0.85)"); composes with other adapters\' filters',
    ],
    config: {},
    invariants: ['One `<style>` per name.', 'Filters from different adapters compose in one chain instead of replacing each other.'],
  },
  {
    name: 'watch',
    title: 'Watch',
    summary: 'React to what changes while the adapter runs.',
    api: [
      's.watch.added(root, (el) => ..., { debounceMs, cap, types, selector })',
      's.watch.route((url) => ...)           // the address changed without a page load',
      's.watch.prefs((p) => ...)             // { motionReducer, moreContrast, darkMode, forcedColors }',
      's.watch.byPerson(el, { withinMs })    // true if the person just clicked, tapped or typed in el',
    ],
    config: {
      debounceMs: { default: 0, description: 'Wait this long after the last change before calling back.' },
      cap: { default: 500, description: 'At most this many elements per call-back batch.' },
      types: { default: ['childList'], description: "What to watch: 'childList', 'attributes', 'characterData'." },
      selector: { default: null, description: 'Only elements matching this (and matches inside added subtrees).' },
      withinMs: { default: 1000, description: 'byPerson: how recent the click or key must be.' },
    },
    personal: { motionReducer: 'prefs() reports motionReducer, darkMode and moreContrast as true when the profile asks for them, even if the system does not.' },
    invariants: ['Never reacts to the toolkit\'s own UI or to what a block wrote.', 'Stops on end().'],
  },
  {
    name: 'page',
    title: 'Page (read-only)',
    summary: 'What is on the page. toolkit.page and s.page are the same object; nothing in it changes the page.',
    api: [
      'toolkit.page.main()                   // the main content region',
      'toolkit.page.readableText(el, { blockPause, skip })',
      'toolkit.page.textNodes(el, { skip })',
      'toolkit.page.headings({ maxLevel })   // [{ el, level, text }]',
      'toolkit.page.nameOf(el)               // accessible name; never a field\'s typed value',
      'toolkit.page.find(name, { within })   // the visible control whose name best matches',
      'toolkit.page.isVisible(el) / toolkit.page.isOurs(el)',
      'toolkit.page.background(el) / toolkit.page.contrast(a, b)',
    ],
    config: {
      skip: { default: '', description: 'More selectors to leave out, on top of code, form fields, live regions, hidden content and the toolkit\'s UI.' },
      maxLevel: { default: 6, description: 'headings(): the deepest level to include.' },
    },
    invariants: ['Read-only.'],
  },
  {
    name: 'highlight',
    title: 'Highlight',
    summary: 'Show the person where they are: an element, a stretch of text, a band that follows the pointer, a strong focus ring.',
    api: [
      'const h = s.highlight.element(el, { style, color }); h.move(other); h.clear()',
      'const r = s.highlight.range(range, { color }); r.move(nextRange)   // no change to the page\'s text',
      'const band = s.highlight.follow({ source, height, dimOutside })',
      's.highlight.focusRing({ color, width })',
    ],
    config: {
      ...cfg(HIGHLIGHT_DEFAULTS, { style: "'background', 'outline' or 'underline'.", color: "'auto' picks one with enough contrast; a colour you give is used only if it has enough.", width: 'Outline or underline width, in pixels.' }),
      ...cfg(FOLLOW_DEFAULTS, { source: "follow(): 'pointer', 'focus' or both.", height: 'follow(): band height in pixels.', dimOutside: 'follow(): how much to dim above and below the band, 0-0.9; 0 tints the band instead.' }),
      ringWidth: { default: RING_DEFAULTS.width, description: 'focusRing(): width in pixels (passed as `width`).' },
    },
    personal: { motionReducer: 'The band does not animate.' },
    invariants: [
      'A background that would fail 4.5:1 against the text is not drawn; an outline that passes 3:1 is drawn instead.',
      'Text ranges use the CSS Custom Highlight API: the page\'s text nodes are never split or wrapped.',
      'The focus ring shows on any background and beats a page\'s outline: none !important.',
    ],
  },
  {
    name: 'announce',
    title: 'Announce',
    summary: 'Tell screen reader users what changed, through one shared live region.',
    api: [
      's.announce(message, { politeness })   // "polite" (default) or "assertive"',
      's.announce.batch(key, message, { windowMs })   // many changes, one announcement',
    ],
    config: { politeness: { default: 'polite', description: "'polite' or 'assertive' (only for what the person must hear at once)." }, windowMs: { default: 400, description: 'batch(): how long to gather messages.' } },
    invariants: ['One live region per page for all adapters.', 'The same message twice is read twice.', 'The regions go when the last session that announced ends.'],
  },
  {
    name: 'tooltip',
    title: 'Tooltip (WCAG 1.4.13)',
    summary: 'Content on hover or focus: a definition, a link\'s destination, a title the page hides.',
    api: [
      "s.tooltip({ trigger: 'abbr[title]', content: 'title' })",
      "s.tooltip({ trigger: '.term', content: (el) => s.ai.text('define', el.textContent, { context }) })",
      'const t = s.tooltip(...); t.open(el); t.hide()',
    ],
    config: cfg(TOOLTIP_DEFAULTS, {
      trigger: 'Selector of the elements that show it.',
      content: "'title' (the element's title, moved off so the browser's own tooltip does not double it), a string, or a function of the element returning a string, an element, or a promise of one (null shows nothing).",
      delayMs: 'Hover delay before it opens. Focus opens it at once.',
      hideDelayMs: 'Grace time to move the pointer onto it.',
      placement: "'below' or 'above'; it flips when there is no room.",
      describe: 'Point the trigger\'s aria-describedby at it while open.',
      maxWidth: 'Pixels.',
      theme: "'dark' or 'light'.",
      fontScale: 'Text size in percent.',
    }),
    personal: { fontScale: 'The profile\'s text size wins over yours.' },
    invariants: [
      'It can be hovered without closing.',
      'Escape closes it, and it stays closed while the pointer or focus stays on that trigger.',
      'It stays open while its trigger has focus.',
      'A click never closes it.',
      'A late answer never opens it after it was closed or moved on.',
      'It never covers the focused element.',
    ],
  },
  {
    name: 'panel',
    title: 'Panel',
    summary: 'A dialog, a disclosure region or a full-screen view, with its own Close button.',
    api: [
      "const p = s.panel({ kind: 'dialog', label: 'Chart data', near: chart })",
      'p.body.append(content); p.open(button); p.close(); p.isOpen',
    ],
    config: cfg(PANEL_DEFAULTS, {
      kind: "'dialog', 'disclosure' or 'fullscreen'.",
      label: 'Its heading, and its accessible name.',
      near: 'An element to sit beside (never over it). Otherwise a corner.',
      corner: "'bottom-right', 'bottom-left', 'top-right' or 'top-left'.",
      focus: "'from-trigger' (focus moves in when open() is given what opened it), 'always' or 'never'.",
      returnTo: 'Where focus goes on close, if it was inside. By default whatever opened it.',
      inert: "fullscreen: make the rest of the page unreachable while open (live regions stay reachable).",
      theme: "'page' (the page's font), 'light' or 'dark'.",
      width: 'Pixels (not fullscreen).',
      zIndex: 'Stacking order.',
      fontScale: 'Text size in percent.',
    }),
    personal: { fontScale: 'The profile\'s text size wins over yours.' },
    invariants: ['A visible Close button at least 24 pixels.', 'Escape closes it.', 'It takes focus only when its focus policy says so.', 'On close, focus returns only if it was inside.', 'Placed near an element, it never covers it.'],
  },
  {
    name: 'focus',
    title: 'Focus and keys',
    summary: 'Move focus without losing it, and add keyboard shortcuts that do not clash.',
    api: [
      's.focus.region(el)                    // focus a region that is not focusable itself',
      's.focus.keepWhenRemoving(el)          // before el goes, move focus out of it',
      "s.keys.shortcut({ code: 'KeyD', alt: true }, (e) => ...)",
    ],
    config: { code: { default: null, description: "shortcut(): the key's KeyboardEvent.code, e.g. 'KeyD', 'Digit1'." }, alt: { default: false, description: 'shortcut(): with Alt (Option).' }, shift: { default: false, description: 'shortcut(): with Shift.' } },
    personal: { motionReducer: 'region() scrolls without animation.' },
    invariants: ['A shortcut never fires in a text field or editable region, never with Ctrl or Meta held, and never for Tab, Escape, Enter or Space without Alt.', 'The temporary tabindex region() adds goes when focus leaves.'],
  },
  {
    name: 'text',
    title: 'Text',
    summary: 'Change the page\'s text and get it back: wrap words, change text in place, or show new text in place of a block.',
    api: [
      "s.text.wrap(root, { match: /\\b[A-Za-z]{9,}\\b/, build: (word) => span, cap })   // returns how many",
      's.text.set(textNode, text)           // in place, for translation',
      "const r = s.text.replaceBlock(paragraph, newText, { label })   // with a Show original button",
      's.text.nodes(root)                    // the text nodes it would change',
    ],
    config: {
      ...cfg(WRAP_DEFAULTS, { cap: 'wrap(): at most this many matches.', skip: 'wrap(): more selectors to leave alone.' }),
      match: { default: null, description: 'wrap(): a regular expression, or its source as a string.' },
      ...cfg(REPLACE_DEFAULTS, { showOriginal: 'replaceBlock(): a button to see the original.', label: 'replaceBlock(): what the new text is.', originalLabel: 'replaceBlock(): the button while the new text shows.', replacedLabel: 'replaceBlock(): the button while the original shows.' }),
    },
    invariants: ['The original text nodes come back on end(), the same objects.', 'Code, form fields, live regions, hidden content and the toolkit\'s UI are never changed.', 'A replaced block can always be seen as it was.'],
  },
  {
    name: 'ai.text',
    title: 'AI text: simplify, summarize, define, translate, label',
    summary: 'Ask the toolkit\'s model for text, with its default prompt for the task adapted by your fields. The service runs the model and checks the answer; you get a string or null.',
    api: [
      "const plain = await s.ai.text('simplify', text, { context, keep: ['Medicare'], tone: 'friendly' })",
      "const meaning = await s.ai.text('define', word, { context: sentence, maxChars: 200 })",
      "const es = await s.ai.text('translate', text, { translateTo: 'Spanish' })",
      "const name = await s.ai.text('label', 'icon button, search form, magnifier icon')",
      's.ai.available                       // false where no model is wired (then every call is null)',
    ],
    config: {
      ...cfg(AI_DEFAULTS, { budget: 'Calls per session (cached answers are free).', maxInputChars: 'Longer input gets null, not a cut: send one block at a time.' }),
      fields: { default: null, description: 'The prompt fields (readingLevel, translateTo, language, tone, audience, context, keep, glossary, instructions, template, maxSentences, maxChars, minRatio, maxRatio): see "Prompts" below.' },
    },
    personal: { readingLevel: 'The profile\'s reading level (or plain language) wins over yours.' },
    invariants: [
      'The page text is fenced and marked as content, never instructions; the output contract (only the answer) is always added.',
      'Every answer is checked before you get it: refusals, guesses and answers of the wrong length come back as null.',
      'null leaves the page as it was. After end(), every answer is null.',
    ],
  },
  {
    name: 'ai.vision',
    title: 'AI vision: describe an image, read a chart',
    summary: 'Describe an element as it looks: an image, a canvas, an SVG, or a chart. The page draws it when it can; otherwise the browser captures it from the screen (it must be in view).',
    api: [
      "const alt = await s.ai.vision('describe', img, { purpose: 'alt' })",
      "const summary = await s.ai.vision('chart', chartEl, { about: heading.textContent })",
    ],
    config: { purpose: { default: 'alt', description: "describe: 'alt' (one sentence) or 'long'." }, about: { default: '', description: 'Text from the page about the image (a caption, a heading).' }, maxChars: { default: null, description: 'At most this many characters (default 150 for alt, 1200 for a chart).' } },
    invariants: ['As ai.text: checked answers, null on any doubt, nothing after end().'],
  },
  {
    name: 'speech.out',
    title: 'Speech: speak',
    summary: 'Read text aloud, with word-by-word events for highlighting. In the browser runtime it speaks with the browser\'s own speech (the voices the person set up), elsewhere with the page\'s.',
    api: [
      'const r = s.speech.say(elementOrText, { speechRate, voice, lang, onWord: (range) => h.move(range), onChunk })',
      'r.pause(); r.resume(); r.stop(); await r.done; r.speaking',
    ],
    config: cfg(SAY_DEFAULTS, { speechRate: '0.5-2.', pitch: '0-2.', voice: 'A voice name (speechSynthesis.getVoices() in a page; the browser\'s voices in the runtime).', lang: "e.g. 'en-GB'. By default the page's language.", chunkChars: 'Longest piece spoken at once (browsers cut long ones off).', waitForGesture: 'Wait for the person\'s first click or key in the page.' }),
    personal: { speechRate: 'The profile\'s speaking rate wins over yours.' },
    invariants: ['One voice at a time, page-wide: a new say() stops the last.', 'Escape always stops it.', 'It never starts before the person has used the page.'],
  },
  {
    name: 'speech.in',
    title: 'Speech: voice commands',
    summary: 'Listen for spoken commands.',
    api: [
      "const l = s.speech.listen({ commands: { 'scroll down': () => scrollBy(0, 400), 'click *': (name) => s.page.find(name)?.click() } })",
      'l.stop(); l.listening',
    ],
    config: cfg(LISTEN_DEFAULTS, { lang: "e.g. 'en-US'. By default the page's language.", feedback: "'announce' says what it heard when nothing matched; 'none' stays quiet.", maxErrors: 'Stop after this many errors in a row.' }),
    invariants: ['A visible indicator with a Stop button shows while the microphone is on.', 'It stops after repeated errors and says why.'],
  },
  {
    name: 'media',
    title: 'Media',
    summary: 'Pause, mute and caption audio and video, and leave them as the person left them.',
    api: [
      's.media.pause(video, { showControls }) / s.media.pauseAll(root)',
      's.media.mute(el)',
      "s.media.captions(video, { lang })      // show the captions track it already has",
    ],
    config: cfg(PAUSE_DEFAULTS, { showControls: 'pause(): show the browser\'s controls while paused.' }),
    invariants: ['end() never starts what the person paused or played themselves.', 'It never re-mutes what the person unmuted.', 'It never touches the page\'s own play() promise.'],
  },
  {
    name: 'profile',
    title: 'The person\'s settings',
    summary: 'Read the person\'s settings on this site, and record a change they make in your adapter, for this site or every site.',
    api: [
      "s.profile.get() / s.profile.get('fontScale')   // = toolkit.personal, kept current",
      "await s.profile.set({ fontScale: 150 })                    // this site (the default)",
      "await s.profile.set({ fontScale: 150 }, { scope: 'all' })  // every site",
      's.profile.onChange((personal, changed) => ...)',
    ],
    config: { scope: { default: 'site', description: "set(): 'site' records it for this site; 'all' for every site (and drops this site's own value, so it follows)." } },
    personal: Object.fromEntries(['speechRate', 'fontScale', 'textSizeMethod', 'lineHeight', 'letterSpacing', 'targetSize', 'motionReducer', 'contrastMode', 'darkMode'].map((k) => [k, 'Settable.'])),
    invariants: [
      'Only the person changes their profile: set() works only right after their own click, tap or key on the toolkit\'s UI in this page or on an adapter\'s shortcut; otherwise it returns { applied: false, reason: \'not-by-person\' }.',
      'Only settings, checked and kept in range: speechRate, fontScale, textSizeMethod, lineHeight, letterSpacing, targetSize, motionReducer, contrastMode, darkMode.',
      'The change applies in this page at once, for every adapter, and is saved to the profile where the host can ({ saved }).',
      'What the person set for a site wins over what they set for every site, which wins over what the toolkit derived from their needs.',
    ],
  },
  {
    name: 'zoom',
    title: 'Browser zoom',
    summary: 'Zoom the page with the browser\'s own zoom, which reflows it like the person\'s own zoom; and whether to zoom or change the text size.',
    api: [
      "const method = s.zoom.method('zoom')   // 'zoom' | 'font': the person's textSizeMethod, else yours",
      "if (method === 'zoom') await s.zoom.set(1.5); else s.css('text-size', '...')   // never both",
      'await s.zoom.get()   // the zoom now, or null',
      's.zoom.supported',
    ],
    config: { method: { default: 'zoom', description: "method(builderDefault): your default when the person has not chosen; 'font' where zoom is not offered." } },
    personal: { textSizeMethod: 'The person\'s choice of zoom or text size wins over yours.' },
    invariants: [
      'Only in the browser runtime (the browser keeps zoom per site); elsewhere supported is false and method() answers \'font\'.',
      'end() puts back the zoom from before, unless the person changed it meanwhile.',
      'Zoom or text size, never both: method() gives one answer.',
    ],
  },
]);


export const EXAMPLE = `// Plain words: shows each long paragraph in plain language, with a button
// to see the original. Uses the toolkit's building blocks.
export default {
  async enable(options, toolkit) {
    if (this.s && !this.s.ended) return;
    const s = (this.s = toolkit.session());
    if (!s.ai.available) return false;
    const main = toolkit.page.main();
    let done = 0;
    for (const p of main.querySelectorAll('p')) {
      const text = p.textContent.trim();
      if (text.length < 300) continue;
      const plain = await s.ai.text('simplify', text, {
        context: document.title,
        keep: options.keep || [],
      });
      if (plain && s.text.replaceBlock(p, plain)) done++;
    }
    if (done) s.announce(done + ' paragraphs in plain language.');
    return done > 0;
  },
  disable() {
    this.s?.end();
  },
};`;
