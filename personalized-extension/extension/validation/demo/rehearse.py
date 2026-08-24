#!/usr/bin/env python3
"""Live rehearsal for the booking demo: loads the extension into a disposable
browser, arms the director through its real entry point, walks the storyline's
pages on live booking.com, and reports which beats fired with which numbers.

No agent runs here - this script does the navigating, so it verifies the
verification layer (extractors -> director -> overlay) against the live site
without spending model calls or risking an unattended commit. Nothing is ever
booked: the walk stops at the property page unless --checkout is passed, and
even then it only opens the form; the director stops the run at the gate by
design.

usage: python3 rehearse.py [--headful] [--checkout] [--outdir DIR]
profile: /tmp/booking-demo-profile (disposable, never David's real one).
"""
import argparse
import json
import shutil
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
EXT = HERE.parent.parent          # personalized-extension/extension
PROFILE = "/tmp/booking-demo-profile"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
PROMPT = ("book us a hotel near stanford for sep 15 to 17 - 2 adults and our "
          "8-year-old, and make sure we can cancel if plans change")
ZEN = "https://www.booking.com/hotel/us/the-zen.html?checkin=2026-09-15&checkout=2026-09-17&group_adults=2&group_children=1&age=8&no_rooms=1"
RESULTS = ("https://www.booking.com/searchresults.html?ss=Stanford+University"
           "&checkin=2026-09-15&checkout=2026-09-17&group_adults=2"
           "&group_children=1&age=8&no_rooms=1")


def dismiss_popups(page, rounds=3):
    # Booking pops the Genius sign-in dialog a beat AFTER load, so one sweep
    # is not enough: sweep, wait, sweep again until no focus trap remains.
    for _ in range(rounds):
        for s in ["#onetrust-accept-btn-handler",
                  "button[aria-label='Dismiss sign-in info.']",
                  "button[aria-label='Dismiss sign in information.']",
                  "[data-testid='genius-onboarding-close-button']",
                  "[data-bui-trap-root] button[aria-label*='ismiss']",
                  "[data-bui-trap-root] button[aria-label*='lose']"]:
            try:
                el = page.locator(s).first
                if el.is_visible(timeout=600):
                    el.click(timeout=1500)
                    page.wait_for_timeout(400)
            except Exception:
                pass
        try:
            if not page.locator("[data-bui-trap-root]").first.is_visible(timeout=600):
                return
            page.keyboard.press("Escape")
        except Exception:
            return
        page.wait_for_timeout(900)


def state_of(sw):
    return sw.evaluate("() => globalThis.DemoDirector.state()")


def report(sw, label):
    st = state_of(sw)
    print(f"\n== {label}: idx {st['idx']}, fired {len(st['fired'])}, "
          f"budget {st.get('budget')}, skipped {st.get('skipped', [])}")
    for f in st["fired"]:
        miss = f" [fallback: {','.join(f['missed'])}]" if f.get("missed") else ""
        forced = " [FORCED]" if f.get("forced") else ""
        print(f"  {f['kind']:<10} {f['id']:<14} {f['say'][:84]}{forced}{miss}")
    return st


def force_until(sw, page, target, limit=4):
    """The stage lever: today's live inventory may simply not hold a beat's
    relation (no ad, no one-king closest). Force beats in order, on their
    rehearsal fallbacks, until the target has fired - each force is marked
    in the state, so the report never passes a forced beat off as live."""
    for _ in range(limit):
        st = state_of(sw)
        if any(f["id"] == target for f in st["fired"]):
            return True
        r = sw.evaluate("() => globalThis.DemoDirector.force()")
        print("  forced:", r)
        if not r.get("ok"):
            return False
        page.wait_for_timeout(700)
    return any(f["id"] == target for f in state_of(sw)["fired"])


def answer_widget(sw, page, label=None, wait_s=28):
    """Press the widget's primary (or the option containing `label`).
    Polls: the dialog appears only after the announcement queue drains."""
    sel = ".vd-wrap .vd-do.primary" if not label else f".vd-wrap .vd-do:has-text('{label}')"
    for _ in range(int(wait_s * 2)):
        if page.locator(sel).count():
            page.locator(sel).first.click()
            page.wait_for_timeout(1200)
            return True
        page.wait_for_timeout(500)
    return False


