#!/usr/bin/env python3
"""The `ai4a11y session` commands, and the auditor and fix-pass specs.

Top layer of the engine package. Everything here is a command a user can
reach from `cli.py`, or a specification that configures the generic fix
engine in `ai.py`. Nothing in the lower layers imports from this module.
"""

from playwright.sync_api import sync_playwright
import sys
import time
import hashlib
import json
from contextlib import ExitStack
from pathlib import Path
from html import escape as html_escape
from urllib.parse import urlparse as _urlparse

import os as _os

from .config import (
    AI_UNAVAILABLE_EXIT,
    NEEDS_AI_LINE,
    OUT,
    SESSION_DIR,
    SESSION_FILE,
    _IRIS_VISION_MODEL,
    _get_active_profile,
    _get_axe_script,
    _js,
    _set_active_profile,
    emit,
    quiet,
)
from .ai import (
    FixPass,
    FixProgress,
    _ai_exit_status,
    _ai_fix_report,
    _print_fix_result,
    _safe_screenshot,
    ask_claude,
    ask_claude_text,
    claude_answer,
    run_fix_pass,
)
from .page import (
    _expose_ai_callbacks,
    _inject_cli_tools,
    _publish_active_profile,
    _withdraw_active_profile,
    add_som_markers,
    create_diff_image,
    describe_state_diff,
    get_a11y_outline,
    get_elements,
    get_interactables_full,
    get_page_context,
    get_screenshot_hash,
    get_visible_text,
    state_snapshot,
    wait_for_stable,
)
from .browser import (
    NoSession,
    _find_page_by_target_id,
    _pick_focused_page,
    _read_last_tab,
    _read_session,
    _write_last_tab,
    connected_page,
)
from .agent import (
    run_agent,
)


def _auditor_items(auditor, *keys):
    """An `items` callable for a pass whose list comes from one of the auditors.

    `auditor` is the same short key `run_auditor` and the `session_find_*`
    commands use (`'alt'`, `'labels'`, ...), not the JS function name, so
    there is one place that spells the JS name for a given auditor.

    The lists named by `keys` are concatenated in the order given, which is the
    order the commands have always reported them in.
    """
    def items(page):
        result = run_auditor(page, auditor)
        found = []
        for key in keys:
            found.extend(result.get(key, []))
        return found
    return items


def session_tabs():
    """List every tab across every context. Marks the focused tab with '→'.
    BLV users don't have to eyeball the tab strip — ai4a11y reads it aloud instead.
    """
    if not SESSION_FILE.exists():
        print("No session running.", flush=True)
        return
    info = _read_session()
    p = sync_playwright().start()
    try:
        browser = p.chromium.connect_over_cdp(info['cdp'])
        all_pages = [pg for c in browser.contexts for pg in c.pages]
        if not all_pages:
            print("(no open tabs)", flush=True)
            return
        # Pick the single tab ai4a11y would operate on — same logic as session_connect
        # so the display matches reality. No more multiple-→ when multiple windows
        # each have a "visible" tab.
        picked = _pick_focused_page(all_pages)
        rows = []
        for i, pg in enumerate(all_pages):
            title, url = '(unreachable)', ''
            try:
                title = (pg.title() or '').strip()[:60]
                url = (pg.url or '').strip()[:80]
            except Exception:
                try:
                    url = (pg.url or '').strip()[:80]
                except Exception:
                    pass
            rows.append((i + 1, pg is picked, title, url))
        for idx, is_picked, title, url in rows:
            marker = '→' if is_picked else ' '
            print(f" {marker} [{idx}] {title or '(untitled)'}   {url}", flush=True)
        print(f"({len(rows)} tab{'s' if len(rows) != 1 else ''}; → = the tab ai4a11y will operate on)", flush=True)
        try:
            browser.close()
        except Exception:
            pass
    finally:
        p.stop()


def session_focus_tab(n):
    """Pin ai4a11y's sticky tab to the N-th entry from `session tabs` (1-indexed).

    Essential when the browser has accumulated multiple tabs and ai4a11y's heuristic
    picks the wrong one. Writes targetId to ~/.ai4a11y/last_tab.json so every
    subsequent ai4a11y call operates on this tab until the user navigates away.
    """
    if not SESSION_FILE.exists():
        print("No session running.", flush=True)
        return
    info = _read_session()
    p = sync_playwright().start()
    try:
        browser = p.chromium.connect_over_cdp(info['cdp'])
        all_pages = [pg for c in browser.contexts for pg in c.pages]
        if not all_pages:
            print("(no open tabs)", flush=True)
            return
        if n < 1 or n > len(all_pages):
            print(f"invalid tab number {n}; have {len(all_pages)} tabs", flush=True)
            return
        pg = all_pages[n - 1]
        _write_last_tab(pg)
        try:
            title = pg.title()[:60]
            url = pg.url[:80]
        except Exception:
            title, url = '(unreachable)', ''
        print(f"Focus locked on tab [{n}]: {title}   {url}", flush=True)
        try:
            browser.close()
        except Exception:
            pass
    finally:
        p.stop()


def session_cleanup_tabs():
    """Close all tabs except ai4a11y's sticky one. Clears accumulated orphans from
    long-running sessions (e.g. after crashes, restore-on-launch, or multi-test
    runs that left zombie tabs behind)."""
    if not SESSION_FILE.exists():
        print("No session running.", flush=True)
        return
    info = _read_session()
    p = sync_playwright().start()
    try:
        browser = p.chromium.connect_over_cdp(info['cdp'])
        all_pages = [pg for c in browser.contexts for pg in c.pages]
        if not all_pages:
            print("(no open tabs)", flush=True)
            return
        keep = None
        last = _read_last_tab()
        if last and last.get('target_id'):
            keep = _find_page_by_target_id(all_pages, last['target_id'])
        if keep is None:
            keep = _pick_focused_page(all_pages)
        if keep is None:
            keep = all_pages[-1]
        closed = 0
        for pg in all_pages:
            if pg is keep:
                continue
            try:
                pg.close()
                closed += 1
            except Exception:
                pass
        try:
            kept_title = keep.title()[:60]
            kept_url = keep.url[:80]
        except Exception:
            kept_title, kept_url = '(unknown)', ''
        _write_last_tab(keep)
        print(f"Closed {closed} tab(s). Kept: {kept_title}   {kept_url}", flush=True)
        try:
            browser.close()
        except Exception:
            pass
    finally:
        p.stop()


def session_go(url):
    """Navigate the persistent browser to a URL.

    If a profile is active, tools are auto-injected and profile auto-applied
    after navigation — works like the extension.
    """
    with connected_page() as page:
        page.goto(url, wait_until='domcontentloaded', timeout=30000)
        time.sleep(1)

        # Auto-inject tools and apply saved profile (instant, like extension)
        active_profile = _get_active_profile()
        if active_profile:
            _expose_ai_callbacks(page)
            if _inject_cli_tools(page, auto_apply_profile=True):
                print(f"Navigated to {page.url}", flush=True)
                print(f"Title: {page.title()[:80]}", flush=True)
                print(f"Profile: {active_profile} (auto-applied)", flush=True)
            else:
                print(f"Navigated to {page.url}", flush=True)
                print(f"Title: {page.title()[:80]}", flush=True)
        else:
            print(f"Navigated to {page.url}", flush=True)
            print(f"Title: {page.title()[:80]}", flush=True)


def session_back():
    """Browser back."""
    with connected_page() as page:
        page.go_back(wait_until='domcontentloaded', timeout=15000)
        time.sleep(1)
        print(f"Back → {page.url}", flush=True)


def session_scroll(direction='down', amount=800):
    """Scroll the persistent page."""
    with connected_page() as page:
        dy = amount if direction in ('down', 'd') else -amount
        page.evaluate("(dy) => window.scrollBy(0, dy)", int(dy))
        time.sleep(0.5)
        pos = page.evaluate("window.scrollY")
        print(f"Scrolled {direction} → y={pos}", flush=True)


def session_describe(json_output=False):
    """Fast-path describe of current page for BLV user. One Claude call, no loop."""
    # connected_page() is entered through ExitStack rather than a bare `with`, so
    # this except guards only the connect attempt, same as before. A plain `with`
    # would put the whole body inside the try, and a failure unrelated to the
    # connection (a bad screenshot, a Claude call) would be misreported as
    # "No browser session".
    with ExitStack() as stack:
        try:
            page = stack.enter_context(connected_page())
        except Exception as e:
            emit({"error": f"No browser session: {e}"},
                 lambda: print("Error: No browser session. Run 'ai4a11y session start' first."),
                 json_output)
            sys.exit(1)
        run_dir = OUT / f"session_describe_{_os.getpid()}_{int(time.time())}"
        run_dir.mkdir(parents=True, exist_ok=True)
        shot = run_dir / "describe.png"
        _safe_screenshot(page, shot)

        outline = get_a11y_outline(page)
        elements = get_elements(page)
        addressable = [e for e in elements if e.get('x', 0) > 0][:15]
        el_summary = "\n".join(
            f"  [{i+1}] {e['tag']}: {e['label']}" for i, e in enumerate(addressable))

        ctx = get_page_context(page, text_limit=4000)
        prompt = f"""Describe this page for a BLV (blind/low-vision) user in 3-6 sentences. Be honest and specific. Use the page text + accessibility tree (most reliable) plus the screenshot (for visual layout).

URL: {page.url}
Title: {page.title()[:100]}

Page structure (accessibility tree):
{chr(10).join(outline[:20])}

Page text (first 4000 chars):
{ctx['text']}

Top interactive elements:
{el_summary or '(none detected)'}

Cover: (1) what kind of page this is, (2) main content summary, (3) 2-3 useful interactions available.
Skip decorative elements. If it's a modal/captcha/blocker, say so first."""

        result = ask_claude(str(shot), prompt)

        emit({
            "url": page.url,
            "title": page.title(),
            "description": result,
            "elements": addressable,
            "screenshot": str(shot)
        }, lambda: print(result, flush=True), json_output)


def _focused_info(page):
    """Return role/name/state of the currently focused element, for announce-style output."""
    return page.evaluate(_js("focused_info.js"))


def _announce(info):
    if info.get('none'):
        return "No element currently focused (focus is on document body)"
    parts = []
    role = info.get('role') or info.get('tag', '')
    name = info.get('name', '').strip()
    parts.append(f"{role}" + (f": {name}" if name else ""))
    if info.get('type') and info['type'] != role:
        parts.append(f"type={info['type']}")
    if info.get('value') is not None and info['value'] != '':
        parts.append(f"value={info['value']}")
    if info.get('checked') is True:
        parts.append("checked")
    if info.get('disabled'):
        parts.append("disabled")
    return ", ".join(parts)


def session_tab(direction='forward'):
    """Press Tab (or Shift+Tab), report newly focused element. Zero Claude calls."""
    with connected_page() as page:
        page.keyboard.press('Shift+Tab' if direction == 'back' else 'Tab')
        time.sleep(0.15)
        print(_announce(_focused_info(page)), flush=True)


def session_activate():
    """Press Enter on focused element (activate link/button, submit form). Zero Claude calls."""
    with connected_page() as page:
        page.keyboard.press('Enter')
        time.sleep(0.3)
        print(f"Activated. URL: {page.url}", flush=True)
        focused = _focused_info(page)
        if not focused.get('none'):
            print(f"Now focused: {_announce(focused)}", flush=True)


def session_key(keys: str, count: int = 1):
    """Send keyboard input to the focused element. Zero Claude calls.

    Supports:
      - Single keys: ArrowRight, ArrowLeft, ArrowUp, ArrowDown, Space, Enter, Escape, Home, End, PageUp, PageDown
      - Modifiers: Shift+Tab, Control+a, Alt+F4
      - Multiple presses: session_key("ArrowRight", 5) presses right arrow 5 times

    Examples:
      session_key("ArrowRight")      # one right arrow
      session_key("ArrowRight", 10)  # ten right arrows (increase slider)
      session_key("Space")           # toggle/activate
      session_key("Escape")          # close dialog
    """
    with connected_page() as page:
        # Normalize common aliases
        key_map = {
            'right': 'ArrowRight', 'left': 'ArrowLeft', 'up': 'ArrowUp', 'down': 'ArrowDown',
            'space': 'Space', 'enter': 'Enter', 'esc': 'Escape', 'escape': 'Escape',
            'home': 'Home', 'end': 'End', 'pageup': 'PageUp', 'pagedown': 'PageDown',
            'pgup': 'PageUp', 'pgdn': 'PageDown', 'pgdown': 'PageDown',
        }
        normalized = key_map.get(keys.lower(), keys)

        for _ in range(count):
            page.keyboard.press(normalized)
            time.sleep(0.05)  # Small delay between presses

        time.sleep(0.2)  # Wait for UI to update
        focused = _focused_info(page)

        if count > 1:
            print(f"Pressed {normalized} x{count}", flush=True)
        else:
            print(f"Pressed {normalized}", flush=True)

        if not focused.get('none'):
            print(f"Focused: {_announce(focused)}", flush=True)


def session_arrow(direction: str, count: int = 1):
    """Arrow key presses. Zero Claude calls.

    Kept as its own command name because it reads better in a session
    transcript than `session key ArrowRight`. It had its own copy of the
    right/left/up/down map, and `session_key` already normalizes those four
    names, so it forwards the direction rather than translating it first.

    Examples:
      session_arrow("right", 5)   # increase slider 5 steps
      session_arrow("left", 3)    # decrease slider 3 steps
      session_arrow("down")       # move down in menu
    """
    return session_key(direction, count)


