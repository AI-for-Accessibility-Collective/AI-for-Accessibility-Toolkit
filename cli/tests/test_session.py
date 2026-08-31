"""Session commands against a live headless page. No AI calls.

The chromium_session fixture provides the browser; tests then drive it through
the same commands a user types. Ordered so navigation happens first.
"""

import json

import pytest

from conftest import FIXTURE_URL, CliRunner

pytestmark = pytest.mark.browser

# Defects planted in fixtures/defects.html, by axe-core rule id.
PLANTED = {"image-alt", "html-has-lang", "color-contrast", "button-name", "link-name"}


@pytest.fixture(scope="module", autouse=True)
def _navigate(chromium_session: dict, cli: CliRunner) -> None:
    result = cli("session", "go", FIXTURE_URL)
    assert result.returncode == 0, result.stderr
    assert "CLI harness fixture" in result.stdout


def test_audit_finds_planted_defects(cli: CliRunner) -> None:
    result = cli("session", "audit", "--json")
    assert result.returncode == 0, result.stderr
    data = json.loads(result.stdout)
    found = {v["id"] for v in data["violations"]}
    assert PLANTED <= found, f"missing: {PLANTED - found}"


def test_enable_and_disable_adapter(cli: CliRunner) -> None:
    result = cli("session", "enable", "darkMode")
    assert result.returncode == 0, result.stderr
    assert "Enabled: darkMode" in result.stdout

    result = cli("session", "disable", "darkMode")
    assert result.returncode == 0, result.stderr
    assert "Disabled: darkMode" in result.stdout


def test_profile_applies_its_tools(cli: CliRunner) -> None:
    result = cli("session", "profile", "lowVision")
    assert result.returncode == 0, result.stderr
    assert "reflowColumn" in result.stdout


def test_tools_lists_status(cli: CliRunner) -> None:
    result = cli("session", "tools")
    assert result.returncode == 0, result.stderr
    assert "darkMode" in result.stdout


def test_read_extracts_article_text(cli: CliRunner) -> None:
    result = cli("session", "read")
    assert result.returncode == 0, result.stderr
    assert "Plain readable paragraph" in result.stdout


# Whether a command lets go of its browser connection is in
# test_connection_cleanup.py, which drives the failing command that leaked one.
