// simplify-labels-test.mjs — unit tests for the 2.5 simplify-text +
// generate-labels fixes. Runs in plain Node (no browser) by importing only
// the exported pure-logic helpers, not the full adapter objects that need a
// live DOM.
//
//   node test/simplify-labels-test.mjs

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('PASS:', name); }
  else { fail++; console.log('FAIL:', name, detail !== undefined ? `— ${JSON.stringify(detail)}` : ''); }
}

// ---------------------------------------------------------------------------
// Minimal DOM mock — enough for the pure-logic helpers.
// We use a real JSDOM if available, otherwise a minimal stand-in.
// ---------------------------------------------------------------------------

// Tiny element stub for tests that don't need full DOM traversal.
function makeEl(tag, opts = {}) {
  const el = {
    tagName: tag.toUpperCase(),
    dataset: {},
    className: opts.className || '',
    id: opts.id || '',
    textContent: opts.textContent || '',
    children: [],
    childNodes: [],
    firstChild: null,
    lastChild: null,
    parentElement: opts.parentElement || null,
    parentNode: opts.parentNode || null,
    nextSibling: null,
    previousElementSibling: opts.prev || null,
    nextElementSibling: opts.next || null,
    _attrs: { ...(opts.attrs || {}) },
    getAttribute(name) { return this._attrs[name] ?? null; },
    setAttribute(name, value) { this._attrs[name] = value; },
    removeAttribute(name) { delete this._attrs[name]; },
    hasAttribute(name) { return name in this._attrs; },
    classList: {
      _classes: new Set((opts.className || '').split(' ').filter(Boolean)),
      add(c) { this._classes.add(c); },
      remove(c) { this._classes.delete(c); },
      contains(c) { return this._classes.has(c); },
    },
    style: {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    appendChild(child) {
      this.children.push(child);
      this.childNodes.push(child);
      if (!this.firstChild) this.firstChild = child;
      this.lastChild = child;
      child.parentElement = this;
      child.parentNode = this;
      return child;
    },
    insertBefore(newNode, ref) {
      const idx = this.childNodes.indexOf(ref);
      if (idx === -1) { this.appendChild(newNode); return newNode; }
      this.childNodes.splice(idx, 0, newNode);
      this.children.splice(idx, 0, newNode);
      newNode.parentElement = this;
      newNode.parentNode = this;
      this.firstChild = this.childNodes[0];
      this.lastChild = this.childNodes[this.childNodes.length - 1];
      return newNode;
    },
    remove() {
      if (this.parentNode) {
        const idx = this.parentNode.childNodes.indexOf(this);
        if (idx !== -1) {
          this.parentNode.childNodes.splice(idx, 1);
          this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1);
        }
        this.parentNode = null;
        this.parentElement = null;
      }
    },
    cloneNode() { return makeEl(tag, opts); }
  };
  return el;
}

// ---------------------------------------------------------------------------
// Mock chrome + globals so ES module imports don't crash.
// observe.js checks `typeof window !== 'undefined'` and calls
// window.addEventListener at module evaluation time, so these mocks must be
// set BEFORE any dynamic import() of modules that transitively load observe.js.
// ---------------------------------------------------------------------------
globalThis.location = { href: 'https://example.com/article' };
globalThis.MutationObserver = class { observe() {} disconnect() {} };
globalThis.CSS = { escape(s) { return s; } };

// window mock with addEventListener must be set before imports.
if (!globalThis.window) {
  globalThis.window = globalThis;
}
if (!globalThis.window.addEventListener) {
  globalThis.window.addEventListener = () => {};
}

globalThis.chrome = {
  storage: {
    sync: {
      async get(keys) { return {}; },
      async set(v) {},
    },
    session: {
      async get(key) { return {}; },
      async set(v) {},
    },
    local: { async get(k) { return {}; }, async set(v) {} },
  },
  runtime: {
    lastError: undefined,
    sendMessage(msg, cb) { if (cb) setTimeout(() => cb({}), 0); },
    onMessage: { addListener() {} },
  },
};

globalThis.document = {
  body: makeEl('body'),
  getElementById(id) { return null; },
  querySelectorAll() { return []; },
};

// ---------------------------------------------------------------------------
// Import pure-logic helpers from the adapter files.
// ---------------------------------------------------------------------------

// simplify-text pure helpers
const simplifyModule = await import('../skills/builtin/simplify-text.js');
const { _cacheKey, _shouldSkip, BATCH_DELIMITER, restoreOriginal, summarizeContent } = simplifyModule;

