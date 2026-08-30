#!/usr/bin/env python3
"""ai4a11y — accessibility toolkit CLI for developers and coding agents.

One Typer app, three areas:

  ai4a11y list tools|profiles      catalog listings, straight from tools/
  ai4a11y create <name>            scaffold a new adapter or auditor
  ai4a11y session <command>        drive a live Chromium page over CDP

Run `ai4a11y --help` or `ai4a11y session --help` for the full surface.
The session engine lives in ai4a11y.py; this module only parses the command
line and delegates. Session commands import the engine lazily so catalog
commands work without Playwright installed.
"""

import json
import re
import sys
from pathlib import Path
from typing import List, Optional

import typer

# Colors
GREEN = "\033[92m"
BLUE = "\033[94m"
PURPLE = "\033[95m"
DIM = "\033[2m"
YELLOW = "\033[93m"
RESET = "\033[0m"
BOLD = "\033[1m"

# Paths
SCRIPT_DIR = Path(__file__).parent.resolve()
TOOLS_DIR = SCRIPT_DIR.parent / "tools"
ADAPTERS_DIR = TOOLS_DIR / "adapters"
AUDITORS_DIR = TOOLS_DIR / "auditors"
PROFILES_PATH = TOOLS_DIR / "profiles" / "settings.json"


def _exit(status) -> None:
    """Turn an engine command's return value into this process's exit status.

    Most engine commands return None, which is success. The AI-backed ones
    return a status so a command that could not reach a model and therefore
    changed nothing says so in a way a script or an agent can read, rather than
    only in prose on stdout.
    """
    if status:
        raise typer.Exit(int(status))


def _engine():
    """Import the session engine on first use (it pulls in Playwright)."""
    try:
        from . import ai4a11y
    except ImportError:
        import ai4a11y  # direct script/module use without the package installed
    return ai4a11y


# ---------------------------------------------------------------------------
# Catalog helpers (no browser, no Playwright)
# ---------------------------------------------------------------------------

def get_tools_info() -> dict:
    """Scan tools/ directory for auditors and adapters."""
    tools: dict = {"auditors": [], "adapters": []}

    for kind, directory in (("auditors", AUDITORS_DIR), ("adapters", ADAPTERS_DIR)):
        if not directory.exists():
            continue
        for f in directory.glob("*.js"):
            if f.name == "index.js":
                continue
            tools[kind].append({
                "name": f.stem,
                "description": extract_description(f),
                "path": str(f.relative_to(SCRIPT_DIR.parent)),
            })
    return tools


def extract_description(filepath: Path) -> str:
    """Extract description from the first comment in a JS file."""
    try:
        content = filepath.read_text()
        match = re.search(r'^//\s*(.+?)$', content, re.MULTILINE)
        if match:
            return match.group(1).strip()
        match = re.search(r"export\s+const\s+description\s*=\s*['\"](.+?)['\"]", content)
        if match:
            return match.group(1).strip()
        return ""
    except OSError:
        return ""


def get_profiles() -> dict:
    """Load profiles from settings.json."""
    if not PROFILES_PATH.exists():
        return {}
    try:
        return json.loads(PROFILES_PATH.read_text()).get("profiles", {})
    except (OSError, json.JSONDecodeError):
        return {}


# ---------------------------------------------------------------------------
# The app
# ---------------------------------------------------------------------------

app = typer.Typer(
    help="Accessibility toolkit CLI: catalog listings, scaffolding, and a live browser session.",
    add_completion=True,
)
list_app = typer.Typer(help="List what the catalog ships.")
session_app = typer.Typer(help="Drive a persistent Chromium page over the DevTools Protocol.")
app.add_typer(list_app, name="list")
app.add_typer(session_app, name="session")


@app.callback(invoke_without_command=True)
def _root(ctx: typer.Context) -> None:
    if ctx.invoked_subcommand is None:
        typer.echo(ctx.get_help())
        raise typer.Exit(0)


# --- list ------------------------------------------------------------------

@list_app.command("tools")
def list_tools(as_json: bool = typer.Option(False, "--json", help="JSON output")) -> None:
    """List all auditors and adapters, with descriptions."""
    tools = get_tools_info()

    if as_json:
        typer.echo(json.dumps(tools, indent=2))
        return

    typer.echo(f"\n{BOLD}Auditors{RESET} (find issues):")
    for t in sorted(tools["auditors"], key=lambda x: x["name"]):
        desc = f" — {t['description']}" if t["description"] else ""
        typer.echo(f"  {GREEN}●{RESET} {t['name']}{DIM}{desc}{RESET}")

    typer.echo(f"\n{BOLD}Adapters{RESET} (fix issues / preferences):")
    for t in sorted(tools["adapters"], key=lambda x: x["name"]):
        desc = f" — {t['description']}" if t["description"] else ""
        typer.echo(f"  {BLUE}●{RESET} {t['name']}{DIM}{desc}{RESET}")

    typer.echo(f"\n{DIM}Total: {len(tools['auditors'])} auditors, {len(tools['adapters'])} adapters{RESET}\n")


