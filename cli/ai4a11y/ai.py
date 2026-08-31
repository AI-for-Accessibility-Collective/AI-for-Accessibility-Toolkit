"""The Claude Code subprocess calls, and the generic fix engine that drives them.

This layer knows how to ask a model a question and how to walk a list of
items asking one question each. It does not know what an accessibility defect
is: the specs that describe a pass, and the auditors that find the items to
run it over, live with the commands in `commands.py`.
"""

import json
import subprocess
import time
from pathlib import Path
from typing import Any, Callable, Literal, NamedTuple

import os as _os

from .config import (
    AI_UNAVAILABLE_EXIT,
    OUT,
    _IRIS_VISION_EFFORT,
    _IRIS_VISION_MODEL,
    quiet,
)


# Minimal system prompt for ai4a11y calls — avoids loading the user's CLAUDE.md
# (routing rules, personal profile, cherine scenarios, etc.), skills list, MCP
# servers, and hooks. Keeps input tokens tight and startup fast.
_IRIS_SYSTEM_PROMPT = (
    "You are a concise vision/grounding assistant for a blind-user accessibility tool. "
    "Follow the user's instructions exactly. When JSON is requested, return ONLY valid "
    "JSON — no markdown fences, no prose, no preamble."
)


def _claude_cli_args(model, prompt_text, effort=None, tools=""):
    """Build a minimal `claude -p` argv.

    Flags stripped: user CLAUDE.md (via --system-prompt override), skills,
    MCP servers, session disk persistence, all tools. Keeps only what ai4a11y needs:
    a single prompt → text/JSON response. Optional effort level tames 4.7+ extended
    thinking for tasks that don't benefit from it (screenshot Q&A, grounding).

    Callers that need to pass a screenshot pass tools="Read" so Claude can open
    the PNG path — text-only callers stay on the locked-down tools="" default.
    """
    args = [
        "claude", "-p", prompt_text,
        "--model", model,
        "--system-prompt", _IRIS_SYSTEM_PROMPT,
        "--tools", tools,
        "--disable-slash-commands",
        "--strict-mcp-config",
        "--no-session-persistence",
        "--add-dir", str(OUT),
    ]
    if effort:
        args.extend(["--effort", effort])
    # NOTE: --bare is more aggressive (skips hooks / auto-memory / keychain reads) but
    # requires ANTHROPIC_API_KEY. Setting that env var ALSO switches ai4a11y from OAuth/
    # subscription billing to pay-per-token API billing — intentional but silent, so
    # a user who exports ANTHROPIC_API_KEY for another project shouldn't be surprised.
    if _os.environ.get("ANTHROPIC_API_KEY"):
        args.append("--bare")
    return args


def _claude_cli_env():
    """Silence the `DEP0169 url.parse` Node warnings that print on every invocation."""
    return {**_os.environ, "NODE_NO_WARNINGS": "1"}


def _safe_screenshot(page, path):
    """Screenshot that survives Chrome's "0 width" bug AND font-loading hangs.

    Some restored/detached tabs report innerWidth>0 to JS but still throw
    'Cannot take screenshot with 0 width' in CDP. Force a viewport resize
    first and retry once before giving up.

    Also capped at a short timeout so sites that never finish loading fonts
    (Amazon, some e-commerce) don't hang the whole primitive for 30 seconds.
    """
    try:
        page.screenshot(path=str(path), timeout=8000)
        return True
    except Exception:
        pass
    try:
        page.set_viewport_size({'width': 1280, 'height': 800})
        time.sleep(0.3)
        page.screenshot(path=str(path), timeout=8000)
        return True
    except Exception:
        # Last resort: skip all font-ready waits via Playwright option.
        try:
            page.screenshot(path=str(path), timeout=8000, animations='disabled')
            return True
        except Exception:
            return False


