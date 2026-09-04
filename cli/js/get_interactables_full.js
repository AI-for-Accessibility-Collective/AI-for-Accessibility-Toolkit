
        (maxItems) => {
            const out = [];
            const seen = new Set();

            function process(el, depth = 0) {
                if (depth > 6) return;
                const rect = el.getBoundingClientRect();
                // attached to layout (has size); don't skip offscreen — caller scrolls
                if (rect.width < 8 || rect.height < 8) return;

                const tag = el.tagName.toLowerCase();
                const role = el.getAttribute('role') || '';
                const href = el.getAttribute('href') || '';

                const isButton = tag === 'button' || role === 'button' || (tag === 'input' && ['submit','button','reset'].includes(el.type));
                const isLink = tag === 'a' && href;
                const isInput = ['input','select','textarea'].includes(tag) && el.type !== 'hidden';
                const hasPointer = window.getComputedStyle(el).cursor === 'pointer';
                const hasOnclick = el.onclick !== null || el.hasAttribute('onclick');
                const hasTabindex = el.hasAttribute('tabindex') && el.getAttribute('tabindex') !== '-1';
                const interactiveRoles = ['button','link','menuitem','tab','checkbox','radio','switch','option','treeitem','combobox','slider'];
                const hasInteractiveRole = interactiveRoles.includes(role);
                const hasTestHook = el.hasAttribute('data-testid') || el.hasAttribute('data-action') || el.hasAttribute('data-test');
                const isDraggable = el.getAttribute('draggable') === 'true';
                // An aria-labeled div/span is almost certainly there for a reason —
                // drop zones, canvas overlays, custom clickables without role.
                const labeledContainer = (tag === 'div' || tag === 'span' || tag === 'li')
                                         && el.hasAttribute('aria-label');

                if (!(isButton || isLink || isInput || hasPointer || hasOnclick || hasTabindex || hasInteractiveRole || hasTestHook || isDraggable || labeledContainer)) {
                    if (el.shadowRoot) {
                        el.shadowRoot.querySelectorAll('*').forEach(c => process(c, depth + 1));
                    }
                    return;
                }

                // Inputs/selects/textareas: build a richer label from MULTIPLE attrs
                // (aria-label AND placeholder AND name AND <label for> AND aria-labelledby).
                // Users describe fields loosely ("email field" / "search box") so we
                // want any one of those hints to be matchable.
                let rawLabel;
                if (isInput) {
                    const parts = [];
                    const push = (s) => {
                        if (!s) return;
                        const t = String(s).trim().replace(/\s+/g, ' ').slice(0, 40);
                        if (!t) return;
                        // skip if already substring-covered by an existing part (case-insensitive)
                        const lt = t.toLowerCase();
                        if (parts.some(p => p.toLowerCase().includes(lt) || lt.includes(p.toLowerCase()))) return;
                        parts.push(t);
                    };
                    push(el.getAttribute('aria-label'));
                    push(el.getAttribute('placeholder'));
                    push(el.getAttribute('title'));
                    push(el.getAttribute('name'));
                    // Linked <label for="id">
                    if (el.labels && el.labels.length) {
                        for (const lbl of el.labels) push(lbl.textContent);
                    }
                    // aria-labelledby resolution
                    const labelledBy = el.getAttribute('aria-labelledby');
                    if (labelledBy) {
                        for (const id of labelledBy.split(/\s+/)) {
                            const ref = id && document.getElementById(id);
                            if (ref) push(ref.textContent);
                        }
                    }
                    rawLabel = parts.slice(0, 3).join(' · ').slice(0, 80);
                    if (!rawLabel) rawLabel = (el.value || el.id || '').slice(0, 40);
                } else {
                    rawLabel = (el.getAttribute('aria-label')
                        || el.textContent?.trim().replace(/\s+/g, ' ')
                        || el.getAttribute('title')
                        || el.getAttribute('alt')
                        || el.getAttribute('placeholder')
                        || el.value
                        || el.getAttribute('data-testid')
                        || '').slice(0, 80);
                }
                if (!rawLabel) return;

                // de-dupe near-duplicates (same label + tag within 20px)
                const key = `${tag}|${role}|${rawLabel}|${Math.round(rect.x/20)}|${Math.round((rect.y + window.scrollY)/20)}`;
                if (seen.has(key)) return;
                seen.add(key);

                // landmark context — helps Claude pick among duplicates like "Edit"
                let parentCtx = '';
                let p = el.parentElement, d2 = 0;
                while (p && d2 < 5) {
                    const pTag = p.tagName.toLowerCase();
                    const pLabel = p.getAttribute('aria-label') || p.id || '';
                    if (['nav','header','footer','aside','main','section','dialog','form','article'].includes(pTag)) {
                        parentCtx = pLabel ? `${pTag}[${pLabel.slice(0,20)}]` : pTag;
                        break;
                    }
                    if (pLabel && p.getAttribute('role')) {
                        parentCtx = `${p.getAttribute('role')}[${pLabel.slice(0,20)}]`;
                        break;
                    }
                    p = p.parentElement; d2++;
                }

                let kind = 'element';
                if (isButton) kind = 'button';
                else if (isLink) kind = 'link';
                else if (tag === 'input' && el.type === 'range') kind = 'slider';
                else if (tag === 'select') kind = 'select';
                else if (isInput) kind = 'input';
                else if (role) kind = role;
                else if (hasPointer || hasOnclick) kind = 'clickable';

                let extra = '';
                if (kind === 'slider') extra = ` [${el.min||0}-${el.max||100}, val:${el.value}]`;
                else if (kind === 'select') extra = ` [sel:${el.options?.[el.selectedIndex]?.text || ''}]`;
                else if (kind === 'input') extra = el.value ? ` [val:${String(el.value).slice(0,30)}]` : '';
                else {
                    // Surface an href suffix whenever one is reachable — from the
                    // element itself, its nearest <a> ancestor, or a descendant <a>.
                    // Covers custom turbo-tabs / role=button wrappers around real
                    // links (GitHub repo tabs, Vercel dashboard nav, etc.) so the
                    // SAME-SITE disambiguator can see the intended destination.
                    let linkHref = (tag === 'a' && href) ? href : '';
                    if (!linkHref) {
                        const anc = el.closest('a[href]');
                        if (anc) linkHref = anc.getAttribute('href') || '';
                    }
                    if (!linkHref) {
                        const desc = el.querySelector('a[href]');
                        if (desc) linkHref = desc.getAttribute('href') || '';
                    }
                    if (linkHref) {
                        // normalize to absolute-ish for downstream SAME-SITE matching
                        try {
                            const abs = new URL(linkHref, location.href).href;
                            extra = ` → ${abs.slice(0, 80)}`;
                        } catch (e) {
                            extra = ` → ${linkHref.slice(0, 80)}`;
                        }
                    }
                }

                const vh = window.innerHeight;
                const cx = Math.round(rect.x + rect.width / 2);
                const cy_vp = Math.round(rect.y + rect.height / 2);
                const cy_page = cy_vp + Math.round(window.scrollY);
                const visible = rect.top < vh && rect.bottom > 0;

                out.push({
                    kind: kind,
                    label: rawLabel + extra,
                    parent: parentCtx,
                    cx: cx,
                    cy_vp: cy_vp,
                    cy_page: cy_page,
                    visible: visible,
                    disabled: !!el.disabled,
                });

                if (el.shadowRoot) {
                    el.shadowRoot.querySelectorAll('*').forEach(c => process(c, depth + 1));
                }
            }

            document.querySelectorAll('body, body *').forEach(el => process(el));

            // Rank before capping so the N we keep are the RELEVANT N, not the first
            // N in DOM order (which are always header/nav on big pages like Wikipedia,
            // leaving body-text links unreachable). Priority:
            //   1. viewport-visible → these are what the user is literally looking at
            //   2. within visible: SAME-SITE hrefs before cross-site / marketing chrome
            //      (repo /owner/repo/... before /features/... on github.com/owner/repo;
            //      current-doc anchors before global nav, etc.)
            //   3. offscreen, sorted by distance to current viewport (nearest first)
            //   4. ties: preserve DOM order (stable sort)
            const vh = window.innerHeight;
            const sy = window.scrollY;
            const viewportMid = sy + vh / 2;
            const curHost = location.host.toLowerCase();
            const curPathParts = location.pathname.split('/').filter(Boolean);
            const curPrefix = '/' + curPathParts.slice(0, 2).join('/');
            out.forEach((o, idx) => {
                o._domOrder = idx;
                o._dist = o.visible ? 0 : Math.abs(o.cy_page - viewportMid);
                o._sameSite = 0;
                const m = o.label && o.label.match(/→ (\S+)/);
                if (m) {
                    const h = m[1].toLowerCase();
                    // absolute URL with curHost + curPrefix, or relative starting with curPrefix
                    if (h.startsWith('/') && !h.startsWith('//')) {
                        if (curPrefix !== '/' && (h === curPrefix || h.startsWith(curPrefix + '/'))) o._sameSite = 1;
                    } else if (h.includes(curHost)) {
                        if (curPrefix === '/' || h.includes(curPrefix + '/') || h.endsWith(curPrefix)) o._sameSite = 1;
                    }
                }
            });
            out.sort((a, b) => {
                if (a.visible !== b.visible) return a.visible ? -1 : 1;
                if (a.visible && a._sameSite !== b._sameSite) return b._sameSite - a._sameSite;
                if (a._dist !== b._dist) return a._dist - b._dist;
                return a._domOrder - b._domOrder;
            });
            const capped = out.slice(0, maxItems);
            capped.forEach(o => { delete o._domOrder; delete o._dist; delete o._sameSite; });
            return capped;
        }
    