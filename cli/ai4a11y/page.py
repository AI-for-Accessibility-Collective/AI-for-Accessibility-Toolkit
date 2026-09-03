"""Everything that reads a live page, draws on a screenshot of it, or changes it.

Each function here takes an already connected Playwright page. Getting that
page is the next layer's job, in `browser.py`, so nothing here starts a
browser or reads the session file.
"""

from PIL import Image, ImageDraw, ImageFont, ImageChops
import time
import hashlib
import io
import json
import re
import tempfile
import base64
from pathlib import Path

from .config import (
    OUT,
    _get_active_profile,
    _get_cli_tools_script,
    _get_readability_script,
    _js,
    warn,
)
from .ai import (
    _safe_screenshot,
    ask_claude,
    ask_claude_text,
    claude_answer,
)


def _inject_cli_tools(page, auto_apply_profile=False):
    """Inject the CLI tools bundle into the page if not already present.

    If auto_apply_profile=True and there's an active profile saved,
    it will be applied automatically after injection.
    """
    has_tools = page.evaluate("typeof window.ai4a11y !== 'undefined'")
    if has_tools:
        # Tools already present, but may need to reapply profile
        if auto_apply_profile:
            _auto_apply_saved_profile(page)
        return True

    # Inject Readability library first (required for ReaderMode)
    readability = _get_readability_script()
    if readability:
        try:
            page.add_script_tag(content=readability)
        except:
            pass  # Non-critical, ReaderMode just won't work

    script = _get_cli_tools_script()
    if not script:
        return False
    try:
        page.add_script_tag(content=script)
        page.wait_for_function("typeof window.ai4a11y !== 'undefined'", timeout=5000)

        # Auto-apply saved profile if requested
        if auto_apply_profile:
            _auto_apply_saved_profile(page)

        return True
    except Exception as e:
        warn(f"Failed to inject tools: {e}")
        return False


def _publish_active_profile(page):
    """Tell the page which profile is active. Returns whether it took it.

    Anything that asks the catalog what the profile wants reads this, and it is
    a different question from whether the profile's adapters are switched on.
    Only navigation used to set it, so a command that asked without navigating
    was answered as if no profile were active.

    A cleared profile is published too. Returning early on a falsy profile
    left the last value published standing until the page was replaced, so a
    page went on being told a profile was active after it had been cleared.

    The return value is what makes a failure to publish visible. Anything under
    `window.ai4a11y` satisfies the check that decides the tools are already
    injected, so the page may hold an object without `setSessionState` on it.
    The optional-call chain this used to be gave back `undefined` whether it
    published or found nothing to publish through, which reported that page
    as one that had taken the state.
    """
    try:
        return bool(page.evaluate(
            _js("publish_session_state.js"),
            {'activeProfile': _get_active_profile()}
        ))
    except Exception:
        # The page may not have the tools loaded; the caller reports that.
        return False


def _withdraw_active_profile(page):
    """Take a cleared profile into an open page. Returns what it managed to do.

    Publishing the cleared state is only half of it. The adapters a profile
    switches on bind their own listeners and ask a model from page events, and
    they consult no session state, so they keep running until something
    disables them. Applying a profile begins by disabling every tool; clearing
    one does the same and enables nothing after it.

    Every way this can fall short used to arrive at the caller as the number 0,
    which is also what a page with nothing switched on returns, so the command
    reported a stop it had not performed. The report says which of the two
    halves happened, names what is still running, and carries the reason it
    could not finish:

        published  — the page took the cleared session state
        turnedOff  — the tools this call switched off, by name
        stillOn    — the tools still enabled after it, by name
        reason     — why the withdrawal did not finish, or None
        withdrew   — both halves done and nothing left running
    """
    report = {'published': _publish_active_profile(page),
              'turnedOff': [], 'stillOn': [], 'reason': None}
    try:
        outcome = page.evaluate(_js("withdraw_profile.js"))
    except Exception as exc:
        outcome = None
        # Playwright errors run to many lines; the first is the one that
        # says what happened, and this goes on a line of a person's output.
        failure = "the page stopped answering (%s)" % str(exc).strip().splitlines()[0][:120]
    else:
        failure = None if outcome else (
            "what the page has under `ai4a11y` is not the bundle this CLI "
            "installs, so its tools could not be listed")

    if outcome:
        report['turnedOff'] = outcome.get('turnedOff') or []
        report['stillOn'] = outcome.get('stillOn') or []
        if report['stillOn']:
            failure = ("these tools would not turn off: "
                       + ", ".join(report['stillOn']))
        elif not report['published']:
            failure = "the page did not take the cleared profile"

    report['reason'] = failure
    report['withdrew'] = failure is None
    return report


