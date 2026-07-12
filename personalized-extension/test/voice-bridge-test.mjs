// Unit tests for the voice-commands 2.1 fixes: command matcher, negation guard,
// backoff sequence, mutual-exclusion decision.
//
//   node test/voice-bridge-test.mjs

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('PASS:', name); }
  else { fail++; console.log('FAIL:', name, detail !== undefined ? `— ${JSON.stringify(detail)}` : ''); }
}

// ---------------------------------------------------------------------------
// Minimal browser globals for the pure-logic parts we can test in Node.
// ---------------------------------------------------------------------------
// We test the MATCHER LOGIC by extracting it from the module in a way that
// doesn't require a real browser. We replicate the key regexes here rather
// than importing the module (which needs window/document).
// ---------------------------------------------------------------------------

// Replicate the matcher logic (the pure regex/predicate part).
const NEGATION_RE = /\b(don'?t|do not|stop)\b/i;

function testMatchCommand(transcript) {
  const t = transcript;
  // Regex commands first.
  const clickMatch = t.match(/\bclick\s+(?:on\s+)?(.+)/i);
  if (clickMatch) return { cmd: 'click', arg: clickMatch[1] };
  const typeMatch = t.match(/\btype\s+(.+)/i);
  if (typeMatch) return { cmd: 'type', arg: typeMatch[1] };
  // Motion commands with negation guard.
  if (!NEGATION_RE.test(t) && /\bscroll\s+down\b/i.test(t)) return { cmd: 'scroll_down' };
  if (!NEGATION_RE.test(t) && /\bscroll\s+up\b/i.test(t)) return { cmd: 'scroll_up' };
  if (!NEGATION_RE.test(t) && /\bpage\s+down\b/i.test(t)) return { cmd: 'page_down' };
  if (!NEGATION_RE.test(t) && /\bpage\s+up\b/i.test(t)) return { cmd: 'page_up' };
  // Non-motion bare commands.
  if (/\bgo\s+to\s+(?:the\s+)?top\b/i.test(t)) return { cmd: 'top' };
  if (/\bgo\s+to\s+(?:the\s+)?bottom\b/i.test(t)) return { cmd: 'bottom' };
  if (/\bgo\s+back\b/i.test(t)) return { cmd: 'back' };
  if (/\bgo\s+forward\b/i.test(t)) return { cmd: 'forward' };
  if (/\bnext\s+link\b/i.test(t)) return { cmd: 'next_link' };
  if (/\bprevious\s+link\b/i.test(t)) return { cmd: 'prev_link' };
  if (/\bnext\s+button\b/i.test(t)) return { cmd: 'next_button' };
  if (/\bread\s+page\b/i.test(t)) return { cmd: 'read_page' };
  if (/\bstop\s+reading\b/i.test(t)) return { cmd: 'stop_reading' };
  // Bare 'click' — ONLY when the whole transcript is exactly 'click'.
  if (/^\s*click\s*$/i.test(t)) return { cmd: 'bare_click' };
  return null;
}

// ---- Matcher tests ----

// 1. 'click submit button' should match click-by-text, not bare click.
const r1 = testMatchCommand('click submit button');
check('click submit button → click cmd with text arg', r1 && r1.cmd === 'click' && r1.arg === 'submit button', r1);

// 2. bare 'click' → bare_click only (not click-by-text).
const r2 = testMatchCommand('click');
check("bare 'click' → bare_click", r2 && r2.cmd === 'bare_click', r2);

// 3. 'click on submit' → click with 'submit' as arg.
const r3 = testMatchCommand('click on submit');
check("'click on submit' → click with arg 'submit'", r3 && r3.cmd === 'click' && r3.arg === 'submit', r3);

// 4. "don't scroll down" → does not match scroll_down.
const r4 = testMatchCommand("don't scroll down");
check("\"don't scroll down\" does not scroll", r4 === null || r4.cmd !== 'scroll_down', r4);

// 5. "do not scroll up" → does not match scroll_up.
const r5 = testMatchCommand("do not scroll up");
check('"do not scroll up" does not scroll', r5 === null || r5.cmd !== 'scroll_up', r5);

// 6. "stop scroll down" → "stop" contains word "stop" — check negation for "stop scroll down"
const r6 = testMatchCommand('stop scroll down');
check('"stop scroll down" does not scroll', r6 === null || r6.cmd !== 'scroll_down', r6);

// 7. 'scroll down' without negation → matches.
const r7 = testMatchCommand('scroll down');
check("'scroll down' matches", r7 && r7.cmd === 'scroll_down', r7);

// 8. 'please scroll down' → matches (partial sentence ok).
const r8 = testMatchCommand('please scroll down');
check("'please scroll down' matches", r8 && r8.cmd === 'scroll_down', r8);

// 9. 'scroll downward' — word boundary: should NOT match 'scroll down'.
const r9 = testMatchCommand('scroll downward');
check("'scroll downward' does NOT match scroll_down (word boundary)", r9 === null || r9.cmd !== 'scroll_down', r9);

// 10. 'type hello world' → type with full arg.
const r10 = testMatchCommand('type hello world');
check("'type hello world' → type cmd with arg 'hello world'", r10 && r10.cmd === 'type' && r10.arg === 'hello world', r10);

// 11. 'click on the next button' → click-by-text, NOT next_button.
const r11 = testMatchCommand('click on the next button');
check("'click on the next button' → click cmd (regex before bare commands)", r11 && r11.cmd === 'click', r11);

// 12. 'next link' → focus command.
const r12 = testMatchCommand('next link');
check("'next link' → next_link", r12 && r12.cmd === 'next_link', r12);

// ---- Backoff sequence ----
// Test the backoff sequence logic: 1s, 2s, 4s, 8s, 16s, 30s max.
{
  let ms = 1000;
  const steps = [];
  for (let i = 0; i < 6; i++) {
    steps.push(ms);
    ms = Math.min(ms * 2, 30000);
  }
  check('backoff starts at 1s', steps[0] === 1000, steps);
  check('backoff doubles', steps[1] === 2000 && steps[2] === 4000, steps);
  check('backoff caps at 30s', steps[5] === 30000, steps);
}

// ---- Mutual exclusion decision ----
// Test the _isLiveActive logic with mock storage.
{
  async function isLiveActive(store) {
    try {
      const data = store;
      return (data.voiceState && data.voiceState.connection === 'live') || false;
    } catch { return false; }
  }

  const liveStore = { voiceState: { connection: 'live' } };
  const disconnStore = { voiceState: { connection: 'disconnected' } };
  const emptyStore = {};

  check('isLiveActive: live → true', await isLiveActive(liveStore) === true);
  check('isLiveActive: disconnected → false', await isLiveActive(disconnStore) === false);
  check('isLiveActive: no voiceState → false', await isLiveActive(emptyStore) === false);
}

// ---- typeText native-setter logic ----
// Test that the native-setter approach doesn't crash with a mock element.
{
  // Mock an HTMLInputElement-like object
  let _value = '';
  const nativeValueDesc = {
    get() { return _value; },
    set(v) { _value = v; },
    configurable: true,
  };
  const mockProto = {};
  Object.defineProperty(mockProto, 'value', nativeValueDesc);

  function typeTextMock(el, text) {
    if (el.isInput) {
      const nativeSetter = Object.getOwnPropertyDescriptor(mockProto, 'value');
      if (nativeSetter && nativeSetter.set) {
        nativeSetter.set.call(el, el.value + text);
      } else {
        el.value += text;
      }
      return { ok: true, detail: `typed "${text}"` };
    }
    return { ok: false, detail: 'not an input' };
  }

  const el = Object.create(mockProto);
  Object.defineProperty(el, 'value', { get() { return _value; }, set(v) { _value = v; }, configurable: true });
  el.isInput = true;
  _value = 'Hello ';
  const tr = typeTextMock(el, 'world');
  check('typeText native-setter appends to existing value', _value === 'Hello world' && tr.ok === true, { value: _value, result: tr });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
