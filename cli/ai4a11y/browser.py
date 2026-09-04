"""The persistent session: one Chromium, kept alive across ai4a11y calls.

This layer owns the session file, the CDP connection, and the question of
which tab is focused. Everything above it asks `connected_page` for a page
and then works through `page.py`.
"""

from playwright.sync_api import sync_playwright
import time
import json
import subprocess
import signal as _signal
import urllib.request
import urllib.parse
import socket
from contextlib import contextmanager
from pathlib import Path

import os as _os

from .config import (
    CDP_PORT,
    SESSION_DIR,
    SESSION_FILE,
    SESSION_MISMATCH_EXIT,
    USER_DATA_DIR,
)


# ============================================================
# BROWSER — factory
# ============================================================

def create_browser(stealth=False, visible=False):
    """Launch Playwright Chromium with optional stealth or visible (fullscreen) mode."""
    p = sync_playwright().start()

    args = ['--disable-blink-features=AutomationControlled']
    if stealth:
        args.extend(['--disable-infobars', '--disable-dev-shm-usage',
                     '--no-sandbox', '--disable-setuid-sandbox'])
    if visible:
        args.append('--start-fullscreen')

    browser = p.chromium.launch(headless=not visible, args=args)

    context_opts = {'viewport': {'width': 1280, 'height': 800}}
    if stealth:
        context_opts['user_agent'] = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
                                      'AppleWebKit/537.36 (KHTML, like Gecko) '
                                      'Chrome/122.0.0.0 Safari/537.36')

    context = browser.new_context(**context_opts)
    page = context.new_page()

    if stealth:
        page.add_init_script("delete Object.getPrototypeOf(navigator).webdriver")

    return p, browser, page


def _chromium_path():
    """Find a chromium executable: Playwright bundled first, then system Chrome."""
    p = None
    try:
        p = sync_playwright().start()
        exe = p.chromium.executable_path
        if exe and Path(exe).exists():
            return exe
    except Exception:
        pass
    finally:
        if p:
            try:
                p.stop()
            except Exception:
                pass
    for candidate in [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        "/usr/bin/google-chrome",
        "/usr/bin/chromium-browser",
    ]:
        if Path(candidate).exists():
            return candidate
    raise RuntimeError("No Chrome/Chromium found")


class NoSession(RuntimeError):
    """No session has been started, so there is no browser to talk to."""


class ForeignBrowser(RuntimeError):
    """The browser on the recorded port is not the one this session started.

    `stale` says whether the recorded browser is known to be gone. When it is,
    the session file describes nothing and can be dropped. When it is not, the
    file is the only handle the user has on whatever is still running, so it
    stays and the message tells them what to do with it.
    """

    def __init__(self, message, stale=False):
        super().__init__(message)
        self.stale = stale


def _cdp_browser_id(cdp, timeout=1):
    """The browser's own id from its CDP endpoint, or None if nothing answers.

    Chrome puts a fresh uuid in webSocketDebuggerUrl every time it launches, and
    no two browsers share one. That is what separates "the browser this session
    started" from "whatever else is listening on this port", which matters
    because the default here is 9222, the port every DevTools Protocol client
    reaches for first.
    """
    try:
        with urllib.request.urlopen(f"{cdp}/json/version", timeout=timeout) as response:
            ws = json.loads(response.read()).get('webSocketDebuggerUrl', '')
    except Exception:
        return None
    return ws.rsplit('/', 1)[-1] or None


