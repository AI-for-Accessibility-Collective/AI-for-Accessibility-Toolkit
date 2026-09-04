"""A command that fails partway through must still let go of the browser.

`connected_page` exists because the connect/disconnect pair was written out at
every call site, where the disconnect was one early return or one raised
exception away from being skipped. Each skip leaks a CDP websocket into a
browser the user keeps running for the rest of the day, and enough of them
stop it accepting new ones.

So the case worth testing is the failing command, not the succeeding one: a
command that runs to the end disconnected even before the context manager
existed. The first test drives the contract directly, with a body that raises;
the second runs real failing commands against a real browser and checks the
session still works afterwards.
"""

import sys

import pytest

from conftest import FIXTURE_URL, REPO_ROOT, CliRunner

sys.path.insert(0, str(REPO_ROOT / "cli"))
from ai4a11y import browser  # noqa: E402

# Port 1 is on Chromium's blocked-port list, so this navigation fails the same
# way on every machine and every run, immediately and without a socket: no
# waiting on a timeout, and nothing another process could bind mid-run and turn
# into a passing navigation. It fails after the connection to the browser is
# open, which is the part that matters here.
UNREACHABLE = "http://127.0.0.1:1/"


@pytest.fixture
def detachments(monkeypatch) -> list:
    """Record every disconnect, and hand out a page with no browser behind it.

    Both halves of the pair are replaced, so this needs no browser and cannot
    be satisfied by a connection that was never opened.
    """
    seen: list = []
    monkeypatch.setattr(browser, "session_connect",
                        lambda: ("playwright", "browser", "page"))
    monkeypatch.setattr(browser, "session_disconnect",
                        lambda p, b: seen.append((p, b)))
    return seen


def test_connected_page_detaches_when_the_body_raises(detachments: list) -> None:
    """The leak this replaced: an exception between connect and disconnect."""
    with pytest.raises(RuntimeError, match="boom"):
        with browser.connected_page() as page:
            assert page == "page"
            raise RuntimeError("boom")

    assert detachments == [("playwright", "browser")]


def test_connected_page_detaches_when_the_body_returns(detachments: list) -> None:
    """The case that already worked, kept so a fix cannot trade one for the other."""
    with browser.connected_page() as page:
        assert page == "page"

    assert detachments == [("playwright", "browser")]


@pytest.mark.browser
def test_repeated_failing_commands_leave_the_session_usable(
    chromium_session: dict, cli: CliRunner
) -> None:
    """Twelve commands that raise mid-flight, then a session that still answers.

    `session go` does not catch a navigation failure, so each of these raises
    inside `connected_page` with the connection open — the shape that used to
    leak one websocket per command. The assertion on stderr is what makes this
    a test of the leak rather than of the error message: a `net::` error means
    the browser was reached and refused the URL, where a run that failed before
    connecting would say `NoSession` and would prove nothing.
    """
    for _ in range(12):
        failed = cli("session", "go", UNREACHABLE)
        assert failed.returncode != 0, failed.stdout
        assert "net::" in failed.stderr, failed.stderr
        assert UNREACHABLE in failed.stderr, failed.stderr

    assert cli("session", "status").returncode == 0
    assert cli("session", "tabs").returncode == 0

    # Put the fixture back for whatever runs next: the failed navigations
    # above leave the tab wherever the last successful one left it, and a
    # module that assumes the fixture is loaded runs after this one.
    assert cli("session", "go", FIXTURE_URL).returncode == 0
