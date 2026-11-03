'use strict';

module.exports = {
  sc: '2.1.2', title: 'No Keyboard Trap',
  rules: [
    {
      from: 'added',
      text: 'If keyboard focus can be moved to a component, focus must be able to be moved away from it using only the keyboard.',
      tools: ['interact_and_observe', 'observe_state_after_activation'],
      rubric: `It fails when, from inside a component (a region, widget, embedded object, iframe, dialog or single element), Tab and Shift+Tab both keep focus inside and no standard exit — Escape for a dialog, menu or pop-up; arrow keys within a composite widget followed by Tab; a keyboard-operable close control inside it — releases it (F10; Trusted Tester 4.B). It also fails when an element returns focus to itself whenever focus leaves it, and when the Tab sequence loops back into itself so that content after the loop can never be reached. It passes for a modal dialog that holds focus while open but closes with Escape or a keyboard-operable close or cancel control, and for a trap in one direction when the other standard direction lets focus leave and reach the rest of the page. Evidence: the recorded Tab sequence and how it ended (across the document boundary is normal; revisiting a stop without reaching the boundary means focus looped), tabbable elements never reached, and the region, focus-retention and fixed-set detector results (directions trapped, whether Escape or a close control released focus). interact_and_observe (focus an element inside, then press Tab, Shift+Tab, Escape; read activeAfter) tests it live.`,
    },
    {
      from: 'added',
      text: 'If moving focus away requires more than unmodified arrow or Tab keys or other standard exit methods, the user must be advised of the method, and the method must work.',
      tools: ['interact_and_observe'],
      rubric: `2.1.2's second condition: an exit that needs a non-standard key fails when the page does not tell the user about it, or when the advised key does not release focus. An advised non-standard method that demonstrably releases focus satisfies this condition; a Tab loop alone does not establish failure when such a method works. If an advised method is present but has not been tested, actually press it with interact_and_observe from inside the component and observe focus afterwards. Missing observations are not a failed exit; use UNDETERMINED if it cannot be tested. Evidence: any advised exit key the detectors found and what pressing it did.`,
    },
  ],
};