// generate-labels pure helpers
const labelsModule = await import('../skills/builtin/generate-labels.js');
const { isJunkName, isValidLabel, lacksAccessibleName } = labelsModule;

// ===========================================================================
// 1. Cache key hashing
// ===========================================================================
{
  const key1 = _cacheKey('https://example.com/', 'Hello world this is a test');
  const key2 = _cacheKey('https://example.com/', 'Hello world this is a test');
  const key3 = _cacheKey('https://example.com/', 'Different text entirely here');
  const key4 = _cacheKey('https://other.com/', 'Hello world this is a test');

  check('cache key: same url + same text → same key', key1 === key2, { key1, key2 });
  check('cache key: same url + different text → different key', key1 !== key3, { key1, key3 });
  check('cache key: different url + same text → different key', key1 !== key4, { key1, key4 });
  check('cache key: starts with ai4a11y-simplify:', key1.startsWith('ai4a11y-simplify:'), key1);
}

// ===========================================================================
// 2. Batch delimiter constant
// ===========================================================================
{
  check('BATCH_DELIMITER contains ---AI4A11Y_SPLIT---', BATCH_DELIMITER.includes('---AI4A11Y_SPLIT---'));

  // Simulate batching split/join round-trip.
  const texts = ['First paragraph text.', 'Second paragraph text.', 'Third.'];
  const joined = texts.join(BATCH_DELIMITER);
  const splitBack = joined.split(/\n?---AI4A11Y_SPLIT---\n?/);
  check('batch join/split round-trip: count matches', splitBack.length === texts.length, splitBack.length);
  check('batch join/split round-trip: first element matches', splitBack[0] === texts[0]);
  check('batch join/split round-trip: last element matches', splitBack[splitBack.length - 1] === texts[texts.length - 1]);
}

// ===========================================================================
// 3. _shouldSkip — landmark/region filtering
// ===========================================================================
{
  // Build a mock DOM subtree: el inside nav
  const nav = makeEl('nav');
  const pInNav = makeEl('p', { parentElement: nav });
  pInNav.closest = (sel) => {
    if (sel === '#ai4a11y-reader-mode') return null;
    return null;
  };
  // Make parentElement chain work for _shouldSkip's while loop.
  pInNav.parentElement = nav;
  nav.parentElement = null;
  nav.tagName = 'NAV';
  check('_shouldSkip: p inside nav → true', _shouldSkip(pInNav));

  // el inside footer
  const footer = makeEl('footer');
  footer.tagName = 'FOOTER';
  const pInFooter = makeEl('p', { parentElement: footer });
  pInFooter.closest = () => null;
  pInFooter.parentElement = footer;
  footer.parentElement = null;
  check('_shouldSkip: p inside footer → true', _shouldSkip(pInFooter));

  // el inside aside
  const aside = makeEl('aside');
  aside.tagName = 'ASIDE';
  const pInAside = makeEl('p', { parentElement: aside });
  pInAside.closest = () => null;
  pInAside.parentElement = aside;
  aside.parentElement = null;
  check('_shouldSkip: p inside aside → true', _shouldSkip(pInAside));

  // el inside role=navigation div
  const roleNav = makeEl('div', { attrs: { role: 'navigation' } });
  roleNav.tagName = 'DIV';
  const pInRoleNav = makeEl('p');
  pInRoleNav.closest = () => null;
  pInRoleNav.parentElement = roleNav;
  roleNav.parentElement = null;
  check('_shouldSkip: p inside role=navigation div → true', _shouldSkip(pInRoleNav));

  // el inside role=banner
  const banner = makeEl('div', { attrs: { role: 'banner' } });
  banner.tagName = 'DIV';
  const pInBanner = makeEl('p');
  pInBanner.closest = () => null;
  pInBanner.parentElement = banner;
  banner.parentElement = null;
  check('_shouldSkip: p inside role=banner div → true', _shouldSkip(pInBanner));

  // el in normal main — should NOT be skipped
  const main = makeEl('main');
  main.tagName = 'MAIN';
  const pInMain = makeEl('p');
  pInMain.closest = () => null;
  pInMain.parentElement = main;
  main.parentElement = null;
  check('_shouldSkip: p inside main → false', !_shouldSkip(pInMain));

  // el inside reader-mode overlay host
  const pInReader = makeEl('p');
  pInReader.closest = (sel) => sel === '#ai4a11y-reader-mode' ? makeEl('div') : null;
  pInReader.parentElement = null;
  check('_shouldSkip: p inside #ai4a11y-reader-mode → true', _shouldSkip(pInReader));
}