# Marks a payload that ask_claude / ask_claude_text synthesized because the call
# never reached a model. The payloads keep their old shape as well, so the agent
# loops that read 'action' and 'answer' are unaffected.
_AI_FAILED_KEY = 'ai4a11y_call_failed'


def _ai_failure(reason, answer='', error=None):
    """The payload both Claude helpers return when the call did not go through."""
    payload = {_AI_FAILED_KEY: True, 'action': 'done', 'reason': reason,
               'answer': answer, 'error': error or reason}
    return json.dumps(payload)


def claude_answer(raw):
    """The model's answer, or None when the call never reached a model.

    Both helpers report failure by returning a payload rather than raising, so a
    caller doing json.loads(raw).get('answer') cannot tell an answer from an
    apology. It gets either an error sentence, which is how "Claude CLI error:
    ..." ended up written into an alt attribute, or an empty string, which is how
    a paragraph got replaced with nothing while the run counted a success.

    Every site that writes model output into the page reads it through here, so
    an unreachable model stops at the call site.
    """
    if raw is None:
        return None
    try:
        data = json.loads(raw)
    except (TypeError, ValueError):
        return raw.strip() or None
    if not isinstance(data, dict):
        return raw.strip() or None
    if data.get(_AI_FAILED_KEY):
        return None
    answer = data.get('answer', raw)
    if not isinstance(answer, str):
        answer = str(answer)
    return answer.strip() or None


def _ai_fix_report(fixes, attempted, unreachable):
    """The --json payload for a fix command.

    A bare list of fixes cannot express a degraded run: five fixes out of ten
    items and five out of five look identical to a caller reading it. Exit
    status says only that something went unanswered, so how much goes here.
    """
    return {'fixed': fixes, 'attempted': attempted, 'skippedNeedsAi': unreachable}


def _print_fix_result(fixes, attempted, unreachable, noun, json_output):
    """The closing report every AI fix command prints, for a person.

    It lives beside `_ai_fix_report` rather than beside the commands because it
    is that payload's other half: the same three counts, worded for a person.
    `noun` is the only thing the fix commands differ on here, "images" for one
    and "elements" for the next.

    It prints and nothing more. The payload is emitted by the caller, because
    `fix-all` combines two of these runs into one document and a function that
    emitted here would put two on stdout.
    """
    say = quiet(json_output)
    say(f"\n✓ Fixed {len(fixes)} of {attempted} {noun}", flush=True)
    if unreachable:
        say(f"  {unreachable} skipped, needs AI", flush=True)


def _ai_exit_status(applied, unreachable):
    """Nonzero when any item went unanswered, whatever else the run fixed.

    A caller reading only the exit status is asking whether the command did the
    job it was given. A run that left two images out of twenty without alt text
    did not, so it reports failure and keeps the eighteen fixes it made; the
    per-item needs-ai lines and the counts in the payload say how far it got.
    """
    if unreachable:
        return AI_UNAVAILABLE_EXIT
    return 0


# What a rendering callable hands back: one line, or nothing for a step this
# pass keeps quiet about. `line` below drops the None, which is what lets a
# pass leave a step unworded without leaving the field unset.
Line = str | None

# The page, and one item off an auditor. Both come from Playwright or from
# JSON evaluated in the page, so there is no type here to name them by; what
# the annotations below are worth saying is arity and order.
Page = Any
Item = Any


class FixProgress(NamedTuple):
    """How one fix pass words the lines it prints.

    The passes share a loop but not a voice. The standalone fixers print
    ``  [1/2] selector... `` and then the outcome on the same line; the
    sub-passes inside `scan` print an eight-space indent and a different shape
    again. Unifying the wording would change what those commands write to
    stdout, and this is a refactor, so only the loop and the unanswered-model
    contract are shared. Presentation stays with the pass.

    Each field is a callable returning the line to print, and the ones with a
    default may be left off entirely by a pass that says nothing at that point.
    """
    header: Callable[[list, int], Line]              # items, count: opens the pass
    applied: Callable[[int, Item, str, Any], Line]   # i, item, selector, value
    failed: Callable[[int, Item, str, Any], Line]    # i, item, selector, error
    unanswered: Callable[[int, Item, str], Line]     # i, item, selector
    # A prefix printed with no newline, so the outcome lands on the same line.
    begin: Callable[[int, int, Item, str], Line] | None = None   # i, count, item, sel
    missing: Callable[[int, Item, str], Line] | None = None      # element not there
    no_input: Callable[[int, Item, str], Line] | None = None     # nothing to prompt on


