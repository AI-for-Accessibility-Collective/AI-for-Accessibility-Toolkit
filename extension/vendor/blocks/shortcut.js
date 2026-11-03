// The toolkit's one shortcut: a pair of keys the person gives to one
// adapter. It is off until they choose the adapter; it lives in their
// profile (fields.adapterShortcut), so it follows them to every browser.
//
//   { adapter: 'owner/app/id', up: 'Alt+Shift+ArrowUp', down: 'Alt+Shift+ArrowDown' }
//
// With an adapter that adjusts something (s.keys.adjust: text size, speech
// rate), the pair is up and down. With one that has nothing to adjust, or
// one that is not running on the page, the first key alone turns it on and
// off on this site. Adapters have no shortcuts of their own, so there is
// nothing to clash.
//
// A combination is written with KeyboardEvent.code names: 'Alt+Shift+KeyJ',
// 'Alt+ArrowUp'. It needs Alt (Option); never Ctrl or Meta (the browser's,
// the system's and screen readers' commands); never a key the browser or a
// screen reader reserves. Pure: the popup checks a new choice with the same
// rules the page uses.

export const SHORTCUT_FIELD = 'adapterShortcut';
export const SHORTCUT_DEFAULT = Object.freeze({ up: 'Alt+Shift+ArrowUp', down: 'Alt+Shift+ArrowDown' });

// Keys never taken, even with Alt: Tab and Escape move and leave; Enter and
// Space activate; F-keys and the browser's Alt+Shift commands (A: focus a
// notification, B: bookmarks bar, I: report an issue, T: toolbar, in Chrome);
// Alt+F and Alt+E open Chrome's menu on Windows and Linux; Alt+Arrow Left
// and Right go back and forward; Alt+D and Alt+Home are the address bar and
// home page.
const NEVER = new Set(['Tab', 'Escape', 'Enter', 'NumpadEnter', 'Space', 'Backspace', 'Delete', 'CapsLock', 'ContextMenu']);
const BROWSER = new Set(['Alt+Shift+KeyA', 'Alt+Shift+KeyB', 'Alt+Shift+KeyI', 'Alt+Shift+KeyT', 'Alt+KeyF', 'Alt+KeyE', 'Alt+KeyD',
  'Alt+ArrowLeft', 'Alt+ArrowRight', 'Alt+Home', 'Alt+Shift+ArrowLeft', 'Alt+Shift+ArrowRight']);
const MODIFIER_CODES = /^(Alt|Shift|Control|Meta|OS)(Left|Right)?$/;

/** A combination's parts, or null. */
export function parseCombo(combo) {
  const parts = String(combo || '').split('+').map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return null;
  const code = parts.pop();
  const mods = new Set(parts.map((p) => p.toLowerCase()));
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(code) || [...mods].some((m) => !['alt', 'shift', 'ctrl', 'control', 'meta'].includes(m))) return null;
  return { code, alt: mods.has('alt'), shift: mods.has('shift'), ctrl: mods.has('ctrl') || mods.has('control'), meta: mods.has('meta') };
}

/** The combination a key event is, as written here (modifier keys alone are none). */
export function comboOf(e) {
  if (!e || !e.code || MODIFIER_CODES.test(e.code)) return '';
  return [e.ctrlKey && 'Ctrl', e.metaKey && 'Meta', e.altKey && 'Alt', e.shiftKey && 'Shift', e.code].filter(Boolean).join('+');
}

/** Why a combination cannot be the toolkit's shortcut, in plain words, or null when it can. */
export function checkCombo(combo) {
  const c = parseCombo(combo);
  if (!c) return 'Press a key together with Alt (Option on a Mac).';
  if (c.ctrl || c.meta) return 'Ctrl and Command are the browser’s, the system’s and screen readers’ keys. Use Alt (Option) instead.';
  if (!c.alt) return 'Use Alt (Option on a Mac) with the key, so typing never triggers it.';
  if (NEVER.has(c.code) || /^F\d+$/.test(c.code)) return 'That key is needed for moving around and using the page. Choose another.';
  const norm = ['Alt', c.shift && 'Shift', c.code].filter(Boolean).join('+');
  if (BROWSER.has(norm)) return 'The browser already uses that combination. Choose another.';
  return null;
}

/** The same combination written one way (Alt before Shift). */
export function normalCombo(combo) {
  const c = parseCombo(combo);
  return c ? ['Alt', c.shift && 'Shift', c.code].filter(Boolean).join('+') : '';
}

const KEY_NAMES = { ArrowUp: 'Up arrow', ArrowDown: 'Down arrow', ArrowLeft: 'Left arrow', ArrowRight: 'Right arrow', Equal: '=', Minus: '-', Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Backquote: '`', Backslash: '\\', PageUp: 'Page Up', PageDown: 'Page Down' };
/** A combination for people to read: 'Alt+Shift+Up arrow'. */
export function comboLabel(combo) {
  const c = parseCombo(combo);
  if (!c) return '';
  const key = KEY_NAMES[c.code] || c.code.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Numpad/, 'Keypad ');
  return [c.alt && 'Alt', c.shift && 'Shift', key].filter(Boolean).join('+');
}

/** The keys the person chose (kept while the shortcut is off), checked, or the defaults. */
export function shortcutKeysFromProfile(profile) {
  const f = (profile && (profile.fields || profile)[SHORTCUT_FIELD]) || {};
  const pick = (v, fallback) => (typeof v === 'string' && !checkCombo(v) ? normalCombo(v) : fallback);
  const up = pick(f.up, SHORTCUT_DEFAULT.up);
  let down = pick(f.down, SHORTCUT_DEFAULT.down);
  if (down === up) down = up === SHORTCUT_DEFAULT.down ? SHORTCUT_DEFAULT.up : SHORTCUT_DEFAULT.down;
  return { up, down };
}

/** The person's shortcut from their profile, checked, or null when it is off. */
export function shortcutFromProfile(profile) {
  const f = profile && (profile.fields || profile)[SHORTCUT_FIELD];
  if (!f || typeof f !== 'object' || typeof f.adapter !== 'string' || !/^[^/\s]+\/[^/\s]+\/[^/\s]+$/.test(f.adapter)) return null;
  return { adapter: f.adapter, ...shortcutKeysFromProfile(profile) };
}
