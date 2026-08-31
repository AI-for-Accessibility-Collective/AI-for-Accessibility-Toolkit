
        () => {
            const els = [];
            const seen = new Set();

            function processElement(el, depth = 0) {
                if (depth > 5) return;
                const rect = el.getBoundingClientRect();
                if (rect.width < 15 || rect.height < 15) return;
                if (rect.top > window.innerHeight * 2 || rect.bottom < 0) return;

                const label = el.getAttribute('aria-label')
                    || el.textContent?.trim().slice(0, 40)
                    || el.getAttribute('title')
                    || el.getAttribute('alt') || '';

                const tag = el.tagName.toLowerCase();
                const key = `${label}${tag}${Math.round(rect.x)}${Math.round(rect.y)}`;

                const isButton = tag === 'button' || el.getAttribute('role') === 'button';
                const isLink = tag === 'a' && el.getAttribute('href');
                const isInput = ['input', 'select', 'textarea'].includes(tag);
                const hasPointer = window.getComputedStyle(el).cursor === 'pointer';
                const hasClick = el.onclick !== null || el.hasAttribute('onclick');
                const hasTabindex = el.hasAttribute('tabindex');
                const hasRole = el.hasAttribute('role');

                if ((isButton || isLink || isInput || hasPointer || hasClick || hasTabindex || hasRole) && label && !seen.has(key)) {
                    seen.add(key);

                    let elType = 'element';
                    if (isButton) elType = 'button';
                    else if (isLink) elType = 'link';
                    else if (tag === 'input' && el.type === 'range') elType = 'slider';
                    else if (tag === 'select') elType = 'select';
                    else if (hasPointer) elType = 'clickable';

                    let extra = '';
                    if (elType === 'slider') extra = ` [${el.min || 0}-${el.max || 100}, val:${el.value}]`;
                    else if (elType === 'select') extra = ` [selected: ${el.options?.[el.selectedIndex]?.text || ''}]`;

                    // Disambiguation context: role + nearest labeled parent (e.g. "in: nav · header")
                    const role = el.getAttribute('role') || '';
                    let parentCtx = '';
                    let p = el.parentElement, depth2 = 0;
                    while (p && depth2 < 4) {
                        const pTag = p.tagName.toLowerCase();
                        const pLabel = p.getAttribute('aria-label') || p.id || '';
                        if (['nav', 'header', 'footer', 'aside', 'main', 'section', 'dialog', 'form'].includes(pTag) || pLabel) {
                            parentCtx = pLabel ? `${pTag}[${pLabel.slice(0, 20)}]` : pTag;
                            break;
                        }
                        p = p.parentElement; depth2++;
                    }

                    els.push({
                        tag: elType,
                        label: label.slice(0, 50) + extra,
                        role: role,
                        parent: parentCtx,
                        x: Math.round(rect.x + rect.width/2),
                        y: Math.round(rect.y + rect.height/2)
                    });
                }

                if (el.shadowRoot) {
                    el.shadowRoot.querySelectorAll('*').forEach(child => processElement(child, depth + 1));
                }
            }

            document.querySelectorAll('*').forEach(el => processElement(el));

            const svgs = document.querySelectorAll('svg');
            const canvas = document.querySelectorAll('canvas');
            let chartType = null;
            svgs.forEach(svg => {
                const hasCircles = svg.querySelectorAll('circle').length > 5;
                const hasRects = svg.querySelectorAll('rect').length > 5;
                const hasPaths = svg.querySelectorAll('path').length > 3;
                const hasLines = svg.querySelectorAll('line').length > 3;
                if (hasCircles && hasPaths) chartType = 'scatter/bubble chart';
                else if (hasRects) chartType = 'bar chart';
                else if (hasPaths && !hasRects && !hasCircles) chartType = 'line chart';
                else if (hasLines) chartType = 'line chart';
            });

            if (chartType) els.push({ tag: 'chart-type', label: chartType, x: 0, y: 0 });
            if (svgs.length) els.push({ tag: 'info', label: `${svgs.length} SVG graphics`, x: 0, y: 0 });
            if (canvas.length) els.push({ tag: 'info', label: `${canvas.length} canvas elements`, x: 0, y: 0 });

            return els.slice(0, 25);
        }
    