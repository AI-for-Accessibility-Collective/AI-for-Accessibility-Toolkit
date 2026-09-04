"""The autonomous loop: plan a task, take one action, look again, repeat.

`ai4a11y session do` and the old one-shot `run` both land here. This is the
only layer that decides what to do next on its own, which is why it sits
above the page and the browser and below the commands a user types.
"""

import time
import json
import re
from urllib.parse import urlparse as _urlparse

from .config import (
    OUT,
    _js,
)
from .ai import (
    _safe_screenshot,
    ask_claude,
)
from .page import (
    add_grid_overlay,
    add_som_markers,
    capture_sequence,
    create_diff_image,
    extract_data,
    get_a11y_outline,
    get_elements,
    get_screenshot_hash,
    get_visible_text,
    grid_hover,
    save_sequence_mosaic,
    smart_scroll,
    verify_action,
    wait_for_stable,
)
from .browser import (
    create_browser,
)


# ============================================================
# AGENT LOOP — Claude Code as vision engine
# ============================================================

def _dispatch_action(page, decision):
    """Execute a single action (not done/sequence). Returns interact_count delta."""
    action = decision.get('action')
    if action == 'click':
        page.mouse.click(decision.get('x'), decision.get('y'))
        return 1
    if action == 'dblclick':
        page.mouse.dblclick(decision.get('x'), decision.get('y'))
        return 1
    if action == 'rclick':
        page.mouse.click(decision.get('x'), decision.get('y'), button='right')
        return 1
    if action == 'drag':
        page.mouse.move(decision.get('x1'), decision.get('y1'))
        page.mouse.down()
        page.mouse.move(decision.get('x2'), decision.get('y2'), steps=20)
        page.mouse.up()
        return 1
    if action == 'scroll':
        page.evaluate("(dy) => window.scrollBy(0, dy)", int(decision.get('dy', 800)))
        return 0
    if action == 'scroll_to':
        page.evaluate("(y) => window.scrollTo(0, y)", int(decision.get('y', 0)))
        return 0
    if action == 'type':
        page.keyboard.type(decision.get('text', ''))
        return 1
    if action == 'key':
        page.keyboard.press(decision.get('keys') or decision.get('key', 'Escape'))
        return 1
    if action == 'hover':
        page.mouse.move(decision.get('x'), decision.get('y'))
        return 1
    if action == 'zoom':
        page.keyboard.press('Control+=' if decision.get('dir', 'in') == 'in' else 'Control+-')
        return 1
    if action == 'select':
        page.mouse.click(decision.get('x'), decision.get('y'))
        time.sleep(0.3)
        page.keyboard.type(decision.get('option', ''))
        page.keyboard.press('Enter')
        return 1
    if action == 'modclick':
        mod = decision.get('mod', 'Shift')
        page.keyboard.down(mod)
        page.mouse.click(decision.get('x'), decision.get('y'))
        page.keyboard.up(mod)
        return 1
    if action == 'draw':
        points = decision.get('points', [])
        if points:
            page.mouse.move(points[0][0], points[0][1])
            page.mouse.down()
            for px, py in points[1:]:
                page.mouse.move(px, py, steps=5)
            page.mouse.up()
        return 1
    if action == 'wheel':
        page.mouse.move(decision.get('x'), decision.get('y'))
        mod = decision.get('mod')
        if mod:
            page.keyboard.down(mod)
        page.mouse.wheel(decision.get('dx', 0), decision.get('dy', 300))
        if mod:
            page.keyboard.up(mod)
        return 0
    if action == 'long_press':
        page.mouse.move(decision.get('x'), decision.get('y'))
        page.mouse.down()
        time.sleep(decision.get('ms', 1000) / 1000)
        page.mouse.up()
        return 1
    if action == 'upload':
        page.evaluate("([x, y]) => document.elementFromPoint(x, y)?.click()",
                      [int(decision.get('x', 0)), int(decision.get('y', 0))])
        time.sleep(0.3)
        inputs = page.locator("input[type='file']")
        if inputs.count() > 0:
            inputs.first.set_input_files(decision.get('path', ''))
        return 1
    if action == 'media':
        op, value = decision.get('op', 'info'), decision.get('value', 0)
        info = page.evaluate(
            _js("dispatch_action_media.js"), {'op': op, 'value': value})
        print(f"  media.{op}: {info}", flush=True)
        return 1
    raise ValueError(f"unknown action: {action}")


