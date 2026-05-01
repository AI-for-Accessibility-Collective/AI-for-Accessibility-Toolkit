#!/usr/bin/env node

/**
 * Build script for AI4A11y extension
 * Bundles ES modules into browser-compatible scripts
 */

const esbuild = require('esbuild');
const path = require('path');

const srcDir = __dirname;
const outDir = path.join(srcDir, '..');
const toolsDir = path.join(srcDir, '..', '..', 'tools');
const cliDir = path.join(srcDir, '..', '..', 'cli');

async function build() {
  try {
    // Bundle content script (for Chrome extension)
    await esbuild.build({
      entryPoints: [path.join(srcDir, 'content.js')],
      bundle: true,
      outfile: path.join(outDir, 'content.bundle.js'),
      format: 'iife',
      target: ['chrome90'],
      minify: process.env.NODE_ENV === 'production',
      sourcemap: process.env.NODE_ENV !== 'production'
    });

    console.log('✓ Built content.bundle.js');

    // Bundle CLI tools (for Playwright injection)
    await esbuild.build({
      entryPoints: [path.join(cliDir, 'cli-tools.js')],
      bundle: true,
      outfile: path.join(cliDir, 'cli-tools.bundle.js'),
      format: 'iife',
      target: ['chrome90'],
      minify: process.env.NODE_ENV === 'production',
      sourcemap: process.env.NODE_ENV !== 'production'
    });

    console.log('✓ Built cli-tools.bundle.js');

    // Bundle popup script (if exists)
    const popupEntry = path.join(srcDir, 'popup', 'popup.js');
    const fs = require('fs');
    if (fs.existsSync(popupEntry)) {
      await esbuild.build({
        entryPoints: [popupEntry],
        bundle: true,
        outfile: path.join(outDir, 'popup.bundle.js'),
        format: 'iife',
        target: ['chrome90'],
        minify: process.env.NODE_ENV === 'production'
      });
      console.log('✓ Built popup.bundle.js');
    }

    console.log('\nBuild complete!');
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

// Watch mode
if (process.argv.includes('--watch')) {
  console.log('Watching for changes...\n');

  const chokidar = require('chokidar');
  chokidar.watch([srcDir, toolsDir, cliDir], {
    ignored: /node_modules/,
    ignoreInitial: true
  }).on('all', (event, filepath) => {
    console.log(`\n${event}: ${filepath}`);
    build();
  });
}

build();
