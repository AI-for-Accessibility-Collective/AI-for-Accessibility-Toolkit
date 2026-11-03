'use strict';

module.exports = {
  sc: '2.4.3', title: 'Focus Order',
  rules: [
    {
      from: 'added',
      text: 'Focusable elements must receive focus in an order that preserves meaning and operability (positive tabindex, CSS reordering, and DOM order that differs from the visual order are the usual causes).',
      tools: ['capture_full_page', 'interact_and_observe'],
      rubric: `Judge the whole Tab sequence against the page's layout. It fails when the order breaks the meaning or operation of the content: positive tabindex or DOM order sends focus out of the logical sequence (F44), for example form fields in a confusing order, or fields that belong together separated by unrelated stops. It passes when the order follows the page's regions and columns even if it is not strictly left-to-right, top-to-bottom (Understanding 2.4.3: more than one order can preserve meaning — a sidebar before or after the main column, a row-major or column-major order that matches how the content is read). Extra stops on non-interactive content fail only when they break the sequence's meaning or operation (for example a stop wedged between two controls that are used together); a stop that is merely redundant is not a failure of this criterion. Evidence: the recorded sequence with each stop's position, and an image numbering every stop where it appears.`,
    },
    {
      from: 'added',
      text: 'Content opened by a control (menu, dialog, disclosure) must come next in the focus order, and a modal dialog must keep focus inside while open.',
      tools: ['interact_and_observe', 'observe_state_after_activation'],
      rubric: `F85 fails a dialog or menu that is not adjacent to its trigger in the sequential navigation order: after opening, focus neither moves into the content nor reaches it with the next Tab. A modal dialog fails when Tab or Shift+Tab moves focus to the page behind it while it is open (Understanding 2.4.3, SCR37). It passes when focus moves into the opened content, or the content follows its trigger in the DOM so the next Tab reaches it. Evidence: for each control that opened content, where focus went and where the next Tab and Shift+Tab went. interact_and_observe (click or focus + Enter, then Tab steps; read activeAfter) checks it live. Keep opening and subsequent navigation in one workflow. For a modal-escape observation, distinguish focus on background page content while the modal remains open from a closed dialog or the browser/document boundary; shadow and frame descendants inside the modal are contained.`,
    },
  ],
};