def _auto_apply_saved_profile(page):
    """Apply the saved active profile to the page (if any)."""
    profile = _get_active_profile()
    if not profile:
        return

    try:
        _publish_active_profile(page)

        result = page.evaluate(
            "(name) => window.ai4a11y.applyProfile(name)",
            profile
        )
        if result.get('success'):
            # Silently applied — no output to keep it instant/automatic
            pass
    except Exception:
        # Profile application failed — page may not have tools loaded properly
        pass


# Track which pages have AI callbacks exposed
_ai_callbacks_exposed = set()


def _expose_ai_callbacks(page):
    """Expose AI callback functions to the page for AI-powered adapters."""
    page_id = id(page)
    if page_id in _ai_callbacks_exposed:
        return True

    try:
        # Describe image - takes base64 image data, returns alt text
        def ai_describe_image(image_data):
            # Save base64 to temp file
            with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as f:
                if ',' in image_data:
                    image_data = image_data.split(',')[1]
                f.write(base64.b64decode(image_data))
                temp_path = f.name
            prompt = """Describe this image for a blind user. Write a concise alt text (1-2 sentences) that captures:
1. What the image shows (main subject, action, context)
2. Any important text visible in the image
3. Relevant details for understanding the content

Return ONLY the alt text, no quotes or explanation."""
            result = ask_claude(temp_path, prompt)
            Path(temp_path).unlink(missing_ok=True)
            return claude_answer(result)

        # Simplify text - takes text, returns simplified version
        def ai_simplify_text(text):
            prompt = f"""Simplify this text for someone with cognitive disabilities or limited reading ability.
Keep the same meaning but use:
- Shorter sentences (under 15 words)
- Common words (avoid jargon)
- Active voice
- Clear structure

Text to simplify:
{text[:2000]}

Return ONLY the simplified text."""
            return claude_answer(ask_claude_text(prompt, timeout=60))

        # Summarize text - takes text, returns summary
        def ai_summarize_text(text):
            prompt = f"""Summarize this text in 2-3 sentences for quick understanding.
Focus on the main point and key takeaways.

Text:
{text[:3000]}

Return ONLY the summary."""
            return claude_answer(ask_claude_text(prompt, timeout=60))

        def ai_translate_text(text, target_lang="English"):
            prompt = f"""Translate the following text into {target_lang or 'English'}.
Preserve the meaning and tone. Do not add notes or explanations.

Text:
{text[:3000]}

Return ONLY the translated text."""
            return claude_answer(ask_claude_text(prompt, timeout=60))

        def ai_define_word(word, context=""):
            prompt = f"""Define the word or phrase "{word}" in one short, plain-language sentence a general reader can understand, as used in this context: "{(context or '')[:400]}".

Return ONLY the definition."""
            return claude_answer(ask_claude_text(prompt, timeout=30))

        # Generate label - takes context about element, returns accessible label
        def ai_generate_labels(context):
            ctx_str = json.dumps(context) if isinstance(context, dict) else str(context)
            prompt = f"""Generate an accessible label for this interactive element.
The label should be concise (2-5 words) and describe the element's purpose.

Element context:
{ctx_str}

Return ONLY the label text."""
            return claude_answer(ask_claude_text(prompt, timeout=30))

        # Fix contrast - takes fg/bg colors, returns the adjusted foreground
        # color as a hex string (the adapter assigns it to element.style.color)
        def ai_fix_contrast(fg, bg):
            prompt = f"""The foreground color {fg} on background {bg} has insufficient contrast.
Suggest an adjusted foreground color that:
1. Meets WCAG AA contrast ratio (4.5:1 for normal text) against {bg}
2. Stays visually similar to the original
3. Maintains readability

Return ONLY the hex color (e.g. #1a2b3c), nothing else."""
            result = ask_claude_text(prompt, timeout=30)
            try:
                text = (result or '').strip()
                # Prefer an exact hex response; otherwise take the LAST hex in the
                # text — a chatty model puts the *suggested* color last, after
                # restating the bad one ("#1a2b3c has poor contrast, try #4d5e6f").
                if re.fullmatch(r'#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3}', text):
                    return text
                matches = re.findall(r'#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b', text)
                return matches[-1] if matches else None
            except:
                return None

        # Describe element - takes screenshot + element info
        def ai_describe_element(image_data, element_type, context):
            with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as f:
                if ',' in image_data:
                    image_data = image_data.split(',')[1]
                f.write(base64.b64decode(image_data))
                temp_path = f.name
            prompt = f"""Describe this {element_type} element for accessibility.
Context: {json.dumps(context) if isinstance(context, dict) else context}

Provide a brief, useful description (1-2 sentences) that helps a screen reader user understand what this element shows or does."""
            result = ask_claude(temp_path, prompt)
            Path(temp_path).unlink(missing_ok=True)
            return claude_answer(result)

        # Extract a chart/graph's data as a structured table (explore-a-chart adapter)
        def ai_extract_chart_data(image_data, context):
            with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as f:
                if ',' in image_data:
                    image_data = image_data.split(',')[1]
                try:
                    f.write(base64.b64decode(image_data))
                except Exception:
                    return None
                temp_path = f.name
            prompt = """Extract the data shown in this chart or graph as JSON.
Return ONLY valid JSON of the form {"caption": string, "headers": [string], "rows": [[string]]}, where each row is aligned to the headers.
If it is not a data chart, return {"caption": "", "headers": [], "rows": []}."""
            result = ask_claude(temp_path, prompt)
            Path(temp_path).unlink(missing_ok=True)
            try:
                data = json.loads(result)
                if isinstance(data, dict) and 'headers' in data:
                    return data
                if isinstance(data, dict) and 'answer' in data:
                    try:
                        return json.loads(data['answer'])
                    except Exception:
                        return None
                return data
            except Exception:
                return None

        # Improve ambiguous link text ("click here" → descriptive label)
        def ai_improve_link_text(link_text, href, context):
            prompt = f"""Improve this ambiguous link text for screen reader users.

Current link text: "{link_text}"
Link URL: {href}
Surrounding context: "{context}"

Generate a short, descriptive link text (2-5 words) that explains where the link goes.
Return ONLY the improved link text."""
            return claude_answer(ask_claude_text(prompt, timeout=30))

        # Infer a table column header from sample cell values
        def ai_infer_column_header(sample_data):
            samples = sample_data if isinstance(sample_data, list) else [str(sample_data)]
            sample_str = "\n".join(f"- {s}" for s in samples)
            prompt = f"""What is the best column header for this table data? Sample values:
{sample_str}

Return ONLY a short header name (1-3 words)."""
            return claude_answer(ask_claude_text(prompt, timeout=30))

        # Expose functions to page
        page.expose_function("ai4a11y_describeImage", ai_describe_image)
        page.expose_function("ai4a11y_simplifyText", ai_simplify_text)
        page.expose_function("ai4a11y_summarizeText", ai_summarize_text)
        page.expose_function("ai4a11y_generateLabels", ai_generate_labels)
        page.expose_function("ai4a11y_fixContrast", ai_fix_contrast)
        page.expose_function("ai4a11y_describeElement", ai_describe_element)
        page.expose_function("ai4a11y_improveLinkText", ai_improve_link_text)
        page.expose_function("ai4a11y_inferColumnHeader", ai_infer_column_header)
        page.expose_function("ai4a11y_translateText", ai_translate_text)
        page.expose_function("ai4a11y_defineWord", ai_define_word)
        page.expose_function("ai4a11y_extractChartData", ai_extract_chart_data)

        _ai_callbacks_exposed.add(page_id)
        return True
    except Exception as e:
        print(f"Failed to expose AI callbacks: {e}")
        return False


