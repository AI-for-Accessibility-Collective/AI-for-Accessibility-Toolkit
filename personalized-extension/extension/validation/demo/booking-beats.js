// The booking.com demo storyline, as data. Every line is verbatim from the
// blessed register (storyline v5, 2026-08-23) - do not reword here; edit the
// storyline first, then mirror it.
//
// `when` is the relation the beat fires on, computed from live page state -
// roles, never memorized numbers. The named hotels are the roles' holders on
// the rehearsal captures; the director resolves them fresh each run. **bold**
// marks deltas and commitments, visual channel only.
//
// The live demo ends at the gate - nothing is paid. Beats with `post: true`
// only play in mock mode (harness ?post=1) or from replay footage.

export const SCENARIO = {
  prompt: 'book us a hotel near stanford for sep 15 to 17 - 2 adults and our '
    + '8-year-old, and make sure we can cancel if plans change',
  cast: 'Susan Miller (screen reader, booking) · Ryan · Ashley (incoming freshman) · Emma, 8',
  site: 'https://www.booking.com',
};

export const BEATS = [
  { id: 'contract', kind: 'checkpoint', page: 'home',
    when: 'the prompt is parsed; no budget was given',
    say: "Got it. A hotel near Stanford, September 15 to 17, for three people, and it has to be cancellable. No budget yet, so I'll ask when the prices are real." },

  { id: 'stanfords', kind: 'widget', page: 'home',
    when: 'the destination autocomplete returns more than one match for the typed place',
    say: 'Several matches for "Stanford". Two are for Stanford University. Three are hotels in Anaheim, San Francisco, and Seoul.',
    options: [
      { label: 'Stanford University, the campus in Palo Alto', primary: true },
      { label: 'Stanford Stadium, also in Palo Alto' },
      { label: 'Stanford Inn & Suites. A hotel in Anaheim, 350 miles away' },
      { label: 'Stanford Court, a hotel in San Francisco' },
      { label: 'Stanford Hotel Myeongdong, a hotel in Seoul, South Korea' },
    ] },

  { id: 'winnow', kind: 'checkpoint', page: 'results',
    when: 'the result count lands and the property-type facet is readable',
    say: "Found 100 places. You asked for a hotel, so I'm skipping the motels. This leaves 63." },

  { id: 'sort', kind: 'checkpoint', page: 'results',
    when: 'the page discloses that payments affect ranking',
    say: "The sort order here is partly paid ads. I'm sorting by price and distance instead." },

  { id: 'ad', kind: 'checkpoint', page: 'results',
    when: 'a result inside the organic list carries the Ad badge',
    say: "The second result is an ad, so I'm skipping it." },
  { id: 'ad-log', kind: 'log', page: 'results',
    when: 'filed as the ad checkpoint fires',
    say: 'Skipped 1 ad (Hotel Citrine, $1,658)' },

  { id: 'collision', kind: 'widget', page: 'results',
    when: 'the closest hotel\'s recommended room sleeps fewer than the party, and no budget is on file',
    say: "The closest hotel only has **one king bed** for the three of you. Emma would have **no bed**. And it starts at **$1,870**. What's your budget?",
    options: [
      { label: 'Under $700. 2 hotels near campus', primary: true },
      { label: 'Under $1,300. 4 hotels' },
      { label: 'Under $1,700. 6 hotels' },
      { label: 'Type a number' },
    ] },
  { id: 'collision-log', kind: 'log', page: 'results',
    when: 'filed as the collision fires',
    say: 'Ruled out Sheraton - only 1 king bed' },

  { id: 'freeway', kind: 'checkpoint', page: 'results',
    when: 'a listing\'s name says one city and the map pin sits in another',
    say: "One hotel says Palo Alto, but it's actually across the freeway, in East Palo Alto." },

  { id: 'compare', kind: 'widget', page: 'results',
    when: 'the budget leaves exactly two candidates, split on distance',
    say: 'Two good hotels under 700. Which one?',
    options: [
      { label: 'The Zen, **$638**. Close to campus, **two real beds**, great reviews, free breakfast', primary: true },
      { label: 'Radisson Sunnyvale, **$590**. A **25 minute drive** away' },
      { label: 'Raise the budget instead' },
    ] },

  { id: 'room', kind: 'widget', page: 'property',
    when: 'more than one room on the property page fits the party',
    say: 'The Zen has two rooms that work.',
    options: [
      { label: '**Two full beds**, $638. Garden view', primary: true },
      { label: '**Two bigger queen beds**, $648. A little more space' },
    ] },

  { id: 'true-price', kind: 'widget', page: 'checkout',
    when: 'the checkout total crosses the ceiling the listed price sat under',
    say: "Heads up, the real price is **$738** with taxes. That's **$38 over** your budget.",
    options: [
      { label: 'Go up to $750', primary: true },
      { label: 'Radisson, about $683 all-in. The cheaper one, farther away' },
      { label: 'Keep looking under $700' },
    ] },

  { id: 'cancellation', kind: 'checkpoint', page: 'checkout',
    when: 'the exact free-cancellation cutoff and penalty are readable',
    say: 'You can cancel free until **September 14**. After that it costs **$368**.' },

  { id: 'details', kind: 'widget', page: 'form',
    when: 'the form offers arrival time and special requests',
    say: "Check-in is at 3, but you'll be with Ashley until evening. Three quick things.",
    options: [
      { label: 'Arrive 6 to 7 PM', primary: true },
      { label: 'Ask them to hold your bags in the morning' },
      { label: 'Add your usual note: help finding the room' },
      { label: 'Change something' },
    ] },

  { id: 'form', kind: 'checkpoint', page: 'form',
    when: 'her identity starts leaving the machine',
    say: "I'm filling in your name, email, and phone number now. They use the phone to confirm the booking." },
  { id: 'form-log-1', kind: 'log', page: 'form',
    when: 'declines filed silently as the form is walked',
    say: 'Said no to marketing emails, taxi, car rental' },
  { id: 'form-log-2', kind: 'log', page: 'form',
    when: 'requests filed - requests, not promises',
    say: 'Asked the hotel to hold bags + help at check-in' },
  { id: 'form-log-3', kind: 'log', page: 'form',
    when: 'an unverifiable site claim is quoted, not repeated as fact',
    say: 'The site claimed "we have 5 left" - couldn\'t verify' },

  { id: 'gate', kind: 'widget', page: 'review',
    when: 'the next press commits money - the agent is held until she answers',
    say: 'Ready to book. The Zen, **two full beds**, **September 15 to 17**, for the three of you. **$738.17 total**, breakfast included. Free to cancel until **September 14**.',
    options: [
      { label: 'Book it - **$738.17 total**', primary: true },
      { label: 'Change something first' },
    ] },

  // ── past the gate: mock or replay only, never the live run ──
  { id: 'booked-log-1', kind: 'log', page: 'confirmation', post: true,
    say: 'Booked 3:07 pm - $738.17 - free cancel until Sep 14' },
  { id: 'booked-log-2', kind: 'log', page: 'confirmation', post: true,
    say: 'Confirmed - not pending approval' },
  { id: 'booked-log-3', kind: 'log', page: 'confirmation', post: true,
    say: 'Skipped 1 ad · ruled out Sheraton (one king bed) · said no to 5 offers' },
  { id: 'reminder', kind: 'widget', page: 'confirmation', post: true,
    when: 'the cancellation window has a real deadline worth a reminder',
    say: 'Cancellation closes **September 14**. Want a reminder on **the 13th**?',
    options: [
      { label: 'Yes, remind me', primary: true },
      { label: 'No need' },
    ] },
];
