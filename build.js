#!/usr/bin/env node
'use strict';

// Produces dist/chrome and dist/firefox from src/, plus a zip of each.
// The installed copy is bundled and minified on purpose: changing the
// blocking rules or the gate should mean coming back here and rebuilding,
// not opening a file in a text editor.

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');

const ESBUILD = 'esbuild@0.25.0';
const ROOT = __dirname;
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');

let CRC_TABLE = null;

const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'build.config.json'), 'utf8'));

const TARGETS = {
  chrome: { esbuildTarget: 'chrome110' },
  firefox: { esbuildTarget: 'firefox121' },
};

const ENTRIES = [
  ['content/blocker.js', 'content.js'],
  ['background.js', 'background.js'],
  ['pages/setup.js', 'setup.js'],
  ['pages/options.js', 'options.js'],
];

const COPIES = [
  ['pages/setup.html', 'setup.html'],
  ['pages/options.html', 'options.html'],
  ['pages/shared.css', 'shared.css'],
];

main();

function main() {
  fs.rmSync(DIST, { recursive: true, force: true });

  for (const [name, target] of Object.entries(TARGETS)) {
    const out = path.join(DIST, name);
    fs.mkdirSync(path.join(out, 'icons'), { recursive: true });

    for (const [from, to] of ENTRIES) bundle(from, path.join(out, to), target.esbuildTarget);
    for (const [from, to] of COPIES) fs.copyFileSync(path.join(SRC, from), path.join(out, to));
    for (const size of [16, 32, 48, 128]) {
      fs.writeFileSync(path.join(out, 'icons', `${size}.png`), icon(size));
    }

    fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest(name), null, 2) + '\n');
    zip(out, path.join(DIST, `reel-ban-${name}-${config.version}.zip`));
    console.log(`built dist/${name}`);
  }

  if (!config.uninstallUrl) {
    console.log('\nnote: build.config.json has no uninstallUrl, so setUninstallURL is skipped.');
    console.log('      publish docs/uninstalled.html somewhere https and put the URL there.');
  }
}

function bundle(entry, outfile, target) {
  const args = [
    '--yes', ESBUILD,
    path.join(SRC, entry),
    '--bundle',
    '--minify',
    '--format=iife',
    '--legal-comments=none',
    '--log-level=warning',
    `--target=${target}`,
    `--define:__UNINSTALL_URL__=${JSON.stringify(JSON.stringify(config.uninstallUrl || ''))}`,
    `--outfile=${outfile}`,
  ];
  try {
    execFileSync('npx', args, { stdio: ['ignore', 'ignore', 'inherit'] });
  } catch (err) {
    console.error(`\nesbuild failed on ${entry}.`);
    console.error('The first build needs network access to fetch esbuild; after that npx caches it.');
    process.exit(1);
  }
}

function manifest(browser) {
  const base = {
    manifest_version: 3,
    name: 'Reel Ban',
    version: config.version,
    description: 'Strips short-form video out of YouTube and Facebook, behind a PIN someone else holds.',
    icons: { 16: 'icons/16.png', 32: 'icons/32.png', 48: 'icons/48.png', 128: 'icons/128.png' },
    permissions: ['storage'],
    host_permissions: ['*://*.youtube.com/*', '*://*.facebook.com/*'],
    options_ui: { page: 'options.html', open_in_tab: true },
    content_scripts: [{
      matches: ['*://*.youtube.com/*', '*://*.facebook.com/*'],
      js: ['content.js'],
      run_at: 'document_start',
      all_frames: false,
    }],
  };

  if (browser === 'chrome') {
    return { ...base, background: { service_worker: 'background.js' } };
  }

  // Firefox MV3 uses a non-persistent event page, not a service worker, and
  // needs an explicit id to be signed for permanent installation.
  return {
    ...base,
    background: { scripts: ['background.js'] },
    browser_specific_settings: {
      gecko: { id: config.geckoId, strict_min_version: '121.0' },
    },
  };
}

function zip(dir, outfile) {
  try {
    execFileSync('zip', ['-qr', outfile, '.'], { cwd: dir, stdio: ['ignore', 'ignore', 'inherit'] });
  } catch (err) {
    console.error(`could not zip ${dir} (is the zip command available?)`);
  }
}

// --- icon generation ---------------------------------------------------
// A red tile with a white bar through it. Generated rather than committed so
// there are no binaries in the repo.

function icon(size) {
  const px = (x, y) => {
    const inset = Math.round(size * 0.06);
    if (x < inset || y < inset || x >= size - inset || y >= size - inset) return [0, 0, 0, 0];
    const barTop = Math.round(size * 0.42);
    const barBottom = Math.round(size * 0.58);
    const barLeft = Math.round(size * 0.2);
    const barRight = Math.round(size * 0.8);
    if (y >= barTop && y < barBottom && x >= barLeft && x < barRight) return [255, 255, 255, 255];
    return [0xb3, 0x26, 0x1e, 255];
  };

  const raw = Buffer.alloc(size * (size * 4 + 1));
  let i = 0;
  for (let y = 0; y < size; y++) {
    raw[i++] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = px(x, y);
      raw[i++] = r; raw[i++] = g; raw[i++] = b; raw[i++] = a;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // colour type: RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