def session_list(kind='focusables'):
    """Print a list of elements by kind (focusables, headings, links, buttons, forms).
    Pure DOM extraction, zero Claude calls, instant. Mirrors screen-reader rotor/elements-list.
    """
    with connected_page() as page:
        kind = kind.lower()
        if kind in ('heading', 'headings', 'h'):
            rows = page.evaluate(_js("session_list_headings.js"))
            for r in rows[:50]:
                print(f"  H{r['level']}: {r['text']}")
            print(f"({len(rows)} headings)" if rows else "(no headings)", flush=True)
        elif kind in ('link', 'links', 'l', 'k'):
            rows = page.evaluate(_js("session_list_links.js"))
            for r in rows[:50]:
                print(f"  {r['text']}")
            print(f"({len(rows)} links)" if rows else "(no links)", flush=True)
        elif kind in ('button', 'buttons', 'b'):
            rows = page.evaluate(_js("session_list_buttons.js"))
            for r in rows[:50]:
                print(f"  {r['text']}{' (disabled)' if r['disabled'] else ''}")
            print(f"({len(rows)} buttons)" if rows else "(no buttons)", flush=True)
        elif kind in ('form', 'forms', 'fields', 'f'):
            rows = page.evaluate(_js("session_list_forms.js"))
            for r in rows[:50]:
                req = ' *required*' if r['required'] else ''
                val = f' = {r["value"]}' if r['value'] else ''
                print(f"  [{r['type']}] {r['label']}{val}{req}")
            print(f"({len(rows)} form fields)" if rows else "(no form fields)", flush=True)
        elif kind in ('image', 'images', 'img', 'g'):
            rows = page.evaluate(_js("session_list_images.js"))
            for r in rows[:80]:
                label = r['alt'] or f"(no alt) {r['src'].split('/')[-1][:40]}"
                print(f"  [{r['w']}×{r['h']} @y={r['y']}] {label}")
            print(f"({len(rows)} images)" if rows else "(no images)", flush=True)
        elif kind in ('landmark', 'landmarks', 'region', 'regions', 'r'):
            rows = page.evaluate(_js("session_list_landmarks.js"))
            for r in rows[:30]:
                print(f"  {r['role']}" + (f": {r['label']}" if r['label'] else ""))
            print(f"({len(rows)} landmarks)" if rows else "(no landmarks)", flush=True)
        else:  # focusables
            rows = page.evaluate(_js("session_list_focusables.js"))
            for r in rows[:80]:
                role = r['role'] or r['tag']
                print(f"  [{role}] {r['name']}")
            print(f"({len(rows)} focusable)" if rows else "(no focusables)", flush=True)


def session_find(text):
    """Find text on the page — body text AND element attributes (alt, aria-label, title, placeholder).
    Broader than Ctrl+F: also surfaces unlabeled-in-body items like images with matching alt text.
    Zero Claude calls.
    """
    with connected_page() as page:
        hits = page.evaluate(_js("session_find.js"), text)

        if not hits:
            print(f"Not found: '{text}'", flush=True)
            return

        text_hits = [h for h in hits if h.get('kind') == 'text']
        attr_hits = [h for h in hits if h.get('kind') == 'attr']

        if text_hits:
            print(f"Text matches for '{text}' ({len(text_hits)}):", flush=True)
            for i, m in enumerate(text_hits[:20], 1):
                print(f"  {i}. …{m['snippet']}…")
        if attr_hits:
            print(f"\nElement attribute matches ({len(attr_hits)}):", flush=True)
            for h in attr_hits[:20]:
                print(f"  <{h['tag']} {h['attr']}=\"{h['value']}\"> @y={h['y']}")


def session_read(selector=None):
    """Extract the main article text (Readability-style). One pure DOM call, zero Claude.

    Good for 'read me this article' — skips nav, ads, footers, sidebars. Falls back to
    full body text if no article-like container found.
    """
    with connected_page() as page:
        text = page.evaluate(_js("session_read.js"), selector)

        if not text:
            print("(no article text found)", flush=True)
            return
        # Cap the printed output so terminal doesn't flood; full text still extracted
        LIMIT = 15000
        if len(text) > LIMIT:
            print(text[:LIMIT], flush=True)
            print(f"\n... [truncated, {len(text) - LIMIT} more chars]", flush=True)
        else:
            print(text, flush=True)
        print(f"\n({len(text)} chars)", flush=True)


def session_list_tables(max_tables=5):
    """Extract tabular data from the page (instant, zero Claude)."""
    with connected_page() as page:
        tables = page.evaluate(f"""
            () => {{
                const out = [];
                document.querySelectorAll('table').forEach((t, i) => {{
                    if (i >= {max_tables}) return;
                    const rows = [];
                    t.querySelectorAll('tr').forEach(tr => {{
                        const cells = [...tr.querySelectorAll('th, td')]
                            .map(c => (c.textContent || '').trim().replace(/\\s+/g, ' '));
                        if (cells.length) rows.push(cells);
                    }});
                    if (rows.length) {{
                        const caption = t.caption?.textContent?.trim() || t.getAttribute('aria-label') || '';
                        out.push({{caption, rows: rows.slice(0, 50)}});
                    }}
                }});
                return out;
            }}
        """)
        if not tables:
            print("(no tables found)", flush=True)
            return
        for i, t in enumerate(tables, 1):
            cap = f": {t['caption']}" if t['caption'] else ''
            print(f"\nTable {i}{cap} ({len(t['rows'])} rows)")
            for row in t['rows']:
                print("  " + " | ".join(c[:40] for c in row))
        print(f"\n({len(tables)} tables)", flush=True)


def session_audit(severity_filter=None, json_output=False):
    """Run WCAG accessibility audit on the current page using axe-core.

    Reports issues grouped by severity (critical, serious, moderate, minor).
    No Claude call — instant DOM-based analysis.

    Args:
        severity_filter: Optional - only show issues of this severity
                        (critical, serious, moderate, minor)
        json_output: If True, output JSON instead of formatted text
    """
    valid_severities = {'critical', 'serious', 'moderate', 'minor'}
    if severity_filter and severity_filter not in valid_severities:
        emit({"error": f"Invalid severity '{severity_filter}'",
              "valid": list(valid_severities)},
             lambda: print(f"Invalid severity '{severity_filter}'. "
                           f"Use: {', '.join(sorted(valid_severities))}"),
             json_output)
        sys.exit(1)

    # connected_page() is entered through ExitStack rather than a bare `with`, so
    # this except guards only the connect attempt, same as before. A plain `with`
    # would put the whole body inside the try, and an audit failure unrelated
    # to the connection would be misreported as "No browser session".
    with ExitStack() as stack:
        try:
            page = stack.enter_context(connected_page())
        except Exception as e:
            emit({"error": f"No browser session: {e}"},
                 lambda: print("Error: No browser session. Run 'ai4a11y session start' first."),
                 json_output)
            sys.exit(1)
        # Inject axe-core
        page.add_script_tag(content=_get_axe_script())
        page.wait_for_function("typeof axe !== 'undefined'", timeout=5000)

        # Run axe
        results = page.evaluate(_js("session_audit.js"))

        violations = results['violations']
        if severity_filter:
            violations = [v for v in violations if v['impact'] == severity_filter]

        # Group by severity
        by_severity = {'critical': [], 'serious': [], 'moderate': [], 'minor': []}
        for v in violations:
            impact = v.get('impact', 'minor') or 'minor'
            if impact in by_severity:
                by_severity[impact].append(v)

        def render():
            total = len(violations)
            print(f"\nAccessibility Audit: {results['url'][:60]}")
            print(f"{'─' * 60}")

            if total == 0:
                print("No violations found.")
                print(f"\n{results['passes']} rules passed, {results['incomplete']} need review")
                return

            # Print by severity
            severity_order = ['critical', 'serious', 'moderate', 'minor']
            severity_icons = {
                'critical': '[!!]', 'serious': '[!]',
                'moderate': '[~]', 'minor': '[.]',
            }

            for sev in severity_order:
                issues = by_severity[sev]
                if not issues:
                    continue
                print(f"\n{severity_icons[sev]} {sev.upper()} ({len(issues)})")
                for v in issues[:5]:  # Limit to 5 per severity
                    print(f"  - {v['help']} ({v['nodes']} elements)")
                    print(f"    {v['description'][:70]}...")
                if len(issues) > 5:
                    print(f"  ... and {len(issues) - 5} more")

            print(f"\n{'─' * 60}")
            print(f"Total: {total} violations | {results['passes']} passed | {results['incomplete']} need review")

        emit({
            "url": results['url'],
            "violations": violations,
            "by_severity": {k: v for k, v in by_severity.items() if v},
            "summary": {
                "total_violations": len(violations),
                "passes": results['passes'],
                "incomplete": results['incomplete']
            }
        }, render, json_output)


def session_ask(question):
    """One-shot Q&A about the current page — no interaction, just see + answer.

    For BLV users driving the agent: they ask a specific visual question about what's on
    screen ('what's the mass value?', 'is the block submerged?'), ai4a11y captures + answers.
    One Claude call, ~20s.
    """
    with connected_page() as page:
        run_dir = OUT / f"session_ask_{_os.getpid()}_{int(time.time())}"
        run_dir.mkdir(parents=True, exist_ok=True)
        shot = run_dir / "ask.png"
        _safe_screenshot(page, shot)
        outline = get_a11y_outline(page)
        ctx = get_page_context(page, text_limit=8000)
        tables_str = "\n\n".join(ctx['tables']) if ctx['tables'] else ""
        prompt = f"""Answer concisely using the most reliable source available:
  1. Structured tables (infobox, etc.) — use these first for factual values
  2. Full page text content — reliable for any text-based facts
  3. Screenshot — for visual details (colors, layout, positions)
  4. Accessibility outline — for page structure

Don't speculate. If the answer isn't in ANY of these, say so.

URL: {page.url}
Question: {question}

Structured tables (if any):
{tables_str or '(none found)'}

Full page text ({len(ctx['text'])} chars):
{ctx['text']}

Accessibility outline:
{chr(10).join(outline[:15])}"""
        print(ask_claude(str(shot), prompt), flush=True)


def session_nudge(target, direction='right', count=5):
    """Increment/decrement a canvas slider by repeatedly clicking its arrow button.

    Handles the "PhET slider problem": Playwright's synthetic pointer-drag doesn't
    trigger continuous value changes on canvas-rendered sliders (PhET Scenery,
    custom Konva/Pixi widgets), but the arrow buttons flanking the track DO
    respond to click events and advance the value by one tick each.

    Flow:
      1. Vision call: locate the arrow button for the given slider + direction.
      2. Click at those coords `count` times with small delays.
      3. One verification screenshot after, diffing before/after.

    Example:
      session_nudge("block A mass slider", "right", 10)

    Note: for sliders that are density-locked to a preset material (e.g. PhET's
    Mass slider while material=Wood), the arrow button is a no-op until the
    user selects a Custom/unlocked material. ai4a11y reports this honestly via
    the before/after diff.
    """
    with connected_page() as page:
        before_hash = get_screenshot_hash(page)
        run_dir = OUT / f"session_nudge_{_os.getpid()}_{int(time.time())}"
        run_dir.mkdir(parents=True, exist_ok=True)
        shot = run_dir / "nudge.png"
        if not _safe_screenshot(page, shot):
            print("Can't nudge: screenshot failed", flush=True)
            return

        real = page.evaluate("({w: window.innerWidth, h: window.innerHeight})")
        vw, vh = real.get('w', 1280), real.get('h', 800)

        dir_word = direction.lower().strip()
        if dir_word in ('right', 'up', 'increase', 'inc', '+'):
            arrow = 'right (▶) / up / increase'
        elif dir_word in ('left', 'down', 'decrease', 'dec', '-'):
            arrow = 'left (◀) / down / decrease'
        else:
            arrow = direction

        prompt = f"""Locate the arrow-step button on a slider for a BLV user nudging a value.

Slider target: "{target}"
Button to find: the {arrow} arrow button (the small step button at the end of the slider track)
Viewport: {vw} x {vh} pixels

Return EXACT viewport pixel coords of the arrow button CENTER. The button is small and flanks the slider track — NOT the slider thumb, NOT the value display, NOT the label.

Respond with JSON ONLY:
  {{"x": 1686, "y": 134, "reason": "right arrow on Mass slider, at the far right end of the track, just before the value display"}}
  {{"error": "reason"}}"""
        raw = ask_claude(str(shot), prompt)
        try:
            s, e = raw.find('{'), raw.rfind('}') + 1
            choice = json.loads(raw[s:e]) if s >= 0 and e > s else {}
        except Exception:
            choice = {'error': f'parse fail: {raw[:80]}'}

        if choice.get('error') or not (isinstance(choice.get('x'), (int, float))
                                       and isinstance(choice.get('y'), (int, float))):
            print(f"Can't nudge: {choice.get('error', 'no coords')}", flush=True)
            return

        x, y = int(choice['x']), int(choice['y'])
        reason = choice.get('reason', '')
        print(f"Nudge target: ({x},{y}) — {reason}", flush=True)

        for _ in range(count):
            page.mouse.click(x, y)
            time.sleep(0.15)
        time.sleep(0.5)

        post_hash = get_screenshot_hash(page)
        if post_hash != before_hash:
            print(f"Nudged {count}× — visual state changed", flush=True)
        else:
            print(f"Nudged {count}× — NO visual change (slider may be locked; "
                  f"check material/mode state)", flush=True)


