// What the assistant sees of a page when the person shares its source: an
// outline of the visible page (landmarks, headings, controls, text, and the
// size and colors of text), not its raw HTML. Runs in the page through
// chrome.scripting.executeScript, so it must not use anything outside itself.

/** @param {number} maxChars @returns {{url: string, title: string, outline: string}} */
export function pageOutline(maxChars = 40000) {
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'META', 'LINK', 'HEAD']);
  const KEEP_ATTRS = ['id', 'role', 'aria-label', 'aria-labelledby', 'aria-describedby', 'aria-hidden', 'aria-expanded', 'alt', 'title', 'type', 'name', 'placeholder', 'href', 'for', 'tabindex', 'lang'];
  const lines = [];
  let size = 0, cut = false;
  const push = (line) => {
    if (size + line.length > maxChars) { cut = true; return false; }
    lines.push(line); size += line.length + 1; return true;
  };
  const visible = (el) => {
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 || r.height > 0 || el.children.length > 0;
  };
  const ownText = (el) => [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join(' ').replace(/\s+/g, ' ').trim();
  const describe = (el) => {
    let d = el.tagName.toLowerCase();
    if (el.classList.length) d += '.' + [...el.classList].slice(0, 3).join('.');
    const attrs = KEEP_ATTRS.filter(a => el.hasAttribute(a)).map(a => {
      let v = el.getAttribute(a);
      if (a === 'href') v = v.slice(0, 80);
      return `${a}="${String(v).slice(0, 80)}"`;
    });
    if (attrs.length) d += ' [' + attrs.join(' ') + ']';
    const text = ownText(el);
    if (text) {
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      d += ` "${text.slice(0, 160)}" {${Math.round(r.width)}x${Math.round(r.height)} ${s.fontSize} ${s.color} on ${s.backgroundColor}}`;
    } else if (/^(BUTTON|A|INPUT|SELECT|TEXTAREA|IMG)$/.test(el.tagName)) {
      const r = el.getBoundingClientRect();
      d += ` {${Math.round(r.width)}x${Math.round(r.height)}}`;
    }
    return d;
  };
  const walk = (el, depth) => {
    if (cut || SKIP.has(el.tagName) || !visible(el)) return;
    // Wrappers with nothing of their own say nothing: their children move up.
    const plain = /^(DIV|SPAN)$/.test(el.tagName) && !ownText(el) && !KEEP_ATTRS.some(a => a !== 'id' && el.hasAttribute(a));
    if (!plain && !push('  '.repeat(Math.min(depth, 20)) + describe(el))) return;
    for (const child of el.children) walk(child, plain ? depth : depth + 1);
  };
  walk(document.body, 0);
  if (cut) lines.push(`… (the rest of the page is left out: over ${maxChars} characters)`);
  return { url: location.href, title: document.title, outline: lines.join('\n') };
}
