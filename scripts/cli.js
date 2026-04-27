#!/usr/bin/env node

/**
 * AI for Accessibility Toolkit CLI
 *
 * Commands:
 *   a11y tools                                    List components
 *   a11y profiles                                 List profiles
 *   a11y create <name> --type <analyzer|adapter|profile>
 *   a11y build                                    Bundle src/
 *   a11y check <url>                              Test page
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');

const args = process.argv.slice(2);
const command = args[0];

const rootDir = path.join(__dirname, '..');
const srcDir = path.join(rootDir, 'src');

// Help
if (!command || command === 'help' || command === '--help') {
  console.log(`
AI for Accessibility Toolkit CLI

Commands:
  ai4a11y tools                                       List components
  ai4a11y profiles                                    List profiles
  ai4a11y create <name> --type <analyzer|adapter|profile>   Create component
  ai4a11y build                                       Build extension
  ai4a11y check <url>                                 Check page for issues

Examples:
  ai4a11y create missing-landmarks --type analyzer
  ai4a11y create fix-tables --type adapter
  ai4a11y build
  ai4a11y check https://example.com
`);
  process.exit(0);
}

// a11y tools
if (command === 'tools') {
  console.log('\nAnalyzers (find issues):');
  const analyzers = fs.readdirSync(path.join(srcDir, 'analyzers'))
    .filter(f => f.endsWith('.js') && f !== 'index.js' && !f.endsWith('.md'))
    .map(f => '  - ' + f.replace('.js', ''));
  console.log(analyzers.join('\n') || '  (none)');

  console.log('\nAdapters (fix issues):');
  const adapters = fs.readdirSync(path.join(srcDir, 'adapters'))
    .filter(f => f.endsWith('.js') && f !== 'index.js' && !f.endsWith('.md'))
    .map(f => '  - ' + f.replace('.js', ''));
  console.log(adapters.join('\n') || '  (none)');

  console.log('\nFeatures (visual presets):');
  const features = fs.readdirSync(path.join(srcDir, 'features'))
    .filter(f => f.endsWith('.js'))
    .map(f => '  - ' + f.replace('.js', ''));
  console.log(features.join('\n') || '  (none)');
  console.log();
  process.exit(0);
}

// a11y profiles
if (command === 'profiles') {
  const settingsPath = path.join(srcDir, 'settings.js');
  const content = fs.readFileSync(settingsPath, 'utf8');

  const profileRegex = /(\w+):\s*{\s*name:\s*['"]([^'"]+)['"]\s*,\s*description:\s*['"]([^'"]+)['"]/g;
  let match;

  console.log('\nProfiles:\n');
  while ((match = profileRegex.exec(content)) !== null) {
    console.log(`  ${match[1].padEnd(16)} ${match[2]}`);
    console.log(`  ${''.padEnd(16)} ${match[3]}\n`);
  }
  process.exit(0);
}

// a11y build
if (command === 'build') {
  try {
    console.log('Building...');
    execSync('node src/build.js', { cwd: rootDir, stdio: 'inherit' });
  } catch (e) {
    process.exit(1);
  }
  process.exit(0);
}

// a11y check <url>
if (command === 'check') {
  const url = args[1];
  if (!url) {
    console.error('Usage: a11y check <url>');
    process.exit(1);
  }

  (async () => {
    try {
      const { chromium } = require('playwright');
      const axePath = path.join(rootDir, 'lib', 'axe.min.js');

      if (!fs.existsSync(axePath)) {
        console.error('axe-core not found at lib/axe.min.js');
        process.exit(1);
      }

      const axeScript = fs.readFileSync(axePath, 'utf8');

      console.log(`Checking ${url}...`);
      const browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1500);

      await page.evaluate(axeScript);
      const results = await page.evaluate(() => axe.run());
      await browser.close();

      const violations = results.violations || [];

      if (violations.length === 0) {
        console.log('\n✓ No accessibility issues found.\n');
        process.exit(0);
      }

      const total = violations.reduce((sum, v) => sum + v.nodes.length, 0);
      console.log(`\nFound ${total} issues:\n`);

      const sorted = violations.sort((a, b) => {
        const order = { critical: 0, serious: 1, moderate: 2, minor: 3 };
        return (order[a.impact] || 4) - (order[b.impact] || 4);
      });

      for (const v of sorted) {
        const color = { critical: '\x1b[31m', serious: '\x1b[33m', moderate: '\x1b[34m', minor: '\x1b[90m' };
        const c = color[v.impact] || '';
        const reset = '\x1b[0m';
        console.log(`  ${c}${v.impact.padEnd(10)}${reset} ${v.id.padEnd(25)} (${v.nodes.length})`);
      }
      console.log();

    } catch (e) {
      if (e.message.includes('playwright')) {
        console.error('Playwright not installed. Run: npx playwright install chromium');
      } else {
        console.error('Error:', e.message);
      }
      process.exit(1);
    }
  })();
  return;
}

// a11y create <name> --type <type>
if (command === 'create') {
  const name = args[1];
  const typeIdx = args.indexOf('--type');
  const type = typeIdx !== -1 ? args[typeIdx + 1] : null;

  if (!name) {
    console.error('Usage: a11y create <name> --type <analyzer|adapter|profile>');
    process.exit(1);
  }

  if (!type || !['analyzer', 'adapter', 'profile'].includes(type)) {
    console.error('--type must be analyzer, adapter, or profile');
    process.exit(1);
  }

  if (type === 'analyzer') createAnalyzer(name);
  else if (type === 'adapter') createAdapter(name);
  else if (type === 'profile') createProfile(name);

  process.exit(0);
}

console.error(`Unknown command: ${command}`);
console.error('Run "ai4a11y --help" for usage');
process.exit(1);

// --- Scaffolding ---

function createAnalyzer(name) {
  const fileName = name.replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, '');
  const funcName = 'find' + name.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join('');

  const template = `import { isVisible, wasProcessed } from '../utils/dom.js';

export function ${funcName}() {
  return Array.from(document.querySelectorAll('TODO'))
    .filter(el => {
      if (wasProcessed(el)) return false;
      if (!isVisible(el)) return false;
      // TODO: detection logic
      return true;
    });
}
`;

  const filePath = path.join(srcDir, 'analyzers', `${fileName}.js`);
  if (fs.existsSync(filePath)) {
    console.error(`${fileName}.js already exists`);
    process.exit(1);
  }

  fs.writeFileSync(filePath, template);
  console.log(`Created: src/analyzers/${fileName}.js`);
  console.log(`\nNext: Add to src/analyzers/index.js:`);
  console.log(`  export * from './${fileName}.js';`);
}

function createAdapter(name) {
  const fileName = name.replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, '');
  const funcName = name.split('-').map((w, i) => i === 0 ? w : w[0].toUpperCase() + w.slice(1)).join('');

  const template = `import { markProcessed } from '../utils/dom.js';
import { logFix, incrementStat } from '../stats.js';
import { sendMessage } from '../utils/messaging.js';

export async function ${funcName}(element) {
  if (element.dataset.ai4a11yProcessed) return;
  markProcessed(element, 'pending');

  // TODO: fix logic

  markProcessed(element, 'done');
  incrementStat('wcag');
  logFix('${name}', element, 'before', 'after');
}

// axe rule IDs: https://dequeuniversity.com/rules/axe/
export const axeHandlers = {
  // 'rule-id': ${funcName}
};
`;

  const filePath = path.join(srcDir, 'adapters', `${fileName}.js`);
  if (fs.existsSync(filePath)) {
    console.error(`${fileName}.js already exists`);
    process.exit(1);
  }

  fs.writeFileSync(filePath, template);
  console.log(`Created: src/adapters/${fileName}.js`);
  console.log(`\nNext: Import in src/adapters/index.js`);
}

function createProfile(name) {
  const profileId = name.toLowerCase().replace(/[^a-z0-9]/g, '_');
  const displayName = name.split(/[-_]/).map(w => w[0].toUpperCase() + w.slice(1)).join(' ');

  const settingsPath = path.join(srcDir, 'settings.js');
  const content = fs.readFileSync(settingsPath, 'utf8');

  if (content.includes(`${profileId}:`)) {
    console.error(`Profile "${profileId}" already exists`);
    process.exit(1);
  }

  const template = `
  ${profileId}: {
    name: '${displayName}',
    description: 'TODO: Description',
    tools: {
      // TODO: enable tools
    }
  },`;

  const insertPoint = content.lastIndexOf('\n};');
  const beforeInsert = content.slice(0, insertPoint).trimEnd();
  const needsComma = beforeInsert.endsWith('}') && !beforeInsert.endsWith(',');
  const prefix = needsComma ? ',' : '';
  const newContent = content.slice(0, insertPoint) + prefix + template + content.slice(insertPoint);
  fs.writeFileSync(settingsPath, newContent);

  console.log(`Added "${profileId}" to src/settings.js`);
}
