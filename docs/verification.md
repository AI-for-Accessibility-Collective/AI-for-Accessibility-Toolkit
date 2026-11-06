# Verifying an adapter

This is how the toolkit checks an adapter before anyone uses it: the
automated steps the verifier runs, and the independent review after them.
It is the protocol the core adapters went through, written down so any
adapter built on the building blocks can go through it too.

**Status.** The toolkit is an active research project, in pre-alpha: a
technology probe. Its adapters are unvalidated, and it is not a replacement
for assistive technology. This means that an adapter that passes every
step here can still fail the people it is for. These steps find bugs in
code; only people trying an adapter on the pages they use can show whether
it helps.

## The steps

Steps 1 to 8 run without a model; step 9 uses one.

| Step | What it checks | What fails |
|---|---|---|
| 1. Its own checks | On test pages made for the barrier, the adapter's specs: what it should change, and what it must leave alone. | A check that does not pass after `enable()`. |
| 2. Problems it adds | axe-core's rules on the page before and after `enable()`, counting only what the adapter created, changed or styled. | A WCAG 2.0, 2.1 or 2.2 A or AA rule it breaks. axe-core's best practices and WCAG AAA are reported as advice, not counted: some are wrong about pages an adapter makes. |
| 3. Text and layout | Text the adapter shows, and page text it restyles; how much the page moves. | Text it shows below 16px (12pt), or page text it makes smaller. Layout shift is reported. |
| 4. Keyboard | InterA11y's keyboard audit, without and with the adapter: the Tab order, traps, and where focus goes. | A keyboard trap, focus that cannot leave or is refused, or focus inside `aria-hidden` content, on what the adapter made or changed. |
| 5. Undo | `disable()`, as the runtime calls it. | The page not back exactly as it was, marks left behind, the zoom left changed. |
| 6. The person's settings | The same pages on a narrow screen, with reduced motion, and with a person's profile. | As in steps 1 to 5. |
| 7. Real pages | A recorded copy of each real page in `scripts/verify-adapters/sites.json`, each also run with no adapter at all, so changes the page makes by itself are told apart from the adapter's. | Errors from the adapter's code, problems it adds that the page does not add by itself, marks left after `disable()`. |
| 8. Cost | How long `enable()` takes, AI calls on load, what it says aloud while the person only scrolls. | Past the limits in `scripts/verify-adapters/mcp.mjs` (`LIMITS`). |
| 9. Independent review | A reviewer that did not write the adapter reads it and tries it, with the WCAG rubrics that apply (InterA11y's, with its tools), and looks for guesses: decisions made from a name, class or position where the page could have said. | Findings, high, medium or low. The author checks each, fixes the cause in the file as it is, and keeps each real finding as a check. One round, more only when the person chooses, at most three. |

## Real pages, and visiting them politely

The verifier never runs on a live site directly. It records each page once,
with everything the page fetches, and serves it from that copy
(`scripts/verify-adapters/sites.mjs`):

- The demo sites (W3C's Before and After Demonstration, Deque's demos, the
  University of Washington's) are recorded once and kept. The others are
  recorded at most once a day.
- A recording names the verifier in its user agent, follows robots.txt,
  loads one page at a time, and waits 10 seconds between two visits to one
  host. A site that refuses is not asked again for six hours.
- Every run then sees the same page, so a result can be repeated. Scripts on
  the copy still run, and anything it asks the network for that the copy
  lacks fails, as if offline.
- The copies are kept in `.verify-cache/sites/`, never in git: they are
  other people's pages.

`node scripts/verify-adapters/sites.mjs` lists the copies; `record` makes
them; `VERIFY_SITES=refresh` records each page again, and `VERIFY_SITES=live`
loads the sites themselves.

## Running it

Steps 1 to 8 need Chromium (`npx playwright install chromium`).

- **Any adapter built on the building blocks**: on every test page we have
  and every real page, with no checks of its own (steps 2 to 8):

  ```bash
  node scripts/verify-adapters/run.mjs --check path/to/adapter.js \
    [--options '{"size": 44}'] [--personal '{"fontScale": 150}'] \
    [--pages a.html,b.html] [--no-sites] [--spec check.json] [--out report.json]
  ```

  On a page it is not for, `enable()` returning false is fine. If it applies
  on none of the test pages, the result says so: give it a page with the
  barrier it is for.

  `--spec` names a JSON file: `runsOn` (the adapter's URL patterns),
  `copies` (pages saved as MHTML, `{url, file}`, the file relative to the
  spec) and `checks` (`{name, code}`, as a preview's). An adapter whose
  `runsOn` names some sites, not every site, is not run on the test pages,
  which do not have what it changes, nor on the recorded sites it does not
  match. It runs on each copy, served at its own address, also narrow and
  with reduced motion, with those checks, and there it must apply and its
  checks must pass after `enable()`. The assistant sidebar saves such a
  copy when the person shares the page source and an adapter is previewed
  on the page (`agent-host/src/page-data.js`).

  The runs go three at a time, each in its own browser context
  (`VERIFY_CHECK_PARALLEL`; 1 runs them one by one). The report keeps
  their order.
- **The core adapters**, with their own checks:
  `node scripts/verify-adapters/run.mjs --replay --core [id ...]`.
- **Step 9 in a coding agent**: the `ai4a11y-toolkit` skill does it after an
  adapter first runs (`reference/review-and-fix.md`).
- **Step 9 for the core adapters**: `run.mjs --agent --sandboxed --review`
  and `--fix`, only in the verify container on the agent host VM
  (`scripts/verify-adapters/Dockerfile`).
- **A published adapter, on the server**: see the next section.

## On the server

A developer, or their coding agent, can have a published adapter checked
on the toolkit's server instead of on their own computer. It is optional
and runs only when asked:

```bash
node .claude/skills/ai4a11y-toolkit/scripts/adapter.mjs check bigger-buttons [--review]
```

- **What runs.** Steps 2 to 8, as `run.mjs --check` runs them, on the
  adapter's current revision: every test page, each also on a narrow
  screen and with reduced motion, and the recorded copy of every real page.
  An adapter whose URL patterns name some sites only runs on the recorded
  pages of those sites instead (`--spec`, above).
  With `--review`, step 9 as well: an independent reviewer (opencode with
  Gemini) that did not write the adapter reads it and tries it. Its
  instructions are the skill's reviewer's (`toolkit/scripts/adapter-reviewer.md`)
  and `scripts/verify-adapters/REVIEW-FILE.md`. It is told what the adapter
  is for (its published description) and what the check found, and it has
  the verifier's tools and InterA11y's tools and rubrics. It chooses the
  WCAG criteria that apply to what the adapter changes, reads each rubric
  and gives a verdict for each. Its report starts `Verdict: ok | issues`.
  On the agent host the review is three reviewers at once, each on one part
  (`run.mjs --focus`, `scripts/verify-adapters/review-focus.mjs`): the
  code (the contract and putting the page back, errors, performance,
  privacy, whether it does what it is for); what people see and read
  (rubrics 1.1.1, 1.4.1, 1.4.13, 2.4.4, 3.3.1); and keyboard, focus and
  announcements (2.1.1, 2.1.2, 2.4.3, 2.4.7, 4.1.3). Their reports become
  one, a section each. It finds issues when any part does, and says no
  issues only when every part finished; a part that did not finish is
  named.
- **What comes back.** `adapter.mjs` prints what passed, what failed and
  why, the advice, the review's findings, and what a check cannot show. The
  developer console's Adapters page shows the latest check on the
  adapter's card. Results are kept with the revision they checked. Asking
  again runs a new check; only while a check of the same revision is still
  waiting or running is that one the answer, so the same work is not done
  twice at once.
- **Where it runs.** The toolkit service checks the developer's token
  (not an app-bound one) and that the account can read the adapter (its
  own, or a shared one). It then sends the job to the agent host
  (`agent-host/`). The host runs one check at a time, each in a one-shot
  container under gVisor that has no network at all. The copies of real
  pages are mounted read-only, so no site is visited. Each reviewer runs in
  its own container whose only network is the host's model proxy. The
  model key stays on the host. The GenA11y rubric text is fetched by the
  host beforehand, so the reviewer needs no internet.
- **Time.** Four checks run at a time; the rest wait their turn. A check
  stops after 20 minutes and a review after 45, and a review that keeps
  calling the model is stopped after a set number of calls.
- **When it helps.** When the developer's computer cannot run the verifier
  (no Chromium, no recorded copies of the sites), when a coding agent has no
  browser, or before an adapter is shared. It adds to the review in the
  skill (`reference/review-and-fix.md`); it does not replace it, or trying
  the adapter with the people it is for.

The same status applies: an adapter that passes every step on the server
can still fail the people it is for. The server's report is about the code,
not about whether the adapter helps.

## Where the steps live

- `extension/runtime/scripts.js`: the preview audit (axe-core, text size,
  layout shift, checks before and after), the same one the assistant
  sidebar uses.
- `scripts/verify-adapters/harness.mjs`: the headless browser, undo, the
  person's settings, the real-page copies.
- `scripts/verify-adapters/intera11y.mjs` and `intera11y/`: InterA11y's
  tools, rubrics and judge prompt, vendored. The rubric rules adapted from
  GenA11y (GPL-3.0) are blank there and read from InterA11y when an agent
  asks for them.
- `scripts/verify-adapters/run.mjs`: `--replay`, `--check` and the agent
  runs (`--review-file` is the server's review of one file); `REVIEW-CORE.md`
  and `CREATE.md`: the reviewer's and the author's instructions;
  `REVIEW-FILE.md`: what is different for the server's reviewer.
- `server/src/adapter-checks.js` and `agent-host/src/checks.js`: checks on
  the server (the routes, the queue, the containers).

InterA11y and GenA11y are prior research this verification layer builds
on; their rubrics are theirs.
