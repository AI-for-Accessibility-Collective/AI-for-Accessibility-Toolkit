"""A command that cannot reach Claude must change nothing and say so.

Each test runs a real fix command against the live fixture with the Claude
Code CLI hidden from PATH, then compares the page against the snapshot taken
before the run. The commands under test consume model output and write it
straight into the page, so "the model was unreachable" has to stop at the
call site rather than travel on as alt text, as a label, or as an empty
string that replaces a paragraph.

Two tests further down use a stand-in ``claude`` that answers a set number of
calls and then stops, because degradation is partial more often than total.

No AI model is called: nothing on the trimmed PATH can call one, and the
stand-in is a shell script.
"""

import json
import re
import subprocess
import sys

import pytest
from playwright.sync_api import sync_playwright

from conftest import FIXTURE_URL, REPO_ROOT, CliRunner

sys.path.insert(0, str(REPO_ROOT / "cli"))
from ai4a11y import AI_UNAVAILABLE_EXIT  # noqa: E402

pytestmark = pytest.mark.browser


@pytest.fixture(autouse=True)
def _fresh_page(chromium_session: dict, cli: CliRunner) -> None:
    """Reload the fixture before every test.

    These tests assert that a command left the page alone, so each one has to
    start from a page no earlier command has written to.
    """
    result = cli("session", "go", FIXTURE_URL)
    assert result.returncode == 0, result.stderr


def _page_html(env: dict) -> str:
    """The page body, with one screenshot artifact normalized away.

    Taking an element screenshot makes Playwright hide the text caret, which it
    does by setting an inline style on the page's inputs and then clearing it.
    That leaves style="" behind on elements no command touched, so an empty
    style attribute is dropped before the comparison. Any attribute or text a
    command actually wrote still shows up as a difference.
    """
    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp(
            f"http://localhost:{env['AI4A11Y_CDP_PORT']}"
        )
        try:
            page = [pg for c in browser.contexts for pg in c.pages][0]
            html = page.evaluate("() => document.body.outerHTML")
        finally:
            browser.close()
    return html.replace(' style=""', "")


@pytest.mark.parametrize("command", [("fix-alt",), ("fix-labels",), ("scan",)])
def test_fix_command_reports_failure_when_claude_is_missing(
    chromium_session: dict, run_without_claude, command: tuple
) -> None:
    result = run_without_claude("session", *command)
    assert result.returncode != 0, f"reported success:\n{result.stdout}"
    assert "needs-ai" in (result.stdout + result.stderr).lower()


@pytest.mark.parametrize("command", [("fix-alt",), ("fix-labels",)])
def test_fix_command_leaves_the_page_untouched_when_claude_is_missing(
    chromium_session: dict, run_without_claude, command: tuple
) -> None:
    before = _page_html(chromium_session)
    run_without_claude("session", *command)
    assert _page_html(chromium_session) == before


def test_scan_never_erases_text_when_claude_is_missing(
    chromium_session: dict, run_without_claude
) -> None:
    """Scan's non-AI fixes may touch attributes; its AI path must not touch text."""
    def paragraphs() -> list:
        with sync_playwright() as p:
            browser = p.chromium.connect_over_cdp(
                f"http://localhost:{chromium_session['AI4A11Y_CDP_PORT']}"
            )
            try:
                page = [pg for c in browser.contexts for pg in c.pages][0]
                return page.evaluate(
                    "() => [...document.querySelectorAll('p')].map(e => e.textContent)"
                )
            finally:
                browser.close()

    # The simplify and summarize paths only run under a profile that asks for
    # them.
    run_without_claude("session", "profile", "cognitive")

    before = paragraphs()
    assert any(len(t.strip()) > 500 for t in before), "fixture must carry a long block"

    result = run_without_claude("session", "scan")
    assert "Simplifying" in result.stdout, "the simplify pass did not run"
    assert paragraphs() == before


