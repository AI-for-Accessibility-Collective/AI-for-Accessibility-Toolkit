
            () => {
                const selectors = [
                    // Cookie consent
                    '[class*="cookie"] button[class*="accept"]',
                    '[class*="cookie"] button[class*="agree"]',
                    '[class*="cookie"] button[class*="close"]',
                    '[class*="consent"] button[class*="accept"]',
                    '[id*="cookie"] button',
                    '[aria-label*="cookie" i] button',
                    '[aria-label*="accept" i][aria-label*="cookie" i]',
                    // Generic modals/dialogs
                    '[role="dialog"] button[aria-label*="close" i]',
                    '[role="dialog"] button[aria-label*="dismiss" i]',
                    '[role="alertdialog"] button[aria-label*="close" i]',
                    '[class*="modal"] button[class*="close"]',
                    '[class*="modal"] [aria-label*="close" i]',
                    '[class*="popup"] button[class*="close"]',
                    '[class*="overlay"] button[class*="close"]',
                    // Newsletter/signup popups
                    '[class*="newsletter"] button[class*="close"]',
                    '[class*="subscribe"] button[class*="close"]',
                    // Generic X close buttons
                    'button[aria-label="Close"]',
                    'button[aria-label="Dismiss"]',
                    '[class*="close-button"]',
                    // GDPR specific
                    '#onetrust-accept-btn-handler',
                    '.cc-dismiss',
                    '.cc-accept',
                ];
                let count = 0;
                for (const sel of selectors) {
                    const btns = document.querySelectorAll(sel);
                    for (const btn of btns) {
                        if (btn.offsetParent !== null) {  // visible
                            btn.click();
                            count++;
                        }
                    }
                }
                // Also try removing common overlay classes
                document.querySelectorAll('[class*="overlay"][class*="cookie"]').forEach(el => {
                    el.style.display = 'none';
                    count++;
                });
                return count;
            }
        