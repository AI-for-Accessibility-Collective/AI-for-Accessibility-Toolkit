# Review an adapter, then fix it in place

Every time an adapter runs ("Check that it ran" says "Running on …"), a
reviewer that did not write it reviews it, and you fix what the review
finds in the file as it is. That is one round. Do it on your own, without
asking the person first, after the first build and after any change they
ask for that is more than a small one.

One round is the default. After it, stop and tell the person what was
found and fixed, and ask whether they want another round; a new reviewer
then checks your fixes. Go on only if they say yes, one round at a time,
or for as many rounds as they ask for at once, and never more than three
in all. Stop sooner when a review finds nothing high or medium.

The toolkit is an active research project in pre-alpha, and an adapter is
unvalidated until people who use it have tried it. A review finds bugs in
code; it does not show the adapter helps anyone. Say so when you tell the
person it is done.

## 1. Start the reviewer

Build its prompt with the helper. It joins the reviewer's instructions
(`reference/adapter-reviewer.md`) with the adapter, what the person asked
and where it runs, and nothing of yours:

```bash
node <skill folder>/scripts/adapter.mjs review bigger-buttons.js \
  --asked "Small buttons are hard to hit; make them at least 44 pixels tall." \
  --runs-on "https://example.com/*" > review-prompt.txt
```

`--asked` is what the person said they need, in their words and their
answers to your questions. Then give that prompt, as it is, to a new
agent:

- **Claude Code**: the Agent tool, with `subagent_type: "general-purpose"`
  and the prompt file's text as `prompt`.
- **opencode**: the `task` tool, with the `general` subagent and the
  prompt file's text as `prompt`.
- **Any other coding agent**: its own subagent tool if it has one; else a
  second session from the shell, such as `claude -p "$(cat review-prompt.txt)"`
  or `opencode run "$(cat review-prompt.txt)"`.

Never review it yourself in place of the reviewer: an agent reviewing its
own code tends to confirm it. Save the reviewer's last message, its
report, as `bigger-buttons.review-1.md`, then:

```bash
node <skill folder>/scripts/adapter.mjs findings bigger-buttons.review-1.md --round 1
```

It counts the findings and says what to do next: fix, then stop and ask
the person; fix and review again, when they chose more rounds; or stop.
When the person asks for more than one round at the start, pass
`--rounds 2` (or 3) to `review` and `findings`.

## 2. Fix it in place

For each finding:

1. **Check it first.** A finding is a claim, not a fact. Reproduce it, or
   read the code it names, and decide whether it is the adapter's, the
   site's, or not a problem.
2. **Fix what is real in the file as it is**, with the smallest change
   that fixes the cause. Keep what works. Do not rewrite the adapter or
   start again: a fresh rewrite fixes what it was warned about and gets
   something new wrong. Do not change what no finding asked you to.
3. **Ask the person** about a fix that would change what the adapter does
   for them (what it changes, how much, where). That is their choice. Wait
   for their answer, and act on it, before the next review: a finding left
   open for them comes back in every round.
4. **Keep each real finding as a test** you can run again, such as a
   small page that has the problem and a check that fails before the fix
   and passes after it.

Write what you did with each finding under it in the report file: fixed
(and how you checked), not a problem (why), the site's (why), or left for
the person or the toolkit (why). Publish again and check that it runs.

## 3. Stop and ask, or review it again

When `findings` says stop, tell the person in plain words what the review
found, what you fixed, and what is left (low findings, findings about the
toolkit's building blocks, and what could not be checked, such as real
speech or a screen reader on their own device). Your fixes have not been
reviewed yet: say so, and ask whether they want another round.

Only if they say yes (or chose more rounds at the start), build the next
prompt with the earlier report and what you did, and give it to a **new**
reviewer, as in step 1:

```bash
node <skill folder>/scripts/adapter.mjs review bigger-buttons.js \
  --asked "…" --runs-on "https://example.com/*" \
  --round 2 --rounds 2 --earlier bigger-buttons.review-1.md > review-prompt.txt
```

Then `findings` on its report with the same `--round` and `--rounds`, and
do what it says.
