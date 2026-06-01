/**
 * Unit tests for distributed remote dead-man claim codegen.
 *
 * Usage: npx tsx test/unit/remote-proxy.test.ts
 */

import * as path from "node:path";
import { parseTopology, topologyToManifestForController } from "@far-mon/core";
import { templateSwitchProxy, templateCoverProxy, homeassistantBinarySensorProxy, homeassistantTextSensorProxy } from "../../packages/core/src/remote-proxy";
import { collectEntityCodegen } from "../../electron/lib/generators/collect.js";
import { generateSensors } from "../../electron/lib/generators/sensors.js";
import { loadBoard, type BoardDef } from "../../electron/lib/board.js";
import { validateAll } from "../../electron/lib/validate.js";

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
// templateSwitchProxy()
// ---------------------------------------------------------------------------

console.log("templateSwitchProxy():");

const proxyYaml = templateSwitchProxy(
  "pump2_relay",
  "Pump",
  "switch.kc868_controller_pump_relay",
  "kc868_controller",
  "water_ctrl"
);

assert(
  proxyYaml.includes('id: pump2_relay'),
  "Proxy uses correct switch ID"
);
assert(
  proxyYaml.includes('name: "Remote Pump"'),
  "Proxy names the remote entity"
);
assert(
  proxyYaml.includes('lambda:'),
  "Proxy includes lambda for state feedback"
);
assert(
  proxyYaml.includes('bs_pump2_relay'),
  "Proxy lambda reads from binary_sensor state tracker"
);
assert(
  proxyYaml.includes('service: esphome.kc868_controller_node_claim'),
  "Turn-on calls owning controller's node_claim service"
);
assert(
  proxyYaml.includes('service: esphome.kc868_controller_node_release'),
  "Turn-off calls owning controller's node_release service"
);
assert(
  proxyYaml.includes('node_id: pump2_relay'),
  "Claim/release target the proxy node ID"
);
assert(
  proxyYaml.includes('owner: water_ctrl'),
  "Claim/release carry the importing controller's name as owner"
);
assert(
  proxyYaml.includes('duration_ms: "90000"'),
  "Claim duration is quoted string for ESPHome YAML compatibility"
);
assert(
  proxyYaml.includes('service: switch.turn_on'),
  "Turn-on action calls switch.turn_on on remote entity"
);
assert(
  proxyYaml.includes('entity_id: switch.kc868_controller_pump_relay'),
  "Remote entity ID is passed through"
);
assert(
  proxyYaml.indexOf('node_claim') < proxyYaml.indexOf('switch.turn_on'),
  "Claim is sent BEFORE switch.turn_on"
);
assert(
  proxyYaml.indexOf('node_release') < proxyYaml.indexOf('switch.turn_off'),
  "Release is sent BEFORE switch.turn_off"
);

// Without remoteDeviceName / ownerDeviceName, claim blocks should be absent
const proxyNoClaim = templateSwitchProxy(
  "pump2_relay",
  "Pump",
  "switch.kc868_controller_pump_relay"
);
assert(
  !proxyNoClaim.includes('node_claim'),
  "No claim block when device names are omitted"
);
assert(
  !proxyNoClaim.includes('node_release'),
  "No release block when device names are omitted"
);

// ---------------------------------------------------------------------------
// homeassistantBinarySensorProxy()
// ---------------------------------------------------------------------------

console.log("\nhomeassistantBinarySensorProxy():");

const bsYaml = homeassistantBinarySensorProxy("pump2_relay", "switch.kc868_controller_pump_relay");
assert(
  bsYaml.includes('id: bs_pump2_relay'),
  "Binary sensor uses correct ID"
);
assert(
  bsYaml.includes('entity_id: switch.kc868_controller_pump_relay'),
  "Binary sensor tracks remote switch entity"
);
assert(
  bsYaml.includes('internal: true'),
  "Binary sensor is internal (not exposed to HA)"
);

// ---------------------------------------------------------------------------
// homeassistantTextSensorProxy()
// ---------------------------------------------------------------------------

console.log("\nhomeassistantTextSensorProxy():");

