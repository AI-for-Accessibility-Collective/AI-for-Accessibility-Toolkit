"""
agent.py — BrowserMind Text genai SDK agent.

Uses google-genai Chat API for:
- Multi-turn conversation with full history (screenshots as inline_data)
- Lazy domain skill loading via read_skill() tool
- Self-healing via full visual history in every LLM call
- No ADK — plain genai SDK gives full control over the contents array
"""

import asyncio
import base64
import logging
import os
import sys
import time
from pathlib import Path

from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().with_name(".env"))

import google.genai as genai
import google.genai.types as types

from browser_tools import (
    ALL_TOOLS,
    ACTION_TOOL_NAMES,
    get_screenshot_bytes,
    HARNESS_DIR,
)
from skill_loader import detect_domain_skills, detect_interaction_skills

logger = logging.getLogger("browsermind_text.agent")

# ── Model configuration ────────────────────────────────────────────────────────

_USE_VERTEX = os.getenv("USE_VERTEX_AI", "true").lower() == "true"

if _USE_VERTEX:
    client = genai.Client(
        vertexai=True,
        project=os.getenv("VERTEX_PROJECT", "your-gcp-project-id"),
        location=os.getenv("VERTEX_LOCATION", "global"),
    )
    MODEL = os.getenv("AGENT_MODEL", "gemini-2.5-flash")
else:
    client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
    MODEL = os.getenv("AGENT_MODEL", "gemini-2.5-flash")

logger.info(f"Agent using model: {MODEL} | Vertex: {_USE_VERTEX}")

# ── SKILL.md system prompt ─────────────────────────────────────────────────────
# Injected as system_instruction — cached by Gemini API, not a per-turn token cost.
# This mirrors how Gemini CLI loads browser-harness SKILL.md into agent context.

_SKILL_MD_PATH = HARNESS_DIR / "SKILL.md"
_SKILL_MD = _SKILL_MD_PATH.read_text(encoding="utf-8") if _SKILL_MD_PATH.exists() else ""

SYSTEM_PROMPT = f"""You are BrowserMind Text, a browser automation agent.
You control the user's Chrome browser via the available tools.

## CRITICAL RULE — YOU MUST USE TOOLS
NEVER describe or claim you did something without actually calling the tool.
- If the user asks you to go to a website → call browser_navigate()
- If the user asks you to click → call browser_click()
- If the user asks you to type → call browser_type()
- If the user asks you to search → call browser_navigate(), then browser_click(), then browser_type()
- NEVER say "I have navigated to..." or "I have searched..." without first calling the tool
- NEVER respond with just text if the task requires browser interaction

## Harness Operating Manual
{_SKILL_MD}

## Skill Loading Protocol (mirrors Gemini CLI)
When browser_navigate() returns 'available_domain_skills' (a list of skill names):
  - Decide if any are relevant to the current task
  - If yes: call read_skill("<name>") to load the skill content BEFORE acting
  - Example: navigate to github.com → sees ["github/scraping", "github/repo-actions"]
    → call read_skill("github/scraping") if you're scraping data

When you encounter a tricky UI mechanic during a task:
  - Dialogs/modals:  call read_skill("dialogs")
  - Dropdowns/menus: call read_skill("dropdowns")
  - Iframes:         call read_skill("iframes")
  - File uploads:    call read_skill("uploads")
  - Tab management:  call read_skill("tabs")

Only read skills you'll actually use — be selective.

## Self-Healing Protocol
You receive a fresh screenshot as an image after every browser action.
Your FULL conversation history — including ALL prior screenshots — is in your context.

Use visual evidence to reason about and recover from failures:
  1. Compare the current screenshot to prior ones — did the page change?
  2. If an action did nothing: look carefully at where you clicked vs. where the target is
  3. If a click missed: try adjusted coordinates, or use browser_js() with a CSS selector
  4. If text didn't type: click the input first to focus it, then type again
  5. If a page is stuck: call browser_read_page() to check URL, then retry navigation
  6. Never repeat an identical failed action — always try a different approach

## Task Completion
When the task is fully done, end your response with:
TASK_COMPLETE: <one-line summary of what was accomplished>

## Safety Rules
- If you hit a login wall: STOP and tell the user — never type credentials
- If you see a CAPTCHA: tell the user you need help
- If something unexpected happens: describe what you see and ask the user
"""