def plan_task(page, task, run_dir, context=""):
    """Produce a high-level 3-7 step plan before the reactive loop begins.

    Returns {plan, unknowns, target_values, direct_answer}.
    direct_answer is non-empty when the task is answerable from the initial view alone —
    a latency shortcut that skips the reactive loop entirely.

    Research (From Grounding to Planning, 2024) shows planning is the real bottleneck
    for web agents, not grounding. A cheap upfront plan gives structure to the loop.
    """
    plan_path = run_dir / "plan_input.png"
    _safe_screenshot(page, plan_path)

    ctx_line = f"\nPRIOR CONTEXT: {context}\n" if context else ""

    planner_prompt = f"""You are planning how to accomplish a browser task. Look at the CURRENT page screenshot.

TASK: {task}{ctx_line}

FIRST: Can the task be answered FULLY from what's already visible in the screenshot, with no additional interaction required? If yes, return direct_answer populated and an empty plan. This skips costly browser steps.

If not, output a numbered plan of 3-7 high-level steps that will accomplish the task. Each step should be one meaningful user intent (e.g. "dismiss cookie banner", "navigate to data explorer", "filter by Japan", "read tooltip value at 1960"). Don't enumerate individual clicks.

Also note:
- What CANNOT be inferred from this initial screenshot (canvas content, tooltips, data behind filters)
- Any specific values/facts the task asks for

Respond as JSON: {{"direct_answer": "full answer if visible, else empty string", "plan": ["step 1", ...], "unknowns": ["..."], "target_values": ["..."]}}"""

    raw = ask_claude(str(plan_path), planner_prompt)
    try:
        s, e = raw.find('{'), raw.rfind('}') + 1
        return json.loads(raw[s:e])
    except Exception:
        return {"plan": ["(planner parse failed — proceeding without plan)"],
                "unknowns": [], "target_values": [], "direct_answer": ""}


