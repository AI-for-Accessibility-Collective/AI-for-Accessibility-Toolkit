"""Reported selectors must address exactly the element they were derived from.

The fixture plants pairs of classless elements. A selector generator that falls
back to a bare tag name reports the same string twice, and every fix that
consumes those selectors then writes to the first match over and over.
"""

import json

import pytest
from playwright.sync_api import sync_playwright

from conftest import FIXTURE_URL, CliRunner

pytestmark = pytest.mark.browser


@pytest.fixture(scope="module", autouse=True)
def _navigate(chromium_session: dict, cli: CliRunner) -> None:
    result = cli("session", "go", FIXTURE_URL)
    assert result.returncode == 0, result.stderr


def _match_counts(env: dict, selectors: list) -> dict:
    """How many elements each selector actually matches on the live page."""
    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp(
            f"http://localhost:{env['AI4A11Y_CDP_PORT']}"
        )
        try:
            page = [pg for c in browser.contexts for pg in c.pages][0]
            return {
                sel: page.evaluate("(s) => document.querySelectorAll(s).length", sel)
                for sel in selectors
            }
        finally:
            browser.close()


def _selectors(payload: dict, keys: tuple) -> list:
    return [e["selector"] for k in keys for e in payload.get(k, [])]


def test_missing_alt_selectors_address_one_element_each(
    chromium_session: dict, cli: CliRunner
) -> None:
    result = cli("session", "find-alt", "--json")
    assert result.returncode == 0, result.stderr
    selectors = _selectors(json.loads(result.stdout), ("noAlt", "emptyAlt"))

    assert len(selectors) >= 2, "fixture must plant more than one image missing alt"
    assert len(set(selectors)) == len(selectors), f"duplicate selectors: {selectors}"

    counts = _match_counts(chromium_session, selectors)
    assert all(n == 1 for n in counts.values()), counts


def test_missing_label_selectors_address_one_element_each(
    chromium_session: dict, cli: CliRunner
) -> None:
    result = cli("session", "find-labels", "--json")
    assert result.returncode == 0, result.stderr
    selectors = _selectors(json.loads(result.stdout), ("links", "buttons", "inputs"))

    assert len(selectors) >= 2, "fixture must plant more than one unlabeled element"
    assert len(set(selectors)) == len(selectors), f"duplicate selectors: {selectors}"

    counts = _match_counts(chromium_session, selectors)
    assert all(n == 1 for n in counts.values()), counts
