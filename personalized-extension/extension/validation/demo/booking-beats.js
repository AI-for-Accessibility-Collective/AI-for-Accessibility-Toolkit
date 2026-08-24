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
  searchUrl: 'https://www.booking.com/searchresults.html?ss=Stanford+University'
    + '&checkin=2026-09-15&checkout=2026-09-17&group_adults=2'
    + '&group_children=1&age=8&no_rooms=1',
  propertyUrl: 'https://www.booking.com/hotel/us/the-zen.html'
    + '?checkin=2026-09-15&checkout=2026-09-17&group_adults=2'
    + '&group_children=1&age=8&no_rooms=1',
  // Told to the agent at arm time. Booking's calendar and occupancy
  // steppers do not enumerate reliably (the + button never gets an index
  // and coordinate clicks miss after re-renders) - a recorded run looped on
  // "add 1 child" for five straight steps. The URL sets everything at once.
  playbook: 'Booking.com playbook for this task: after confirming the '
    + 'destination is Stanford University, DO NOT use the calendar or the '
    + 'occupancy dropdown - their buttons do not respond reliably. Instead '
    + 'navigate directly to {searchUrl} which sets the dates (Sep 15-17) '
    + 'and the guests (2 adults, 1 child aged 8) in one step. From the '
    + 'results, follow the person\'s answers.',
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
    say: "Found {count} places. You asked for a hotel, so I'm skipping the motels. This leaves {hotels}.",
    fallbacks: { count: '100', hotels: '63' } },

  { id: 'sort', kind: 'checkpoint', page: 'results',
    when: 'the page discloses that payments affect ranking',
    say: "The sort order here is partly paid ads. I'm sorting by price and distance instead." },

  { id: 'ad', kind: 'checkpoint', page: 'results',
    when: 'a result inside the organic list carries the Ad badge',
    say: "The {adOrdinal} result is an ad, so I'm skipping it.",
    fallbacks: { adOrdinal: 'second' } },
  { id: 'ad-log', kind: 'log', page: 'results',
    when: 'filed as the ad checkpoint fires',
    say: 'Skipped 1 ad ({adName}, {adPrice})',
    fallbacks: { adName: 'Hotel Citrine', adPrice: '$1,658' } },

  { id: 'collision', kind: 'widget', page: 'results',
    when: 'the closest match sleeps three only by putting one of them on a sofa bed',
    say: "Booking marks the closest one '**recommended for your group**', at **{closestPrice}**. But it counts a **pull-out couch** as the third bed. **Emma would sleep on the couch**. What's your budget? I'll find real beds for everyone.",
    fallbacks: { closestPrice: '$358' },
    options: [
      { label: 'Under $700. 2 hotels near campus', primary: true },
      { label: 'Under $1,300. 4 hotels' },
      { label: 'Under $1,700. 6 hotels' },
      { label: 'Type a number' },
    ] },
  { id: 'collision-log', kind: 'log', page: 'results',
    when: 'filed as the collision fires',
    say: 'Ruled out {closestName} - it counts a couch as a bed',
    fallbacks: { closestName: 'the Coronet Motel' } },

  { id: 'freeway', kind: 'checkpoint', page: 'results',
    when: 'a listing\'s name says one city and the map pin sits in another',
    say: "One hotel says Palo Alto, but it's actually across the freeway, in East Palo Alto." },

  { id: 'compare', kind: 'widget', page: 'results',
    when: 'the budget leaves exactly two candidates, split on distance',
    say: 'Two good hotels under 700. Which one?',
    options: [
      { label: 'The Zen, **{zenPrice}**. Close to campus, **two real beds**, great reviews, free breakfast', primary: true },
      { label: 'Radisson Sunnyvale, **{radPrice}**. A **25 minute drive** away' },
      { label: 'Raise the budget instead' },
    ],
    fallbacks: { zenPrice: '$638', radPrice: '$590' } },

  { id: 'room', kind: 'widget', page: 'property',
    when: 'more than one room on the property page fits the party',
    say: 'The Zen has two rooms that work.',
    options: [
      { label: '**Two full beds**, {room1Price}. Garden view', primary: true },
      { label: '**Two bigger queen beds**, {room2Price}. A little more space' },
    ],
    fallbacks: { room1Price: '$638', room2Price: '$648' } },

  { id: 'true-price', kind: 'widget', page: 'checkout',
    when: 'the checkout total crosses the ceiling the listed price sat under',
    say: "Heads up, the real price is **{totalRounded}** with taxes. That's **{overBudget} over** your budget.",
    fallbacks: { totalRounded: '$738', overBudget: '$38' },
    options: [
      { label: 'Go up to $750', primary: true },
      { label: 'Radisson, about $683 all-in. The cheaper one, farther away' },
      { label: 'Keep looking under $700' },
    ] },

  { id: 'cancellation', kind: 'checkpoint', page: 'checkout',
    when: 'the exact free-cancellation cutoff and penalty are readable',
    say: 'You can cancel free until **{cancelDate}**. After that it costs **{penaltyRounded}**.',
    fallbacks: { cancelDate: 'September 14', penaltyRounded: '$368' } },

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
    say: 'Ready to book. The Zen, **two full beds**, **September 15 to 17**, for the three of you. **{total} total**, breakfast included. Free to cancel until **{cancelDate}**.',
    fallbacks: { total: '$738.17', cancelDate: 'September 14' },
    options: [
      { label: 'Book it - **{total} total**', primary: true },
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