def _inject_with_ai(page):
    """Inject CLI tools AND set up AI callbacks."""
    # AI callbacks must be exposed BEFORE navigating or injecting scripts
    # that might call them, so we do it first
    _expose_ai_callbacks(page)
    return _inject_cli_tools(page)


# ============================================================
# VISUAL HELPERS — grid, diff, sequence capture
# ============================================================

def add_som_markers(image_path, output_path, elements, margin=25):
    """Set-of-Marks: overlay numbered tags on interactive elements.

    Elements are (x, y) points; we draw a numbered badge at each so the agent
    can pick element by index instead of pixel coordinates.
    """
    img = Image.open(image_path)
    w, h = img.size
    new_img = Image.new('RGB', (w + margin, h + margin), (40, 40, 40))
    new_img.paste(img, (margin, margin))
    draw = ImageDraw.Draw(new_img, 'RGBA')

    try:
        f_label = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 12)
        f_ruler = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 9)
    except:
        f_label = f_ruler = ImageFont.load_default()

    # Rulers in margins (fallback for coords-still-needed cases)
    for x in range(0, w, 100):
        draw.line([(x + margin, 0), (x + margin, margin - 5)], fill=(200, 200, 200), width=1)
        draw.text((x + margin + 2, 2), str(x), fill=(200, 200, 200), font=f_ruler)
    for y in range(0, h, 100):
        draw.line([(0, y + margin), (margin - 5, y + margin)], fill=(200, 200, 200), width=1)
        draw.text((2, y + margin + 2), str(y), fill=(200, 200, 200), font=f_ruler)

    # Numbered badges on elements
    palette = [(220, 50, 50), (50, 120, 220), (30, 170, 60), (240, 150, 0),
               (160, 80, 200), (0, 160, 160), (210, 90, 140), (100, 100, 100)]
    for i, el in enumerate(elements):
        x, y = el.get('x', 0), el.get('y', 0)
        if x <= 0 or y <= 0:
            continue
        cx, cy = x + margin, y + margin
        color = palette[i % len(palette)]
        r = 12
        draw.ellipse([(cx - r, cy - r), (cx + r, cy + r)],
                     fill=(*color, 220), outline=(255, 255, 255), width=2)
        label = str(i + 1)
        tw = draw.textlength(label, font=f_label)
        draw.text((cx - tw / 2, cy - 7), label, fill=(255, 255, 255), font=f_label)

    new_img.save(output_path)
    return output_path


