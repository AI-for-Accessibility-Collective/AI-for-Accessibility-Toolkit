// Read Aloud unit tests
import { JSDOM } from 'jsdom';
import { ReadAloud } from '../adapters/read-aloud.js';
import { setAIProvider } from '../utils/ai.js';

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log('FAIL:', name);
  }
}

function mount(bodyHTML) {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${bodyHTML}</body></html>`, { url: 'https://example.com/' });
  const { window } = dom;
  global.window = window;
  global.document = window.document;
  global.HTMLElement = window.HTMLElement;
  global.Element = window.Element;
  return window.document;
}

// Track announcements
const announced = [];
setAIProvider({
  announce: (msg) => { announced.push(String(msg)); }
});

async function run() {
  // ── Method pairing and API shape ──
  check('ReadAloud has speak and stop', typeof ReadAloud.speak === 'function' && typeof ReadAloud.stop === 'function');
  check('ReadAloud has pause and resume', typeof ReadAloud.pause === 'function' && typeof ReadAloud.resume === 'function');
  check('ReadAloud has toggle', typeof ReadAloud.toggle === 'function');
  check('ReadAloud has speakPage and speakSelection', typeof ReadAloud.speakPage === 'function' && typeof ReadAloud.speakSelection === 'function');
  check('ReadAloud has chunk and extractReadableText', typeof ReadAloud.chunk === 'function' && typeof ReadAloud.extractReadableText === 'function');

  // ── Rate clamping ──
  ReadAloud.setRate(1.2);
  check('setRate sets valid rate', ReadAloud.settings.rate === 1.2);
  ReadAloud.setRate(0.1);
  check('setRate clamps minimum to 0.5', ReadAloud.settings.rate === 0.5);
  ReadAloud.setRate(5.0);
  check('setRate clamps maximum to 2.0', ReadAloud.settings.rate === 2.0);
  ReadAloud.setRate(NaN);
  check('setRate ignores NaN', !Number.isNaN(ReadAloud.settings.rate));
  ReadAloud.setRate('invalid');
  check('setRate ignores invalid string', ReadAloud.settings.rate === 2.0);

  // ── Presets ──
  ReadAloud.applyPreset('slow');
  check('applyPreset slow sets rate to 0.7', ReadAloud.settings.rate === 0.7);
  ReadAloud.applyPreset('fast');
  check('applyPreset fast sets rate to 1.5', ReadAloud.settings.rate === 1.5);
  ReadAloud.applyPreset('normal');
  check('applyPreset normal sets rate to 1.0', ReadAloud.settings.rate === 1.0);

  // ── chunking ──
  check('chunk handles empty input', ReadAloud.chunk('').length === 0);
  check('chunk handles non-string', ReadAloud.chunk(null).length === 0);
  const shortText = 'Hello world. This is a short test.';
  const shortChunks = ReadAloud.chunk(shortText);
  check('chunk preserves short text', shortChunks.length === 1 && shortChunks[0] === shortText);

  const longSentence = 'A'.repeat(100) + ' ' + 'B'.repeat(100) + ' ' + 'C'.repeat(100);
  const longChunks = ReadAloud.chunk(longSentence);
  check('chunk breaks text exceeding CHUNK_CHARS', longChunks.length > 1);
  check('chunk pieces are not too long', longChunks.every(c => c.length <= 220));

  // ── extractReadableText ──
  const doc = mount(`
    <header><h1>Site Title</h1><nav><a href="#content">Skip</a></nav></header>
    <main id="content">
      <h1>Heading One</h1>
      <p>First paragraph of the story.</p>
      <p>Second paragraph with <strong>bold</strong> words.</p>
      <h2>Subheading</h2>
      <p>Paragraph without trailing punctuation</p>
      <p>Next paragraph.</p>
      <ul>
        <li>List item 1</li>
        <li>List item 2</li>
      </ul>
      <p aria-hidden="true">Hidden aria text.</p>
      <p hidden>Hidden attribute text.</p>
      <div role="status">Live status update.</div>
      <div role="alert">Alert message.</div>
      <div aria-live="polite">Polite live message.</div>
      <select><option>Option 1</option></select>
      <textarea>Textarea contents</textarea>
      <script>var x = 1;</script>
      <style>body { color: red; }</style>
    </main>
    <aside><h3>Sidebar</h3><p>Sidebar text.</p></aside>
    <footer><p>Footer text.</p></footer>
  `);

  const main = doc.querySelector('main');
  const text = ReadAloud.extractReadableText(main);

  check('extracts heading and paragraphs', text.includes('Heading One') && text.includes('First paragraph of the story.'));
  check('inserts pause between blocks without trailing punctuation', text.includes('Subheading. Paragraph without trailing punctuation. Next paragraph.'));
  check('extracts list items', text.includes('List item 1. List item 2'));
  check('skips aria-hidden content', !text.includes('Hidden aria text'));
  check('skips hidden attribute content', !text.includes('Hidden attribute text'));
  check('skips live regions (role=status, alert, aria-live)', !text.includes('Live status update') && !text.includes('Alert message') && !text.includes('Polite live message'));
  check('skips form menus and textareas', !text.includes('Option 1') && !text.includes('Textarea contents'));
  check('skips script and style', !text.includes('var x = 1') && !text.includes('color: red'));

  // Whole document extraction
  const bodyText = ReadAloud.extractReadableText(doc.body);
  check('skips header and nav', !bodyText.includes('Site Title') && !bodyText.includes('Skip'));
  check('skips aside', !bodyText.includes('Sidebar text'));
  check('skips footer', !bodyText.includes('Footer text'));

  // Null element
  check('extractReadableText handles null', ReadAloud.extractReadableText(null) === '');

  // ── speakPage with empty content ──
  announced.length = 0;
  const emptyDoc = mount('<main></main>');
  ReadAloud.speakPage();
  check('speakPage on empty page announces no text to read', announced.includes('Read aloud: no text to read on this page'));

  // ── speakSelection with empty selection ──
  announced.length = 0;
  window.getSelection = () => ({ toString: () => '' });
  ReadAloud.speakSelection();
  check('speakSelection on empty selection announces no text selected', announced.includes('No text selected'));

  // ── speakSelection with null selection ──
  announced.length = 0;
  window.getSelection = () => null;
  ReadAloud.speakSelection();
  check('speakSelection handles null getSelection without error', announced.includes('No text selected'));

  // ── Stop clears gesture and state ──
  ReadAloud.speaking = true;
  ReadAloud.paused = true;
  ReadAloud.waitForGesture('Hello', ReadAloud.run);
  check('waitForGesture sets gestureHandler', typeof ReadAloud.gestureHandler === 'function');
  ReadAloud.stop();
  check('stop clears speaking', ReadAloud.speaking === false);
  check('stop clears paused', ReadAloud.paused === false);
  check('stop clears gestureHandler', ReadAloud.gestureHandler === null);
}

run().then(() => {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}).catch((e) => {
  console.error('ERROR', e);
  process.exit(1);
});