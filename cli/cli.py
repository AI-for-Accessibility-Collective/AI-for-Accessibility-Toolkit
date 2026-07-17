#!/usr/bin/env python3
"""
AI4A11y CLI — accessibility toolkit for developers and coding agents.

Usage:
  ai4a11y list tools              List all auditors and adapters
  ai4a11y list profiles           List all accessibility profiles
  ai4a11y create <name> --type adapter [--profiles blv,cognitive]
                                  Scaffold a new adapter

  ai4a11y session start           Launch persistent browser
  ai4a11y session go <url>        Navigate to URL
  ai4a11y session audit [--json]  Run accessibility audit
  ai4a11y session describe [--json]  Describe current page
  ai4a11y session stop            Close browser

  ai4a11y session enable <tool>   Enable an accessibility adapter
  ai4a11y session disable <tool>  Disable an accessibility adapter
  ai4a11y session tools           List available tools and status
  ai4a11y session profile <name>  Apply an accessibility profile
  ai4a11y session profiles        List available profiles

For full session commands, see: ai4a11y session --help
"""

import subprocess
import sys
import os
import json
import re
from pathlib import Path

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

# Command categories for coloring
SEE = {"describe", "summary", "ask", "audit", "report"}
DO = {"tap", "type", "hover", "drag", "nudge", "pickdate", "dismiss", "media", "activate", "enter", "press", "do"}
MOVE = {"go", "back", "scroll", "tab", "arrow", "key", "heading", "skip", "list", "find", "read", "tables", "focused", "diff"}
SESSION = {"start", "stop", "status", "screenshot", "tabs", "focus", "cleanup-tabs"}
VISUAL = {"enable", "disable", "tools", "profile", "profiles"}
AUDIT = {"find-alt", "find-missing-alt", "missing-alt", "find-labels", "find-missing-labels", "missing-labels",
         "find-contrast", "find-poor-contrast", "poor-contrast", "find-captions", "find-missing-captions",
         "missing-captions", "find-all", "find-issues", "issues"}
FIX = {"fix-alt", "fix-images", "fix-labels", "simplify", "fix-all", "fix", "scan"}


def get_tools_info():
    """Scan tools/ directory for auditors and adapters."""
    tools = {"auditors": [], "adapters": []}

    # Scan auditors
    if AUDITORS_DIR.exists():
        for f in AUDITORS_DIR.glob("*.js"):
            if f.name == "index.js":
                continue
            name = f.stem
            # Try to extract description from file
            desc = extract_description(f)
            tools["auditors"].append({"name": name, "description": desc, "path": str(f.relative_to(SCRIPT_DIR.parent))})

    # Scan adapters
    if ADAPTERS_DIR.exists():
        for f in ADAPTERS_DIR.glob("*.js"):
            if f.name == "index.js":
                continue
            name = f.stem
            desc = extract_description(f)
            tools["adapters"].append({"name": name, "description": desc, "path": str(f.relative_to(SCRIPT_DIR.parent))})

    return tools


def extract_description(filepath):
    """Extract description from first comment in JS file."""
    try:
        content = filepath.read_text()
        # Look for // comment at start or first export description
        match = re.search(r'^//\s*(.+?)$', content, re.MULTILINE)
        if match:
            return match.group(1).strip()
        # Look for export const description
        match = re.search(r"export\s+const\s+description\s*=\s*['\"](.+?)['\"]", content)
        if match:
            return match.group(1).strip()
        return ""
    except:
        return ""


def get_profiles():
    """Load profiles from settings.json."""
    if not PROFILES_PATH.exists():
        return {}
    try:
        data = json.loads(PROFILES_PATH.read_text())
        return data.get("profiles", {})
    except:
        return {}


def list_tools(as_json=False):
    """List all auditors and adapters."""
    tools = get_tools_info()

    if as_json:
        print(json.dumps(tools, indent=2))
        return 0

    print(f"\n{BOLD}Auditors{RESET} (find issues):")
    for t in sorted(tools["auditors"], key=lambda x: x["name"]):
        desc = f" — {t['description']}" if t['description'] else ""
        print(f"  {GREEN}●{RESET} {t['name']}{DIM}{desc}{RESET}")

    print(f"\n{BOLD}Adapters{RESET} (fix issues / preferences):")
    for t in sorted(tools["adapters"], key=lambda x: x["name"]):
        desc = f" — {t['description']}" if t['description'] else ""
        print(f"  {BLUE}●{RESET} {t['name']}{DIM}{desc}{RESET}")

    print(f"\n{DIM}Total: {len(tools['auditors'])} auditors, {len(tools['adapters'])} adapters{RESET}\n")
    return 0


