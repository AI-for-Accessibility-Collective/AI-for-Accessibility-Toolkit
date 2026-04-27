/**
 * The Inclusive Post - Demo Site Scripts
 * Contains intentional accessibility issues for demonstration
 */

// Mobile menu toggle
function toggleMenu() {
  const menu = document.getElementById('mobileMenu');
  menu.classList.toggle('open');
}

// Cookie banner dismiss
function closeCookies() {
  document.getElementById('cookieBanner').classList.add('hidden');
}

// Auto-dismiss cookie banner after interaction
document.querySelector('.cookie-accept')?.addEventListener('click', closeCookies);

// ISSUE: No keyboard support for dropdown menus
// Dropdowns only work on hover (CSS-only), not on focus or keyboard

// ISSUE: Autoplay behavior for video (commented out but shows intent)
// Uncomment to make video autoplay - very distracting
/*
window.addEventListener('load', () => {
  const video = document.getElementById('mainVideo');
  if (video) {
    video.muted = true;
    video.play().catch(() => {});
  }
});
*/

// Simulate dynamic content loading (for MutationObserver testing)
setTimeout(() => {
  // Dynamically add more content after page load
  // This tests whether the extension picks up new images
}, 2000);

// Console message for developers testing the extension
console.log(`
╔═══════════════════════════════════════════════════════════════════╗
║                    THE INCLUSIVE POST                              ║
║                    Demo Site for AI4A11y                           ║
╠═══════════════════════════════════════════════════════════════════╣
║                                                                    ║
║  This site has INTENTIONAL accessibility issues for testing:      ║
║                                                                    ║
║  • Images without alt text                                         ║
║  • Video without captions                                          ║
║  • Audio without transcript                                        ║
║  • Low contrast text (#999 on #fff)                               ║
║  • Small font sizes (14px base)                                    ║
║  • Tight line spacing (1.3)                                        ║
║  • Thin font weights                                               ║
║  • Hover-only dropdown menus                                       ║
║  • Small touch targets                                             ║
║  • Animated/distracting ads                                        ║
║  • Color-only status indicators                                    ║
║  • Complex vocabulary in articles                                  ║
║  • No skip links                                                   ║
║  • Icon-only buttons/links                                         ║
║                                                                    ║
║  Use the AI for Accessibility extension to fix these issues!      ║
║                                                                    ║
╚═══════════════════════════════════════════════════════════════════╝
`);

// Feature detection logging for testing
document.addEventListener('DOMContentLoaded', () => {
  console.log('[Demo Site] Page loaded');
  console.log('[Demo Site] Images without alt:', document.querySelectorAll('img:not([alt]), img[alt=""]').length);
  console.log('[Demo Site] Videos:', document.querySelectorAll('video').length);
  console.log('[Demo Site] Audio elements:', document.querySelectorAll('audio').length);
});
