
            (needle) => {
                const nl = needle.toLowerCase();
                const out = [];

                // 1. Body text matches (with surrounding context)
                const body = document.body.innerText || '';
                const lower = body.toLowerCase();
                let idx = lower.indexOf(nl);
                while (idx >= 0 && out.length < 20) {
                    const s = Math.max(0, idx - 40);
                    const e = Math.min(body.length, idx + needle.length + 40);
                    out.push({kind: 'text', snippet: body.slice(s, e).replace(/\s+/g, ' ').trim()});
                    idx = lower.indexOf(nl, idx + 1);
                }

                // 2. Element attribute matches (alt, aria-label, title, placeholder)
                const attrs = ['alt', 'aria-label', 'title', 'placeholder'];
                const seen = new Set();
                document.querySelectorAll('*').forEach(el => {
                    if (out.length >= 40) return;
                    for (const a of attrs) {
                        const v = el.getAttribute(a);
                        if (v && v.toLowerCase().includes(nl)) {
                            const key = el.tagName + v;
                            if (seen.has(key)) continue;
                            seen.add(key);
                            const rect = el.getBoundingClientRect();
                            const y = Math.round(rect.top + window.scrollY);
                            out.push({kind: 'attr', tag: el.tagName.toLowerCase(), attr: a,
                                      value: v.slice(0, 100), y: y});
                        }
                    }
                });
                return out;
            }
        