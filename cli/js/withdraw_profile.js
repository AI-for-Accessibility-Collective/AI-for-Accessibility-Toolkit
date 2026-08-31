() => {
                const api = window.ai4a11y;
                // Null, not 0: a page this CLI cannot drive has to be told
                // apart from one that had nothing switched on.
                if (!api || typeof api.listTools !== 'function'
                         || typeof api.disableTool !== 'function') return null;
                // Applying a profile starts by disabling every tool, so
                // clearing one does the same and enables nothing after it.
                const turnedOff = [];
                for (const tool of api.listTools()) {
                    if (!tool.enabled) continue;
                    let ok = false;
                    try {
                        const result = api.disableTool(tool.name);
                        ok = !!(result && result.success);
                    } catch (e) {
                        ok = false;
                    }
                    if (ok) turnedOff.push(tool.name);
                }
                // Read the tools back rather than trusting the return values.
                // This is the answer the command reports as a privacy
                // guarantee, so what is still enabled afterwards is the
                // question, not what each call claimed about itself.
                const stillOn = api.listTools()
                    .filter((tool) => tool.enabled)
                    .map((tool) => tool.name);
                return { turnedOff, stillOn };
            }
