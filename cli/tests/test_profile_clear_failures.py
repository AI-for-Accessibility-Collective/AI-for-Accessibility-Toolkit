"""`session profile none` has to report a withdrawal it did not finish.

Clearing the profile is a privacy control: someone runs it to stop page
content going to a model. Every way the page half of it could fail used to end
at the same sentence, "Turned off 0 tools on the open page", which is also
what a page with nothing on it prints, and the command exited 0 either way. So
a page that kept its adapters running reported the stop it had not performed —
the failure the command exists to prevent.

The fixture these tests drive defines its own `window.ai4a11y`. That is not a
contrivance: the CLI decides the tools are present by testing `typeof
window.ai4a11y !== 'undefined'`, so any object under that name gets the
"already injected" path and the real bundle never arrives. An older bundle
left in a tab, or one that half-loaded, reaches the command exactly this way.

No test here reaches a model: the fixture's stand-in tools call nothing.
"""

import json
from pathlib import Path

import pytest

from conftest import FIXTURE_URL, CliRunner

pytestmark = pytest.mark.browser

FOREIGN = (Path(__file__).parent / "fixtures" / "foreign_tools.html").resolve().as_uri()


@pytest.fixture
def on_foreign_page(chromium_session: dict, cli: CliRunner):
    """Put the session on the fixture in one of its failure modes.

    Leaves the browser back on the ordinary fixture, because the session and
    its one tab are shared with every other test in the run.
    """

    def _go(mode: str) -> None:
        assert cli("session", "go", f"{FOREIGN}#{mode}").returncode == 0

    yield _go
    cli("session", "go", FIXTURE_URL)
    cli("session", "profile", "none")


def test_a_page_that_cannot_list_its_tools_is_not_reported_as_cleared(
    on_foreign_page, cli: CliRunner
) -> None:
    """The evaluation raises, which used to be caught and turned into 0."""
    on_foreign_page("throws")

    result = cli("session", "profile", "none")

    assert result.returncode != 0, result.stdout
    assert "Turned off 0 tools" not in result.stdout, result.stdout
    assert "may still" in result.stdout.lower(), result.stdout


def test_a_tool_that_refuses_to_turn_off_is_named(
    on_foreign_page, cli: CliRunner
) -> None:
    """`disableTool` reporting failure was not read at all: the loop counted
    only its successes, so two tools left running printed as a clean run."""
    on_foreign_page("stubborn")

    result = cli("session", "profile", "none")

    assert result.returncode != 0, result.stdout
    assert "defineWords" in result.stdout, result.stdout
    assert "readerMode" in result.stdout, result.stdout


def test_a_page_that_does_not_take_the_cleared_state_is_not_reported_as_cleared(
    on_foreign_page, cli: CliRunner
) -> None:
    """Publishing the cleared state went through `?.`, so a page whose object
    has no `setSessionState` swallowed it without raising. Scan reads that
    state to decide whether to send page text out, so a silent no-op there is
    the whole defect wearing a success message."""
    on_foreign_page("stale")

    result = cli("session", "profile", "none")

    assert result.returncode != 0, result.stdout
    assert "Turned off" not in result.stdout, result.stdout


def test_the_json_payload_says_the_page_was_not_cleared(
    on_foreign_page, cli: CliRunner
) -> None:
    """A caller reading the payload gets the same answer the prose gives."""
    on_foreign_page("stubborn")

    result = cli("session", "profile", "none", "--json")

    payload = json.loads(result.stdout)
    assert payload["cleared"] is True
    assert payload["withdrawn"] is False
    assert sorted(payload["toolsStillOn"]) == ["defineWords", "readerMode"]


def test_the_saved_profile_is_cleared_even_when_the_page_cannot_be(
    on_foreign_page, cli: CliRunner, cli_env: dict
) -> None:
    """The half that always has to happen still always happens.

    Reporting the page honestly must not turn clearing into an all-or-nothing
    operation: whatever the open tab does, the profile must not come back on
    the next navigation.

    The starting profile is written into the state file rather than applied,
    because applying one hands the page the callbacks its AI-backed adapters
    call and this test has no need of them.
    """
    state = Path(cli_env["AI4A11Y_OUT"]) / ".ai4a11y_session_state.json"
    state.parent.mkdir(parents=True, exist_ok=True)
    state.write_text(json.dumps({"activeProfile": "cognitive"}))
    on_foreign_page("stubborn")

    assert cli("session", "profile", "none").returncode != 0

    assert json.loads(state.read_text()).get("activeProfile") is None


def test_a_profile_the_page_refuses_is_not_reported_as_applied(
    on_foreign_page, cli: CliRunner
) -> None:
    """The same defect on the way in, which is the same command.

    `applyProfile` reporting failure was printed as an error and then exited
    0, so applying a profile and applying nothing were one status. A person
    typing the command reads the line; anything driving it reads the status.
    """
    on_foreign_page("stubborn")

    result = cli("session", "profile", "cognitive")

    assert result.returncode != 0, result.stdout
