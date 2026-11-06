// The parts of a server review (run.mjs --review-file --focus <id>): each is
// one reviewer, and they run at the same time (agent-host/src/checks.js),
// then their reports are put together in this order. The WCAG criteria
// InterA11y has rubrics for (intera11y.mjs RUBRIC_SCS) are split by what
// they test, so each rubric is read by one reviewer only:
//   code      the adapter's code: enable() and disable(), putting the page
//             back, errors, performance, privacy, and whether it does what
//             it is for. No rubrics.
//   perceive  what people see and read: text alternatives, colour, content
//             shown on hover or focus, link names, error messages.
//   operate   using the page: the keyboard, traps, focus order and focus
//             visible, and what assistive technology announces.
// Pure: no imports, so the agent host reads it without the verifier.

export const REVIEW_FOCUSES = Object.freeze([
  { id: 'code', title: 'The code', scs: [] },
  { id: 'perceive', title: 'What people see and read', scs: ['1.1.1', '1.4.1', '1.4.13', '2.4.4', '3.3.1'] },
  { id: 'operate', title: 'Keyboard, focus and announcements', scs: ['2.1.1', '2.1.2', '2.4.3', '2.4.7', '4.1.3'] },
]);

/** The part named `id`, or null. */
export const focusOf = (id) => REVIEW_FOCUSES.find((f) => f.id === id) || null;
