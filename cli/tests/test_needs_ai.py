"""AI-backed commands degrade to a structured needs-ai answer, never a traceback.

These call the two Claude subprocess sites in-process with PATH stripped, so
they prove the degradation contract without any AI or network.
"""

import json
import sys

import pytest

from conftest import REPO_ROOT


@pytest.fixture(scope="module")
def engine(tmp_path_factory: pytest.TempPathFactory):
    import os

    os.environ.setdefault("AI4A11Y_OUT", str(tmp_path_factory.mktemp("out")))
    sys.path.insert(0, str(REPO_ROOT))
    from cli import ai4a11y

    return ai4a11y


def test_text_call_reports_needs_ai(engine, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PATH", "/usr/bin:/bin")
    data = json.loads(engine.ask_claude_text("hello"))
    assert "needs-ai" in data["error"]
    assert data["answer"] == ""


def test_vision_call_reports_needs_ai(engine, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PATH", "/usr/bin:/bin")
    data = json.loads(engine.ask_claude("/nonexistent.png", "hello"))
    assert data["reason"] == "needs-ai"
