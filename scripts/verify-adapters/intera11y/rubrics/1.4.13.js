'use strict';

module.exports = {
  sc: '1.4.13', title: 'Content on Hover or Focus',
  rules: [
    {
      from: 'added',
      text: 'Additional content that appears on pointer hover or keyboard focus must be dismissible without moving pointer hover or keyboard focus, unless it communicates an input error or does not obscure or replace other content.',
      tools: ['interact_and_observe', 'measure_geometry_live'],
      rubric: `It fails when the content covers or replaces other content and no mechanism dismisses it without moving the pointer or focus — Escape, the usual mechanism, does nothing (Understanding 1.4.13). Content that overlaps nothing else, or that reports an input error, need not be dismissible. Evidence: whether the revealed content overlaps other visible text, and what Escape did with the pointer unmoved and with focus on the trigger.`,
    },
    {
      from: 'added',
      text: 'If pointer hover can trigger the additional content, the pointer must be able to move over that content without it disappearing.',
      tools: ['interact_and_observe', 'measure_geometry_live'],
      rubric: `It fails when the content disappears as the pointer moves from the trigger onto it, for example across a gap (F95). Evidence: whether the content was still visible after the pointer travelled onto it by the shortest path. interact_and_observe with hover and move steps reproduces it (read revealedNow).`,
    },
    {
      from: 'added',
      text: 'The additional content must remain visible until the hover or focus trigger is removed, the user dismisses it, or its information is no longer valid.',
      tools: ['interact_and_observe'],
      rubric: `It fails when still-valid content disappears on a timeout while hover or focus remains (Understanding 1.4.13). Disappearance is allowed when the information becomes invalid, for example an expired reservation or a completed busy state. Check the accompanying state/text changes before treating elapsed time alone as a failure. Exempt: content the browser controls, such as the title attribute tooltip; pop-ups that open on click, not hover or focus. Evidence: whether it was still visible after 6 s with the pointer still.`,
    },
  ],
};
