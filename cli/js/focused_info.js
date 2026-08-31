
        () => {
            const a = document.activeElement;
            if (!a || a === document.body) return {none: true};
            return {
                tag: a.tagName.toLowerCase(),
                role: a.getAttribute('role') || '',
                name: a.getAttribute('aria-label') || a.textContent?.trim().slice(0, 80) || a.value || a.placeholder || '',
                type: a.type || '',
                checked: a.checked ?? null,
                disabled: a.disabled ?? false,
                value: (a.value !== undefined ? String(a.value).slice(0, 60) : null)
            };
        }
    