const tsYaml = homeassistantTextSensorProxy("valve1", "cover.kc868_controller_valve1");
assert(
  tsYaml.includes('id: ts_valve1'),
  "Text sensor uses correct ID"
);
assert(
  tsYaml.includes('entity_id: cover.kc868_controller_valve1'),
  "Text sensor tracks remote cover entity"
);
assert(
  tsYaml.includes('internal: true'),
  "Text sensor is internal (not exposed to HA)"
);

// ---------------------------------------------------------------------------
// templateCoverProxy()
// ---------------------------------------------------------------------------

console.log("\ntemplateCoverProxy():");

const coverYaml = templateCoverProxy("valve1", "Valve 1", "cover.kc868_controller_valve1");
assert(
  coverYaml.includes('id: valve1'),
  "Cover proxy uses correct ID"
);
assert(
  coverYaml.includes('name: "Remote Valve 1"'),
  "Cover proxy names the remote entity"
);
assert(
  coverYaml.includes('lambda:'),
  "Cover proxy includes lambda for state feedback"
);
assert(
  coverYaml.includes('ts_valve1'),
  "Cover lambda reads from text_sensor state tracker"
);
assert(
  coverYaml.includes('COVER_OPEN'),
  "Cover lambda returns COVER_OPEN for open state"
);
assert(
  coverYaml.includes('COVER_CLOSED'),
  "Cover lambda returns COVER_CLOSED for closed state"
);

// ---------------------------------------------------------------------------
// Manifest remote node fields
// ---------------------------------------------------------------------------

console.log("\nManifest remote node fields:");

const crossControllerTopology = parseTopology({
  schema: 16,
  controllers: [
    { id: 'water-ctrl', board: 'kc868-a16' },
    { id: 'kc868-ctrl', board: 'kc868-a16' },
  ],
  nodes: [
    { kind: 'tank', id: 'tank1', name: 'Tank 1', ports: [{ id: 'outlet', label: 'Outlet', direction: 'outlet' }], position: { x: 0, y: 0 }, anchorId: 'water-ctrl' },
    { kind: 'pump', id: 'pump1', name: 'Main Pump', pin: 'OUT1', relay_polarity: 'active_low', ports: [{ id: 'in', label: 'Inlet', direction: 'inlet' }, { id: 'out', label: 'Outlet', direction: 'outlet' }], position: { x: 0, y: 0 }, anchorId: 'water-ctrl' },
    { kind: 'pump', id: 'pump2', name: 'Remote Pump', pin: 'OUT2', relay_polarity: 'active_low', ports: [{ id: 'in', label: 'Inlet', direction: 'inlet' }, { id: 'out', label: 'Outlet', direction: 'outlet' }], position: { x: 0, y: 0 }, anchorId: 'kc868-ctrl' },
    { kind: 'flow_sensor', id: 'flow1', name: 'Flow', pin: 'GPIO32', flow_cal: 450, ports: [{ id: 'inlet', label: 'Inlet', direction: 'inlet' }, { id: 'outlet', label: 'Outlet', direction: 'outlet' }], position: { x: 0, y: 0 }, anchorId: 'water-ctrl' },
    { kind: 'tank', id: 'tank2', name: 'Tank 2', ports: [{ id: 'inlet', label: 'Inlet', direction: 'inlet' }], position: { x: 0, y: 0 }, anchorId: 'water-ctrl' },
  ],
  pipes: [
    { id: 'p1', from: 'tank1:outlet', to: 'pump1:in' },
    { id: 'p2', from: 'pump1:out', to: 'flow1:inlet' },
    { id: 'p3', from: 'flow1:outlet', to: 'tank2:inlet' },
    { id: 'p4', from: 'tank1:outlet', to: 'pump2:in' },
    { id: 'p5', from: 'pump2:out', to: 'flow1:inlet' },
  ],
  remoteImports: [
    { controllerId: 'water-ctrl', nodeId: 'pump2' },
  ],
});

const waterManifest = topologyToManifestForController(crossControllerTopology, 'water-ctrl');

