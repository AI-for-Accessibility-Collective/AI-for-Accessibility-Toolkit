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
      'const cancel = s.timer(fn, ms) / s.every(fn, ms) / s.frame(fn)   // each returns a function that cancels it',
      's.el(tag, { text, attrs })            // a new element marked as the toolkit\'s own',
      'await s.guard(promise)                // throws Ended if the session ended meanwhile',
      's.onEnd(fn) / s.alive() / s.ended / s.end()',
      'const mode = s.group()                // a session inside this one: mode.end() undoes only what went through it',
    ],
    config: { restore: { default: 'unless-changed', description: "'unless-changed' puts a value back only if the page has not changed it since; 'always' puts it back regardless." } },
    invariants: [
      'end() undoes everything in reverse, is idempotent and never throws.',
      'After end(), every change and every callback is a no-op: a late answer or timer never writes to the page.',
      'A value the page changed since the session set it stays as the page set it.',
      'Setting the same attribute or style property again changes the one record: re-applying on every page change never grows what end() has to undo.',
      'A group ends with its session. Use one for each mode, or each round of fixes you redo, instead of undoing by hand.',
    ],
  },
  {
    name: 'styles',
    title: 'Styles',
    summary: 'Stylesheets the adapter adds, and the one page filter all adapters share.',
    api: [
      's.css(name, cssText, { scope })       // one <style> per name; scope adds that class to <html> while open',
      's.css(name, null)                     // takes that <style> away',
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
      's.watch.added(root, (els) => ..., { batch: true, debounceMs })   // all of one flush at once: measure them, then change them',
      's.watch.route((url) => ...)           // the address changed without a page load',
      's.watch.prefs((p) => ...)             // { motionReducer, moreContrast, darkMode, forcedColors }',
      's.watch.byPerson(el, { withinMs })    // true if the person just clicked, tapped or typed in el',
    ],
    config: {
      debounceMs: { default: 0, description: 'Wait this long after the last change before calling back.' },
      cap: { default: 500, description: 'At most this many elements per call (per batch); more added at once come in the next calls, none dropped.' },
      types: { default: ['childList'], description: "What to watch: 'childList' (elements added), 'attributes', 'characterData' (changed text: the element whose text changed, also when the page set new text in it, as el.textContent = 'x' does)." },
      selector: { default: null, description: 'Only elements matching this (and matches inside added subtrees).' },
      batch: { default: false, description: 'Call back once with every element of the flush, instead of once for each: read all their sizes before writing any.' },
      withinMs: { default: 1000, description: 'byPerson: how recent the click or key must be.' },
    },
    personal: { motionReducer: 'prefs() reports motionReducer, darkMode and moreContrast as true when the profile asks for them, even if the system does not.' },
    invariants: ['Never reacts to the toolkit\'s own UI or to what a block wrote.', 'Stops on end().', 'Without a selector you get each element added, not what is inside it (an added list brings its items in, unseen); give a selector to get the controls inside added content too.', 'With batch, fn gets an array.'],
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
      'toolkit.page.nameOf(el)               // accessible name (an svg\'s own <title> included); never a field\'s typed value',
      'toolkit.page.find(name, { within })   // the visible control whose name best matches',
      'toolkit.page.isVisible(el, { size })  // size: false asks only whether the page hides it (an icon font\'s glyph has no box)',
      'toolkit.page.isOurs(el)',
      'toolkit.page.background(el) / toolkit.page.contrast(a, b)',
      'toolkit.page.textContrast(el)        // { color, background, ratio, min, large, overImage, fix }',
      'toolkit.page.widgetParts(widget)     // a carousel\'s slides or a tab set\'s panels, as ARIA marks them; [] when it does not',
      'toolkit.page.ownControls(widget, { parts })   // its own buttons (pause, next, pick a slide), not those inside its slides',
      'toolkit.page.landmark(el)            // the landmark role the browser gives it (\'banner\', \'main\', ...), or null',
      'toolkit.page.landmarks(role, { root })   // the elements the browser exposes with that role (every landmark without one)',
    ],
    config: {
      skip: { default: '', description: 'More selectors to leave out, on top of code, form fields, live regions, hidden content and the toolkit\'s UI.' },
      maxLevel: { default: 6, description: 'headings(): the deepest level to include.' },
    },
    invariants: [
      'Read-only.',
      'ownControls() decides from roles and relationships, never from names or classes: a control that names what it controls (aria-controls) is the widget\'s only when that is the widget, one of its parts or what holds them; one that does not say is the widget\'s only when it is outside every part. A "Play trailer" button inside a slide is the slide\'s, not the carousel\'s.',
      'landmark() and landmarks() follow HTML-AAM as Chrome computes it, from elements, roles and the tree, never from names or classes: an explicit role (its first valid token) wins; a header or footer inside article, aside, main, nav or section, or inside role article, complementary, main or navigation, is no banner or contentinfo (role region does not scope it); a section, form or role region needs a name; hidden elements are none. A div the page calls "header" is no banner: deciding that is the adapter\'s guess, not the page\'s word.',
    ],
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
    name: 'targets',
    title: 'Targets: room to grow and hit areas',
    summary: 'Make controls easier to hit without covering each other: how far each may grow, measured once, and a larger hit area that changes neither how it looks nor where anything is.',
    api: [
      'const room = s.targets.room(els, { size, others, rects, within, still })',
      '// Map el -> { rect, top, right, bottom, left, clipped, lines }: how far to grow on each side',
      's.targets.hitArea(el, room.get(el), { attrs })   // "pseudo", "ring" or null',
      's.targets.hitAreas(room, { attrs })             // all at once: Map el -> "pseudo" | "ring" | null',
    ],
    config: {
      size: { default: 24, description: 'room(): the smallest size, in CSS pixels, each element should reach in both directions.' },
      others: { default: [], description: 'room(): more targets to keep clear of (measured, not returned).' },
      rects: { default: null, description: 'room(): a Map el -> rect to use instead of measuring: the size an element had before you grew it.' },
      within: { default: null, description: 'room(): the box nothing may grow past (default: the page; the viewport for fixed elements).' },
      still: { default: null, description: 'room(): those of others you never grow (a label whose control is the target): a target may take the whole gap to them, not half.' },
      attrs: { default: null, description: 'hitArea(): attributes for the ring, if one is made (an object, or a function of the element), so you can find it later.' },
    },
    personal: { targetSize: 'Pass the person\'s targetSize as room()\'s size.' },
    invariants: [
      'room() is the same whatever order elements come in: between two targets each takes at most half the gap when the other grows toward it, the whole gap when the other is already big enough that way (or is one of still). Grown boxes never overlap, and none goes past the page\'s edge.',
      'A `<label>` and the control it labels (`label.control`) are one target: neither keeps the other back, so a control may grow over its own label, while other targets keep clear of the label. Pass such labels in others (and still) so that nothing grows over them.',
      'room() reads the layout once and says what would be cut off by a clipping ancestor (clipped) and how many lines an element has (lines), so nothing is read again after a change.',
      'hitArea() never changes how the element looks or where anything is: a pseudo-element the page does not use (any content counts, even ""), and position: relative only where it moves nothing else.',
      'Otherwise a ring around the element, never over it: anchored to it (it follows scrolling and reflow), hidden when the element is scrolled or clipped out of view, and passing presses and clicks on the ring to the element. Where the browser cannot anchor, nothing is made (null).',
      'A ring is an element inserted right after the element, so page rules that count siblings (:last-child, +, ~, :nth-child) can match differently around it. Prefer a pseudo-element (hitArea() does) and expect this where a ring is the only way.',
      'hitArea() again on the same element updates the one it made; end() takes all of it away.',
    ],
  },
  {
    name: 'announce',
    title: 'Announce',
    summary: 'Tell screen reader users what changed, through one shared live region.',
    api: [
      's.announce(message, { politeness })   // "polite" (default) or "assertive"',
      's.announce.batch(key, message, { windowMs })   // many changes, one announcement',
      's.announce.ready()   // the regions in the page now, before the first message (for an adapter that tells the page\'s own changes)',
    ],
    config: { politeness: { default: 'polite', description: "'polite' or 'assertive' (only for what the person must hear at once)." }, windowMs: { default: 400, description: 'batch(): how long to gather messages.' } },
    invariants: ['One live region per page for all adapters.', 'The same message twice is read twice.', 'A message is written only once its region has been in the page 250 ms, so a screen reader has noticed the region.', 'The regions go when the last session that announced, or called ready(), ends.'],
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
      fontScale: 'Text size in percent, of 16px (12pt); it never goes below 100.',
    }),
    personal: { fontScale: 'The profile\'s text size wins over yours.' },
    invariants: [
      'Its text is at least 16px (12pt), scaled up by the person\'s text size.',
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
    summary: 'Move focus without losing it, and say what the person\'s shortcut adjusts when they give it to your adapter.',
    api: [
      's.focus.region(el)                    // focus a region that is not focusable itself',
      's.focus.keepWhenRemoving(el)          // before el goes, move focus out of it',
      "s.focus.entry({ label: 'Page outline', onActivate: () => panel.open() })   // a button first in the tab order",
      's.focus.skipLink()                    // \'Skip to main content\', unless the page has one that works',
      's.focus.keepVisible()                 // the focused element is never hidden under a fixed or sticky bar',
      "s.keys.adjust({ label: 'Text size', settings: ['fontScale'], up: () => ..., down: () => ... })",
    ],
    config: { label: { default: null, description: "adjust(): what up and down change, for the person choosing their shortcut ('Text size')." }, settings: { default: [], description: "adjust(): the person's settings it changes, so they can use this site's values on every site from the extension." } },
    personal: { motionReducer: 'region() scrolls without animation.' },
    invariants: [
      'Adapters have no shortcuts of their own. The toolkit has one pair of keys, off until the person gives it to one adapter: with keys.adjust, up and down adjust; without (or while it is off on the site), the first key turns it on and off on this site.',
      'up() and down() count as the person\'s own key, so they may call profile.set; they never fire in a text field or editable region.',
      'The temporary tabindex region() adds goes when focus leaves.',
      'entry() and skipLink() are the toolkit\'s own controls at the start of the tab order, after the page\'s own skip link, in one place for every adapter. Each is out of sight until it has focus, then shown at the top left, so it covers nothing. skipLink() adds nothing (null) where the page already has a skip link whose target is there, or no main content to skip to.',
      'keepVisible() (WCAG 2.4.11) measures what is fixed or stuck at the top and bottom of the window where focus is, sets the page\'s scroll padding to clear it, and scrolls the focused element out from under it once. It never moves focus or changes the tab order.',
    ],
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
      's.text.scale(1.5)                     // the page\'s text at 150%, px-sized too; 1 puts it back',
      "s.text.fit(() => s.css('spacing', rules))   // change text; grow only the boxes the change now cuts off",
      "const sp = s.group(); sp.text.fit(() => sp.css('spacing', rules)); ... sp.end()   // a setting the person can turn off: its own group, so end() takes the sheet and the boxes fit grew",
    ],
    config: {
      ...cfg(WRAP_DEFAULTS, { cap: 'wrap(): at most this many matches.', skip: 'wrap(): more selectors to leave alone.' }),
      match: { default: null, description: 'wrap(): a regular expression, or its source as a string.' },
      ...cfg(REPLACE_DEFAULTS, { showOriginal: 'replaceBlock(): a button to see the original.', label: 'replaceBlock(): what the new text is.', originalLabel: 'replaceBlock(): the button while the new text shows.', replacedLabel: 'replaceBlock(): the button while the original shows.' }),
    },
    invariants: ['The original text nodes come back on end(), the same objects.', 'Code, form fields, live regions, hidden content and the toolkit\'s UI are never changed.', 'A replaced block can always be seen as it was.',
      'scale() is the text size alone, for when s.zoom.method() is not \'zoom\'. It measures before it writes and sizes each element from its own original size, so a new factor never compounds. Pixel line heights keep their proportion; the person\'s line spacing still wins. A fixed-height box that would cut its text off grows. Text added later is sized as it arrives; the page is measured again when the window\'s width changes.',
      'fit() measures the boxes around the page\'s text, runs your change, and grows only those it made cut text off; a box that cut text off before, by the page\'s design, stays. Use it for spacing, instead of reading every element\'s height yourself.'],
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
      'keep (at most 50 terms of 80 characters) and glossary (at most 30) are cut to fit, never refused: gather them from the page freely.',
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
      "s.speech.say(win.getSelection())      // or a Range: what the person selected, with onWord ranges in the page",
      'r.pause(); r.resume(); r.stop(); await r.done; r.speaking',
      "s.speech.say(el, { from })            // start at an offset onWord gave (onWord(range, offset)): a new rate goes on from that word",
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
    invariants: ['end() never starts what the person paused or played themselves.', 'It never re-mutes what the person unmuted.', 'It never touches the page\'s own play() promise.', 'captions() never changes a track the page or the person turned on. Call it again when a track is added: it moves its own choice to one in the person\'s language.'],
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
      'Only the person changes their profile: set() works only right after their own click, tap or key on the toolkit\'s UI in this page or their shortcut (keys.adjust); otherwise it returns { applied: false, reason: \'not-by-person\' }.',
      'set() calls every onChange listener, your own included, before it returns: apply the change in onChange, and do not apply it again after set().',
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