def list_profiles(as_json=False):
    """List all accessibility profiles."""
    profiles = get_profiles()

    if as_json:
        print(json.dumps(profiles, indent=2))
        return 0

    print(f"\n{BOLD}Accessibility Profiles{RESET}:\n")
    for key, profile in sorted(profiles.items()):
        name = profile.get("name", key)
        desc = profile.get("description", "")
        tools = profile.get("tools", {})
        enabled = [k for k, v in tools.items() if v and v is not False]

        print(f"  {PURPLE}●{RESET} {BOLD}{key}{RESET} — {name}")
        if desc:
            print(f"    {DIM}{desc}{RESET}")
        if enabled:
            print(f"    {DIM}Tools: {', '.join(enabled[:5])}{'...' if len(enabled) > 5 else ''}{RESET}")
        print()

    return 0


def create_adapter(name, profiles=None):
    """Scaffold a new adapter."""
    filename = name.replace("_", "-").lower()
    filepath = ADAPTERS_DIR / f"{filename}.js"

    if filepath.exists():
        print(f"{YELLOW}Error:{RESET} Adapter '{filename}' already exists at {filepath}")
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
    print(f"{GREEN}✓{RESET} Created adapter: {filepath.relative_to(SCRIPT_DIR.parent)}")
    print(f"\n{DIM}Next steps:")
    print(f"  1. Edit {filepath.name} to implement your logic")
    print(f"  2. Add export to tools/adapters/index.js")
    print(f"  3. Run: npm run build{RESET}\n")
    return 0


def create_auditor(name):
    """Scaffold a new auditor."""
    filename = name.replace("_", "-").lower()
    filepath = AUDITORS_DIR / f"{filename}.js"

    if filepath.exists():
        print(f"{YELLOW}Error:{RESET} Auditor '{filename}' already exists at {filepath}")
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
    print(f"{GREEN}✓{RESET} Created auditor: {filepath.relative_to(SCRIPT_DIR.parent)}")
    print(f"\n{DIM}Next steps:")
    print(f"  1. Edit {filepath.name} to implement detection logic")
    print(f"  2. Add export to tools/auditors/index.js")
    print(f"  3. Run: npm run build{RESET}\n")
    return 0


