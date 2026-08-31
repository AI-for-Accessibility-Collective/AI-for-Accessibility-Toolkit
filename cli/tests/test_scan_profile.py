"""Scan asks the page which text tools the active profile wants.

That answer lives in session state, which a navigation sets. Scan does not
navigate, so whether its simplify and summarize passes ran depended on whether
a `session go` happened to fall between `session profile` and the scan. These
tests fix the passes to the profile rather than to command ordering.
"""

import json

import pytest

from conftest import FIXTURE_URL, CliRunner

pytestmark = pytest.mark.browser


@pytest.fixture(autouse=True)
def _fresh_page(chromium_session: dict, cli: CliRunner) -> None:
    result = cli("session", "go", FIXTURE_URL)
    assert result.returncode == 0, result.stderr
    yield
    cli("session", "profile", "none")


def test_scan_runs_the_text_passes_the_active_profile_asks_for(
    chromium_session: dict, run_without_claude, cli: CliRunner
) -> None:
    """The profile is set after the page is already open, which is the ordering
    that used to leave the passes switched off."""
    assert cli("session", "profile", "cognitive").returncode == 0

    result = run_without_claude("session", "scan")
    assert "Simplifying" in result.stdout, result.stdout
    assert "Summarizing" in result.stdout, result.stdout


def test_scan_runs_no_text_passes_without_a_profile(
    chromium_session: dict, run_without_claude, cli: CliRunner
) -> None:
    """The counterpart: the passes are driven by the profile, not switched on
    for everyone."""
    assert cli("session", "profile", "none").returncode == 0

    result = run_without_claude("session", "scan")
    assert "Simplifying" not in result.stdout, result.stdout
    assert "Summarizing" not in result.stdout, result.stdout


# --- What clearing the profile does, and does not, do to an open page ---------
#
# cli/README.md tells a reader that `session profile none` does not stop page
# text reaching a model on the page they already have open, and that loading a
# page is what stops it. That is a claim about a privacy control, so both halves
# are pinned here rather than trusted. Neither test reaches a model: the scans
# run through run_without_claude, which strips PATH so there is no claude
# binary to call.


def test_clearing_the_profile_leaves_the_open_page_still_asking_for_text_passes(
    chromium_session: dict, run_without_claude, cli: CliRunner
) -> None:
    """`session profile none` clears the saved profile, not the open page.

    It writes a null profile into the session state file and returns without
    connecting to the browser, and the helper that publishes the profile into
    the page returns early when the profile is falsy, so it never overwrites
    the value it published earlier. The page keeps the profile it was given.

    This pins the behavior we measured, not the behavior anyone wants. If
    `session profile none` is changed to push the clear into the page, this
    test fails, and the paragraph in cli/README.md that it guards has to change
    with it.
    """
    assert cli("session", "profile", "cognitive").returncode == 0

    armed = run_without_claude("session", "scan")
    assert "Simplifying" in armed.stdout, armed.stdout

    assert cli("session", "profile", "none").returncode == 0

    after = run_without_claude("session", "scan")
    assert "Simplifying" in after.stdout, after.stdout
    assert "Summarizing" in after.stdout, after.stdout


def test_loading_a_page_after_clearing_the_profile_does_stop_the_text_passes(
    chromium_session: dict, run_without_claude, cli: CliRunner
) -> None:
    """The mitigation the README names has to keep working.

    A navigation gives the tab a new document, and with no saved profile
    nothing republishes one into it, so the passes stop. This is the only
    advice we can give a user who wants page text to stop leaving the browser,
    so it is worth a test of its own.
    """
    assert cli("session", "profile", "cognitive").returncode == 0

    armed = run_without_claude("session", "scan")
    assert "Simplifying" in armed.stdout, armed.stdout

    assert cli("session", "profile", "none").returncode == 0
    assert cli("session", "go", FIXTURE_URL).returncode == 0

    after = run_without_claude("session", "scan")
    assert "Simplifying" not in after.stdout, after.stdout
    assert "Summarizing" not in after.stdout, after.stdout