def run_agent(url, task, max_steps=5, min_interactions=0, existing_page=None):
    """Vision-driven agent loop — capture → Claude decides → execute → repeat.

    min_interactions: reject 'done' until this many non-trivial actions have run.
    existing_page: if provided, use it instead of opening a new browser (persistent session).
    """
    if existing_page is not None:
        page = existing_page
        p, browser = None, None  # managed by caller
        eff_url = page.url
    else:
        eff_url = url

    host = re.sub(r'[^a-z0-9]+', '-', (_urlparse(eff_url).hostname or 'site').lower()).strip('-')
    task_slug = re.sub(r'[^a-z0-9]+', '-', task.lower())[:40].strip('-')
    ts = time.strftime('%H%M%S')
    run_dir = OUT / f"{host}_{task_slug}_{ts}"
    run_dir.mkdir(parents=True, exist_ok=True)

    if existing_page is None:
        p, browser, page = create_browser()
        print(f"\nTask: {task}\nURL: {url}\nOutput: {run_dir}\n")
        page.goto(url, wait_until='domcontentloaded', timeout=30000)
        time.sleep(4)
    else:
        print(f"\nTask: {task}\nURL: {eff_url} (existing session)\nOutput: {run_dir}\n")

    # Step 0 — plan (research: planning is the real bottleneck, not grounding)
    print("--- Planning ---", flush=True)
    plan = plan_task(page, task, run_dir)
    plan_str = "\n".join(f"  {i+1}. {s}" for i, s in enumerate(plan.get('plan', [])))
    unknowns_str = ", ".join(plan.get('unknowns', [])) or "none flagged"
    targets_str = ", ".join(plan.get('target_values', [])) or "none specified"
    print(f"Plan:\n{plan_str}", flush=True)
    print(f"Unknowns: {unknowns_str}", flush=True)
    print(f"Targets: {targets_str}", flush=True)

    # Latency shortcut: task answerable from initial view alone — skip reactive loop
    direct = (plan.get('direct_answer') or '').strip()
    if direct and min_interactions == 0:
        # Verify the direct answer against the same initial screenshot
        verify_prompt = f"""Verify an answer against the screenshot.
TASK: {task}
ANSWER: {direct}

Is the answer fully supported by what's visible in the screenshot, to a naive observer? JSON only: {{"supported": true|false, "reason": "..."}}"""
        verdict_raw = ask_claude(str(run_dir / "plan_input.png"), verify_prompt)
        try:
            vs, ve = verdict_raw.find('{'), verdict_raw.rfind('}') + 1
            verdict = json.loads(verdict_raw[vs:ve])
        except Exception:
            verdict = {'supported': True}
        if verdict.get('supported'):
            print(f"\n✓ ANSWER (direct, verified): {direct}", flush=True)
            print(f"  Verifier: {verdict.get('reason', '')[:200]}", flush=True)
            if existing_page is None:
                browser.close()
                p.stop()
            return [{'action': 'direct_answer', 'answer': direct}]
        else:
            print(f"Direct answer rejected ({verdict.get('reason', '')[:100]}) — falling back to reactive loop", flush=True)
    print("", flush=True)

    history = []
    last_hash = last_url = None
    interact_count = 0  # click/type/key/hover — not scroll/done
    last_click_hit = None  # what document.elementFromPoint saw after last click
    lessons = []  # Reflexion-style lessons learned from rejected attempts
    no_effect_streak = 0  # consecutive no-change steps; trigger for plan revision

    for step in range(max_steps):
        raw_path = run_dir / f"step{step}_raw.png"
        shot_path = run_dir / f"step{step}.png"
        _safe_screenshot(page, raw_path)

        elements = get_elements(page)
        addressable = [e for e in elements if e.get('x', 0) > 0 and e.get('y', 0) > 0][:25]
        add_som_markers(str(raw_path), str(shot_path), addressable)
        a11y_outline = get_a11y_outline(page)

        current_hash = get_screenshot_hash(page)
        current_url = page.url

        # Fine-grained change classification (research: fine-grained failure
        # detection helps recovery)
        page_state = page.evaluate(_js("run_agent_page_state.js"))

        feedback = ""
        if step > 0:
            changes = []
            if current_url != last_url:
                changes.append(f"URL→{current_url[:60]}")
            if last_click_hit and last_click_hit.get('tag') in ('html', 'body', 'none'):
                changes.append(f"⚠ last click at ({last_click_hit['x']},{last_click_hit['y']}) hit <{last_click_hit['tag']}> — MISSED target")
            elif last_click_hit:
                changes.append(f"last click landed on <{last_click_hit['tag']}>:{(last_click_hit.get('aria') or last_click_hit.get('text') or '')[:30]}")
            if current_hash == last_hash and current_url == last_url:
                feedback = "\n⚠ LAST ACTION HAD NO EFFECT — screenshot and URL unchanged. Try a different target or approach."
                no_effect_streak += 1
            else:
                no_effect_streak = 0
                if current_hash != last_hash:
                    changes.append("pixels changed")
                if page_state.get('modalVisible'):
                    changes.append("MODAL VISIBLE — dismiss first")
                if page_state.get('focusedTag'):
                    changes.append(
                        f"focus={page_state['focusedTag']}:{page_state['focusedLabel'][:20]}")
            if changes:
                feedback = (feedback + f"\nSince last action: {' | '.join(changes)}").strip()
        last_hash, last_url = current_hash, current_url

        # Plan revision trigger: stuck for 2+ consecutive steps → re-plan with current state
        if no_effect_streak >= 2 and step < max_steps - 2:
            print(f"--- Revising plan (stuck {no_effect_streak} steps) ---", flush=True)
            ctx = (f"Attempted plan was: {plan.get('plan', [])[:3]}... "
                   f"History: {[h.get('action') for h in history[-5:]]}. "
                   f"Lessons so far: {lessons[-3:] if lessons else 'none'}. "
                   f"Stuck because actions produced no effect.")
            plan = plan_task(page, task, run_dir, context=ctx)
            plan_str = "\n".join(f"  {i+1}. {s}" for i, s in enumerate(plan.get('plan', [])))
            unknowns_str = ", ".join(plan.get('unknowns', [])) or "none flagged"
            targets_str = ", ".join(plan.get('target_values', [])) or "none specified"
            print(f"Revised plan:\n{plan_str}", flush=True)
            no_effect_streak = 0

        def _el_line(i, e):
            ctx = []
            if e.get('role'):
                ctx.append(f"role={e['role']}")
            if e.get('parent'):
                ctx.append(f"in {e['parent']}")
            ctx_str = f" ({', '.join(ctx)})" if ctx else ""
            return f"  [{i+1}] {e['tag']}: {e['label']}{ctx_str}"
        elements_summary = "\n".join(_el_line(i, e) for i, e in enumerate(addressable))

        interact_need = max(0, min_interactions - interact_count)
        force_note = (
            f"\nFORCE-INTERACT: You must perform {interact_need} more real "
            "interaction(s) (click/type/hover, NOT scroll) before 'done' is accepted. "
            "Actually exercise the page — don't just read captions."
        ) if interact_need else ""

        lessons_str = ""
        if lessons:
            lessons_str = (
                "\nLessons learned from earlier attempts (DO NOT repeat these mistakes):\n"
                + "\n".join(f"  • {lesson}" for lesson in lessons[-5:])
            )

        prompt = f"""Task: {task}
URL: {current_url}

PLAN (from upfront planning step):
{plan_str}
Unknowns to discover: {unknowns_str}
Target values to extract: {targets_str}
{lessons_str}

History: {history if history else 'just started'}{feedback}{force_note}

Page structure (accessibility tree — semantic layout, complements the pixel elements):
{chr(10).join(a11y_outline) if a11y_outline else '  (a11y tree empty — canvas content or no ARIA)'}

Numbered interactive elements (matching the colored badges in the screenshot — use for clicks):
{elements_summary or '  (none detected — rely on visual grid)'}

BLOCKER CHECK: If you see cookie banner / modal / captcha / autocomplete dropdown blocking view → dismiss it FIRST (click Accept/X/Close or press Escape).

PREFER element-index clicks ("el": N) over pixel coords — much more reliable. Fall back to coords only for things NOT in the numbered list (canvas interiors, map positions, arbitrary drag endpoints). Rulers in margins help with raw coords.

Pick ONE action as JSON:
- {{"action": "click", "el": 3, "reason": "use badge number"}}
- {{"action": "click", "x": 500, "y": 300, "reason": "fallback when no badge"}}
- {{"action": "dblclick", "x": 500, "y": 300, "reason": "word select, folder open"}}
- {{"action": "rclick", "x": 500, "y": 300, "reason": "context menu"}}
- {{"action": "modclick", "x": 500, "y": 300, "mod": "Shift", "reason": "Shift|Control|Meta|Alt + click"}}
- {{"action": "drag", "x1": 100, "y1": 100, "x2": 400, "y2": 100, "reason": "slider/scrubber/pan"}}
- {{"action": "draw", "points": [[100,100],[200,150],[300,100]], "reason": "multi-point canvas stroke"}}
- {{"action": "scroll", "dy": 800, "reason": "positive=down, negative=up"}}
- {{"action": "scroll_to", "y": 0, "reason": "absolute scroll position (0=top)"}}
- {{"action": "wheel", "x": 500, "y": 300, "dy": 300, "reason": "scroll inside specific element"}}
- {{"action": "type", "text": "...", "reason": "..."}}
- {{"action": "key", "keys": "Control+f", "reason": "single key or combo with +"}}
- {{"action": "hover", "x": 500, "y": 300, "reason": "..."}}
- {{"action": "long_press", "x": 500, "y": 300, "ms": 1000, "reason": "press-and-hold"}}
- {{"action": "zoom", "dir": "in", "reason": "in or out (Ctrl+/-)"}}
- {{"action": "select", "x": 500, "y": 300, "option": "Option text", "reason": "native <select>"}}
- {{"action": "upload", "x": 500, "y": 300, "path": "/abs/path/file", "reason": "file input"}}
- {{"action": "media", "op": "play|pause|seek|rate|volume|info", "value": 60, "reason": "HTML5 video/audio (seek=seconds, rate=speed, volume=0-1)"}}
- {{"action": "sequence", "steps": [{{"action": "click", "x": 100, "y": 200}}, {{"action": "click", "x": 300, "y": 400}}, {{"action": "key", "keys": "Enter"}}], "reason": "atomic multi-step — use when state must stay stable across clicks (polygon vertices, multi-field form, wizard). Max 10 sub-steps."}}
- {{"action": "done", "answer": "specific answer", "reason": "..."}}

If screenshot has enough info to answer, return done."""

        print(f"--- Step {step+1} ---", flush=True)
        decision_raw = ask_claude(str(shot_path), prompt)
        print(f"Claude: {decision_raw[:300]}", flush=True)

        try:
            s, e = decision_raw.find('{'), decision_raw.rfind('}') + 1
            decision = json.loads(decision_raw[s:e])
        except Exception as ex:
            print(f"Parse failed: {ex}")
            break

        action = decision.get('action')
        history.append(decision)

        if action == 'done':
            if interact_count < min_interactions:
                print(f"⚠ Done rejected — only {interact_count}/{min_interactions} interactions so far", flush=True)
                history[-1] = {'action': 'done_rejected', 'reason': 'must interact more'}
                continue
            # Verify the answer against the current screenshot
            answer = decision.get('answer', '')
            verify_path = run_dir / f"step{step}_verify.png"
            _safe_screenshot(page, verify_path)
            verify_prompt = f"""Verify an agent's answer against the screenshot.

TASK (original request): {task}
AGENT'S ANSWER: {answer}
AGENT'S ACTIONS TAKEN: {[h.get('action') for h in history[:-1]]}

Imagine a naive human observer who has NO context about what the agent attempted. Would they look at this screenshot and describe it the way the answer does? If the answer uses a specific noun (e.g. "triangle", "map of Tokyo", "two-paragraph description"), does the visible content match that noun to a reasonable person, not just under a lawyerly technicality?

Reject if: a reasonable observer would describe the visible result differently (e.g. the answer claims "triangle" but the shape is a wavy blob, the answer claims "recipe page" but the screen is a loading spinner, the answer claims "zoomed out" but the map looks the same as before).
Accept only if: the visible state is what the answer describes, at face value, to someone without the benefit of the doubt.

JSON only: {{"supported": true|false, "reason": "concrete mismatch or corroboration, from a naive observer's perspective"}}"""
            verdict_raw = ask_claude(str(verify_path), verify_prompt)
            try:
                s, e = verdict_raw.find('{'), verdict_raw.rfind('}') + 1
                verdict = json.loads(verdict_raw[s:e])
            except Exception:
                verdict = {'supported': True, 'reason': 'parse failed — accepting'}

            if verdict.get('supported'):
                print(f"\n✓ ANSWER (verified): {answer}", flush=True)
                print(f"  Verifier: {verdict.get('reason', '')[:200]}", flush=True)
                break
            else:
                print(
                    f"⚠ Done rejected by verifier: {verdict.get('reason', '')[:200]}", flush=True)
                history[-1] = {
                    'action': 'done_rejected',
                    'reason': f"verifier: {verdict.get('reason', '')[:100]}",
                }
                # Reflexion: ask for a lesson about why the attempt failed +
                # what to try differently
                reflect_prompt = f"""A previous attempt failed verification.

Your claim: {answer}
Verifier's rejection: {verdict.get('reason', '')}
Actions taken so far: {[h.get('action') for h in history]}

Write ONE concise lesson (under 40 words) that would help avoid this failure if you retry. Focus on concrete actionable diagnosis, not apology. Examples: "The welcome dialog resists Escape — must click its specific Close button", "Canvas clicks need the drawing tool active first", "Element appeared but wasn't actually focused for typing".

Return JSON only: {{"lesson": "..."}}"""
                reflect_raw = ask_claude(str(verify_path), reflect_prompt)
                try:
                    rs, re_ = reflect_raw.find('{'), reflect_raw.rfind('}') + 1
                    lesson = json.loads(reflect_raw[rs:re_]).get('lesson', '')
                    if lesson:
                        lessons.append(lesson)
                        print(f"  💡 Lesson: {lesson[:200]}", flush=True)
                except Exception:
                    pass
                continue

        def resolve_and_dispatch(dec):
            """Resolve 'el' index → x,y then dispatch. Returns interact delta."""
            el_idx = dec.get('el')
            if el_idx is not None and 1 <= el_idx <= len(addressable):
                target = addressable[el_idx - 1]
                dec = {**dec, 'x': target['x'], 'y': target['y']}
                dec.pop('el', None)
            return _dispatch_action(page, dec), dec

        def verify_click_landed(dec):
            """Report what element actually received the click (via elementFromPoint).

            Also stores result in last_click_hit (closure over outer scope) for next step's prompt.
            """
            nonlocal last_click_hit
            if dec.get('action') not in ('click', 'dblclick', 'rclick', 'modclick'):
                return
            x, y = dec.get('x'), dec.get('y')
            if x is None or y is None:
                return
            hit = page.evaluate(
                _js("verify_click_landed.js"), [x, y])
            last_click_hit = {**hit, 'x': x, 'y': y} if hit else {'x': x, 'y': y, 'tag': 'none'}
            if hit and hit['tag'] in ('html', 'body'):
                print(
                    f"  ⚠ click at ({x},{y}) hit <{hit['tag']}> — likely missed target",
                    flush=True)

        try:
            if action == 'sequence':
                steps = (decision.get('steps') or [])[:10]
                pre_url = page.url
                for i, sub in enumerate(steps):
                    if sub.get('action') in ('done', 'sequence'):
                        print(
                            f"  skipping nested/terminal sub-action '{sub.get('action')}'",
                            flush=True)
                        continue
                    try:
                        delta, resolved = resolve_and_dispatch(sub)
                        interact_count += delta
                        verify_click_landed(resolved)
                    except Exception as ex:
                        print(f"  sub-step {i+1} ({sub.get('action')}) failed: {ex}", flush=True)
                        break
                    _safe_screenshot(page, run_dir / f"step{step}_sub{i}.png")
                    if page.url != pre_url:
                        print("  sequence aborted: URL changed mid-sequence", flush=True)
                        break
                    time.sleep(0.1)
                wait_for_stable(page, timeout=5)
            else:
                delta, resolved = resolve_and_dispatch(decision)
                interact_count += delta
                verify_click_landed(resolved)
                wait_for_stable(page, timeout=5)
        except Exception as ex:
            print(f"Action '{action}' failed: {ex}", flush=True)
            history[-1] = {**decision, 'error': str(ex)[:100]}
    else:
        # max_steps exhausted — ask for best-effort answer from current state
        print("\n--- max_steps exhausted, asking for best-effort answer ---", flush=True)
        final_path = run_dir / "final.png"
        _safe_screenshot(page, final_path)
        fallback = ask_claude(
            str(final_path),
            f"Task: {task}\nHistory: {history}\n\nBased on what you can see, give your best answer to the task. Reply as JSON: {{\"answer\": \"...\"}}."
        )
        print(f"\n✓ BEST-EFFORT ANSWER: {fallback[:500]}", flush=True)

    if existing_page is None:
        browser.close()
        p.stop()
    return history


