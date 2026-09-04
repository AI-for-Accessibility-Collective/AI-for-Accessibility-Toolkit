([x, y]) => {
                    const el = document.elementFromPoint(x, y);
                    if (!el) return null;
                    return {tag: el.tagName.toLowerCase(),
                            text: (el.textContent || '').trim().slice(0, 40),
                            role: el.getAttribute('role') || '',
                            aria: el.getAttribute('aria-label') || ''};
                }