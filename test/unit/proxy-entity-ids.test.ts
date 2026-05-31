/**
 * Unit tests for proxy entity ID derivation and dashboard integration.
 *
 * Usage: npx tsx test/unit/proxy-entity-ids.test.ts
 */

import * as path from "node:path";
import { parseTopology, topologyToManifestForController } from "@far-mon/core";
import { pumpDescriptor } from "../../packages/core/src/entities/pump";
import { valveDescriptor } from "../../packages/core/src/entities/valve";
import { dosingPumpDescriptor } from "../../packages/core/src/entities/dosing-pump";
import { vfdDescriptor } from "../../packages/core/src/entities/vfd";
import { buildRouteControlSection, buildManualView } from "../../electron/lib/generators/dashboard.js";
import { generateControl } from "../../electron/lib/generators/control.js";
import { generateDeadman } from "../../electron/lib/generators/deadman.js";
import { loadBoard } from "../../electron/lib/board.js";

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

const DEFAULTS = new URL("../../defaults/", import.meta.url).pathname;
const kcBoard = loadBoard(path.join(DEFAULTS, "boards/kc868-a16"));

// ---------------------------------------------------------------------------
// Descriptor proxyEntityIds
// ---------------------------------------------------------------------------

console.log("Descriptor proxyEntityIds:");

const device = { friendly_name: 'water_ctrl' };

// Pump proxy entity ID
const pumpProxyIds = pumpDescriptor.codegen?.proxyEntityIds?.({ kind: 'pump', id: 'pump2', name: 'Pump' } as any, device);
assert(
  pumpProxyIds?.relay === 'switch.water_ctrl_remote_pump',
  "Pump proxy entity ID: " + pumpProxyIds?.relay
);

// Valve proxy entity ID
const valveProxyIds = valveDescriptor.codegen?.proxyEntityIds?.({ kind: 'valve', id: 'valve1', name: 'Valve 1' } as any, device);
assert(
  valveProxyIds?.cover === 'cover.water_ctrl_remote_valve_1',
  "Valve proxy entity ID: " + valveProxyIds?.cover
);

// Dosing pump proxy entity ID
const dosingProxyIds = dosingPumpDescriptor.codegen?.proxyEntityIds?.({ kind: 'dosing_pump', id: 'dp1', name: 'Dosing Pump' } as any, device);
assert(
  dosingProxyIds?.relay === 'switch.water_ctrl_remote_dosing_pump',
  "Dosing pump proxy entity ID: " + dosingProxyIds?.relay
);

// VFD proxy entity ID
const vfdProxyIds = vfdDescriptor.codegen?.proxyEntityIds?.({ kind: 'vfd', id: 'vfd1', name: 'VFD' } as any, device);
assert(
  vfdProxyIds?.switch === 'switch.water_ctrl_remote_vfd',
  "VFD proxy entity ID: " + vfdProxyIds?.switch
);

// ---------------------------------------------------------------------------
// Dashboard remote hardware section
// ---------------------------------------------------------------------------

console.log("\nDashboard remote hardware section:");

const crossControllerTopology = parseTopology({
  schema: 16,
  controllers: [
    { id: 'water-ctrl', board: 'kc868-a16', friendlyName: 'Water Controller' },
    { id: 'kc868-ctrl', board: 'kc868-a16', friendlyName: 'KC868 Controller' },
  ],
  nodes: [
    { kind: 'tank', id: 'tank1', name: 'Tank 1', ports: [{ id: 'outlet', label: 'Outlet', direction: 'outlet' }], position: { x: 0, y: 0 }, anchorId: 'water-ctrl' },
    { kind: 'pump', id: 'pump1', name: 'Main Pump', pin: 'OUT1', relay_polarity: 'active_low', ports: [{ id: 'in', label: 'Inlet', direction: 'inlet' }, { id: 'out', label: 'Outlet', direction: 'outlet' }], position: { x: 0, y: 0 }, anchorId: 'water-ctrl' },
    { kind: 'pump', id: 'pump2', name: 'Booster Pump', pin: 'OUT2', relay_polarity: 'active_low', ports: [{ id: 'in', label: 'Inlet', direction: 'inlet' }, { id: 'out', label: 'Outlet', direction: 'outlet' }], position: { x: 0, y: 0 }, anchorId: 'kc868-ctrl' },
    { kind: 'valve', id: 'valve1', name: 'Valve 1', open_pin: 'OUT3', close_pin: 'OUT4', travel_time: 10, ports: [{ id: 'inlet', label: 'Inlet', direction: 'inlet' }, { id: 'outlet', label: 'Outlet', direction: 'outlet' }], position: { x: 0, y: 0 }, anchorId: 'kc868-ctrl' },
    { kind: 'flow_sensor', id: 'flow1', name: 'Flow', pin: 'GPIO32', flow_cal: 450, ports: [{ id: 'inlet', label: 'Inlet', direction: 'inlet' }, { id: 'outlet', label: 'Outlet', direction: 'outlet' }], position: { x: 0, y: 0 }, anchorId: 'water-ctrl' },
  ],
  pipes: [
    { id: 'p1', from: 'tank1:outlet', to: 'pump1:in' },
    { id: 'p2', from: 'pump1:out', to: 'flow1:inlet' },
    { id: 'p3', from: 'flow1:outlet', to: 'tank1:inlet' },
    { id: 'p4', from: 'tank1:outlet', to: 'pump2:in' },
    { id: 'p5', from: 'pump2:out', to: 'flow1:inlet' },
  ],
  remoteImports: [
    { controllerId: 'water-ctrl', nodeId: 'pump2' },
    { controllerId: 'water-ctrl', nodeId: 'valve1' },
  ],
});