def add_grid_overlay(image_path, output_path, grid_size=100, focus_point=None, mode="full"):
    """Overlay coordinate grid on image for precise positioning.

    Modes:
      - "full": grid lines across entire image (can obscure content)
      - "light": edge rulers + corner ticks only (minimal intrusion)
      - "margin": coordinates in margin bands, content untouched

    If focus_point=(x,y) provided, adds crosshair + fine grid in that region.
    """
    img = Image.open(image_path)
    w, h = img.size

    try:
        font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 11)
        font_small = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 9)
    except:
        font = font_small = ImageFont.load_default()

    if mode == "margin":
        margin = 25
        new_img = Image.new('RGB', (w + margin, h + margin), (40, 40, 40))
        new_img.paste(img, (margin, margin))
        draw = ImageDraw.Draw(new_img, 'RGBA')

        for x in range(0, w, grid_size):
            draw.line([(x + margin, 0), (x + margin, margin - 5)], fill=(200, 200, 200), width=1)
            draw.text((x + margin + 2, 2), str(x), fill=(200, 200, 200), font=font_small)

        for y in range(0, h, grid_size):
            draw.line([(0, y + margin), (margin - 5, y + margin)], fill=(200, 200, 200), width=1)
            draw.text((2, y + margin + 2), str(y), fill=(200, 200, 200), font=font_small)

        if focus_point:
            fx, fy = focus_point[0] + margin, focus_point[1] + margin
            draw.line([(fx - 20, fy), (fx + 20, fy)], fill=(255, 255, 0), width=2)
            draw.line([(fx, fy - 20), (fx, fy + 20)], fill=(255, 255, 0), width=2)
            draw.text((fx + 5, fy + 5), f"{focus_point[0]},{focus_point[1]}",
                      fill=(255, 255, 0), font=font)

        new_img.save(output_path)
        return output_path

    draw = ImageDraw.Draw(img, 'RGBA')

    if mode == "light":
        tick_len = 15
        for x in range(0, w, grid_size):
            draw.line([(x, 0), (x, tick_len)], fill=(255, 100, 100, 180), width=1)
            draw.text((x + 2, 1), str(x), fill=(255, 100, 100), font=font_small)
            draw.line([(x, h - tick_len), (x, h)], fill=(255, 100, 100, 180), width=1)
        for y in range(0, h, grid_size):
            draw.line([(0, y), (tick_len, y)], fill=(255, 100, 100, 180), width=1)
            draw.text((1, y + 2), str(y), fill=(255, 100, 100), font=font_small)
            draw.line([(w - tick_len, y), (w, y)], fill=(255, 100, 100, 180), width=1)

    else:  # mode == "full"
        for x in range(0, w, grid_size):
            draw.line([(x, 0), (x, h)], fill=(255, 0, 0, 60), width=1)
            draw.text((x + 2, 2), str(x), fill=(255, 0, 0, 200), font=font)
        for y in range(0, h, grid_size):
            draw.line([(0, y), (w, y)], fill=(255, 0, 0, 60), width=1)
            draw.text((2, y + 2), str(y), fill=(255, 0, 0, 200), font=font)
        for x in range(grid_size // 2, w, grid_size):
            for y in range(grid_size // 2, h, grid_size):
                draw.ellipse([(x - 2, y - 2), (x + 2, y + 2)], fill=(0, 200, 0, 150))
                draw.text((x + 4, y - 5), f"{x},{y}", fill=(0, 120, 0, 180), font=font_small)

    if focus_point:
        fx, fy = focus_point
        draw.line([(fx - 25, fy), (fx + 25, fy)], fill=(255, 255, 0), width=2)
        draw.line([(fx, fy - 25), (fx, fy + 25)], fill=(255, 255, 0), width=2)
        draw.text((fx + 8, fy + 8), f"{fx},{fy}", fill=(255, 255, 0), font=font)

        fine = 25
        for x in range(max(0, fx - 100), min(w, fx + 100), fine):
            draw.line([(x, max(0, fy - 100)), (x, min(h, fy + 100))],
                      fill=(0, 180, 255, 100), width=1)
        for y in range(max(0, fy - 100), min(h, fy + 100), fine):
            draw.line([(max(0, fx - 100), y), (min(w, fx + 100), y)],
                      fill=(0, 180, 255, 100), width=1)

    img.save(output_path)
    return output_path


def create_diff_image(before_path, after_path, output_path, threshold=30):
    """Create visual diff highlighting changes between two screenshots."""
    before = Image.open(before_path).convert('RGB')
    after = Image.open(after_path).convert('RGB')

    diff = ImageChops.difference(before, after)
    gray = diff.convert('L')
    binary = gray.point(lambda x: 255 if x > threshold else 0)
    bbox = binary.getbbox()

    pixels = list(binary.getdata())
    changed = sum(1 for p in pixels if p > 0)
    change_pct = (changed / len(pixels)) * 100

    result = after.copy()
    draw = ImageDraw.Draw(result, 'RGBA')

    if bbox:
        draw.rectangle(bbox, outline=(255, 0, 0), width=3)
        highlight = Image.new('RGBA', result.size, (0, 0, 0, 0))
        h_draw = ImageDraw.Draw(highlight)
        h_draw.rectangle(bbox, fill=(255, 255, 0, 60))
        result = Image.alpha_composite(result.convert('RGBA'), highlight)

        try:
            font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 14)
        except:
            font = ImageFont.load_default()
        draw = ImageDraw.Draw(result)
        cx, cy = (bbox[0] + bbox[2]) // 2, bbox[1] - 20
        draw.text((cx, cy), f"CHANGED ({change_pct:.1f}%)", fill=(255, 0, 0), font=font)

    result.save(output_path)
    return output_path, change_pct, bbox


def capture_sequence(page, duration=3, interval=0.1):
    """Capture rapid screenshot sequence for animation analysis."""
    frames = []
    start = time.time()
    while time.time() - start < duration:
        frames.append({'time': time.time() - start, 'data': page.screenshot()})
        time.sleep(interval)
    return frames


def save_sequence_mosaic(frames, output_path, cols=5):
    """Save captured frames as a timestamped mosaic for visual analysis."""
    if not frames:
        return None

    first = Image.open(io.BytesIO(frames[0]['data']))
    w, h = first.size
    thumb_w, thumb_h = int(w * 0.3), int(h * 0.3)

    rows = (len(frames) + cols - 1) // cols
    mosaic = Image.new('RGB', (thumb_w * cols, thumb_h * rows), (40, 40, 40))

    try:
        font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 12)
    except:
        font = ImageFont.load_default()

    draw = ImageDraw.Draw(mosaic)
    for i, frame in enumerate(frames):
        img = Image.open(io.BytesIO(frame['data']))
        thumb = img.resize((thumb_w, thumb_h), Image.Resampling.LANCZOS)
        row, col = i // cols, i % cols
        x, y = col * thumb_w, row * thumb_h
        mosaic.paste(thumb, (x, y))
        draw.text((x + 5, y + 5), f"{frame['time']:.2f}s", fill=(255, 255, 0), font=font)

    mosaic.save(output_path)
    return output_path


