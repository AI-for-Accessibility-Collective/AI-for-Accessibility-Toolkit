
            () => [...document.querySelectorAll(
                '[role="tooltip"], .tooltip, .tippy-box, [data-tippy-root], [role="status"][aria-live], .MuiTooltip-popper, [data-radix-popper-content-wrapper]'
            )].filter(el => {
                const r = el.getBoundingClientRect();
                return r.width > 0 && r.height > 0 && el.offsetParent !== null;
            }).map(el => (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 300))
              .filter(t => t)
        