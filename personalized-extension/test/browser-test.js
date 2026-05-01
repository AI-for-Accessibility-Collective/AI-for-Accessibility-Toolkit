const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const PORT = 8768;
const ROOT = path.resolve(__dirname, '..');

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.map': 'application/json',
};

const server = http.createServer((req, res) => {
  let filePath = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (filePath.endsWith('/')) filePath += 'index.html';
  const ext = path.extname(filePath);
  const mime = MIME[ext] || 'application/octet-stream';
  try {
    const data = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
});

async function run() {
  await new Promise(resolve => server.listen(PORT, resolve));
  console.log(`Server on http://localhost:${PORT}`);

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();

  const consoleLogs = [];
  page.on('console', msg => consoleLogs.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', err => consoleLogs.push(`[PAGE ERROR] ${err.message}`));

  await page.goto(`http://localhost:${PORT}/test/test-skills.html`, {
    waitUntil: 'networkidle0',
    timeout: 30000
  });

  // Wait for tests to finish (summary element gets populated)
  await page.waitForFunction(() => {
    const summary = document.getElementById('summary');
    return summary && summary.textContent && summary.textContent.includes('Results:');
  }, { timeout: 30000 });

  // Grab results
  const results = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('.test-result')).map(el => ({
      text: el.textContent,
      status: el.classList.contains('pass') ? 'PASS' : el.classList.contains('fail') ? 'FAIL' : 'INFO'
    }));
    const summary = document.getElementById('summary')?.textContent || '';
    return { items, summary };
  });

  console.log('\n=== TEST RESULTS ===\n');

  for (const item of results.items) {
    const prefix = item.status === 'PASS' ? '✅' : item.status === 'FAIL' ? '❌' : 'ℹ️';
    console.log(`${prefix} ${item.text}`);
  }

  console.log(`\n📊 ${results.summary}`);

  const failures = results.items.filter(i => i.status === 'FAIL');
  if (failures.length > 0) {
    console.log(`\n⚠️  ${failures.length} FAILURES:`);
    for (const f of failures) {
      console.log(`   - ${f.text}`);
    }
  }

  // Print any page errors
  const errors = consoleLogs.filter(l => l.includes('ERROR') || l.includes('error'));
  if (errors.length > 0) {
    console.log('\n🔴 Console errors:');
    for (const e of errors) console.log(`   ${e}`);
  }

  await browser.close();
  server.close();
  process.exit(failures.length > 0 ? 1 : 0);
}

run().catch(e => {
  console.error('Test runner crashed:', e);
  server.close();
  process.exit(1);
});
