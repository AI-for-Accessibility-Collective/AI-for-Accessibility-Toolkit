> Historical design document. File paths refer to the tree as it was when this was written, before the repository split; see the README's "Where things moved" section for current locations.

# The verifier: a second agent that watches the first

A design doc for the validation layer's next stage, written as a gap list
against what is already on this branch. The goal from the 8/6 meeting: a
verifier that runs alongside the acting agent, consumes its stream, surfaces
widgets at the right moments, can ask the agent to pause, and keeps a trace
you can rewind. And the first goal: surface one piece of information in a
generalizable way.

## What already exists on this branch

The read side is built and tested, and so is the acting side - the agent is
not an outside party, it lives in the same extension:

- `personalized-extension/extension/browser-harness/` is the in-extension
  agent: Gemini through `getGeminiCaller()`, its own CDP harness, and the
  full loop in `src/agent/run.js` - enumerate, screenshot, LLM call, execute,
  with the live state written to extension storage so the popup and page UIs
  can render it. (The Python `webapp/browser-harness/` and the deck's
  browser-use scripts are research instruments, not the product.)
- `tools/validators/aria-parse.js` parses a snapshot into typed lines. Pure,
  runs the same against saved captures and a live tab.
- `tools/validators/reader.js` extracts page facts with provenance. A missing
  fact returns null with a reason, and that absence is itself a finding. The
  reader only sees what a screen reader user could reach, on purpose.
- `tools/auditors/contract-mismatch.js` checks the facts against what the
  person asked for (size 5, under $40, a strap behind the heel) and emits
  findings that carry their paradigm, what part of the ask they were checked
  against, and whether they contradict it. It also generates readbacks from
  templates when no hand-written check covers a fact, and it stays silent on
  junk values rather than reading nonsense aloud.
- `tools/validators/policy.js` decides how hard a finding presses (ambient,
  aside, stop). The escalation rule is now settled: stop when the person's
  answer changes what happens next and this is the last free moment to give
  it; asides never carry decisions; ambient is a rule watching.
- `tools/adapters/agent-watch.js` renders findings on the page, holds a gate
  the agent cannot pass, takes free-text from the person at any time, and
  keeps the three surfaces (plan, task, rulebook). It marks itself invisible
  to the agent, because a recorded run showed the agent fighting the overlay.

So the layer can already read a page the way the person would, check it
against the ask, and put a finding in front of the person with a control
attached. What it cannot do yet is everything that involves the acting agent
as a counterparty.

In the whiteboard's terms (the green box): the model is the page facts plus
the trace, the view is agent-watch and the widgets, the controller is the
policy plus the API below, and the view model is the person - the ability
profile and personas that decide how everything renders. The red constraints
on the sketch (perception, attention, working memory, vigilance) live in the
policy and in the spoken grammar: answer first, four-chunk litanies, the
pause budget. The person's three modes - interrupt, interrogate, control -
are the tell box, the on-demand questions, and the handover.

## Gap 1: the loop never talks to the validation layer

The agent and the validation layer live in the same extension, two
directories apart, and today neither knows the other exists. `run.js`
already computes everything worth publishing every step - the actions, the
screenshot, the page state, its own `next_goal` and memory - and then keeps
it to itself. So the API is not a protocol between strangers, it is a hook
inside the loop, with the same two directions.

What the agent must publish, every step:

| event | carries |
|---|---|
| `step` | the action it is about to take, and which plan node it belongs to |
| `state` | the accessibility snapshot before and after the action |
| `self-check` | what the agent believes it just accomplished |
| `plan` | the current plan, whenever it changes |

What the verifier can ask of the agent:

| call | meaning |
|---|---|
| `hold` | stop acting before the next step; keep reading. The run resumes on `release`. |
| `probe` | run a side errand that does not advance the task - for example, try the narrower search in a background tab and report the count |
| `answer` | answer a question from the person, from the trace |
| `handover` | give the person one control (a field, a link), then take the run back |

The hold is the call everything else depends on - without it the verifier
can only narrate. It is what turns a level 7-9 agent into a level 5-6 one at
the moments the person chose. Holding means the agent stops
acting but keeps looking - it can read ahead, and probes run during holds.

## Gap 2: there is no trace, so there is no rewind

agent-watch keeps findings in memory and nothing else. The meeting asked for
a rewindable, hierarchical record. The trace is the agent's published events
filed under plan nodes:

