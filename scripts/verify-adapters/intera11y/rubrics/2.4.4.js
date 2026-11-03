'use strict';

module.exports = {
  sc: '2.4.4', title: 'Link Purpose (In Context)',
  preamble: 'A link passes if its purpose is clear from its accessible name OR from its surrounding context (same sentence, paragraph, list item, or table cell).',
  rules: [
    {
      from: 'gena11y',
      text: 'The link must have a non-empty accessible name.',
      tools: [],
      rubric: `A link exposed to assistive technology with an empty computed name fails (ACT c487ae; F89 for an image link whose image has no alternative). Evidence: the computed name and its source.`,
    },
    {
      from: 'gena11y',
      text: 'The link in context must be descriptive (not just "click here", "read more", etc. unless context clarifies the destination).',
      tools: ['resolve_destination'],
      rubric: `A link fails when neither its name nor its programmatically determined context — the enclosing sentence, paragraph, list item, or table cell with its headers, or text referenced by aria-describedby — tells the user its purpose (ACT 5effbb). Text that is only nearby (a preceding heading or block that is not the link's programmatic context) does not count (F63). In a table, other td cells in the same row are not automatically context for this link: only the enclosing cell and its associated row/column headers, or an explicit programmatic text association, count. Do not promote an unassociated data cell to a header. A destination fingerprint tells the tester where the link lands; it does not make an otherwise generic name descriptive to the user. A name that describes something other than where the link goes also leaves the purpose undeterminable. It passes when the name, or the name with that context, identifies the purpose, and when the purpose would be ambiguous to all users (2.4.4's exception). Evidence: name, visible text, destination, the programmatic context and, separately, nearby text that is not programmatically related.`,
    },
    {
      from: 'gena11y',
      text: 'Links with identical names in the same context must serve an equivalent purpose.',
      tools: ['resolve_destination'],
      rubric: `Links with the same accessible name and the same context fail when they lead to different resources or do different things (ACT fd3a94). Same-named links to the same destination, or to equivalent content, pass. resolve_destination (pass the whole set) reads where each link actually lands.`,
    },
    {
      from: 'added',
      text: 'Elements that act as links (activating them navigates) without being marked up as links must also have a purpose that can be determined from their text or context.',
      tools: ['resolve_destination'],
      rubric: `A user meets an element that navigates when activated as a link, whatever its markup; 2.4.4 asks that the purpose of each link can be determined from its text, or its text with its programmatic context. It fails when its text (and context) does not tell where it goes. That it is not exposed with the link role is a 4.1.2 matter, not a 2.4.4 failure. Evidence: its computed role and name, visible text, and where activating it tried to go.`,
    },
  ],
};
