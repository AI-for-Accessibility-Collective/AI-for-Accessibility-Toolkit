"""
browser_tools.py — Browser control functions for BrowserMind Text genai SDK agent.

Plain Python functions — google-genai SDK auto-generates tool schemas from
type hints and docstrings. No ADK wrappers needed.

Every action tool returns page state (url + title) so the LLM can verify
the action worked without a separate screenshot call.
"""

import base64
import os
import sys
from pathlib import Path
from urllib.parse import urlparse

# ── Harness import ─────────────────────────────────────────────────────────────
HARNESS_DIR = Path(
    os.environ.get(
        "BROWSER_HARNESS_DIR",
        str(Path(__file__).resolve().parents[2] / "browser-harness"),
    )
)

from browser_harness.admin import ensure_daemon
from browser_harness.helpers import (
    capture_screenshot,
    click_at_xy,
    goto_url,
    js,
    list_tabs,
    new_tab,
    page_info,
    press_key,
    scroll,
    type_text,
    wait,
    wait_for_load,
)

from skill_loader import (  # noqa: E402
    detect_domain_skills,
    read_skill_content,
    DOMAIN_SKILLS_DIR,
)


# ── Helpers ────────────────────────────────────────────────────────────────────

def _page_state() -> dict:
    """Return current page URL + title for self-healing context."""
    try:
        info = page_info()
        return {
            "page_url": info.get("url", ""),
            "page_title": info.get("title", ""),
        }
    except Exception as e:
        return {"page_url": "", "page_title": "", "page_state_error": str(e)}


def get_screenshot_bytes(path: str = "/tmp/bmt_shot.png") -> bytes:
    """Take a screenshot and return raw PNG bytes."""
    capture_screenshot(path)
    with open(path, "rb") as f:
        return f.read()


def get_screenshot_b64(path: str = "/tmp/bmt_shot.png") -> str:
    """Take a screenshot and return base64-encoded PNG (for WebSocket streaming)."""
    return base64.b64encode(get_screenshot_bytes(path)).decode()


# ── Browser action tools ───────────────────────────────────────────────────────

def browser_navigate(url: str) -> dict:
    """Navigate the browser to a URL and wait for the page to load.

    After navigation, check 'available_domain_skills' in the result.
    If any are relevant to the task, call read_skill() to load them
    BEFORE performing actions on the page.

    Args:
        url: Full URL to navigate to (e.g. "https://github.com/trending")

    Returns:
        Navigation result with page state and available domain skill names.
    """
    goto_url(url)
    wait_for_load(timeout=10.0)
    info = page_info()

    # Expose skill filenames (not content) — agent reads lazily
    try:
        hostname = urlparse(url).hostname or ""
        domain = hostname.removeprefix("www.").split(".")[0]
        skill_dir = DOMAIN_SKILLS_DIR / domain
        available_skills = (
            [f"{domain}/{p.stem}" for p in sorted(skill_dir.rglob("*.md"))[:5]]
            if skill_dir.is_dir()
            else []
        )
    except Exception:
        available_skills = []

    return {
        "status": "navigated",
        "page_url": info.get("url", url),
        "page_title": info.get("title", ""),
        "available_domain_skills": available_skills,
        # ^ LLM sees these names and decides whether to call read_skill()
    }


def browser_click(x: int, y: int, reason: str = "") -> dict:
    """Click at specific CSS pixel coordinates on the browser page.

    Clicks pass through iframes and shadow DOM at compositor level.
    Look at the current screenshot to identify click targets.

    Args:
        x: X coordinate in CSS pixels
        y: Y coordinate in CSS pixels
        reason: Brief description of what you're clicking (for activity log)

    Returns:
        Click result with current page state for self-healing verification.
    """
    click_at_xy(x, y)
    wait(0.5)
    return {"status": "clicked", "x": x, "y": y, "reason": reason, **_page_state()}


def browser_type(text: str) -> dict:
    """Type text into the currently focused element.

    Make sure an input is focused (by clicking it first) before typing.

    Args:
        text: The text to type

    Returns:
        Typing result with current page state.
    """
    type_text(text)
    wait(0.3)
    return {"status": "typed", "text": text, **_page_state()}