@list_app.command("profiles")
def list_profiles(as_json: bool = typer.Option(False, "--json", help="JSON output")) -> None:
    """List all accessibility profiles."""
    profiles = get_profiles()

    if as_json:
        typer.echo(json.dumps(profiles, indent=2))
        return

    typer.echo(f"\n{BOLD}Accessibility Profiles{RESET}:\n")
    for key, profile in sorted(profiles.items()):
        name = profile.get("name", key)
        desc = profile.get("description", "")
        enabled = [k for k, v in profile.get("tools", {}).items() if v and v is not False]

        typer.echo(f"  {PURPLE}●{RESET} {BOLD}{key}{RESET} — {name}")
        if desc:
            typer.echo(f"    {DIM}{desc}{RESET}")
        if enabled:
            typer.echo(f"    {DIM}Tools: {', '.join(enabled[:5])}{'...' if len(enabled) > 5 else ''}{RESET}")
        typer.echo()


# --- create ----------------------------------------------------------------

@app.command()
def create(
    name: str,
    type: str = typer.Option("adapter", "--type", help="adapter or auditor"),
    profiles: Optional[str] = typer.Option(None, "--profiles", help="Comma-separated profile ids the adapter helps"),
) -> None:
    """Scaffold a new adapter or auditor under tools/."""
    if type == "adapter":
        raise typer.Exit(create_adapter(name, profiles))
    if type == "auditor":
        raise typer.Exit(create_auditor(name))
    typer.echo(f"Unknown type: {type}. Use 'adapter' or 'auditor'.")
    raise typer.Exit(1)


def create_adapter(name: str, profiles: Optional[str] = None) -> int:
    """Scaffold a new adapter."""
    filename = name.replace("_", "-").lower()
    filepath = ADAPTERS_DIR / f"{filename}.js"

    if filepath.exists():
        typer.echo(f"{YELLOW}Error:{RESET} Adapter '{filename}' already exists at {filepath}")
        return 1

    profiles_list = profiles.split(",") if profiles else []
    profiles_str = json.dumps(profiles_list) if profiles_list else "[]"

    template = f'''// {name} adapter
import {{ describeImage, simplifyText }} from '../utils/ai.js';
import {{ markProcessed, isVisible }} from '../utils/dom.js';

// Metadata for auto-discovery
export const name = '{filename}';
export const description = 'TODO: Add description';
export const profiles = {profiles_str};

// Stats tracking (extension injects these)
const logFix = globalThis.ai4a11yLogFix || (() => {{}});
const incrementStat = globalThis.ai4a11yIncrementStat || (() => {{}});

/**
 * Main adapter function — runs on page load or manual trigger.
 * @param {{Element[]}} elements - Elements to process (optional)
 * @param {{object}} settings - User settings (optional)
 */
export async function run(elements, settings = {{}}) {{
  // TODO: Implement adapter logic
  // Example: find elements, process them, log fixes

  const targets = elements || document.querySelectorAll('.your-selector');

  for (const el of targets) {{
    if (el.dataset.ai4a11yProcessed) continue;
    if (!isVisible(el)) continue;

    markProcessed(el, 'pending');

    try {{
      // TODO: Your processing logic here
      // Example: const result = await describeImage(el);

      markProcessed(el, 'done');
      incrementStat('custom');
      logFix('{filename}', el, '(before)', '(after)');
    }} catch (e) {{
      console.warn('[AI4A11y] {filename} failed:', e);
      markProcessed(el, 'failed');
    }}
  }}
}}

/**
 * Optional: Handle specific axe-core rule violations.
 * Keys are axe rule IDs, values are handler functions.
 */
export const axeHandlers = {{
  // 'rule-id': async (node) => {{ ... }}
}};
'''

    filepath.write_text(template)
    typer.echo(f"{GREEN}✓{RESET} Created adapter: {filepath.relative_to(SCRIPT_DIR.parent)}")
    typer.echo(f"\n{DIM}Next steps:")
    typer.echo(f"  1. Edit {filepath.name} to implement your logic")
    typer.echo("  2. Add export to tools/adapters/index.js")
    typer.echo(f"  3. Run: npm run build:cli{RESET}\n")
    return 0