class FixPass(NamedTuple):
    """What differs between one AI fix pass and another.

    `field` exists so the --json payload keeps the key it has always had:
    fix-alt reports {'selector', 'alt'} and fix-labels {'selector', 'label'}.
    Collapsing them must not quietly rename either, because a caller outside
    this repository may be reading it.

    `items` is a callable rather than an auditor name because not every pass has
    an auditor behind it. Scan's video pass runs its own query for videos that
    carry no description. `_auditor_items` builds this callable for the passes
    that do read an auditor, so those stay one line.

    `call` is a Literal because the loop branches on it by equality and falls
    through to the text call for anything that is not "vision". Spelled as a
    plain str, a typo in a new pass is not an error anywhere: the pass runs,
    the model answers a prompt about an element nobody screenshotted, and the
    answer is written into the page.
    """
    prompt: Callable[[Page, Item], str | None]   # None to skip this item
    call: Literal["vision", "text"]   # vision screenshots the located element
    write: str           # JS taking (data): data.selector, data.value, data.index
    field: str           # key the answer takes in the --json payload
    progress: FixProgress
    # The items, for a pass that can find its own.
    items: Callable[[Page], list] | None = None
    # The element to screenshot and to write to, or None to skip the item.
    locate: Callable[[Page, Item, int], Any] | None = None
    shot: Callable[[Item, int], Path] | None = None  # where the screenshot goes
    cap: Callable[[str], str] | None = None          # how a long answer is trimmed
    timeout: int = 30                                # seconds for a text call


def run_fix_pass(page, spec, items=None, max_items=10, json_output=False):
    """Apply one AI fix pass to the page. Returns (fixes, attempted, unreachable).

    Nine passes used to carry a copy of this loop. Each copy had to get the
    unreachable-model case right on its own, and before the harness existed none
    of them did: a failure payload was written into the page as if it were an
    answer and counted as a fix. There is one copy now, so there is one place
    for that to be right.

    Pass `items` when the caller already has the list, which is the case for the
    sub-passes inside `scan` that read it out of a scan result rather than off
    the page.
    """
    if items is None:
        items = spec.items(page)

    fixes, unreachable = [], 0
    attempted = min(len(items), max_items)
    say = quiet(json_output)

    def line(text, end="\n"):
        """Print one rendered line, or nothing when the pass renders none."""
        if text is not None:
            say(text, end=end, flush=True)

    # The header goes out whenever the pass has items, even when the caller
    # capped the run at zero of them. Every pass printed it there before, so
    # `fix-alt 0`, `fix-labels 0` and `scan 0` still open with their own line
    # and a count of zero.
    render = spec.progress
    if items:
        line(render.header(items, attempted))
    if not attempted:
        return fixes, 0, 0

    for i, item in enumerate(items[:attempted]):
        selector = item.get('selector', '')
        if render.begin:
            line(render.begin(i, attempted, item, selector), end=" ")
        try:
            element = None
            if spec.locate:
                element = spec.locate(page, item, i)
                if element is None:
                    if render.missing:
                        line(render.missing(i, item, selector))
                    continue

            prompt = spec.prompt(page, item)
            if prompt is None:
                if render.no_input:
                    line(render.no_input(i, item, selector))
                continue

            if spec.call == "vision":
                shot = spec.shot(item, i)
                element.screenshot(path=str(shot))
                raw = ask_claude(str(shot), prompt)
                shot.unlink(missing_ok=True)
            else:
                raw = ask_claude_text(prompt, timeout=spec.timeout)

            value = claude_answer(raw)
            # An unreachable model is not an answer. Writing the failure payload
            # here is how images ended up labelled "Claude CLI error: ..." for a
            # blind reader, controls ended up with aria-label="", and a
            # paragraph was replaced with nothing, all three counted as fixes.
            if value is None:
                unreachable += 1
                line(render.unanswered(i, item, selector))
                continue

            value = value.strip('"\'').strip()
            if spec.cap:
                value = spec.cap(value)
            # This branch is a deliberate change in what fix-alt does, made in
            # the commit that collapsed the two standalone fixers (855c707) and
            # not called out in its message.
            #
            # Seven of the eight passes refused an empty answer here and counted
            # it as unanswered. fix-alt did not: it wrote the empty string into
            # the alt attribute and counted a fix, so an image flagged for
            # missing alt text came out of the run still missing it, reported as
            # fixed. There is one loop now, so it does what the seven did and
            # fix-alt refuses too.
            #
            # The window is narrow. claude_answer already returns None for an
            # answer that is empty or only whitespace, so what reaches here is
            # non-empty and this fires only when stripping the surrounding
            # quote characters leaves nothing, meaning the whole answer was
            # quote characters.
            if not value:
                unreachable += 1
                line(render.unanswered(i, item, selector))
                continue

            page.evaluate(spec.write, {'selector': selector, 'value': value,
                                       'index': item.get('index')})
            fixes.append({'selector': selector, spec.field: value})
            line(render.applied(i, item, selector, value))
        except Exception as exc:
            line(render.failed(i, item, selector, exc))

    return fixes, attempted, unreachable


