"""What the AI fix passes do when the model cannot be reached.

These pin behavior that already exists. Nine passes carry the same contract
(fix-alt, fix-labels, simplify, and the six inside scan), and each was written
out separately, so the contract is asserted here once per pass before it is
collapsed into one implementation. A pass that stops honoring any line in this
file has changed behavior, whatever the diff says.
"""

import json
import re
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from ai4a11y import AI_UNAVAILABLE_EXIT, NEEDS_AI_LINE  # noqa: E402

from conftest import FIXTURE_URL  # noqa: E402

FIX_COMMANDS = [
    ("fix-alt", "images"),
    ("fix-labels", "elements"),
]


@pytest.mark.browser
@pytest.mark.parametrize("command,noun", FIX_COMMANDS)
def test_unreachable_model_writes_nothing_and_says_so(
    chromium_session, run_without_claude, command, noun
):
    """No answer means no write, one needs-ai line per item, exit 3."""
    run_without_claude("session", "go", FIXTURE_URL)
    result = run_without_claude("session", command)

    assert result.returncode == AI_UNAVAILABLE_EXIT
    assert NEEDS_AI_LINE in result.stdout
    # The failure payload must never reach the page as content.
    assert "Claude Code CLI not installed" not in result.stdout
    assert "Claude CLI error" not in result.stdout


@pytest.mark.browser
@pytest.mark.parametrize("command,noun", FIX_COMMANDS)
def test_json_payload_shape_is_stable(
    chromium_session, run_without_claude, command, noun
):
    """--json prints the three-key payload and nothing else."""
    run_without_claude("session", "go", FIXTURE_URL)
    result = run_without_claude("session", command, "--json")

    payload = json.loads(result.stdout)
    assert set(payload) == {"fixed", "attempted", "skippedNeedsAi"}
    assert payload["fixed"] == []
    assert payload["skippedNeedsAi"] == payload["attempted"]
    assert payload["attempted"] > 0


@pytest.mark.browser
@pytest.mark.parametrize("command,noun", FIX_COMMANDS)
def test_partial_run_keeps_its_fixes_and_still_fails(
    chromium_session, run_with_flaky_claude, command, noun
):
    """One answered call and the rest unanswered: keep the fix, report exit 3."""
    run = run_with_flaky_claude(1)
    run("session", "go", FIXTURE_URL)
    result = run("session", command, "--json")

    payload = json.loads(result.stdout)
    assert len(payload["fixed"]) == 1
    assert payload["skippedNeedsAi"] >= 1
    assert result.returncode == AI_UNAVAILABLE_EXIT
    # The key the answer is filed under is part of the payload a caller reads.
    # Collapsing two fixers into one is exactly how it gets renamed by accident.
    expected_key = {"fix-alt": "alt", "fix-labels": "label"}[command]
    assert expected_key in payload["fixed"][0]
    assert set(payload["fixed"][0]) == {"selector", expected_key}


@pytest.mark.browser
def test_fix_all_fails_when_either_half_falls_short(
    chromium_session, run_without_claude
):
    """fix-all is not satisfied by one half succeeding."""
    run_without_claude("session", "go", FIXTURE_URL)
    result = run_without_claude("session", "fix-all")
    assert result.returncode == AI_UNAVAILABLE_EXIT


@pytest.mark.browser
def test_fix_all_fails_when_only_alt_half_succeeds(
    chromium_session, run_with_flaky_claude
):
    """One clean half does not cover for the other.

    The fixture holds two images, so a budget of 2 answered calls lets
    fix-alt finish every image it has. fix-labels runs after it in the same
    process and shares the same call counter, so it reaches no model at all.
    A collapse that let one half's success paper over the other's failure
    would turn this exit code green.

    test_ai_degradation.py has a test with the same budget for the same
    reason; a fixture change to the image count needs to update both.
    """
    run = run_with_flaky_claude(2)
    run("session", "go", FIXTURE_URL)
    result = run("session", "fix-all")

    assert result.returncode == AI_UNAVAILABLE_EXIT
    assert NEEDS_AI_LINE in result.stdout


@pytest.mark.browser
def test_scan_reports_local_and_ai_work_separately(
    chromium_session, run_without_claude
):
    """The contrast pass calls no model, so it is not counted as an AI fix."""
    run_without_claude("session", "go", FIXTURE_URL)
    result = run_without_claude("session", "scan")

    assert NEEDS_AI_LINE in result.stdout
    assert "Claude Code CLI not installed" not in result.stdout
    assert result.returncode == AI_UNAVAILABLE_EXIT

    # scan --json is not usable here: session_scan prints dozens of human
    # progress lines ahead of the payload, so json.loads fails on its stdout.
    # That is a pre-existing defect tracked separately. The human summary
    # block is stable, so the local/AI split is pinned against it instead.
    non_ai = re.search(r"Non-AI fixes:\s*(\d+)", result.stdout)
    ai = re.search(r"^\s*AI fixes:\s*(\d+)", result.stdout, re.MULTILINE)
    skipped = re.search(r"Skipped, needs AI:\s*(\d+)", result.stdout)
    assert non_ai and ai and skipped, result.stdout

    # The low-contrast paragraph in the fixture is fixed by computing a
    # luminance locally, no model involved, so it must land in the non-AI
    # count. A run with no model reachable must still show zero AI fixes,
    # never a contrast fix miscounted as one.
    assert int(non_ai.group(1)) > 0
    assert int(ai.group(1)) == 0
    assert int(skipped.group(1)) > 0

    # The totals above are satisfied by the images and the low-contrast
    # paragraph alone, so they would stay green even if the fixture's canvas
    # and video elements went missing, or if scan's canvas and video
    # sub-passes silently stopped running. Each sub-pass announces itself on
    # plain stdout before it starts, so match on that instead. The count is
    # left out of the pattern because it depends on the fixture.
    assert re.search(r"Describing \d+ canvas elements", result.stdout)
    assert re.search(r"Describing \d+ videos", result.stdout)


@pytest.mark.browser
def test_simplify_writes_nothing_without_a_model(
    chromium_session, run_without_claude
):
    """An unanswered simplify must not replace a paragraph with the empty string."""
    run_without_claude("session", "go", FIXTURE_URL)
    result = run_without_claude("session", "simplify")

    assert NEEDS_AI_LINE in result.stdout
    assert result.returncode == AI_UNAVAILABLE_EXIT
