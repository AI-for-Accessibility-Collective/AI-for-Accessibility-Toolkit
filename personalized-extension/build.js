const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

const isWatch = process.argv.includes('--watch');

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
