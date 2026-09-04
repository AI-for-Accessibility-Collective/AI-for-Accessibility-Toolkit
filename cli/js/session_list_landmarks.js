
                () => [...document.querySelectorAll('[role="banner"],[role="navigation"],[role="main"],[role="complementary"],[role="contentinfo"],[role="search"],[role="form"],[role="region"],header,nav,main,aside,footer,section[aria-label],section[aria-labelledby]')].map(el => ({
                    role: el.getAttribute('role') || el.tagName.toLowerCase(),
                    label: (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || '').slice(0, 60)
                }))
            