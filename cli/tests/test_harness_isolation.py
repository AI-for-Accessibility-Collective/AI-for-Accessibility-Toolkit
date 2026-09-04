"""The harness itself is under test: the default runner reaches no model.

Every other test file trusts that running a command cannot send the fixture
page to a model. That trust rests on one line in `conftest.py`, the PATH in
`cli_env`, which every runner is built from, and one line is easy to lose in
a merge, so it is checked here rather than assumed.

The opt-in half needs no test of its own. `run_with_flaky_claude` puts a
stand-in ahead of that PATH, and the degradation tests assert that some calls
are answered and others are not, which no runner without it can satisfy.

No browser is needed: what is checked is the environment handed to the
subprocess, which is settled before anything is launched.
"""

import shutil

from conftest import NO_MODEL_PATH


def test_no_claude_is_reachable_from_the_shared_environment(cli_env: dict) -> None:
    """The commands under test hand the page callbacks that run `claude`.

    `session go` and `session profile` arm AI-backed adapters, which call back
    into the CLI, which runs whatever `claude` PATH resolves. On a machine with
    the Claude Code CLI installed (most machines that run this suite), a
    runner built on the ambient PATH therefore sends the fixture page's text to
    a real model as a side effect of applying a profile. Nothing may resolve.
    """
    assert shutil.which("claude", path=cli_env["PATH"]) is None
    assert cli_env["PATH"] == NO_MODEL_PATH
