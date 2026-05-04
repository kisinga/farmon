/**
 * Snapshot test for the per-install site documentation generator.
 *
 * This test exists to de-risk the HBS-as-source documentation migration
 * (see /Users/mac/.claude/plans/as-a-senior-engineer-polymorphic-harp.md).
 *
 * Usage:
 *   npm run test:site-doc                    # assert against snapshot
 *   UPDATE_SNAPSHOTS=1 npm run test:site-doc # rewrite snapshot from current output
 */

import * as fs from "node:fs";
import * as path from "node:path";
// Imported from compiled output (dist-electron/) because site-readme.ts uses
// `__dirname`-relative path resolution to locate its HBS template, and that
// only resolves correctly from the compiled location. Run `npm run build:electron`
// before this test (the npm script chains it automatically).
import {
  generateSiteDocumentation,
  type SiteDocSystem,
} from "../dist-electron/electron/lib/generators/site-readme.js";
import type { Manifest } from "@far-mon/core";

const TEST_DIR = path.resolve(new URL(".", import.meta.url).pathname, "..");
const SNAPSHOT_PATH = path.join(TEST_DIR, "test", "__snapshots__", "site-doc.html");
const UPDATE = process.env.UPDATE_SNAPSHOTS === "1";

// ---------------------------------------------------------------------------
// Fixture — minimal but representative manifest
// ---------------------------------------------------------------------------
const manifest: Manifest = {
  device: {
    name: "test_device",
    friendly_name: "Test System",
    board: "kc868-a16",
  },
  nodes: [
    { kind: "tank", id: "tank_main", name: "Main Tank", isLevelSensor: true },
    { kind: "pump", id: "pump_main", name: "Main Pump" },
    { kind: "valve", id: "valve_a", name: "Valve A" },
    { kind: "valve", id: "valve_b", name: "Valve B" },
    { kind: "flow_sensor", id: "flow_main", name: "Flow Meter" },
  ],
  routes: [
    {
      key: "tank_main>valve_a",
      name: "Tank → Valve A",
      source: "tank_main",
      source_type: "tank",
      destination: "valve_a",
      valves: ["valve_a"],
      flow_sensor: "flow_main",
      max_runtime_seconds: 1800,
      needs_pump: true,
      nodeSequence: ["tank_main", "pump_main", "valve_a"],
      source_min_pct: 10,
      dest_max_pct: 0,
      runtime_level_ok: true,
    },
  ],
  timing: {
    valve_travel_time: 5,
    flow_watchdog: 30,
    flow_confirm: 3,
    flow_threshold: 0.5,
    api_watchdog: 60,
    update_interval: 1,
  },
  automations: [],
};

// Stable placeholder SVGs — keep these byte-identical across runs so the
// snapshot stays deterministic.
const TOPOLOGY_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><rect width="200" height="100" fill="#eef"/><text x="10" y="55">topology</text></svg>';

const systems: SiteDocSystem[] = [
  {
    systemId: "sysA",
    friendlyName: "Test System",
    board: "kc868-a16",
    boardLabel: "KC868-A16",
    activeTransport: "ethernet",
    deviceName: "test_device",
    manifest,
    topologySvg: TOPOLOGY_SVG,
    // boardSvg + pinOverlays intentionally omitted — exercises the no-pinout branch
  },
];

const compositeRoutes = [
  {
    key: "tank_main>valve_a",
    name: "Tank → Valve A",
    source: "sysA/tank_main",
    destination: "sysA/valve_a",
    crossesPump: true,
    valid: true,
  } as const,
];

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------
const html = generateSiteDocumentation(
  "Test Site",
  systems,
  [],
  TOPOLOGY_SVG,
  compositeRoutes as unknown as Parameters<typeof generateSiteDocumentation>[4],
  { genDate: "2026-01-01" },
);

// ---------------------------------------------------------------------------
// Compare / update
// ---------------------------------------------------------------------------
let passed = 0, failed = 0;

function reportDiff(actual: string, expected: string): void {
  let i = 0;
  while (i < Math.min(actual.length, expected.length) && actual[i] === expected[i]) i++;
  const ctx = (s: string) =>
    s.slice(Math.max(0, i - 40), i + 60).replace(/\n/g, "\\n");
  console.log(`    diff at index ${i} (actual.len=${actual.length}, expected.len=${expected.length})`);
  console.log(`    expected: ...${ctx(expected)}...`);
  console.log(`    actual:   ...${ctx(actual)}...`);
}

