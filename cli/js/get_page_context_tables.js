
            () => {
                const out = [];
                document.querySelectorAll('table.infobox, table.wikitable, table[role="table"]').forEach(t => {
                    const rows = [];
                    t.querySelectorAll('tr').forEach(tr => {
                        const cells = [...tr.querySelectorAll('th, td')].map(c => (c.textContent || '').trim().replace(/\s+/g,' '));
                        if (cells.length) rows.push(cells.join(' | '));
                    });
                    if (rows.length) out.push(rows.slice(0, 40).join('\n'));
                });
                return out.slice(0, 3);  // up to 3 tables
            }
        