```
plan: buy the sandals
  search               step 3: typed the query     state #12, #13
  pick one             step 9: opened the pick     state #18, #19
  add to cart          step 11: clicked add        state #22, #23
```

Every `state` is a stored snapshot, so "rewind" means walking up the tree and
re-reading a page as it was - which is also what makes the sighted-plus-agent
rewind widget (G2 in the deck) buildable. The trace is also what `answer`
reads from, and it is why asking at level 8 can work at all: a question about
something the agent never held has no answer, and the trace makes that an
honest "I never saw it" instead of a guess.

## Gap 3: the monitor is not a process yet

checkPage runs when something calls it. The meeting's verifier is a loop: a
second agent that consumes the published stream and runs the checks as states
arrive, so findings exist before anyone asks. The loop is small:

```
on state(after) -> facts = reader(state); findings = checkPage(facts, node, contract)
on findings     -> level = policy(finding); surface or hold per level
```

The vigilance point from the meeting lands here: the person should not have
to watch anything continuously, because the monitor is the thing watching.
The person's workload is only the moments the policy escalates - which the
pause budget already shrinks run over run as corrections become rules.

The monitor also carries the what-ifs: for every committing step it knows the
way back and its deadline (the cancel window, the retry cap), so when
something does not work the finding also carries the way back and its
deadline, not only that something went wrong.

## Gap 4: the phase comes from a hardcoded map, and whose plan is it

checkPage takes a `phase` argument and the checks are keyed to shopping
phases. The agent's published plan (Gap 1) removes the hardcoding, but it is
not enough on its own, because the agent plans toward the task goal and a
person plans toward their decisions - the two trees can be far apart, and the
8/5 discussion was exactly about that distance.

So the verifier keeps two structures:

- the agent's plan, from the API, which is where states get filed (Gap 2)
- its own human-shaped plan: the decision points a person doing this task
  would have. For shopping we built this by hand - the three HTAs in the
  deck and the 42 questions are the ground truth. Generalizing is the 8/5
  plan: prompt an LLM with our manual plans and screenshots as the few-shot
  examples, generate the human plan for a new task, and verify against human
  labels before trusting it.

Checks attach to the human plan's decision points, because that is where the
person's questions live. The mapping between the two plans is the verifier's
alignment table, and the distance itself is information: an agent step that
lands on no human decision point is exactly the kind of move a person would
want to hear about.

What a widget displays follows the same logic: the content is the delta -
what a sighted person doing this step manually would have had, minus what
this person got. The signal map is that delta measured for shopping, which
is why the widgets read straight off it.

## Gap 5: rank-ordering what gets surfaced

When several findings exist at once, the order is by how soon the decision
each one feeds has to be made: gate findings first, then findings whose
page is about to be navigated away from, then the rest. agent-watch already
sorts current-page, then urgency, then actionable - the addition is the
deadline term, which the trace supplies (it knows which page is current and
what the next step will destroy).

## The first goal, built: magnitude, generalizably

Everything above, exercised once, end to end, on the meeting's own example:

1. The agent publishes a `step` whose action was a query (search, filter,
   sort - anything that produced a set).
2. The monitor reads the count from the after-state. `reader.js` already
   extracts counts; the tile-grouping work already handles the hard case
   honestly (70 tiles against the page's own 60).
3. CountFirst fires - it is already written to be task-agnostic: a magnitude,
   its source, and the choice of narrowing before picking.
4. The verifier calls `hold`, then `probe` for each narrowing move the person
   might take, so the options carry real predicted counts instead of a
   threshold.
5. agent-watch surfaces the finding in the page, the person answers or
   types, and the answer resolves the hold's promise - the loop continues.

Nothing in those five steps mentions shopping, and every one of them runs
inside the extension: the hook feeds `reader.js`, `CountFirst`, `policy.js`
and `agent-watch` directly, in the same process. The new work is the hook,
the hold promise, the probe tab, and the filing of states under plan nodes -
the checks and the rendering already exist.

## Out of scope for now

- Cross-task memory beyond the rulebook (the datastore work covers it).
- Voice input for the person's side (the tell box stands in).
- Any change to the acting agent's own model or prompts: the API is designed
  so the verifier works with whatever the agent is, which is the point of
  building it as a second agent rather than a smarter first one.
