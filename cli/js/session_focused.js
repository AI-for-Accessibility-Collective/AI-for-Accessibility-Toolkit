
            () => {
                const el = document.activeElement;
                if (!el || el === document.body) {
                    return {role: 'body', label: '(nothing focused — just the page)',
                            url: location.href, title: document.title};
                }
                const tag = el.tagName.toLowerCase();
                const role = el.getAttribute('role') || tag;
                const label = (el.getAttribute('aria-label')
                    || el.textContent?.trim().replace(/\s+/g, ' ')
                    || el.value
                    || el.placeholder
                    || el.getAttribute('title')
                    || '').slice(0, 120);
                const href = el.getAttribute('href') || '';
                const type = el.type || '';
                const value = (el.value !== undefined ? String(el.value) : '').slice(0, 80);
                const checked = el.checked;
                const disabled = el.disabled;
                let extra = '';
                if (href) extra += ` → ${href.slice(0, 80)}`;
                if (type && type !== tag) extra += ` [${type}]`;
                if (value && value !== label) extra += ` value="${value}"`;
                if (checked !== undefined && (tag === 'input' && (type === 'checkbox' || type === 'radio'))) {
                    extra += checked ? ' [checked]' : ' [unchecked]';
                }
                if (disabled) extra += ' [disabled]';
                return {role, label, extra, url: location.href, title: document.title};
            }
        