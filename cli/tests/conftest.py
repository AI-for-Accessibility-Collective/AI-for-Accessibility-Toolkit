"""Pytest harness for the CLI.

Tests run the real command surface through subprocess (``python -m cli.cli``)
so they exercise exactly what a user types. Browser tests spawn their own
headless Chromium on a free port with isolated state directories; nothing
touches ``~/.ai4a11y``, port 9222, or a developer's running browser. No test
calls an AI model.
"""

import json
import os
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path
from typing import Callable

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
FIXTURE_URL = (Path(__file__).parent / "fixtures" / "defects.html").resolve().as_uri()

CliRunner = Callable[..., "subprocess.CompletedProcess[str]"]


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="session")
def cli_env(tmp_path_factory: pytest.TempPathFactory) -> dict:
    """Environment that points every piece of CLI state at a temp directory."""
    base = tmp_path_factory.mktemp("ai4a11y")
    return {
        **os.environ,
        "AI4A11Y_HOME": str(base / "home"),
        "AI4A11Y_OUT": str(base / "out"),
        "AI4A11Y_USER_DATA_DIR": str(base / "chrome-profile"),
        "AI4A11Y_CDP_PORT": str(_free_port()),
    }


@pytest.fixture(scope="session")
def cli(cli_env: dict) -> CliRunner:
    """Run the CLI as a subprocess and return the completed process."""

    def _run(*args: str, timeout: int = 120) -> "subprocess.CompletedProcess[str]":
        return subprocess.run(
            [sys.executable, "-m", "cli.cli", *args],
            cwd=REPO_ROOT,
            env=cli_env,
            capture_output=True,
            text=True,
            timeout=timeout,
        )

    return _run


@pytest.fixture(autouse=True)
def _restore_active_profile(cli_env: dict):
    """Put the active profile back the way the test found it.

    The active profile lives in one state file shared by every test in the run,
    and it changes what later commands do. `session go` hands the page the
    callbacks that AI-backed adapters call, so a profile such as `cognitive`
    has a navigation send page text out for an answer. A test that sets a
    profile and does not clear it therefore reaches into every test after it,
    and through the `cli` runner, which keeps the whole environment and so has
    a real Claude binary on its PATH, those calls reach a real model.

    Restoring here rather than in the test that sets one means a test added
    later cannot bring the problem back by forgetting to clean up.
    """
    state = Path(cli_env["AI4A11Y_OUT"]) / ".ai4a11y_session_state.json"
    before = state.read_text() if state.exists() else None
    yield
    after = state.read_text() if state.exists() else None
    if after == before:
        return
    if before is None:
        state.unlink(missing_ok=True)
    else:
        state.write_text(before)


@pytest.fixture(scope="session")
def run_without_claude(cli_env: dict) -> CliRunner:
    """Run a CLI command with the Claude Code CLI unreachable.

    Stripping PATH is also what keeps these tests from calling a model: there
    is nothing on the trimmed PATH to call.
    """

    def _run(*args: str, timeout: int = 120) -> "subprocess.CompletedProcess[str]":
        return subprocess.run(
            [sys.executable, "-m", "cli.cli", *args],
            cwd=REPO_ROOT,
            env={**cli_env, "PATH": "/usr/bin:/bin"},
            capture_output=True,
            text=True,
            timeout=timeout,
        )

    return _run


# A stand-in for the Claude Code CLI that answers a fixed number of calls and
# then stops. Real degradation is partial far more often than total: a couple
# of calls time out in a run of twenty. No model is reached either way.
FLAKY_CLAUDE_SHIM = """#!/bin/sh
count=$(cat "$AI4A11Y_SHIM_COUNT" 2>/dev/null || echo 0)
count=$((count + 1))
echo "$count" > "$AI4A11Y_SHIM_COUNT"
if [ "$count" -le "$AI4A11Y_SHIM_SUCCEED" ]; then
  echo "A one pixel placeholder image."
  exit 0
fi
echo "shim: no answer for call $count" >&2
exit 1
"""


@pytest.fixture
def run_with_flaky_claude(cli_env: dict, tmp_path: Path):
    """Build a runner whose ``claude`` answers ``succeed_calls`` times, then fails.

    Takes the number of calls to answer and returns a runner, so one test can
    place the cutoff wherever the behavior it is checking changes.
    """

    def _make(succeed_calls: int) -> CliRunner:
        shim_dir = tmp_path / "shim"
        shim_dir.mkdir(exist_ok=True)
        script = shim_dir / "claude"
        script.write_text(FLAKY_CLAUDE_SHIM)
        script.chmod(0o755)
        counter = tmp_path / "shim-calls"
        counter.write_text("0")
        env = {
            **cli_env,
            "PATH": f"{shim_dir}:/usr/bin:/bin",
            "AI4A11Y_SHIM_COUNT": str(counter),
            "AI4A11Y_SHIM_SUCCEED": str(succeed_calls),
        }

        def _run(*args: str, timeout: int = 120) -> "subprocess.CompletedProcess[str]":
            return subprocess.run(
                [sys.executable, "-m", "cli.cli", *args],
                cwd=REPO_ROOT,
                env=env,
                capture_output=True,
                text=True,
                timeout=timeout,
            )

        return _run

    return _make


@pytest.fixture(scope="session")
def chromium_session(cli_env: dict):
    """A headless Chromium the session commands can connect to over CDP.

    Spawned directly rather than through ``session start`` because that command
    launches a headed, fullscreen browser by design. The session file it would
    have written is created here, so every ``session`` command works unchanged.
    """
    locate = (
        "from playwright.sync_api import sync_playwright\n"
        "with sync_playwright() as p:\n"
        "    print(p.chromium.executable_path)\n"
    )
    exe = subprocess.run(
        [sys.executable, "-c", locate], capture_output=True, text=True, check=True
    ).stdout.strip()

    port = cli_env["AI4A11Y_CDP_PORT"]
    proc = subprocess.Popen(
        [
            exe,
            "--headless=new",
            f"--remote-debugging-port={port}",
            f"--user-data-dir={cli_env['AI4A11Y_USER_DATA_DIR']}",
            "--no-first-run",
            "--no-default-browser-check",
            "about:blank",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        for _ in range(50):
            try:
                urllib.request.urlopen(f"http://localhost:{port}/json/version", timeout=1)
                break
            except Exception:
                time.sleep(0.3)
        else:
            pytest.fail("Chromium started but its CDP endpoint never came up")

        cdp = f"http://localhost:{port}"
        with urllib.request.urlopen(f"{cdp}/json/version", timeout=5) as response:
            browser_id = json.loads(response.read())["webSocketDebuggerUrl"].rsplit("/", 1)[-1]

        home = Path(cli_env["AI4A11Y_HOME"])
        home.mkdir(parents=True, exist_ok=True)
        (home / "session.json").write_text(
            json.dumps({"pid": proc.pid, "cdp": cdp, "browser": browser_id,
                        "started": "pytest"})
        )
        yield cli_env
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
