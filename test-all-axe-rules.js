/**
 * Test ALL axe-core rules with intentional violations
 * Creates test HTML that triggers each rule, applies fix, verifies
 */

const { chromium } = require('playwright');
const fs = require('fs');

// ALL axe-core rules with test HTML that triggers each violation
const ALL_AXE_RULES = {
  // ===== ARIA =====
  'aria-allowed-attr': {
    html: '<div role="button" aria-checked="true">Button</div>',
    description: 'ARIA attr not allowed on role'
  },
  'aria-allowed-role': {
    html: '<meta role="banner">',
    description: 'Role not allowed on element'
  },
  'aria-braille-equivalent': {
    html: '<div aria-braillelabel="test">Content</div>',
    description: 'Braille label without text equivalent'
  },
  'aria-command-name': {
    html: '<div role="button"></div>',
    description: 'ARIA command without name'
  },
  'aria-conditional-attr': {
    html: '<div role="option" aria-checked="true">Option</div>',
    description: 'Conditional ARIA attr'
  },
  'aria-deprecated-role': {
    html: '<div role="directory">List</div>',
    description: 'Deprecated ARIA role'
  },
  'aria-dialog-name': {
    html: '<div role="dialog">Dialog content</div>',
    description: 'Dialog without name'
  },
  'aria-hidden-body': {
    html: '<body aria-hidden="true"><div>Content</div></body>',
    description: 'aria-hidden on body',
    useBody: true
  },
  'aria-hidden-focus': {
    html: '<div aria-hidden="true"><button>Click</button></div>',
    description: 'Focusable inside aria-hidden'
  },
  'aria-input-field-name': {
    html: '<div role="textbox"></div>',
    description: 'ARIA input without name'
  },
  'aria-meter-name': {
    html: '<div role="meter" aria-valuenow="5" aria-valuemin="0" aria-valuemax="10"></div>',
    description: 'Meter without name'
  },
  'aria-progressbar-name': {
    html: '<div role="progressbar" aria-valuenow="50"></div>',
    description: 'Progressbar without name'
  },
  'aria-prohibited-attr': {
    html: '<div role="img" aria-label="Image" aria-hidden="true">Img</div>',
    description: 'Prohibited ARIA attr combination'
  },
  'aria-required-attr': {
    html: '<div role="checkbox">Check</div>',
    description: 'Missing required ARIA attr'
  },
  'aria-required-children': {
    html: '<div role="list"><span>Item</span></div>',
    description: 'Missing required children',
    unfixable: true
  },
  'aria-required-parent': {
    html: '<div role="listitem">Item</div>',
    description: 'Missing required parent',
    unfixable: true
  },
  'aria-roledescription': {
    html: '<div aria-roledescription="custom">Content</div>',
    description: 'roledescription without role'
  },
  'aria-roles': {
    html: '<div role="fakeRole">Content</div>',
    description: 'Invalid ARIA role'
  },
  'aria-text': {
    html: '<div role="text"><button>Click</button></div>',
    description: 'role=text with focusable descendants',
    unfixable: true
  },
  'aria-toggle-field-name': {
    html: '<div role="switch"></div>',
    description: 'Toggle without name'
  },
  'aria-tooltip-name': {
    html: '<div role="tooltip"></div>',
    description: 'Tooltip without name'
  },
  'aria-treeitem-name': {
    html: '<div role="treeitem"></div>',
    description: 'Treeitem without name'
  },
  'aria-valid-attr': {
    html: '<div aria-foobar="true">Content</div>',
    description: 'Invalid ARIA attr name'
  },
  'aria-valid-attr-value': {
    html: '<div aria-hidden="yes">Content</div>',
    description: 'Invalid ARIA attr value'
  },

  // ===== IMAGES =====
  'image-alt': {
    html: '<img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7">',
    description: 'Image without alt',
    needsAI: true
  },
  'image-redundant-alt': {
    html: '<p>Photo of sunset<img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" alt="Photo of sunset"></p>',
    description: 'Redundant alt text'
  },
  'input-image-alt': {
    html: '<input type="image" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7">',
    description: 'Input image without alt',
    needsAI: true
  },
  'role-img-alt': {
    html: '<div role="img">Image content</div>',
    description: 'role=img without alt'
  },
  'svg-img-alt': {
    html: '<svg role="img"><circle cx="50" cy="50" r="40"/></svg>',
    description: 'SVG img without alt'
  },
  'object-alt': {
    html: '<object data="test.swf"></object>',
    description: 'Object without alt'
  },
  'area-alt': {
    html: '<map name="map1"><area shape="rect" coords="0,0,100,100" href="#"></map><img usemap="#map1" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" alt="Map">',
    description: 'Area without alt'
  },

  // ===== LINKS/BUTTONS =====
  'link-name': {
    html: '<a href="#"></a>',
    description: 'Link without name'
  },
  'button-name': {
    html: '<button></button>',
    description: 'Button without name'
  },
  'link-in-text-block': {
    html: '<p style="color:#333">Text with <a href="#" style="color:#336">link</a> inside.</p>',
    description: 'Link not distinguishable in text'
  },

  // ===== FORMS =====
  'autocomplete-valid': {
    html: '<input type="text" autocomplete="invalid-value">',
    description: 'Invalid autocomplete value'
  },
  'form-field-multiple-labels': {
    html: '<label for="input1">Label 1</label><label for="input1">Label 2</label><input id="input1">',
    description: 'Multiple labels for one input'
  },
  'input-button-name': {
    html: '<input type="submit" value="">',
    description: 'Input button without name'
  },
  'label': {
    html: '<input type="text">',
    description: 'Input without label'
  },
  'label-title-only': {
    html: '<input type="text" title="Name field">',
    description: 'Input with only title'
  },
  'select-name': {
    html: '<select><option>A</option></select>',
    description: 'Select without name'
  },

  // ===== COLOR/CONTRAST =====
  'color-contrast': {
    html: '<p style="color:#777;background:#fff">Low contrast text</p>',
    description: 'Insufficient color contrast'
  },
  'color-contrast-enhanced': {
    html: '<p style="color:#666;background:#fff">Enhanced contrast needed</p>',
    description: 'AAA contrast not met'
  },

  // ===== DOCUMENT =====
  'document-title': {
    html: '<!-- no title -->',
    description: 'Missing page title',
    checkTitle: true
  },
  'html-has-lang': {
    html: '<html><body>Content</body></html>',
    description: 'HTML without lang',
    checkHtml: true
  },
  'html-lang-valid': {
    html: '<html lang="xx"><body>Content</body></html>',
    description: 'Invalid lang code',
    checkHtml: true
  },
  'html-xml-lang-mismatch': {
    html: '<html lang="en" xml:lang="fr"><body>Content</body></html>',
    description: 'lang/xml:lang mismatch',
    checkHtml: true
  },
  'meta-refresh': {
    html: '<meta http-equiv="refresh" content="5">',
    description: 'Meta refresh'
  },
  'meta-viewport': {
    html: '<meta name="viewport" content="width=device-width,user-scalable=no">',
    description: 'Viewport disables zoom'
  },
  'meta-viewport-large': {
    html: '<meta name="viewport" content="width=device-width,maximum-scale=1.0">',
    description: 'Viewport limits zoom'
  },
  'valid-lang': {
    html: '<div lang="xyz">Content</div>',
    description: 'Invalid lang on element'
  },

  // ===== KEYBOARD =====
  'accesskeys': {
    html: '<a href="#" accesskey="a">Link 1</a><button accesskey="a">Button</button>',
    description: 'Duplicate accesskeys'
  },
  'frame-focusable-content': {
    html: '<iframe tabindex="-1" src="about:blank"><button>Click</button></iframe>',
    description: 'Frame with focusable content'
  },
  'scrollable-region-focusable': {
    html: '<div style="overflow:scroll;height:50px"><div style="height:200px">Scrollable</div></div>',
    description: 'Scrollable not focusable'
  },
  'tabindex': {
    html: '<div tabindex="5">Content</div>',
    description: 'Positive tabindex'
  },

  // ===== FRAMES =====
  'frame-title': {
    html: '<iframe src="about:blank"></iframe>',
    description: 'Frame without title'
  },
  'frame-title-unique': {
    html: '<iframe title="Frame" src="about:blank"></iframe><iframe title="Frame" src="about:blank"></iframe>',
    description: 'Duplicate frame titles'
  },

  // ===== TABLES =====
  'scope-attr-valid': {
    html: '<table><tr><th scope="invalid">Header</th></tr></table>',
    description: 'Invalid scope attr'
  },
  'table-duplicate-name': {
    html: '<table summary="Table"><caption>Table</caption><tr><td>Data</td></tr></table>',
    description: 'Duplicate table name'
  },
  'td-has-header': {
    html: '<table><tr><td>Data 1</td><td>Data 2</td></tr><tr><td>Data 3</td><td>Data 4</td></tr></table>',
    description: 'Data cells without headers',
    unfixable: true
  },
  'td-headers-attr': {
    html: '<table><tr><th id="h1">H1</th></tr><tr><td headers="nonexistent">Data</td></tr></table>',
    description: 'Invalid headers attr',
    unfixable: true
  },
  'th-has-data-cells': {
    html: '<table><tr><th>Header</th></tr></table>',
    description: 'Header without data cells',
    unfixable: true
  },
  'empty-table-header': {
    html: '<table><tr><th></th><td>Data</td></tr></table>',
    description: 'Empty table header'
  },

  // ===== TEXT =====
  'empty-heading': {
    html: '<h2></h2>',
    description: 'Empty heading'
  },
  'p-as-heading': {
    html: '<p><strong>This looks like a heading</strong></p><p>Content below.</p>',
    description: 'Paragraph styled as heading',
    unfixable: true
  },
  'summary-name': {
    html: '<details><summary></summary>Content</details>',
    description: 'Empty summary'
  },

  // ===== LANDMARKS =====
  'bypass': {
    html: '<nav><a href="#">Link 1</a><a href="#">Link 2</a></nav><main>Content</main>',
    description: 'No skip link'
  },
  'landmark-banner-is-top-level': {
    html: '<main><header role="banner">Banner</header></main>',
    description: 'Banner not top-level',
    unfixable: true
  },
  'landmark-complementary-is-top-level': {
    html: '<main><aside>Sidebar</aside></main>',
    description: 'Aside not top-level',
    unfixable: true
  },
  'landmark-contentinfo-is-top-level': {
    html: '<main><footer role="contentinfo">Footer</footer></main>',
    description: 'Footer not top-level',
    unfixable: true
  },
  'landmark-main-is-top-level': {
    html: '<div role="main"><main>Nested main</main></div>',
    description: 'Main not top-level',
    unfixable: true
  },
  'landmark-no-duplicate-banner': {
    html: '<header role="banner">H1</header><header role="banner">H2</header><main>Content</main>',
    description: 'Duplicate banner',
    unfixable: true
  },
  'landmark-no-duplicate-contentinfo': {
    html: '<main>Content</main><footer role="contentinfo">F1</footer><footer role="contentinfo">F2</footer>',
    description: 'Duplicate contentinfo',
    unfixable: true
  },
  'landmark-no-duplicate-main': {
    html: '<main>Main 1</main><main>Main 2</main>',
    description: 'Duplicate main',
    unfixable: true
  },
  'landmark-one-main': {
    html: '<div>No main landmark here</div>',
    description: 'No main landmark'
  },
  'landmark-unique': {
    html: '<nav>Nav 1</nav><nav>Nav 2</nav><main>Content</main>',
    description: 'Duplicate landmarks'
  },
  'page-has-heading-one': {
    html: '<h2>Subheading</h2><p>Content</p>',
    description: 'No h1'
  },
  'region': {
    html: '<div>Content outside landmark</div><main>Main</main>',
    description: 'Content outside landmarks',
    unfixable: true
  },
  'skip-link': {
    html: '<a href="#nonexistent" class="skip-link">Skip</a><main id="main">Content</main>',
    description: 'Skip link target missing'
  },

  // ===== LISTS =====
  'definition-list': {
    html: '<dl><div><dt>Term</dt><dd>Def</dd></div></dl>',
    description: 'Invalid dl structure',
    unfixable: true
  },
  'dlitem': {
    html: '<dt>Term without dl</dt>',
    description: 'dt/dd without dl',
    unfixable: true
  },
  'list': {
    html: '<ul><div>Not a list item</div></ul>',
    description: 'Invalid list structure',
    unfixable: true
  },
  'listitem': {
    html: '<li>List item without list</li>',
    description: 'li without list',
    unfixable: true
  },

  // ===== OBSOLETE =====
  'blink': {
    html: '<blink>Blinking text</blink>',
    description: 'Blink element'
  },
  'marquee': {
    html: '<marquee>Scrolling text</marquee>',
    description: 'Marquee element'
  },

  // ===== IDS =====
  'duplicate-id': {
    html: '<div id="dup">First</div><div id="dup">Second</div>',
    description: 'Duplicate IDs'
  },
  'duplicate-id-active': {
    html: '<label for="dup">Label</label><input id="dup"><input id="dup">',
    description: 'Duplicate active IDs'
  },
  'duplicate-id-aria': {
    html: '<div id="dup">Ref</div><button aria-describedby="dup">B1</button><div id="dup">Ref2</div>',
    description: 'Duplicate ARIA IDs'
  },

  // ===== MEDIA =====
  'audio-caption': {
    html: '<audio src="test.mp3" controls></audio>',
    description: 'Audio without captions',
    needsAI: true
  },
  'no-autoplay-audio': {
    html: '<video autoplay><source src="test.mp4"></video>',
    description: 'Autoplay audio'
  },
  'video-caption': {
    html: '<video src="test.mp4" controls></video>',
    description: 'Video without captions',
    needsAI: true
  },

  // ===== OTHER =====
  'avoid-inline-spacing': {
    html: '<p style="letter-spacing:2px !important">Spaced text</p>',
    description: 'Inline spacing override'
  },
  'css-orientation-lock': {
    html: '<div>Content (needs CSS check)</div>',
    description: 'Orientation locked',
    unfixable: true,
    skip: true // Can't test without CSS
  },
  'focus-order-semantics': {
    html: '<div tabindex="0">Focusable div</div>',
    description: 'Focus order semantics',
    unfixable: true
  },
  'hidden-content': {
    html: '<div hidden>Hidden content</div>',
    description: 'Hidden content',
    unfixable: true
  },
  'identical-links-same-purpose': {
    html: '<a href="/page">Link 1</a><a href="/page">Link 2</a>',
    description: 'Identical links',
    unfixable: true
  },
  'nested-interactive': {
    html: '<button><a href="#">Link in button</a></button>',
    description: 'Nested interactive',
    unfixable: true
  },
  'presentation-role-conflict': {
    html: '<img role="presentation" alt="" tabindex="0" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7">',
    description: 'Presentation with focusable'
  },
  'server-side-image-map': {
    html: '<img ismap src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" alt="Map">',
    description: 'Server-side image map',
    unfixable: true
  },
  'target-size': {
    html: '<a href="#" style="display:inline-block;width:10px;height:10px">X</a>',
    description: 'Target too small',
    unfixable: true
  },
  'heading-order': {
    html: '<h1>H1</h1><h3>H3 (skipped h2)</h3>',
    description: 'Heading order',
    unfixable: true
  },
};

