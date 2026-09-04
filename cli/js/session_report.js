
            async () => {
                const results = await axe.run();
                return {
                    url: window.location.href,
                    title: document.title,
                    timestamp: new Date().toISOString(),
                    violations: results.violations,
                    passes: results.passes,
                    incomplete: results.incomplete,
                    inapplicable: results.inapplicable
                };
            }
        