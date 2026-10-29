// Native, labelled controls. Readers return typed values without JSON coercion.
const ENUMS = {
  'metaPreferences.consentBoundary': ['profile-only', 'all-tiers'],
  'metaPreferences.language': ['standard', 'plain'],
  'metaPreferences.sharing': ['personal', 'friends', 'anyone'],
  'fields.visionKind': ['blind', 'lowVision', 'colorBlind'],
};
const AREAS = ['vision', 'hearing', 'motor', 'cognitive', 'reading', 'sensory'];
const DIMENSIONS = ['textSize', 'lineSpacing', 'letterSpacing', 'reduceMotion', 'darkTheme', 'captions', 'simplify', 'contrast', 'dyslexiaFont', 'readAloudRate', 'readAloud', 'describeImages', 'labelControls', 'repairLandmarks', 'announceUpdates', 'spaAnnounce', 'skipLinks', 'pageStructure', 'keyboardAccess'];
export const VALUE_DEFAULTS = { string: '', number: 0, boolean: true, array: [], object: {}, null: null };
const typeOf = value => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
function node(tag, className, text) {
  const result = document.createElement(tag);
  if (className) result.className = className;
  if (text != null) result.textContent = text;
  return result;
}
function button(text, action, label) {
  const result = node('button', 'secondary', text);
  result.type = 'button';
  if (label) result.setAttribute('aria-label', label);
  result.addEventListener('click', action);
  return result;
}
function field(labelText, editor) {
  const group = node('div', 'input-group');
  const label = node('label', '', labelText);
  label.htmlFor = editor.id;
  group.append(label, editor.element);
  return group;
}
function dropdown(value, choices, id, onChange, optional = false, customLabel) {
  const values = [...(optional ? [undefined] : []), ...choices];
  const custom = customLabel && typeof value === 'string' && !values.includes(value);
  if (!values.includes(value) && !custom) values.push(value);
  const select = node('select');
  select.id = id;
  values.forEach((item, index) => {
    const option = node('option', '', item === undefined ? 'Not set' : String(item));
    option.value = String(index); select.append(option);
  });
  if (!customLabel) {
    select.value = String(values.indexOf(value));
    select.addEventListener('change', onChange);
    return { element: select, id, read: () => values[Number(select.value)] };
  }
  const otherOption = node('option', '', 'Other'); otherOption.value = 'other'; select.append(otherOption);
  select.value = custom ? 'other' : String(values.indexOf(value));
  const root = node('div', 'enum-editor'), choice = node('div', 'enum-choice');
  const customGroup = node('div', 'input-group enum-custom');
  const customInput = node('input'); customInput.id = `${id}-other`;
  customInput.value = custom ? value : ''; customInput.placeholder = 'Enter a custom value';
  const label = node('label', '', `Other ${customLabel}`); label.htmlFor = customInput.id;
  customGroup.append(label, customInput); customGroup.hidden = !custom;
  const showOther = () => {
    customGroup.hidden = select.value !== 'other'; onChange();
    if (!customGroup.hidden) customInput.focus();
  };
  select.addEventListener('change', showOther);
  customInput.addEventListener('input', onChange);
  choice.append(select, button('Other', () => { select.value = 'other'; showOther(); }, `Other value for ${customLabel}`));
  root.append(choice, customGroup);
  return { element: root, id, read() {
    if (select.value !== 'other') return values[Number(select.value)];
    if (!customInput.value.trim()) throw new Error(`Enter a custom value for ${customLabel}.`);
    return customInput.value;
  } };
}
function textEditor(value, id, onChange, multiline = false) {
  const input = node(multiline ? 'textarea' : 'input');
  input.id = id; input.value = value;
  if (multiline) input.rows = 3;
  input.addEventListener('input', onChange);
  return { element: input, id, read: () => input.value };
}
function numberEditor(value, id, onChange, label, optional = false) {
  const input = node('input');
  input.id = id; input.type = 'number'; input.step = 'any'; input.value = value ?? '';
  if (label.endsWith('confidence')) { input.min = '0'; input.max = '1'; }
  input.addEventListener('input', onChange);
  return { element: input, id, read() {
    if (optional && input.value === '' && !input.validity.badInput) return value === null ? null : undefined;
    if (!input.value.trim() || !input.validity.valid || !Number.isFinite(input.valueAsNumber)) throw new Error(`Enter a valid number for ${label}.`);
    return input.valueAsNumber;
  } };
}
function pillsEditor(value, path, id, onChange) {
  let items = [...value];
  const root = node('div', 'pills-editor'), pills = node('div', 'pills');
  const entry = node('div', 'pill-entry'), input = node('input');
  input.id = id; input.placeholder = 'Type a value and press Enter';
  const pending = () => input.value.split(',').map(s => s.trim()).filter(Boolean);
  function draw() {
    pills.replaceChildren();
    items.forEach((item, index) => {
      const pill = node('span', 'pill');
      pill.append(node('span', '', item), button('×', () => {
        items.splice(index, 1); draw(); input.focus(); onChange();
      }, `Remove ${item} from ${path.join('.')}`));
      pills.append(pill);
    });
  }
  function commit() {
    const additions = pending();
    for (const item of additions) if (!items.includes(item)) items.push(item);
    input.value = ''; draw(); onChange();
  }
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ',') { event.preventDefault(); commit(); }
  });
  input.addEventListener('input', onChange);
  input.addEventListener('blur', () => { if (input.value.trim()) commit(); });
  if (path.join('.') === 'supportAreas') {
    const list = node('datalist'); list.id = `${id}-suggestions`;
    for (const area of AREAS) { const option = node('option'); option.value = area; list.append(option); }
    input.setAttribute('list', list.id); root.append(list);
  }
  entry.append(input, button('Add', () => { commit(); input.focus(); }, `Add to ${path.join('.')}`));
  root.append(pills, entry); draw();
  return { element: root, id, read: () => [...items, ...pending().filter(item => !items.includes(item))] };
}