def _read_session(verify=True):
    """The recorded session, after checking the browser is still the same one.

    A session file names a pid and a port, and neither identifies a browser. Pids
    are handed out again once the number space wraps, so `session stop` reading
    one at face value can signal a process that has nothing to do with this tool.
    A port says even less: connect to it unverified and the CLI drives someone
    else's browser, on their tabs.
    """
    if not SESSION_FILE.exists():
        raise NoSession("No session running. Start one with: ai4a11y session start")
    info = json.loads(SESSION_FILE.read_text())
    if not verify:
        return info
    if not info.get('browser'):
        # Written before session files carried a browser id. There is no way to
        # tell whether the browser on that port is this session's, so say that
        # rather than guess in either direction.
        raise ForeignBrowser(
            f"This session file predates browser identity, so what is on "
            f"{info.get('cdp')} cannot be matched to it. Nothing was touched. "
            f"Quit that browser yourself, delete {SESSION_FILE}, and run "
            "'ai4a11y session start'."
        )
    live = _cdp_browser_id(info.get('cdp', ''), timeout=5)
    if live is None and _port_is_listening(info.get('cdp', '')):
        # Something holds the port but did not answer in time: a busy browser,
        # most likely this session's. Saying it is gone would drop the only
        # handle on it, so keep the file and say what happened instead.
        raise ForeignBrowser(
            f"The browser on {info.get('cdp')} did not answer within 5 seconds, "
            "so it could not be matched to this session. Nothing was touched. "
            "Try again in a moment."
        )
    if live is None or live != info.get('browser'):
        raise ForeignBrowser(
            "The browser this session recorded is gone, and what is on "
            f"{info.get('cdp')} now is not the browser it started. Nothing was "
            "touched. Run 'ai4a11y session start' for a new one.",
            stale=True,
        )
    return info


def _port_is_listening(cdp):
    """True if something accepts a TCP connection on the CDP endpoint's port."""
    try:
        parts = urllib.parse.urlsplit(cdp)
        with socket.create_connection((parts.hostname or '127.0.0.1', parts.port or 9222), timeout=1):
            return True
    except OSError:
        return False


