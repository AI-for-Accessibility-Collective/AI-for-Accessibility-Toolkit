"""Scan asks the page which text tools the active profile wants.

That answer lives in session state, which a navigation sets. Scan does not
navigate, so whether its simplify and summarize passes ran depended on whether
a `session go` happened to fall between `session profile` and the scan. These
tests fix the passes to the profile rather than to command ordering.
"""

import json
import subprocess
import sys

import pytest

from conftest import FIXTURE_URL, REPO_ROOT, CliRunner

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


# --- What clearing the profile does to an open page ---------------------------
#
# cli/README.md tells a reader that `session profile none` stops page text
# reaching a model. That is a claim about a privacy control, so it is pinned
# here rather than trusted, in both of the ways the profile can keep a page
# talking to a model: the session state that scan reads, and the adapters the
# profile switched on, which run on their own from page events. No test here
# reaches a model: the scans run through run_without_claude, which strips PATH
# so there is no claude binary to call.


def test_clearing_the_profile_stops_the_text_passes_on_the_open_page(
    chromium_session: dict, run_without_claude, cli: CliRunner
) -> None:
    """`session profile none` reaches the page, not only the state file.

    It used to write a null profile into the session state file and return
    without connecting to the browser, and the helper that publishes the
    profile into the page returned early when the profile was falsy, so the
    value published earlier stood. The tab kept the profile until it was
    replaced, which meant a person who ran this command to stop page text
    leaving the browser had not stopped it.
    """
    assert cli("session", "profile", "cognitive").returncode == 0

    armed = run_without_claude("session", "scan")
    assert "Simplifying" in armed.stdout, armed.stdout

    assert cli("session", "profile", "none").returncode == 0

    after = run_without_claude("session", "scan")
    assert "Simplifying" not in after.stdout, after.stdout
    assert "Summarizing" not in after.stdout, after.stdout


def test_clearing_the_profile_turns_off_the_adapters_it_switched_on(
    chromium_session: dict, cli: CliRunner
) -> None:
    """The other half, which the session-state fix alone does not cover.

    `defineWords` is one of the tools the cognitive profile enables. It binds
    document-level listeners and asks a model for a definition when one fires,
    and it consults no session state, so publishing a cleared profile would
    leave it running. Clearing the profile has to turn the tools off the way
    applying one does, or the command reports a stop it did not perform.
    """
    assert cli("session", "profile", "cognitive").returncode == 0

    armed = json.loads(cli("session", "tools", "--json").stdout)
    assert {t["name"]: t["enabled"] for t in armed}["defineWords"] is True

    assert cli("session", "profile", "none").returncode == 0

    after = json.loads(cli("session", "tools", "--json").stdout)
    still_on = [t["name"] for t in after if t["enabled"]]
    assert still_on == [], still_on


def test_clearing_the_profile_works_with_no_browser_session(
    cli_env: dict, tmp_path
) -> None:
    """Clearing has to keep working when there is no page to clear.

    This command wrote a state file and never connected, so it succeeded
    without a session. Now that it reaches for the page, a missing session is
    the ordinary case rather than an error: the saved profile still has to be
    cleared, and the command has to say that it found nothing to reach instead
    of reporting a page it did not touch.

    Its own home and output directories, because the session-scoped browser
    fixture writes a session file into the shared ones and this test needs
    there to be no session at all.
    """
    env = {
        **cli_env,
        "AI4A11Y_HOME": str(tmp_path / "home"),
        "AI4A11Y_OUT": str(tmp_path / "out"),
    }
    state = tmp_path / "out" / ".ai4a11y_session_state.json"
    state.parent.mkdir(parents=True, exist_ok=True)
    state.write_text(json.dumps({"activeProfile": "cognitive"}))

    result = subprocess.run(
        [sys.executable, "-m", "cli.cli", "session", "profile", "none"],
        cwd=REPO_ROOT, env=env, capture_output=True, text=True, timeout=120,
    )

    assert result.returncode == 0, result.stderr
    assert "Profile cleared" in result.stdout, result.stdout
    assert json.loads(state.read_text()).get("activeProfile") is None
    assert "no browser session" in result.stdout.lower(), result.stdout


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
