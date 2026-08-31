"""What a command says when the tools bundle cannot be injected at all.

Every session command starts by putting the bundle into the page, and the
failure of that step was reported the same way everywhere: a line of prose on
stdout, and then whatever the command would otherwise have done. Under --json
that line shares stdout with the payload, so the answer a caller parses is
either unparseable or absent while the command still exits 0.

The fixture is a page whose content policy refuses every script, which is the
ordinary way this happens to someone: a site with a strict CSP. No test here
reaches a model; nothing gets far enough to try.
"""

import json
from pathlib import Path

import pytest

from conftest import FIXTURE_URL, CliRunner

pytestmark = pytest.mark.browser

BLOCKED = (Path(__file__).parent / "fixtures" / "blocked_scripts.html").resolve().as_uri()


@pytest.fixture
def on_a_page_that_blocks_scripts(chromium_session: dict, cli: CliRunner):
    """Leave the session on the page no script can be injected into.

    Puts the browser back on the ordinary fixture afterwards, because the
    session and its one tab are shared with every other test in the run.
    """
    assert cli("session", "go", BLOCKED).returncode == 0
    yield
    cli("session", "go", FIXTURE_URL)


def test_clearing_the_profile_still_answers_in_json(
    on_a_page_that_blocks_scripts, cli: CliRunner
) -> None:
    """`profile none --json` promises one document on stdout.

    The injection diagnostic printed there ahead of it, so the caller of a
    privacy control got a stream that did not parse.
    """
    result = cli("session", "profile", "none", "--json")

    payload = json.loads(result.stdout)
    assert payload["cleared"] is True
    assert payload["withdrawn"] is False
    assert result.returncode != 0
    assert "inject" in result.stderr.lower(), result.stderr


def test_fix_all_puts_nothing_but_its_own_output_on_stdout(
    on_a_page_that_blocks_scripts, cli: CliRunner
) -> None:
    """A run that produces no payload has to produce no stdout either.

    `fix-all --json` printed a human error and returned no document, so a
    caller that parsed stdout got an exception rather than an answer.
    """
    result = cli("session", "fix-all", "--json")

    assert result.stdout.strip() == "", result.stdout
    assert "inject" in result.stderr.lower(), result.stderr


def test_fix_all_exits_non_zero_when_it_could_not_start(
    on_a_page_that_blocks_scripts, cli: CliRunner
) -> None:
    """The status is the only part of this a script reads.

    A failed injection returned None from the command, which `_exit` reads as
    success, so a fix run that fixed nothing and could not have exited 0.
    """
    result = cli("session", "fix-all")

    assert result.returncode != 0, result.stdout


def test_fix_alt_exits_non_zero_when_it_could_not_start(
    on_a_page_that_blocks_scripts, cli: CliRunner
) -> None:
    """The same for a single fix command, which is where the shape came from."""
    result = cli("session", "fix-alt")

    assert result.returncode != 0, result.stdout


def test_applying_a_profile_exits_non_zero_when_it_could_not_start(
    on_a_page_that_blocks_scripts, cli: CliRunner
) -> None:
    """`profile <name>` is the other half of the privacy control.

    A profile that could not be injected is a profile that is not on the page,
    and saying so only in prose on stdout left a caller with a success status
    for a page nothing had been applied to.
    """
    result = cli("session", "profile", "cognitive")

    assert result.returncode != 0, result.stdout
    assert "inject" in result.stderr.lower(), result.stderr
