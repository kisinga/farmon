/**
 * Integration tests: generate from the example manifest + board definition
 * and verify the output is structurally correct and internally consistent.
 *
 * Usage: npm test
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import { type Manifest, type ManifestNode, nodesByKind, parseTopology, topologyToManifestForController, reservedPins, collectTelemetryChannels, collectTunableNumbers, buildDashboardSpec } from "@core";
import { type BoardDef } from "@core";
import { loadBoard } from "./helpers";
import { validateAll } from "@core/rules";
import { generateAll, createTestMetadata, type GeneratedFile } from "@core/codegen";
import { generateBoardPackage } from "@core/codegen";
import { generateMajiControlConfig } from "@core/codegen";
import { collectEntityCodegen } from "@core/codegen";

const DEFAULTS = path.resolve(new URL(".", import.meta.url).pathname, "..", "defaults");
const CONFIG_PATH = path.join(DEFAULTS, "configs/pump-controller.yaml");
const BOARD_DIR = path.join(DEFAULTS, "boards/heltec-v3");

let manifest: Manifest;
let board: BoardDef;
let files: GeneratedFile[];
let fileMap: Map<string, string>;

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

function getFile(suffix: string): string {
  for (const [key, content] of fileMap) {
    if (key.endsWith(suffix)) return content;
  }
  throw new Error(`No generated file ending with "${suffix}"`);
}

/** Shorthand for ManifestNode string field access. */
function n(node: ManifestNode, key: string): string {
  return String(node[key] ?? '');
}

function pumpedPressureTopology(sourcePumpRated: boolean, destPumpRated: boolean) {
  return parseTopology({
    schema: 18,
    controllers: [{ id: 'pressure-runtime', friendlyName: 'Pressure Runtime', board: 'heltec-v3' }],
    nodes: [
      {
        kind: 'tank', id: 'source_tank', name: 'Source Tank',
        level_monitored: true, pressure_pin: 'GPIO1', pressure_sensor_max_psi: 15, pressure_pump_rated: sourcePumpRated,
        ports: [{ id: 'inlet', label: 'Inlet', direction: 'inlet' }, { id: 'outlet', label: 'Outlet', direction: 'outlet' }],
        position: { x: 0, y: 0 }, anchorId: 'pressure-runtime',
      },
      {
        kind: 'valve', id: 'route_valve', name: 'Route Valve', open_pin: 'GPIO2', close_pin: 'GPIO3',
        ports: [{ id: 'inlet', label: 'Inlet', direction: 'inlet' }, { id: 'outlet', label: 'Outlet', direction: 'outlet' }],
        position: { x: 200, y: 0 }, anchorId: 'pressure-runtime',
      },
      {
        kind: 'pump', id: 'pump', pin: 'GPIO4',
        ports: [{ id: 'in', label: 'Inlet', direction: 'inlet' }, { id: 'out', label: 'Outlet', direction: 'outlet' }],
        position: { x: 300, y: 0 }, anchorId: 'pressure-runtime',
      },
      {
        kind: 'flow_sensor', id: 'route_flow', name: 'Route Flow', pin: 'GPIO5', flow_cal: 450,
        ports: [{ id: 'inlet', label: 'Inlet', direction: 'inlet' }, { id: 'outlet', label: 'Outlet', direction: 'outlet' }],
        position: { x: 400, y: 0 }, anchorId: 'pressure-runtime',
      },
      {
        kind: 'tank', id: 'dest_tank', name: 'Destination Tank',
        level_monitored: true, pressure_pin: 'GPIO6', pressure_sensor_max_psi: 15, pressure_pump_rated: destPumpRated,
        ports: [{ id: 'inlet', label: 'Inlet', direction: 'inlet' }, { id: 'outlet', label: 'Outlet', direction: 'outlet' }],
        position: { x: 500, y: 0 }, anchorId: 'pressure-runtime',
      },
    ],
    pipes: [
      { id: 'p1', from: 'source_tank:outlet', to: 'route_valve:inlet' },
      { id: 'p2', from: 'route_valve:outlet', to: 'pump:in' },
      { id: 'p3', from: 'pump:out', to: 'route_flow:inlet' },
      { id: 'p4', from: 'route_flow:outlet', to: 'dest_tank:inlet' },
    ],
    route_overrides: {
      'source_tank>dest_tank#route_valve': { source_min_level: 20, dest_max_level: 90 },
    },
    timing: {
      valve_travel_time: 15,
      flow_watchdog: 30,
      flow_confirm: 15,
      flow_threshold: 0.5,
      update_interval: 5,
    },
    automations: [],
    remoteImports: [],
  });
}

