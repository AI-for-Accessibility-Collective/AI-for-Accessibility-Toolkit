"""
ai4a11y — vision-accessible web agent for BLV users.

A persistent Chromium + Claude Code AI layer. The BLV user drives Chromium directly
with their screen reader; ai4a11y is called from Claude Code when something's visual-only.

Primary usage — persistent session (the BLV user's daily browser + AI lens):

  ai4a11y session start                            # launch fullscreen Chromium (persistent)
  ai4a11y session stop                             # kill it
  ai4a11y session status                           # url + title of focused tab
  ai4a11y session tabs                             # list every open tab, mark focused

  # Instant DOM/keyboard primitives (no Claude call, <1s):
  ai4a11y session go <url>                         # navigate focused tab
  ai4a11y session back                             # browser back
  ai4a11y session scroll [down|up] [amount]
  ai4a11y session tab [back]                       # Tab / Shift+Tab
  ai4a11y session activate                         # Enter on focused element
  ai4a11y session focused                          # report document.activeElement
  ai4a11y session list [headings|links|buttons|forms|landmarks|focusables|images|tables]
  ai4a11y session find "<text>"                    # body text + element attrs
  ai4a11y session read [selector]                  # Readability-style article extraction
  ai4a11y session tables                           # alias: list tables
  ai4a11y session audit [--json]                   # run axe-core WCAG accessibility audit

  # Vision-backed primitives (one Claude call each, ~15-40s):
  ai4a11y session describe                         # BLV-friendly page summary
  ai4a11y session ask "<question>"                 # Q&A on current tab
  ai4a11y session tap "<target>"                   # text-grounded click (vision fallback)
  ai4a11y session type "<field>" "<text>"          # click field + type
  ai4a11y session hover "<target>"                 # hover + read tooltip/popover
  ai4a11y session drag "<from>" "<to>"             # drag between two named targets
  ai4a11y session diff                             # what changed since last baseline

  # Heavy autonomous mode (rare, 1-5 min):
  ai4a11y session do "<task>" [min_int] [max_steps]

Command-line parsing lives in cli.py (the `ai4a11y` Typer app); this module
is the engine. The old one-shot mode (fresh browser per run) is not exposed
as a command; the run() and run_agent() functions remain importable.
"""

# config: paths, exit statuses, session state, and the script loaders.
from .config import (  # noqa: F401
    _CLI_DIR,
    OUT,
    _CLI_TOOLS_BUNDLE,
    _READABILITY_PATH,
    _JS_DIR,
    _JS_CACHE,
    _js,
    quiet,
    emit,
    warn,
    _get_readability_script,
    _SESSION_STATE_FILE,
    _get_session_state,
    _save_session_state,
    _get_active_profile,
    _set_active_profile,
    _get_cli_tools_script,
    _IRIS_GROUND_MODEL,
    _IRIS_VISION_MODEL,
    _IRIS_VISION_EFFORT,
    AI_UNAVAILABLE_EXIT,
    SESSION_MISMATCH_EXIT,
    NO_SESSION_EXIT,
    NEEDS_AI_LINE,
    SESSION_DIR,
    SESSION_FILE,
    CDP_PORT,
    USER_DATA_DIR,
    _AXE_BUNDLE_PATH,
    _AXE_CDN,
    _get_axe_script,
)

# ai: the Claude subprocess calls and the generic fix engine.
from .ai import (  # noqa: F401
    _IRIS_SYSTEM_PROMPT,
    _claude_cli_args,
    _claude_cli_env,
    _safe_screenshot,
    _AI_FAILED_KEY,
    _ai_failure,
    claude_answer,
    _ai_fix_report,
    _print_fix_result,
    _ai_exit_status,
    FixProgress,
    FixPass,
    run_fix_pass,
    ask_claude,
    ask_claude_text,
)

# page: everything that reads or draws on a live page.
from .page import (  # noqa: F401
    _inject_cli_tools,
    _publish_active_profile,
    _withdraw_active_profile,
    _auto_apply_saved_profile,
    _ai_callbacks_exposed,
    _expose_ai_callbacks,
    _inject_with_ai,
    add_som_markers,
    add_grid_overlay,
    create_diff_image,
    capture_sequence,
    save_sequence_mosaic,
    get_screenshot_hash,
    wait_for_stable,
    get_elements,
    get_interactables_full,
    state_snapshot,
    describe_state_diff,
    extract_data,
    get_page_context,
    get_a11y_outline,
    get_visible_text,
    verify_action,
    smart_scroll,
    grid_hover,
)

# browser: the persistent session and its Chromium connection.
from .browser import (  # noqa: F401
    create_browser,
    _chromium_path,
    NoSession,
    ForeignBrowser,
    _cdp_browser_id,
    _read_session,
    session_start,
    _page_focus_state,
    _pick_focused_page,
    _LAST_TAB_FILE,
    _page_target_id,
    _read_last_tab,
    _write_last_tab,
    _find_page_by_target_id,
    session_connect,
    session_disconnect,
    connected_page,
    session_stop,
    session_status,
)