def test_no_element_is_given_an_empty_label_when_claude_is_missing(
    chromium_session: dict, run_without_claude
) -> None:
    run_without_claude("session", "fix-labels")
    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp(
            f"http://localhost:{chromium_session['AI4A11Y_CDP_PORT']}"
        )
        try:
            page = [pg for c in browser.contexts for pg in c.pages][0]
            empty = page.evaluate(
                "() => [...document.querySelectorAll('[aria-label]')]"
                ".filter(e => !e.getAttribute('aria-label').trim()).length"
            )
        finally:
            browser.close()
    assert empty == 0


@pytest.mark.parametrize(
    "command",
    ["fix-alt", "fix-labels", "fix-all", "find-all", "audit", "scan", "simplify"])
def test_json_output_is_parseable_and_alone_on_stdout(
    chromium_session: dict, run_without_claude, run_with_flaky_claude, command: str
) -> None:
    """--json prints one JSON document and no progress lines.

    Progress used to go to stdout ahead of the payload, so --json did not
    actually parse for a caller. `scan` and `simplify` are in the list because
    they kept doing that after the other commands stopped: scan wrote its whole
    transcript first, simplify wrote two lines, and json.loads failed on the
    first line either way. `fix-all` was the last of them, and the only one
    where silencing the banners was not the whole fix: it ran two commands that
    each emitted a payload, so stdout held two documents and no amount of
    quieting made that one.

    `simplify` is the one command here given a model that answers. It has no
    payload at all for a run where the model was unreachable: it prints one
    needs-ai sentence and stops, so with nothing on PATH there would be no
    document to check and the case this test exists for would go uncovered.
    The stand-in is a shell script, so no model is called for it either.

    The page is already the fixture when this runs: `_fresh_page` above is
    autouse, so it navigates before every test in this file, `-k` selection
    included. Do not add a `session go` here as well. A second navigation
    right before the command leaves the page in a state where a later
    element screenshot waits out its full 30 second timeout, which turns
    three of the fix tests further down into 60 second failures.
    """
    run = run_with_flaky_claude(1) if command == "simplify" else run_without_claude
    result = run("session", command, "--json")
    json.loads(result.stdout)  # raises if anything else reached stdout


def test_scan_json_carries_the_same_counts_as_the_human_summary(
    chromium_session: dict, run_without_claude
) -> None:
    """Silencing scan's progress must not change what the payload says.

    The test above only proves stdout parses. An empty payload, or one built
    from different numbers, would satisfy it. This pins the keys and checks
    the counts against the summary block a person reads.
    """
    # `_fresh_page` has already loaded the fixture for the first run. The
    # second one needs the reload below, because a scan writes its non-AI fixes
    # into the page and a scan of an already fixed page finds fewer things left
    # to fix. Without it the two sets of counts come off different pages and
    # the comparison means nothing.
    payload = json.loads(run_without_claude("session", "scan", "--json").stdout)

    assert set(payload) == {"violations", "fixed", "textProcessing",
                            "skippedNeedsAi", "remaining"}
    assert set(payload["fixed"]) == {"nonAi", "ai", "total"}

    run_without_claude("session", "go", FIXTURE_URL)
    human = run_without_claude("session", "scan").stdout
    non_ai = re.search(r"Non-AI fixes:\s*(\d+)", human)
    ai = re.search(r"^\s*AI fixes:\s*(\d+)", human, re.MULTILINE)
    assert non_ai and ai, human
    assert payload["fixed"]["nonAi"] == int(non_ai.group(1))
    assert payload["fixed"]["ai"] == int(ai.group(1))


