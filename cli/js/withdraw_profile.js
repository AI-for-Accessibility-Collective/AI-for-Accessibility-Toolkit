() => {
                const api = window.ai4a11y;
                if (!api) return 0;
                // Applying a profile starts by disabling every tool, so
                // clearing one does the same and enables nothing after it.
                let turnedOff = 0;
                for (const tool of api.listTools()) {
                    if (!tool.enabled) continue;
                    const result = api.disableTool(tool.name);
                    if (result && result.success) turnedOff += 1;
                }
                return turnedOff;
            }