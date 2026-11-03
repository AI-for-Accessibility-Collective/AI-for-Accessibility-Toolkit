'use strict';

module.exports = {
  sc: '2.4.7', title: 'Focus Visible',
  rules: [
    {
      from: 'added',
      text: 'Every element that can receive keyboard focus must show a visible focus indicator when focused.',
      tools: ['set_state_and_capture', 'interact_and_observe', 'measure_geometry_live'],
      rubric: `It fails when nothing visibly changes when the element receives keyboard focus, or the change is too slight to perceive (F78: styling that removes or renders the focus indicator non-visible; Trusted Tester 4.D), when the element or the only part that changes is not visible while focused (off-screen, clipped, transparent), and when the page removes focus as soon as it arrives (F55). It passes when a sighted keyboard user comparing before and after could tell which element has focus: an outline, ring, border, underline, background, colour or shape change, or a text caret, on or around the element, or a change elsewhere that clearly identifies this element (a highlighted row or label). No contrast threshold applies (that is 2.4.13). Focus on an iframe element itself is exempt (Trusted Tester 4.D). Evidence: crops with and without focus after a real Tab, pixels changed near the element and in the viewport, the element's perimeter, the mean colour distance of the change, the computed-style properties that differ, and whether the element was visible when focused. set_state_and_capture (focus) or interact_and_observe (press Tab) looks again. Read capture validity and focusMethod as measurement provenance. A fresh capture that manually scrolls or uses programmatic fallback does not reproduce the original sequential keyboard state and cannot overturn an observed hidden or missing indicator in that state. A CSS :focus-visible match alone is not a measured indicator.`,
    },
    {
      from: 'added',
      text: 'Focus moving within a composite widget (menu, listbox, grid, tab list, tree) must be visible.',
      tools: ['interact_and_observe', 'set_state_and_capture'],
      rubric: `Inside a composite widget, arrow keys move focus (or the active descendant) between items; it fails when that current item is not visibly marked as it moves (F78). Evidence: after each arrow key, where focus or the active descendant went and how many pixels changed inside the widget, with an image.`,
    },
  ],
};