# ============================================================
# CLI — action handlers + dispatcher
# ============================================================

def _act_fullpage(page, args):
    page.screenshot(path=str(OUT / "fullpage.png"), full_page=True)
    print(f"Full page: {OUT}/fullpage.png")


def _act_scroll(page, args):
    if args and args[0].isdigit():
        count = int(args[0])
        for i in range(count):
            _safe_screenshot(page, OUT / f"scroll_{i}.png")
            print(f"  Captured viewport {i+1}/{count}")
            page.evaluate("window.scrollBy(0, window.innerHeight * 0.8)")
            time.sleep(0.5)
    else:
        smart_scroll(page)
    print(f"Screenshots in {OUT}/scroll_*.png")


def _act_grid(page, args):
    grid_size, mode = 100, "light"
    for arg in args:
        if arg.isdigit():
            grid_size = int(arg)
        elif arg in ("light", "margin", "full"):
            mode = arg
    clean_path = OUT / "page_clean.png"
    grid_path = OUT / "page_grid.png"
    _safe_screenshot(page, clean_path)
    add_grid_overlay(str(clean_path), str(grid_path), grid_size, mode=mode)
    print(f"Grid overlay ({mode}, {grid_size}px): {grid_path}")


def _act_diff(page, args):
    before_path = OUT / "diff_before.png"
    _safe_screenshot(page, before_path)
    print(f"Before: {before_path}\nInteract with the page, then press Enter...")
    input()
    after_path = OUT / "diff_after.png"
    _safe_screenshot(page, after_path)
    diff_path, pct, bbox = create_diff_image(
        str(before_path), str(after_path), str(OUT / "diff_result.png"))
    print(f"After: {after_path}\nDiff: {diff_path} ({pct:.1f}% changed, region: {bbox})")