def create_auditor(name: str) -> int:
    """Scaffold a new auditor."""
    filename = name.replace("_", "-").lower()
    filepath = AUDITORS_DIR / f"{filename}.js"

    if filepath.exists():
        typer.echo(f"{YELLOW}Error:{RESET} Auditor '{filename}' already exists at {filepath}")
        return 1

    template = f'''// {name} auditor — find accessibility issues
import {{ isVisible, wasProcessed }} from '../utils/dom.js';

/**
 * Find elements with {name} issues.
 * @returns {{Element[]}} Elements that have issues
 */
export function find{name.replace("-", " ").title().replace(" ", "")}Issues() {{
  return Array.from(document.querySelectorAll('your-selector'))
    .filter(el => {{
      if (wasProcessed(el)) return false;
      if (!isVisible(el)) return false;

      // TODO: Add your detection logic
      // Return true if this element has an issue

      return false;
    }});
}}
'''

    filepath.write_text(template)
    typer.echo(f"{GREEN}✓{RESET} Created auditor: {filepath.relative_to(SCRIPT_DIR.parent)}")
    typer.echo(f"\n{DIM}Next steps:")
    typer.echo(f"  1. Edit {filepath.name} to implement detection logic")
    typer.echo("  2. Add export to tools/auditors/index.js")
    typer.echo(f"  3. Run: npm run build:cli{RESET}\n")
    return 0


# --- session: lifecycle ----------------------------------------------------

@session_app.callback(invoke_without_command=True)
def _session_root(ctx: typer.Context) -> None:
    if ctx.invoked_subcommand is None:
        _engine().session_status()


@session_app.command()
def start() -> None:
    """Launch a persistent fullscreen Chromium with a CDP port."""
    _engine().session_start()


@session_app.command()
def stop() -> None:
    """Close the persistent browser."""
    _engine().session_stop()


@session_app.command()
def status() -> None:
    """URL and title of the focused tab."""
    _engine().session_status()


@session_app.command()
def tabs() -> None:
    """List every open tab, marking the focused one."""
    _engine().session_tabs()


@session_app.command()
def focus(number: int = typer.Argument(..., help="Tab number from 'session tabs'")) -> None:
    """Focus a tab by number."""
    _engine().session_focus_tab(number)


@session_app.command("cleanup-tabs")
def cleanup_tabs() -> None:
    """Close zombie tabs."""
    _engine().session_cleanup_tabs()


# --- session: navigation and keyboard --------------------------------------

@session_app.command()
def go(url: str) -> None:
    """Navigate the focused tab."""
    _engine().session_go(url)


@session_app.command()
def back() -> None:
    """Browser back."""
    _engine().session_back()


@session_app.command()
def scroll(direction: str = typer.Argument("down"), amount: int = typer.Argument(800)) -> None:
    """Scroll the page."""
    _engine().session_scroll(direction, amount)


@session_app.command()
def tab(direction: str = typer.Argument("forward", help="'back' for Shift+Tab")) -> None:
    """Press Tab (or Shift+Tab) in the page."""
    _engine().session_tab("back" if direction in ("back", "prev", "previous") else "forward")


@session_app.command()
def activate() -> None:
    """Press Enter on the focused element."""
    _engine().session_activate()


@session_app.command()
def key(name: str, count: int = typer.Argument(1)) -> None:
    """Press a key: ArrowRight, Space, Enter, Escape, Home, End, PageUp, ..."""
    _engine().session_key(name, count)


@session_app.command()
def arrow(direction: str, count: int = typer.Argument(1)) -> None:
    """Press an arrow key."""
    _engine().session_arrow(direction, count)


@session_app.command()
def heading(direction: str = typer.Argument("next"), level: Optional[int] = typer.Argument(None)) -> None:
    """Jump to the next or previous heading, optionally by level."""
    _engine().session_heading(direction, level)


@session_app.command()
def skip() -> None:
    """Follow the page's skip-to-content link."""
    _engine().session_skip()


@session_app.command()
def focused() -> None:
    """Report document.activeElement."""
    _engine().session_focused()


# --- session: reading the page ---------------------------------------------

@session_app.command("list")
def list_elements(kind: str = typer.Argument("focusables", help="headings|links|buttons|forms|landmarks|focusables|images|tables")) -> None:
    """List elements of one kind on the page."""
    _engine().session_list(kind)


