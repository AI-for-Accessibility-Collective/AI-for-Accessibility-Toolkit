
                () => [...document.querySelectorAll('a[href]')].map(a => ({
                    text: (a.getAttribute('aria-label') || a.textContent.trim() || a.href).slice(0, 80),
                    href: a.href
                })).filter(r => r.text && r.text !== r.href.slice(0, 80))
            