def ask_claude(image_path, prompt):
    """Invoke Claude Code subprocess with screenshot + prompt, return stdout.

    Passes tools="Read" so Claude can actually open the screenshot file at
    image_path. Without this, `ask`/`describe` were secretly running text-only
    against page content + a11y tree, silently failing on canvas/WebGL pages
    where the screenshot is the ONLY source of truth.
    """
    try:
        result = subprocess.run(
            _claude_cli_args(_IRIS_VISION_MODEL,
                             f"Read the image at {image_path}\n\n{prompt}",
                             effort=_IRIS_VISION_EFFORT,
                             tools="Read"),
            capture_output=True, text=True, timeout=180,
            env=_claude_cli_env(),
        )
        if result.returncode != 0:
            return _ai_failure('subprocess failed',
                               f'Claude CLI error: {result.stderr[:200]}')
        return result.stdout.strip()
    except subprocess.TimeoutExpired:
        return _ai_failure('took >180s', 'Claude CLI timeout')
    except FileNotFoundError:
        return _ai_failure('needs-ai',
                           'Claude Code CLI not installed; this command needs it')


def ask_claude_text(prompt, timeout=90, model=_IRIS_VISION_MODEL):
    """Text-only Claude call — no screenshot. Used for textual-choice grounding.

    Research (SeeAct, ICML'24): textual-choice grounding scores 48.9% element
    accuracy vs 15.1% for image-annotation SoM. When the a11y tree has the target,
    skipping vision is both faster and more accurate. Grounding is a "pick N from
    list" task that doesn't benefit from Opus — callers can pass a faster model.
    """
    try:
        result = subprocess.run(
            _claude_cli_args(model, prompt),
            capture_output=True, text=True, timeout=timeout,
            env=_claude_cli_env(),
        )
        if result.returncode != 0:
            return _ai_failure('subprocess failed',
                               error=f'cli failed: {result.stderr[:200]}')
        return result.stdout.strip()
    except subprocess.TimeoutExpired:
        return _ai_failure('timeout', error='timeout')
    except FileNotFoundError:
        return _ai_failure('needs-ai',
                           error='needs-ai: Claude Code CLI not installed')
