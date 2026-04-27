# Adapters

Adapters fix accessibility issues found by analyzers.

## Adding a new adapter

1. Create a file in this folder (e.g., `my-adapter.js`)
2. Export your fix functions
3. Export an `axeHandlers` object mapping axe rule IDs to handlers
4. Import in `index.js`

## Example

```js
// src/adapters/fix-tables.js

import { markProcessed } from '../utils/dom.js';
import { logFix, incrementStat } from '../stats.js';

// Fix table without headers
export function fixTableHeaders(table) {
  if (table.dataset.ai4a11yProcessed) return;
  markProcessed(table, 'pending');

  const firstRow = table.querySelector('tr');
  if (!firstRow) return;

  // Convert first row cells to th
  firstRow.querySelectorAll('td').forEach(td => {
    const th = document.createElement('th');
    th.innerHTML = td.innerHTML;
    th.scope = 'col';
    td.replaceWith(th);
  });

  markProcessed(table, 'done');
  incrementStat('wcag');
  logFix('table-headers', table, '(none)', '(added)');
}

// Map axe rule IDs to handlers
export const axeHandlers = {
  'td-has-header': fixTableHeaders
};
```

Then in `index.js`:

```js
import { axeHandlers as tableHandlers } from './fix-tables.js';

export const axeHandlers = {
  ...existingHandlers,
  ...tableHandlers
};
```

## Available utilities

- `markProcessed(el, status)` - Mark element as processed
- `logFix(type, el, old, new)` - Log fix for popup display
- `incrementStat(type)` - Increment counter ('wcag', 'images', 'labels')
- `sendMessage(msg)` - Send message to background script
