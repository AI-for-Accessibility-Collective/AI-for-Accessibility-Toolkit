"""
Minimal browser agent: Gemini sees the screen, decides what to do, harness executes it.

Usage:
    uv run my_agent.py "go to github.com and find trending python repos"

Requires: GEMINI_API_KEY in .env or environment.
"""

import base64, json, os, sys, time
from pathlib import Path

# --- Load environment ---
env_path = Path(__file__).parent / ".env"
if env_path.exists():
    for line in env_path.read_text().splitlines():
        if line.strip() and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"'))

# --- Import harness (auto-starts daemon) ---
from admin import ensure_daemon
from helpers import (
    capture_screenshot, click_at_xy, goto_url, js,
    new_tab, page_info, press_key, scroll, type_text,
    wait, wait_for_load,
)

# --- LLM setup (Gemini) ---
import google.genai as genai

client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
MODEL = "gemini-2.5-flash-preview-05-20"

SYSTEM_PROMPT = """You are a browser agent. You see a screenshot of a web page and decide what action to take next.

Available actions (respond with exactly ONE JSON object):

{"action": "click", "x": 340, "y": 200, "reason": "clicking the search bar"}
{"action": "type", "text": "hello world", "reason": "typing search query"}
{"action": "press_key", "key": "Enter", "reason": "submitting the form"}
{"action": "scroll", "x": 600, "y": 400, "dy": -300, "reason": "scrolling down to see more"}
{"action": "navigate", "url": "https://example.com", "reason": "going to the target page"}
{"action": "wait", "seconds": 2, "reason": "waiting for page to load"}
{"action": "done", "summary": "task complete — here's what I found: ..."}

Rules:
- Always respond with a single JSON object, nothing else.
- Use "reason" to explain your thinking.
- After clicking or typing, you'll get a new screenshot to verify.
- If you see a login wall, respond with {"action": "done", "summary": "Hit a login wall — need to sign in first."}
- Coordinates are in CSS pixels (not physical pixels).
"""


def screenshot_as_base64():
    """Take a screenshot and return base64 bytes."""
    path = capture_screenshot("/tmp/agent_shot.png")
    return base64.b64encode(open(path, "rb").read()).decode()


def ask_llm(task: str, screenshot_b64: str, history: list[dict]) -> dict:
    """Send screenshot + task to Gemini, get back an action."""
    messages = [
        {"role": "user", "parts": [
            {"text": f"Task: {task}"},
            {"text": "Here is the current browser screenshot:"},
            {"inline_data": {"mime_type": "image/png", "data": screenshot_b64}},
            {"text": "Previous actions:\n" + "\n".join(
                f"  {i+1}. {h['reason']}" for i, h in enumerate(history[-10:])
            ) if history else "No previous actions yet."},
            {"text": "What single action should I take next? Respond with JSON only."},
        ]}
    ]

    response = client.models.generate_content(
        model=MODEL,
        contents=messages,
        config={"system_instruction": SYSTEM_PROMPT, "temperature": 0.2},
    )

    # Parse JSON from response
    text = response.text.strip()
    # Handle markdown code blocks
    if text.startswith("```"):
        text = text.split("\n", 1)[1].rsplit("```", 1)[0].strip()
    return json.loads(text)


def execute_action(action: dict):
    """Execute the action the LLM decided on."""
    act = action["action"]

    if act == "click":
        click_at_xy(action["x"], action["y"])
        wait(0.5)
    elif act == "type":
        type_text(action["text"])
        wait(0.3)
    elif act == "press_key":
        press_key(action["key"])
        wait(0.5)
    elif act == "scroll":
        scroll(action.get("x", 600), action.get("y", 400), action.get("dy", -300))
        wait(0.5)
    elif act == "navigate":
        goto_url(action["url"])
        wait_for_load()
    elif act == "wait":
        wait(action.get("seconds", 1))
    elif act == "done":
        return False  # signal to stop

    return True  # keep going


def run_agent(task: str, max_steps: int = 20):
    """Main agent loop."""
    print(f"\n🤖 Agent starting: {task}\n")

    ensure_daemon()
    new_tab("about:blank")
    history = []

    for step in range(max_steps):
        # 1. See the screen
        shot = screenshot_as_base64()

        # 2. Think
        print(f"  Step {step + 1}: thinking...", end=" ", flush=True)
        action = ask_llm(task, shot, history)
        reason = action.get("reason") or action.get("summary", "")
        print(f"→ {action['action']}: {reason}")

        # 3. Act
        history.append(action)
        if not execute_action(action):
            print(f"\n✅ Done: {action.get('summary', 'task complete')}\n")
            return action.get("summary")

    print(f"\n⚠️ Reached max steps ({max_steps})")
    return None


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: uv run my_agent.py \"your task here\"")
        sys.exit(1)

    task = " ".join(sys.argv[1:])
    run_agent(task)
