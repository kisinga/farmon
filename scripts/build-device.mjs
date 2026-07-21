#!/usr/bin/env node
/**
 * Device-mode app build — the bundle the codegen embeds into firmware as
 * packages/local-ui-assets.h (dist/device/browser).
 *
 * Usage:
 *   npm run build:device -- path/to/site-config.yaml
 *   DEVICE_UI_CONFIG=path/to/site-config.yaml npm run build:device
 *
 * The site config is REQUIRED (no default — a silently wrong bake white-screens
 * the on-device dashboard against real firmware). It selects the site topology
 * baked into the app (scripts/emit-device-topology.mjs) and MUST be the same
 * site config the firmware bundle is generated from — positional route ids in
 * the dashboard have to match the device.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

const config = process.argv[2] ?? process.env.DEVICE_UI_CONFIG;
if (!config) {
  console.error('error: a site config is required');
  console.error('usage: npm run build:device -- path/to/site-config.yaml');
  console.error('   or: DEVICE_UI_CONFIG=path/to/site-config.yaml npm run build:device');
  process.exit(1);
}

const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit' });

run('node', ['scripts/emit-device-topology.mjs', config]);
// Invoke the CLI's JS entry directly: spawning the ng.cmd shim throws EINVAL
// under Node ≥18.20's CVE-2024-27980 hardening on win32.
run('node', ['node_modules/@angular/cli/bin/ng.js', 'build', '--configuration', 'device']);

// The device router is hash-location based and the firmware serves index.html for
// every navigation GET — but the SSR-flavored build names the CSR shell
// index.csr.html. Rename it so the codegen can embed it as the "/" entry.
if (!existsSync('dist/device/browser/index.csr.html'))
  throw new Error('dist/device/browser/index.csr.html missing — unexpected device build output');
renameSync('dist/device/browser/index.csr.html', 'dist/device/browser/index.html');

// Marker for the codegen: which config (and which exact baked topology) this
// dist was built from, so a stale or wrong-site dist can't be embedded silently.
const topology = readFileSync('src/app/device/device-topology.json');
writeFileSync('dist/device/browser/device-build.json', JSON.stringify({
  config,
  builtAt: new Date().toISOString(),
  topologySha256: createHash('sha256').update(topology).digest('hex'),
}, null, 2) + '\n');

console.log(`device build ready: dist/device/browser (topology: ${config})`);