def run_session_command(args, json_output=False):
    """Run ai4a11y.py session command."""
    core_path = SCRIPT_DIR / "ai4a11y.py"

    # Build command (sys.executable — bare "python" may not exist, e.g. macOS)
    cmd = [sys.executable, str(core_path), "session"] + args

    # Add JSON flag if needed
    if json_output:
        cmd.append("--json")

    cmd_name = args[0] if args else "unknown"

    # If JSON output, run quietly and capture
    if json_output:
        result = subprocess.run(cmd, capture_output=True, text=True, env={**os.environ, "NODE_NO_WARNINGS": "1"})
        # Try to parse and re-format JSON
        try:
            output = result.stdout.strip()
            # Find JSON in output (may have other text before it)
            json_start = output.find('{')
            if json_start >= 0:
                data = json.loads(output[json_start:])
                print(json.dumps(data, indent=2))
            else:
                print(output)
        except json.JSONDecodeError:
            print(result.stdout)
        if result.stderr:
            print(result.stderr, file=sys.stderr)
        return result.returncode

    # Color by category
    if cmd_name in SEE:
        color = GREEN
    elif cmd_name in DO:
        color = BLUE
    elif cmd_name in MOVE:
        color = PURPLE
    elif cmd_name in VISUAL:
        color = YELLOW
    elif cmd_name in AUDIT:
        color = GREEN
    elif cmd_name in FIX:
        color = BLUE
    elif cmd_name in SESSION:
        color = DIM
    else:
        color = DIM

    # Display name and detail
    display_name = cmd_name.upper()
    detail = ""

    if cmd_name == "go" and len(args) > 1:
        detail = f" → {args[1][:50]}{'...' if len(args[1]) > 50 else ''}"
    elif cmd_name == "ask" and len(args) > 1:
        detail = f": \"{args[1][:40]}{'...' if len(args[1]) > 40 else ''}\""
    elif cmd_name == "tap" and len(args) > 1:
        detail = f": \"{args[1][:40]}{'...' if len(args[1]) > 40 else ''}\""
    elif cmd_name == "type" and len(args) > 1:
        detail = f": \"{args[1][:30]}{'...' if len(args[1]) > 30 else ''}\""
    elif cmd_name == "media" and len(args) > 1:
        detail = f" {args[1]}" + (f" {args[2]}" if len(args) > 2 else "")
    elif cmd_name == "scroll":
        detail = f" {args[1] if len(args) > 1 else 'down'}"
    elif cmd_name == "heading":
        detail = f" {args[1] if len(args) > 1 else 'next'}"
    elif cmd_name == "enable" and len(args) > 1:
        detail = f": {args[1]}"
    elif cmd_name == "disable" and len(args) > 1:
        detail = f": {args[1]}"
    elif cmd_name == "profile" and len(args) > 1:
        detail = f": {args[1]}"

    print(f"\n{color}{BOLD}{display_name}{RESET}{detail}")

    # Run and filter output
    result = subprocess.run(cmd, capture_output=True, text=True, env={**os.environ, "NODE_NO_WARNINGS": "1"})

    # Clean output
    lines = [l for l in result.stdout.split("\n")
             if l.strip() and "DeprecationWarning" not in l and "trace-deprecation" not in l]

    if lines:
        print(f"{DIM}{'─' * 50}{RESET}")
        for line in lines:
            print(f"  {line}")
        print(f"{DIM}{'─' * 50}{RESET}")

    # Errors
    for line in (result.stderr or "").split("\n"):
        if line.strip() and "DeprecationWarning" not in line and "trace-deprecation" not in line:
            print(f"  {line}")

    return result.returncode


def main():
    args = sys.argv[1:]

    if not args:
        print(__doc__)
        sys.exit(0)

    # Check for --json flag
    json_output = "--json" in args
    if json_output:
        args = [a for a in args if a != "--json"]

    cmd = args[0]

    # List commands
    if cmd == "list":
        if len(args) < 2:
            print("Usage: ai4a11y list [tools|profiles]")
            sys.exit(1)
        subcmd = args[1]
        if subcmd == "tools":
            sys.exit(list_tools(as_json=json_output))
        elif subcmd == "profiles":
            sys.exit(list_profiles(as_json=json_output))
        else:
            print(f"Unknown list type: {subcmd}")
            sys.exit(1)

    # Create commands
    elif cmd == "create":
        if len(args) < 2 or args[1].startswith("-"):
            print("Usage: ai4a11y create <name> --type [adapter|auditor] [--profiles blv,cognitive]")
            sys.exit(0 if "--help" in args or "-h" in args else 1)

        name = args[1]
        type_arg = "adapter"  # default
        profiles_arg = None

        # Parse flags
        i = 2
        while i < len(args):
            if args[i] == "--type" and i + 1 < len(args):
                type_arg = args[i + 1]
                i += 2
            elif args[i] == "--profiles" and i + 1 < len(args):
                profiles_arg = args[i + 1]
                i += 2
            else:
                i += 1

        if type_arg == "adapter":
            sys.exit(create_adapter(name, profiles_arg))
        elif type_arg == "auditor":
            sys.exit(create_auditor(name))
        else:
            print(f"Unknown type: {type_arg}. Use 'adapter' or 'auditor'.")
            sys.exit(1)

    # Session commands (delegate to ai4a11y.py)
    elif cmd == "session":
        sys.exit(run_session_command(args[1:], json_output=json_output))

    # Direct session shortcuts (backwards compatible)
    elif cmd in SEE | DO | MOVE | SESSION | VISUAL | AUDIT | FIX:
        sys.exit(run_session_command(args, json_output=json_output))

    else:
        print(f"Unknown command: {cmd}")
        print(__doc__)
        sys.exit(1)


if __name__ == "__main__":
    main()