// ===========================================================================
// 4. DOM-preserving wrapper / restoreOriginal round-trip
//    We test restoreOriginal() directly by constructing the post-wrap DOM state
//    that simplifyText() produces, then calling restoreOriginal() and verifying
//    that the original children come back to the parent element.
// ===========================================================================
{
  // Simulate the post-wrap state:
  //   <p>
  //     <span class="ai4a11y-original-content" hidden>
  //       "Hello " <a>link</a> " world"
  //     </span>
  //     <span class="ai4a11y-text-content">SIMPLIFIED TEXT</span>
  //   </p>
  //   <button class="ai4a11y-toggle-original">Show original</button>  ← sibling

  const textNode1 = { textContent: 'Hello ', parentNode: null };
  const link = makeEl('a');
  link.textContent = 'link';
  const textNode2 = { textContent: ' world', parentNode: null };

  const originalWrapper = makeEl('span');
  originalWrapper.className = 'ai4a11y-original-content';
  // Seed originalWrapper.childNodes with the original children.
  originalWrapper.childNodes = [textNode1, link, textNode2];
  textNode1.parentNode = originalWrapper;
  link.parentNode = originalWrapper;
  textNode2.parentNode = originalWrapper;
  // Track firstChild via plain property (no defineProperty).
  originalWrapper.firstChild = textNode1;

  // restoreOriginal does: while (originalWrapper.firstChild) { para.appendChild(originalWrapper.firstChild); }
  // The firstChild must become null once all children are moved.
  // We simulate this by having a shared queue: firstChild pops from the front.
  const wrapperChildNodes = [textNode1, link, textNode2];

  // Simple object (not a Proxy) with firstChild as an accessor.
  const originalWrapperFake = Object.create(null);
  Object.defineProperty(originalWrapperFake, 'firstChild', {
    get() { return wrapperChildNodes[0] || null; },
    configurable: true
  });
  originalWrapperFake.childNodes = wrapperChildNodes;
  originalWrapperFake.className = 'ai4a11y-original-content';
  originalWrapperFake.getAttribute = (n) => originalWrapper._attrs[n] ?? null;
  originalWrapperFake.setAttribute = (n, v) => { originalWrapper._attrs[n] = v; };
  originalWrapperFake.querySelectorAll = () => [];

  let wrapperRemoved = false;
  originalWrapperFake.remove = () => { wrapperRemoved = true; };

  const textContainer = makeEl('span');
  textContainer.className = 'ai4a11y-text-content';
  textContainer.textContent = 'SIMPLIFIED TEXT';

  let textContainerRemoved = false;
  textContainer.remove = () => { textContainerRemoved = true; };

  const para = makeEl('p');
  // Track appendChild calls to know what gets moved back.
  // Also shift from wrapperChildNodes so firstChild becomes null.
  const movedBack = [];
  para.appendChild = (child) => {
    movedBack.push(child);
    // Remove from wrapperChildNodes so firstChild advances.
    const idx = wrapperChildNodes.indexOf(child);
    if (idx !== -1) wrapperChildNodes.splice(idx, 1);
    return child;
  };
  para.dataset.ai4a11ySimplified = 'done';
  para.dataset.ai4a11yOriginal = 'original text';
  para.classList._classes.add('ai4a11y-simplified');
  para.nextSibling = null;

  // querySelector returns our spans.
  para.querySelector = (sel) => {
    if (sel === '.ai4a11y-original-content') return originalWrapperFake;
    if (sel === '.ai4a11y-text-content') return textContainer;
    if (sel === '.ai4a11y-toggle-original') return null;
    return null;
  };

  // Verify pre-conditions.
  check('after wrap: originalWrapper has 3 children', wrapperChildNodes.length === 3, wrapperChildNodes.length);
  check('after wrap: link is in originalWrapper', wrapperChildNodes.includes(link));

  // Now restoreOriginal should:
  //  1. remove textContainer
  //  2. move all 3 children from originalWrapper back to para
  //  3. remove originalWrapper
  //  4. delete dataset marks and remove class
  restoreOriginal(para);

  check('restoreOriginal: textContainer removed', textContainerRemoved);
  check('restoreOriginal: 3 children moved back to para', movedBack.length === 3, movedBack.length);
  check('restoreOriginal: link is among moved-back children', movedBack.includes(link));
  check('restoreOriginal: originalWrapper removed', wrapperRemoved);
  check('restoreOriginal: data-ai4a11y-simplified deleted', !('ai4a11ySimplified' in para.dataset));
  check('restoreOriginal: ai4a11y-simplified class removed', !para.classList.contains('ai4a11y-simplified'));
}

