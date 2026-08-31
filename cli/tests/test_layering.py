"""The engine's modules depend in one direction only.

The package was split so that a reader can hold one layer in mind at a time.
That only stays true if the imports stay one way, and an accidental import
upward reads as a small convenience at the time it is added.
"""

import ast
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
ENGINE_DIR = REPO_ROOT / "cli" / "ai4a11y"

# Lower numbers may not import higher ones.
LAYERS = {
    "config": 0,
    "ai": 1,
    "page": 2,
    "browser": 3,
    "agent": 4,
    "commands": 5,
}


def _local_imports(path: Path) -> set:
    """Sibling module names this file imports.

    Catches both shapes: `from .page import get_elements` puts the module in
    `node.module`, and `from . import page` puts it in the alias names.
    """
    names = set()
    for node in ast.walk(ast.parse(path.read_text())):
        if not isinstance(node, ast.ImportFrom) or node.level != 1:
            continue
        if node.module:
            names.add(node.module.split(".")[0])
        else:
            names.update(alias.name for alias in node.names)
    return names & set(LAYERS)


def test_engine_imports_only_point_downward() -> None:
    violations = []
    for name, rank in LAYERS.items():
        path = ENGINE_DIR / f"{name}.py"
        assert path.exists(), f"{name}.py is missing from the engine package"
        for imported in _local_imports(path):
            if LAYERS[imported] >= rank:
                violations.append(f"{name}.py imports {imported}.py")
    assert not violations, (
        "upward imports break the layering: " + "; ".join(sorted(violations))
    )


def test_every_engine_module_is_in_the_layering() -> None:
    on_disk = {p.stem for p in ENGINE_DIR.glob("*.py")} - {"__init__"}
    assert on_disk == set(LAYERS), (
        "a module was added or renamed without placing it in the layering: "
        f"{sorted(on_disk ^ set(LAYERS))}"
    )