# ── Browser session ─────────────────────────────────────────────────────────────

class BrowserAgentSession:
    """
    One per user WebSocket connection.
    Holds a genai Chat object that manages full conversation history automatically.
    Screenshots are added as inline_data Parts — Gemini sees them as real images.
    """

    def __init__(self, session_id: str):
        self.session_id = session_id
        self.chat = client.aio.chats.create(
            model=MODEL,
            config=types.GenerateContentConfig(
                system_instruction=SYSTEM_PROMPT,
                tools=ALL_TOOLS,
                temperature=0.2,
                # AUTO: model can call tools OR return text when done.
                # Disable AFC so the SDK does NOT execute tools internally
                # before returning — we handle tool execution manually.
                tool_config=types.ToolConfig(
                    function_calling_config=types.FunctionCallingConfig(
                        mode="AUTO",
                    )
                ),
                automatic_function_calling=types.AutomaticFunctionCallingConfig(
                    disable=True,
                ),
            ),
        )
        self.step_count = 0
        self.max_steps = 25


    def _screenshot_part(self) -> types.Part:
        """Take screenshot and return as inline_data Part — Gemini sees this as an image."""
        img_bytes = get_screenshot_bytes()
        return types.Part(
            inline_data=types.Blob(mime_type="image/png", data=img_bytes)
        )

    async def run_turn(self, user_text: str, ws) -> str:
        """
        Process one user message. Sends events to WebSocket.

        Uses non-streaming send_message so function_calls are always present
        in the response (streaming + AFC was intercepting tool calls internally).
        """
        self.step_count = 0

        # Detect current browser URL for domain skill hints
        try:
            from helpers import page_info
            current_url = page_info().get("url", "")
        except Exception:
            current_url = ""

        domain_skills = detect_domain_skills(current_url)
        interaction_skills = detect_interaction_skills(user_text)

        # ── Build initial user message ────────────────────────────────────────
        initial_parts: list[types.Part] = [
            types.Part(text=f"Task: {user_text}"),
        ]

        # Inject skill hints (names only — content loaded lazily by agent)
        skill_hints = []
        if domain_skills:
            skill_hints.append(f"Available domain skills for {current_url}: {domain_skills}")
        if interaction_skills:
            skill_hints.append(f"Possibly relevant interaction skills: {interaction_skills}")
        if skill_hints:
            initial_parts.append(types.Part(
                text="Skill hints (call read_skill() if relevant):\n" + "\n".join(skill_hints)
            ))

        # Send initial screenshot to viewport + add as inline_data for model
        # Send initial screenshot to the viewport panel immediately
        try:
            img_bytes = get_screenshot_bytes()
            b64 = base64.b64encode(img_bytes).decode()
            await ws.send_json({
                "type": "browser_screenshot",
                "data": b64,
                "url": current_url,
                "step": 0,
            })
            # Also add as inline_data for model context
            initial_parts.append(types.Part(
                inline_data=types.Blob(mime_type="image/png", data=img_bytes)
            ))
            initial_parts.append(types.Part(text=f"Current browser URL: {current_url or 'about:blank'}"))
        except Exception as e:
            logger.warning(f"Could not take initial screenshot: {e}")
            initial_parts.append(types.Part(text="Browser screenshot unavailable."))

        await ws.send_json({"type": "thinking"})

        # ── Inner action loop ─────────────────────────────────────────────────
        current_message = initial_parts

        for step in range(self.max_steps):
            self.step_count = step + 1

            try:
                # Non-streaming call — function_calls are always in the response
                response = await self.chat.send_message(current_message)
                logger.debug(f"Step {step+1} finish_reason: {response.candidates[0].finish_reason if response.candidates else 'N/A'}")
            except Exception as e:
                logger.error(f"LLM call error: {e}")
                await ws.send_json({"type": "error", "message": str(e)})
                return f"Error: {e}"

            response_text = response.text or ""
            function_calls = response.function_calls or []

            logger.info(f"Step {step+1}: text={len(response_text)} chars, tool_calls={[fc.name for fc in function_calls]}")

            # Stream the text to the frontend
            if response_text:
                await ws.send_json({"type": "text_chunk", "text": response_text})

            # Check completion signal
            if "TASK_COMPLETE:" in response_text:
                summary = response_text.split("TASK_COMPLETE:", 1)[1].strip()
                await ws.send_json({"type": "task_done", "summary": summary})
                return summary

            # No function calls = agent is done
            if not function_calls:
                return response_text

            # ── Execute tools ─────────────────────────────────────────────────
            tool_response_parts: list[types.Part] = []
            took_action = False

            for fc in function_calls:
                tool_name = fc.name
                tool_args = dict(fc.args or {})
                t_start = time.monotonic()

                await ws.send_json({
                    "type": "tool_called",
                    "tool": tool_name,
                    "args": tool_args,
                    "step": self.step_count,
                })

                # Execute in thread pool (tools are synchronous)
                try:
                    tool_fn = _get_tool_fn(tool_name)
                    loop = asyncio.get_running_loop()
                    result = await loop.run_in_executor(
                        None, lambda fn=tool_fn, a=tool_args: fn(**a)
                    )
                except Exception as e:
                    logger.error(f"Tool {tool_name} failed: {e}")
                    result = {"error": str(e)}

                duration_ms = int((time.monotonic() - t_start) * 1000)

                # Notify skill load events for activity log
                if tool_name == "read_skill" and "skill_content" in result:
                    await ws.send_json({
                        "type": "skill_loaded",
                        "skill": tool_args.get("skill_path", ""),
                    })

                await ws.send_json({
                    "type": "tool_done",
                    "tool": tool_name,
                    "duration_ms": duration_ms,
                    "success": "error" not in result,
                })

                # Add function response
                tool_response_parts.append(
                    types.Part(
                        function_response=types.FunctionResponse(
                            name=tool_name,
                            response=result,
                        )
                    )
                )

                if tool_name in ACTION_TOOL_NAMES:
                    took_action = True

            # After every step with tool calls: take a fresh screenshot
            # Always send to viewport so user can see live browser state
            try:
                img_bytes = get_screenshot_bytes()
                b64 = base64.b64encode(img_bytes).decode()
                try:
                    from helpers import page_info
                    current_url = page_info().get("url", "")
                except Exception:
                    current_url = ""

                # Send to viewport panel (always visible)
                await ws.send_json({
                    "type": "browser_screenshot",
                    "data": b64,
                    "url": current_url,
                    "step": self.step_count,
                })

                # Add screenshot as inline_data for next model turn (self-healing)
                tool_response_parts.append(
                    types.Part(inline_data=types.Blob(mime_type="image/png", data=img_bytes))
                )

            except Exception as e:
                logger.warning(f"Screenshot failed after step {self.step_count}: {e}")


            # Next iteration uses tool responses (+ screenshot) as input
            current_message = tool_response_parts

        await ws.send_json({"type": "max_steps_reached", "steps": self.max_steps})
        return f"Reached maximum steps ({self.max_steps})"


# ── Tool function registry ──────────────────────────────────────────────────────

def _build_tool_registry() -> dict:
    from browser_tools import (
        browser_navigate, browser_click, browser_type,
        browser_press_key, browser_scroll, browser_read_page,
        browser_new_tab, browser_list_tabs, browser_js, read_skill,
    )
    return {
        "browser_navigate": browser_navigate,
        "browser_click": browser_click,
        "browser_type": browser_type,
        "browser_press_key": browser_press_key,
        "browser_scroll": browser_scroll,
        "browser_read_page": browser_read_page,
        "browser_new_tab": browser_new_tab,
        "browser_list_tabs": browser_list_tabs,
        "browser_js": browser_js,
        "read_skill": read_skill,
    }

_TOOL_REGISTRY: dict = {}

def _get_tool_fn(name: str):
    global _TOOL_REGISTRY
    if not _TOOL_REGISTRY:
        _TOOL_REGISTRY = _build_tool_registry()
    fn = _TOOL_REGISTRY.get(name)
    if fn is None:
        raise ValueError(f"Unknown tool: {name}")
    return fn
