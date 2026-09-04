
        () => {
            const selectors = ['svg:not([width="0"])', 'canvas', '[class*="chart"]',
                '[class*="graph"]', '[class*="plot"]', 'figure', '.grapher', '#chart', 'main svg'];
            for (const sel of selectors) {
                const chart = document.querySelector(sel);
                if (chart) {
                    const rect = chart.getBoundingClientRect();
                    if (rect.width > 200 && rect.height > 200) {
                        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
                    }
                }
            }
            return { x: 400, y: 300, width: 800, height: 500 };
        }
    