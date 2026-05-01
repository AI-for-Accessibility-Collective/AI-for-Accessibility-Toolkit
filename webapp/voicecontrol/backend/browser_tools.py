"""
Browser-harness helpers wrapped as ADK-compatible tool functions.

These functions communicate with the browser-harness daemon via Unix socket
IPC (through helpers.py). They are synchronous calls that execute quickly
since the daemon holds the CDP WebSocket connection.

The actual browser-harness repo must be importable — we add it to sys.path.
"""

import base64
import json
import os
import sys
import time
from pathlib import Path

# Add browser-harness to sys.path so we can import helpers/admin directly
HARNESS_DIR = os.environ.get(
    "BROWSER_HARNESS_DIR",
    str(Path(__file__).resolve().parents[2] / "browser-harness"),
)
if HARNESS_DIR not in sys.path:
    sys.path.insert(0, HARNESS_DIR)

from admin import ensure_daemon  # noqa: E402
from helpers import (  # noqa: E402
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


def _screenshot_b64(path: str = "/tmp/bm_shot.png") -> str:
    """Capture screenshot and return base64-encoded PNG data."""
    capture_screenshot(path)
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode()


# ---------- ADK tool functions ----------
# Each returns a dict that the agent sees as the tool result.


def browser_navigate(url: str) -> dict:
    """Navigate the browser to a URL and wait for the page to load.

    Args:
        url: The full URL to navigate to (e.g. "https://github.com")

    Returns:
        Navigation result with current page info.
    """
    goto_url(url)
    wait_for_load(timeout=10.0)
    info = page_info()
    return {
        "status": "navigated",
        "url": info.get("url", url),
        "title": info.get("title", ""),
    }


def browser_click(x: int, y: int, reason: str = "") -> dict:
    """Click at specific coordinates on the browser page.

    Use the screenshot to identify where to click. Coordinates are in
    CSS pixels. Clicks pass through iframes and shadow DOM.

    Args:
        x: X coordinate in CSS pixels
        y: Y coordinate in CSS pixels
        reason: Brief description of what you're clicking

    Returns:
        Click confirmation.
    """
    click_at_xy(x, y)
    wait(0.5)
    return {"status": "clicked", "x": x, "y": y, "reason": reason}


def browser_type(text: str) -> dict:
    """Type text into the currently focused element.

    Args:
        text: The text to type

    Returns:
        Typing confirmation.
    """
    type_text(text)
    wait(0.3)
    return {"status": "typed", "text": text}


def browser_press_key(key: str) -> dict:
    """Press a keyboard key.

    Args:
        key: Key name — "Enter", "Tab", "Escape", "Backspace",
             "ArrowDown", "ArrowUp", or a single character.

    Returns:
        Key press confirmation.
    """
    press_key(key)
    wait(0.3)
    return {"status": "pressed", "key": key}


def browser_scroll(x: int = 600, y: int = 400, dy: int = -300) -> dict:
    """Scroll the page at the given coordinates.

    Args:
        x: X coordinate to scroll at (default: center)
        y: Y coordinate to scroll at (default: center)
        dy: Scroll amount — negative scrolls down, positive scrolls up.
            -300 is about one screenful down.

    Returns:
        Scroll confirmation.
    """
    scroll(x, y, dy)
    wait(0.5)
    return {"status": "scrolled", "x": x, "y": y, "dy": dy}


def browser_screenshot() -> dict:
    """Capture the current browser viewport as a screenshot.

    IMPORTANT: Call this after every navigation, click, or typing action
    to verify the result. The screenshot will be sent to you as an image.

    Returns:
        Screenshot result with page info.
    """
    info = page_info()
    return {
        "status": "captured",
        "url": info.get("url", ""),
        "title": info.get("title", ""),
        "viewport": f"{info.get('w', 0)}x{info.get('h', 0)}",
    }


def browser_read_page() -> dict:
    """Get basic information about the current page.

    Returns the URL, title, viewport dimensions, and scroll position.
    Use this for a quick check without taking a screenshot.

    Returns:
        Page information dict.
    """
    return page_info()


def browser_new_tab(url: str = "about:blank") -> dict:
    """Open a new browser tab with the given URL.

    Args:
        url: URL to open in the new tab (default: blank page)

    Returns:
        New tab confirmation.
    """
    tid = new_tab(url)
    if url != "about:blank":
        wait_for_load(timeout=10.0)
    info = page_info()
    return {
        "status": "new_tab_opened",
        "target_id": tid,
        "url": info.get("url", url),
        "title": info.get("title", ""),
    }


def browser_list_tabs() -> dict:
    """List all open browser tabs.

    Returns:
        Dict with list of tabs (targetId, title, url).
    """
    tabs = list_tabs(include_chrome=False)
    return {"tabs": tabs, "count": len(tabs)}


def browser_js(expression: str) -> dict:
    """Execute JavaScript in the current page and return the result.

    Args:
        expression: JavaScript expression to evaluate

    Returns:
        The evaluation result.
    """
    result = js(expression)
    return {"result": result}


# Collect all tools for the agent
ALL_TOOLS = [
    browser_navigate,
    browser_click,
    browser_type,
    browser_press_key,
    browser_scroll,
    browser_screenshot,
    browser_read_page,
    browser_new_tab,
    browser_list_tabs,
    browser_js,
]
