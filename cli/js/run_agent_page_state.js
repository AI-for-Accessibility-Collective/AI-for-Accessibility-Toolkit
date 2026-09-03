() => {
            const active = document.activeElement;
            return {
                title: document.title.slice(0, 60),
                focusedTag: active ? active.tagName.toLowerCase() : '',
                focusedLabel: active ? (active.getAttribute('aria-label') || active.textContent?.trim().slice(0, 40) || '') : '',
                modalVisible: !!document.querySelector('[role="dialog"]:not([hidden]), .modal:not([hidden]), [aria-modal="true"]'),
                bodyClasses: document.body.className.slice(0, 80)
            };
        }