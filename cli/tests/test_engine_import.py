"""A broken dependency must name itself, not the module that failed to load it.

The engine is imported on first use so the catalog commands work without
Playwright installed. Whatever goes wrong in that import is what the user has
to fix, so it has to survive the trip out.
"""

import subprocess
import sys

import pytest

from conftest import REPO_ROOT


def test_a_missing_dependency_names_itself(monkeypatch: pytest.MonkeyPatch) -> None:
    sys.path.insert(0, str(REPO_ROOT))
    from cli import cli

    # Make the engine's own `from playwright.sync_api import ...` fail the way
    # it does on a machine where the CLI was installed without its extras.
    monkeypatch.delitem(sys.modules, "cli.ai4a11y", raising=False)
    monkeypatch.setitem(sys.modules, "playwright.sync_api", None)

    with pytest.raises(ImportError) as raised:
        cli._engine()

    assert "playwright" in str(raised.value), str(raised.value)
    assert "ai4a11y" not in str(raised.value), str(raised.value)


def test_the_engine_still_loads_when_run_as_a_plain_script() -> None:
    """`python cli/cli.py` puts cli/ on sys.path with no package around it, so
    the engine has to be reachable by its bare name too."""
    result = subprocess.run(
        [sys.executable, "cli/cli.py", "session", "status"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert "No session running" in result.stdout