def overlay_probe(page):
    return page.evaluate("""() => ({
      cards: [...document.querySelectorAll('.vd-wrap .vd-card')].map(c => ({
        role: c.getAttribute('role'), text: c.textContent.slice(0, 70) })),
      scrim: !!document.querySelector('.vd-scrim'),
      focus: document.activeElement ? {
        cls: document.activeElement.className,
        text: (document.activeElement.textContent || '').slice(0, 60) } : null,
    })""")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--headful", action="store_true")
    ap.add_argument("--checkout", action="store_true",
                    help="also open the Zen booking form (still never books)")
    ap.add_argument("--manual", action="store_true",
                    help="arm the demo and hand the browser to YOU: navigate "
                         "booking.com yourself (VoiceOver on) and the beats "
                         "fire around your own driving; Ctrl+C here to end")
    ap.add_argument("--outdir", default=str(HERE / "rehearsal"))
    a = ap.parse_args()
    out = Path(a.outdir)
    out.mkdir(parents=True, exist_ok=True)

    # Chrome caches importScripts payloads with the service-worker
    # registration, so a persistent profile keeps running the PREVIOUS build
    # of dist/validation.js after a rebuild - one rehearsal ran stale code
    # for two full passes before this was caught. Clearing the worker and
    # code caches forces fresh code while keeping cookies.
    for sub in ["Default/Service Worker", "Default/Code Cache"]:
        shutil.rmtree(Path(PROFILE) / sub, ignore_errors=True)

    with sync_playwright() as pw:
        # Bundled chromium: branded Chrome dropped --load-extension support,
        # and extensions in headless need the NEW headless (channel chromium).
        ctx = pw.chromium.launch_persistent_context(
            user_data_dir=PROFILE, headless=not a.headful, channel="chromium",
            viewport={"width": 1440, "height": 900}, user_agent=UA,
            locale="en-US", timezone_id="America/Los_Angeles",
            args=[f"--disable-extensions-except={EXT}",
                  f"--load-extension={EXT}",
                  "--disable-blink-features=AutomationControlled"])
        ctx.set_default_timeout(45000)

        sws = ctx.service_workers
        sw = sws[0] if sws else ctx.wait_for_event("serviceworker", timeout=20000)
        time.sleep(1.5)          # let importScripts finish

        armed = sw.evaluate(f"() => globalThis.DemoDirector.maybeArm({json.dumps(PROMPT)})")
        print("armed:", armed)

        page = ctx.pages[0] if ctx.pages else ctx.new_page()

        if a.manual:
            # You are the agent. The director watches your pages and fires
            # the story; widgets pause nothing here (no agent runs), they
            # just wait for your press. The state prints every 15s.
            page.goto("https://www.booking.com/", wait_until="domcontentloaded")
            print("\nmanual mode: browse booking.com yourself. type Stanford in the")
            print("destination box to start the story. Ctrl+C here when done.\n")
            try:
                seen = 0
                while True:
                    time.sleep(15)
                    st = state_of(sw)
                    if len(st["fired"]) != seen:
                        seen = len(st["fired"])
                        report(sw, "so far")
            except KeyboardInterrupt:
                report(sw, "final")
                (out / "rehearsal-state.json").write_text(json.dumps(state_of(sw), indent=1))
                ctx.close()
                return

        # ── the home page: type the destination, let the widget fire ──
        page.goto("https://www.booking.com/", wait_until="domcontentloaded")
        page.wait_for_timeout(2500)
        dismiss_popups(page)
        box = page.locator("input[name='ss']").first
        box.click()
        box.press_sequentially("Stanford", delay=90)
        page.wait_for_timeout(1500)

        # The widget can fire MID-TYPING - the autocomplete shows several
        # Stanfords well before the word is done, the scrim drops, and the
        # page is unclickable until it is answered. That interruption is the
        # product working; the driver answers it the way Susan would.
        if not page.locator(".vd-scrim").count():
            if "Stanford" not in (box.input_value() or ""):
                dismiss_popups(page)
                box.click()
                box.fill("Stanford")
            page.wait_for_timeout(3000)      # autocomplete + facts debounce
        st = report(sw, "home, after typing Stanford")
        print("overlay:", json.dumps(overlay_probe(page)))
        page.screenshot(path=str(out / "rehearsal-home.png"))

        # Answer the stanfords widget the way Susan would - press the primary.
        if page.locator(".vd-wrap .vd-do.primary").count():
            page.locator(".vd-wrap .vd-do.primary").first.click()
            page.wait_for_timeout(800)
            print("answered stanfords:", list(state_of(sw).get("answers", {}).keys()))
            # Answering closed booking's listbox (focus left the box); reopen
            # it and finish the word so the real option can be picked.
            box.click()
            if "Stanford" not in (box.input_value() or ""):
                box.fill("Stanford")
            page.wait_for_timeout(1500)

        # ── results, with the family's dates and occupancy - the search the
        # agent would actually run ──
        page.goto(RESULTS, wait_until="domcontentloaded")
        page.wait_for_timeout(6000)
        dismiss_popups(page)
        page.wait_for_timeout(3000)
        report(sw, "results (family dates)")
        page.screenshot(path=str(out / "rehearsal-results.png"))

        # ad + collision depend on today's inventory; force what live state
        # will not give, then answer the budget widget the way Susan would.
        force_until(sw, page, "collision")
        page.wait_for_timeout(800)
        if answer_widget(sw, page):
            report(sw, "results, after budget answer")
        page.wait_for_timeout(1500)
        if not any(f["id"] == "compare" for f in state_of(sw)["fired"]):
            force_until(sw, page, "compare")
        page.screenshot(path=str(out / "rehearsal-results-2.png"))
        answer_widget(sw, page)          # the Zen

        # ── the Zen's property page: the room widget should fire LIVE ──
        page.goto(ZEN, wait_until="domcontentloaded")
        page.wait_for_timeout(6000)
        dismiss_popups(page)
        page.wait_for_timeout(3000)
        report(sw, "property (the Zen)")
        print("overlay:", json.dumps(overlay_probe(page)))
        page.screenshot(path=str(out / "rehearsal-property.png"))
        answer_widget(sw, page)          # two full beds

        if a.checkout:
            # Reserve the double: set 1 in the first room-count select that
            # has options, then press booking's reserve button. Best-effort -
            # the point is reaching the form, and NOTHING here ever submits it.
            try:
                for i in range(page.locator("select[data-component='hotel/new-rooms-table/select-rooms']").count()):
                    sel = page.locator("select[data-component='hotel/new-rooms-table/select-rooms']").nth(i)
                    try:
                        sel.select_option("1")
                        break
                    except Exception:
                        continue
                page.locator(".hprt-reservation-cta button, button.js-reservation-button").first.click()
                page.wait_for_timeout(9000)
                dismiss_popups(page)
                page.wait_for_timeout(3000)
                report(sw, "checkout (the form)")
                print("overlay:", json.dumps(overlay_probe(page)))
                page.screenshot(path=str(out / "rehearsal-checkout.png"))
                # true-price and details are widgets; answer them, then leave
                # the GATE standing for the screenshot - never answered here,
                # and the site's own submit is never touched.
                for _ in range(3):
                    if any(f["id"] == "gate" for f in state_of(sw)["fired"]):
                        break
                    if not answer_widget(sw, page):
                        break
                    page.wait_for_timeout(2000)
                report(sw, "checkout, at the gate")
                page.screenshot(path=str(out / "rehearsal-gate.png"))
            except Exception as e:
                print("checkout walk stopped:", e)

        st = state_of(sw)
        (out / "rehearsal-state.json").write_text(json.dumps(st, indent=1))
        print("\nreads trace:")
        for r in st.get("reads", []):
            print("  ", {k: v for k, v in r.items() if v is not None and k != "at"})
        print(f"\nsaved: {out}/rehearsal-*.png + rehearsal-state.json")
        ctx.close()


if __name__ == "__main__":
    main()