// A need's value may be boolean, numeric, text, or a structured custom value.
// Changing its type is explicit; changing dimensions never discards a value.
function typedEditor(value, path, id, onChange) {
  const root = node('div', 'typed-value');
  let editor;
  const makeEditor = next => next === null
    ? { element: node('span', 'hint', 'Null'), read: () => null }
    : createValueEditor({ value: next, path, id, onChange });
  const type = dropdown(typeOf(value), Object.keys(VALUE_DEFAULTS), `${id}-type`, () => {
    editor = makeEditor(structuredClone(VALUE_DEFAULTS[type.read()]));
    content.replaceChildren(editor.element); onChange();
  });
  type.element.setAttribute('aria-label', `${path.join('.')} value type`);
  const content = node('div');
  editor = makeEditor(value);
  content.append(editor.element); root.append(type.element, content);
  return { element: root, id, read: () => editor.read() };
}
function needsEditor(value, path, id, onChange) {
  const root = node('div', 'needs-editor'), list = node('div', 'needs-list');
  let sequence = 0;
  const entries = [];
  function add(need, notify = false) {
    const entryId = `${id}-need-${sequence++}`;
    const card = node('details', 'need-card');
    const summary = node('summary', 'need-summary');
    const title = node('span', 'need-title', 'Need');
    const preview = node('span', 'need-preview');
    summary.append(title, preview); card.append(summary);
    const body = node('fieldset', 'need-body');
    const legend = node('legend', 'visually-hidden', 'Need');
    body.append(legend);
    const properties = node('div', 'need-properties');
    const editors = new Map();
    const position = () => entries.indexOf(entry) + 1;
    const make = (key, editor) => {
      editors.set(key, editor); properties.append(field(key[0].toUpperCase() + key.slice(1), editor));
    };
    const needPath = [...path, String(sequence)];
    const update = () => { updateSummary(); onChange(); };
    const dimension = textEditor(need.dimension, `${entryId}-dimension`, update);
    const dimensions = node('datalist'); dimensions.id = `${entryId}-dimensions`;
    for (const name of DIMENSIONS) { const option = node('option'); option.value = name; dimensions.append(option); }
    dimension.element.setAttribute('list', dimensions.id);
    make('dimension', dimension);
    make('value', typedEditor(need.value, [...needPath, 'value'], `${entryId}-value`, update));
    make('strength', dropdown(need.strength, ['floor', 'preference', 'hint'], `${entryId}-strength`, onChange, true, 'strength'));
    make('unit', dropdown(need.unit, ['ratio', 'em', 'percent', 'boolean', 'enum'], `${entryId}-unit`, onChange, true, 'unit'));
    make('confidence', numberEditor(need.confidence, `${entryId}-confidence`, onChange, 'need confidence', true));
    const source = createValueEditor({ value: need.source ?? '', path: [...needPath, 'source'], id: `${entryId}-source`, onChange });
    make('source', { ...source, read: () => source.read() === '' ? (need.source == null ? need.source : '') : source.read() });
    for (const [key, child] of Object.entries(need)) if (!editors.has(key)) {
      make(key, createValueEditor({ value: child, path: [...needPath, key], id: `${entryId}-extra-${editors.size}`, onChange }));
    }
    function updateSummary() {
      let valueText;
      try { const current = editors.get('value').read(); valueText = typeof current === 'string' ? current : JSON.stringify(current); }
      catch { valueText = 'Incomplete value'; }
      const name = dimension.read() || 'Untitled need';
      preview.textContent = `${name} · ${valueText}`;
      preview.title = `${name} · ${valueText}`;
    }
    const entry = { card, legend, title, dimension, read() {
      const result = {};
      try {
        for (const [key, editor] of editors) {
          const next = editor.read();
          if (next !== undefined) Object.defineProperty(result, key, { value: next, enumerable: true, writable: true, configurable: true });
        }
        if (!result.dimension.trim()) throw new Error(`Enter a dimension for need ${position()}.`);
      } catch (error) {
        card.open = true;
        throw error;
      }
      return result;
    } };
    const remove = button('Remove need', () => {
      entries.splice(entries.indexOf(entry), 1); card.remove(); renumber(); addButton.focus(); onChange();
    });
    body.append(properties, remove); card.append(body); entries.push(entry); list.append(card); renumber(); updateSummary();
    if (notify) { card.open = true; dimension.element.focus(); onChange(); }
  }
  function renumber() { entries.forEach((entry, index) => { entry.legend.textContent = `Need ${index + 1}`; entry.title.textContent = `Need ${index + 1}`; }); }
  const addButton = button('+ Add need', () => add({ dimension: 'textSize', value: 1, strength: 'preference' }, true));
  root.id = id; root.tabIndex = -1;
  root.append(list, addButton);
  value.forEach(need => add(need));
  return { element: root, id, read: () => entries.map(entry => entry.read()) };
}