# ============================================================
# PAGE UTILITIES — state, elements, data extraction
# ============================================================

def get_screenshot_hash(page):
    """Hash of current screenshot for change detection. Short timeout so it
    doesn't hang the whole primitive if the page is slow to settle (Amazon's
    fonts-loading, infinite-scroll pages)."""
    try:
        return hashlib.md5(page.screenshot(timeout=5000)).hexdigest()
    except Exception:
        return ''


def wait_for_stable(page, timeout=5):
    """Wait for page to stop changing (animations to finish)."""
    start = time.time()
    last_hash = get_screenshot_hash(page)
    stable_count = 0

    while time.time() - start < timeout:
        time.sleep(0.5)
        current_hash = get_screenshot_hash(page)
        if current_hash == last_hash:
            stable_count += 1
            if stable_count >= 2:
                return True
        else:
            stable_count = 0
            last_hash = current_hash

    return False


def get_elements(page):
    """Enumerate interactive elements (including shadow DOM, iframes)."""
    elements = page.evaluate(_js("get_elements.js"))

    for frame in page.frames[1:]:
        try:
            if frame.url and 'about:' not in frame.url:
                elements.append({
                    'tag': 'iframe', 'label': f'Embedded: {frame.url[:50]}',
                    'x': 0, 'y': 0,
                })
        except:
            pass

    return elements


