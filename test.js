#!/usr/bin/env node
'use strict';

// Bundles the shared modules for node (they are browser ESM) and exercises
// the gate state machine and the URL rules. No browser needed.

const path = require('node:path');
const { execFileSync } = require('node:child_process');

const TEST = path.join(__dirname, 'test');
const bundle = path.join(TEST, '.bundle.cjs');

execFileSync('npx', [
  '--yes', 'esbuild@0.25.0',
  path.join(TEST, 'entry.js'),
  '--bundle', '--format=cjs', '--platform=node',
  '--log-level=warning',
  `--outfile=${bundle}`,
], { stdio: 'inherit' });

require(path.join(TEST, 'harness.js'));
require(bundle);
require(path.join(TEST, 'logic.test.cjs'));
