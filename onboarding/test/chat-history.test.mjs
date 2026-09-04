// The composer's Up/Down command history.
//
// Small, but three rules are easy to break silently: consecutive duplicates are
// skipped, the in-progress draft is preserved when you arrow up and restored
// when you arrow back past the newest entry, and a corrupt or unavailable store
// must not take the composer down with it.
//
//   node onboarding/test/chat-history.test.mjs

import { createHistory, onFirstLine, onLastLine } from '../chat-history.js';

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('PASS:', name); }
  else { fail++; console.log('FAIL:', name); }
}
// A textarea-shaped value, with | marking the caret.
const ta = (text) => ({ value: text.replace('|', ''), selectionStart: text.indexOf('|'), selectionEnd: text.indexOf('|') });

// ── recording ────────────────────────────────────────────────────────────────
{
  const h = createHistory({});
  h.push('bigger text');
  h.push('dark mode');
  check('entries are recorded in order', h.entries.join('|') === 'bigger text|dark mode');

  h.push('dark mode');
  check('a consecutive duplicate is skipped', h.entries.length === 2);

  h.push('bigger text');
  check('a NON-consecutive repeat is kept', h.entries.join('|') === 'bigger text|dark mode|bigger text');

  h.push('');
  h.push('   ');
  check('empty and whitespace-only entries are skipped', h.entries.length === 3);

  h.push('  padded  ');
  check('entries are trimmed', h.entries[h.entries.length - 1] === 'padded');
}

// ── the cap ──────────────────────────────────────────────────────────────────
{
  const h = createHistory({ max: 3 });
  for (const t of ['a', 'b', 'c', 'd', 'e']) h.push(t);
  check('the ring is capped', h.size === 3);
  check('the OLDEST entries are the ones dropped', h.entries.join('') === 'cde');

  // A store written by an older build (or edited by hand) can be over the cap.
  const loaded = createHistory({ max: 2, load: () => ['a', 'b', 'c', 'd'] });
  check('an over-long stored history is capped on load', loaded.entries.join('') === 'cd');
}

// ── recall ───────────────────────────────────────────────────────────────────
{
  const h = createHistory({});
  h.push('first');
  h.push('second');

  check('Up recalls the newest first', h.prev('') === 'second');
  check('Up again walks further back', h.prev('') === 'first');
  check('Up at the oldest entry stops', h.prev('') === null);
  check('Down walks forward again', h.next() === 'second');
}

// ── the draft is preserved ───────────────────────────────────────────────────
// The thing a person notices immediately if it breaks: arrowing up mid-sentence
// and losing what they were typing.
{
  const h = createHistory({});
  h.push('bigger text');

  check('arrowing up shows the entry', h.prev('half-typed thought') === 'bigger text');
  check('arrowing back down restores the draft', h.next() === 'half-typed thought');
  check('Down past the newest stops', h.next() === null);
  check('the composer is back at the draft', h.atDraft === true);
}

{
  const h = createHistory({});
  h.push('one');
  h.prev('my draft');
  h.push('sent something else');
  check('sending resets the position to the draft end', h.atDraft === true);
  // push() also clears the remembered draft, but that is state hygiene with no
  // observable effect: prev() at the draft end always overwrites it first, so
  // it cannot be asserted through the public API and is not.
  check('…and Up then recalls the text just sent', h.prev('') === 'sent something else');
}

{
  const empty = createHistory({});
  check('Up on an empty history does nothing', empty.prev('draft') === null);
  check('Down on an empty history does nothing', empty.next() === null);
}

// ── the store is untrusted ───────────────────────────────────────────────────
{
  check('a throwing load leaves an empty history', createHistory({ load: () => { throw new Error('blocked'); } }).size === 0);
  check('a non-array load is ignored', createHistory({ load: () => ({ nope: true }) }).size === 0);
  check('null from the store is ignored', createHistory({ load: () => null }).size === 0);

  const mixed = createHistory({ load: () => ['ok', 42, null, { a: 1 }, 'also ok'] });
  check('non-string entries are filtered out', mixed.entries.join('|') === 'ok|also ok');

  const h = createHistory({ load: () => [], save: () => { throw new Error('quota'); } });
  h.push('bigger text');
  check('a failing save does not break the turn', h.size === 1);
}

{
  const saved = [];
  const h = createHistory({ load: () => [], save: (e) => saved.push(e.slice()) });
  h.push('one');
  h.push('one'); // duplicate — must not write again
  check('a save happens on a real entry', saved.length === 1);
  check('a skipped duplicate does not write', saved.length === 1);
  check('what is written is the whole ring', saved[0].join() === 'one');
}

// ── caret rules ──────────────────────────────────────────────────────────────
// Recall only fires at the edges, so a multi-line draft still moves the cursor.
{
  check('a caret on the only line is on the first line', onFirstLine(ta('bigger| text')) === true);
  check('…and on the last line', onLastLine(ta('bigger| text')) === true);

  check('a caret on line 2 of 2 is NOT on the first line', onFirstLine(ta('one\ntw|o')) === false);
  check('…but is on the last line', onLastLine(ta('one\ntw|o')) === true);

  check('a caret on line 1 of 2 IS on the first line', onFirstLine(ta('on|e\ntwo')) === true);
  check('…and is NOT on the last line', onLastLine(ta('on|e\ntwo')) === false);

  const selection = { value: 'bigger text', selectionStart: 0, selectionEnd: 6 };
  check('a selection is not a caret, so Up does not recall', onFirstLine(selection) === false);
  check('…and neither does Down', onLastLine(selection) === false);
}

console.log(`\nChat history: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