@session_app.command()
def find(text: List[str] = typer.Argument(..., help="Text to search for")) -> None:
    """Search body text and element attributes."""
    _engine().session_find(" ".join(text))


@session_app.command()
def read(selector: Optional[str] = typer.Argument(None)) -> None:
    """Readability-style article extraction."""
    _engine().session_read(selector)


@session_app.command()
def tables() -> None:
    """List the tables on the page."""
    _engine().session_list_tables()


@session_app.command()
def diff() -> None:
    """What changed since the last baseline."""
    _engine().session_diff()


@session_app.command()
def dismiss() -> None:
    """Dismiss overlays and popups."""
    _engine().session_dismiss()


@session_app.command()
def summary() -> None:
    """Summarize the current page."""
    _engine().session_summary()


@session_app.command()
def audit(
    severity: Optional[str] = typer.Argument(None),
    as_json: bool = typer.Option(False, "--json", help="JSON output"),
) -> None:
    """Run an axe-core WCAG audit of the live page."""
    _engine().session_audit(severity, json_output=as_json)


# --- session: acting on the page (AI-backed where noted) --------------------

@session_app.command()
def describe(as_json: bool = typer.Option(False, "--json", help="JSON output")) -> None:
    """BLV-friendly page summary (needs the Claude Code CLI)."""
    _engine().session_describe(json_output=as_json)


@session_app.command()
def ask(question: List[str] = typer.Argument(...)) -> None:
    """Ask a question about the current tab (needs the Claude Code CLI)."""
    _engine().session_ask(" ".join(question))


@session_app.command()
def tap(target: List[str] = typer.Argument(...)) -> None:
    """Click a named target, with vision fallback (needs the Claude Code CLI)."""
    _engine().session_tap(" ".join(target))


@session_app.command("type")
def type_text(field: str, text: List[str] = typer.Argument(...)) -> None:
    """Click a named field and type into it (needs the Claude Code CLI)."""
    _engine().session_type(field, " ".join(text))


@session_app.command()
def hover(target: List[str] = typer.Argument(...)) -> None:
    """Hover a named target and read its tooltip (needs the Claude Code CLI)."""
    _engine().session_hover(" ".join(target))


@session_app.command()
def drag(source: str, to: List[str] = typer.Argument(...)) -> None:
    """Drag between two named targets (needs the Claude Code CLI)."""
    _engine().session_drag(source, " ".join(to))


@session_app.command()
def nudge(
    target: str,
    direction: str = typer.Argument("right"),
    count: int = typer.Argument(5),
) -> None:
    """Nudge a slider (needs the Claude Code CLI)."""
    _engine().session_nudge(target, direction, count)


@session_app.command()
def pickdate(field: str, date: List[str] = typer.Argument(...)) -> None:
    """Pick a date in a named date field (needs the Claude Code CLI)."""
    _engine().session_pickdate(field, " ".join(date))


@session_app.command()
def do(
    task: List[str] = typer.Argument(..., help="Task, optionally followed by [min_interactions] [max_steps]"),
) -> None:
    """Autonomous multi-step mode (needs the Claude Code CLI)."""
    words = [*task]
    trailing: List[int] = []
    while words and words[-1].isdigit():
        trailing.insert(0, int(words.pop()))
    max_steps = trailing[-1] if trailing else 8
    min_interactions = trailing[0] if len(trailing) >= 2 else 0
    _engine().session_do(" ".join(words), min_interactions=min_interactions, max_steps=max_steps)


# --- session: media and output ---------------------------------------------

@session_app.command()
def media(action: str, value: Optional[str] = typer.Argument(None)) -> None:
    """Control page media: play|pause|toggle|seek|rate|volume|mute|status."""
    _engine().session_media(action, value)


@session_app.command()
def screenshot(filename: Optional[str] = typer.Argument(None)) -> None:
    """Screenshot the focused tab."""
    _engine().session_screenshot(filename)


@session_app.command()
def report(output: Optional[str] = typer.Argument(None)) -> None:
    """Write a session report."""
    _engine().session_report(output)


# --- session: adapters and profiles -----------------------------------------

@session_app.command()
def enable(
    tool: str,
    options: Optional[List[str]] = typer.Argument(None, help="key=value pairs or JSON, e.g. fontScale=150"),
) -> None:
    """Enable an accessibility adapter on the live page."""
    _engine().session_enable(tool, options or None)


@session_app.command()
def disable(tool: str) -> None:
    """Disable an accessibility adapter."""
    _engine().session_disable(tool)


