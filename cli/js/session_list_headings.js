
                () => [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map(h => ({
                    level: parseInt(h.tagName[1]),
                    text: h.textContent.trim().slice(0, 100)
                })).filter(r => r.text)
            