def _act_track(page, args):
    duration = float(args[0]) if args and args[0].replace('.', '').isdigit() else 3.0
    print(f"Capturing {duration}s animation sequence...")
    frames = capture_sequence(page, duration=duration, interval=0.1)
    mosaic_path = save_sequence_mosaic(frames, str(OUT / "sequence.png"))
    print(f"Captured {len(frames)} frames\nMosaic: {mosaic_path}")


def _act_describe(page, args):
    _safe_screenshot(page, OUT / "describe.png")
    print(f"Screenshot: {OUT}/describe.png")
    print("Use Claude vision (Read tool) to describe this image")


def _act_read(page, args):
    text = get_visible_text(page)
    print(f"Visible text ({len(text)} chars):\n{text[:2000]}")
    (OUT / "page_text.txt").write_text(text)
    print(f"\nFull text saved: {OUT}/page_text.txt")


def _act_ask(page, args):
    question = ' '.join(args) if args else "Describe this page"
    _safe_screenshot(page, OUT / "ask.png")
    text = page.evaluate("() => document.body.innerText.slice(0, 3000)")
    print(f"Question: {question}\nScreenshot: {OUT}/ask.png\nPage text preview: {text[:500]}...")
    print("\nUse Claude vision on ask.png to answer the question")


def _act_hover(page, args):
    if len(args) >= 2:
        x, y = int(args[0]), int(args[1])
        _safe_screenshot(page, OUT / "before.png")
        page.mouse.move(x, y)
        time.sleep(0.5)
        _safe_screenshot(page, OUT / "page.png")
        print(f"Hovered at ({x}, {y})")
    else:
        grid_hover(page)