def get_interactables_full(page, max_items=80):
    """Page-wide interactables snapshot for text-only grounding.

    Broader than get_elements: no viewport filter, no 25-cap. Returns cx/cy (center
    coords in page-absolute space) and scroll_y (needed to bring offscreen elements
    into view before clicking). Labels are richer — includes role + parent-landmark
    context so Claude can disambiguate candidates from text alone, no screenshot.
    """
    try:
        items = page.evaluate(_js("get_interactables_full.js"), max_items)
    except Exception:
        # Mid-navigation / CDP race / CSP eval block — degrade to "no candidates"
        # so _text_ground_one reports "not in list" and vision fallback kicks in.
        return []
    for i, it in enumerate(items):
        it['idx'] = i + 1
    return items


def state_snapshot(page):
    """Lightweight state tuple for before/after diff. No screenshot hash — that's heavy.
    Use get_screenshot_hash separately when pixel-change detection matters.
    """
    try:
        return page.evaluate(_js("state_snapshot.js"))
    except Exception:
        return {'url': page.url, 'title': '', 'scroll_y': 0,
                'interactable_count': 0, 'focused_label': ''}


def describe_state_diff(before, after):
    """Return a short human-readable diff or None if state appears unchanged."""
    if not before or not after:
        return None
    changes = []
    if before.get('url') != after.get('url'):
        changes.append(f"url → {after['url'][:80]}")
    if before.get('title') != after.get('title'):
        changes.append(f"title → {after['title'][:60]}")
    if before.get('scroll_y') != after.get('scroll_y'):
        changes.append(f"scroll y={before.get('scroll_y', 0)}→{after.get('scroll_y', 0)}")
    ic_before = before.get('interactable_count', 0)
    ic_after = after.get('interactable_count', 0)
    if abs(ic_after - ic_before) >= 2:
        changes.append(f"interactables {ic_before}→{ic_after}")
    if before.get('focused_label') != after.get('focused_label') and after.get('focused_label'):
        changes.append(f"focus → {after['focused_label'][:40]}")
    return "; ".join(changes) if changes else None


