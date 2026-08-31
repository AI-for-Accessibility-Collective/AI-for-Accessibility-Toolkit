
        () => {
            const data = {};
            const legends = new Set();
            document.querySelectorAll('[class*="legend"] text, [class*="legend"] span, .legend-item, [class*="series-label"]').forEach(el => {
                const t = el.textContent?.trim();
                if (t && t.length < 30 && t.length > 0) legends.add(t);
            });
            if (legends.size) data.legend = [...legends].slice(0, 8);

            const axes = new Set();
            document.querySelectorAll('[class*="axis"] text, .axis-label, [class*="tick"] text').forEach(el => {
                const t = el.textContent?.trim();
                if (t && t.length < 20 && t.length > 0) axes.add(t);
            });
            if (axes.size) data.axes = [...axes].slice(0, 10);

            const values = [];
            document.querySelectorAll('[class*="value"], [class*="label"] text, [data-value]').forEach(el => {
                const v = el.getAttribute('data-value') || el.textContent?.trim();
                if (v && /^[\d,.%$]+$/.test(v.replace(/\s/g, ''))) values.push(v);
            });
            if (values.length) data.values = [...new Set(values)].slice(0, 10);

            const title = document.querySelector('h1, h2, [class*="title"]')?.textContent?.trim();
            if (title) data.title = title.slice(0, 60);

            return data;
        }
    