def session_pickdate(field_desc, date_str):
    """Pick a date from a calendar widget (Google Flights, Airbnb, Booking.com etc.).

    Flow:
      1. Tap the date field to open its calendar popup (reuses session_tap grounding).
      2. Vision call: read current calendar state (visible month/year) and coords
         of the target day cell OR the "next month" arrow if target is future.
      3. Loop: if wrong month, click next/prev arrow; re-screenshot; repeat.
      4. When target month visible, click the day cell.

    Why this exists: typed dates get rejected by custom material-style calendars.
    Clicking through the calendar works but requires multi-step vision + coords.

    date_str formats accepted: YYYY-MM-DD, "June 15 2026", "Jun 15", etc.
      — Claude normalizes downstream; we just pass it in the prompt.
    """
    with connected_page() as page:
        # Step 1: open the picker by clicking the field
        before = state_snapshot(page)
        candidates = get_interactables_full(page)
        if candidates:
            lines = [f"  [{c['idx']}] {c['kind']}: {c['label']}" for c in candidates]
            open_prompt = f"""Pick the field that opens a calendar date picker.

User wants to set date: "{date_str}" in field described as: "{field_desc}"

Candidates:
{chr(10).join(lines)}

Return JSON ONLY:
  {{"el": N}}
  {{"error": "reason"}}"""
            raw = ask_claude_text(open_prompt, timeout=90, model=_IRIS_VISION_MODEL)
            try:
                s, e = raw.find('{'), raw.rfind('}') + 1
                choice = json.loads(raw[s:e]) if s >= 0 and e > s else {}
            except Exception:
                choice = {}
            el_idx = choice.get('el')
            if isinstance(el_idx, int) and 1 <= el_idx <= len(candidates):
                t = candidates[el_idx - 1]
                t = _scroll_into_view(page, t)
                if t is None:
                    print("Can't open picker: element lost after scroll", flush=True)
                    return
                page.mouse.click(t['cx'], t['cy_vp'])
                print(f"Opened picker via [{el_idx}] {t['label']}", flush=True)
                time.sleep(1.2)
            else:
                print(f"Can't open picker: {choice.get('error', 'no field match')}", flush=True)
                return
        else:
            print("No candidates — can't locate date field", flush=True)
            return

        # Step 2-4: loop up to 14 months forward/back while navigating calendar
        run_dir = OUT / f"session_pickdate_{_os.getpid()}_{int(time.time())}"
        run_dir.mkdir(parents=True, exist_ok=True)

        for step in range(14):
            shot = run_dir / f"cal_{step}.png"
            if not _safe_screenshot(page, shot):
                print("Can't pickdate: screenshot failed", flush=True)
                return
            real = page.evaluate("({w: window.innerWidth, h: window.innerHeight})")
            vw, vh = real.get('w', 1280), real.get('h', 800)
            prompt = f"""You are navigating a calendar popup for a blind user.

Target date: "{date_str}"
Viewport: {vw}x{vh} pixels

Examine the screenshot. Find the calendar popup (a grid of day cells with a month/year header).

Decide ONE action:
  (a) If the TARGET day cell for "{date_str}" is visible in the calendar grid, return its click coordinates:
      {{"action": "pick_day", "x": N, "y": N, "month_year": "June 2026", "reason": "day 15 cell in June 2026 panel"}}
  (b) If the target month is in the PAST relative to what's shown (need to go back), click previous-month arrow:
      {{"action": "prev_month", "x": N, "y": N, "current": "August 2026"}}
  (c) If the target month is in the FUTURE (need to go forward), click next-month arrow:
      {{"action": "next_month", "x": N, "y": N, "current": "April 2026"}}
  (d) If no calendar popup is visible at all (picker didn't open or closed):
      {{"error": "no calendar visible"}}

Coordinates are viewport pixel coords for Playwright mouse.click. Pick the CENTER of the day cell / arrow button.

DAY CELLS are small squares in the calendar grid. Do NOT click the month header or navigation row — click the numeric day cell itself."""
            raw = ask_claude(str(shot), prompt)
            try:
                s, e = raw.find('{'), raw.rfind('}') + 1
                act = json.loads(raw[s:e]) if s >= 0 and e > s else {}
            except Exception:
                act = {'error': f'parse fail: {raw[:80]}'}

            action = act.get('action')
            if action == 'pick_day':
                x, y = int(act.get('x', 0)), int(act.get('y', 0))
                if x <= 0 or y <= 0:
                    print(f"pick_day: invalid coords {act}", flush=True)
                    return
                print(f"Clicking day cell at ({x},{y}) in {act.get('month_year', '?')}",
                      flush=True)
                page.mouse.click(x, y)
                time.sleep(1.0)
                after = state_snapshot(page)
                diff = describe_state_diff(before, after)
                if diff:
                    print(f"State diff: {diff}", flush=True)
                print(f"pickdate complete. URL: {page.url[:120]}", flush=True)
                return
            elif action == 'next_month' or action == 'prev_month':
                x, y = int(act.get('x', 0)), int(act.get('y', 0))
                if x <= 0 or y <= 0:
                    print(f"{action}: invalid coords {act}", flush=True)
                    return
                print(
                    f"[step {step}] {action} from {act.get('current', '?')} — clicking ({x},{y})",
                    flush=True)
                page.mouse.click(x, y)
                time.sleep(0.8)
            else:
                print(f"pickdate aborted: {act.get('error', act)}", flush=True)
                return

        print("pickdate: too many month-navigation steps (>14); giving up", flush=True)


def session_type(where, text):
    """Click a field by natural-language description, then type text.

    Text-first grounding via get_interactables_full (same path as session_tap) —
    inputs get enriched labels (aria-label + placeholder + name + <label for> +
    aria-labelledby) so "search field", "search box", "Search Wikipedia" all resolve
    to the same element. Falls back to vision only when no candidate matches.

    Example: session_type("search field", "accessibility")
    """
    with connected_page() as page:
        before = state_snapshot(page)
        candidates = get_interactables_full(page)

        def _ground_field(cands):
            field_candidates = [c for c in cands if c['kind'] in ('input', 'select')] or cands
            if not field_candidates:
                return None, {}
            lines = []
            for i, c in enumerate(field_candidates, 1):
                offscr = "" if c['visible'] else " [offscreen, will scroll]"
                parent = f" in:{c['parent']}" if c.get('parent') else ""
                lines.append(f"  [{i}] {c['kind']}: {c['label']}{parent}{offscr}")
            cand_text = "\n".join(lines)
            prompt = f"""You are grounding an input-field selection for a blind user. Pick ONE candidate.

User wants to type into: "{where}"
Text to be typed after clicking: "{text[:80]}"

Input/select candidates on the page (and other interactables if no input matches):
{cand_text}

Return JSON ONLY — no prose, no code fences:
  {{"el": N}}                — confident match; N is from the list
  {{"error": "not in list"}} — no candidate matches; vision fallback will run

Rules:
- Prefer `input` kind over `button` kind. The user said "field" — they want to type, not submit.
- Labels may include multiple hints joined by ` · ` (e.g. "Search Wikipedia · search · searchInput") — any one matching "{where}" is enough.
- Never invent an index. If nothing fits return {{"error": "not in list"}}."""
            raw = ask_claude_text(prompt, timeout=90)
            try:
                s, e = raw.find('{'), raw.rfind('}') + 1
                ch = json.loads(raw[s:e]) if s >= 0 and e > s else {}
            except Exception:
                ch = {}
            return field_candidates, ch

        field_candidates, choice = _ground_field(candidates)

        # Recovery: if no field matched, scan the DOM for an INPUT element (not
        # any clickable — that'd hijack `type "search"` into clicking a "Help"
        # link, as happened on arXiv). If no real input is found, skip straight
        # to the vision fallback which can spot form fields visually.
        if choice and choice.get('error') == 'not in list':
            rec = _text_recovery_scroll(page, where, kinds=('input', 'textarea'))
            if rec:
                print(f"Text-recovery type target: {rec['label']!r}", flush=True)
                page.mouse.click(rec['cx'], rec['cy_vp'])
                time.sleep(0.3)
                page.keyboard.type(text)
                time.sleep(0.5)
                after = state_snapshot(page)
                diff = describe_state_diff(before, after)
                if diff:
                    print(f"State diff: {diff}", flush=True)
                print(f"Typed: {text[:60]}", flush=True)
                return

        el_idx = (choice or {}).get('el')
        if field_candidates and isinstance(el_idx, int) and 1 <= el_idx <= len(field_candidates):
            t = field_candidates[el_idx - 1]
            print(f"Text-grounded type target: [{el_idx}] {t['kind']}: {t['label']}", flush=True)
            t = _scroll_into_view(page, t)
            if t is None:
                print("Element lost after scroll — falling back to vision", flush=True)
            else:
                page.mouse.click(t['cx'], t['cy_vp'])
                time.sleep(0.3)
                page.keyboard.type(text)
                time.sleep(0.5)
                after = state_snapshot(page)
                diff = describe_state_diff(before, after)
                if diff:
                    print(f"State diff: {diff}", flush=True)
                print(f"Typed: {text[:60]}", flush=True)
                return
        else:
            print("Text-grounding: no field matched — falling back to vision", flush=True)

        # Phase 2: vision fallback (original SoM flow)
        run_dir = OUT / f"session_type_{_os.getpid()}_{int(time.time())}"
        run_dir.mkdir(parents=True, exist_ok=True)
        raw_path = run_dir / "type_raw.png"
        shot_path = run_dir / "type.png"
        if not _safe_screenshot(page, raw_path):
            print("Can't find field: vision fallback screenshot failed", flush=True)
            return

        elements = get_elements(page)
        addressable = [e for e in elements if e.get('x', 0) > 0 and e.get('y', 0) > 0][:25]
        add_som_markers(str(raw_path), str(shot_path), addressable)
        el_summary = "\n".join(
            f"  [{i+1}] {e['tag']}: {e['label']}" for i, e in enumerate(addressable))

        real = page.evaluate("({w: window.innerWidth, h: window.innerHeight})")
        vw, vh = real.get('w', 1280), real.get('h', 800)

        prompt = f"""Locate the input field: "{where}". Return coordinates so we can click then type.
Numbered elements (prefer these if matching):
{el_summary or '  (none)'}
Return JSON: {{"el": N}} or {{"xf": 0.5, "yf": 0.3}} or {{"error": "reason"}}"""
        raw = ask_claude(str(shot_path), prompt)
        try:
            s, e = raw.find('{'), raw.rfind('}') + 1
            coords = json.loads(raw[s:e])
        except Exception:
            print(f"Could not parse vision result: {raw[:150]}", flush=True)
            return

        if coords.get('error'):
            print(f"Can't find field: {coords['error']}", flush=True)
            return

        el_idx = coords.get('el')
        if el_idx and 1 <= el_idx <= len(addressable):
            t = addressable[el_idx - 1]
            x, y = t['x'], t['y']
        elif coords.get('xf') is not None:
            x, y = int(coords['xf'] * vw), int(coords['yf'] * vh)
        else:
            print("No coordinates returned", flush=True)
            return

        page.mouse.click(x, y)
        time.sleep(0.3)
        page.keyboard.type(text)
        time.sleep(0.5)
        print(f"Vision-grounded: clicked ({x},{y}) and typed: {text[:60]}", flush=True)


def _tap_click_and_diff(page, x, y, before):
    """Click at (x,y), wait for stability, emit a state-diff line. Returns True if anything changed."""
    pre_hash = get_screenshot_hash(page)
    page.mouse.click(x, y)
    wait_for_stable(page, timeout=3)
    post_hash = get_screenshot_hash(page)
    after = state_snapshot(page)
    diff = describe_state_diff(before, after)
    visually_changed = post_hash != pre_hash
    if diff:
        print(f"State diff: {diff}", flush=True)
    elif visually_changed:
        print("State diff: visual change (no DOM signal)", flush=True)
    else:
        print("State diff: NONE — click appears to have had no effect", flush=True)
    return bool(diff) or visually_changed