// async main: generateAll is async (manifest-driven local-UI assets).
const main = async () => {
// --- Setup ---

console.log("Codegen Integration Tests");
console.log("=========================\n");

board = loadBoard(BOARD_DIR);
const rawConfig = fs.readFileSync(CONFIG_PATH, "utf-8");
const topology = parseTopology(parseYaml(rawConfig));
manifest = topologyToManifestForController(topology, topology.controllers[0]?.id ?? 'default');
const validation = validateAll(topology, manifest, board);
files = await generateAll(manifest, board, 'test-site', undefined, createTestMetadata(), {});
fileMap = new Map(files.map((f) => [f.relativePath, f.content]));

// Helper arrays
const valves = nodesByKind(manifest.nodes, 'valve');
const flowSensors = nodesByKind(manifest.nodes, 'flow_sensor');
const tanksWithLevel = manifest.nodes.filter(n => n.kind === 'tank' && n['level_monitored']);
const waterSources = nodesByKind(manifest.nodes, 'water_source');

// --- Board definition ---

console.log("Board definition:");
assert(board.model === "heltec-v3", `Board model = ${board.model}`);
assert(board.pins.length === 20, `${board.pins.length} exposed pins`);
assert(!!board.peripherals.oled, "Has OLED peripheral");
assert(!!board.peripherals.battery, "Has battery peripheral");
assert(!!board.peripherals.lora, "Has LoRa peripheral");

// --- Validation ---

console.log("\nManifest validation:");
assert(validation.ok, "Manifest passes validation");
assert(validation.errors.length === 0, "No validation errors");

// --- File generation ---

console.log("\nFile generation:");
const expectedSuffixes = [
  "board.yaml",
  "pump-controller.yaml",
  "route-engine.yaml",
  "hardware.yaml",
  "sensors.yaml",
  "control.yaml",
  "mqtt.yaml",
];
for (const suffix of expectedSuffixes) {
  const found = [...fileMap.keys()].some((k) => k.endsWith(suffix));
  assert(found, `Generates ${suffix}`);
}

// --- Board package ---

console.log("\nboard.yaml (generated board package):");
const boardPkg = getFile("common/board.yaml");
assert(boardPkg.includes("esp32s3"), "MCU variant");
assert(boardPkg.includes("sda: GPIO17"), "I2C SDA");
assert(boardPkg.includes("scl: GPIO18"), "I2C SCL");
assert(boardPkg.includes("battery_voltage"), "Battery ADC sensor");
assert(boardPkg.includes("battery_percent"), "Battery percent sensor");
assert(boardPkg.includes("led_output"), "LED output");
assert(boardPkg.includes("vext"), "Vext control");
assert(boardPkg.includes("font_top_bar"), "OLED font (board has OLED)");
assert(boardPkg.includes("wifi_dbm"), "WiFi signal sensor");
assert(boardPkg.includes("uptime_sec"), "Uptime sensor");

// --- Logging hygiene (INFO floor + noisy tags at WARN) ---
// Default DEBUG reprints every sensor/cover/number each loop — a firehose that
// also fed a logger->MQTT storm. INFO floor + per-tag WARN trims it; firmware
// tags (ctrl/safety) stay loud via the floor.
assert(
  /level:\s*INFO/.test(boardPkg) && /sensor:\s*WARN/.test(boardPkg),
  "Logger trimmed — INFO floor, chatty component tags at WARN",
);

// --- Provisioning surfaces (BLE dropped for heap) ---
// esp32_improv (BLE) costs ~95KB heap and bootlooped managed/TLS builds; dropped.
// captive_portal (AP) + improv_serial (USB) remain as the wifi (re)provision paths.
assert(
  !boardPkg.includes("esp32_improv") && boardPkg.includes("improv_serial"),
  "BLE provisioning dropped, serial-improv kept (heap reclaim)",
);
assert(
  boardPkg.includes("captive_portal"),
  "captive_portal kept — AP-mode wifi reprovision path",
);

// --- Server-unavailability reboot safety ---
// A controller runs local control autonomously and is an island when upstream
// is down; neither a dead AP nor a rejecting/unreachable broker may reboot it,
// nor may a weak/congested link stall the main loop into a watchdog reset.
assert(
  /reboot_timeout:\s*['"]?0s['"]?/.test(boardPkg),
  "WiFi reboot_timeout disabled (0s) — AP loss never reboots",
);
const mqttYaml = getFile("mqtt.yaml");
assert(
  /reboot_timeout:\s*['"]?0s['"]?/.test(mqttYaml),
  "MQTT reboot_timeout disabled (0s) — broker loss never reboots",
);
assert(
  /idf_send_async:\s*true/.test(mqttYaml),
  "MQTT idf_send_async on — publish off the main loop, weak link never trips the task watchdog",
);
assert(
  mqttYaml.includes("log_topic:") && /level:\s*WARN/.test(mqttYaml),
  "MQTT raw log_topic gated to WARN+ — can't feedback-storm the broker into heap exhaustion",
);
assert(
  /\\"heap_free\\":/.test(mqttYaml),
  "Heap reading rides the snapshot — free heap is the binding constraint; watch it fleet-wide",
);
assert(
  /\\"heap_total\\":/.test(mqttYaml) && /heap_caps_get_total_size/.test(mqttYaml),
  "Managed-heap total rides the snapshot (from heap_caps_get_total_size) — the deterministic, partition-aware RAM-gauge denominator",
);
assert(
  /\/state"/.test(mqttYaml) && /\\"routes\\":\[/.test(mqttYaml),
  "One controller snapshot to .../state carries the per-route current run (state + origin + actor)",
);
// --- On-device control-event log rides the snapshot (the activity feed) ---
assert(
  /\\"events\\":\[/.test(mqttYaml) && mqttYaml.includes("id(control).events(ec)"),
  "Snapshot carries the on-device control-event log (events[], newest first)",
);
assert(
  mqttYaml.includes('static const char* ACTION_TOK[] = {"START", "STOP", "STOP_ALL", "FAULT"};'),
  "Snapshot maps event action codes through ACTION_TOK (mirrors enum EventAction in core.h)",
);
assert(
  /\\"action\\":\\"%s\\",\\"origin\\":\\"%s\\",\\"actor\\":\\"%s\\",\\"reason\\":\\"%s\\"/.test(mqttYaml) &&
    /\\"ts\\":%lld,\\"up\\":%u,\\"route\\":%d/.test(mqttYaml),
  "Event entries carry ts/up/route/action/origin/actor/reason (ts=0 when untrusted -> app renders up)",
);
{
  // Sizing: the buffer formula reserves 10 * 180 B for the event ring on top of the
  // pre-events baseline (worst-case entry ~187 B: long ts/up + STOP_ALL + two 33 B
  // escaped fields), plus key.length + 17 B per runtime tunable echoed into readings
  // (per-key sizing — tunable keys are node-id-derived with no length cap, so a flat
  // rate would under-size long ids and the truncated snapshot would be dropped
  // server-side). Pin the emitted size against the formula so a future BUFSZ edit
  // that drops either headroom fails here.
  const m2 = mqttYaml.match(/static char buf\[(\d+)\];/);
  assert(!!m2, "Snapshot buffer size is pinned in the emitted script");
  const channels = collectTelemetryChannels(manifest).filter(
    (c) => !["system_state", "queue_depth", "safety_override"].includes(c.sensor) &&
      (c.kind === "state" || c.kind === "bool" || c.kind === "cover" || c.kind === "enum" || c.kind === "text"),
  );
  const tunableEchoBytes = collectTunableNumbers(manifest).reduce((sum, t) => sum + t.key.length + 17, 0);
  const expected = Math.max(2048, channels.length * 44 + tunableEchoBytes + manifest.routes.length * 192 + 1024 + 16 * 150 + 10 * 180);
  assert(Number(m2![1]) === expected, "Snapshot buffer includes the events + tunables headroom (10 events x 180 B, key.length + 17 B/tunable)",
    `got ${m2![1]}, want ${expected}`);
}
assert(
  !/telemetry\//.test(mqttYaml) && !/\/event"/.test(mqttYaml),
  "No per-sensor telemetry topic and no lossy event topic — the snapshot is the single source of truth",
);
assert(
  mqttYaml.includes("on_json_message") && /qos:\s*1/.test(mqttYaml),
  "Command subscription at QoS 1 — broker queues commands across a reconnect (no lost-on-first-try race)",
);
assert(
  /clean_session:\s*false/.test(mqttYaml),
  "Persistent session pinned (clean_session: false) — QoS 1 command queuing isn't left to an upstream default",
);

// --- Immediate snapshot (A2): the snapshot is a shared script run by the periodic
// interval AND fired right after each handled command, so a command's outcome
// reaches the dashboard at once instead of waiting up to one interval. ---
assert(
  mqttYaml.includes("id: publish_snapshot"),
  "A2: snapshot factored into a shared publish_snapshot script",
);
assert(
  /script\.execute:\s*publish_snapshot/.test(mqttYaml),
  "A2: periodic interval runs publish_snapshot (snapshot body de-inlined from the interval)",
);
assert(
  mqttYaml.includes("id(publish_snapshot).execute()"),
  "A2: command handler fires an immediate snapshot after handling a command",
);
assert(
  (mqttYaml.match(/mc->publish\("majiflow\//g) ?? []).length === 1,
  "A2: snapshot publish lives in one place (script body moved, not duplicated)",
);

// --- Device-facing TLS (certificate_authority embedding) ---
console.log("\nMQTT TLS embedding:");
// Default metadata is plain 1883 → no certificate_authority (on-prem byte-stability).
assert(
  /port:\s*1883/.test(mqttYaml) && !mqttYaml.includes("certificate_authority"),
  "Plain default: no certificate_authority, port 1883",
);
// A TLS endpoint pins the broker's self-signed cert, skips the CN check, and dials 8883.
const SAMPLE_CA =
  "-----BEGIN CERTIFICATE-----\nMIIBsampleCAbodyLineOne\nMIIBsampleCAbodyLineTwo\n-----END CERTIFICATE-----\n";
const tlsFiles = await generateAll(
  manifest, board, 'test-site', undefined,
  createTestMetadata({ brokerTls: true, brokerPort: 8883, brokerCa: SAMPLE_CA }), {},
);
const tlsMqtt = tlsFiles.find((f) => f.relativePath.endsWith("mqtt.yaml"))?.content ?? "";
assert(tlsMqtt.includes("certificate_authority: |-"), "TLS: emits certificate_authority block");
assert(tlsMqtt.includes("MIIBsampleCAbodyLineOne"), "TLS: embeds the cert PEM body");
assert(tlsMqtt.includes("skip_cert_cn_check: true"), "TLS: emits skip_cert_cn_check (exact-cert pinning)");
assert(/port:\s*8883/.test(tlsMqtt), "TLS: port 8883");

// --- OTA (pull-update path) ---
console.log("\nOTA pull-update:");
// Board package keeps push OTA (bench flashing) AND adds the http_request pull
// platform, the http_request client, and safe_mode recovery.
assert(boardPkg.includes("platform: esphome"), "OTA: esphome push platform retained");
assert(boardPkg.includes("platform: http_request"), "OTA: http_request pull platform added");
assert(/^http_request:/m.test(boardPkg), "OTA: http_request component emitted");
assert(boardPkg.includes("safe_mode:"), "OTA: safe_mode recovery emitted");
// mqtt.yaml carries the firmware_update command branch, the version no-op guard,
// the url/md5 globals, and the do_ota_flash script that performs the flash.
assert(
  mqttYaml.includes('strcmp(action, "firmware_update")'),
  "OTA: mqtt handles the firmware_update command",
);
assert(
  mqttYaml.includes("id(majiflow_generation_version).state.c_str()"),
  "OTA: firmware_update no-ops when already on the target version",
);
assert(
  mqttYaml.includes("id(do_ota_flash).execute()"),
  "OTA: firmware_update triggers the do_ota_flash script",
);
assert(
  /ota\.http_request\.flash:/.test(mqttYaml) && mqttYaml.includes("id: do_ota_flash"),
  "OTA: do_ota_flash script flashes via ota.http_request.flash",
);
assert(
  /\\"fw_version\\":/.test(mqttYaml),
  "OTA: running fw_version rides the snapshot (server confirms the release)",
);

// --- Device YAML ---

console.log("\ndevice YAML (generated):");
const deviceYaml = getFile("pump-controller.yaml");
assert(deviceYaml.includes("name: ${device_name}"), "ESPHome name sub");
// Hostname (esphome name) must avoid underscores (DHCP/mDNS warning) — the
// friendly_name "Pump-ctrl" slugs to "pump_ctrl"; the device_name sub hyphenates.
assert(deviceYaml.includes("device_name: pump-ctrl"), "ESPHome name sub hyphenates hostname");
assert(!deviceYaml.includes("device_name: pump_ctrl"), "No underscore in device hostname");
assert(deviceYaml.includes("packages/route-engine.yaml"), "Includes route-engine.yaml");
assert(deviceYaml.includes("common/board.yaml"), "Includes board package");
assert(deviceYaml.includes("packages/control.yaml"), "Includes control");
assert(deviceYaml.includes("display:"), "OLED display block (board has OLED)");
assert(deviceYaml.includes("GPIO_NUM_21"), "OLED reset in boot (GPIO21)");
assert(deviceYaml.includes("Boot complete"), "Boot log present");
// Removed fields should NOT appear in substitutions
assert(!deviceYaml.includes("refill_watchdog_seconds"), "No refill_watchdog_seconds sub");
assert(!deviceYaml.includes("refill_min_rise_pct"), "No refill_min_rise_pct sub");
assert(!deviceYaml.includes("max_runtime_seconds"), "No global max_runtime_seconds sub");
assert(!deviceYaml.includes("refill_baseline"), "No refill_baseline in boot");
// Per-sensor flow_cal substitutions (not global)
for (const f of flowSensors) {
  assert(deviceYaml.includes(`flow_cal_${n(f, 'id')}: "${n(f, 'flow_cal')}"`), `Per-sensor flow_cal sub for ${n(f, 'id')}`);
}

// --- route-engine.yaml (maji_control config — the route table + bindings) ---
// The route state machine / watchdog / pump-guard C++ moved to the maji_control
// external component: behaviour is host-tested (firmware/test/core_test.cpp) and
// esphome-compile-verified. Here we validate the generated CONFIG — the route data
// and entity bindings the component snapshots, idx-aligned with its tables.

console.log("\nroute-engine.yaml:");
const routeEngine = getFile("route-engine.yaml");
assert(routeEngine.includes("maji_control:"), "Emits the maji_control component config");
assert(routeEngine.includes("id: control"), "Engine id is 'control'");
assert(routeEngine.includes("claims_id: claims"), "Binds the maji_claims registry");
assert(routeEngine.includes("safety_override_id: safety_override"), "Binds the safety override switch");
assert(routeEngine.includes("flow_watchdog_id: flow_watchdog_s"), "Binds the flow-watchdog tunable");
for (const r of manifest.routes) {
  assert(routeEngine.includes(`name: "${r.name}"`), `Route "${r.name}" in the table`);
  assert(routeEngine.includes(`max_runtime_s: ${r.max_runtime_seconds}`), `Route "${r.name}" max_runtime_s = ${r.max_runtime_seconds}`);
}
assert(routeEngine.includes("conflict_mask:"), "Route table carries conflict masks");
assert(routeEngine.includes("pump_idx:"), "Route table carries pump_idx");
assert(routeEngine.includes("source_tank:"), "Route table carries source_tank");
assert(routeEngine.includes("runtime_level_ok:"), "Route table carries runtime_level_ok");
assert(routeEngine.includes("manual_pumps:"), "Emits the manual-pump guard table");
assert(routeEngine.includes("valves:"), "Emits the valve bindings");
assert(routeEngine.includes("tanks:"), "Emits the tank bindings");
// Per-route tunable numbers are bound when the route exposes them.
assert(routeEngine.includes("max_runtime_id: route_0_max_runtime"), "Binds per-route max-runtime number");
// Defaults (the old DEFAULT_*_MS firmware constants) ride the config now.
assert(/flow_watchdog_ms:\s*\d+/.test(routeEngine), "Carries the flow-watchdog default");
assert(/valve_travel_ms:\s*\d+/.test(routeEngine), "Carries the valve-travel default");

// --- hardware.yaml ---

console.log("\nhardware.yaml:");
const hw = getFile("hardware.yaml");
assert(hw.includes("pump_relay"), "Has pump relay");
assert(!hw.includes("pump_ref_count"), "Pump relay is engine-driven (no on_turn_on interlock)");
for (const v of valves) {
  assert(hw.includes(`id: ${n(v, 'id')}_open_pin`), `Valve ${n(v, 'id')} open pin`);
  assert(hw.includes(`interlock:`), `Has interlock`);
}

// --- sensors.yaml ---

console.log("\nsensors.yaml:");
const sensors = getFile("sensors.yaml");
for (const f of flowSensors) {
  assert(sensors.includes(`id: ${n(f, 'id')}`), `Flow ${n(f, 'id')} defined`);
  assert(sensors.includes(`\${flow_cal_${n(f, 'id')}}`), `Flow ${n(f, 'id')} uses per-sensor cal`);
}
assert(sensors.includes('id: flow_threshold_l_min'), "Has HA-tunable flow threshold number");
assert(sensors.includes('name: "Flow Threshold"'), "Flow threshold number has HA name");
assert(sensors.includes('id(flow_threshold_l_min).state'), "Flow logic uses tunable threshold");
assert(!sensors.includes('x > 0.5f'), "Flow logic does not hardcode 0.5 L/min");
assert(sensors.includes('unit_of_measurement: "s"'), "Route max-runtime numbers show seconds unit");
for (const t of tanksWithLevel) {
  assert(sensors.includes(`id: ${n(t, 'id')}_level`), `Tank ${n(t, 'id')} level`);
  assert(sensors.includes(`id: ${n(t, 'id')}_cal_empty`), `Tank ${n(t, 'id')} cal`);
}
// Fault/stop text: no old codes
assert(!sensors.includes("No level rise"), "No 'level rise' in fault/stop text");
assert(!sensors.includes("Source tank empty"), "No 'source empty' in fault/stop text");
assert(sensors.includes("No flow detected"), "Has 'No flow detected' fault");
assert(sensors.includes("Max runtime exceeded"), "Has 'Max runtime exceeded' fault");
assert(sensors.includes("HA connection lost"), "Has 'HA connection lost' fault");
// New concurrent execution sensors
assert(sensors.includes("active_routes_text"), "Has active_routes_text sensor");
assert(sensors.includes("route_queue_text"), "Has route_queue_text sensor");
assert(sensors.includes("queue_count"), "Queue text references queue_count");

// --- control.yaml ---

console.log("\ncontrol.yaml:");
const control = getFile("control.yaml");
// Parameterized route commands arrive as MQTT JSON actions, dispatched to try_route_*.
assert(mqttYaml.includes('"route_start"'), "route_start dispatched as MQTT command");
assert(mqttYaml.includes('"route_stop"'), "route_stop dispatched as MQTT command");
assert(mqttYaml.includes('"fault_reset"'), "fault_reset dispatched as MQTT command");
// Parameterless system actions are template buttons (auto-discoverable HA entities).
assert(control.includes("id: btn_stop_all"), "Has Stop All template button");
assert(control.includes("id: btn_reset_faults"), "Has Reset Faults template button");
assert(control.includes("id: btn_clear_queue"), "Has Clear Queue template button");
// The old api: services: entries for the parameterless actions are gone.
assert(!control.includes("service: stop_all"), "stop_all service removed (now button)");
assert(!control.includes("service: fault_reset_all"), "fault_reset_all service removed (now button)");
assert(!control.includes("service: queue_clear"), "queue_clear service removed (now button)");
assert(control.includes("interval: 1s"), "Has 1s transition interval");
assert(control.includes("interval: 2s"), "Has 2s safety interval");
// control.yaml is now thin glue — the state machine + watchdog live in the engine.
assert(control.includes("id(control).tick_1s("), "1s interval drives the engine");
assert(control.includes("id(control).tick_2s("), "2s interval drives the watchdog");
assert(control.includes("id(control).start_route"), "Route start buttons call the engine");
assert(control.includes('id(control).stop_all(maji_ctl::ORIGIN_MANUAL, "panel")'),
  "Stop-all button calls the engine attributed to the panel");
assert(mqttYaml.includes("id(control).stop_all(maji_ctl::ORIGIN_MANUAL, actor)"),
  "MQTT/local-UI stop_all calls the engine directly with the envelope actor (not btn_stop_all)");
assert(!control.includes("reconcile_valves"), "Valve reconcile moved into the engine");
assert(!control.includes("get_flow_rate"), "Safety loop moved into the engine");
assert(!control.includes("flowThresholdFallback"), "Control generator does not duplicate flow-threshold formatting");
assert(
  !control.includes("api_client_count") && !control.includes("api_lost_since") && !control.includes("api_lost_time"),
  "No HA API-loss watchdog (server loss never trips a fault — autonomous islands)",
);
assert(!control.includes("safe_close_mask"), "Edge-driven safe_close_mask removed");
assert(!control.includes("valves_closing"), "valves_closing edge flag removed");
assert(control.includes("id(control).start_route"), "Delegates route start to the engine (which queues on conflict)");
assert(!control.includes("close_all_valves"), "No close_all_valves script");
assert(!control.includes("do_prepare_and_run"), "No do_prepare_and_run script");
assert(!control.includes("id(active_route)"), "No active_route global reference");

// --- Cross-file consistency ---

console.log("\nCross-file consistency:");
for (const t of tanksWithLevel) {
  assert(
    sensors.includes(`id: ${n(t, 'id')}_level`) && routeEngine.includes(`${n(t, 'id')}_level`),
    `Tank ${n(t, 'id')}: sensors \u2194 route-engine binding`
  );
}
for (const f of flowSensors) {
  assert(
    sensors.includes(`id: ${n(f, 'id')}`) && routeEngine.includes(n(f, 'id')),
    `Flow ${n(f, 'id')}: sensors \u2194 route-engine binding`
  );
}
for (const v of valves) {
  assert(
    hw.includes(`id: ${n(v, 'id')}\n`) && routeEngine.includes(n(v, 'id')),
    `Valve ${n(v, 'id')}: hardware \u2194 route-engine binding`
  );
}

// --- Route table correctness ---

console.log("\nRoute table logic:");
const valveIdx = new Map(valves.map((v, i) => [n(v, 'id'), i]));
for (const route of manifest.routes) {
  const mask = route.valves.reduce((acc, v) => acc | (1 << valveIdx.get(v)!), 0);
  assert(routeEngine.includes(`valve_mask: ${mask},`), `Route "${route.name}" valve_mask = ${mask}`);
}

const pressureRuntimeCases = [
  { sourcePumpRated: false, destPumpRated: true, expected: false, label: 'source pressure sensor is not pump-rated' },
  { sourcePumpRated: true, destPumpRated: false, expected: false, label: 'destination pressure sensor is not pump-rated' },
  { sourcePumpRated: true, destPumpRated: true, expected: true, label: 'both pressure sensors are pump-rated' },
];
for (const c of pressureRuntimeCases) {
  const pressureTopo = pumpedPressureTopology(c.sourcePumpRated, c.destPumpRated);
  const pressureManifest = topologyToManifestForController(pressureTopo, pressureTopo.controllers[0]?.id ?? 'default');
  const pressureConfig = generateMajiControlConfig(pressureManifest);
  const pressureRoute = pressureManifest.routes.find(r => r.source === 'source_tank' && r.destination === 'dest_tank');
  assert(
    pressureRoute?.runtime_level_ok === c.expected,
    `Pressure runtime level checks ${c.expected ? 'enabled' : 'disabled'} when ${c.label}`,
  );
  assert(
    pressureConfig.includes(`runtime_level_ok: ${c.expected ? 'true' : 'false'}, name: "Source Tank > Destination Tank"`),
    `Generated config writes runtime_level_ok=${c.expected} when ${c.label}`,
  );
}

// =============================================================================
// VFD Entity Tests — Modbus VFD pump replacing GPIO relay
// =============================================================================

console.log("\n\nVFD Entity Tests");
console.log("================\n");

const VFD_CONFIG_PATH = path.join(DEFAULTS, "configs/vfd-pump-controller.yaml");
const vfdRawConfig = fs.readFileSync(VFD_CONFIG_PATH, "utf-8");
const vfdTopology = parseTopology(parseYaml(vfdRawConfig));
const vfdManifest = topologyToManifestForController(vfdTopology, vfdTopology.controllers[0]?.id ?? 'default');
const vfdFiles = await generateAll(vfdManifest, board, 'test-site', undefined, createTestMetadata(), {});
const vfdFileMap = new Map(vfdFiles.map((f) => [f.relativePath, f.content]));

function getVfdFile(suffix: string): string {
  for (const [key, content] of vfdFileMap) {
    if (key.endsWith(suffix)) return content;
  }
  throw new Error(`No VFD generated file ending with "${suffix}"`);
}

// --- Topology & routes ---

console.log("Topology:");
assert(vfdTopology.controllers[0]?.uart_buses?.length === 1, "Has 1 UART bus");
assert(vfdTopology.controllers[0]?.uart_buses?.[0].id === "uart_modbus", "UART bus id = uart_modbus");

const vfdRoutes = vfdManifest.routes;
assert(vfdRoutes.length === 1, `${vfdRoutes.length} route (tank1>tank2)`);
assert(vfdRoutes[0].crossesPump, "Route crossesPump = true (VFD has isPump flag)");

// --- Device YAML ---

console.log("\nDevice YAML:");
const vfdDeviceYaml = getVfdFile("vfd-pump-controller.yaml");
assert(vfdDeviceYaml.includes("uart:"), "Has uart: section");
assert(vfdDeviceYaml.includes("id: uart_modbus"), "UART bus id in output");
assert(vfdDeviceYaml.includes("tx_pin: GPIO17"), "UART TX pin");
assert(vfdDeviceYaml.includes("rx_pin: GPIO18"), "UART RX pin");
assert(vfdDeviceYaml.includes("de_pin: GPIO19"), "UART DE pin");
assert(vfdDeviceYaml.includes("baud_rate: 9600"), "UART baud rate");
assert(vfdDeviceYaml.includes("modbus:"), "Has modbus: section");
assert(vfdDeviceYaml.includes("id: uart_modbus_modbus"), "Modbus controller id");
assert(vfdDeviceYaml.includes("switch.turn_off"), "Boot turns off actuator");
assert(vfdDeviceYaml.includes("vfd1_relay"), "Boot turns off vfd1_relay");

// --- Hardware ---

console.log("\nHardware:");
const vfdHw = getVfdFile("hardware.yaml");
assert(vfdHw.includes("vfd1_relay"), "Has vfd1_relay (from VFD codegen)");
assert(vfdHw.includes("modbus_controller"), "Uses modbus_controller platform");
assert(vfdHw.includes("uart_modbus_modbus"), "References modbus controller id");

// --- Sensors ---

console.log("\nSensors:");
const vfdSensors = getVfdFile("sensors.yaml");
assert(vfdSensors.includes("vfd1_power"), "Has VFD power sensor");
assert(vfdSensors.includes("vfd1_frequency"), "Has VFD frequency sensor");
assert(vfdSensors.includes("vfd1_speed_setpoint"), "Has VFD speed setpoint number");
assert(vfdSensors.includes("max_value: 50"), "Speed setpoint max = max_frequency");
assert(vfdSensors.includes("number:"), "Has number: section for speed setpoint");
assert(vfdSensors.includes("button:"), "Has button: section for fault reset");
assert(vfdSensors.includes("vfd1_fault_reset"), "Has VFD fault reset button");

// --- Route engine (VFD) ---

console.log("\nRoute engine (VFD):");
const vfdRouteEngine = getVfdFile("route-engine.yaml");
assert(vfdRouteEngine.includes("manual_pumps:"), "Emits manual-pump guard table (VFD is isPump)");
assert(vfdRouteEngine.includes("vfd1_relay"), "Binds the vfd1 pump relay");

// =============================================================================
// KC868-A16 Board Tests — PCF8574 expander pins + Ethernet
// =============================================================================

console.log("\n\nKC868-A16 Board Tests");
console.log("====================\n");

const KC_BOARD_DIR = path.join(DEFAULTS, "boards/kc868-a16");
const KC_CONFIG_PATH = path.join(DEFAULTS, "configs/kc868-a16-controller.yaml");
const kcBoard = loadBoard(KC_BOARD_DIR);
const kcRawConfig = fs.readFileSync(KC_CONFIG_PATH, "utf-8");
const kcTopology = parseTopology(parseYaml(kcRawConfig));
const kcManifest = topologyToManifestForController(kcTopology, kcTopology.controllers[0]?.id ?? 'default');
const kcFiles = await generateAll(kcManifest, kcBoard, 'test-site', undefined, createTestMetadata(), {});
const kcFileMap = new Map(kcFiles.map((f) => [f.relativePath, f.content]));

function getKcFile(suffix: string): string {
  for (const [key, content] of kcFileMap) {
    if (key.endsWith(suffix)) return content;
  }
  throw new Error(`No KC868 generated file ending with "${suffix}"`);
}

// --- Board definition ---

console.log("Board definition:");
assert(kcBoard.model === "kc868_a16", `Board model = ${kcBoard.model}`);
assert(kcBoard.pins.length === 39, `${kcBoard.pins.length} pins (32 expander + 7 native)`);
assert(kcBoard.expanders?.length === 4, "Has 4 PCF8574 expanders");
assert(!!kcBoard.peripherals.ethernet, "Has Ethernet peripheral");
assert(!kcBoard.peripherals.oled, "No OLED");
assert(!kcBoard.peripherals.battery, "No battery");

// --- Board package ---

console.log("\nBoard package:");
const kcBoardPkg = getKcFile("common/board.yaml");
assert(kcBoardPkg.includes("esp32"), "MCU variant");
assert(kcBoardPkg.includes("esp-idf"), "Framework = esp-idf");
assert(kcBoardPkg.includes("sda: GPIO4"), "I2C SDA");
assert(kcBoardPkg.includes("ignore_strapping_warning: true"), "SCL GPIO5 strapping warning suppressed");
assert(kcBoardPkg.includes("ethernet:"), "Has ethernet: section");
assert(kcBoardPkg.includes("LAN8720"), "Ethernet type = LAN8720");
assert(kcBoardPkg.includes("mdc_pin: GPIO23"), "Ethernet MDC pin");
assert(kcBoardPkg.includes("pin: GPIO17"), "Ethernet CLK pin (structured)");
assert(kcBoardPkg.includes("mode: CLK_OUT"), "Ethernet CLK mode (structured, valid esphome enum)");
assert(!kcBoardPkg.includes("clk_mode"), "No deprecated clk_mode key");
assert(!kcBoardPkg.includes("wifi:"), "No wifi: section (ethernet board, default transport)");
assert(!kcBoardPkg.includes("captive_portal"), "No captive_portal (no wifi)");
// The default config enables local.ui, so the stock web_server v3 page is
// swapped for a bare web_server_base the maji_local_ui component serves the
// operator dashboard on (see networking.ts emitWebServer + local-ui.ts).
assert(!kcBoardPkg.includes("web_server:"), "local.ui: no stock web_server v3 page");
assert(kcBoardPkg.includes("web_server_base:"), "local.ui: bare web_server_base for maji_local_ui");
const kcLocalUi = getKcFile("packages/local-ui.yaml");
assert(kcLocalUi.includes("maji_local_ui:"), "local.ui: maji_local_ui package emitted (operator dashboard)");
// Port 80 MUST stay the HTTP port: ESPHome's web_server_base is a singleton
// AsyncWebServer shared with captive_portal. Moving it removes any HTTP
// listener from 192.168.4.1:80 → fallback AP captive portal silently breaks.
// With local.ui the pin lives in the maji_local_ui component (CONF_PORT
// default 80, firmware/components/maji_local_ui/__init__.py), not the YAML.
assert(!kcBoardPkg.includes("port: 80"), "local.ui: no YAML port override — component default keeps 80");
assert(kcBoardPkg.includes("pcf8574:"), "Has pcf8574: expander declarations");
assert(kcBoardPkg.includes("pcf8575: false"), "Explicit pcf8575: false on expanders");
assert(kcBoardPkg.includes("0x24"), "PCF8574 output expander 1 address");
assert(kcBoardPkg.includes("0x25"), "PCF8574 output expander 2 address");
assert(kcBoardPkg.includes("uptime_sec"), "Has uptime sensor");
assert(!kcBoardPkg.includes("wifi_dbm"), "No WiFi signal sensor (ethernet board)");
assert(kcBoardPkg.includes("ethernet_info"), "Has ethernet_info text sensor for IP address");
assert(kcBoardPkg.includes("ip_addr"), "Has IP address entity");
assert(!kcBoardPkg.includes("\nuart:"), "No uart: section in board package (user-configured per topology)");

// --- Transport selector ---
const kcBoardPkgWifi = generateBoardPackage(kcBoard, { mode: 'dhcp', transport: 'wifi' });
assert(!kcBoardPkgWifi.includes("ethernet:"), "transport=wifi: no ethernet: section");
assert(kcBoardPkgWifi.includes("wifi:"), "transport=wifi: has wifi: section");
// captive_portal IS emitted: it's the only ESPHome component that binds
// the SoftAP interface for HTTP. Without it, 192.168.4.1 has no page
// (esphome/issues#4333). The dashboard never serves on the AP, so AP +
// captive_portal exist solely as a credential-recovery hatch alongside
// Improv (which is the preferred modern path).
assert(kcBoardPkgWifi.includes("captive_portal"), "transport=wifi: has captive_portal (only AP-mode HTTP surface)");
assert(!kcBoardPkgWifi.includes("esp32_improv"), "transport=wifi: no esp32_improv (BLE provisioning dropped for heap)");
assert(kcBoardPkgWifi.includes("improv_serial"), "transport=wifi: has improv_serial (USB recovery)");
assert(kcBoardPkgWifi.includes("ap:"), "transport=wifi: has ap: fallback hotspot");
assert(kcBoardPkgWifi.includes("web_server:"), "transport=wifi: has web_server");
// No baked wifi credentials: the station password is provisioned on-device
// (captive_portal / Improv → NVS), never in the firmware or our DB. The
// fallback AP is open (provisioning-only — no control surface binds to it).
assert(!kcBoardPkgWifi.includes("fallback_password"), "transport=wifi: no fallback_password");
const apMatches = kcBoardPkgWifi.match(/!secret wifi_password/g) ?? [];
assert(apMatches.length === 0, `transport=wifi: no baked wifi_password — provisioned on-device, got ${apMatches.length}`);
// Diagnostic sensors must follow the active transport, not board capability:
assert(!kcBoardPkgWifi.includes("ethernet_info"), "transport=wifi on ethernet board: no ethernet_info text_sensor");
assert(kcBoardPkgWifi.includes("wifi_info"), "transport=wifi: has wifi_info text_sensor");
assert(kcBoardPkgWifi.includes("wifi_dbm"), "transport=wifi: has wifi_signal sensor");

const kcBoardPkgEth = generateBoardPackage(kcBoard, { mode: 'dhcp', transport: 'ethernet' });
assert(kcBoardPkgEth.includes("ethernet:"), "transport=ethernet: ethernet present");
assert(!kcBoardPkgEth.includes("wifi:"), "transport=ethernet: no wifi");
assert(kcBoardPkgEth.includes("ethernet_info"), "transport=ethernet: has ethernet_info text_sensor");
assert(!kcBoardPkgEth.includes("wifi_dbm"), "transport=ethernet: no wifi_signal sensor");

// Self-describing introspection sensors so HA/web_server can show the device's
// network model without inferring from the YAML.
assert(kcBoardPkg.includes("transport_supported"), "Has transport_supported template text_sensor");
assert(kcBoardPkg.includes("transport_active"), "Has transport_active template text_sensor");
assert(kcBoardPkg.includes('std::string("ethernet,wifi")'), "transport_supported reports both capabilities for ethernet board");
assert(kcBoardPkg.includes('std::string("ethernet")'), "transport_active reports the active transport (ethernet by default)");
assert(kcBoardPkgWifi.includes('std::string("wifi")'), "transport_active reports wifi when forced");
// Single text_sensor: block per device — guards against the YAML key collision regression.
const ethTextSensorBlocks = (kcBoardPkg.match(/^text_sensor:/gm) ?? []).length;
assert(ethTextSensorBlocks === 1, `Single text_sensor: top-level block (got ${ethTextSensorBlocks})`);

// RS485 bus pin reservation
console.log("\nRS485 pin reservation:");
const kcReserved = reservedPins(kcBoard);
assert(kcReserved.has("GPIO13"), `GPIO13 reserved for ${kcReserved.get("GPIO13")}`);
assert(kcReserved.has("GPIO16"), `GPIO16 reserved for ${kcReserved.get("GPIO16")}`);

// --- Hardware (expander pin resolution) ---

console.log("\nHardware:");
const kcHw = getKcFile("hardware.yaml");
assert(kcHw.includes("pump_relay"), "Has pump relay");
assert(kcHw.includes("pcf8574: pcf8574_out_1"), "Pump pin resolved to PCF8574 expander");
assert(kcHw.includes("valve1_open_pin"), "Valve open pin declared");
assert(kcHw.includes("valve1_close_pin"), "Valve close pin declared");

// --- Sensors ---

console.log("\nSensors:");
const kcSensors = getKcFile("sensors.yaml");
assert(kcSensors.includes("id: flow1"), "Flow sensor defined");
assert(kcSensors.includes("GPIO32"), "Flow sensor uses native GPIO32");
assert(kcSensors.includes("id: tank1_level"), "Tank level sensor defined");
assert(kcSensors.includes("GPIO36"), "Tank pressure sensor uses native GPIO36 for ADC");

// --- Device YAML ---

console.log("\nDevice YAML:");
const kcDeviceYaml = getKcFile("kc868-controller.yaml");
assert(kcDeviceYaml.includes("name: ${device_name}"), "ESPHome name sub");
assert(!kcDeviceYaml.includes("display:"), "No OLED display (board has no OLED)");

// =============================================================================
// SONOFF BASICR4 Board Tests — ESP32-C3 single-relay pump controller
// =============================================================================

console.log("\n\nSONOFF BASICR4 Board Tests");
console.log("==========================\n");

const R4_BOARD_DIR = path.join(DEFAULTS, "boards/sonoff-basicr4");
const R4_CONFIG_PATH = path.join(DEFAULTS, "configs/sonoff-basicr4-pump.yaml");
const r4Board = loadBoard(R4_BOARD_DIR);
const r4RawConfig = fs.readFileSync(R4_CONFIG_PATH, "utf-8");
const r4Topology = parseTopology(parseYaml(r4RawConfig));
const r4Manifest = topologyToManifestForController(r4Topology, r4Topology.controllers[0]?.id ?? 'default');
const r4Validation = validateAll(r4Topology, r4Manifest, r4Board);
const r4Files = await generateAll(r4Manifest, r4Board, 'test-site', undefined, createTestMetadata(), {});
const r4FileMap = new Map(r4Files.map((f) => [f.relativePath, f.content]));

function getR4File(suffix: string): string {
  for (const [key, content] of r4FileMap) {
    if (key.endsWith(suffix)) return content;
  }
  throw new Error(`No BASICR4 generated file ending with "${suffix}"`);
}

// --- Board definition ---

console.log("Board definition:");
assert(r4Board.model === "sonoff-basicr4", `Board model = ${r4Board.model}`);
assert(r4Board.pins.length === 2, `${r4Board.pins.length} exposed pins`);
assert(r4Board.mcu.variant === "esp32c3", `MCU variant = ${r4Board.mcu.variant}`);
assert(r4Board.mcu.flash_size === "4MB", `Flash size = ${r4Board.mcu.flash_size}`);
assert(!!r4Board.peripherals.led, "Has LED peripheral");
assert(!r4Board.peripherals.oled, "No OLED");
assert(!r4Board.peripherals.ethernet, "No Ethernet");
assert(!r4Board.expanders, "No expanders");

// --- Validation ---

console.log("\nManifest validation:");
assert(r4Validation.ok, "Manifest passes validation");
assert(r4Validation.errors.length === 0, "No validation errors");

// --- Board package ---

console.log("\nBoard package:");
const r4BoardPkg = getR4File("common/board.yaml");
assert(r4BoardPkg.includes("esp32c3"), "MCU variant = esp32c3");
assert(r4BoardPkg.includes("esp-idf"), "Framework = esp-idf");
assert(r4BoardPkg.includes("led_output"), "Has LED output");
assert(r4BoardPkg.includes("wifi:"), "Has wifi: section");
assert(r4BoardPkg.includes("wifi_dbm"), "Has WiFi signal sensor");
assert(!r4BoardPkg.includes("ethernet:"), "No ethernet: section");
assert(!r4BoardPkg.includes("pcf8574:"), "No PCF8574 expanders");
assert(!r4BoardPkg.includes("display:"), "No OLED display block");

// --- Hardware ---

console.log("\nHardware:");
const r4Hw = getR4File("hardware.yaml");
assert(r4Hw.includes("pump_relay"), "Has pump relay");
assert(r4Hw.includes("GPIO4"), "Pump relay uses GPIO4");

// --- Sensors ---

console.log("\nSensors:");
const r4Sensors = getR4File("sensors.yaml");
assert(r4Sensors.includes("id: flow1"), "Flow sensor defined");
assert(r4Sensors.includes("GPIO5"), "Flow sensor uses GPIO5");

// --- Device YAML ---

console.log("\nDevice YAML:");
const r4DeviceYaml = getR4File("sonoff-pump.yaml");
assert(r4DeviceYaml.includes("name: ${device_name}"), "ESPHome name sub");
assert(!r4DeviceYaml.includes("display:"), "No OLED display (board has no OLED)");
assert(r4DeviceYaml.includes("switch.turn_off"), "Boot turns off pump relay");

// --- Remote nodes (cross-controller) ---

console.log("\nRemote node support:");

const crossControllerTopology = parseTopology({
  schema: 16,
  controllers: [
    { id: 'pump-ctrl', friendlyName: 'Pump Controller', board: 'heltec-v3' },
    { id: 'tank-ctrl', friendlyName: 'Tank Controller', board: 'heltec-v3' },
  ],
  timing: { valve_travel_time: 15, flow_watchdog: 30, flow_confirm: 5, flow_threshold: 0.5 },
  nodes: [
    // Tank Controller nodes
    { kind: 'tank', id: 'src_tank', name: 'Source Tank', level_monitored: true, pressure_pin: 'GPIO1', pressure_sensor_max_psi: 15, ports: [{ id: 'outlet', label: 'Outlet', direction: 'outlet' }], position: { x: 0, y: 0 }, anchorId: 'tank-ctrl' },
    { kind: 'tank', id: 'dst_tank', name: 'Dest Tank', level_monitored: true, pressure_pin: 'GPIO2', pressure_sensor_max_psi: 15, ports: [{ id: 'inlet', label: 'Inlet', direction: 'inlet' }], position: { x: 0, y: 0 }, anchorId: 'tank-ctrl' },
    // Pump Controller nodes
    { kind: 'pump', id: 'pump1', name: 'Pump', pin: 'GPIO4', relay_polarity: 'active_low', ports: [{ id: 'in', label: 'In', direction: 'inlet' }, { id: 'out', label: 'Out', direction: 'outlet' }], position: { x: 0, y: 0 }, anchorId: 'pump-ctrl' },
    { kind: 'flow_sensor', id: 'flow1', name: 'Main Flow', pin: 'GPIO5', ports: [{ id: 'inlet', label: 'Inlet', direction: 'inlet' }, { id: 'outlet', label: 'Outlet', direction: 'outlet' }], position: { x: 0, y: 0 }, anchorId: 'pump-ctrl' },
    { kind: 'valve', id: 'valve1', name: 'Main Valve', open_pin: 'GPIO6', close_pin: 'GPIO7', coil_polarity: 'active_low', ports: [{ id: 'inlet', label: 'Inlet', direction: 'inlet' }, { id: 'outlet', label: 'Outlet', direction: 'outlet' }], position: { x: 0, y: 0 }, anchorId: 'pump-ctrl' },
  ],
  pipes: [
    { id: 'p1', from: 'src_tank:outlet', to: 'pump1:in' },
    { id: 'p2', from: 'pump1:out', to: 'flow1:inlet' },
    { id: 'p3', from: 'flow1:outlet', to: 'valve1:inlet' },
    { id: 'p4', from: 'valve1:outlet', to: 'dst_tank:inlet' },
  ],
  remoteImports: [
    { controllerId: 'pump-ctrl', nodeId: 'src_tank' },
    { controllerId: 'pump-ctrl', nodeId: 'dst_tank' },
  ],
});

// Manifest for pump-ctrl (owns the route because flow sensor is anchored here)
const pumpManifest = topologyToManifestForController(crossControllerTopology, 'pump-ctrl');
const srcTank = pumpManifest.imports.find(n => n.id === 'src_tank');
const dstTank = pumpManifest.imports.find(n => n.id === 'dst_tank');
const flowNode = pumpManifest.nodes.find(n => n.id === 'flow1');
const pumpNode = pumpManifest.nodes.find(n => n.id === 'pump1');

assert(!!srcTank, "Remote source tank included in pump-ctrl manifest");
assert(!!dstTank, "Remote dest tank included in pump-ctrl manifest");
assert(!!flowNode, "Local flow sensor included in pump-ctrl manifest");
assert(!!pumpNode, "Local pump included in pump-ctrl manifest");
assert(srcTank?.remoteSourceRef === 'src_tank', "Remote src tank marked with its cross-controller source ref (ri_<id> key): got " + srcTank?.remoteSourceRef);
assert(dstTank?.remoteSourceRef === 'dst_tank', "Remote dst tank marked with its cross-controller source ref (ri_<id> key): got " + dstTank?.remoteSourceRef);
assert(!flowNode?.remoteSourceRef, "Local flow sensor has no remote source ref");
assert(!pumpNode?.remoteSourceRef, "Local pump has no remote source ref");

// Collect: remote tanks emit UDP-fed template sensors (ri_<id>). Cross-controller
// reads ride UDP now (coordination publishes into these), not a homeassistant: import.
const pumpCollect = collectEntityCodegen(pumpManifest, board, {});
assert(
  pumpCollect.sections['sensor']?.some(y => y.includes('id: ri_src_tank') && y.includes('platform: template')),
  "Remote src tank emits UDP-fed template sensor (ri_src_tank)"
);
assert(
  pumpCollect.sections['sensor']?.some(y => y.includes('id: ri_dst_tank') && y.includes('platform: template')),
  "Remote dst tank emits UDP-fed template sensor (ri_dst_tank)"
);

// Routes: remote tanks should use ri_ prefix in get_tank_level
const pumpRoutes = generateMajiControlConfig(pumpManifest);
assert(pumpRoutes.includes('ri_src_tank'), "route-engine binds ri_src_tank for remote tank level");
assert(pumpRoutes.includes('ri_dst_tank'), "route-engine binds ri_dst_tank for remote tank level");

// Local hardware should still be generated for pump-ctrl's own nodes
assert(pumpCollect.switches.some(y => y.includes('pump1_relay')), "Local pump1 relay generated");
assert(pumpCollect.sensors.some(y => y.includes('id: flow1')), "Local flow sensor generated");

// =============================================================================
// Automations are runtime data, not baked — the manifest carries none
// =============================================================================

console.log("\nAutomations (runtime engine, not baked):");

// A topology that still carries legacy in-topology automations. Post-cutover they
// are IGNORED by codegen — automations live in the `automations` collection and reach
// the device as a retained runtime set handled by the maji_automations component. The
// manifest must carry none, so no baked schedule / enable switches / dashboard toggles.
const scheduledTopo = parseTopology({
  ...pumpedPressureTopology(true, true),
  automations: [
    { id: 'auto_time1', name: 'Morning Fill', route: 'source_tank>dest_tank#route_valve',
      trigger: { type: 'time', at: '06:00' }, days_of_week: ['MON', 'WED', 'FRI'], enabled: true },
    { id: 'auto_lvl1', name: 'Top Up', route: 'source_tank>dest_tank#route_valve',
      trigger: { type: 'level' }, days_of_week: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'], enabled: true },
  ],
});

const schedManifest = topologyToManifestForController(scheduledTopo, 'pressure-runtime');
const schedFiles = await generateAll(schedManifest, board, 'sched-site', undefined, createTestMetadata(), {});
const schedMap = new Map(schedFiles.map((f) => [f.relativePath, f.content]));
const getSched = (suffix: string): string => {
  for (const [k, v] of schedMap) if (k.endsWith(suffix)) return v;
  throw new Error(`No generated file ending with "${suffix}"`);
};
const mqttYamlSched = getSched("mqtt.yaml");

assert(!("automations" in schedManifest), "manifest has no automations field (collection-managed now)");
assert(![...schedMap.keys()].some((k) => k.endsWith("schedule.yaml")), "no baked schedule.yaml is emitted");
assert([...schedMap.keys()].some((k) => k.endsWith("automation-engine.yaml")), "automation-engine package is emitted");
assert(![...schedMap.keys()].some((k) => k.endsWith("automation-engine.h")), "no automation-engine.h header is emitted (logic moved to the maji_automations component)");
const autoYamlSched = getSched("automation-engine.yaml");
assert(autoYamlSched.includes("maji_automations:") && /route_set_version:\s*\d+/.test(autoYamlSched),
  "automation-engine.yaml configures maji_automations with a baked route_set_version");

let mqttOk = true; try { parseYaml(mqttYamlSched); } catch { mqttOk = false; }
assert(mqttOk, "mqtt.yaml is valid YAML");
// The baked schedule used to declare sntp_time; mqtt.yaml now emits the single one
// unconditionally (the engine's time triggers + the command-TTL gate need it).
assert((mqttYamlSched.match(/id: sntp_time/g) ?? []).length === 1, "mqtt: exactly one sntp_time, emitted unconditionally");
assert(mqttYamlSched.includes("id(autos).apply_set"), "mqtt: subscribes to the retained automation set");
assert(!mqttYamlSched.includes("auto_time1_enabled"), "mqtt: no baked automation enable-switch dispatch");

// config_set is LOCAL-LANE-ONLY (on-device dashboard): the MQTT lane keeps remote
// config server-mediated via the retained /config message (migration 37). The MQTT
// command handler must NOT dispatch a config_set action — one arriving on MQTT
// falls to the unknown-action gate.
assert(!mqttYamlSched.includes('strcmp(action, "config_set")'), "mqtt: no config_set command handler (local-lane-only action)");
// The retained /config handler applies each enumerated number from the `config` kv:
// only when present + numeric (a partial config never zeroes an unlisted key), and
// clamped to the tunable's min/max — the SAME clamp the local config_set lane emits,
// so one value converges identically on both lanes (route_0_source_min_pct: 0..100).
assert(
  mqttYamlSched.includes('auto cfg = x["config"];') &&
    mqttYamlSched.includes('cfg["route_0_source_min_pct"].is<float>()') &&
    mqttYamlSched.includes('id(route_0_source_min_pct).make_call().set_value(v < 0 ? 0 : (v > 100 ? 100 : v)).perform()'),
  "mqtt: /config handler applies the matching route setpoint from the config kv, clamped like config_set",
);
// The opaque server version round-trips: stored verbatim (never hashed on-device) and
// re-reported as the snapshot text `config_version`.
assert(
  mqttYamlSched.includes('id(autos).set_config_version(version)') &&
    mqttYamlSched.includes('\\"config_version\\":'),
  "mqtt: stores the opaque config version and round-trips it as config_version",
);
// Snapshot echo: the setpoint number's live value rides the snapshot readings
// under its kv key (the app shadow shows current values with no separate read path).
assert(mqttYamlSched.includes('\\"route_0_source_min_pct\\":%g'), "mqtt: setpoint value published in the snapshot readings");

// Telemetry: no baked automation enable channels.
const schedChannels = collectTelemetryChannels(schedManifest);
assert(
  !schedChannels.some((c) => c.sensor.startsWith("auto_") && c.sensor.endsWith("_enabled")),
  "telemetry: no baked automation enable channels",
);

// Dashboard spec: no baked automation controls; route level setpoints surface as tunables.
const schedSpec = buildDashboardSpec(scheduledTopo);
const schedCtrl = schedSpec.controllers[0];
assert(!("automations" in schedCtrl), "dashboard: no baked automation controls (managed on the automations page)");
assert(
  schedCtrl.tunables.some((t) => t.key === "route_0_source_min_pct" && t.field === "source_min_pct"),
  "dashboard: route source-min exposed as a tunable",
);

// --- Summary ---

console.log(`\n${"=".repeat(40)}`);
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
};
void main();