const waterManifest = topologyToManifestForController(crossControllerTopology, 'water-ctrl');
const routeControl = buildRouteControlSection(waterManifest);
const routeControlYaml = JSON.stringify(routeControl);

assert(
  routeControlYaml.includes('Remote Hardware'),
  "Dashboard includes Remote Hardware glance card"
);
assert(
  routeControlYaml.includes('switch.water_controller_remote_booster_pump'),
  "Remote pump proxy entity ID appears in dashboard"
);
assert(
  routeControlYaml.includes('cover.water_controller_remote_valve_1'),
  "Remote valve proxy entity ID appears in dashboard"
);
assert(
  routeControlYaml.includes('"P1"'),
  "Local pump labeled P1 in Hardware glance"
);
assert(
  !routeControlYaml.includes('"P2"'),
  "Remote pump is NOT labeled P2 in Hardware glance (it's in Remote Hardware)"
);

// ---------------------------------------------------------------------------
// Dashboard manual view includes remote actuators
// ---------------------------------------------------------------------------

console.log("\nDashboard manual view:");

const manualView = buildManualView(waterManifest);
const manualYaml = JSON.stringify(manualView);

assert(
  manualYaml.includes('switch.water_controller_remote_booster_pump'),
  "Manual view includes remote pump proxy"
);
assert(
  manualYaml.includes('cover.water_controller_remote_valve_1'),
  "Manual view includes remote valve proxy"
);
assert(
  manualYaml.includes('Remote Valve 1'),
  "Manual view labels remote valve correctly"
);
assert(
  !manualYaml.includes('Open Coil (raw)'),
  "Manual view does NOT show raw coils for remote valve"
);

// ---------------------------------------------------------------------------
// Control loop only includes local pumps
// ---------------------------------------------------------------------------

console.log("\nControl loop local-only:");

const controlYaml = generateControl(waterManifest);

assert(
  controlYaml.includes('need_pump_0'),
  "Control loop has local pump (pump1)"
);
assert(
  controlYaml.includes('need_pump_1'),
  "Control loop has imported pump (pump2) via proxy"
);
assert(
  controlYaml.includes('has_live_claim("pump1_relay")'),
  "Local pump checks deadman claims"
);
assert(
  !controlYaml.includes('has_live_claim("pump2_relay")'),
  "Imported pump does NOT check deadman claims (proxy handles cross-controller claim)"
);
assert(
  controlYaml.includes('safety_override'),
  "Safety override term present for local pump"
);

// ---------------------------------------------------------------------------
// Deadman only includes local actuators
// ---------------------------------------------------------------------------

console.log("\nDeadman local-only:");

const deadmanYaml = generateDeadman(waterManifest);

assert(
  deadmanYaml.includes('"pump1"'),
  "Deadman profile includes local pump1"
);
assert(
  !deadmanYaml.includes('"pump2"'),
  "Deadman profile does NOT include remote pump2"
);
assert(
  !deadmanYaml.includes('"valve1"'),
  "Deadman profile does NOT include remote valve1"
);

// --- Summary ---

console.log(`\n${"=".repeat(40)}`);
console.log(`${passed} passed, ${failed} failed`);

if (failed > 0) {
  process.exit(1);
}
