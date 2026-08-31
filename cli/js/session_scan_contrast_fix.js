(d) => {
                            const el = document.querySelector(d.s);
                            if (!el) return;
                            const bg = getComputedStyle(el).backgroundColor;
                            // Parse RGB and calculate luminance
                            const rgb = bg.match(/\d+/g);
                            if (rgb && rgb.length >= 3) {
                                const lum = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
                                el.style.color = lum > 0.5 ? '#000000' : '#ffffff';
                                el.dataset.ai4a11yContrastFixed = 'true';
                            }
                        }