"""Anything the CLI tells a user to run has to be a thing they can run.

No browser, no AI: these read the source and package.json.
"""

import json
import re

from conftest import REPO_ROOT

NPM_SCRIPT = re.compile(r"npm run ([\w:-]+)")


def _declared_scripts() -> set:
    return set(json.loads((REPO_ROOT / "package.json").read_text())["scripts"])


def test_every_npm_script_the_cli_names_exists() -> None:
    declared = _declared_scripts()
    named = {
        (path.relative_to(REPO_ROOT), script)
        for path in (REPO_ROOT / "cli").rglob("*.py")
        for script in NPM_SCRIPT.findall(path.read_text())
    }
    assert named, "expected the CLI to name at least one npm script"

    missing = {entry for entry in named if entry[1] not in declared}
    assert not missing, f"not in package.json: {sorted(missing)}"


def test_every_npm_script_the_readmes_name_exists() -> None:
    declared = _declared_scripts()
    named = {
        (path.name, script)
        for path in (REPO_ROOT / "README.md", REPO_ROOT / "cli" / "README.md",
                     REPO_ROOT / "CONTRIBUTING.md")
        for script in NPM_SCRIPT.findall(path.read_text())
    }
    missing = {entry for entry in named if entry[1] not in declared}
    assert not missing, f"not in package.json: {sorted(missing)}"


# --- AI disclosure -----------------------------------------------------------
#
# Which session commands reach a Claude call is computed from the call graph,
# not read off the README, because the README is the thing under test. Users
# decide whether to run a command on the strength of these two lists: page
# screenshots and page text leave the browser on one side and not the other,
# and an ANTHROPIC_API_KEY makes each call cost money.

import ast

ENGINE_DIR = REPO_ROOT / "cli" / "ai4a11y"


def _ai_backed_engine_functions() -> set:
    """Every session_* engine function that can reach a Claude subprocess.

    The engine is a package of six modules now, so the call graph is built
    from all of them at once rather than one module at a time. That matters:
    resolving each module against itself alone finds 11 commands, because a
    command in commands.py calls a fix pass that lives in ai.py and the edge
    is dropped. Over the union it finds 18, which is what the single-module
    engine reported before the split.

    A call counts in either shape: a bare name, from `from .ai import
    ask_claude`, or an attribute, from `from . import ai` followed by
    `ai.ask_claude(...)`.

    What this cannot see is a callback the browser calls. See the note under
    the AI-backed block in cli/README.md.
    """
    calls, defined_in = {}, {}
    collisions = []
    for path in sorted(ENGINE_DIR.glob("*.py")):
        for node in ast.parse(path.read_text()).body:
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            # The call graph is keyed by bare name across all six modules, so
            # two modules defining the same top-level name would drop one
            # function's edges and quietly shrink the disclosure.
            if node.name in defined_in:
                collisions.append(
                    f"{node.name} in both {defined_in[node.name]} and {path.name}"
                )
            defined_in[node.name] = path.name
            named = {
                c.func.id for c in ast.walk(node)
                if isinstance(c, ast.Call) and isinstance(c.func, ast.Name)
            }
            attrs = {
                c.func.attr for c in ast.walk(node)
                if isinstance(c, ast.Call) and isinstance(c.func, ast.Attribute)
            }
            calls[node.name] = named | attrs
    assert calls, f"found no engine functions under {ENGINE_DIR}"
    assert not collisions, (
        "two engine modules define the same top-level function name, so this "
        "walk would drop one of them: " + "; ".join(sorted(collisions))
    )

    reaching = {"ask_claude", "ask_claude_text"}
    growing = True
    while growing:
        growing = False
        for name, called in calls.items():
            if name not in reaching and called & reaching:
                reaching.add(name)
                growing = True
    return {n for n in reaching if n.startswith("session_")}


def _command_to_engine_function() -> dict:
    """Map each `ai4a11y session <name>` to the engine function it calls."""
    tree = ast.parse((REPO_ROOT / "cli" / "cli.py").read_text())
    mapping = {}
    for node in ast.walk(tree):
        if not isinstance(node, ast.FunctionDef):
            continue
        names = [
            d.args[0].value if d.args else node.name.replace("_", "-")
            for d in node.decorator_list
            if isinstance(d, ast.Call)
            and isinstance(d.func, ast.Attribute)
            and d.func.attr == "command"
            and isinstance(d.func.value, ast.Name)
            and d.func.value.id == "session_app"
        ]
        if not names:
            continue
        called = {
            c.func.attr for c in ast.walk(node)
            if isinstance(c, ast.Call) and isinstance(c.func, ast.Attribute)
            and c.func.attr.startswith("session_")
        }
        for name in names:
            mapping[name] = called
    return mapping


def _readme_block(heading_fragment: str) -> set:
    """Command names listed in the fenced block under a heading."""
    text = (REPO_ROOT / "cli" / "README.md").read_text()
    start = text.index(heading_fragment)
    block = text[text.index("```bash", start) + len("```bash"):]
    block = block[: block.index("```")]

    listed = set()
    for line in block.splitlines():
        line = line.split("#")[0]
        if "ai4a11y session" not in line:
            continue
        rest = line.split("ai4a11y session", 1)[1]
        for part in rest.split("|"):
            words = part.strip().split()
            if words and re.fullmatch(r"[a-z][a-z-]*", words[0]):
                listed.add(words[0])
    return listed


def test_every_ai_backed_command_is_disclosed_as_one() -> None:
    ai_backed = _ai_backed_engine_functions()
    commands = _command_to_engine_function()
    should_be_listed = {
        name for name, called in commands.items() if called & ai_backed
    }
    assert should_be_listed, "expected to find AI-backed session commands"

    listed = _readme_block("Session, AI-backed")
    assert not should_be_listed - listed, (
        f"reach a model but are not disclosed: {sorted(should_be_listed - listed)}"
    )


def test_no_ai_backed_command_is_listed_as_local() -> None:
    ai_backed = _ai_backed_engine_functions()
    commands = _command_to_engine_function()
    should_be_listed = {
        name for name, called in commands.items() if called & ai_backed
    }

    listed_as_local = _readme_block("instant and local")
    assert not should_be_listed & listed_as_local, (
        "listed as local but reach a model: "
        f"{sorted(should_be_listed & listed_as_local)}"
    )
