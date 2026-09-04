
                () => [...document.querySelectorAll('input:not([type="hidden"]), textarea, select')].map(el => {
                    const labelEl = el.labels?.[0];
                    const label = el.getAttribute('aria-label') || labelEl?.textContent.trim() || el.placeholder || el.name || '';
                    return {label: label.slice(0, 60), type: el.type || el.tagName.toLowerCase(),
                            value: (el.value || '').slice(0, 40), required: el.required};
                }).filter(r => r.label)
            