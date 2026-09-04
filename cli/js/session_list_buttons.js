
                () => [...document.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"]')].map(b => ({
                    text: (b.getAttribute('aria-label') || b.textContent.trim() || b.value || '').slice(0, 80),
                    disabled: b.disabled
                })).filter(r => r.text)
            