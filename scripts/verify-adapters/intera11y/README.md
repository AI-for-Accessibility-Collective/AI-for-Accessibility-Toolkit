# InterA11y, vendored for the verifier

These files are copied from InterA11y, the replication materials
for *InterA11y: Interactive Web Accessibility Error Detection with LLM
Agents* (commit `8dcf06e258df88a8f39a3e37ebfce060c45a1cdd`, directory
`runtime/intera11y/`). The verifier (`../harness.mjs`, `../mcp.mjs`) gives
their tools, rubrics and judge prompt to the agents that build and review
the core adapters. They are unchanged except for one thing: the rules
adapted from GenA11y are left blank (below). Do not edit them here. To
update them, copy them again from a newer InterA11y, blank those rules,
and note its commit above and in `../intera11y.mjs`.

| Here | What it is |
|---|---|
| `measurements/cdp-tools.js` | The live-page tools: `query_ax_node`, `interact_and_observe`, `observe_state_after_activation`, `set_state_and_capture`, `probe_screen_reader_after_action`, `measure_geometry_live`, `request_hi_res_crop`, `render_with_overrides`, `compute_contrast_ratio`, `resolve_part_color`, `resolve_destination`, `compare_named_regions`, `capture_full_page`, with their descriptions. Each returns measurements, never a verdict. |
| `measurements/kbd-graph.js`, `order-check.js` | Keyboard measurements: the Tab order, keyboard traps, focus that is refused or kept, focus inside aria-hidden content, and focus order against visual order. |
| `measurements/vsr-collect.js` | Runs Guidepup's virtual screen reader in the page and collects what it says. |
| `measurements/a11y-eval.js`, `settle.js`, `limits.js` | Colour, settling and limits the tools share. |
| `rubrics/<sc>.js` | Test rules and rubrics for ten WCAG 2.2 success criteria: 1.1.1, 1.4.1, 1.4.13, 2.1.1, 2.1.2, 2.4.3, 2.4.4, 2.4.7, 3.3.1, 4.1.3. Each rule names the tools that gather its evidence. |
| `src/judge/rubric.js`, `prompt.js` | How a rubric is rendered for a model, and the judge's instructions (its evidence standard and verdicts). |
| `src/model/inpage.js` | The helpers the tools install in each page (`window.__ia`). |
| `src/core/config.js` | **Not InterA11y's**: the two settings `prompt.js` reads, in place of InterA11y's own config. |

Rules in the rubrics marked `from: 'gena11y'` are adapted from GenA11y
(<https://github.com/seal-hub/GenA11y>, GPL-3.0-only), so their `text` and
`rubric` are empty here; rules marked `from: 'added'` are InterA11y's.
When an agent asks for a rubric that has such rules (1.1.1, 1.4.1, 2.4.4,
3.3.1), `../intera11y.mjs` reads their text from InterA11y at the commit
above: from a checkout (`INTERA11Y_DIR`, else `../InterA11y` beside this
repository), else from GitHub. The file must match the SHA-256 recorded
there. If it cannot be read, the rubric is given without those rules, and
says so. The tools run in Puppeteer
(`puppeteer-core`, driving the Chromium Playwright installs) and need
`@guidepup/virtual-screen-reader`; both are this repository's dev
dependencies.

The verifier is a test harness in headless Chromium, so these tools use the
DevTools Protocol freely; the extension and the person's browser do not.