// ===========================================================================
// 5. isJunkName guard (generate-labels)
// ===========================================================================
{
  check('isJunkName: "q" → true', isJunkName('q'));
  check('isJunkName: "s" → true', isJunkName('s'));
  check('isJunkName: "utf8" → true', isJunkName('utf8'));
  check('isJunkName: "csrf_token" → true', isJunkName('csrf_token'));
  check('isJunkName: "authenticity_token" → true', isJunkName('authenticity_token'));
  check('isJunkName: "id" → true', isJunkName('id'));
  check('isJunkName: "__RequestVerificationToken" → true', isJunkName('__RequestVerificationToken'));
  check('isJunkName: empty string → true', isJunkName(''));
  check('isJunkName: null → true', isJunkName(null));
  check('isJunkName: "email" → false', !isJunkName('email'));
  check('isJunkName: "search_query" → false', !isJunkName('search_query'));
  check('isJunkName: "username" → false', !isJunkName('username'));
  check('isJunkName: "first_name" → false', !isJunkName('first_name'));
}

// ===========================================================================
// 6. isValidLabel confidence gate (generate-labels)
// ===========================================================================
{
  check('isValidLabel: normal label → true', isValidLabel('Submit form'));
  check('isValidLabel: single char → true', isValidLabel('X'));
  check('isValidLabel: 60-char label → true', isValidLabel('A'.repeat(60)));
  check('isValidLabel: 61-char label → false (too long)', !isValidLabel('A'.repeat(61)));
  check('isValidLabel: empty string → false', !isValidLabel(''));
  check('isValidLabel: null → false', !isValidLabel(null));
  check('isValidLabel: label with newline → false', !isValidLabel('Submit\nform'));
  check('isValidLabel: refusal "I cannot determine..." → false', !isValidLabel('I cannot determine the label for this element'));
  check('isValidLabel: refusal "Sorry, unable to..." → false', !isValidLabel('Sorry, unable to provide a label'));
  check('isValidLabel: refusal "N/A" → false', !isValidLabel('N/A'));
  check('isValidLabel: refusal "Unknown" → false', !isValidLabel('Unknown'));
  check('isValidLabel: refusal "Not available" → false', !isValidLabel('Not available'));
  check('isValidLabel: refusal "UNSURE" — caught as "not sure"', !isValidLabel('not sure'));
  check('isValidLabel: whitespace only → false (trims to empty)', !isValidLabel('   '));
}

// ===========================================================================
// 7. lacksAccessibleName ACCNAME-gate decision function
//    We mock computeAccessibleName inline since no real DOM is available.
// ===========================================================================
{
  // lacksAccessibleName uses computeAccessibleName from dom-accessibility-api.
  // Since we're in Node and can't call the real library without JSDOM, we test
  // the *exported function itself* by verifying its contract with a real import.
  // The module already imported it above; we test its error-handling path.

  // When computeAccessibleName throws (non-DOM element), lacksAccessibleName
  // should return true (safer to label than to skip).
  const brokenEl = { _broken: true }; // not a real element
  const resultForBroken = lacksAccessibleName(brokenEl);
  check('lacksAccessibleName: throws gracefully on broken element → true', resultForBroken === true, resultForBroken);

  // Verify the function is exported and callable.
  check('lacksAccessibleName is exported as a function', typeof lacksAccessibleName === 'function');
}

// ===========================================================================
// 8. BATCH_DELIMITER mismatch fallback coverage (pure logic)
// ===========================================================================
{
  // Simulate _simplifyBatch response where part count mismatches element count.
  const elements = ['a', 'b', 'c'];
  const badResponse = 'Only one result here'; // no delimiter
  const parts = badResponse.split(/\n?---AI4A11Y_SPLIT---\n?/);
  check('batch: mismatch detected (1 part for 3 elements)', parts.length !== elements.length, parts.length);

  // Correct batch response
  const goodResponse = ['Simplified A', 'Simplified B', 'Simplified C'].join(BATCH_DELIMITER);
  const goodParts = goodResponse.split(/\n?---AI4A11Y_SPLIT---\n?/);
  check('batch: correct response splits to 3 parts', goodParts.length === 3, goodParts.length);
  check('batch: first part is "Simplified A"', goodParts[0] === 'Simplified A');
  check('batch: last part is "Simplified C"', goodParts[2] === 'Simplified C');
}

// ===========================================================================
// 9. Summary
// ===========================================================================
console.log(`\n=== simplify-labels-test: ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
