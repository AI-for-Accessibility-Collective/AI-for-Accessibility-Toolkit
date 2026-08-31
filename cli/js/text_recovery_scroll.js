
            ([desc, wantInputs]) => {
                const stop = new Set(['the','and','for','with','this','that','click','tap','link','button','press','open','use','from','some','any','all','tab','page','site','window','field','box','bar']);
                const words = desc.toLowerCase().split(/\s+/)
                    .filter(w => w.length > 2 && !stop.has(w));
                if (!words.length) return null;

                const clickableSel = wantInputs
                    ? 'input:not([type=hidden]), textarea'
                    : 'a[href], button, [role="button"], [role="link"]';

                // Pick the best-matching element by accessible text, preferring
                // short/leaf elements. If that element isn't clickable itself,
                // find the nearest clickable element within its subtree, then
                // sibling/ancestor subtree (common pattern: title in <p>, adjacent
                // <a> with ID/link). This fixes sites like arXiv where paper
                // titles are plain text next to an arXiv:XXXX link.
                const textSel = 'a[href], button, [role="button"], [role="link"], p, li, h1, h2, h3, h4, h5, h6, td, div, span, article, section';
                const els = [...document.querySelectorAll(textSel)];
                let best = null, bestLen = Infinity;
                for (const el of els) {
                    const visibleText = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
                    if (visibleText.length > 300 || visibleText.length < 2) continue;
                    const t = (visibleText + ' ' +
                               (el.getAttribute('aria-label') || '') + ' ' +
                               (el.getAttribute('title') || '') + ' ' +
                               (el.getAttribute('placeholder') || '')
                              ).toLowerCase().replace(/\s+/g, ' ').trim();
                    if (!t) continue;
                    if (!words.every(w => t.includes(w))) continue;
                    if (visibleText.length < bestLen) {
                        bestLen = visibleText.length;
                        best = el;
                    }
                }
                if (!best) return null;

                // Resolve to a clickable element.
                let clickTarget = best;
                if (!best.matches(clickableSel)) {
                    // descendant first (click target embedded in the matched text container)
                    clickTarget = best.querySelector(clickableSel);
                    if (!clickTarget) {
                        // nearest clickable ancestor
                        clickTarget = best.closest(clickableSel);
                    }
                    if (!clickTarget) {
                        // scan ancestor subtree: walk up ≤5 levels, check each parent's subtree
                        let parent = best.parentElement, depth = 0;
                        while (parent && depth < 5) {
                            const cand = parent.querySelector(clickableSel);
                            if (cand) { clickTarget = cand; break; }
                            parent = parent.parentElement;
                            depth += 1;
                        }
                    }
                    if (!clickTarget) return null;
                }
                const r = clickTarget.getBoundingClientRect();
                if (r.width === 0 || r.height === 0) return null;
                return {
                    label: (clickTarget.textContent || clickTarget.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 60),
                    kind: clickTarget.tagName.toLowerCase() === 'a' ? 'link' :
                          clickTarget.tagName.toLowerCase() === 'button' ? 'button' :
                          (clickTarget.tagName.toLowerCase()),
                    cy_page: r.top + window.scrollY + r.height / 2,
                    cx_page: r.left + window.scrollX + r.width / 2,
                };
            }
        