// Manifest split: imported nodes should be in imports, local nodes in nodes
assert(
  waterManifest.imports.some(n => n.id === 'pump2'),
  "Remote pump is in imports array"
);
assert(
  !waterManifest.nodes.some(n => n.id === 'pump2'),
  "Remote pump is NOT in nodes array"
);
assert(
  waterManifest.nodes.some(n => n.id === 'pump1'),
  "Local pump is in nodes array"
);

const pump2Node = waterManifest.imports.find(n => n.id === 'pump2');

assert(!!pump2Node, "Remote pump included in importing controller's manifest");
assert(
  pump2Node?.remoteHaEntityId === 'switch.kc868_ctrl_pump_relay',
  "Remote pump HA entity ID is derived from owning controller: got " + pump2Node?.remoteHaEntityId
);
assert(
  pump2Node?.remoteDeviceName === 'kc868_ctrl',
  "Remote pump device name is derived from owning controller: got " + pump2Node?.remoteDeviceName
);

// Local pump should NOT have remote fields
const pump1Node = waterManifest.nodes.find(n => n.id === 'pump1');
assert(!pump1Node?.remoteHaEntityId, "Local pump has no remote HA entity");
assert(!pump1Node?.remoteDeviceName, "Local pump has no remote device name");

// ---------------------------------------------------------------------------
// collectEntityCodegen — remote proxy emission
// ---------------------------------------------------------------------------

console.log("\ncollectEntityCodegen — remote proxy emission:");

const collected = collectEntityCodegen(waterManifest, kcBoard);

assert(
  collected.sections['binary_sensor']?.some(y => y.includes('bs_pump2_relay')),
  "Remote pump state tracker emitted in sections['binary_sensor']"
);
assert(
  collected.sections['switch']?.some(y => y.includes('pump2_relay')),
  "Remote pump proxy emitted in sections['switch']"
);
assert(
  collected.sections['switch']?.some(y => y.includes('lambda:')),
  "Remote proxy switch includes lambda for state feedback"
);
assert(
  collected.sections['switch']?.some(y => y.includes('node_claim')),
  "Remote proxy includes claim action"
);
assert(
  collected.sections['switch']?.some(y => y.includes('node_release')),
  "Remote proxy includes release action"
);
assert(
  !collected.switches.some(y => y.includes('pump2_relay')),
  "Remote pump does NOT emit local hardware switch"
);
assert(
  collected.switches.some(y => y.includes('pump1_relay')),
  "Local pump still emits hardware switch"
);
assert(
  collected.sections['interval']?.some(y => y.includes('interval:') && y.includes('pump2_relay') && y.includes('node_claim')),
  "Remote proxy emits lease heartbeat interval"
);

// ---------------------------------------------------------------------------
// generateSensors — proxy switch included in final YAML
// ---------------------------------------------------------------------------

console.log("\ngenerateSensors — proxy switch in final YAML:");

const sensorsYaml = generateSensors(waterManifest, collected);

assert(
  sensorsYaml.includes('Remote Pump'),
  "Final sensors.yaml contains Remote Pump switch"
);
assert(
  sensorsYaml.includes('id: pump2_relay'),
  "Final sensors.yaml contains pump2_relay ID"
);
assert(
  sensorsYaml.includes('kc868_ctrl_node_claim'),
  "Final sensors.yaml contains claim service call"
);
assert(
  sensorsYaml.includes('kc868_ctrl_node_release'),
  "Final sensors.yaml contains release service call"
);

// ---------------------------------------------------------------------------
// Pin conflict validation — remote nodes skipped
// ---------------------------------------------------------------------------

console.log("\nPin conflict validation:");

const validation = validateAll(crossControllerTopology, waterManifest, kcBoard);
const pinErrors = validation.diagnostics.filter(d => d.message.includes('Pin') && d.severity === 'error');

assert(
  pinErrors.length === 0,
  "No pin conflicts from remote-imported nodes: " + pinErrors.map(e => e.message).join('; ')
);

// --- Summary ---

console.log(`\n${"=".repeat(40)}`);
console.log(`${passed} passed, ${failed} failed`);

if (failed > 0) {
  process.exit(1);
}
