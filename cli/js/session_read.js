
            (sel) => {
                // 1. Honor explicit selector if given
                if (sel) {
                    const el = document.querySelector(sel);
                    if (el) return el.innerText.replace(/\s+/g, ' ').trim();
                }
                // 2. Try semantic containers
                const candidates = [
                    'article',
                    '[role="article"]',
                    'main article',
                    'main',
                    '[role="main"]',
                    '#content article',
                    '#content',
                    '.article-body',
                    '.post-content',
                    '.entry-content',
                ];
                for (const c of candidates) {
                    const el = document.querySelector(c);
                    if (el && el.innerText && el.innerText.length > 200) {
                        return el.innerText.replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
                    }
                }
                // 3. Text-density heuristic — find the <div> with most text relative to tags
                let best = null, bestScore = 0;
                document.querySelectorAll('div, section').forEach(el => {
                    const text = el.innerText || '';
                    if (text.length < 400) return;
                    const tags = el.querySelectorAll('*').length || 1;
                    const score = text.length / tags;
                    if (score > bestScore) { bestScore = score; best = el; }
                });
                if (best) return best.innerText.replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
                // 4. Fallback: whole body
                return (document.body.innerText || '').replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
            }
        