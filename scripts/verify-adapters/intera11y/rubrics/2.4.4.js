'use strict';

module.exports = {
  sc: '2.4.4', title: 'Link Purpose (In Context)',
  preamble: 'A link passes if its purpose is clear from its accessible name OR from its surrounding context (same sentence, paragraph, list item, or table cell).',
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
      tools: ['resolve_destination'],
      rubric: '',
    },
    {
      from: 'gena11y',
      text: '',
      tools: ['resolve_destination'],
      rubric: '',
    },
    {
      from: 'added',
      text: 'Elements that act as links (activating them navigates) without being marked up as links must also have a purpose that can be determined from their text or context.',
      tools: ['resolve_destination'],
      rubric: `A user meets an element that navigates when activated as a link, whatever its markup; 2.4.4 asks that the purpose of each link can be determined from its text, or its text with its programmatic context. It fails when its text (and context) does not tell where it goes. That it is not exposed with the link role is a 4.1.2 matter, not a 2.4.4 failure. Evidence: its computed role and name, visible text, and where activating it tried to go.`,
    },
  ],
};
