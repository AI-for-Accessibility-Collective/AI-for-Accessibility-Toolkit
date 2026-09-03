
            () => ({
                url: location.href,
                title: document.title,
                scroll_y: Math.round(window.scrollY),
                interactable_count: document.querySelectorAll(
                    'a[href], button, input:not([type=hidden]), textarea, select, [role=button], [role=link], [tabindex]:not([tabindex="-1"])'
                ).length,
                focused_label: (document.activeElement?.getAttribute('aria-label')
                    || document.activeElement?.textContent?.trim().slice(0,40)
                    || document.activeElement?.tagName?.toLowerCase()
                    || ''),
            })
        