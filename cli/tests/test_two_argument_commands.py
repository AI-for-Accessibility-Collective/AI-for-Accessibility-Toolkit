"""Two commands hand their script two values. The script has to receive both.

`page.evaluate(script, arg)` passes exactly one argument. A script written as
`(a, b) => ...` therefore gets the whole list as `a` and never sees `b`, which
is how `session heading` came to ignore the level it was given and walk
backwards on every call, and how every `session media` action came to report
status and change nothing.

The repository's convention for this is one destructured parameter,
`([a, b]) => ...`, which `text_recovery_scroll.js` and `verify_click_landed.js`
already use. These tests pin the behavior rather than the convention: they
assert what a person typing the command gets back, so a script rewritten some
other way still passes as long as both values arrive.
"""

import pytest

from conftest import FIXTURE_URL, CliRunner

pytestmark = pytest.mark.browser


@pytest.fixture(autouse=True)
def _fresh_page(chromium_session: dict, cli: CliRunner) -> None:
    result = cli("session", "go", FIXTURE_URL)
    assert result.returncode == 0, result.stderr


# --- session heading ---------------------------------------------------------
#
# The fixture page has an h1 ("Fixture page") and an h3 ("Skipped heading
# level"), in that document order and nothing else. That is enough to tell the
# two directions apart: from a page with no heading focused, "next" is the
# first heading and "prev" is the last.


def test_heading_next_moves_forward_from_the_top_of_the_page(cli: CliRunner) -> None:
    """`next` means the first heading, not the last.

    With both values arriving as one list, `direction === 'next'` was never
    true, so every call took the backwards branch and wrapped to the end of the
    document. On this page that returned the h3 when asked for the next
    heading.
    """
    result = cli("session", "heading", "next")
    assert result.returncode == 0, result.stderr
    assert "[h1]" in result.stdout, result.stdout
    assert "Fixture page" in result.stdout, result.stdout


def test_heading_prev_moves_backward_from_the_top_of_the_page(cli: CliRunner) -> None:
    """The counterpart, so the test above is pinning a direction and not just
    the first line of the page."""
    result = cli("session", "heading", "prev")
    assert result.returncode == 0, result.stderr
    assert "[h3]" in result.stdout, result.stdout


def test_heading_level_selects_only_that_level(cli: CliRunner) -> None:
    """The level argument narrows the search.

    Asking for the next level 3 heading has to return the h3 whether or not it
    is the one `next` would have reached anyway, which is why the level 1 case
    below is here too.
    """
    result = cli("session", "heading", "next", "3")
    assert result.returncode == 0, result.stderr
    assert "[h3]" in result.stdout, result.stdout
    assert "Skipped heading level" in result.stdout, result.stdout


def test_heading_level_one_is_not_the_same_answer_as_level_three(
    cli: CliRunner,
) -> None:
    """Two different levels must give two different headings.

    Without this the level test above passes on a build that ignores the level
    entirely, because the h3 is also what the broken backwards walk returned.
    """
    level_one = cli("session", "heading", "next", "1")
    assert level_one.returncode == 0, level_one.stderr
    assert "[h1]" in level_one.stdout, level_one.stdout

    level_three = cli("session", "heading", "next", "3")
    assert "[h3]" in level_three.stdout, level_three.stdout


def test_heading_rejects_a_level_outside_one_to_six(cli: CliRunner) -> None:
    """The guard in front of the script keeps working."""
    result = cli("session", "heading", "next", "9")
    assert "Invalid heading level 9" in result.stdout, result.stdout


# --- session media -----------------------------------------------------------
#
# The fixture page has one muted <video> with a real, if tiny, MP4 in a data
# URI. The actions asserted here are the ones that take effect synchronously,
# so nothing waits on playback: `rate` and `volume` set a property and read it
# straight back. `play` is deliberately not asserted on, because
# HTMLMediaElement.play() returns a promise and whether the element reports
# itself playing by the time the command prints is a race.


def test_media_rate_sets_the_playback_rate_it_was_given(cli: CliRunner) -> None:
    """This is the second value arriving, not just the action.

    Every action fell through to the default branch before, which reports
    status and changes nothing, so a `rate` that reported "Speed: 1.5x" is
    evidence that both the action and its value reached the script.
    """
    result = cli("session", "media", "rate", "1.5")
    assert result.returncode == 0, result.stderr
    assert "Speed: 1.5x" in result.stdout, result.stdout
    assert "1.5x)" in result.stdout, result.stdout


def test_media_volume_sets_the_volume_it_was_given(cli: CliRunner) -> None:
    """A second action, so the test above is not pinning one lucky branch."""
    result = cli("session", "media", "volume", "0.25")
    assert result.returncode == 0, result.stderr
    assert "Volume: 25%" in result.stdout, result.stdout


def test_media_status_still_reports_status(cli: CliRunner) -> None:
    """The control.

    `status` was the one action that behaved correctly while the argument was
    being dropped, because the default branch is what it wants anyway. It has
    to keep working, and it is what tells us the tests above are reading a
    changed branch rather than a changed page.
    """
    result = cli("session", "media", "status")
    assert result.returncode == 0, result.stderr
    assert "Status" in result.stdout, result.stdout
    assert "[video]" in result.stdout, result.stdout


def test_media_reports_when_the_page_has_no_media(cli: CliRunner) -> None:
    """about:blank has no video, and the error path does not depend on the
    argument fix, so it pins the shape of a miss."""
    assert cli("session", "go", "about:blank").returncode == 0
    result = cli("session", "media", "status")
    assert "No video or audio found on page" in result.stdout, result.stdout