def extract_data(page):
    """Extract chart data (legend, axes, values, title) from visualization."""
    return page.evaluate(_js("extract_data.js"))


def get_page_context(page, text_limit=8000):
    """Assemble a text context bundle for Q&A: visible text + structured tables + outline.

    Much faster and more accurate than vision-only for text-based questions
    (e.g. 'what's Mars's average temperature' — the answer is in the Wikipedia infobox
    in plain text, no need to visually scan the page).
    """
    try:
        text = page.evaluate(f"""
            () => {{
                const walk = (n, depth=0) => {{
                    if (depth > 10) return '';
                    if (n.nodeType === 3) return n.textContent.trim();
                    if (n.nodeType !== 1) return '';
                    const tag = n.tagName.toLowerCase();
                    if (['script','style','noscript','svg','template'].includes(tag)) return '';
                    if (n.offsetParent === null && tag !== 'body') return '';
                    let t = '';
                    for (const c of n.childNodes) t += walk(c, depth+1) + ' ';
                    return t.trim();
                }};
                return walk(document.body).replace(/\\s+/g,' ').slice(0, {text_limit});
            }}
        """)
    except Exception:
        text = ''

    try:
        tables = page.evaluate(_js("get_page_context_tables.js"))
    except Exception:
        tables = []

    return {'text': text, 'tables': tables}


def get_a11y_outline(page, max_items=30):
    """Flatten the accessibility tree into a compact page-structure outline.

    Gives the agent a semantic view of the page (landmarks, headings, controls) that
    complements the pixel-coord-keyed element list. Uses Playwright's built-in
    accessibility.snapshot, which surfaces computed accessible names — more reliable
    than our DOM label heuristics, especially for icon buttons and ARIA-labelled regions.
    """
    try:
        tree = page.accessibility.snapshot(interesting_only=True)
    except Exception:
        return []
    if not tree:
        return []

    # Roles worth surfacing for an agent (structure + interactive)
    STRUCTURAL = {
        'banner', 'navigation', 'main', 'complementary', 'contentinfo',
        'region', 'form', 'search', 'dialog', 'heading',
    }
    INTERACTIVE = {
        'button', 'link', 'textbox', 'combobox', 'checkbox', 'radio',
        'tab', 'menuitem', 'slider', 'searchbox', 'switch', 'option',
    }
    KEEP = STRUCTURAL | INTERACTIVE

    out = []

    def walk(node, depth=0):
        if not node or depth > 12 or len(out) >= max_items:
            return
        role = node.get('role')
        name = (node.get('name') or '').strip()
        value = node.get('value')
        if role in KEEP and (name or value):
            indent = '  ' * min(depth, 4)
            detail = f" = {value}" if value else ''
            out.append(f"{indent}{role}: {name[:50]}{detail}")
        for child in node.get('children', []) or []:
            walk(child, depth + 1)

    walk(tree)
    return out


