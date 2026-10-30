// "Who can read what it gives the toolkit": the setting for one app (Apps
// page) or one adapter (Adapters page). The app or adapter declares a level;
// the person can narrow it here, never widen it (server/src/access.js).

const LEVEL_TEXT = {
  user: 'every app of yours',
  app: 'only this app',
  adapter: 'only this adapter',
};
// For an adapter, app level is the app it runs in.
const ADAPTER_TEXT = { ...LEVEL_TEXT, app: 'only the app it runs in' };

/**
 * @param {object} o
 * @param {string} o.id         the select's id
 * @param {string} o.name       the app's or adapter's name, for the label
 * @param {'user'|'app'|'adapter'} o.declared
 * @param {string|null} o.restricted   what the person chose, or null
 * @param {string[]} o.levels   the narrower levels on offer (['app'] for an app)
 * @param {boolean} [o.adapter] the setting is for an adapter
 * @param {(level: string|null) => Promise<void>} o.onChange
 */
export function visibilityControl({ id, name, declared = 'user', restricted = null, levels, adapter = false, onChange }) {
  const text = adapter ? ADAPTER_TEXT : LEVEL_TEXT;
  const wrap = document.createElement('div');
  wrap.className = 'visibility-setting';
  const label = document.createElement('label');
  label.htmlFor = id;
  label.textContent = 'Who can read what it gives the toolkit';
  const select = document.createElement('select');
  select.id = id;
  select.setAttribute('aria-describedby', `${id}-hint`);
  select.append(new Option(`As declared: ${text[declared] || text.user}`, ''));
  const rank = ['user', 'app', 'adapter'];
  for (const level of levels) {
    if (rank.indexOf(level) > rank.indexOf(declared)) select.append(new Option(`Narrower: ${text[level]}`, level));
  }
  select.value = restricted && [...select.options].some(o => o.value === restricted) ? restricted : '';
  select.disabled = select.options.length === 1;
  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.id = `${id}-hint`;
  hint.textContent = select.disabled
    ? `${name} already keeps what it gives to the narrowest level here.`
    : `Its observations, what the toolkit learns from them, and its stored data.${adapter ? ' At adapter level, the apps that run it can read them too.' : ''} You can narrow what it declared, not widen it.`;
  select.addEventListener('change', () => onChange(select.value || null));
  wrap.append(label, select, hint);
  return wrap;
}