def session_tap(description):
    """Fast single-click by natural-language target. Textual-choice grounding first
    (SeeAct-style, text-only Claude call — ~3x more accurate than SoM per ICML'24);
    vision fallback only when no text candidate matches.

    Flow:
      1. Build page-wide interactables snapshot (no screenshot, instant).
      2. Text-only Claude call — pick by index or say "not in list".
      3. If picked: scroll element into view, click at captured center coords, diff state.
      4. If text miss: fall back to vision SoM flow on the current viewport.
    """
    with connected_page() as page:
        before = state_snapshot(page)
        candidates = get_interactables_full(page)

        def _ground(cands):
            # Compute same-site prefix from current URL so we can mark candidates
            # whose href belongs to the *same product/doc/repo context*. Fixes the
            # ambiguous-label problem (e.g. github.com/owner/repo where "Issues"
            # matches both the repo tab /owner/repo/issues and a marketing link
            # /features/issues — the marketing one is on the same host but
            # different top-level path.
            try:
                u = _urlparse(page.url)
                cur_host = u.netloc.lower()
                parts = [p for p in u.path.split('/') if p]
                # Use first 2 path segments as the "site context" prefix
                # (e.g. /anthropics/claude-code/... → /anthropics/claude-code)
                cur_prefix = '/' + '/'.join(parts[:2]) if parts else ''
            except Exception:
                cur_host, cur_prefix = '', ''

            def _same_site_tag(label):
                if not cur_host or '→' not in label:
                    return ''
                # labels with link hrefs include `→ https://host/path...` suffix
                try:
                    href = label.split('→', 1)[1].strip()
                except Exception:
                    return ''
                h = href.lower()
                # relative href ("/anthropics/claude-code/issues"): starts with cur_prefix
                if h.startswith(cur_prefix + '/') or h == cur_prefix:
                    return ' [SAME-SITE]'
                if cur_host in h and (cur_prefix + '/' in h or h.endswith(cur_prefix)):
                    return ' [SAME-SITE]'
                return ''

            lines = []
            for c in cands:
                offscr = "" if c['visible'] else " [offscreen, will scroll]"
                disabled = " [disabled]" if c.get('disabled') else ""
                parent = f" in:{c['parent']}" if c.get('parent') else ""
                # Tag any candidate whose label exposes a href (links, clickable
                # turbo-tabs like GitHub's repo tabs, etc.) — not just kind=link.
                site_tag = _same_site_tag(c['label']) if '→' in c['label'] else ''
                lines.append(f"  [{c['idx']}] {c['kind']}: {c['label']}{parent}{site_tag}{offscr}{disabled}")
            cand_text = "\n".join(lines)
            cur_url = page.url
            prompt = f"""You are grounding a click for a blind-user accessibility tool. The user described the target in natural language; you must pick ONE candidate from the numbered list.

Current page URL: {cur_url}
User wants to click: "{description}"

Candidates (from the page's accessibility tree):
{cand_text}

Return JSON ONLY — no prose, no code fences:
  {{"el": N}}     — confident match; N is the index from the list
  {{"el": N, "note": "..."}}  — match with a caveat
  {{"error": "not in list"}}  — no candidate clearly matches; vision fallback will run

Rules:
- Prefer exact label matches over fuzzy ones.
- When multiple match (e.g. several "Edit" buttons), use the `in:<landmark>` hint to disambiguate — pick the one whose parent context best matches the user's description.
- For ambiguous labels shared between page-chrome (marketing/nav) and page-content links, prefer the candidate marked `[SAME-SITE]` — that link belongs to the current product/repo/doc context. Example: on `github.com/owner/repo`, "Issues" should resolve to a [SAME-SITE] link like `/owner/repo/issues`, not the unmarked marketing link `/features/issues`.
- When both a form input and its related submit button match (e.g. "search" → both a search input and a Search button; "email" → email field and Subscribe button), prefer the input — users typically need to fill it before the button is useful. Pick the button only if the description uses an explicit submit verb ("submit", "go", "press", "send").
- Do NOT invent an index. If nothing fits, return {{"error": "not in list"}} verbatim."""
            raw = ask_claude_text(prompt, timeout=90, model=_IRIS_VISION_MODEL)
            try:
                s, e = raw.find('{'), raw.rfind('}') + 1
                return json.loads(raw[s:e]) if s >= 0 and e > s else {
                    'error': f'parse failed: {raw[:80]}'}
            except Exception:
                return {'error': f'parse failed: {raw[:80]}'}

        choice = _ground(candidates) if candidates else {'error': 'no candidates'}

        def _try_recovery():
            rec = _text_recovery_scroll(page, description)
            if not rec:
                return False
            print(f"Text-recovery tap: {rec['kind']}: {rec['label']!r}", flush=True)
            changed = _tap_click_and_diff(page, rec['cx'], rec['cy_vp'], before)
            if changed:
                print(f"Done. URL: {page.url}", flush=True)
                title = page.title()
                if title:
                    print(f"Title: {title[:80]}", flush=True)
                return True
            print("Text-recovery click had no effect", flush=True)
            return False

        el_idx = choice.get('el') if isinstance(choice, dict) else None
        confident_pick = isinstance(el_idx, int) and 1 <= el_idx <= len(candidates)

        if confident_pick:
            t = candidates[el_idx - 1]
            note = f" ({choice['note']})" if choice.get('note') else ""
            print(f"Text-grounded tap: [{el_idx}] {t['kind']}: {t['label']}{note}", flush=True)

            t = _scroll_into_view(page, t)
            if t is None:
                print("Element lost after scroll — trying recovery", flush=True)
            else:
                x, y = t['cx'], t['cy_vp']
                changed = _tap_click_and_diff(page, x, y, before)
                if changed:
                    print(f"Done. URL: {page.url}", flush=True)
                    title = page.title()
                    if title:
                        print(f"Title: {title[:80]}", flush=True)
                    return
                print("Text-grounded click had no effect — trying recovery", flush=True)
        else:
            print(
                f"Text-grounding: {choice.get('error') or 'no pick'} — trying recovery",
                flush=True)

        # Recovery: DOM-wide text scan for leaf element matching description.
        # Fires whenever text-grounding didn't produce a confident useful click,
        # covering: target outside cap, parse failures, wrong-element picks, etc.
        if _try_recovery():
            return
        print("Falling back to vision", flush=True)

        # Phase 2: vision fallback (original SoM flow)
        run_dir = OUT / f"session_tap_{_os.getpid()}_{int(time.time())}"
        run_dir.mkdir(parents=True, exist_ok=True)
        raw_path = run_dir / "tap_raw.png"
        shot_path = run_dir / "tap.png"
        _safe_screenshot(page, raw_path)

        elements = get_elements(page)
        addressable = [e for e in elements if e.get('x', 0) > 0 and e.get('y', 0) > 0][:25]
        add_som_markers(str(raw_path), str(shot_path), addressable)

        el_summary = "\n".join(
            f"  [{i+1}] {e['tag']}: {e['label']}" for i, e in enumerate(addressable))
        a11y_outline = get_a11y_outline(page)
        real = page.evaluate("({w: window.innerWidth, h: window.innerHeight})")
        vw, vh = real.get('w', 1280), real.get('h', 800)

        def resolve_coords(clue_suffix=""):
            prompt = f"""Look at the screenshot. The image contains a web page of viewport {vw}x{vh}px (with a 25px margin added showing coordinate rulers; colored numbered badges mark DOM-detected interactive elements).

User wants to click: "{description}"{clue_suffix}

Prefer element index if a badge matches. Otherwise return NORMALIZED fractional coordinates (0.0-1.0 of viewport, NOT pixels). A click at the bottom-right corner = {{"xf": 1.0, "yf": 1.0}}. Center = {{"xf": 0.5, "yf": 0.5}}.

Numbered elements:
{el_summary or '  (none detected)'}

Page structure (a11y):
{chr(10).join(a11y_outline[:15])}

Return JSON only:
  {{"el": N}}  — if a numbered badge matches
  {{"xf": 0.2, "yf": 0.97}}  — normalized fractional coords
  {{"error": "reason"}}"""
            raw = ask_claude(str(shot_path), prompt)
            try:
                s, e = raw.find('{'), raw.rfind('}') + 1
                return json.loads(raw[s:e])
            except Exception:
                return {'error': f'parse failed: {raw[:100]}'}

        coords = resolve_coords()
        if coords.get('error'):
            print(f"Can't tap: {coords['error']}", flush=True)
            return

        el_idx = coords.get('el')
        if el_idx is not None and 1 <= el_idx <= len(addressable):
            t = addressable[el_idx - 1]
            x, y = t['x'], t['y']
            print(f"Vision tap: element [{el_idx}] ({t['label']}) at ({x},{y})", flush=True)
        elif coords.get('xf') is not None and coords.get('yf') is not None:
            x = int(coords['xf'] * vw)
            y = int(coords['yf'] * vh)
            print(f"Vision tap: ({x},{y}) [xf={coords['xf']}, yf={coords['yf']}]", flush=True)
        else:
            x, y = coords.get('x'), coords.get('y')
            if x is None or y is None:
                print("No coordinates returned", flush=True)
                return
            print(f"Vision tap: ({x},{y})", flush=True)

        changed = _tap_click_and_diff(page, x, y, before)
        if not changed:
            print("No visible change — retrying with explicit miss feedback", flush=True)
            _safe_screenshot(page, raw_path)
            add_som_markers(str(raw_path), str(shot_path), addressable)
            coords2 = resolve_coords(
                f" — NOTE: previous click at ({x},{y}) produced NO visual change, so those coords were wrong. Pick a different target."
            )
            el2 = coords2.get('el')
            if el2 and 1 <= el2 <= len(addressable):
                t = addressable[el2 - 1]
                x, y = t['x'], t['y']
            elif coords2.get('xf') is not None and coords2.get('yf') is not None:
                x = int(coords2['xf'] * vw)
                y = int(coords2['yf'] * vh)
            elif coords2.get('x') is not None:
                x, y = coords2['x'], coords2['y']
            else:
                print(f"Retry failed: {coords2}", flush=True)
                return
            print(f"Retrying at ({x},{y})", flush=True)
            _tap_click_and_diff(page, x, y, before)

        print(f"Done. URL: {page.url}", flush=True)
        title = page.title()
        if title:
            print(f"Title: {title[:80]}", flush=True)


def _text_ground_one(candidates, description, verb="click", timeout=60, model=_IRIS_VISION_MODEL):
    # NOTE: default model is the vision (Opus) tier — not the grounding (Sonnet) tier —
    # because the sole caller is session_hover, where a wrong-but-plausible pick is
    # worse than an honest "no match" (you'd read a wrong tooltip to the user). Sonnet
    # is more aggressive at forcing a match when confidence is low; Opus is more
    # conservative. Explicit tap/drag callers still pass model=_IRIS_VISION_MODEL.
    """Shared text-grounding helper: pick ONE candidate by natural-language description.
    Returns the matched candidate dict or None.
    """
    if not candidates:
        return None
    lines = [
        f"  [{c['idx']}] {c['kind']}: {c['label']}"
        + (f" in:{c['parent']}" if c.get('parent') else '')
        + ("" if c['visible'] else " [offscreen, will scroll]")
        for c in candidates
    ]
    prompt = f"""Pick ONE candidate from the numbered list for a blind user's "{verb}" action.

User wants to {verb}: "{description}"

Candidates (from the page's accessibility tree):
{chr(10).join(lines)}

Return JSON ONLY — no prose, no code fences:
  {{"el": N}}                    — confident match
  {{"error": "not in list"}}     — no candidate matches

Rules: prefer exact label matches. Use the `in:<landmark>` hint to disambiguate duplicates. Never invent an index."""
    raw = ask_claude_text(prompt, timeout=timeout, model=model)
    try:
        s, e = raw.find('{'), raw.rfind('}') + 1
        choice = json.loads(raw[s:e]) if s >= 0 and e > s else {}
    except Exception:
        choice = {}
    idx = choice.get('el')
    if isinstance(idx, int) and 1 <= idx <= len(candidates):
        return candidates[idx - 1]
    return None


def _scroll_into_view(page, candidate):
    """Scroll an offscreen candidate into view and return a refreshed candidate with
    viewport-relative coords. Returns None if we can't re-find it after scrolling."""
    if candidate['visible']:
        return candidate
    page.evaluate("y => window.scrollTo({top: y, behavior: 'instant'})",
                  max(0, candidate['cy_page'] - 300))
    wait_for_stable(page, timeout=2)
    refreshed = get_interactables_full(page)
    match = next((r for r in refreshed
                  if r['kind'] == candidate['kind'] and r['label'] == candidate['label']
                  and r['visible']), None)
    return match


def _text_recovery_scroll(page, description, kinds=None):
    """Recovery pass when text-grounding missed — scans the DOM for a clickable
    element whose text/aria-label contains the description words, scrolls it into
    view, and returns its click coordinates directly.

    Why skip re-grounding: on pages like Mars Wikipedia the 80-cap is saturated
    by the sticky TOC and visible links even after scroll, so the target still
    doesn't land in the list. We already found the concrete element — click it.

    Only returns a match when all meaningful description words appear in the
    element's accessible text (high-confidence — avoids clicking unrelated
    elements just because they share one common word).

    When kinds=('input','textarea') (for session_type) we only accept form-field
    matches — prevents the "recovery clicks a link instead of the search input"
    bug observed on arXiv where a "Help" link contains the word "search".

    Returns dict with {label, cx, cy_vp, kind} on success, None otherwise.
    """
    want_inputs = kinds is not None and all(k in ('input', 'textarea') for k in kinds)
    try:
        match = page.evaluate(_js("text_recovery_scroll.js"), [description, want_inputs])
    except Exception:
        return None

    if not match:
        return None
    target_y = max(0, match['cy_page'] - 300)
    page.evaluate("y => window.scrollTo({top: y, behavior: 'instant'})", target_y)
    wait_for_stable(page, timeout=2)
    # Recompute viewport-relative y after scroll (x unchanged).
    match['cx'] = match['cx_page']
    match['cy_vp'] = match['cy_page'] - target_y
    match['visible'] = True
    return match


def session_hover(description):
    """Hover on an element by natural-language target; wait for tooltip/popover; describe what appeared.

    BLV value: keyboard users can't trigger :hover. Chart tooltips, icon-button hints,
    link previews, and dropdown submenus are all invisible to them. This primitive
    makes hover-revealed content accessible.

    Fast path: if a DOM tooltip (role=tooltip, aria-live, .tippy-box) appears,
    we read it directly — no vision call, <2s total.
    Slow path: if the tooltip is canvas-rendered (D3 chart), fall back to vision.
    """
    with connected_page() as page:
        before_hash = get_screenshot_hash(page)
        candidates = get_interactables_full(page)
        t = _text_ground_one(candidates, description, verb="hover")
        if t is None:
            print(f"Can't hover: no candidate matched \"{description}\"", flush=True)
            return

        t = _scroll_into_view(page, t)
        if t is None:
            print("Can't hover: element lost after scroll", flush=True)
            return
        x, y = t['cx'], t['cy_vp']
        print(f"Hover: [{t['idx']}] {t['kind']}: {t['label']} at ({x},{y})", flush=True)

        # Move mouse to element center; :hover / mouseenter fire.
        # First move to the bottom-right corner so mouseenter actually transitions,
        # and to avoid landing on top-left UI (logo/nav) which could itself show a tooltip.
        try:
            vp = page.evaluate("({w: window.innerWidth, h: window.innerHeight})")
            page.mouse.move(max(0, vp.get('w', 1280) - 2), max(0, vp.get('h', 800) - 2))
        except Exception:
            page.mouse.move(1, 1)
        time.sleep(0.05)
        page.mouse.move(x, y)
        time.sleep(0.8)  # tooltip render delay

        # Fast path: DOM-detectable tooltip appeared
        dom_tooltips = page.evaluate(_js("session_hover_tooltips.js"))
        if dom_tooltips:
            for tip in dom_tooltips[:3]:
                print(f"Tooltip: {tip}", flush=True)
            return

        # Slow path: vision
        after_hash = get_screenshot_hash(page)
        if after_hash == before_hash:
            print("No visible change after hover — this element likely has no tooltip.",
                  flush=True)
            return

        run_dir = OUT / f"session_hover_{_os.getpid()}_{int(time.time())}"
        run_dir.mkdir(parents=True, exist_ok=True)
        shot = run_dir / "after_hover.png"
        _safe_screenshot(page, shot)

        prompt = f"""A blind user hovered on "{t['label']}" to see if a tooltip/popover appeared. Describe WHAT APPEARED or highlighted — be concise (1-3 sentences). Focus only on new content that wasn't there before hovering. If a chart tooltip shows a value, state the exact value and label."""
        desc = ask_claude(str(shot), prompt)
        print(desc.strip(), flush=True)


