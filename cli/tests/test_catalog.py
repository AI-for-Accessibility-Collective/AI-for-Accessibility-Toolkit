"""Catalog commands: no browser, no AI. Counts are computed from the tree."""

import json

import pytest

from conftest import FIXTURE_URL, REPO_ROOT, CliRunner


def _catalog_files(subdir: str) -> set:
    d = REPO_ROOT / "tools" / subdir
    return {f.stem for f in d.glob("*.js") if f.name != "index.js"}


def test_list_tools_matches_the_tree(cli: CliRunner) -> None:
    result = cli("list", "tools", "--json")
    assert result.returncode == 0, result.stderr
    data = json.loads(result.stdout)

    assert {t["name"] for t in data["auditors"]} == _catalog_files("auditors")
    assert {t["name"] for t in data["adapters"]} == _catalog_files("adapters")
    for entry in data["auditors"] + data["adapters"]:
        assert entry["name"]
        assert "path" in entry and "description" in entry


def test_list_profiles_matches_settings_json(cli: CliRunner) -> None:
    result = cli("list", "profiles", "--json")
    assert result.returncode == 0, result.stderr
    data = json.loads(result.stdout)

    settings = json.loads((REPO_ROOT / "tools" / "profiles" / "settings.json").read_text())
    assert set(data) == set(settings["profiles"])


def test_no_args_shows_usage(cli: CliRunner) -> None:
    result = cli()
    assert result.returncode == 0
    assert "session" in result.stdout


def test_json_flag_is_accepted_before_the_subcommand(cli: CliRunner) -> None:
    """The pre-Typer CLI took --json anywhere in the line. Keeping that working
    means a script written against the older syntax does not silently break."""
    result = cli("--json", "list", "tools")
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout)["auditors"]


@pytest.mark.browser
def test_find_all_agrees_with_each_auditor_run_alone(chromium_session, cli):
    """find-all must report the same counts the individual auditors report.

    They used to be separate code paths over the same page, so they could
    disagree without anything failing.
    """
    go = cli("session", "go", FIXTURE_URL)
    assert go.returncode == 0, go.stderr

    combined_result = cli("session", "find-all", "--json")
    assert combined_result.returncode == 0, combined_result.stderr
    combined = json.loads(combined_result.stdout)

    for key, command in [
        ("missingAlt", "find-missing-alt"),
        ("missingLabels", "find-missing-labels"),
        ("missingCaptions", "find-missing-captions"),
    ]:
        alone_result = cli("session", command, "--json")
        assert alone_result.returncode == 0, alone_result.stderr
        alone = json.loads(alone_result.stdout)
        assert combined["summary"][key] == alone.get("total", 0), key

    # Contrast is the one asymmetric auditor: its payload is a plain list with
    # no "total" key, and find-all summarizes it with len() rather than
    # result.get('total', 0). Compare it the same way find-all does.
    contrast_result = cli("session", "find-poor-contrast", "--json")
    assert contrast_result.returncode == 0, contrast_result.stderr
    contrast = json.loads(contrast_result.stdout)
    assert combined["summary"]["poorContrast"] == len(contrast)
