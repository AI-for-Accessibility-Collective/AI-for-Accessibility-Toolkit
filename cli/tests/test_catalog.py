"""Catalog commands: no browser, no AI. Counts are computed from the tree."""

import json

from conftest import REPO_ROOT, CliRunner


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
