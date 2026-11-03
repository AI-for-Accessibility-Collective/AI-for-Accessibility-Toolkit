'use strict';

module.exports = {
  sc: '4.1.3', title: 'Status Messages',
  rules: [
    {
      from: 'added',
      text: 'Status messages must be programmatically determinable through role or properties, so assistive technology can present them without the message receiving focus.',
      tools: ['probe_screen_reader_after_action', 'observe_state_after_activation'],
      rubric: `A status message is text that gives the user information on the result of an action, the waiting state, the progress of a process, or errors, and that is not given focus and does not change the context (WCAG definition) — "Added to cart", "3 results", "Saved", an error summary appearing after submit. Content the user asked to open (a menu, disclosure, tab panel, dialog), a new page, and content that receives focus are not status messages. It fails when a status message appears in a container with no live-region role or property — role="status", "alert" or "log", aria-live, <output> (F103); it passes when it is in one that was in the page before the message was inserted (the next rule), or is itself an alert (ARIA19, ARIA22, ARIA23). A native alert() dialog takes focus and is not a status message. Evidence: per change — the action performed (or the page left alone), the text and how it appeared, whether it sits in a live region and whether that region existed before, and the timeline of what live regions said while the action ran. First decide whether the text is a status message at all. probe_screen_reader_after_action reports what a screen reader announces after the action.`,
    },
    {
      from: 'added',
      text: 'The live region must exist before the status message is inserted into it.',
      tools: ['probe_screen_reader_after_action', 'observe_state_after_activation'],
      rubric: `Assistive technology announces changes to a live region already in the accessibility tree; a region created together with its message, or given its role after the message is in place, is often not announced (ARIA19, ARIA22: the live region is present in the page before content is inserted). It fails when the message's region did not exist before the action and no announcement results. Evidence: whether the region pre-existed, and what the screen-reader probe heard.`,
    },
    {
      from: 'added',
      text: 'A status conveyed by an image, icon or colour change must have a text alternative that is presented as a status message.',
      tools: ['probe_screen_reader_after_action'],
      rubric: `Understanding 4.1.3: a status message can be non-text content with a text alternative (1.1.1) — for example an icon that changes to show a process finished. It fails when the status is shown only by the image or colour change and no text for it is in a live region. Evidence: icons or images whose class, source or label changed, and whether they are in a live region.`,
    },
  ],
};
