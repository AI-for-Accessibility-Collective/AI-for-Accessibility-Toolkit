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
    "command", ["fix-alt", "fix-labels", "find-all", "audit", "scan"])
def test_json_output_is_parseable_and_alone_on_stdout(
    chromium_session: dict, run_without_claude, command: str
) -> None:
    """--json prints one JSON document and no progress lines.

    Progress used to go to stdout ahead of the payload, so --json did not
    actually parse for a caller. `scan` is in the list because it kept doing
    that after the other commands stopped: it wrote its whole scan transcript
    first, and json.loads failed on the first line of it.
    """
    result = run_without_claude("session", command, "--json")
    json.loads(result.stdout)  # raises if anything else reached stdout


def test_scan_json_carries_the_same_counts_as_the_human_summary(
    chromium_session: dict, run_without_claude
) -> None:
    """Silencing scan's progress must not change what the payload says.

    The test above only proves stdout parses. An empty payload, or one built
    from different numbers, would satisfy it. This pins the keys and checks
    the counts against the summary block a person reads.
    """
    payload = json.loads(run_without_claude("session", "scan", "--json").stdout)

    assert set(payload) == {"violations", "fixed", "textProcessing",
                            "skippedNeedsAi", "remaining"}
    assert set(payload["fixed"]) == {"nonAi", "ai", "total"}

    # A scan writes its non-AI fixes into the page, so the second run has to
    # start from a reloaded fixture or it finds fewer things left to fix.
    run_without_claude("session", "go", FIXTURE_URL)
    human = run_without_claude("session", "scan").stdout
    non_ai = re.search(r"Non-AI fixes:\s*(\d+)", human)
    ai = re.search(r"^\s*AI fixes:\s*(\d+)", human, re.MULTILINE)
    assert non_ai and ai, human
    assert payload["fixed"]["nonAi"] == int(non_ai.group(1))
    assert payload["fixed"]["ai"] == int(ai.group(1))


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
