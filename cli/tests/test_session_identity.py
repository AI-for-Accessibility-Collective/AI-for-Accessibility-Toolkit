"""A session file names a pid and a port. Neither one identifies a browser.

Pids are reused once the number space wraps, and 9222 is the port every tool
that speaks the DevTools Protocol reaches for first, so a session file left
behind by a browser that has since exited can name a process someone else is
running and a port someone else is listening on. Chrome hands out a per-launch
id at its CDP endpoint; these tests hold the commands to checking it.
"""

import json
import os
import subprocess
import sys
import time
from pathlib import Path

import pytest

from conftest import REPO_ROOT, CliRunner

pytestmark = pytest.mark.browser


@pytest.fixture
def foreign_session(chromium_session: dict, tmp_path: Path):
    """A session file pointing at a live process that is not our browser.

    The pid belongs to a sleep the test owns, so if a command kills what the
    session file names, the test can see it happen without harming anything.
    """
    victim = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(120)"])
    home = tmp_path / "home"
    home.mkdir()
    (home / "session.json").write_text(
        json.dumps(
            {
                "pid": victim.pid,
                "cdp": f"http://localhost:{chromium_session['AI4A11Y_CDP_PORT']}",
                "browser": "a-browser-that-has-since-exited",
                "started": "pytest",
            }
        )
    )
    env = {**chromium_session, "AI4A11Y_HOME": str(home)}

    def _run(*args: str) -> "subprocess.CompletedProcess[str]":
        return subprocess.run(
            [sys.executable, "-m", "cli.cli", *args],
            cwd=REPO_ROOT,
            env=env,
            capture_output=True,
            text=True,
            timeout=60,
        )

    try:
        yield _run, victim
    finally:
        victim.kill()
        victim.wait(timeout=10)


def _still_running(proc: subprocess.Popen) -> bool:
    time.sleep(0.5)
    return proc.poll() is None


def test_stop_does_not_kill_a_process_it_cannot_identify(foreign_session) -> None:
    run, victim = foreign_session
    result = run("session", "stop")
    assert _still_running(victim), "session stop killed an unrelated process"
    assert result.returncode != 0
    assert "not the browser" in (result.stdout + result.stderr).lower()


def test_commands_refuse_a_browser_the_session_did_not_start(foreign_session) -> None:
    run, _ = foreign_session
    result = run("session", "status")
    assert result.returncode != 0
    assert "not the browser" in (result.stdout + result.stderr).lower()


def test_start_records_the_browser_it_launched(chromium_session: dict) -> None:
    """The fixture stands in for `session start`; the file it writes is the
    contract every other command reads, so it must carry the browser id."""
    home = Path(chromium_session["AI4A11Y_HOME"])
    info = json.loads((home / "session.json").read_text())
    assert info.get("browser"), "session file carries no browser identity"


def test_stop_still_kills_the_browser_it_did_start(tmp_path: Path) -> None:
    """The counterpart to the refusals above: verification must not make stop
    a no-op for the browser the session actually owns."""
    import socket
    import urllib.request
    from playwright.sync_api import sync_playwright

    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]

    with sync_playwright() as p:
        exe = p.chromium.executable_path
    browser = subprocess.Popen(
        [exe, "--headless=new", f"--remote-debugging-port={port}",
         f"--user-data-dir={tmp_path / 'profile'}", "--no-first-run", "about:blank"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    try:
        cdp = f"http://localhost:{port}"
        for _ in range(50):
            try:
                with urllib.request.urlopen(f"{cdp}/json/version", timeout=1) as response:
                    ws = json.loads(response.read())["webSocketDebuggerUrl"]
                break
            except Exception:
                time.sleep(0.3)
        else:
            pytest.fail("Chromium started but its CDP endpoint never came up")

        home = tmp_path / "home"
        home.mkdir()
        (home / "session.json").write_text(
            json.dumps({"pid": browser.pid, "cdp": cdp,
                        "browser": ws.rsplit("/", 1)[-1], "started": "pytest"})
        )
        result = subprocess.run(
            [sys.executable, "-m", "cli.cli", "session", "stop"],
            cwd=REPO_ROOT,
            env={**os.environ, "AI4A11Y_HOME": str(home)},
            capture_output=True, text=True, timeout=60,
        )
        assert result.returncode == 0, result.stdout + result.stderr
        browser.wait(timeout=15)
        assert not (home / "session.json").exists()
    finally:
        if browser.poll() is None:
            browser.kill()
            browser.wait(timeout=10)


def test_a_session_file_without_a_browser_id_is_not_guessed_about(
    chromium_session: dict, tmp_path: Path
) -> None:
    """Session files written before this change name no browser. Neither
    trusting nor killing is right, so the commands say what is going on."""
    home = tmp_path / "home"
    home.mkdir()
    (home / "session.json").write_text(
        json.dumps({"pid": os.getpid(),
                    "cdp": f"http://localhost:{chromium_session['AI4A11Y_CDP_PORT']}",
                    "started": "pytest"})
    )
    result = subprocess.run(
        [sys.executable, "-m", "cli.cli", "session", "stop"],
        cwd=REPO_ROOT,
        env={**chromium_session, "AI4A11Y_HOME": str(home)},
        capture_output=True, text=True, timeout=60,
    )
    assert result.returncode != 0
    assert "predates browser identity" in result.stdout + result.stderr
    # The pid in that file is this test process. It had better still be here.
    assert (home / "session.json").exists()
