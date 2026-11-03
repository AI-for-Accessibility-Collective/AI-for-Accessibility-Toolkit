'use strict';

module.exports = {
  sc: '2.1.1', title: 'Keyboard',
  rules: [
    {
      from: 'added',
      text: 'Every control that can be operated with a pointer must be reachable with the keyboard and operable with Enter, Space or the keys its role implies.',
      tools: ['interact_and_observe', 'observe_state_after_activation'],
      rubric: `2.1.1 requires all functionality to be operable through a keyboard interface. It fails when a control that does something on click cannot receive keyboard focus (F54, F42), or receives focus but Enter/Space — or the keys its role implies, such as arrows in a slider, menu, listbox, grid or tab list — do nothing while a click does something (Trusted Tester 4.A). It passes when the same function is available from another keyboard-operable control on the page (say which), when the click handler does nothing a user notices or only forwards to a keyboard-operable element it contains, and for functionality that depends on the path of pointer movement (2.1.1's exception, e.g. freehand drawing). Drag-and-drop passes only with a keyboard way to do the same thing. Evidence: whether the element is in the recorded Tab sequence, its handlers, what Enter and Space did, what a click did, and arrow-key movement inside composite widgets. interact_and_observe tries keys on the focused element and compares with click.`,
    },
    {
      from: 'added',
      text: 'A control must not remove keyboard focus from itself when it receives it.',
      tools: ['interact_and_observe'],
      rubric: `A component that moves focus away as soon as it receives it cannot be operated from the keyboard (F55).`,
    },
    {
      from: 'added',
      text: 'Content and controls that appear on pointer hover must also be reachable with the keyboard.',
      tools: ['interact_and_observe'],
      rubric: `It fails when hovering is the only way to reveal controls or content that are not otherwise reachable from the keyboard (F54: functionality provided only through pointer-specific event handlers). It passes when focusing the trigger reveals the same content, or the content is reachable another way. Evidence: what hovering revealed, whether the trigger takes focus, whether focus reveals the same content.`,
    },
    {
      from: 'added',
      text: 'Scrollable regions must be reachable with sequential keyboard navigation, and iframes containing visible, sequentially focusable functionality must not be removed from the Tab order.',
      tools: ['interact_and_observe'],
      rubric: `A scrollable region fails when neither it nor any element inside it can receive keyboard focus, so its content cannot be scrolled with the keyboard (ACT 0ssw9k). An iframe with tabindex="-1" fails this condition only when it contains visible functionality in the frame's sequential focus order (ACT akn7bn). A link in srcdoc alone does not establish visibility: content can be clipped out of a small frame, hidden or inert, or itself removed from the frame's Tab order. Inspect the rendered frame content before concluding that pointer-accessible functionality is lost.`,
    },
    {
      from: 'added',
      text: 'Keyboard operation must not require specific timings for individual keystrokes.',
      tools: ['interact_and_observe'],
      rubric: `2.1.1 requires operation "without requiring specific timings for individual keystrokes". It fails when an operation happens only while a key is held for a duration, with no alternative. Evidence: whether the control responded only to a held key.`,
    },
  ],
};
