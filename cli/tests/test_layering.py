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


PACKAGE = "ai4a11y"


def _siblings_in(dotted: str, alias_names: list) -> set:
    """Sibling module names named by one import's module path and aliases.

    `dotted` is the module path with any leading dots already stripped, so
    `page` for `from .page import ...` and `cli.ai4a11y.page` for the absolute
    spelling of the same import. Whatever follows the package name is the
    sibling; when nothing follows it, the siblings are the imported aliases,
    as in `from . import page` and `from cli.ai4a11y import page`.
    """
    parts = [p for p in dotted.split(".") if p]
    if PACKAGE in parts:
        parts = parts[parts.index(PACKAGE) + 1:]
    if parts:
        return {parts[0]} & set(LAYERS)
    return set(alias_names) & set(LAYERS)


def _local_imports(path: Path) -> set:
    """Sibling module names this file imports.

    Catches every spelling, because the layering is only as strong as the
    shapes it recognizes and an absolute import is the easy way around a
    check that only looks at relative ones:

        from .page import get_elements
        from . import page
        from cli.ai4a11y.page import get_elements
        from cli.ai4a11y import page
        import cli.ai4a11y.page
    """
    names = set()
    for node in ast.walk(ast.parse(path.read_text())):
        if isinstance(node, ast.ImportFrom):
            names |= _siblings_in(
                node.module or "", [a.name for a in node.names]
            )
        elif isinstance(node, ast.Import):
            for alias in node.names:
                names |= _siblings_in(alias.name, [])
    return names


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
