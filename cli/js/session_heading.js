
            ([direction, level]) => {
                const selector = level ? `h${level}` : 'h1, h2, h3, h4, h5, h6';
                const headings = [...document.querySelectorAll(selector)].filter(h => h.offsetParent !== null);
                if (!headings.length) return {found: false, msg: 'No headings found'};

                const active = document.activeElement;
                let currentIdx = -1;

                // Find current position
                for (let i = 0; i < headings.length; i++) {
                    if (headings[i] === active || headings[i].contains(active)) {
                        currentIdx = i;
                        break;
                    }
                }

                // Calculate target index
                let targetIdx;
                if (direction === 'next') {
                    targetIdx = currentIdx + 1;
                    if (targetIdx >= headings.length) targetIdx = 0;  // wrap
                } else {
                    targetIdx = currentIdx - 1;
                    if (targetIdx < 0) targetIdx = headings.length - 1;  // wrap
                }

                const target = headings[targetIdx];
                target.setAttribute('tabindex', '-1');
                target.focus();
                target.scrollIntoView({behavior: 'smooth', block: 'center'});

                const tag = target.tagName.toLowerCase();
                const text = (target.textContent || '').trim().slice(0, 80);
                return {
                    found: true,
                    tag: tag,
                    text: text,
                    index: targetIdx + 1,
                    total: headings.length
                };
            }
        