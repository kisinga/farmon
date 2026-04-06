/**
 * Topology model tests: verify schema parsing, route derivation, and
 * round-trip consistency with the codegen manifest.
 *
 * Usage: npx tsx test/topology.test.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import { TopologySchema, type Topology } from "../electron/lib/topology.js";
import { topologyToManifest } from "../electron/lib/topology-to-manifest.js";

const DEFAULTS = path.resolve(new URL(".", import.meta.url).pathname, "..", "defaults");
const CONFIG_PATH = path.join(DEFAULTS, "configs/pump-controller.yaml");

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string, detail?: string) {
  if (condition) {
    console.log(`  \u2713 ${name}`);
    passed++;
  } else {
    console.log(`  \u2717 ${name}${detail ? ` \u2014 ${detail}` : ""}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// Load topology config (schema 5)
// ---------------------------------------------------------------------------

console.log("Loading topology config...");
const raw = parseYaml(fs.readFileSync(CONFIG_PATH, "utf-8")) as Record<string, unknown>;
const topology = TopologySchema.parse(raw);
assert(topology.schema === 5, "Schema version is 5");

// ---------------------------------------------------------------------------
// Node structure
// ---------------------------------------------------------------------------

console.log("\nNode structure:");
const tanks = topology.nodes.filter((n) => n.kind === "tank");
const pumps = topology.nodes.filter((n) => n.kind === "pump");
const endpoints = topology.nodes.filter((n) => n.kind === "endpoint");
const valves = topology.nodes.filter((n) => n.kind === "valve");
const flowSensors = topology.nodes.filter((n) => n.kind === "flow_sensor");

assert(tanks.length === 2, `${tanks.length} tank nodes (expected 2)`);
assert(pumps.length === 1, `${pumps.length} pump node (expected 1)`);
assert(endpoints.length === 1, `${endpoints.length} endpoint node (expected 1)`);
assert(valves.length === 4, `${valves.length} valve nodes (expected 4)`);
assert(flowSensors.length === 2, `${flowSensors.length} flow sensor nodes (expected 2)`);

for (const t of tanks) {
  assert(t.ports.length >= 1, `Tank "${t.id}" has ${t.ports.length} port(s)`);
  const hasOutlet = t.ports.some((p) => p.direction === "outlet");
  assert(hasOutlet, `Tank "${t.id}" has an outlet port`);
}

assert(pumps[0].ports.length === 2, `Pump has ${pumps[0].ports.length} ports (expected 2)`);

// ---------------------------------------------------------------------------
// Pipe structure
// ---------------------------------------------------------------------------

console.log("\nPipe structure:");
assert(topology.pipes.length === 10, `${topology.pipes.length} pipes (expected 10)`);

// Route overrides
assert(
  Object.keys(topology.route_overrides).length === 3,
  `${Object.keys(topology.route_overrides).length} route overrides (expected 3)`
);

// ---------------------------------------------------------------------------
// Topology → Manifest derivation
// ---------------------------------------------------------------------------

console.log("\nManifest derivation:");
const manifest = topologyToManifest(topology);

assert(manifest.device.name === "pump-ctrl", "Device name preserved");
assert(manifest.device.board === "heltec-v3", "Board preserved");
assert(manifest.pump.pin === "GPIO42", `Pump pin = ${manifest.pump.pin}`);

assert(manifest.tanks.length === 2, `${manifest.tanks.length} tanks`);
assert(manifest.valves.length === 4, `${manifest.valves.length} valves`);
assert(manifest.flow_sensors.length === 2, `${manifest.flow_sensors.length} flow sensors`);
assert(manifest.routes.length === 3, `${manifest.routes.length} routes`);

// Check each expected route
console.log("\nDerived routes:");
const expectedRoutes = [
  { name: "T1>T2", source: "tank1", dest: "tank2", valves: ["valve1", "valve3"], flow: "flow3", runtime: 600 },
  { name: "T1>H2", source: "tank1", dest: undefined, valves: ["valve1", "valve4"], flow: "flow2", runtime: 1800 },
  { name: "T2>H2", source: "tank2", dest: undefined, valves: ["valve2", "valve4"], flow: "flow2", runtime: 1800 },
];

for (const exp of expectedRoutes) {
  const match = manifest.routes.find((r) => {
    if (r.source !== exp.source) return false;
    if ((r.destination ?? undefined) !== exp.dest) return false;
    const rValves = [...r.valves].sort();
    const eValves = [...exp.valves].sort();
    return rValves.length === eValves.length && rValves.every((v, i) => v === eValves[i]);
  });

  if (match) {
    assert(true, `Route "${exp.name}" derived correctly`);
    assert(match.name === exp.name, `  name: "${match.name}"`);
    assert(match.flow_sensor === exp.flow, `  flow_sensor: ${match.flow_sensor}`);
    assert(match.max_runtime_seconds === exp.runtime, `  max_runtime: ${match.max_runtime_seconds}`);
  } else {
    assert(false, `Route "${exp.name}" (${exp.source}→${exp.dest ?? "endpoint"}) not found`,
      `valves=[${exp.valves}], flow=${exp.flow}`);
  }
}

// ---------------------------------------------------------------------------
// Passive path detection (gravity flow — no pump crossing)
// ---------------------------------------------------------------------------

console.log("\nPassive path detection:");
const topologyWithGravity: Topology = {
  ...topology,
  nodes: [
    ...topology.nodes,
    {
      kind: "endpoint" as const,
      id: "garden",
      name: "Garden",
      ports: [{ id: "inlet", label: "Inlet", direction: "inlet" as const }],
      position: { x: 800, y: 600 },
    },
    {
      kind: "flow_sensor" as const,
      id: "flow_gravity",
      name: "Garden Flow",
      pin: "GPIO48",
      flow_cal: 450,
      ports: [
        { id: "inlet", label: "Inlet", direction: "inlet" as const },
        { id: "outlet", label: "Outlet", direction: "outlet" as const },
      ],
      position: { x: 600, y: 600 },
    },
  ],
  pipes: [
    ...topology.pipes,
    { id: "gravity_pipe1", from: "tank1:outlet", to: "flow_gravity:inlet" },
    { id: "gravity_pipe2", from: "flow_gravity:outlet", to: "garden:inlet" },
  ],
};

const derivedWithGravity = topologyToManifest(topologyWithGravity);
const gravityRoute = derivedWithGravity.routes.find((r) => r.flow_sensor === "flow_gravity");
assert(!gravityRoute, "Gravity pipe does NOT produce a pumped route");
assert(
  derivedWithGravity.flow_sensors.some((f) => f.id === "flow_gravity"),
  "Gravity flow sensor included in manifest for monitoring"
);

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${"=".repeat(40)}`);
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