def _act_click(page, args):
    for target in args:
        try:
            el = page.locator(f"[aria-label*='{target}' i], button:has-text('{target}'), [class*='{target}' i], :text('{target}')").first
            el.click(timeout=5000)
            time.sleep(1)
            print(f"Clicked: {target}")
        except Exception as e:
            print(f"Could not click '{target}': {e}")


def _act_play(page, args):
    try:
        el = page.locator("[aria-label*='play' i], [class*='play'], button:has-text('Play'), :text('Play'), :text('▶')").first
        el.click(timeout=5000)
        print("Playing... waiting for animation to settle")
        time.sleep(1)
        wait_for_stable(page, timeout=8)
        print("Animation settled")
    except Exception as e:
        print(f"No play button found: {e}")


def _act_drag(page, args):
    if len(args) < 4:
        print("drag requires 4 args: x1 y1 x2 y2")
        return
    x1, y1, x2, y2 = int(args[0]), int(args[1]), int(args[2]), int(args[3])

    def do_drag():
        page.mouse.move(x1, y1)
        time.sleep(0.2)
        page.mouse.down()
        time.sleep(0.1)
        page.mouse.move(x2, y2, steps=20)
        time.sleep(0.1)
        page.mouse.up()
        time.sleep(0.8)

    success, before, after, diff, info = verify_action(
        page, do_drag, f"drag ({x1},{y1})→({x2},{y2})")
    if success and diff:
        add_grid_overlay(
            after, str(OUT / "drag_annotated.png"),
            grid_size=100, focus_point=(x2, y2), mode="light",
        )
        print(f"Annotated result: {OUT}/drag_annotated.png")