def session_drag(from_desc, to_desc):
    """Drag from one natural-language target to another.

    Text-grounds both endpoints (one Claude call), then issues a smooth mouse-based
    drag with 25 intermediate steps. Works for pointer-event-driven targets: canvas
    widgets (PhET sims), sliders, custom mousedown/move/up handlers.

    LIMITATION: elements with HTML5 `draggable="true"` (Trello/Notion kanban cards,
    file-upload drop zones) use native drag events that Playwright's raw mouse API
    does NOT synthesize — the drag will visibly happen but `dragstart`/`dragover`/`drop`
    won't fire. For those, fall back to `session do`.
    """
    with connected_page() as page:
        before = state_snapshot(page)
        candidates = get_interactables_full(page)
        if not candidates:
            print("No interactables found", flush=True)
            return

        lines = [
            f"  [{c['idx']}] {c['kind']}: {c['label']}"
            + (f" in:{c['parent']}" if c.get('parent') else '')
            for c in candidates
        ]
        prompt = f"""Pick TWO candidates for a drag-and-drop for a blind user.

Drag FROM: "{from_desc}"
Drag TO:   "{to_desc}"

Candidates (a11y tree):
{chr(10).join(lines)}

Return JSON ONLY:
  {{"from_el": N, "to_el": M}}        — both indices from the list
  {{"error": "reason"}}               — if either target is missing

Rules: never invent indices. If only one target is in the list, return {{"error": "..."}} naming which one is missing."""
        raw = ask_claude_text(prompt, timeout=90, model=_IRIS_VISION_MODEL)
        try:
            s, e = raw.find('{'), raw.rfind('}') + 1
            choice = json.loads(raw[s:e]) if s >= 0 and e > s else {}
        except Exception:
            choice = {'error': f'parse fail: {raw[:80]}'}

        fi, ti = choice.get('from_el'), choice.get('to_el')
        text_ok = (isinstance(fi, int) and isinstance(ti, int)
                   and 1 <= fi <= len(candidates) and 1 <= ti <= len(candidates))
        if text_ok:
            src = candidates[fi - 1]
            dst = candidates[ti - 1]
            print(f"Drag: [{fi}] {src['label']}  →  [{ti}] {dst['label']}", flush=True)
            if not src['visible']:
                src = _scroll_into_view(page, src)
                if src is None:
                    print("Drag source element lost after scroll — falling to vision", flush=True)
                    text_ok = False
                else:
                    refreshed = get_interactables_full(page)
                    dst = next((r for r in refreshed
                                if r['kind'] == dst['kind'] and r['label'] == dst['label']), dst)
            if text_ok:
                x1, y1 = src['cx'], src['cy_vp']
                x2, y2 = dst['cx'], dst['cy_vp']
        else:
            # Vision fallback: canvas/WebGL sliders have no a11y endpoints. Ask Claude
            # for fractional viewport coords of the start and end points.
            print(f"Text-grounding failed for drag ({choice.get('error', 'no indices')}) — vision fallback", flush=True)
            run_dir = OUT / f"session_drag_{_os.getpid()}_{int(time.time())}"
            run_dir.mkdir(parents=True, exist_ok=True)
            shot = run_dir / "drag.png"
            if not _safe_screenshot(page, shot):
                print("Can't drag: screenshot failed", flush=True)
                return
            real = page.evaluate("({w: window.innerWidth, h: window.innerHeight})")
            vw, vh = real.get('w', 1280), real.get('h', 800)
            v_prompt = f"""Identify drag start and end coordinates on the screenshot.

Viewport is {vw}x{vh} pixels. Return fractional coords (0.0 = left/top edge, 1.0 = right/bottom edge).

Drag FROM: "{from_desc}"
Drag TO:   "{to_desc}"

CRITICAL: Before returning coords, first identify the EXACT pixel area of the draggable control.
- For sliders: the "track" is the thin horizontal bar the thumb rides on. NOT the label above it, NOT the value display, NOT arrow buttons at the ends.
  * The track thumb sits on is a horizontal line. Your y-coord MUST be on that line, not on the label.
  * For start: pick the current thumb position (distinct marker/circle on the track).
  * For end: pick a point inside the track, NOT past the arrow buttons.
- For kanban/list: "from" is the dragged item's center, "to" is the drop target's center.

Return JSON ONLY:
  {{"reason_from": "Mass slider track thumb currently at left end, y ~135", "reason_to": "Right end of Mass slider track, y ~135", "from": {{"xf": 0.86, "yf": 0.144}}, "to": {{"xf": 0.97, "yf": 0.144}}}}
  {{"error": "reason"}}

Include reason_from/reason_to so your own work is auditable — this improves accuracy."""
            raw2 = ask_claude(str(shot), v_prompt)
            try:
                s2, e2 = raw2.find('{'), raw2.rfind('}') + 1
                v_choice = json.loads(raw2[s2:e2]) if s2 >= 0 and e2 > s2 else {}
            except Exception:
                v_choice = {'error': f'parse fail: {raw2[:80]}'}
            f = v_choice.get('from') or {}
            t = v_choice.get('to') or {}
            if not (isinstance(f.get('xf'), (int, float)) and isinstance(f.get('yf'), (int, float))
                    and isinstance(t.get('xf'), (int, float))
                    and isinstance(t.get('yf'), (int, float))):
                print(f"Can't drag: {v_choice.get('error', 'no vision coords')}", flush=True)
                return
            x1, y1 = int(f['xf'] * vw), int(f['yf'] * vh)
            x2, y2 = int(t['xf'] * vw), int(t['yf'] * vh)
            print(f"Vision drag: ({x1},{y1}) → ({x2},{y2})", flush=True)

        pre_hash = get_screenshot_hash(page)

        # Smooth drag with intermediate steps — required for HTML5 dragover
        # and for canvas widgets that track mousemove deltas (PhET, sliders).
        page.mouse.move(x1, y1)
        time.sleep(0.1)
        page.mouse.down()
        time.sleep(0.05)
        steps = 25
        for i in range(1, steps + 1):
            ix = x1 + (x2 - x1) * i / steps
            iy = y1 + (y2 - y1) * i / steps
            page.mouse.move(ix, iy)
            time.sleep(0.015)
        time.sleep(0.1)
        page.mouse.up()
        wait_for_stable(page, timeout=3)

        post_hash = get_screenshot_hash(page)
        after = state_snapshot(page)
        diff = describe_state_diff(before, after)
        visually_changed = post_hash != pre_hash
        if diff:
            print(f"State diff: {diff}", flush=True)
        elif visually_changed:
            print(
                "State diff: visual change (page content updated — no url/title/focus change)",
                flush=True)
        else:
            print("State diff: NONE — drag may not have taken effect (wrong target or page ignored it)", flush=True)


def session_diff():
    """Compare current tab state to the last saved baseline; describe what changed.

    First call saves a baseline (state + screenshot). Subsequent calls diff, describe,
    and update the baseline. Useful for: "I moved a slider, what happened?" "I clicked
    a button, did anything change?" Works across ai4a11y invocations via ~/.ai4a11y/.

    Fast path: if only URL/title/scroll/focus changed (cheap structured diff), report
    that and skip vision. Slow path: screenshot-diff + vision call for page content change.
    """
    with connected_page() as page:
        current = state_snapshot(page)
        try:
            current['text_hash'] = hashlib.md5(
                get_visible_text(page, limit=3000).encode('utf-8', errors='ignore')
            ).hexdigest()
        except Exception:
            current['text_hash'] = ''

        baseline_shot = SESSION_DIR / "diff_baseline.png"
        baseline_state = SESSION_DIR / "diff_baseline.json"

        def save_baseline():
            baseline_state.write_text(json.dumps(current, indent=2))
            _safe_screenshot(page, baseline_shot)

        if not baseline_state.exists():
            save_baseline()
            print(
                "Saved baseline snapshot. Call `session diff` again after acting to see changes.",
                flush=True)
            return

        prev = json.loads(baseline_state.read_text())

        # Navigation resets the diff context — old baseline is meaningless for a different page.
        if prev.get('url') != current.get('url'):
            save_baseline()
            print(f"URL changed since last snapshot ({prev.get('url', '')[:50]} → {current.get('url', '')[:50]}) — baseline reset.",
                  flush=True)
            return

        structured = describe_state_diff(prev, current)
        text_changed = prev.get('text_hash') != current.get('text_hash')

        if not structured and not text_changed:
            print("No change detected since last snapshot (url/title/scroll/focus/text all identical).",
                  flush=True)
            save_baseline()
            return

        if structured:
            print(f"Structured diff: {structured}", flush=True)

        vision_ok = True
        # Text changed but structure didn't — use vision to describe content change.
        if text_changed:
            run_dir = OUT / f"session_diff_{_os.getpid()}_{int(time.time())}"
            run_dir.mkdir(parents=True, exist_ok=True)
            after_shot = run_dir / "after.png"
            _safe_screenshot(page, after_shot)

            # Visual diff highlights changed pixels for the vision call to focus on.
            vision_target = after_shot
            if baseline_shot.exists():
                diff_img = run_dir / "pixel_diff.png"
                try:
                    create_diff_image(str(baseline_shot), str(after_shot), str(diff_img))
                    vision_target = diff_img
                except Exception:
                    pass

            prompt = """Describe what CHANGED on this page since the previous snapshot. The image highlights changed regions in red/yellow if it's a pixel-diff overlay, otherwise it's the current state. Be concise (1-3 sentences). Examples: "A modal opened titled 'Confirm'", "Row 3 now shows 'Error'", "Chart switched to Q3 data — tallest bar is now April at 42%"."""
            desc = ask_claude(str(vision_target), prompt)
            print(desc.strip(), flush=True)
            # Detect the sentinel error payload from ask_claude so we don't lose the
            # baseline when vision failed (the user will want to retry).
            if desc.strip().startswith('{') and '"reason": "subprocess failed"' in desc:
                vision_ok = False
            if desc.strip().startswith('{') and 'timeout' in desc.lower():
                vision_ok = False

        if vision_ok:
            save_baseline()
        else:
            print("(keeping previous baseline — vision call failed, retry `session diff` later)",
                  flush=True)


def session_focused():
    """Report what element currently has document.activeElement. Instant DOM query.

    Use when the user has been tabbing and wants to double-check where they are before
    hitting Enter, OR when ai4a11y's own click may have moved focus and they want to confirm.
    """
    with connected_page() as page:
        info = page.evaluate(_js("session_focused.js"))
        label = info.get('label') or '(no label)'
        extra = info.get('extra', '')
        print(f"Focused: [{info.get('role', '?')}] {label}{extra}", flush=True)
        print(f"On: {(info.get('title') or '')[:60]} — {(info.get('url') or '')[:60]}", flush=True)


def session_dismiss():
    """Auto-dismiss cookie banners, modal popups, and overlay dialogs.

    Huge pain point for BLV users — these often block screen readers.
    Uses common selector patterns to find and close intrusive overlays.
    """
    with connected_page() as page:
        dismissed = page.evaluate(_js("session_dismiss.js"))
        if dismissed > 0:
            print(f"Dismissed {dismissed} popup(s)/banner(s)", flush=True)
        else:
            print("No popups or cookie banners found to dismiss", flush=True)


def session_summary():
    """Quick 2-sentence TLDR of the page. Faster than full describe.

    For rapid orientation — "what kind of page is this and what's the main thing?"
    """
    with connected_page() as page:
        # Get minimal context
        title = page.title()
        url = page.url
        text = page.evaluate(_js("session_summary.js"))

        prompt = f"""Give a 2-sentence summary of this page. First sentence: what type of page/site is this. Second sentence: what's the main content or purpose right now.

URL: {url}
Title: {title}

Text preview:
{text[:1500]}

Be concise — exactly 2 sentences, no more."""

        print(ask_claude_text(prompt), flush=True)


def session_heading(direction='next', level=None):
    """Jump to next/prev heading (h1-h6). Screen reader power-user pattern.

    Args:
        direction: 'next' or 'prev'
        level: Optional - specific level (1-6) or None for any heading
    """
    if level is not None and (level < 1 or level > 6):
        print(f"Invalid heading level {level}. Must be 1-6.", flush=True)
        return
    with connected_page() as page:
        # One argument, so the script destructures it. page.evaluate passes
        # exactly one value however many it is given, and the script used to
        # take `(direction, level)`, which put the whole list in `direction`
        # and left `level` undefined: `direction === 'next'` was never true, so
        # every call walked backwards, and the level was ignored.
        result = page.evaluate(_js("session_heading.js"), [direction, level])

        if result.get('found'):
            print(f"[{result['tag']}] {result['text']}", flush=True)
            print(f"(heading {result['index']}/{result['total']})", flush=True)
        else:
            print(result.get('msg', 'No headings found'), flush=True)


def session_skip():
    """Jump to main content landmark. Skip nav, get to content.

    Looks for <main>, [role="main"], <article>, or #content.
    """
    with connected_page() as page:
        result = page.evaluate(_js("session_skip.js"))

        if result.get('found'):
            label = result.get('label')
            if label:
                print(f"Skipped to main content: [{result['role']}] {label}", flush=True)
            else:
                print(f"Skipped to main content: [{result['role']}]", flush=True)
        else:
            print("No main content landmark found", flush=True)


def session_media(action, value=None):
    """Control video/audio playback. Actions: play, pause, toggle, seek, rate, volume, mute.

    Args:
        action: play, pause, toggle, seek, rate, volume, mute, status
        value: For seek (seconds), rate (0.5-2.0), volume (0-1)
    """
    with connected_page() as page:
        # Destructured for the same reason as session_heading. While the script
        # took `(action, value)`, `action` held the whole list and matched no
        # case, so play, pause, toggle, seek, rate, volume and mute all fell
        # through to the default branch and reported status without changing
        # anything.
        result = page.evaluate(_js("session_media.js"), [action, value])

        if result.get('error'):
            print(result['error'], flush=True)
        else:
            dur = result.get('duration', 0)
            cur = result.get('currentTime', 0)
            dur_str = f"{int(dur // 60)}:{int(dur % 60):02d}" if dur else "?"
            cur_str = f"{int(cur // 60)}:{int(cur % 60):02d}"
            state = "paused" if result.get('paused') else "playing"
            print(f"{result.get('msg', 'OK')}", flush=True)
            print(f"[{result.get('type', 'media')}] {cur_str} / {dur_str} ({state}, {result.get('playbackRate', 1)}x)", flush=True)


def session_screenshot(filename=None):
    """Save current view to share with sighted helper. "Can you look at this for me?"

    Args:
        filename: Optional output filename (defaults to timestamped file in Downloads)
    """
    with connected_page() as page:
        if filename:
            path = Path(filename).expanduser()
        else:
            timestamp = time.strftime("%Y%m%d_%H%M%S")
            path = Path.home() / "Downloads" / f"ai4a11y_screenshot_{timestamp}.png"

        page.screenshot(path=str(path), full_page=False)
        print(f"Screenshot saved: {path}", flush=True)
        print(f"Page: {page.title()[:50]}", flush=True)
        print(f"URL: {page.url[:70]}", flush=True)