# agent: the autonomous loop and its action handlers.
from .agent import (  # noqa: F401
    _dispatch_action,
    plan_task,
    run_agent,
    _act_fullpage,
    _act_scroll,
    _act_grid,
    _act_diff,
    _act_track,
    _act_describe,
    _act_read,
    _act_ask,
    _act_hover,
    _act_click,
    _act_play,
    _act_drag,
    _act_key,
    TERMINAL_ACTIONS,
    ACTION_HANDLERS,
    run,
)

# commands: the session commands and the specs that configure the fix engine.
from .commands import (  # noqa: F401
    _auditor_items,
    session_tabs,
    session_focus_tab,
    session_cleanup_tabs,
    session_go,
    session_back,
    session_scroll,
    session_describe,
    _focused_info,
    _announce,
    session_tab,
    session_activate,
    session_key,
    session_arrow,
    session_list,
    session_find,
    session_read,
    session_list_tables,
    session_audit,
    session_ask,
    session_nudge,
    session_pickdate,
    session_type,
    _tap_click_and_diff,
    session_tap,
    _text_ground_one,
    _scroll_into_view,
    _text_recovery_scroll,
    session_hover,
    session_drag,
    session_diff,
    session_focused,
    session_dismiss,
    session_summary,
    session_heading,
    session_skip,
    session_media,
    session_screenshot,
    session_report,
    session_do,
    session_enable,
    session_disable,
    session_tools,
    session_profile,
    session_profiles,
    AUDITOR_JS,
    run_auditor,
    _audit,
    session_find_missing_alt,
    session_find_missing_labels,
    session_find_poor_contrast,
    session_find_missing_captions,
    session_find_all,
    _alt_locate,
    ALT_PASS,
    session_fix_alt,
    session_simplify,
    LABEL_CONTEXT_JS,
    _label_prompt,
    LABEL_PASS,
    session_fix_labels,
    session_fix_all,
    _scan_unanswered,
    _scan_failed,
    SCAN_IMAGE_PASS,
    CANVAS_ITEMS_JS,
    SCAN_CANVAS_PASS,
    VIDEO_ITEMS_JS,
    VIDEO_SEEK_JS,
    _video_locate,
    SCAN_VIDEO_PASS,
    SCAN_LABEL_CONTEXT_JS,
    _scan_label_prompt,
    SCAN_LABEL_PASS,
    _scan_simplify_prompt,
    SCAN_SIMPLIFY_PASS,
    _scan_summarize_prompt,
    SCAN_SUMMARIZE_PASS,
    session_scan,
)

# The engine's public surface.
#
# These 59 names are what the package is used through: every name `cli/cli.py`
# reaches as `_engine().<name>`, plus the four more that `cli/tests/` reaches.
# Computed from those two callers, not chosen by hand.
#
# The other 127 names the single-module engine exposed are imported above and
# stay importable by name, so any import that worked before the split still
# works. They are internal, so they are not named here.
#
# __all__ is read only by `from ai4a11y import *`, which nothing in cli/ does.
# Compatibility comes from the explicit imports above, not from this list. The
# imports stay explicit rather than wildcards so a reader can check that the
# split moved names and did not change them.
#
# One thing this does change, stated because the commit that added the list
# said the opposite: a star import is narrower than it was. The single-module
# engine declared no __all__, which is not the same as having no star-import
# behavior: it exported every name that did not start with an underscore, 103
# of them, `json` and `re` among them. That set is now 59. Nothing in this
# repository imports that way, and the distribution ships `cli*` and `tools*`,
# so an installed consumer reaches this as `cli.ai4a11y` and gets each name by
# name; the narrowing is the intent, and none of it is lost.
__all__ = [
    "AI_UNAVAILABLE_EXIT",
    "SESSION_MISMATCH_EXIT",
    "NO_SESSION_EXIT",
    "NEEDS_AI_LINE",
    "ask_claude",
    "ask_claude_text",
    "NoSession",
    "ForeignBrowser",
    "session_start",
    "session_stop",
    "session_status",
    "session_tabs",
    "session_focus_tab",
    "session_cleanup_tabs",
    "session_go",
    "session_back",
    "session_scroll",
    "session_describe",
    "session_tab",
    "session_activate",
    "session_key",
    "session_arrow",
    "session_list",
    "session_find",
    "session_read",
    "session_list_tables",
    "session_audit",
    "session_ask",
    "session_nudge",
    "session_pickdate",
    "session_type",
    "session_tap",
    "session_hover",
    "session_drag",
    "session_diff",
    "session_focused",
    "session_dismiss",
    "session_summary",
    "session_heading",
    "session_skip",
    "session_media",
    "session_screenshot",
    "session_report",
    "session_do",
    "session_enable",
    "session_disable",
    "session_tools",
    "session_profile",
    "session_profiles",
    "session_find_missing_alt",
    "session_find_missing_labels",
    "session_find_poor_contrast",
    "session_find_missing_captions",
    "session_find_all",
    "session_fix_alt",
    "session_simplify",
    "session_fix_labels",
    "session_fix_all",
    "session_scan",
]
