// The browser adapter runtime extension (extension/), as one zip the
// developer console offers for download: unzip it, then Load unpacked the
// folder inside. Built from the extension folder the service runs with, so
// it is always this toolkit's version, once, on the first download.
//
//   GET /developer/extension.zip   ai4a11y-extension/… (no tests, no package.json)
//
// A plain zip (deflate, zlib's own CRC-32), with no dependency, like the rest
// of server/.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync, crc32 } from 'node:zlib';

export const EXTENSION_ZIP_PATH = '/developer/extension.zip';
const FOLDER = 'ai4a11y-extension';
const SKIP = new Set(['test', 'node_modules', 'package.json']);

const extensionDir = (dir) => dir || fileURLToPath(new URL('../../extension/', import.meta.url));

/** The extension's files, as [path inside the extension, absolute path], sorted. */
export function extensionFiles(dir) {
  const root = extensionDir(dir);
  const out = [];
  const walk = (rel) => {
    for (const entry of readdirSync(path.join(root, rel), { withFileTypes: true })) {
      if (entry.name.startsWith('.') || (!rel && SKIP.has(entry.name))) continue;
      const inside = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(inside);
      else if (entry.isFile()) out.push([inside, path.join(root, inside)]);
    }
  };
  walk('');
  return out.sort((a, b) => a[0].localeCompare(b[0]));
}

/** A zip of `files` ([[name, Buffer]]), each deflated. Dates are fixed, so one source makes one zip. */
export function zip(files) {
  const DOS_TIME = 0, DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1; // 2026-01-01 00:00
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, data] of files) {
    const nameBytes = Buffer.from(name, 'utf8');
    const packed = deflateRawSync(data);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);        // version needed
    local.writeUInt16LE(0x0800, 6);    // UTF-8 names
    local.writeUInt16LE(8, 8);         // deflate
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4);  // made by: Unix, 2.0
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38); // -rw-r--r--
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, packed);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + packed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

let built = null;

/** The extension's zip, with its version from the manifest; null when the service has no extension folder. */
export function extensionZip(dir) {
  if (built && !dir) return built;
  const root = extensionDir(dir);
  if (!existsSync(path.join(root, 'manifest.json'))) return null;
  const { version } = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const body = zip(extensionFiles(dir).map(([name, file]) => [`${FOLDER}/${name}`, readFileSync(file)]));
  const result = { body, version, filename: `${FOLDER}-${version}.zip` };
  if (!dir) built = result;
  return result;
}

export function serveExtensionZip(res, method = 'GET') {
  const z = extensionZip();
  if (!z) {
    res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ error: 'not-found', message: 'This toolkit has no extension to download.' }));
  }
  res.writeHead(200, {
    'content-type': 'application/zip',
    'content-length': z.body.length,
    'content-disposition': `attachment; filename="${z.filename}"`,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(method === 'HEAD' ? undefined : z.body);
}
