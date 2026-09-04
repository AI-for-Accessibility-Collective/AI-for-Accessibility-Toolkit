
            () => {
                const selectors = [
                    'main',
                    '[role="main"]',
                    'article',
                    '#main-content',
                    '#content',
                    '.main-content',
                    '.content'
                ];
                for (const sel of selectors) {
                    const el = document.querySelector(sel);
                    if (el && el.offsetParent !== null) {
                        el.setAttribute('tabindex', '-1');
                        el.focus();
                        el.scrollIntoView({behavior: 'smooth', block: 'start'});

                        // Find first focusable child
                        const firstFocusable = el.querySelector('a, button, input, select, textarea, [tabindex]:not([tabindex="-1"])');
                        if (firstFocusable) {
                            firstFocusable.focus();
                        }

                        const tag = el.tagName.toLowerCase();
                        const role = el.getAttribute('role') || tag;
                        const label = el.getAttribute('aria-label') || '';
                        return {found: true, role: role, label: label};
                    }
                }
                return {found: false};
            }
        