export function createValueEditor({ value, path, id, onChange }) {
  const key = path.join('.');
  if (key === 'fields.needs' && Array.isArray(value)) return needsEditor(value, path, id, onChange);
  if (ENUMS[key] && typeof value === 'string') return dropdown(value, ENUMS[key], id, onChange, false, key);
  if (Array.isArray(value) && value.every(item => typeof item === 'string')) return pillsEditor(value, path, id, onChange);
  if (typeof value === 'string') return textEditor(value, id, onChange, key === 'freeText');
  if (typeof value === 'number') return numberEditor(value, id, onChange, key);
  if (typeof value === 'boolean') {
    const label = node('label', 'toggle-control'), input = node('input');
    input.id = id; input.type = 'checkbox'; input.checked = value;
    input.setAttribute('role', 'switch');
    const caption = node('span', '', value ? 'Enabled' : 'Disabled');
    caption.setAttribute('aria-hidden', 'true');
    input.addEventListener('change', () => { caption.textContent = input.checked ? 'Enabled' : 'Disabled'; onChange(); });
    label.append(input, caption);
    return { element: label, id, read: () => input.checked };
  }
  if (value === null) {
    // Null is kept until the developer explicitly chooses a replacement type.
    const root = node('div', 'null-value');
    const type = dropdown('null', Object.keys(VALUE_DEFAULTS), id, () => {
      editor = createValueEditor({ value: structuredClone(VALUE_DEFAULTS[type.read()]), path, id: `${id}-value`, onChange });
      content.replaceChildren(editor.element); onChange();
    });
    let editor = { read: () => null };
    const content = node('div'); root.append(type.element, content);
    return { element: root, id, read: () => editor.read() };
  }
  // Less common custom arrays/objects also retain typed property controls.
  const root = node('div', 'nested-value'); root.id = id; root.tabIndex = -1;
  if (Array.isArray(value)) {
    const entries = [];
    const list = node('div', 'nested-list');
    let sequence = 0;
    const add = item => {
      const itemId = `${id}-item-${sequence++}`, row = node('div', 'array-item');
      const editor = typedEditor(item, [...path, String(sequence)], itemId, onChange);
      const entry = { read: editor.read };
      row.append(field('Item', editor), button('Remove item', () => { entries.splice(entries.indexOf(entry), 1); row.remove(); onChange(); }));
      entries.push(entry); list.append(row);
    };
    value.forEach(add);
    root.append(list, button('+ Add item', () => { add(''); onChange(); }));
    return { element: root, id, read: () => entries.map(entry => entry.read()) };
  }
  const entries = Object.entries(value).map(([key, child], index) => {
    const editor = createValueEditor({ value: child, path: [...path, key], id: `${id}-property-${index}`, onChange });
    root.append(field(key, editor)); return [key, editor];
  });
  if (!entries.length) root.append(node('p', 'hint', 'No properties. Add a nested key using the key path below.'));
  return { element: root, id, read: () => Object.fromEntries(entries.map(([key, editor]) => [key, editor.read()])) };
}