def get_visible_text(page, limit=5000):
    """Walk the DOM and collect visible text. Skips script/style/hidden."""
    return page.evaluate(f"""
        () => {{
            const walk = (node, depth = 0) => {{
                if (depth > 10) return '';
                if (node.nodeType === 3) return node.textContent.trim();
                if (node.nodeType !== 1) return '';
                const tag = node.tagName.toLowerCase();
                if (['script', 'style', 'noscript', 'svg'].includes(tag)) return '';
                if (node.offsetParent === null && tag !== 'body') return '';
                let text = '';
                for (const child of node.childNodes) {{
                    text += walk(child, depth + 1) + ' ';
                }}
                return text.trim();
            }};
            return walk(document.body).replace(/\\s+/g, ' ').slice(0, {limit});
        }}
    """)


# ============================================================
# INTERACTIONS — verify, scroll, hover
# ============================================================

def verify_action(page, action_fn, description="action"):
    """Execute action, detect state change, return diff info."""
    before_path = OUT / "verify_before.png"
    after_path = OUT / "verify_after.png"
    diff_path = OUT / "verify_diff.png"

    _safe_screenshot(page, before_path)
    before_hash = hashlib.md5(Path(before_path).read_bytes()).hexdigest()

    action_fn()
    time.sleep(0.5)

    _safe_screenshot(page, after_path)
    after_hash = hashlib.md5(Path(after_path).read_bytes()).hexdigest()

    if before_hash == after_hash:
        print(f"⚠ {description}: NO CHANGE DETECTED")
        return False, str(before_path), str(after_path), None, None

    diff_path, change_pct, bbox = create_diff_image(
        str(before_path), str(after_path), str(diff_path))
    print(f"✓ {description}: {change_pct:.1f}% changed, region: {bbox}")
    return (True, str(before_path), str(after_path), str(diff_path),
            {'pct': change_pct, 'bbox': bbox})


def smart_scroll(page, max_scrolls=10):
    """Scroll until content stops changing; save each viewport."""
    screenshots = []
    last_hash = None

    for i in range(max_scrolls):
        current_hash = get_screenshot_hash(page)
        if current_hash == last_hash:
            print(f"  Content unchanged, stopping at viewport {i}")
            break

        path = OUT / f"scroll_{i}.png"
        _safe_screenshot(page, path)
        screenshots.append(str(path))
        print(f"  Captured viewport {i+1}")

        last_hash = current_hash
        page.evaluate("window.scrollBy(0, window.innerHeight * 0.8)")
        time.sleep(0.8)

        at_bottom = page.evaluate(
            "window.innerHeight + window.scrollY >= document.body.scrollHeight - 100")
        if at_bottom:
            _safe_screenshot(page, OUT / f"scroll_{i+1}.png")
            screenshots.append(str(OUT / f"scroll_{i+1}.png"))
            print(f"  Reached bottom at viewport {i+2}")
            break

    return screenshots


def grid_hover(page):
    """Sample 3×3 grid of hovers on the main chart area to trigger tooltips."""
    chart_bounds = page.evaluate(_js("grid_hover_chart_bounds.js"))

    if not chart_bounds:
        print("No chart area found for grid hover")
        return []

    x_start, y_start = chart_bounds['x'], chart_bounds['y']
    w, h = chart_bounds['width'], chart_bounds['height']
    positions = [(x_start + w*fx, y_start + h*fy)
                 for fy in (0.25, 0.5, 0.75) for fx in (0.25, 0.5, 0.75)]

    _safe_screenshot(page, OUT / "hover_base.png")

    for x, y in positions:
        page.mouse.move(int(x), int(y))
        time.sleep(0.3)

    cx, cy = int(x_start + w*0.5), int(y_start + h*0.5)
    page.mouse.move(cx, cy)
    time.sleep(0.5)
    _safe_screenshot(page, OUT / "hover_center.png")
    print(f"Hover sampled at chart center ({cx}, {cy})")

    return [str(OUT / "hover_base.png"), str(OUT / "hover_center.png")]
