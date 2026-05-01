const fs = require('fs');
const path = require('path');

const sizes = [16, 48, 128];
const outDir = path.resolve(__dirname, '..', 'extension', 'icons');

function createSVG(size) {
  const r = size / 2;
  const fontSize = Math.round(size * 0.4);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <circle cx="${r}" cy="${r}" r="${r}" fill="#1a73e8"/>
  <text x="${r}" y="${r}" text-anchor="middle" dominant-baseline="central"
        font-family="sans-serif" font-weight="bold" font-size="${fontSize}" fill="white">A</text>
</svg>`;
}

for (const size of sizes) {
  const svg = createSVG(size);
  fs.writeFileSync(path.join(outDir, `icon${size}.svg`), svg);
  console.log(`Generated icon${size}.svg`);
}

console.log('Note: Convert SVGs to PNGs for Chrome extension. For now, update manifest to use .svg or convert manually.');