@session_app.command("tools")
def session_tools(as_json: bool = typer.Option(False, "--json", help="JSON output")) -> None:
    """List available tools and their status."""
    _engine().session_tools(json_output=as_json)


@session_app.command()
def profile(name: str, as_json: bool = typer.Option(False, "--json", help="JSON output")) -> None:
    """Apply an accessibility profile."""
    _engine().session_profile(name, json_output=as_json)


@session_app.command()
def profiles(as_json: bool = typer.Option(False, "--json", help="JSON output")) -> None:
    """List available profiles."""
    _engine().session_profiles(json_output=as_json)


# --- session: auditors and fixes --------------------------------------------

@session_app.command("find-alt")
def find_alt(as_json: bool = typer.Option(False, "--json")) -> None:
    """Find images without alt text."""
    _engine().session_find_missing_alt(json_output=as_json)


@session_app.command("find-labels")
def find_labels(as_json: bool = typer.Option(False, "--json")) -> None:
    """Find unlabeled links, buttons, and inputs."""
    _engine().session_find_missing_labels(json_output=as_json)


@session_app.command("find-contrast")
def find_contrast(as_json: bool = typer.Option(False, "--json")) -> None:
    """Find low-contrast text."""
    _engine().session_find_poor_contrast(json_output=as_json)


@session_app.command("find-captions")
def find_captions(as_json: bool = typer.Option(False, "--json")) -> None:
    """Find media without captions or transcripts."""
    _engine().session_find_missing_captions(json_output=as_json)


@session_app.command("find-all")
def find_all(as_json: bool = typer.Option(False, "--json")) -> None:
    """Run every auditor."""
    _engine().session_find_all(json_output=as_json)


@session_app.command("fix-alt")
def fix_alt(max_images: int = typer.Argument(10), as_json: bool = typer.Option(False, "--json")) -> None:
    """Generate alt text for images (needs the Claude Code CLI)."""
    _exit(_engine().session_fix_alt(max_images=max_images, json_output=as_json))


@session_app.command("fix-labels")
def fix_labels(max_elements: int = typer.Argument(10), as_json: bool = typer.Option(False, "--json")) -> None:
    """Generate labels for unlabeled controls (needs the Claude Code CLI)."""
    _exit(_engine().session_fix_labels(max_elements=max_elements, json_output=as_json))


@session_app.command()
def simplify(selector: Optional[str] = typer.Argument(None), as_json: bool = typer.Option(False, "--json")) -> None:
    """Simplify page text in place (needs the Claude Code CLI)."""
    _exit(_engine().session_simplify(selector=selector, json_output=as_json))


@session_app.command("fix-all")
def fix_all(as_json: bool = typer.Option(False, "--json")) -> None:
    """Run every automatic fix."""
    _exit(_engine().session_fix_all(json_output=as_json))


@session_app.command()
def scan(
    max_ai_fixes: int = typer.Argument(10),
    no_ai: bool = typer.Option(False, "--no-ai", help="Skip AI-backed fixes"),
    as_json: bool = typer.Option(False, "--json"),
) -> None:
    """Full scan and fix, like the extension (AI fixes need the Claude Code CLI)."""
    _exit(_engine().session_scan(fix_ai=not no_ai, max_ai_fixes=max_ai_fixes, json_output=as_json))


# --- aliases (hidden) -------------------------------------------------------

def _alias(group: typer.Typer, names: tuple, fn) -> None:
    for n in names:
        group.command(n, hidden=True)(fn)


_alias(session_app, ("enter", "press"), activate)
_alias(session_app, ("find-missing-alt", "missing-alt"), find_alt)
_alias(session_app, ("find-missing-labels", "missing-labels"), find_labels)
_alias(session_app, ("find-poor-contrast", "poor-contrast"), find_contrast)
_alias(session_app, ("find-missing-captions", "missing-captions"), find_captions)
_alias(session_app, ("find-issues", "issues"), find_all)
_alias(session_app, ("fix",), fix_all)
_alias(session_app, ("fix-images",), fix_alt)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def _session_command_names() -> set:
    names = set()
    for cmd in session_app.registered_commands:
        names.add(cmd.name or cmd.callback.__name__.replace("_", "-"))
    return names


def main() -> None:
    # Backwards-compatible shortcuts: `ai4a11y audit` == `ai4a11y session audit`.
    argv = sys.argv
    if len(argv) > 1 and not argv[1].startswith("-"):
        if argv[1] not in ("list", "create", "session") and argv[1] in _session_command_names():
            argv.insert(1, "session")
    app()


if __name__ == "__main__":
    main()
