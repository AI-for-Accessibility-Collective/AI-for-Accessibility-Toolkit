#!/usr/bin/env python3
"""
AI4A11y CLI — clean output wrapper for demos.
Usage: python cli.py <command> [args]
"""

import subprocess
import sys
import os

# Colors: See (green), Do (blue), Move (purple), Session (dim)
GREEN = "\033[92m"
BLUE = "\033[94m"
PURPLE = "\033[95m"
DIM = "\033[2m"
RESET = "\033[0m"
BOLD = "\033[1m"

# Simplified categories
SEE = {"describe", "summary", "ask", "audit", "report"}  # Understanding
DO = {"tap", "type", "hover", "drag", "nudge", "pickdate", "dismiss", "media", "activate", "enter", "press", "do"}  # Actions
MOVE = {"go", "back", "scroll", "tab", "arrow", "key", "heading", "skip", "list", "find", "read", "tables", "focused", "diff"}  # Navigation
SESSION = {"start", "stop", "status", "screenshot", "tabs", "focus", "cleanup-tabs"}  # Browser control

def run_ai4a11y(args):
    """Run ai4a11y.py with clean output."""
    script_dir = os.path.dirname(os.path.abspath(__file__))
    core_path = os.path.join(script_dir, "ai4a11y.py")
    cmd = ["python", core_path, "session"] + args

    cmd_name = args[0] if args else "unknown"

    # Color by category
    if cmd_name in SEE:
        color = GREEN
    elif cmd_name in DO:
        color = BLUE
    elif cmd_name in MOVE:
        color = PURPLE
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
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    sys.exit(run_ai4a11y(sys.argv[1:]))

if __name__ == "__main__":
    main()
