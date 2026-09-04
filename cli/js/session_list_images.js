
                () => [...document.querySelectorAll('img, [role="img"], picture, svg[aria-label]')].map(el => {
                    const rect = el.getBoundingClientRect();
                    const scrollY = rect.top + window.scrollY;
                    const src = el.currentSrc || el.src || el.getAttribute('data-src') || '';
                    const alt = el.getAttribute('alt') || el.getAttribute('aria-label') || el.getAttribute('title') || '';
                    return {
                        alt: alt.slice(0, 80),
                        src: src.slice(-80),
                        w: Math.round(rect.width),
                        h: Math.round(rect.height),
                        y: Math.round(scrollY),
                        hidden: rect.width < 5 || rect.height < 5 || el.offsetParent === null
                    };
                }).filter(r => !r.hidden)
            