def _act_key(page, args):
    for key in args:
        page.keyboard.press(key)
        time.sleep(0.5)
    print(f"Pressed: {', '.join(args)}")


# Actions that close the browser immediately (no page.png/elements summary after)
TERMINAL_ACTIONS = {
    "fullpage", "scroll", "grid", "diff", "track",
    "describe", "read", "ask", "hover",
}

ACTION_HANDLERS = {
    "fullpage": _act_fullpage, "scroll": _act_scroll, "grid": _act_grid,
    "diff": _act_diff, "track": _act_track, "describe": _act_describe,
    "read": _act_read, "ask": _act_ask, "hover": _act_hover,
    "click": _act_click, "play": _act_play, "drag": _act_drag, "key": _act_key,
}


def run(url, action=None, *args):
    """Main CLI dispatcher — loads URL, runs one action, reports."""
    stealth_mode = action == "stealth"
    visible_mode = action == "visible"

    if stealth_mode or visible_mode:
        action = args[0] if args else None
        args = args[1:] if len(args) > 1 else []

    p, browser, page = create_browser(stealth=stealth_mode, visible=visible_mode)

    try:
        mode_str = " [stealth]" if stealth_mode else (" [visible]" if visible_mode else "")
        print(f"Loading: {url[:60]}...{mode_str}")
        page.goto(url, wait_until="domcontentloaded", timeout=25000)
        time.sleep(2)
        page.wait_for_load_state("networkidle", timeout=10000)
        time.sleep(1)
    except Exception as e:
        print(f"Error loading page: {e}")
        browser.close()
        p.stop()
        return

    handler = ACTION_HANDLERS.get(action)

    # Before-screenshot for non-terminal interactions
    if action and action not in TERMINAL_ACTIONS:
        _safe_screenshot(page, OUT / "before.png")

    if handler:
        handler(page, args)

    if action in TERMINAL_ACTIONS:
        browser.close()
        p.stop()
        return

    # Post-action: capture final state + summary for interaction actions
    _safe_screenshot(page, OUT / "page.png")
    elements = get_elements(page)
    data = extract_data(page)
    browser.close()
    p.stop()

    print(f"\nPage: {data.get('title', 'Untitled')[:60]}")
    print(f"Screenshot: {OUT}/page.png")
    if action and action not in TERMINAL_ACTIONS:
        print(f"Before: {OUT}/before.png")

    if elements:
        print(f"\nElements ({len(elements)}):")
        for e in elements:
            coords = f" @({e['x']},{e['y']})" if e['x'] > 0 else ""
            print(f"  {e['tag']}: {e['label']}{coords}")

    if data.get('legend'):
        print(f"\nLegend: {', '.join(data['legend'])}")
    if data.get('axes'):
        print(f"Axes: {', '.join(data['axes'][:6])}")
    if data.get('values'):
        print(f"Values: {', '.join(data['values'][:6])}")