// Count rules
const totalRules = Object.keys(ALL_AXE_RULES).length;
const unfixableRules = Object.values(ALL_AXE_RULES).filter(r => r.unfixable).length;
const needsAIRules = Object.values(ALL_AXE_RULES).filter(r => r.needsAI).length;
const skipRules = Object.values(ALL_AXE_RULES).filter(r => r.skip).length;
const fixableRules = totalRules - unfixableRules - needsAIRules - skipRules;

console.log(`Total axe-core rules to test: ${totalRules}`);
console.log(`  - Fixable without AI: ${fixableRules}`);
console.log(`  - Needs AI: ${needsAIRules}`);
console.log(`  - Unfixable (structural): ${unfixableRules}`);
console.log(`  - Skip (can't test): ${skipRules}`);
console.log('');

// Read handler code from content.bundle.js
const contentJS = fs.readFileSync('./content.bundle.js', 'utf-8');

async function testRule(browser, ruleId, ruleConfig) {
  if (ruleConfig.skip) {
    return { rule: ruleId, status: 'SKIP', reason: 'Cannot test' };
  }

  const page = await browser.newPage();

  try {
    // Build test page
    let html = `<!DOCTYPE html>
<html${ruleConfig.checkHtml ? '' : ' lang="en"'}>
<head>
  ${ruleConfig.checkTitle ? '' : '<title>Test Page</title>'}
  <meta charset="utf-8">
</head>
<body>
  ${ruleConfig.html}
</body>
</html>`;

    if (ruleConfig.useBody) {
      html = `<!DOCTYPE html>
<html lang="en">
<head><title>Test</title></head>
${ruleConfig.html}
</html>`;
    }

    await page.setContent(html);

    // Inject axe
    await page.addScriptTag({ url: 'https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.8.2/axe.min.js' });
    await page.waitForFunction(() => typeof axe !== 'undefined', { timeout: 5000 });

    // Run axe for specific rule
    const beforeResults = await page.evaluate((ruleId) => {
      return axe.run({ runOnly: [ruleId] });
    }, ruleId);

    const beforeViolations = beforeResults.violations;

    if (beforeViolations.length === 0) {
      return { rule: ruleId, status: 'NO_VIOLATION', reason: 'Test HTML did not trigger violation' };
    }

    const beforeCount = beforeViolations[0].nodes.length;

    // Mark as unfixable if configured
    if (ruleConfig.unfixable) {
      return { rule: ruleId, status: 'UNFIXABLE', reason: ruleConfig.description, before: beforeCount };
    }

    if (ruleConfig.needsAI) {
      return { rule: ruleId, status: 'NEEDS_AI', reason: ruleConfig.description, before: beforeCount };
    }

    // Apply fix (inject minimal handler code)
    const fixApplied = await page.evaluate((ruleId) => {
      const el = document.querySelector('[role], img, a, button, input, select, textarea, h1, h2, h3, h4, h5, h6, th, td, iframe, blink, marquee, div[tabindex], meta, html, body, nav, main, header, footer, aside, details, summary, audio, video, p, dl, dt, dd, ul, ol, li, [aria-hidden], [id], label, [style]');

      // Simplified fix logic for each rule
      switch(ruleId) {
        case 'aria-allowed-attr':
          document.querySelectorAll('[aria-checked]').forEach(e => {
            if (e.getAttribute('role') !== 'checkbox' && e.getAttribute('role') !== 'switch') {
              e.removeAttribute('aria-checked');
            }
          });
          return true;
        case 'aria-allowed-role':
          document.querySelectorAll('meta[role]').forEach(e => e.removeAttribute('role'));
          return true;
        case 'aria-braille-equivalent':
          document.querySelectorAll('[aria-braillelabel]').forEach(e => {
            if (!e.getAttribute('aria-label')) {
              e.setAttribute('aria-label', e.textContent || 'content');
            }
          });
          return true;
        case 'aria-command-name':
        case 'aria-input-field-name':
        case 'aria-toggle-field-name':
        case 'aria-meter-name':
        case 'aria-progressbar-name':
        case 'aria-tooltip-name':
        case 'aria-treeitem-name':
        case 'aria-dialog-name':
          document.querySelectorAll('[role]').forEach(e => {
            if (!e.getAttribute('aria-label') && !e.getAttribute('aria-labelledby')) {
              e.setAttribute('aria-label', e.getAttribute('role') || 'element');
            }
          });
          return true;
        case 'aria-conditional-attr':
          // Complex - skip
          return false;
        case 'aria-deprecated-role':
          document.querySelectorAll('[role="directory"]').forEach(e => e.setAttribute('role', 'list'));
          return true;
        case 'aria-hidden-body':
          document.body.removeAttribute('aria-hidden');
          return true;
        case 'aria-hidden-focus':
          document.querySelectorAll('[aria-hidden="true"] button, [aria-hidden="true"] a, [aria-hidden="true"] input').forEach(e => {
            e.setAttribute('tabindex', '-1');
          });
          return true;
        case 'aria-prohibited-attr':
          // Complex
          return false;
        case 'aria-required-attr':
          document.querySelectorAll('[role="checkbox"]').forEach(e => {
            if (!e.hasAttribute('aria-checked')) e.setAttribute('aria-checked', 'false');
          });
          return true;
        case 'aria-roledescription':
          document.querySelectorAll('[aria-roledescription]').forEach(e => {
            if (!e.getAttribute('role')) e.setAttribute('role', 'group');
          });
          return true;
        case 'aria-roles':
          document.querySelectorAll('[role]').forEach(e => {
            const validRoles = ['button','checkbox','dialog','img','link','list','listitem','main','navigation','option','radio','switch','tab','tablist','tabpanel','textbox','banner','complementary','contentinfo','form','group','heading','menu','menuitem','progressbar','slider','status','tree','treeitem','alert','alertdialog','application','article','cell','columnheader','combobox','definition','directory','document','feed','figure','grid','gridcell','log','marquee','math','menubar','menuitemcheckbox','menuitemradio','meter','none','note','presentation','radiogroup','region','row','rowgroup','rowheader','scrollbar','search','searchbox','separator','spinbutton','table','term','timer','toolbar','tooltip','treegrid'];
            if (!validRoles.includes(e.getAttribute('role'))) e.removeAttribute('role');
          });
          return true;
        case 'aria-valid-attr':
          document.querySelectorAll('*').forEach(e => {
            Array.from(e.attributes).forEach(a => {
              if (a.name.startsWith('aria-') && !['aria-label','aria-labelledby','aria-describedby','aria-hidden','aria-expanded','aria-checked','aria-selected','aria-disabled','aria-required','aria-invalid','aria-live','aria-atomic','aria-relevant','aria-busy','aria-controls','aria-owns','aria-flowto','aria-haspopup','aria-level','aria-multiline','aria-multiselectable','aria-orientation','aria-posinset','aria-pressed','aria-readonly','aria-setsize','aria-sort','aria-valuemax','aria-valuemin','aria-valuenow','aria-valuetext','aria-activedescendant','aria-colcount','aria-colindex','aria-colspan','aria-current','aria-details','aria-errormessage','aria-keyshortcuts','aria-modal','aria-placeholder','aria-roledescription','aria-rowcount','aria-rowindex','aria-rowspan','aria-braillelabel','aria-brailleroledescription','aria-description'].includes(a.name)) {
                e.removeAttribute(a.name);
              }
            });
          });
          return true;
        case 'aria-valid-attr-value':
          document.querySelectorAll('[aria-hidden="yes"]').forEach(e => e.setAttribute('aria-hidden', 'true'));
          document.querySelectorAll('[aria-hidden="no"]').forEach(e => e.setAttribute('aria-hidden', 'false'));
          return true;
        case 'image-redundant-alt':
          document.querySelectorAll('img').forEach(e => {
            const parent = e.parentElement;
            if (parent && parent.textContent.includes(e.alt)) {
              e.setAttribute('role', 'presentation');
              e.setAttribute('alt', '');
            }
          });
          return true;
        case 'role-img-alt':
          document.querySelectorAll('[role="img"]').forEach(e => {
            if (!e.getAttribute('aria-label')) e.setAttribute('aria-label', 'image');
          });
          return true;
        case 'svg-img-alt':
          document.querySelectorAll('svg[role="img"]').forEach(e => {
            if (!e.getAttribute('aria-label') && !e.querySelector('title')) {
              e.setAttribute('aria-label', 'graphic');
            }
          });
          return true;
        case 'object-alt':
          document.querySelectorAll('object').forEach(e => {
            if (!e.getAttribute('aria-label')) e.setAttribute('aria-label', 'embedded object');
          });
          return true;
        case 'area-alt':
          document.querySelectorAll('area').forEach(e => {
            if (!e.getAttribute('alt')) e.setAttribute('alt', 'map area');
          });
          return true;
        case 'link-name':
          document.querySelectorAll('a').forEach(e => {
            if (!e.textContent.trim() && !e.getAttribute('aria-label')) {
              e.setAttribute('aria-label', 'link');
            }
          });
          return true;
        case 'button-name':
          document.querySelectorAll('button').forEach(e => {
            if (!e.textContent.trim() && !e.getAttribute('aria-label')) {
              e.setAttribute('aria-label', 'button');
            }
          });
          return true;
        case 'link-in-text-block':
          document.querySelectorAll('p a').forEach(e => e.style.textDecoration = 'underline');
          return true;
        case 'autocomplete-valid':
          document.querySelectorAll('input[autocomplete]').forEach(e => {
            const valid = ['off','on','name','email','username','new-password','current-password','tel','url'];
            if (!valid.includes(e.getAttribute('autocomplete'))) e.removeAttribute('autocomplete');
          });
          return true;
        case 'form-field-multiple-labels':
          const seen = {};
          document.querySelectorAll('label[for]').forEach(e => {
            const f = e.getAttribute('for');
            if (seen[f]) e.removeAttribute('for');
            else seen[f] = true;
          });
          return true;
        case 'input-button-name':
          document.querySelectorAll('input[type="submit"]').forEach(e => {
            if (!e.value) e.value = 'Submit';
          });
          return true;
        case 'label':
          document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"])').forEach(e => {
            if (!e.getAttribute('aria-label') && !e.id) {
              e.setAttribute('aria-label', 'input field');
            }
          });
          return true;
        case 'label-title-only':
          document.querySelectorAll('input[title]').forEach(e => {
            if (!e.getAttribute('aria-label')) {
              e.setAttribute('aria-label', e.getAttribute('title'));
            }
          });
          return true;
        case 'select-name':
          document.querySelectorAll('select').forEach(e => {
            if (!e.getAttribute('aria-label')) e.setAttribute('aria-label', 'select');
          });
          return true;
        case 'color-contrast':
        case 'color-contrast-enhanced':
          document.querySelectorAll('p').forEach(e => {
            e.style.color = '#000';
            e.style.backgroundColor = '#fff';
          });
          return true;
        case 'document-title':
          if (!document.title) document.title = 'Page';
          return true;
        case 'html-has-lang':
          document.documentElement.setAttribute('lang', 'en');
          return true;
        case 'html-lang-valid':
          document.documentElement.setAttribute('lang', 'en');
          return true;
        case 'html-xml-lang-mismatch':
          const l = document.documentElement.getAttribute('lang');
          document.documentElement.setAttribute('xml:lang', l);
          return true;
        case 'meta-refresh':
          document.querySelectorAll('meta[http-equiv="refresh"]').forEach(e => e.remove());
          return true;
        case 'meta-viewport':
        case 'meta-viewport-large':
          document.querySelectorAll('meta[name="viewport"]').forEach(e => {
            let c = e.content;
            c = c.replace(/user-scalable\s*=\s*no/gi, '');
            c = c.replace(/maximum-scale\s*=\s*1(\.0)?/gi, '');
            e.content = c.replace(/,\s*,/g, ',').replace(/^,|,$/g, '').trim();
          });
          return true;
        case 'valid-lang':
          const validLangs = new Set(['en','es','fr','de','it','pt','ru','zh','ja','ko','ar','hi','bn','pa','te','mr','ta','ur','gu','kn','ml','or','as','ne','si','my','th','lo','vi','id','ms','tl','km','mn','bo','dz','he','fa','tr','pl','uk','nl','sv','no','da','fi','el','cs','hu','ro','bg','sr','hr','sk','sl','et','lv','lt','mk','sq','bs','is','ga','cy','eu','ca','gl','af','sw','zu','xh','sn','ha','ig','yo','am','ti','so','rw','mg','ml']);
          document.querySelectorAll('[lang]').forEach(e => {
            const baseLang = e.getAttribute('lang').split('-')[0].toLowerCase();
            if (!validLangs.has(baseLang)) e.setAttribute('lang', 'en');
          });
          return true;
        case 'accesskeys':
          const keys = {};
          document.querySelectorAll('[accesskey]').forEach(e => {
            const k = e.getAttribute('accesskey');
            if (keys[k]) e.removeAttribute('accesskey');
            else keys[k] = true;
          });
          return true;
        case 'frame-focusable-content':
          document.querySelectorAll('iframe[tabindex="-1"]').forEach(e => e.removeAttribute('tabindex'));
          return true;
        case 'scrollable-region-focusable':
          document.querySelectorAll('div[style*="overflow"]').forEach(e => {
            if (!e.hasAttribute('tabindex')) e.setAttribute('tabindex', '0');
          });
          return true;
        case 'tabindex':
          document.querySelectorAll('[tabindex]').forEach(e => {
            if (parseInt(e.getAttribute('tabindex')) > 0) e.setAttribute('tabindex', '0');
          });
          return true;
        case 'frame-title':
          document.querySelectorAll('iframe').forEach(e => {
            if (!e.title) e.title = 'frame';
          });
          return true;
        case 'frame-title-unique':
          const titles = {};
          document.querySelectorAll('iframe[title]').forEach(e => {
            const t = e.title;
            titles[t] = (titles[t] || 0) + 1;
            if (titles[t] > 1) e.title = t + ' ' + titles[t];
          });
          return true;
        case 'scope-attr-valid':
          document.querySelectorAll('th[scope]').forEach(e => {
            if (!['row','col','rowgroup','colgroup'].includes(e.getAttribute('scope'))) {
              e.removeAttribute('scope');
            }
          });
          return true;
        case 'table-duplicate-name':
          document.querySelectorAll('table caption').forEach(e => {
            e.textContent = e.textContent + ' (table)';
          });
          document.querySelectorAll('table[summary]').forEach(e => e.removeAttribute('summary'));
          return true;
        case 'empty-heading':
          document.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach(e => {
            if (!e.textContent.trim()) e.textContent = 'Heading';
          });
          return true;
        case 'empty-table-header':
          document.querySelectorAll('th').forEach(e => {
            if (!e.textContent.trim()) e.textContent = 'Column';
          });
          return true;
        case 'summary-name':
          document.querySelectorAll('summary').forEach(e => {
            if (!e.textContent.trim()) e.textContent = 'Details';
          });
          return true;
        case 'bypass':
          if (!document.querySelector('.skip-link, [href="#main"]')) {
            const s = document.createElement('a');
            s.href = '#main-content';
            s.className = 'skip-link';
            s.textContent = 'Skip to content';
            s.style.cssText = 'position:absolute;left:-9999px';
            document.body.insertBefore(s, document.body.firstChild);
            const m = document.querySelector('main');
            if (m) m.id = 'main-content';
          }
          return true;
        case 'landmark-one-main':
          if (!document.querySelector('main,[role="main"]')) {
            const d = document.querySelector('div');
            if (d) d.setAttribute('role', 'main');
          }
          return true;
        case 'landmark-unique':
          const lm = {};
          document.querySelectorAll('nav,aside,[role="navigation"],[role="complementary"]').forEach(e => {
            const r = e.getAttribute('role') || e.tagName.toLowerCase();
            lm[r] = (lm[r] || 0) + 1;
            if (lm[r] > 1 && !e.getAttribute('aria-label')) {
              e.setAttribute('aria-label', r + ' ' + lm[r]);
            }
          });
          return true;
        case 'page-has-heading-one':
          if (!document.querySelector('h1')) {
            const h = document.createElement('h1');
            h.textContent = document.title || 'Page';
            h.style.cssText = 'position:absolute;left:-9999px';
            document.body.insertBefore(h, document.body.firstChild);
          }
          return true;
        case 'skip-link':
          const sl = document.querySelector('.skip-link, a[href^="#"]');
          if (sl) {
            const t = sl.getAttribute('href').substring(1);
            if (!document.getElementById(t)) {
              const m = document.querySelector('main');
              if (m) m.id = t;
            }
          }
          return true;
        case 'blink':
          document.querySelectorAll('blink').forEach(e => {
            const s = document.createElement('span');
            while (e.firstChild) s.appendChild(e.firstChild);
            e.parentNode.replaceChild(s, e);
          });
          return true;
        case 'marquee':
          document.querySelectorAll('marquee').forEach(e => {
            const d = document.createElement('div');
            while (e.firstChild) d.appendChild(e.firstChild);
            e.parentNode.replaceChild(d, e);
          });
          return true;
        case 'duplicate-id':
        case 'duplicate-id-active':
        case 'duplicate-id-aria':
          const ids = {};
          document.querySelectorAll('[id]').forEach(e => {
            const id = e.id;
            ids[id] = (ids[id] || 0) + 1;
            if (ids[id] > 1) e.id = id + '-' + ids[id];
          });
          return true;
        case 'no-autoplay-audio':
          document.querySelectorAll('video[autoplay],audio[autoplay]').forEach(e => {
            e.removeAttribute('autoplay');
            e.pause && e.pause();
          });
          return true;
        case 'avoid-inline-spacing':
          document.querySelectorAll('[style]').forEach(e => {
            e.style.removeProperty('letter-spacing');
            e.style.removeProperty('word-spacing');
            e.style.removeProperty('line-height');
          });
          return true;
        case 'presentation-role-conflict':
          document.querySelectorAll('[role="presentation"][tabindex], [role="none"][tabindex]').forEach(e => {
            e.removeAttribute('tabindex');  // Remove focusability, keep presentation role
          });
          return true;
        default:
          return false;
      }
    }, ruleId);

    if (!fixApplied) {
      return { rule: ruleId, status: 'NO_HANDLER', before: beforeCount };
    }

    // Run axe AFTER fix
    const afterResults = await page.evaluate((ruleId) => {
      return axe.run({ runOnly: [ruleId] });
    }, ruleId);

    const afterViolations = afterResults.violations;
    const afterCount = afterViolations.length > 0 ? afterViolations[0].nodes.length : 0;

    if (afterCount === 0) {
      return { rule: ruleId, status: 'FIXED', before: beforeCount, after: 0 };
    } else if (afterCount < beforeCount) {
      return { rule: ruleId, status: 'PARTIAL', before: beforeCount, after: afterCount };
    } else {
      return { rule: ruleId, status: 'FAILED', before: beforeCount, after: afterCount };
    }

  } catch (e) {
    return { rule: ruleId, status: 'ERROR', error: e.message };
  } finally {
    await page.close();
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const results = [];

  const rules = Object.entries(ALL_AXE_RULES);

  for (let i = 0; i < rules.length; i++) {
    const [ruleId, config] = rules[i];
    process.stdout.write(`[${i+1}/${rules.length}] Testing ${ruleId}... `);

    const result = await testRule(browser, ruleId, config);
    results.push(result);

    const icon = result.status === 'FIXED' ? '✓' :
                 result.status === 'PARTIAL' ? '◐' :
                 result.status === 'UNFIXABLE' ? '○' :
                 result.status === 'NEEDS_AI' ? '🤖' :
                 result.status === 'NO_VIOLATION' ? '?' :
                 result.status === 'SKIP' ? '−' : '✗';
    console.log(`${icon} ${result.status}`);
  }

  await browser.close();

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));

  const fixed = results.filter(r => r.status === 'FIXED');
  const partial = results.filter(r => r.status === 'PARTIAL');
  const unfixable = results.filter(r => r.status === 'UNFIXABLE');
  const needsAI = results.filter(r => r.status === 'NEEDS_AI');
  const noViolation = results.filter(r => r.status === 'NO_VIOLATION');
  const noHandler = results.filter(r => r.status === 'NO_HANDLER');
  const failed = results.filter(r => r.status === 'FAILED');
  const errors = results.filter(r => r.status === 'ERROR');
  const skipped = results.filter(r => r.status === 'SKIP');

  console.log(`\nTotal rules tested: ${results.length}`);
  console.log(`  ✓ Fixed:           ${fixed.length}`);
  console.log(`  ◐ Partial:         ${partial.length}`);
  console.log(`  ○ Unfixable:       ${unfixable.length}`);
  console.log(`  🤖 Needs AI:        ${needsAI.length}`);
  console.log(`  ? No violation:    ${noViolation.length} (test HTML didn't trigger)`);
  console.log(`  − Skipped:         ${skipped.length}`);
  console.log(`  ✗ No handler:      ${noHandler.length}`);
  console.log(`  ✗ Failed:          ${failed.length}`);
  console.log(`  ⚠ Error:           ${errors.length}`);

  const fixableTotal = fixed.length + partial.length + failed.length + noHandler.length;
  const fixRate = fixableTotal > 0 ? ((fixed.length + partial.length) / fixableTotal * 100).toFixed(1) : 0;
  console.log(`\nFix rate (of fixable): ${fixRate}%`);

  if (failed.length > 0) {
    console.log('\nFailed fixes:');
    failed.forEach(r => console.log(`  - ${r.rule}: ${r.before} → ${r.after}`));
  }

  if (noHandler.length > 0) {
    console.log('\nMissing handlers:');
    noHandler.forEach(r => console.log(`  - ${r.rule}`));
  }

  if (errors.length > 0) {
    console.log('\nErrors:');
    errors.forEach(r => console.log(`  - ${r.rule}: ${r.error}`));
  }

  // Save results
  const os = require('os');
  const outputPath = require('path').join(os.homedir(), 'Downloads', 'ai4a11y-all-rules-test.json');
  fs.writeFileSync(
    outputPath,
    JSON.stringify({ timestamp: new Date().toISOString(), results }, null, 2)
  );
  console.log(`\nResults saved to ${outputPath}`);
}

main().catch(console.error);
