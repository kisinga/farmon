#!/usr/bin/env node
/**
 * Emit src/app/device/device-topology.json — the baked site topology the
 * device-mode dashboard loads instead of the PocketBase `sites` collection.
 *
 * Sample source: a defaults/configs site config (same shape parseTopology
 * accepts). Per-site codegen will later replace this step, emitting one file
 * per site before the device build runs.
 *
 * Usage: node scripts/emit-device-topology.mjs <config.yaml>  (config required)
 *
 * Runs automatically as the first step of `npm run build:device` (via
 * scripts/build-device.mjs) so the baked topology can never go stale against the
 * bundle (positional route ids in the dashboard must match the firmware built
 * from the same config). Pick the site with
 * `npm run build:device -- path/to/site.yaml` or DEVICE_UI_CONFIG=path/to/site.yaml.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parse } from 'yaml';

const SRC = process.argv[2];
if (!SRC) {
  console.error('usage: node scripts/emit-device-topology.mjs <config.yaml>');
  process.exit(1);
}
const OUT = 'src/app/device/device-topology.json';

const topology = parse(readFileSync(SRC, 'utf8'));

// The site id is fixed: the device serves exactly one site, and the device-mode
// router lands on /site/local/dashboard. siteLoad ignores the route param and
// always returns this envelope.
const envelope = {
  site: { id: 'local', name: 'This device' },
  topology,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(envelope, null, 2) + '\n');
console.log(`wrote ${OUT} from ${SRC}`);