// ---------------------------------------------------------------------------
// Dedup guard — three controllers on the same physical board (with mixed
// snake/kebab casing) must produce ONE set of Advanced disclosures, not three.
// Expected disclosure count is derived from the on-disk partials directory so
// adding/removing a concern doesn't break the test.
// ---------------------------------------------------------------------------
{
  const tripleSystems: SiteDocSystem[] = [
    { systemId: "a", friendlyName: "Pump A",   board: "kc868-a16", boardLabel: "KC868-A16", activeTransport: "ethernet", deviceName: "pump_a", manifest, topologySvg: TOPOLOGY_SVG },
    { systemId: "b", friendlyName: "Pump B",   board: "kc868_a16", boardLabel: "KC868-A16", activeTransport: "ethernet", deviceName: "pump_b", manifest, topologySvg: TOPOLOGY_SVG },
    { systemId: "c", friendlyName: "Pump C",   board: "kc868-a16", boardLabel: "KC868-A16", activeTransport: "ethernet", deviceName: "pump_c", manifest, topologySvg: TOPOLOGY_SVG },
  ];
  const dedupHtml = generateSiteDocumentation(
    "Triple Site",
    tripleSystems,
    [],
    TOPOLOGY_SVG,
    compositeRoutes as unknown as Parameters<typeof generateSiteDocumentation>[4],
    { genDate: "2026-01-01" },
  );
  const expectedConcerns = fs
    .readdirSync(path.join(TEST_DIR, "packages/core/src/templates/partials/boards/kc868-a16"))
    .filter((f: string) => f.endsWith(".hbs"))
    .length;

  // Handbook structure: <h2>Device Reference</h2> appears exactly once,
  // <h3 id="device-…"> appears once per unique board, and <h4 id="device-…-…">
  // appears once per (board × concern). No <details> anywhere.
  const chapterHeaderCount = (dedupHtml.match(/<h2>Device Reference<\/h2>/g) ?? []).length;
  const boardSubheadingCount = (dedupHtml.match(/<h3 id="device-[a-z0-9-]+">/g) ?? []).length;
  const concernSubheadingCount = (dedupHtml.match(/<h4 id="device-[a-z0-9-]+-[a-z0-9-]+">/g) ?? []).length;
  const detailsLeftover = (dedupHtml.match(/<details/g) ?? []).length;

  const ok =
    chapterHeaderCount === 1 &&
    boardSubheadingCount === 1 &&
    concernSubheadingCount === expectedConcerns &&
    detailsLeftover === 0;
  if (ok) {
    console.log(`  ✓ Device Reference deduped (1 <h2>, 1 <h3>, ${concernSubheadingCount} <h4>s for 1 board × ${expectedConcerns} concerns across 3 controllers; 0 <details>)`);
    passed++;
  } else {
    console.log(`  ✗ Device Reference structure FAILED: chapter=${chapterHeaderCount} (expect 1), boards=${boardSubheadingCount} (expect 1), concerns=${concernSubheadingCount} (expect ${expectedConcerns}), details=${detailsLeftover} (expect 0)`);
    failed++;
  }
}

if (UPDATE || !fs.existsSync(SNAPSHOT_PATH)) {
  fs.mkdirSync(path.dirname(SNAPSHOT_PATH), { recursive: true });
  const existed = fs.existsSync(SNAPSHOT_PATH);
  fs.writeFileSync(SNAPSHOT_PATH, html, "utf-8");
  console.log(
    `📸 Snapshot ${existed ? "updated" : "written"}: ${path.relative(TEST_DIR, SNAPSHOT_PATH)} (${html.length} bytes)`,
  );
} else {
  const expected = fs.readFileSync(SNAPSHOT_PATH, "utf-8");
  if (html === expected) {
    console.log("  ✓ site-doc HTML matches snapshot");
    passed++;
  } else {
    console.log("  ✗ site-doc HTML drifted from snapshot");
    reportDiff(html, expected);
    console.log("    Run `UPDATE_SNAPSHOTS=1 npm run test:site-doc` to accept.");
    failed++;
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
