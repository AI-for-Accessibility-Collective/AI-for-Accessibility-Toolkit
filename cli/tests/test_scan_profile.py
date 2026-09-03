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
