'use strict';

module.exports = {
  sc: '1.4.1', title: 'Use of Color',
  rules: [
    {
      from: 'gena11y',
      text: '',
      tools: ['compute_contrast_ratio', 'render_with_overrides'],
      rubric: '',
    },
    {
      from: 'gena11y',
      text: '',
      tools: ['render_with_overrides', 'set_state_and_capture'],
      rubric: '',
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
