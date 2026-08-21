# worst-case dominance sweep over the money-moving questions

For each money-moving question, every combination of: confidence {0, 0.25, 0.5, 0.75, 1}, quote verified {exact, no}, page ambiguity {off, on}, persona {sighted, screen reader}, joining an existing pause {no, yes} - 80 cells per question. In each cell the shipped route() runs with NO locked-stop rule in front of it, and the question is whether the now route wins the argmax anyway. The shipped layer still decides money stops before the score; this table is evidence about whether the arithmetic could carry that property alone.

283 money-moving questions, 22640 cells swept.

| property | questions | share |
|---|---|---|
| now wins EVERY cell | 176 | 62.2% |
| a spoken route (now or after) wins every cell | 198 | 70.0% |
| at least one cell where a kept route beats now | 85 | 30.0% |

6741 of 22640 cells put a non-now route first. Deficit of the now route in those cells: median 0.0666, worst 0.2661 (the whole benefit side of a typical finding is roughly 0.02 to 0.08, so these margins are material).

what the failing cells have in common (each failing cell counted once per factor):

| factor | failing cells with it | failing cells without it |
|---|---|---|
| quote unverified | 3314 | 3427 |
| screen-reader persona | 3440 | 3301 |
| joining an existing pause | 3184 | 3557 |
| page ambiguity signal | 3438 | 3303 |

questions with any failing cell, by their moment label:

| moment | questions |
|---|---|
| Completion | 82 |
| Now | 19 |
| On demand | 3 |
| After | 3 |

the 10 questions the arithmetic protects least (fewest now-wins):

| now wins | severity | corpus | moment | question |
|---|---|---|---|---|
| 0/80 | uncoded | amazon | On demand | Is anyone else selling this same one cheaper? |
| 0/80 | uncoded | amazon | On demand | Is that discount real? |
| 0/80 | uncoded | amazon | Completion | Did it go through, and what's the number? |
| 0/80 | uncoded | amazon | Completion | Can I still cancel it? |
| 0/80 | uncoded | amazon | Completion | It never came - who do I go to, and how long do I have? |
| 0/80 | uncoded | amazon | On demand | Which reason do I give for sending it back, and what does that answer cost me? |
| 0/80 | uncoded | amazon | Completion | Did what left my account match what I was quoted? |
| 0/80 | uncoded | amazon | Completion | Did the cancellation actually go through? |
| 0/80 | uncoded | flights | Completion | Did it go through - what's the reference? |
| 0/80 | uncoded | flights | Completion | Did the money move, and does a booking exist? |

## the same cells under the three-surface shadow score (routeSurface)

The strong-score form (STRONG-SCORE.md): widget / checkpoint / log, with
I(widget) = 1 because a widget captures the resolution before the agent
proceeds. The question is whether that term closes the dominance gap the
four-route form shows above.

| property | four-route form (now) | three-surface form (widget) |
|---|---|---|
| wins EVERY cell | 176/283 (62.2%) | 198/283 (70.0%) |
| questions with a losing cell | 107 | 85 |
| ...of which Now-labelled (the real gap) | 19 | 0 |

No Now-labelled money question has a losing cell under the three-surface
form: for every moment the human said interrupt, with money moving, the
widget wins the argmax in every input combination swept. The remaining
85 questions with losing cells are Completion / On demand
labelled, where a kept surface winning is the designed timing, not a
safety gap.


Reading it. The moment table above separates two different things. A
Completion-labelled money question losing now-cells is the score being RIGHT
about timing: the receipt does not exist mid-run, D(now) prices that, and
the review route winning is the designed behavior, not a safety gap. The
real dominance gap is the 19 Now-labelled money questions
with failing cells: moments where the human said interrupt, money moves,
and some input combination still lets a kept route outbid the interruption.
Those cells, their flipping factors and their margins are the exact
specification of what a stronger score must price in before the arithmetic
could carry the money-safety property alone. Until that count is zero and
holds under the study labels, the safety property lives upstream of the
score, where it is today.
