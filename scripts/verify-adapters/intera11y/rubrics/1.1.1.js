'use strict';

module.exports = {
  sc: '1.1.1', title: 'Non-text Content',
  rules: [
    {
      from: 'gena11y',
      text: '',
      tools: [],
      rubric: '',
    },
    {
      from: 'gena11y',
      text: '',
      tools: ['request_hi_res_crop', 'query_ax_node'],
      rubric: '',
    },
    {
      from: 'gena11y',
      text: '',
      tools: ['request_hi_res_crop'],
      rubric: '',
    },
    {
      from: 'gena11y',
      text: '',
      tools: ['request_hi_res_crop'],
      rubric: '',
    },
    {
      from: 'gena11y',
      text: '',
      tools: [],
      rubric: '',
    },
    {
      from: 'added',
      text: 'Text alternatives must serve the equivalent purpose of the non-text content in its context (the text shown in an image of text, the key facts of a chart, the destination or action of an image inside a link or button).',
      tools: ['request_hi_res_crop', 'compare_named_regions', 'query_ax_node'],
      rubric: `1.1.1 requires a text alternative "that serves the equivalent purpose". It fails when information needed to understand the image in context is unavailable through its alternative or associated accessible content: essential image text, chart facts, or relevant photographic content (F30, F20 when the alternative is not updated with the image). For an image used as a link or button, evaluate the control's complete accessible name and local context. If accessible control text or an independently supplied label already conveys its purpose, an accurate supplementary image description need not repeat the action or destination; a non-empty alternative is not itself a failure. Empty alt is one way to avoid redundancy, not a universal requirement for images alongside named controls. A control name derived solely from this same image alternative is not independent evidence that the alternative is adequate. An unnamed functional image in an unnamed control still fails. Use query_ax_node when the control name/state is uncertain; request_hi_res_crop reads small image text; compare_named_regions measures visual distinctions.`,
    },
    {
      from: 'added',
      text: 'Images hidden from assistive technology (empty alt, role="presentation"/"none", aria-hidden, CSS background images) must not withhold information or functionality unavailable through accessible content.',
      tools: ['request_hi_res_crop', 'query_ax_node'],
      rubric: `An image absent from the accessibility tree fails when it carries meaningful information unavailable through accessible alternatives (ACT e88epe; F3 for information conveyed only by a CSS background image). It passes when it is decoration, spacing, or repeats accessible text, the enclosing control's accessible name, or an exposed control state. A visual selected/checked/expanded indicator does not need a separate text alternative when the corresponding state is already exposed to assistive technology. Confirm the enclosing control's computed name/state with supplied evidence or query_ax_node; an empty textContent is not proof of an empty accessible name. Do not assume every recognizable icon or brand graphic adds necessary information: judge its actual purpose and redundancy in context. Unrelated page text or a hidden duplicate does not establish an accessible alternative.`,
    },
    {
      from: 'added',
      text: 'Video and audio must have a text alternative that at least provides descriptive identification of the content.',
      tools: ['request_hi_res_crop'],
      rubric: `For time-based media, 1.1.1 requires text alternatives that at least provide descriptive identification (G68, G100): a name, title, caption or adjacent text that says what the media is. It fails when a video or audio element carries no such identification — no accessible name, no labelling or adjacent text naming it. A decorative background video that conveys nothing and is hidden from assistive technology passes. Evidence: computed name, title, caption, the text around it, and a crop of the poster frame.`,
    },
    {
      from: 'added',
      text: 'Characters used as pictures — look-alike letters from other scripts, ASCII art, emoticons — must have a text alternative.',
      tools: [],
      rubric: `WCAG's definition of non-text content includes ASCII art, emoticons and leetspeak (character substitution): a word spelled with letters from another script reads as those other characters. It fails when such content carries meaning and no text alternative is exposed (e.g. an aria-label or adjacent text giving the intended word). Evidence: the word and its code points.`,
    },
  ],
};
