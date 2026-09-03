
            async () => {
                const results = await axe.run();
                return {
                    violations: results.violations.map(v => ({
                        id: v.id,
                        impact: v.impact,
                        description: v.description,
                        help: v.help,
                        helpUrl: v.helpUrl,
                        nodes: v.nodes.length
                    })),
                    passes: results.passes.length,
                    incomplete: results.incomplete.length,
                    url: window.location.href
                };
            }
        