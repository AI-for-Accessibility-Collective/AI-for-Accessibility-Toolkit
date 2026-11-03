'use strict';

module.exports = {
  sc: '1.1.1', title: 'Non-text Content',
  rules: [
    {
      from: 'gena11y',
      text: 'Image buttons must have a non-empty accessible name.',
      tools: [],
      rubric: `An <input type="image"> (or a button whose only content is an image) exposed to assistive technology with an empty computed name fails (ACT 59796f; F65). Evidence: the computed name and its source.`,
    },
    {
      from: 'gena11y',
      text: 'Images must have non-empty accessible names unless decorative (alt="", role="presentation", aria-hidden="true").',
      tools: ['request_hi_res_crop', 'query_ax_node'],
      rubric: `An <img>, role="img" element or image-map <area> that is exposed to assistive technology and has an empty computed name fails (ACT 23a2a8; F65). An image inside a link or button that is marked decorative (alt="", role="presentation" or "none") passes when the control's own accessible name conveys the purpose (H2); an image with no alt attribute is not marked decorative — it is still exposed, with no name, and fails even inside a named control (ACT 23a2a8). Evidence: alt attribute, computed name and source, whether it is hidden from assistive technology, and the enclosing control's computed name and state. query_ax_node resolves those accessibility facts when the supplied control evidence is incomplete.`,
    },
    {
      from: 'gena11y',
      text: 'Accessible names must be meaningful, not just filenames or "image".',
      tools: ['request_hi_res_crop'],
      rubric: `A text alternative that is a file name or meaningless placeholder ("image", "photo", "graphic") fails (ACT qt1vmo; F30). Judge its equivalent purpose in the local content: a short contextual identifier may be meaningful when nearby accessible text supplies the specific identity or information. Do not require that the image alternative repeat that text or describe every visual detail. Generic text unrelated to the image does not establish equivalence. Compare the crop, alternative, and local text context.`,
    },
    {
      from: 'gena11y',
      text: 'Object elements must have accessible names.',
      tools: ['request_hi_res_crop'],
      rubric: `An <object> that renders non-text content (an image, a plug-in) fails when it exposes no name and no fallback content that serves as its alternative (ACT 8fc3b6).`,
    },
    {
      from: 'gena11y',
      text: 'SVG elements with explicit roles must have accessible names.',
      tools: [],
      rubric: `An <svg> (or an element inside one) with an explicitly authored role="img", "graphics-document" or "graphics-symbol" fails when its computed name is empty (ACT 7d6734). A browser-computed image role does not establish an explicit author role. For an SVG without an explicit role, determine whether it conveys information in context; a simple ornamental shape with no informational function is decorative, and visibility or an empty name alone does not establish failure.`,
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
