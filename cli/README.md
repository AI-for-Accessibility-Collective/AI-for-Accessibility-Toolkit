# ai4a11y CLI (experimental)

A terminal front end for the toolkit's catalog. It launches a persistent Chromium, connects to it over the Chrome DevTools Protocol, and injects the catalog bundle (`cli-tools.bundle.js`, built from [`../tools/`](../tools/)) into the page, so the same adapters, auditors, and profiles the extensions use can be exercised on any live page from a shell or a coding agent.

This is a research probe, pre-alpha, restored from the pre-split repository and rewired to this tree. Expect rough edges.

Two files: `cli.py` is the command line (a [Typer](https://typer.tiangolo.com/) app: parsing, help, shell completion via `ai4a11y --install-completion`); `ai4a11y.py` is the engine it calls. Every command and group answers `--help`.

## Setup

```bash
pip install -e .        # from the repository root; installs the ai4a11y command
python -m playwright install chromium
npm install && npm run build:cli
```

The bundle is committed, so `npm run build:cli` is only needed after changing files under `tools/`.

Install editable (`-e`), from a checkout. The CLI reads the catalog from the repository tree at runtime (`tools/` for listings, the bundle for injection), so it is not currently installable as a standalone package.

## Commands

Catalog, no browser needed:

```bash
ai4a11y list tools        # auditors and adapters, with descriptions, from tools/
ai4a11y list profiles     # ability profiles from tools/profiles/settings.json
ai4a11y create <name> --type adapter   # scaffold a new adapter
```

Session, instant and local. Nothing leaves the browser:

```bash
ai4a11y session start | stop | status | tabs | focus | cleanup-tabs
ai4a11y session back | scroll | tab | activate | focused | key | arrow
ai4a11y session heading | skip | dismiss | enable | disable | tools | profiles
ai4a11y session list [headings|links|buttons|forms|landmarks|images|tables]
ai4a11y session find "<text>" | read [selector] | tables
ai4a11y session audit [--json]           # axe-core WCAG audit
ai4a11y session find-alt | find-labels | find-contrast | find-captions | find-all
```

Session, AI-backed. These reach the locally installed [Claude Code](https://claude.com/claude-code) CLI:

```bash
ai4a11y session describe | ask "<question>" | summary | diff
ai4a11y session tap "<target>" | type "<field>" "<text>" | hover | drag | nudge | pickdate
ai4a11y session do "<task>"              # autonomous multi-step mode
ai4a11y session fix-alt | fix-labels | simplify | fix-all | scan
ai4a11y session go <url> | profile <name>    # see below
```

What that means in practice, because the page content involved is the user's:

- **What is sent.** A screenshot, page text, or an element's surrounding markup,
  depending on the command. `describe`, `ask`, `fix-alt` and the pointer commands
  send images of the page.
- **How many calls.** One per item, not one per command. `fix-alt` makes up to one
  call per image it is fixing, and `do` and `scan` make as many as their work
  takes. A run over ten images is ten subprocesses.
- **What it costs.** Nothing beyond a Claude subscription by default. Exporting
  `ANTHROPIC_API_KEY` switches the underlying CLI to per-token API billing, which
  is a real charge per call.
- **`go` and `profile` are the two that surprise people.** Neither calls a model
  itself. Both hand the page a set of callbacks that AI-backed adapters use, so a
  profile whose tools include `autoSimplify` or `autoSummarize` (`cognitive`,
  `olderAdult`, `adhd`) sends page text on every navigation until the profile is
  cleared with `ai4a11y session profile none`.

When the Claude Code CLI is not installed, or a call fails, these commands write
nothing to the page. They say `needs-ai` on the line where the fix would have
been.

## Exit status

| Code | Meaning |
|---|---|
| 0 | The command did its work. A run that fixed some items and skipped others is still 0; see below. |
| 2 | The command line was wrong (Typer's usage error). |
| 3 | An AI-backed command reached no model and so changed nothing. |
| 4 | The recorded session is not the browser it started. Nothing was touched. |
| 5 | A session command ran with no session started. |

A partly degraded run exits 0 on purpose. `scan` also does local fixes, and
failing the whole command because two of twenty model calls timed out would
report eighteen real fixes as a failure. The count is in the payload instead, so
a caller that cares can see it:

```console
$ ai4a11y session fix-alt --json      # with the Claude Code CLI unreachable
{
  "fixed": [],
  "attempted": 2,
  "skippedNeedsAi": 2
}
```

`--json` prints that payload and nothing else. `scan --json` carries the same
`skippedNeedsAi` count alongside its own fields.

## Tests

```bash
pip install -e '.[dev]'             # adds pytest
python -m pytest                    # full harness; spawns its own headless Chromium
python -m pytest -m 'not browser'   # catalog and degradation tests only, no browser
```

The harness lives in [`tests/`](tests/) and runs the real command surface as subprocesses against a fixture page with planted defects. It is isolated: its browser runs on a free port with its own state directories, and no test calls an AI model. CI runs it, then rebuilds the bundle and fails on drift against the committed copy.

## Vendored files

- `axe-core.min.js` — axe-core v4.12.1 from the `axe-core` npm package, injected for `session audit`. Kept at the same version the extension repository ships so the two agree on what counts as a violation.
- `lib/readability.js` — Mozilla Readability (Apache-2.0, header preserved), used by `session read` and reader mode.
- `cli-tools.bundle.js` — generated by `npm run build:cli` from `cli-tools.js`; do not hand-edit.