def session_start():
    """Launch detached Chromium with CDP port. Survives after this Python process exits."""
    SESSION_DIR.mkdir(exist_ok=True)
    if SESSION_FILE.exists():
        existing = json.loads(SESSION_FILE.read_text())
        # A recorded pid that is still alive proves nothing on its own: it may
        # have been recycled. The browser has to answer to its own recorded id.
        if (existing.get('browser')
                and _cdp_browser_id(existing.get('cdp', '')) == existing['browser']):
            print(f"Session already running (pid {existing['pid']}). Use 'session stop' first or just reuse.", flush=True)
            return existing
        if not existing.get('browser') and _cdp_browser_id(existing.get('cdp', '')):
            # A session file from before browser ids, with something still on
            # the port. Launching now would fail confusingly: the new browser
            # cannot bind the port and its CDP endpoint never comes up.
            raise ForeignBrowser(
                f"A browser is already on {existing.get('cdp')} from a session "
                f"file that predates browser identity. Quit it yourself and "
                f"delete {SESSION_FILE}, then start again."
            )

    exe = _chromium_path()
    proc = subprocess.Popen(
        [exe,
         f"--remote-debugging-port={CDP_PORT}",
         f"--user-data-dir={USER_DATA_DIR}",
         "--start-fullscreen",
         "--no-first-run",
         "--no-default-browser-check",
         "https://www.google.com"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        start_new_session=True,  # detach from current process group
    )
    # Wait for CDP endpoint to come up
    for _ in range(30):
        time.sleep(0.3)
        try:
            urllib.request.urlopen(f"http://localhost:{CDP_PORT}/json/version", timeout=1)
            break
        except Exception:
            continue
    else:
        raise RuntimeError("Chromium started but CDP endpoint never came up")

    cdp = f"http://localhost:{CDP_PORT}"
    info = {"pid": proc.pid, "cdp": cdp,
            "browser": _cdp_browser_id(cdp),
            "started": time.strftime("%Y-%m-%d %H:%M:%S")}
    SESSION_FILE.write_text(json.dumps(info, indent=2))
    print(f"Session started (pid {proc.pid}, cdp {info['cdp']})", flush=True)
    return info


def _page_focus_state(pg):
    """Return (visible, has_focus, usable) for a page, or (False, False, False) if unreachable.
    visible: document.visibilityState === 'visible' (tab selected in its window)
    has_focus: document.hasFocus() (that document's window is also the OS-foreground window)
    usable: page has non-zero viewport — guards against zombie tabs that report visible
            but have innerWidth===0 (background-navigated tabs that never fully rendered).
    """
    try:
        s = pg.evaluate("({v: document.visibilityState === 'visible', f: document.hasFocus(), u: (innerWidth > 0 && innerHeight > 0)})")
        return bool(s.get('v')), bool(s.get('f')), bool(s.get('u'))
    except Exception:
        return False, False, False


def _pick_focused_page(pages):
    """Return the single tab the user is most likely looking at (or None if no pages).

    Priority:
      1. visible AND has OS focus  — user is currently in Chromium; exact match
      2. visible only              — user switched away from Chromium but tab is selected
                                     in its window. If multiple (several windows open),
                                     pick the most recent (last in list) as heuristic.
      3. last page                 — last-resort fallback

    Returns same page type as input. Used by both session_connect (for operations)
    and session_tabs (for the → display marker) so they stay in sync.
    """
    if not pages:
        return None
    visible = []
    fully_focused = []
    for pg in pages:
        v, f, u = _page_focus_state(pg)
        if not u:
            # Zombie tab (innerWidth=0, never rendered) — skip. page.evaluate would
            # work but every coord is meaningless; picking this page guarantees failures.
            continue
        if v and f:
            fully_focused.append(pg)
        elif v:
            visible.append(pg)
    if fully_focused:
        return fully_focused[-1]
    if visible:
        return visible[-1]
    # Last-resort: any page in the list (may still be zombie, but we have nothing better).
    return pages[-1]


_LAST_TAB_FILE = SESSION_DIR / "last_tab.json"


def _page_target_id(page):
    """Return the CDP targetId for a Playwright page, or '' on error.
    The targetId is stable across CDP reconnects to the same underlying tab, so it
    survives ai4a11y.s per-CLI-invocation connect/disconnect cycle — unlike Playwright's
    in-process page objects which are recreated each run.
    """
    try:
        cdp = page.context.new_cdp_session(page)
        info = cdp.send("Target.getTargetInfo")
        try:
            cdp.detach()
        except Exception:
            pass
        return (info.get('targetInfo') or {}).get('targetId', '') or ''
    except Exception:
        return ''


def _read_last_tab():
    try:
        if _LAST_TAB_FILE.exists():
            return json.loads(_LAST_TAB_FILE.read_text())
    except Exception:
        pass
    return None


def _write_last_tab(page):
    """Remember which tab ai4a11y just operated on. Next session_connect will prefer
    this tab if it still exists, so ai4a11y doesn't flip-flop between tabs when the user
    has multiple Chromium windows and OS focus drifts between ai4a11y CLI invocations."""
    try:
        tid = _page_target_id(page)
        if not tid:
            return
        _LAST_TAB_FILE.write_text(json.dumps({
            'target_id': tid,
            'url': page.url,
            'ts': time.time(),
        }, indent=2))
    except Exception:
        pass


def _find_page_by_target_id(pages, target_id):
    """Linear search pages for one whose CDP targetId matches. O(n) CDP calls in the
    worst case, but typical sessions have <10 tabs so it's fast (~50ms total)."""
    if not target_id:
        return None
    for pg in pages:
        try:
            if _page_target_id(pg) == target_id:
                return pg
        except Exception:
            continue
    return None


def session_connect():
    """Connect Playwright to the running CDP browser. Returns (p, browser, page).

    Tab selection priority (fixes the cross-CLI focus-drift bug):
      1. Sticky:   the tab ai4a11y last operated on, IF it still exists and is visible
                   (user hasn't backgrounded it explicitly).
      2. Focused:  _pick_focused_page heuristic (visible + has-OS-focus, then visible-
                   only, then last page). Used when the sticky tab is gone/hidden.

    Does NOT call bring_to_front — ai4a11y is a passive assistant, not a focus thief.
    The selected tab is persisted to ~/.ai4a11y/last_tab.json so subsequent ai4a11y calls
    stay on the same tab even if OS focus drifts to a different window between calls.
    """
    info = _read_session()
    p = sync_playwright().start()
    browser = p.chromium.connect_over_cdp(info['cdp'])
    contexts = browser.contexts
    if not contexts:
        raise RuntimeError("No browser context found")

    all_pages = []
    for c in contexts:
        all_pages.extend(c.pages)

    if not all_pages:
        page = contexts[0].new_page()
        _write_last_tab(page)
        return p, browser, page

    # Try sticky first — prefer the tab ai4a11y most recently touched.
    # Sticky honors the user's working-tab choice even if Chrome's visible window
    # has drifted. If the sticky tab reports innerWidth==0 (not the front tab in
    # its Chrome window), we:
    #   1. bring_to_front() to wake it up
    #   2. set_viewport_size() to force a concrete viewport regardless of Chrome's
    #      own decision — needed because CDP won't recompute innerWidth for
    #      background tabs on some macOS setups even after bring_to_front.
    # Only drop sticky if the page is truly dead (throws or returns no state).
    picked = None
    last = _read_last_tab()
    if last and last.get('target_id'):
        cand = _find_page_by_target_id(all_pages, last['target_id'])
        if cand is not None:
            _vis, _focused, usable = _page_focus_state(cand)
            if not usable:
                try:
                    cand.bring_to_front()
                    time.sleep(0.2)
                    cand.set_viewport_size({'width': 1280, 'height': 800})
                    time.sleep(0.2)
                    _vis2, _f2, usable = _page_focus_state(cand)
                except Exception:
                    usable = False
            if usable:
                picked = cand

    if picked is None:
        picked = _pick_focused_page(all_pages)
        # Only update sticky when we fell through to auto-pick AND there was no
        # user-explicit sticky already. Preserves `session focus <n>` choices
        # even if the picked tab's viewport is temporarily unusable (e.g. not
        # the front Chrome tab). Otherwise status/list/tabs reads would clobber
        # the user's pin the first time the targeted tab isn't front-of-window.
        if not (last and last.get('target_id')):
            _write_last_tab(picked)
    else:
        _write_last_tab(picked)
    return p, browser, picked


def session_disconnect(p, browser):
    """Detach Playwright without closing the browser — keeps CDP server alive."""
    try:
        browser.close()  # closes the CDP connection, not the underlying browser
    except Exception:
        pass
    try:
        p.stop()
    except Exception:
        pass


@contextmanager
def connected_page():
    """Yield the session's focused page, detaching cleanly whatever happens.

    Every session command needs the same three lines to open a connection and
    the same two to close it. Written out at each call site, the close was one
    early return away from being skipped, which leaks a websocket into the
    user's browser for the rest of its life. Here it cannot be skipped.
    """
    p, browser, page = session_connect()
    try:
        yield page
    finally:
        session_disconnect(p, browser)


def session_stop():
    """Kill the persistent browser, and only that browser."""
    if not SESSION_FILE.exists():
        print("No session to stop.", flush=True)
        return
    try:
        info = _read_session()
    except ForeignBrowser as ex:
        # Signalling the recorded pid here is how an unrelated process gets
        # killed: the browser exited, the number came round again, and someone
        # else's program is now holding it. Drop the stale file instead.
        print(str(ex), flush=True)
        if ex.stale:
            SESSION_FILE.unlink(missing_ok=True)
        return SESSION_MISMATCH_EXIT
    try:
        _os.kill(info['pid'], _signal.SIGTERM)
        print(f"Killed session pid {info['pid']}", flush=True)
    except ProcessLookupError:
        print("Session process already gone.", flush=True)
    SESSION_FILE.unlink(missing_ok=True)


def session_status():
    """Print current page URL/title and basic state."""
    if not SESSION_FILE.exists():
        print("No session running.", flush=True)
        return
    info = _read_session(verify=False)
    try:
        with connected_page() as page:
            print(f"Session pid={info['pid']} started={info['started']}", flush=True)
            print(f"URL: {page.url}", flush=True)
            print(f"Title: {page.title()[:80]}", flush=True)
    except ForeignBrowser:
        raise
    except Exception as ex:
        print(f"Session file exists but connect failed: {ex}", flush=True)
