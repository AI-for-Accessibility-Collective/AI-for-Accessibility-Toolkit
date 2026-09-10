# Profile cards: what each ability profile is, and is not

The catalog ships twelve ability profiles
([`tools/profiles/settings.json`](../tools/profiles/settings.json)) — presets
that switch on a bundle of adapters. They exist to solve the cold-start
problem: a person should get something useful before the system knows
anything about them personally.

**What a profile is:** a starting point, assembled from published
accessibility research and guidelines, describing settings many people with
a given experience find useful.

**What a profile is not:** a description of any person, a diagnosis, a
complete account of a disability, or a validated clinical instrument. Two
people who both say "low vision" can need nearly opposite things. The whole
design assumes the person will diverge from the preset, and treats every
divergence as signal, not error.

In the style of datasheets and model cards, each profile gets a card:
what it was built from, what it covers, what it deliberately does not, and
where using it would be a mistake.

---

## What each preset enables

**A preset is a bundle of defaults, not a description of a person or a
group**: two people who choose the same preset diverge immediately as their
own preferences are learned, and every setting can be changed or turned
off. Presets are defined in `tools/profiles/settings.json`. A host can also
let people toggle individual tools, and every explicit change feeds the
Librarian's continual-update loop.

| Profile | What it enables |
|---------|-----------------|
| `blind` | Auto alt text, form labels, WCAG repairs, landmark repair, announce updates, describe on demand, language tags, explore charts, SPA focus, skip links, accessible math (structure, labels, descriptions; deliberately no magnification, no on-page heading navigator or keyboard-nav overlay, which duplicate or collide with a screen reader) |
| `lowVision` | Large text (150%), enhanced focus, high contrast, highlight links, unpin sticky bars, magnifier, reflow to column, focus locator, explore charts |
| `colorBlind` | Contrast fixes, image descriptions, enhanced focus (a color-filter type can then be chosen by the person; none is on by default) |
| `deaf` | Auto captions, visual emphasis, sound visualizer |
| `motor` | Large cursor, keyboard nav, hands-free (spatial voice) navigation, dismiss popups, bigger click targets, page outline, unpin sticky bars, stop auto-advance, focus locator, confirm actions, skip links |
| `dyslexia` | Wider spacing, larger text, focus mode, highlight links, bionic reading, reading ruler |
| `adhd` | Focus mode, reduced motion, reader mode, dismiss popups, bionic reading, reading ruler |
| `cognitive` | Simplified text, summaries, dismiss popups, highlight links, define words, stop auto-advance, confirm actions, save reading spot, expand abbreviations |
| `olderAdult` | Large text, enhanced focus, simplified text, bigger click targets, highlight links, stop auto-advance, save reading spot |
| `anxiety` | Calm UI, reduced motion, dismiss popups, mute sounds |
| `sensory` | Reduced motion, focus mode, dismiss popups, mute sounds, reduce brightness |
| `photosensitive` (shown as **Light Sensitive**) | Dark mode, reduced motion, reduce brightness, flash guard |

Two notes for host and profile authors. First, the `photosensitive` shown
as "Light Sensitive" pattern (a need-named display label over a legacy key)
is the recommended path for the condition-named keys (`anxiety`,
`cognitive`): show people the need the preset serves, not a diagnosis;
renaming the keys themselves would break stored profiles. Second, which
defaults belong in a preset is a live design question (for example, whether
text simplification belongs in `olderAdult` by default), tracked per preset
in the cards below.

## Card: Low Vision (`lowVision`)

**One line.** Bigger, clearer, calmer rendering for people who use their
vision to read but need more from the page to do it.

**What it switches on.** Text scaled to 150% with wider letter spacing and
double line height; stronger focus indicators and a focus locator; contrast
fixes; highlighted links; a large cursor; a follow-the-cursor magnifier;
reflow to a single column; unpinned sticky bars; persistent hover content;
chart exploration as a data table; the automatic WCAG repairs.
(Authoritative list: the `lowVision` entry in
[`tools/profiles/settings.json`](../tools/profiles/settings.json).)

**What it was built from.** Published guidance and survey data — W3C WCAG
and low-vision task-force guidance and the WebAIM Low Vision Survey — not
from a study run by this project. The 150%/spacing/line-height values are
defensible defaults from that literature, not measurements of any user
population of ours.

**Intended use.** Cold start for a person who identifies with "low vision",
expecting them to tune from there. Also a reasonable starting point for
temporary or situational vision limits (dilated pupils, bright sunlight,
small screens).

**Not covered, on purpose.**
- No screen-reader support — that is the `blind` profile's territory, and
  people who use both vision and a screen reader will want pieces of each.
- No color-vision filters (`colorBlind` carries those).
- No magnification of the browser chrome or OS — this operates on pages
  only, and is not a substitute for an OS magnifier.

**Known failure modes.**
- 150% text and reflow can break layouts on app-like pages (dashboards,
  editors); turning the profile off for a site is the escape hatch.
- Contrast "fixes" pick new colors automatically and can occasionally make
  a specific element worse; report these — routes are in
  [SUPPORT.md](../SUPPORT.md) (extension users: the extension repository's
  support page). They are exactly the research data this probe exists to
  collect.

**Validation status.** **Not formally validated.** No user study has
measured this preset's effectiveness against its target population. Treat
it as a hypothesis in preset form.

---

## Card template (copy for each remaining profile)

```markdown
## Card: [Name] (`id`)

**One line.** [Who it serves and how, in one plain sentence.]

**What it switches on.** [Prose summary + pointer to the settings.json entry.]

**What it was built from.** [The specific sources behind the values. If a
value is a judgment call, say so.]

**Intended use.** [Cold start for whom; situational uses.]

**Not covered, on purpose.** [What it deliberately omits and which profile
or tool covers that instead.]

**Known failure modes.** [Where it breaks pages or misfires.]

**Validation status.** [Almost certainly "not formally validated" today.
Say so plainly. When a study exists, cite it here.]
```

---

## Cards still to write

`blind`, `colorBlind`, `deaf`, `motor`, `dyslexia`, `adhd`, `cognitive`,
`olderAdult`, `anxiety`, `sensory`, `photosensitive` (shown in UIs as
"Light Sensitive").

Two of these need particular care, and community review before publishing:

- **`cognitive`** bundles a very wide range of experiences (the settings
  file cites COGA and autism research among its sources). The card must say
  which sub-populations the evidence actually covers.
- **`olderAdult`** is an age-based preset, not a disability, and its card
  should say why it exists (common clusters of needs, and the reality that
  many older adults reject disability framing) without implying age equals
  impairment.

An alternative the Collective has discussed, compatible with these cards:
take **one** profile end to end — real users, the full pipeline, several
days of real use — and publish that as the deep-dive proof of what the
"shelf" can do. If that happens, its findings replace the "not formally
validated" line on that card.
