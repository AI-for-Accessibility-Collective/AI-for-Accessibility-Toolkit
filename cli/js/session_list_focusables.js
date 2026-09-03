
                () => {
                    const candidates = document.querySelectorAll('a[href], button, input:not([type="hidden"]), textarea, select, [tabindex]:not([tabindex="-1"])');
                    return [...candidates].filter(el => !el.disabled && el.offsetParent !== null).map(el => ({
                        tag: el.tagName.toLowerCase(),
                        role: el.getAttribute('role') || '',
                        name: (el.getAttribute('aria-label') || el.textContent?.trim() || el.value || el.placeholder || '').slice(0, 70),
                        type: el.type || ''
                    })).filter(r => r.name)
                }
            