def session_report(output=None):
    """Generate full accessibility report (HTML). More detailed than audit.

    Includes all violations, passes, and incomplete checks with full details.
    """
    with connected_page() as page:
        # Inject axe-core
        page.add_script_tag(content=_get_axe_script())
        page.wait_for_function("typeof axe !== 'undefined'", timeout=5000)

        # Run full axe analysis
        results = page.evaluate(_js("session_report.js"))

        # Generate HTML report
        timestamp = time.strftime("%Y%m%d_%H%M%S")
        if output:
            path = Path(output).expanduser()
        else:
            path = Path.home() / "Downloads" / f"a11y_report_{timestamp}.html"

        # Escape user content to prevent XSS
        safe_title = html_escape(results['title'][:50])
        safe_url = html_escape(results['url'])

        html = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Accessibility Report - {safe_title}</title>
    <style>
        body {{ font-family: -apple-system, system-ui, sans-serif; max-width: 900px; margin: 2em auto; padding: 0 1em; }}
        h1 {{ color: #1a1a1a; }}
        h2 {{ color: #333; border-bottom: 2px solid #ddd; padding-bottom: 0.3em; margin-top: 2em; }}
        .summary {{ background: #f5f5f5; padding: 1em; border-radius: 8px; margin: 1em 0; }}
        .critical {{ color: #d32f2f; }}
        .serious {{ color: #f57c00; }}
        .moderate {{ color: #fbc02d; }}
        .minor {{ color: #7cb342; }}
        .violation {{ background: #fff3f3; border-left: 4px solid #d32f2f; padding: 1em; margin: 1em 0; }}
        .pass {{ background: #f3fff3; border-left: 4px solid #4caf50; padding: 0.5em 1em; margin: 0.5em 0; }}
        .incomplete {{ background: #fff8e1; border-left: 4px solid #ff9800; padding: 0.5em 1em; margin: 0.5em 0; }}
        code {{ background: #eee; padding: 0.2em 0.4em; border-radius: 3px; font-size: 0.9em; }}
        .nodes {{ font-size: 0.85em; color: #666; margin-top: 0.5em; }}
    </style>
</head>
<body>
    <h1>Accessibility Report</h1>
    <div class="summary">
        <strong>URL:</strong> {safe_url}<br>
        <strong>Title:</strong> {safe_title}<br>
        <strong>Generated:</strong> {results['timestamp']}<br>
        <strong>Summary:</strong>
        <span class="critical">{len([v for v in results['violations'] if v.get('impact') == 'critical'])} critical</span>,
        <span class="serious">{len([v for v in results['violations'] if v.get('impact') == 'serious'])} serious</span>,
        <span class="moderate">{len([v for v in results['violations'] if v.get('impact') == 'moderate'])} moderate</span>,
        <span class="minor">{len([v for v in results['violations'] if v.get('impact') == 'minor'])} minor</span>
        | {len(results['passes'])} passed | {len(results['incomplete'])} need review
    </div>

    <h2>Violations ({len(results['violations'])})</h2>
"""
        for v in results['violations']:
            impact = html_escape(v.get('impact', 'minor'))
            html += f"""
    <div class="violation">
        <strong class="{impact}">[{impact.upper()}]</strong> {html_escape(v.get('help', 'Unknown'))}
        <p>{html_escape(v.get('description', ''))}</p>
        <div class="nodes">{len(v.get('nodes', []))} element(s) affected</div>
        <p><a href="{html_escape(v.get('helpUrl', '#'))}">Learn more</a></p>
    </div>
"""

        html += f"""
    <h2>Passed ({len(results['passes'])})</h2>
"""
        for p_item in results['passes'][:20]:  # Limit to first 20
            html += (
                f"""    <div class="pass">{html_escape(p_item.get('help', 'Unknown'))}</div>\n"""
            )
        if len(results['passes']) > 20:
            html += f"    <p>...and {len(results['passes']) - 20} more</p>\n"

        html += f"""
    <h2>Needs Review ({len(results['incomplete'])})</h2>
"""
        for inc in results['incomplete']:
            html += f"""    <div class="incomplete">{html_escape(inc.get('help', 'Unknown'))} ({len(inc.get('nodes', []))} elements)</div>\n"""

        html += """
</body>
</html>
"""
        path.write_text(html)
        print(f"Report saved: {path}", flush=True)
        print(f"Violations: {len(results['violations'])} | Passed: {len(results['passes'])} | Review: {len(results['incomplete'])}", flush=True)


def session_do(task, min_interactions=0, max_steps=8):
    """Run the full reactive agent on the current page state (no re-navigation)."""
    with connected_page() as page:
        run_agent(url=page.url, task=task, max_steps=max_steps,
                  min_interactions=min_interactions, existing_page=page)


# ============================================================
# TOOLS & PROFILES — enable/disable adapters, apply profiles
# ============================================================

def session_enable(tool_name, options=None):
    """Enable an accessibility tool/adapter on the current page.

    Tools: visualAssist, darkMode, motionReducer, focusMode, readAloud,
           readerMode, voiceCommands, keyboardNav, colorBlindMode, autoTranscriber

    Options (key=value pairs, JSON string, or dict):
      visualAssist: fontScale, lineHeight, letterSpacing, largeCursor,
                    enhanceFocus, dyslexiaFont, readingGuide, contrastMode
      colorBlindMode: mode (protanopia, deuteranopia, tritanopia, achromatopsia)

    Example:
      session enable darkMode
      session enable visualAssist fontScale=150 largeCursor=true
      session enable visualAssist '{"fontScale": 150, "largeCursor": true}'
      session enable colorBlindMode deuteranopia
    """
    with connected_page() as page:
        if not _inject_cli_tools(page):
            print("Error: Could not inject tools. Run 'npm run build:cli' first.", flush=True)
            return

        # Parse options
        opts = {}
        if options:
            if isinstance(options, dict):
                opts = options
            elif isinstance(options, list):
                # List of key=value strings or a single value
                for item in options:
                    if '=' in item:
                        key, value = item.split('=', 1)
                        # Parse value types
                        if value.lower() == 'true':
                            opts[key] = True
                        elif value.lower() == 'false':
                            opts[key] = False
                        elif value.isdigit():
                            opts[key] = int(value)
                        elif value.replace('.', '', 1).isdigit():
                            opts[key] = float(value)
                        else:
                            opts[key] = value
                    elif item.startswith('{'):
                        try:
                            opts.update(json.loads(item))
                        except json.JSONDecodeError:
                            print(f"Invalid JSON: {item}", flush=True)
                            return
                    else:
                        # Single value (e.g., colorBlindMode mode)
                        opts['mode'] = item
            elif isinstance(options, str):
                if options.startswith('{'):
                    try:
                        opts = json.loads(options)
                    except json.JSONDecodeError:
                        print(f"Invalid JSON options: {options}", flush=True)
                        return
                else:
                    # Single value option (e.g., colorBlindMode mode)
                    opts = {'mode': options}

        result = page.evaluate(
            "(args) => window.ai4a11y.enableTool(args.name, args.opts)",
            {'name': tool_name, 'opts': opts}
        )

        if result.get('success'):
            print(f"Enabled: {result.get('tool', tool_name)}", flush=True)
        else:
            print(f"Error: {result.get('error', 'Unknown error')}", flush=True)


def session_disable(tool_name):
    """Disable an accessibility tool/adapter on the current page.

    Example:
      session disable darkMode
      session disable visualAssist
    """
    with connected_page() as page:
        if not _inject_cli_tools(page):
            print("Error: Could not inject tools. Run 'npm run build:cli' first.", flush=True)
            return

        result = page.evaluate(
            "(name) => window.ai4a11y.disableTool(name)",
            tool_name
        )

        if result.get('success'):
            print(f"Disabled: {result.get('tool', tool_name)}", flush=True)
        else:
            print(f"Error: {result.get('error', 'Unknown error')}", flush=True)


def session_tools(json_output=False):
    """List all available tools and their current enabled/disabled state.

    Example:
      session tools
      session tools --json
    """
    with connected_page() as page:
        if not _inject_cli_tools(page):
            print("Error: Could not inject tools. Run 'npm run build:cli' first.", flush=True)
            return

        tools_list = page.evaluate("() => window.ai4a11y.listTools()")

        def render():
            print("\nAccessibility Tools:", flush=True)
            print("─" * 60, flush=True)
            for tool in tools_list:
                status = "✓ ON" if tool['enabled'] else "  off"
                desc = f" — {tool['description']}" if tool.get('description') else ""
                print(f"  [{status}] {tool['name']}{desc}", flush=True)
            print("─" * 60, flush=True)
            print("\nUse: session enable <tool> | session disable <tool>", flush=True)

        emit(tools_list, render, json_output)


def session_profile(profile_name, json_output=False):
    """Apply an accessibility profile to the current page.

    Profiles: lowVision, blind, colorBlind, dyslexia, adhd, cognitive,
              motor, photosensitive, deaf, anxiety, olderAdult, sensory

    Each profile enables a specific set of tools optimized for that need.
    The profile is saved and auto-applied to all future page navigations.

    Use 'session profile none' to clear the active profile.

    Example:
      session profile lowVision
      session profile dyslexia
      session profile none       # clear active profile
    """
    # Clearing the profile has to reach the open page, not only the saved
    # state. Someone runs this to stop page content going to a model, so a
    # command that wrote the state file and stopped there reported a stop it
    # had not performed. Clearing the state is done first and unconditionally:
    # whatever happens with the browser, the profile does not come back on the
    # next navigation.
    if profile_name.lower() == 'none':
        _set_active_profile(None)
        result = {'cleared': True, 'reachedPage': False, 'withdrawn': False,
                  'toolsTurnedOff': 0, 'toolsStillOn': [], 'note': None}
        try:
            with connected_page() as page:
                if _inject_cli_tools(page):
                    result['reachedPage'] = True
                    report = _withdraw_active_profile(page)
                    result['withdrawn'] = report['withdrew']
                    result['toolsTurnedOff'] = len(report['turnedOff'])
                    result['toolsStillOn'] = report['stillOn']
                    if not report['withdrew']:
                        result['note'] = (
                            f"The open page is not cleared: {report['reason']}. "
                            "It may still have the profile applied. Reload it "
                            "to be sure.")
                else:
                    result['note'] = (
                        "Could not reach the tools on the open page, so it may "
                        "still have the profile applied. Load a page to be sure.")
        except NoSession:
            # Nothing is open, so nothing is left holding the profile. This is
            # the ordinary case rather than a failure, and it is the one place
            # a page that was not reached is not a page that may still be armed.
            result['withdrawn'] = True
            result['note'] = ("No browser session is running, so there was no "
                              "open page to clear.")
        except Exception as e:
            # Never let a browser problem turn clearing a profile into a
            # failure. The saved profile is already cleared by this point; say
            # what was not reached rather than raising over it. Playwright
            # errors run to many lines and this one goes on a line of output.
            first = str(e).strip().splitlines()[0][:120]
            result['note'] = (
                f"Did not reach the open page ({first}), so it may still have "
                "the profile applied. Load a page to be sure.")

        def render():
            print("Profile cleared. It will not auto-apply on navigation.",
                  flush=True)
            if result['withdrawn'] and result['reachedPage']:
                count = result['toolsTurnedOff']
                noun = "tool" if count == 1 else "tools"
                print(f"Turned off {count} {noun} on the open page.",
                      flush=True)
            if result['note']:
                print(result['note'], flush=True)

        emit(result, render, json_output)
        # A withdrawal that did not finish is a privacy control that did not
        # hold, so it exits non-zero. Only the count line used to distinguish
        # the two, on stdout, where nothing scripting this command reads it.
        return None if result['withdrawn'] else 1

    with connected_page() as page:
        _expose_ai_callbacks(page)
        if not _inject_cli_tools(page):
            print("Error: Could not inject tools. Run 'npm run build:cli' first.", flush=True)
            return

        result = page.evaluate(
            "(name) => window.ai4a11y.applyProfile(name)",
            profile_name
        )

        def render():
            if result.get('success'):
                print(f"Applied profile: {result.get('name', profile_name)}", flush=True)
                print("(Profile saved — auto-applies on all page navigations)", flush=True)
                print("\nEnabled tools:", flush=True)
                for tool, enabled in result.get('enabled', {}).items():
                    if enabled:
                        print(f"  ✓ {tool}", flush=True)
            else:
                print(f"Error: {result.get('error', 'Unknown error')}", flush=True)

        # Saving the profile is what the command does, not part of reporting it,
        # so it happens the same way whoever is reading the output. Both
        # branches already did this; it is hoisted out so `render` only prints.
        if result.get('success'):
            # Save profile for auto-application on future navigations
            _set_active_profile(profile_name)

        emit(result, render, json_output)
        # Applying a profile and applying nothing were one exit status, with
        # only a line of prose between them. This half is a privacy control
        # too, in the other direction: what a person asked to be switched on
        # for them is either on the page or it is not.
        return None if result.get('success') else 1


def session_profiles(json_output=False):
    """List all available accessibility profiles.

    Example:
      session profiles
      session profiles --json
    """
    with connected_page() as page:
        if not _inject_cli_tools(page):
            print("Error: Could not inject tools. Run 'npm run build:cli' first.", flush=True)
            return

        profiles_list = page.evaluate("() => window.ai4a11y.listProfiles()")

        def render():
            print("\nAccessibility Profiles:", flush=True)
            print("─" * 60, flush=True)
            for profile in profiles_list:
                print(f"  • {profile['id']}: {profile['name']}", flush=True)
                if profile.get('description'):
                    print(f"    {profile['description']}", flush=True)
            print("─" * 60, flush=True)
            print("\nUse: session profile <name>", flush=True)

        emit(profiles_list, render, json_output)


# ============================================================
# Auditor functions — find accessibility issues
# ============================================================

# The one thing genuinely shared between the four auditors: the JS function
# name behind each short key. Everything else (header text, bullet shape, the
# contrast cap) has exactly one producer and one consumer, so it stays in the
# command that owns it rather than becoming data with an audience of one.
AUDITOR_JS = {
    'alt': 'findMissingAlt',
    'labels': 'findMissingLabels',
    'contrast': 'findPoorContrast',
    'captions': 'findMissingCaptions',
}


def run_auditor(page, name):
    """Evaluate one auditor and return its raw result."""
    return page.evaluate(f"() => window.ai4a11y.auditors.{AUDITOR_JS[name]}()")


def _audit(name, json_output, render):
    """Connect, inject, evaluate one auditor, then dump JSON or render text."""
    with connected_page() as page:
        if not _inject_cli_tools(page):
            print("Error: Could not inject tools.", flush=True)
            return
        result = run_auditor(page, name)
        emit(result, lambda: render(result), json_output)


def session_find_missing_alt(json_output=False):
    """Find images without alt text."""
    def render(result):
        print(f"\nImages missing alt text: {result.get('total', 0)}", flush=True)
        for img in result.get('noAlt', []):
            print(f"  • {img['selector']}: {img.get('src', '')[:50]}", flush=True)
        for img in result.get('emptyAlt', []):
            print(f"  • {img['selector']}: (empty alt)", flush=True)
        for c in result.get('canvases', []):
            print(f"  • {c['selector']}: <canvas>", flush=True)
    return _audit('alt', json_output, render)


def session_find_missing_labels(json_output=False):
    """Find unlabeled interactive elements."""
    def render(result):
        print(f"\nUnlabeled elements: {result.get('total', 0)}", flush=True)
        for el in result.get('links', []):
            print(f"  • link: {el['selector']}", flush=True)
        for el in result.get('buttons', []):
            print(f"  • button: {el['selector']}", flush=True)
        for el in result.get('inputs', []):
            print(f"  • input[{el.get('type', '?')}]: {el['selector']}", flush=True)
    return _audit('labels', json_output, render)


def session_find_poor_contrast(json_output=False):
    """Find text with poor color contrast."""
    def render(result):
        print(f"\nLow contrast text: {len(result)}", flush=True)
        for el in result[:10]:
            text = el.get('text', '')[:30]
            print(f"  • {el['selector']}: \"{text}\"", flush=True)
            print(f"    color: {el.get('color')} on {el.get('background')}", flush=True)
        if len(result) > 10:
            print(f"  ... and {len(result) - 10} more", flush=True)
    return _audit('contrast', json_output, render)


def session_find_missing_captions(json_output=False):
    """Find media without captions."""
    def render(result):
        print(f"\nMedia without captions: {result.get('total', 0)}", flush=True)
        for v in result.get('videos', []):
            print(f"  • video: {v.get('src', '')[:50]}", flush=True)
        for a in result.get('audio', []):
            print(f"  • audio: {a.get('src', '')[:50]}", flush=True)
    return _audit('captions', json_output, render)


def session_find_all(json_output=False):
    """Run all auditors and summarize issues."""
    with connected_page() as page:
        if not _inject_cli_tools(page):
            print("Error: Could not inject tools.", flush=True)
            return
        alt = run_auditor(page, 'alt')
        labels = run_auditor(page, 'labels')
        contrast = run_auditor(page, 'contrast')
        captions = run_auditor(page, 'captions')
        result = {
            'missingAlt': alt,
            'missingLabels': labels,
            'poorContrast': contrast,
            'missingCaptions': captions,
            'summary': {
                'missingAlt': alt.get('total', 0),
                'missingLabels': labels.get('total', 0),
                'poorContrast': len(contrast),
                'missingCaptions': captions.get('total', 0)
            }
        }

        def render():
            s = result['summary']
            total = sum(s.values())
            print(f"\n{'─' * 40}", flush=True)
            print(f"Accessibility Issues Found: {total}", flush=True)
            print(f"{'─' * 40}", flush=True)
            print(f"  Missing alt text:    {s['missingAlt']}", flush=True)
            print(f"  Missing labels:      {s['missingLabels']}", flush=True)
            print(f"  Poor contrast:       {s['poorContrast']}", flush=True)
            print(f"  Missing captions:    {s['missingCaptions']}", flush=True)
            print(f"{'─' * 40}", flush=True)

        emit(result, render, json_output)


# ============================================================
# AI Fix functions — use Claude to fix accessibility issues
# ============================================================
#
# Each pass below is a FixPass spec, and its `write` is the JavaScript that
# puts the model's answer on the page. Where that script is a line or two,
# it stays an inline string next to the rest of the spec, so the whole pass
# reads in one place. Six are that short. Where it is long enough that
# reading it in Python costs something, it is a file under cli/js/ loaded
# with `_js`, so an editor treats it as JavaScript. Two are that long: the
# simplify and summarize writers inside `scan`.

def _alt_locate(page, item, i):
    """The image element, falling back to a match on part of its src."""
    el = page.query_selector(item.get('selector', ''))
    if not el:
        src = item.get('src', '')[:40]
        el = page.query_selector(f'img[src*="{src[:20]}"]')
    return el


ALT_PASS = FixPass(
    items=_auditor_items("alt", "noAlt", "emptyAlt"),
    locate=_alt_locate,
    shot=lambda item, i: OUT / f"img_{i}.png",
    prompt=lambda page, item: """Describe this image for a blind user. Write a concise alt text (1-2 sentences) that captures:
1. What the image shows (main subject, action, context)
2. Any important text visible
3. Relevant details for understanding

Return ONLY the alt text, no quotes or preamble.""",
    call="vision",
    cap=lambda v: (v[:297] + "...") if len(v) > 300 else v,
    write="(data) => {\n"
          "    const el = document.querySelector(data.selector);\n"
          "    if (el) el.alt = data.value;\n"
          "}",
    field="alt",
    progress=FixProgress(
        header=lambda items, count: f"\nGenerating alt text for {count} images...",
        begin=lambda i, count, item, sel: f"  [{i+1}/{count}] {sel}...",
        missing=lambda i, item, sel: "not found",
        unanswered=lambda i, item, sel: NEEDS_AI_LINE,
        applied=lambda i, item, sel, value: (
            f"✓ \"{value[:50]}...\"" if len(value) > 50 else f"✓ \"{value}\""),
        failed=lambda i, item, sel, error: f"error: {error}",
    ),
)


def _fix_pass_on_page(page, spec, max_items, noun, empty, json_output):
    """Run one AI fix pass on an open page and return its --json payload.

    The payload is returned rather than emitted because `fix-all` runs two of
    these and owes its caller one document. `None` means the tools could not be
    injected, which is reported here and leaves the caller nothing to emit.

    Progress and the payload share stdout, so the human lines are silenced
    under --json rather than left to make the output unparseable.
    """
    say = quiet(json_output)
    if not _inject_cli_tools(page):
        print("Error: Could not inject tools.", flush=True)
        return None

    items = spec.items(page)
    if not items:
        say(empty, flush=True)
        return _ai_fix_report([], 0, 0)

    fixes, count, unreachable = run_fix_pass(
        page, spec, items=items, max_items=max_items, json_output=json_output)
    _print_fix_result(fixes, count, unreachable, noun, json_output)
    return _ai_fix_report(fixes, count, unreachable)


def _finish_fix(report, json_output):
    """Emit a single fix command's payload and give back its exit status."""
    if report is None:
        return None
    if json_output:
        print(json.dumps(report, indent=2))
    return _ai_exit_status(len(report['fixed']), report['skippedNeedsAi'])


def session_fix_alt(max_images=10, json_output=False):
    """Use Claude to generate alt text for images missing it.

    Takes a screenshot of each image, sends to Claude for description,
    then applies the alt text to the page.

    Example:
      session fix-alt           # Fix up to 10 images
      session fix-alt 5         # Fix up to 5 images
    """
    with connected_page() as page:
        report = _fix_pass_on_page(
            page, ALT_PASS, max_images, "images",
            "No images found missing alt text.", json_output)
    return _finish_fix(report, json_output)


def session_simplify(selector=None, json_output=False):
    """Use Claude to simplify text content for cognitive accessibility.

    Example:
      session simplify                    # Simplify main article content
      session simplify "article"          # Simplify specific element
      session simplify ".content"         # Simplify by CSS selector
    """
    # The two progress lines below go through `say`, which is `print` for a
    # person and a no-op for a caller who asked for --json. They shared stdout
    # with the payload, so `simplify --json` did not parse, the same defect
    # scan had. The "Element not found" and needs-ai lines stay on plain
    # stdout: those are runs that produce no payload at all, and giving them
    # one would be choosing a shape for it rather than refactoring.
    say = quiet(json_output)

    with connected_page() as page:
        if not _inject_cli_tools(page):
            print("Error: Could not inject tools.", flush=True)
            return

        # Find target element
        if selector:
            target_selector = selector
        else:
            # Try common content selectors
            for sel in ['article', 'main', '.content', '.post-content', '#content', 'body']:
                if page.query_selector(sel):
                    target_selector = sel
                    break
            else:
                target_selector = 'body'

        # Get original text
        original = page.evaluate(_js("session_simplify_original.js"), target_selector)

        if not original:
            print(f"Element not found: {target_selector}", flush=True)
            return

        say(f"Simplifying text in {target_selector}...", flush=True)
        say(f"Original length: {len(original)} chars", flush=True)

        # Call Claude to simplify
        prompt = f"""Simplify this text for someone with cognitive disabilities or limited reading ability.
Use:
- Shorter sentences (under 15 words each)
- Common, everyday words
- Active voice
- Clear paragraph breaks
- Bullet points for lists

Keep the same meaning and all important information.

Text to simplify:
{original[:4000]}

Return ONLY the simplified text, maintaining paragraph structure."""

        simplified = claude_answer(ask_claude_text(prompt, timeout=120))
        if simplified is None:
            print(NEEDS_AI_LINE, flush=True)
            return AI_UNAVAILABLE_EXIT

        def render():
            print(f"\nSimplified ({len(simplified)} chars):", flush=True)
            print("─" * 50, flush=True)
            print(simplified[:1000])
            if len(simplified) > 1000:
                print(f"... [{len(simplified) - 1000} more chars]")
            print("─" * 50, flush=True)

        emit({'original': original[:500], 'simplified': simplified},
             render, json_output)

        # Optionally apply to page (create overlay or replace)
        # For now just return - user can copy/paste or we add --apply flag later


LABEL_CONTEXT_JS = _js("label_context.js")


def _label_prompt(page, item):
    """The label prompt, or None when the page gave back no context to use."""
    context = page.evaluate(LABEL_CONTEXT_JS, item.get('selector', ''))
    if not context:
        return None
    return f"""Generate an accessible label for this interactive element.
The label should be concise (2-5 words) and describe what happens when activated.

Element: {context['tag']}
Type: {context.get('type', 'unknown')}
Link target: {context.get('href', 'N/A')}
Content: {context.get('innerHTML', '')[:100]}
Surrounding text: {context.get('nearby', '')[:150]}

Return ONLY the label text, nothing else."""


# aria-label="" is not a label. It used to be written on every failed call, and
# counted, which left the control exactly as unusable as it started while the
# run reported a fix. run_fix_pass is where that is refused now.
LABEL_PASS = FixPass(
    items=_auditor_items("labels", "links", "buttons", "inputs"),
    locate=lambda page, item, i: page.query_selector(item.get('selector', '')),
    prompt=_label_prompt,
    call="text",
    timeout=30,
    cap=lambda v: v[:50],
    write="(data) => {\n"
          "    const el = document.querySelector(data.selector);\n"
          "    if (el) {\n"
          "        el.setAttribute('aria-label', data.value);\n"
          "        if (el.tagName === 'A' && !el.textContent.trim()) {\n"
          "            el.title = data.value;\n"
          "        }\n"
          "    }\n"
          "}",
    field="label",
    progress=FixProgress(
        header=lambda items, count: f"\nGenerating labels for {count} elements...",
        begin=lambda i, count, item, sel: f"  [{i+1}/{count}] {sel}...",
        missing=lambda i, item, sel: "not found",
        no_input=lambda i, item, sel: "no context",
        unanswered=lambda i, item, sel: NEEDS_AI_LINE,
        applied=lambda i, item, sel, value: f"✓ \"{value}\"",
        failed=lambda i, item, sel, error: f"error: {error}",
    ),
)


def session_fix_labels(max_elements=10, json_output=False):
    """Use Claude to generate labels for unlabeled interactive elements.

    Example:
      session fix-labels          # Fix up to 10 elements
      session fix-labels 5        # Fix up to 5 elements
    """
    with connected_page() as page:
        report = _fix_pass_on_page(
            page, LABEL_PASS, max_elements, "elements",
            "No unlabeled elements found.", json_output)
    return _finish_fix(report, json_output)


def session_fix_all(json_output=False):
    """Run all AI fixes: alt text, labels.

    Example:
      session fix-all
    """
    say = quiet(json_output)
    with connected_page() as page:
        say("\n=== Fixing Alt Text ===", flush=True)
        alt = _fix_pass_on_page(
            page, ALT_PASS, 10, "images",
            "No images found missing alt text.", json_output)
        say("\n=== Fixing Labels ===", flush=True)
        labels = _fix_pass_on_page(
            page, LABEL_PASS, 10, "elements",
            "No unlabeled elements found.", json_output)
        say("\n=== Done ===", flush=True)

    if alt is None or labels is None:
        return

    # One document, not two. Running the halves as commands had each of them
    # emit its own payload, so `--json` wrote two objects to stdout and parsed
    # as neither. The top level keeps the three keys and the types a single
    # fix command emits, so a caller that reads one reads this; `passes` holds
    # each half unchanged for a caller that wants them apart.
    combined = {
        'fixed': alt['fixed'] + labels['fixed'],
        'attempted': alt['attempted'] + labels['attempted'],
        'skippedNeedsAi': alt['skippedNeedsAi'] + labels['skippedNeedsAi'],
        'passes': {'alt': alt, 'labels': labels},
    }
    if json_output:
        print(json.dumps(combined, indent=2))

    # Either half falling short is enough. A run that captioned the images and
    # labelled none of the controls did not do what fix-all names, and summing
    # what each half could not reach says exactly that.
    return _ai_exit_status(len(combined['fixed']), combined['skippedNeedsAi'])


# ------------------------------------------------------------
# The six AI sub-passes inside `scan`
#
# They share one wording for a failed call and one for an item that raised,
# and each keeps its own success line, so a scan reads the way it always has.
# ------------------------------------------------------------

def _scan_unanswered(i, item, selector):
    return f"        ✗ {str(selector)[:30]}: {NEEDS_AI_LINE}"


def _scan_failed(i, item, selector, error):
    return f"        ✗ {selector[:30]}: {error}"


SCAN_IMAGE_PASS = FixPass(
    locate=lambda page, item, i: page.query_selector(item['selector']),
    shot=lambda item, i: OUT / f"scan_img_{i}.png",
    prompt=lambda page, item: (
        "Describe this image for a blind user. Write concise alt text "
        "(1-2 sentences). Return ONLY the alt text."),
    call="vision",
    cap=lambda v: v[:200],
    write="(d) => { const e = document.querySelector(d.selector);"
          " if(e) e.alt = d.value; }",
    field="alt",
    progress=FixProgress(
        header=lambda items, count: f"      Fixing {count} images...",
        applied=lambda i, item, sel, value: (
            f"        ✓ {sel[:30]}... → \"{value[:40]}...\""),
        failed=_scan_failed,
        unanswered=_scan_unanswered,
    ),
)


CANVAS_ITEMS_JS = _js("canvas_items.js")


SCAN_CANVAS_PASS = FixPass(
    items=lambda page: page.evaluate(CANVAS_ITEMS_JS),
    locate=lambda page, item, i: page.query_selector(item['selector']),
    shot=lambda item, i: OUT / f"canvas_{item['index']}.png",
    prompt=lambda page, item: (
        "Describe this canvas graphic for a blind user. What does it show? "
        "Write 1-2 sentences."),
    call="vision",
    cap=lambda v: v[:200],
    write="(d) => {\n"
          "    const c = document.querySelectorAll('canvas')[d.index];\n"
          "    if(c) { c.setAttribute('role', 'img');"
          " c.setAttribute('aria-label', d.value); }\n"
          "}",
    field="description",
    progress=FixProgress(
        header=lambda items, count: f"      Describing {count} canvas elements...",
        applied=lambda i, item, sel, value: (
            f"        ✓ canvas {item['index']+1} → \"{value[:40]}...\""),
        failed=lambda i, item, sel, error: f"        ✗ canvas {item['index']+1}: {error}",
        unanswered=_scan_unanswered,
    ),
)


VIDEO_ITEMS_JS = _js("video_items.js")


VIDEO_SEEK_JS = _js("video_seek.js")


def _video_locate(page, item, i):
    """Park the video on a frame worth describing, then hand back the element."""
    page.evaluate(VIDEO_SEEK_JS, item['index'])
    time.sleep(0.5)
    return page.query_selector(item['selector'])


SCAN_VIDEO_PASS = FixPass(
    items=lambda page: page.evaluate(VIDEO_ITEMS_JS),
    locate=_video_locate,
    shot=lambda item, i: OUT / f"video_frame_{item['index']}.png",
    prompt=lambda page, item: (
        "Describe this video frame for a blind user. What is happening in this "
        "video? Write 1-2 sentences."),
    call="vision",
    cap=lambda v: v[:200],
    write="(d) => { const v = document.querySelectorAll('video')[d.index];"
          " if(v) v.setAttribute('aria-label', d.value); }",
    field="description",
    progress=FixProgress(
        header=lambda items, count: f"      Describing {count} videos...",
        applied=lambda i, item, sel, value: (
            f"        ✓ video {item['index']+1} → \"{value[:40]}...\""),
        failed=lambda i, item, sel, error: f"        ✗ video {item['index']+1}: {error}",
        unanswered=_scan_unanswered,
    ),
)


SCAN_LABEL_CONTEXT_JS = _js("scan_label_context.js")


def _scan_label_prompt(page, item):
    context = page.evaluate(SCAN_LABEL_CONTEXT_JS, item['selector'])
    if not context:
        return None
    return (f"Generate a 2-5 word accessible label for: {json.dumps(context)}. "
            "Return ONLY the label.")


SCAN_LABEL_PASS = FixPass(
    prompt=_scan_label_prompt,
    call="text",
    timeout=30,
    cap=lambda v: v[:50],
    write="(d) => { const e = document.querySelector(d.selector);"
          " if(e) e.setAttribute('aria-label', d.value); }",
    field="label",
    progress=FixProgress(
        header=lambda items, count: f"      Fixing {count} labels...",
        applied=lambda i, item, sel, value: f"        ✓ {sel[:30]}... → \"{value}\"",
        failed=_scan_failed,
        unanswered=_scan_unanswered,
    ),
)


def _scan_simplify_prompt(page, item):
    text = page.evaluate(
        "(sel) => document.querySelector(sel)?.textContent?.trim()?.slice(0, 500)",
        item['selector'])
    if not text:
        return None
    return ("Simplify this text for someone with cognitive disabilities. Use "
            f"short sentences, simple words. Keep the meaning. Text: {text}")


SCAN_SIMPLIFY_PASS = FixPass(
    prompt=_scan_simplify_prompt,
    call="text",
    timeout=45,
    write=_js("scan_simplify_write.js"),
    field="simplified",
    progress=FixProgress(
        header=lambda items, count: (
            f"\n[3b/4] Simplifying {len(items)} complex text blocks..."),
        applied=lambda i, item, sel, value: f"        ✓ {sel[:30]}... simplified",
        failed=_scan_failed,
        unanswered=_scan_unanswered,
    ),
)


def _scan_summarize_prompt(page, item):
    text = page.evaluate(
        "(sel) => document.querySelector(sel)?.textContent?.trim()?.slice(0, 1000)",
        item['selector'])
    if not text:
        return None
    return f"Write a 1-2 sentence summary of this content: {text}"


SCAN_SUMMARIZE_PASS = FixPass(
    prompt=_scan_summarize_prompt,
    call="text",
    timeout=45,
    write=_js("scan_summarize_write.js"),
    field="summary",
    progress=FixProgress(
        header=lambda items, count: (
            f"\n[3c/4] Summarizing {len(items)} long content blocks..."),
        applied=lambda i, item, sel, value: f"        ✓ {sel[:30]}... summary added",
        failed=_scan_failed,
        unanswered=_scan_unanswered,
    ),
)


def session_scan(fix_ai=True, max_ai_fixes=10, json_output=False):
    """Run full accessibility scan and fix issues (like extension does).

    This runs:
    1. axe-core WCAG analysis
    2. Non-AI fixes (duplicate IDs, tabindex, ARIA, lang, etc.)
    3. Additional scans (target="_blank", positive tabindex)
    4. AI fixes (alt text, labels) if enabled

    Example:
      session scan              # Full scan with AI fixes
      session scan --no-ai      # Only non-AI fixes
    """
    # Every progress line below goes through `say`, which is `print` for a
    # person and a no-op for a caller who asked for --json. The payload and the
    # progress share one stdout, so `scan --json` used to emit dozens of human
    # lines ahead of the payload and json.loads failed on the first of them.
    # fix-alt and fix-labels were fixed the same way earlier; scan was missed.
    # The two "Error:" lines are left on plain stdout, which is what those same
    # commands do, because they report that the command could not run at all.
    say = quiet(json_output)

    with connected_page() as page:
        if not _inject_cli_tools(page):
            print("Error: Could not inject tools.", flush=True)
            return

        # The text passes below ask the catalog which text tools the active
        # profile wants. That answer comes from session state, which only a
        # navigation used to set, so those passes ran or not depending on
        # whether a `session go` happened to fall after `session profile`.
        _publish_active_profile(page)

        # Inject axe-core (required for runFullScan)
        axe_script = _get_axe_script()
        if not axe_script:
            print("Error: Could not load axe-core.", flush=True)
            return
        page.add_script_tag(content=axe_script)
        page.wait_for_function("typeof axe !== 'undefined'", timeout=5000)

        say("\n" + "═" * 50, flush=True)
        say("ACCESSIBILITY SCAN", flush=True)
        say("═" * 50, flush=True)

        # Step 1: Run full non-AI scan via JavaScript
        say("\n[1/4] Running axe-core analysis...", flush=True)
        result = page.evaluate("() => window.ai4a11y.runFullScan()")

        violations = result.get('violations', [])
        fixed_non_ai = result.get('fixed', {}).get('nonAi', 0)
        needs_ai = result.get('skipped', {}).get('needsAi', [])

        say(f"      Found {len(violations)} violation types", flush=True)
        for v in violations[:10]:
            say(f"        • {v['id']}: {v['count']} elements", flush=True)
        if len(violations) > 10:
            say(f"        ... and {len(violations) - 10} more", flush=True)

        # Step 2: Report non-AI fixes
        say(f"\n[2/4] Applied {fixed_non_ai} non-AI fixes", flush=True)
        say("      (duplicate IDs, tabindex, ARIA, lang, target=_blank, etc.)", flush=True)

        # Step 3: AI fixes
        ai_fixed = 0
        contrast_fixed = 0
        ai_unreachable = 0

        def ai_pass(spec, items, max_items):
            """Run one AI sub-pass and fold its unanswered count into the scan's.

            Every AI-backed fix below writes its answer straight into the page,
            and each one used to decide on its own what to do when no answer
            came back. A failed call reached those writes as an error sentence
            or as the empty string, which is how images ended up labelled
            "Claude CLI error: ...", controls ended up with aria-label="", and a
            paragraph queued for simplification was replaced with nothing. All
            three were then counted as fixes. run_fix_pass refuses all of that
            in one place now.

            json_output goes on to the pass, so a sub-pass silences its own
            progress under --json the way the rest of scan does.
            """
            nonlocal ai_unreachable
            fixes, _attempted, unreachable = run_fix_pass(
                page, spec, items=items, max_items=max_items,
                json_output=json_output)
            ai_unreachable += unreachable
            return len(fixes)

        if fix_ai and needs_ai:
            say(f"\n[3/4] Processing {len(needs_ai)} AI-required fixes...", flush=True)

            # Group by rule type
            image_fixes = [n for n in needs_ai if 'image' in n['ruleId']
                           or 'img' in n['ruleId'] or n['ruleId'] == 'image-alt']
            label_fixes = [n for n in needs_ai if 'name' in n['ruleId'] or 'label' in n['ruleId']]
            contrast_fixes = [n for n in needs_ai if 'contrast' in n['ruleId']]

            # Fix images
            if image_fixes:
                ai_fixed += ai_pass(SCAN_IMAGE_PASS, image_fixes, max_ai_fixes)

            # Fix canvas elements without descriptions
            canvas_without_desc = SCAN_CANVAS_PASS.items(page)
            if canvas_without_desc and ai_fixed < max_ai_fixes:
                ai_fixed += ai_pass(SCAN_CANVAS_PASS, canvas_without_desc, 3)

            # Fix videos without descriptions (autoVideoDescribe)
            videos_without_desc = SCAN_VIDEO_PASS.items(page)
            if videos_without_desc and ai_fixed < max_ai_fixes:
                # Limit video processing
                ai_fixed += ai_pass(SCAN_VIDEO_PASS, videos_without_desc, 3)

            # Fix labels
            if label_fixes and ai_fixed < max_ai_fixes:
                ai_fixed += ai_pass(SCAN_LABEL_PASS, label_fixes,
                                    max_ai_fixes - ai_fixed)

            # Fix contrast issues. This pass picks black or white from the
            # computed background luminance and calls no model, so its successes
            # are counted apart from the model-derived ones. Folding them in
            # overstated the AI work and let a run where every model call failed
            # still look like it had fixed something.
            if contrast_fixes and ai_fixed + contrast_fixed < max_ai_fixes:
                remaining = max_ai_fixes - ai_fixed - contrast_fixed
                count = min(len(contrast_fixes), remaining, 5)  # Limit contrast fixes
                say(f"      Fixing {count} contrast issues...", flush=True)
                for fix in contrast_fixes[:count]:
                    selector = fix['selector']
                    try:
                        # Get current colors
                        colors = page.evaluate(_js("session_scan_contrast_colors.js"), selector)
                        if not colors:
                            continue
                        # Simple fix: make text black or white based on background
                        # (AI-based fix would be better but this is faster)
                        page.evaluate(_js("session_scan_contrast_fix.js"), {'s': selector})
                        contrast_fixed += 1
                        say(f"        ✓ {selector[:30]}... contrast fixed", flush=True)
                    except Exception as e:
                        say(f"        ✗ {selector[:30]}: {e}", flush=True)

            say(f"      Applied {ai_fixed} AI fixes, {contrast_fixed} local contrast fixes",
                flush=True)
        elif not fix_ai:
            say("\n[3/4] Skipping AI fixes (--no-ai)", flush=True)
        else:
            say("\n[3/4] No AI fixes needed", flush=True)

        # Text processing (cognitive profile features)
        text_simplified = 0
        text_summarized = 0
        text_processing = result.get('textProcessing', {})

        if text_processing.get('simplify'):
            text_simplified = ai_pass(
                SCAN_SIMPLIFY_PASS, text_processing['simplify'], 5)

        if text_processing.get('summarize'):
            text_summarized = ai_pass(
                SCAN_SUMMARIZE_PASS, text_processing['summarize'], 3)

        # Step 4: Summary
        total_fixed = fixed_non_ai + contrast_fixed + ai_fixed

        def render():
            print("\n[4/4] Summary", flush=True)
            print("─" * 50, flush=True)
            print(f"      Violations found:  {sum(v['count'] for v in violations)}", flush=True)
            print(f"      Non-AI fixes:      {fixed_non_ai + contrast_fixed}", flush=True)
            print(f"      AI fixes:          {ai_fixed}", flush=True)
            if text_simplified > 0:
                print(f"      Text simplified:   {text_simplified}", flush=True)
            if text_summarized > 0:
                print(f"      Summaries added:   {text_summarized}", flush=True)
            print(
                f"      Total fixed:       {total_fixed + text_simplified + text_summarized}",
                flush=True)
            if ai_unreachable:
                print(f"      Skipped, needs AI: {ai_unreachable}", flush=True)
            print("═" * 50 + "\n", flush=True)

        ai_applied = ai_fixed + text_simplified + text_summarized
        emit({
            'violations': violations,
            'fixed': {'nonAi': fixed_non_ai + contrast_fixed, 'ai': ai_fixed,
                      'total': total_fixed},
            'textProcessing': {'simplified': text_simplified, 'summarized': text_summarized},
            'skippedNeedsAi': ai_unreachable,
            'remaining': len(needs_ai) - ai_fixed if needs_ai else 0
        }, render, json_output)

        return _ai_exit_status(ai_applied, ai_unreachable)


if __name__ == "__main__":
    # The dispatcher moved to cli.py (one Typer app for the whole CLI).
    sys.stderr.write("Run `ai4a11y` (or `python -m cli.cli`) instead of this file.\n")
    sys.exit(2)
