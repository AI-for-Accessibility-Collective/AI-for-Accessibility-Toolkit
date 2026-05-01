"""
skill_loader.py — Lazy skill detection for BrowserMind Text.

Mirrors how browser-harness exposes domain skills via goto_url():
  - Domain skills: detected from current URL, names only (content loaded on demand)
  - Interaction skills: detected from request keywords

Called before run_turn() to populate session context hints.
"""

import os
import sys
from pathlib import Path
from urllib.parse import urlparse

HARNESS_DIR = Path(
    os.environ.get(
        "BROWSER_HARNESS_DIR",
        str(Path(__file__).resolve().parents[2] / "browser-harness"),
    )
)
DOMAIN_SKILLS_DIR = HARNESS_DIR / "domain-skills"
INTERACTION_SKILLS_DIR = HARNESS_DIR / "interaction-skills"

# Keywords that suggest a specific interaction skill is needed
INTERACTION_KEYWORDS: dict[str, list[str]] = {
    "dialogs":    ["popup", "modal", "dialog", "alert", "confirm", "dismiss", "beforeunload"],
    "dropdowns":  ["dropdown", "select", "menu", "picker", "option", "combobox"],
    "iframes":    ["iframe", "embed", "frame", "embedded"],
    "uploads":    ["upload", "file", "attach", "drag and drop"],
    "shadow-dom": ["web component", "shadow dom", "custom element"],
    "tabs":       ["new tab", "open tab", "switch tab", "another tab"],
    "scrolling":  ["scroll", "infinite scroll", "load more", "lazy load"],
    "downloads":  ["download", "save file", "save as"],
}


def detect_domain_skills(url: str) -> list[str]:
    """
    Return list of available skill paths for a URL's domain.
    Returns filenames only — content loaded lazily via read_skill() tool.
    Mirrors helpers.py goto_url() behavior exactly.
    """
    if not url or url.startswith("about:") or url.startswith("chrome:"):
        return []
    try:
        hostname = urlparse(url).hostname or ""
        domain = hostname.removeprefix("www.").split(".")[0]
        skill_dir = DOMAIN_SKILLS_DIR / domain
        if not skill_dir.is_dir():
            return []
        return [
            f"{domain}/{p.stem}"
            for p in sorted(skill_dir.rglob("*.md"))[:5]
        ]
    except Exception:
        return []


def detect_interaction_skills(user_request: str) -> list[str]:
    """
    Detect which interaction skills might be relevant from the request text.
    Returns skill names — content loaded lazily via read_skill() tool.
    """
    request_lower = user_request.lower()
    return [
        skill
        for skill, keywords in INTERACTION_KEYWORDS.items()
        if any(kw in request_lower for kw in keywords)
    ]


def list_all_domain_skills() -> list[str]:
    """Return all available domain skill directories (for discovery)."""
    if not DOMAIN_SKILLS_DIR.is_dir():
        return []
    return sorted(d.name for d in DOMAIN_SKILLS_DIR.iterdir() if d.is_dir())


def read_skill_content(skill_path: str) -> dict:
    """
    Read a skill file's content. Used by the read_skill() tool.

    skill_path examples:
      "github/scraping"   → domain-skills/github/scraping.md
      "dialogs"           → interaction-skills/dialogs.md
    """
    # Try domain skill first
    candidate = DOMAIN_SKILLS_DIR / f"{skill_path}.md"
    if not candidate.exists():
        # Try interaction skill
        candidate = INTERACTION_SKILLS_DIR / f"{skill_path}.md"
    if not candidate.exists():
        available_domains = list_all_domain_skills()
        return {
            "error": f"No skill file found for: '{skill_path}'",
            "available_domains": available_domains[:20],
            "available_interaction_skills": [
                p.stem for p in sorted(INTERACTION_SKILLS_DIR.glob("*.md"))
            ] if INTERACTION_SKILLS_DIR.is_dir() else [],
        }
    content = candidate.read_text(encoding="utf-8")
    return {
        "skill_content": content,
        "path": str(candidate.relative_to(HARNESS_DIR)),
        "size_chars": len(content),
    }