def test_fix_all_json_combines_both_halves_into_one_document(
    chromium_session: dict, run_without_claude
) -> None:
    """The combined payload is a fix payload, plus the split.

    `fix-all` runs the alt pass and the label pass, and a caller wants both the
    whole run and the halves. The top level carries the same three keys in the
    same types as `fix-alt --json` and `fix-labels --json`, so anything that
    already reads a fix payload reads this one, and `passes` holds each half
    unchanged for a caller that wants to tell them apart.

    The totals are checked against the halves rather than against fixed
    numbers, so this keeps testing the arithmetic on a fixture page that grows
    new defects later.
    """
    payload = json.loads(run_without_claude("session", "fix-all", "--json").stdout)

    assert set(payload) == {"fixed", "attempted", "skippedNeedsAi", "passes"}
    assert set(payload["passes"]) == {"alt", "labels"}

    alt, labels = payload["passes"]["alt"], payload["passes"]["labels"]
    for half in (alt, labels):
        assert set(half) == {"fixed", "attempted", "skippedNeedsAi"}

    assert payload["fixed"] == alt["fixed"] + labels["fixed"]
    assert payload["attempted"] == alt["attempted"] + labels["attempted"]
    assert payload["skippedNeedsAi"] == (
        alt["skippedNeedsAi"] + labels["skippedNeedsAi"])

    # With no model reachable nothing is fixed and everything attempted is
    # skipped, which is what makes the exit status nonzero. Asserting it here
    # keeps the payload honest about a fully degraded run rather than only
    # internally consistent.
    assert payload["fixed"] == []
    assert payload["skippedNeedsAi"] == payload["attempted"] > 0


def test_fix_all_human_output_still_names_both_halves(
    chromium_session: dict, run_without_claude
) -> None:
    """Combining the payload must not disturb what a person sees.

    The banners are the only thing separating the two halves in the human
    output, and they are now printed through the same silenced writer as the
    progress lines, which is exactly the kind of change that drops them.
    """
    human = run_without_claude("session", "fix-all").stdout

    assert "=== Fixing Alt Text ===" in human, human
    assert "=== Fixing Labels ===" in human, human
    assert "=== Done ===" in human, human
    assert "{" not in human, human


@pytest.mark.parametrize("command", [("fix-alt",), ("fix-labels",)])
def test_json_output_reports_what_was_skipped(
    chromium_session: dict, run_without_claude, command: tuple
) -> None:
    """A caller reading --json has to be able to see how far a run got.

    Exit status says a run was degraded but not by how much, so a run that
    fixed nine items of ten and one that fixed none look alike from outside
    unless the payload says otherwise.
    """
    result = run_without_claude("session", *command, "--json")
    payload = json.loads(result.stdout)

    assert payload["fixed"] == []
    assert payload["skippedNeedsAi"] > 0
    assert payload["attempted"] == payload["skippedNeedsAi"]


def test_a_partly_degraded_run_exits_nonzero(
    chromium_session: dict, run_with_flaky_claude
) -> None:
    """Some answers is not success.

    The fixture holds two images. Answering one of them and failing the other
    leaves the page part fixed and part not, which a caller checking only the
    exit status would otherwise read as a clean run.
    """
    run = run_with_flaky_claude(1)
    result = run("session", "fix-alt", "--json")
    payload = json.loads(result.stdout)

    assert len(payload["fixed"]) == 1, payload
    assert payload["skippedNeedsAi"] == 1, payload
    assert result.returncode == AI_UNAVAILABLE_EXIT, result.stdout


def test_fix_all_fails_when_only_one_half_degraded(
    chromium_session: dict, run_with_flaky_claude
) -> None:
    """One clean half does not cover for the other.

    Answering both images and nothing after it means ``fix-alt`` finishes
    cleanly and ``fix-labels`` reaches no model at all.

    The budget of 2 is tied to the fixture holding two images. test_fix_passes.py
    has a test with the same budget for the same reason; a fixture change to the
    image count needs to update both.
    """
    run = run_with_flaky_claude(2)
    result = run("session", "fix-all")

    assert "needs-ai" in (result.stdout + result.stderr).lower()
    assert result.returncode == AI_UNAVAILABLE_EXIT, result.stdout
