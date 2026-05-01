"""
BrowserMind ADK agent definition.

Uses Gemini 3.1 Flash Live for bidi audio streaming + vision.
Browser actions are registered as ADK tools via browser_tools.py.
"""

import asyncio
import logging
import os
from pathlib import Path

from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().with_name(".env"))

from google.adk.agents import Agent
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.adk.memory import InMemoryMemoryService

from browser_tools import ALL_TOOLS, browser_navigate, browser_click, browser_type

logger = logging.getLogger("browsermind")


# ---------- Non-blocking tool callback ----------
# Browser actions can take 0.5-2s (navigation, screenshot capture).
# In Gemini Live bidi streaming, tool execution freezes the audio stream.
# This callback fires action tools in background threads so voice keeps flowing.

_BG_TOOLS = {
    "browser_navigate",
    "browser_click",
    "browser_type",
    "browser_press_key",
    "browser_scroll",
    "browser_new_tab",
}

_INSTANT_TOOLS = {
    "browser_screenshot",
    "browser_read_page",
    "browser_list_tabs",
    "browser_js",
}


async def _bg_tool_exec(fn, args: dict):
    """Execute a tool's underlying callable in a background thread."""
    fn_name = getattr(fn, "__name__", str(fn))
    try:
        loop = asyncio.get_running_loop()
        result = await loop.run_in_executor(None, lambda: fn(**args))
        logger.info(f"[bg-tool] {fn_name} completed: {result}")
    except Exception as e:
        logger.error(f"[bg-tool] {fn_name} failed: {e}")


def _fast_tool_callback(tool, args, tool_context):
    """Intercept browser tools to prevent audio-stream blocking.

    - Action tools (navigate, click, type): fire in background, return instant ack
    - Read tools (screenshot, page_info): let ADK run normally (fast enough)
    """
    tool_name = getattr(tool, "name", "")

    if tool_name in _BG_TOOLS:
        logger.info(f"[fast-tool] {tool_name} → background: {args}")
        try:
            # ADK wraps registered tools as FunctionTool objects.
            # .func is the underlying raw Python callable (browser_navigate, etc.)
            underlying = getattr(tool, "func", None)
            if underlying is None:
                logger.warning(f"[fast-tool] No .func on {tool_name}, skipping background exec")
            else:
                loop = asyncio.get_running_loop()
                loop.create_task(_bg_tool_exec(underlying, args))
        except RuntimeError:
            logger.warning(f"[fast-tool] No running loop for {tool_name} — running synchronously")
        return {"status": "executing", "action": tool_name, **args}

    # Let instant tools run normally through ADK
    return None


# ---------- Agent definition ----------

root_agent = Agent(
    model=os.getenv("DEMO_AGENT_MODEL", "gemini-live-2.5-flash-native-audio"),
    name="browser_agent",
    instruction="""\
You are BrowserMind, an AI assistant that controls a web browser via voice.
You can see the browser through screenshots and interact via clicks,
typing, scrolling, and navigation.

## Runtime Context
{startup_context?}

## How You Work
1. You receive voice commands from the user
2. You see the browser via screenshots (sent as images periodically)
3. You execute browser actions using your tools
4. After each action, call browser_screenshot() to verify it worked
5. You narrate what you're doing in natural, concise speech

## Screenshot Protocol
- After EVERY navigation, click, or type action, call browser_screenshot()
  to capture the current state and verify your action worked
- Use the screenshot to find click targets — look at visible text, buttons,
  links, and input fields
- Coordinates are in CSS pixels (not physical pixels)
- Clicks are compositor-level — they pass through iframes and shadow DOM

## Coordinate Clicking Strategy
- Look at the screenshot carefully to identify interactive elements
- Click the CENTER of buttons, links, and input fields
- If a click didn't hit the right target, adjust coordinates and retry
- For small elements, be precise — estimate the midpoint of the text/icon
- If you're unsure where to click, describe what you see and ask the user

## Available Tools
- browser_navigate(url): Go to a URL
- browser_click(x, y, reason): Click at coordinates
- browser_type(text): Type text into the focused element
- browser_press_key(key): Press Enter, Tab, Escape, etc.
- browser_scroll(x, y, dy): Scroll the page (negative dy = scroll down)
- browser_screenshot(): Capture current viewport — call after every action!
- browser_read_page(): Get page title, URL, dimensions (quick check)
- browser_new_tab(url): Open a new tab
- browser_list_tabs(): List all open tabs
- browser_js(expression): Run JavaScript on the page

## Voice Rules
- Keep spoken responses SHORT — this is voice, not text
- Narrate actions concisely: "Navigating to GitHub... clicking the search bar..."
- Don't read out long URLs or code — summarize instead
- If you see search results or content the user asked about, summarize
  the key findings conversationally

## Error Recovery
- If a page doesn't load, wait 2-3 seconds and try again
- If a click didn't work (page unchanged), try clicking slightly different
  coordinates or verify you clicked the right element
- If you see a cookie consent banner or popup dialog, dismiss it first
  (click Accept, Close, or press Escape)
- If the page shows a CAPTCHA, tell the user you need their help
- If navigation lands on an error page (404, 500), inform the user and
  suggest alternatives

## Safety Rules
1. If you hit a login wall, STOP and tell the user — never type credentials
2. Never modify bookmarks, browser settings, or installed extensions
3. Don't navigate to suspicious or malicious URLs
4. If something looks wrong or unexpected, take a screenshot and describe it
""",
    tools=ALL_TOOLS,
    before_tool_callback=_fast_tool_callback,
)


# ---------- Services ----------

session_service = InMemorySessionService()
memory_service = InMemoryMemoryService()

runner = Runner(
    agent=root_agent,
    session_service=session_service,
    memory_service=memory_service,
    app_name="browsermind",
)
