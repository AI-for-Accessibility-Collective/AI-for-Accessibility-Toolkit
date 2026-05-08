const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

const isWatch = process.argv.includes('--watch');

// ---------------------------------------------------------------------------
// Browser-harness skills manifest
// ---------------------------------------------------------------------------
// browser-harness-orig/ holds bundled markdown knowledge files (interaction
// patterns + per-site playbooks). Service-worker fetch can resolve them via
// chrome.runtime.getURL but cannot list directories, so we pre-bake an index
// at build time. Change BH_ORIG_PATH in one place if the directory is renamed
// or the python files are stripped out — the runtime path constant in
// extension/browser-harness/skills.js mirrors this.
const BH_ORIG_PATH = 'extension/browser-harness/browser-harness-orig';
const BH_INTERACTION_SUBPATH = 'interaction-skills';
const BH_DOMAIN_SUBPATH = 'agent-workspace/domain-skills';
const BH_MANIFEST_OUT = 'extension/browser-harness/skills-manifest.json';

function listMd(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.replace(/\.md$/, ''))
    .sort();
}

function buildSkillsManifest() {
  const interactionDir = path.resolve(__dirname, BH_ORIG_PATH, BH_INTERACTION_SUBPATH);
  const domainDir = path.resolve(__dirname, BH_ORIG_PATH, BH_DOMAIN_SUBPATH);
  const interaction = listMd(interactionDir);
  // Manifest entry: { dir: <on-disk name>, files: [...] }. Lookup key is the
  // lowercased dir name so a normalized hostname like "boss-zhipin" still
  // resolves the upstream "BOSS-zhipin" folder without renaming the tree.
  const domain = {};
  if (fs.existsSync(domainDir)) {
    for (const dirName of fs.readdirSync(domainDir).sort()) {
      const hdir = path.join(domainDir, dirName);
      try {
        if (!fs.statSync(hdir).isDirectory()) continue;
      } catch { continue; }
      const files = listMd(hdir);
      if (files.length) {
        const key = dirName.toLowerCase();
        domain[key] = { dir: dirName, files };
      }
    }
  }
  fs.mkdirSync(path.dirname(path.resolve(__dirname, BH_MANIFEST_OUT)), { recursive: true });
  fs.writeFileSync(
    path.resolve(__dirname, BH_MANIFEST_OUT),
    JSON.stringify({ interaction, domain }, null, 2)
  );
  console.log(
    `skills-manifest.json: ${interaction.length} interaction skills, ${Object.keys(domain).length} domain hosts`
  );
}

const contentConfig = {
  entryPoints: [path.resolve(__dirname, 'extension/content/content.js')],
  bundle: true,
  outfile: path.resolve(__dirname, 'extension/content/content.bundle.js'),
  format: 'iife',
  target: 'chrome110',
  sourcemap: true,
  logLevel: 'info',
};

async function build() {
  buildSkillsManifest();
  if (isWatch) {
    const ctx = await esbuild.context(contentConfig);
    await ctx.watch();
    console.log('Watching for changes...');
  } else {
    await esbuild.build(contentConfig);
    console.log('Build complete.');
  }
}

build().catch((e) => {
  console.error(e);
  process.exit(1);
});