def browser_press_key(key: str) -> dict:
    """Press a keyboard key.

    Common keys: "Enter", "Tab", "Escape", "Backspace",
    "ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight".

    Args:
        key: Key name to press

    Returns:
        Key press result with current page state.
    """
    press_key(key)
    wait(0.5)
    return {"status": "pressed", "key": key, **_page_state()}


def browser_scroll(x: int = 600, y: int = 400, dy: int = -300) -> dict:
    """Scroll the page at given coordinates.

    Args:
        x: X coordinate to scroll at (default: horizontal center)
        y: Y coordinate to scroll at (default: vertical center)
        dy: Scroll amount — negative scrolls DOWN, positive scrolls UP.
            -300 is approximately one screenful down.

    Returns:
        Scroll confirmation.
    """
    scroll(x, y, dy)
    wait(0.3)
    return {"status": "scrolled", "x": x, "y": y, "dy": dy}


def browser_read_page() -> dict:
    """Get current page URL, title, and viewport dimensions.

    Use for a quick check without taking a full screenshot.

    Returns:
        Page info dict with url, title, width, height, scroll position.
    """
    try:
        info = page_info()
        return {
            "url": info.get("url", ""),
            "title": info.get("title", ""),
            "width": info.get("w", 0),
            "height": info.get("h", 0),
            "scroll_y": info.get("sy", 0),
            "page_height": info.get("ph", 0),
        }
    except Exception as e:
        return {"error": str(e)}


def browser_new_tab(url: str = "about:blank") -> dict:
    """Open a new browser tab.

    Args:
        url: URL to open in the new tab (default: blank)

    Returns:
        New tab info.
    """
    tid = new_tab(url)
    if url != "about:blank":
        wait_for_load(timeout=10.0)
    return {"status": "new_tab_opened", "target_id": tid, **_page_state()}


def browser_list_tabs() -> dict:
    """List all open browser tabs.

    Returns:
        List of open tabs with targetId, title, url.
    """
    tabs = list_tabs(include_chrome=False)
    return {"tabs": tabs, "count": len(tabs)}


def browser_js(expression: str) -> dict:
    """Execute JavaScript in the current page.

    Use as an escape hatch when standard tools can't handle a mechanic.
    Example: browser_js("document.querySelector('[aria-label=Search]').focus()")
    Example: browser_js("window.scrollTo(0, document.body.scrollHeight)")

    Args:
        expression: JavaScript expression to evaluate

    Returns:
        Evaluation result.
    """
    try:
        result = js(expression)
        return {"result": result, **_page_state()}
    except Exception as e:
        return {"error": str(e), **_page_state()}


def read_skill(skill_path: str) -> dict:
    """Read a browser-harness skill file for site-specific or mechanic-specific guidance.

    Call this when:
    - browser_navigate() returns available_domain_skills and one is relevant
    - You encounter a tricky UI mechanic (dialog, dropdown, iframe, upload)

    Domain skill examples: "github/scraping", "reddit/scraping", "gmail/compose"
    Interaction skill examples: "dialogs", "dropdowns", "iframes", "uploads", "tabs"

    Only read skills you'll actually use — each costs context window tokens.

    Args:
        skill_path: Path to skill, e.g. "github/scraping" or "dialogs"

    Returns:
        Skill content as markdown text.
    """
    return read_skill_content(skill_path)


# ── Tool collections ────────────────────────────────────────────────────────────

# Tools that perform browser actions (triggers screenshot after execution)
ACTION_TOOL_NAMES = {
    "browser_navigate",
    "browser_click",
    "browser_type",
    "browser_press_key",
    "browser_scroll",
    "browser_new_tab",
    "browser_js",
}

# All tools exposed to the agent
ALL_TOOLS = [
    browser_navigate,
    browser_click,
    browser_type,
    browser_press_key,
    browser_scroll,
    browser_read_page,
    browser_new_tab,
    browser_list_tabs,
    browser_js,
    read_skill,
]
