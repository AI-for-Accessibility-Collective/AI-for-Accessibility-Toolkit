(sel) => {
                            const el = document.querySelector(sel);
                            if (!el) return null;
                            const s = getComputedStyle(el);
                            return { fg: s.color, bg: s.backgroundColor };
                        }