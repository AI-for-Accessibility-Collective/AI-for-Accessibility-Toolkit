'use strict';

module.exports = {
  sc: '1.4.1', title: 'Use of Color',
  rules: [
    {
      from: 'gena11y',
      text: 'Links distinguished only by color must also have another visual indicator (underline, bold, different lightness, etc.).',
      tools: ['compute_contrast_ratio', 'render_with_overrides'],
      rubric: `A link inside running text fails when it differs from the surrounding text only by hue: no underline or other non-colour cue, and less than 3:1 lightness contrast with the text (F73). A link with at least 3:1 contrast against the text also needs a non-colour cue on hover and on focus (G183); without one it fails. It passes with any visible non-colour cue at rest (underline, weight, border, icon). Links set apart by position rather than text (navigation bars, lists of links, buttons) are not "in text" and are not tested here. Evidence: link and text colours with their ratio, and the non-colour cues found at rest, on hover and on focus. compute_contrast_ratio measures the lightness difference; render_with_overrides (grayscale) shows whether the link still stands out without hue.`,
    },
    {
      from: 'gena11y',
      text: 'Required or error form fields identified only by color must have an additional non-color indicator (asterisk, label text, icon, etc.).',
      tools: ['render_with_overrides', 'set_state_and_capture'],
      rubric: `A field whose required or error state is shown only by a colour change (a red border, a red label) fails (F81). It passes when text (an error message, "required", an asterisk explained on the page), an icon, or a change of border width or style also marks it. The state must exist to be tested: for errors, use the forms probe's submission crops, or set_state_and_capture after an invalid submission.`,
    },
    {
      from: 'added',
      text: 'The selected, current or active item among peers (tabs, navigation, pagination, filter chips, segmented buttons) must be marked by more than color.',
      tools: ['render_with_overrides', 'compute_contrast_ratio', 'resolve_part_color'],
      rubric: `Understanding 1.4.1: colour may not be the only visual means of distinguishing a visual element. The item in a state fails when the only properties that differ from its peers are colours (text, background or border colour of the same width and style) and the colours do not also differ strongly in lightness (≥ 3:1, so the difference survives greyscale). A bar, border width, weight, underline, icon or text change passes. Evidence: the property differences between the item and a peer, split into colour and non-colour. render_with_overrides (grayscale) settles whether the difference survives without hue.`,
    },
    {
      from: 'added',
      text: 'Charts, maps, diagrams and status icons must not convey information by color alone.',
      tools: ['request_hi_res_crop', 'render_with_overrides'],
      rubric: `A graphic fails when categories or states are distinguished only by colour — no labels, patterns, shapes or text next to them — so the information is lost without hue (Understanding 1.4.1, example: a chart legend keyed only by colour). It passes when direct labels, patterns or text carry the same information, including in the graphic's text alternative or adjacent text.`,
    },
  ],
};
