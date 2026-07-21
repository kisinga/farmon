/**
 * Local panel buttons (route→button mapping) — pins the emitted YAML for the
 * default auto-assign (Stop All on IN1, routes after it, toggle lambdas),
 * the explicit local.buttons override, the stop-all backfill, and boards
 * without input expanders (no emission).
 *
 * Usage: npx tsx test/local-inputs.test.ts
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import { parseTopology, topologyToManifestForController, boardInputPins, resolveButtonAssignments } from "@core";
import { hasLocalInputs } from "../src/lib/local-buttons";
import { generateAll, createTestMetadata, generateLocalInputs } from "@core/codegen";
import { assembleSiteDoc } from "@core/docs";
import { makeAsserter, loadBoard } from "./helpers";

const { assert, done } = makeAsserter();

const ROOT = path.resolve(new URL(".", import.meta.url).pathname, "..");
const KC868_DIR = path.join(ROOT, "defaults", "boards", "kc868-a16");
const HELTEC_DIR = path.join(ROOT, "defaults", "boards", "heltec-v3");
const KC868_CONFIG = path.join(ROOT, "defaults", "configs", "kc868-a16-controller.yaml");

const kc868 = loadBoard(KC868_DIR);
const heltec = loadBoard(HELTEC_DIR);

const topology = parseTopology(parseYaml(fs.readFileSync(KC868_CONFIG, "utf-8")));
const manifest = topologyToManifestForController(topology, topology.controllers[0].id);
const routeKey = manifest.routes[0].key;

// --- Board input pins --------------------------------------------------------

assert(boardInputPins(kc868).length === 16, "kc868-a16 exposes 16 input-expander pins");
assert(boardInputPins(kc868)[0] === "IN1" && boardInputPins(kc868)[15] === "IN16", "input pins in board order (IN1..IN16)");
assert(boardInputPins(heltec).length === 0, "heltec-v3 has no input expanders");

// --- Resolver: default auto-assign -------------------------------------------

{
  const routes = [
    { key: "a", name: "Route A" },
    { key: "b", name: "Route B" },
    { key: "c", name: "Route C" },
  ];
  const pins = ["IN1", "IN2", "IN3", "IN4"];
  const a = resolveButtonAssignments(routes, pins, undefined);
  assert(a.length === 4, "default: stop-all + every route fits");
  assert(a[0].action === "stop_all" && a[0].input === "IN1", "default: Stop All is the FIRST button (IN1)");
  assert(a[1].routeIndex === 0 && a[1].input === "IN2", "default: route 0 on IN2");
  assert(a[2].routeIndex === 1 && a[2].input === "IN3", "default: route 1 on IN3");
  assert(a[3].routeIndex === 2 && a[3].input === "IN4", "default: route 2 on the next input");

  const overflow = resolveButtonAssignments(routes, ["IN1", "IN2"], undefined);
  assert(overflow.length === 2 && overflow[1].routeIndex === 0, "default: routes beyond the input count are dropped");
}

// --- Resolver: explicit mapping + stop-all backfill --------------------------

{
  const routes = [{ key: "a", name: "Route A" }];
  const pins = ["IN1", "IN2", "IN3"];

  const explicit = resolveButtonAssignments(routes, pins, {
    buttons: [{ input: "IN3", action: "route_start", route: "a" }],
  });
  assert(explicit.length === 2, "explicit: mapped route + backfilled stop-all");
  assert(explicit[0].input === "IN3" && explicit[0].routeIndex === 0, "explicit: route on the chosen input");
  assert(explicit[1].action === "stop_all" && explicit[1].input === "IN1", "explicit: stop-all backfilled on IN1");

  const in1Taken = resolveButtonAssignments(routes, pins, {
    buttons: [{ input: "IN1", action: "route_start", route: "a" }],
  });
  assert(in1Taken.length === 2, "explicit: IN1 taken by a route still backfills stop-all");
  assert(in1Taken[1].action === "stop_all" && in1Taken[1].input === "IN2", "explicit: stop-all backfilled on the first UNASSIGNED input (IN2) when IN1 is taken");

  const empty = resolveButtonAssignments(routes, pins, { buttons: [] });
  assert(empty.length === 2 && empty[0].action === "stop_all", "explicit empty mapping falls back to the default");

  const unknown = resolveButtonAssignments(routes, pins, {
    buttons: [{ input: "IN3", action: "route_start", route: "nope" }],
  });
  assert(!unknown.some(x => x.action === "route_start"), "explicit: unresolvable route key dropped");
}

// --- Schema: route_start requires a route -------------------------------------

{
  const raw = parseYaml(fs.readFileSync(KC868_CONFIG, "utf-8")) as Record<string, unknown>;
  (raw.controllers as Array<Record<string, unknown>>)[0].local = {
    buttons: [{ input: "IN5", action: "route_start" }], // route omitted
  };
  let threw = false;
  try {
    parseTopology(raw);
  } catch {
    threw = true;
  }
  assert(threw, "schema: route_start without route is rejected (not silently dropped)");

  const ok = parseYaml(fs.readFileSync(KC868_CONFIG, "utf-8")) as Record<string, unknown>;
  (ok.controllers as Array<Record<string, unknown>>)[0].local = {
    buttons: [{ input: "IN5", action: "stop_all" }],
  };
  assert(!!parseTopology(ok), "schema: stop_all without route stays valid");
}

// --- Generator: default emission (kc868) -------------------------------------

{
  const yaml = generateLocalInputs(manifest, kc868);
  assert(yaml !== null, "generator emits for a board with input expanders");
  const y = yaml!;
  assert(y.includes("binary_sensor:"), "emits a binary_sensor section");
  assert(y.includes("id: panel_btn_in1"), "Stop All sensor on IN1");
  assert(y.includes("id: panel_btn_in2"), "route sensor on IN2");
  assert(y.includes("pcf8574: pcf8574_in_1"), "input expander referenced in the pin block");
  assert(/mode:\s*INPUT/.test(y), "pin mode INPUT");
  assert(/inverted:\s*true/.test(y), "pin inverted (active-low optocoupler)");
  assert(y.includes("- button.press: btn_stop_all"), "Stop All presses btn_stop_all");
  assert(!y.includes("button.press: route_0_start"), "route button is NOT a plain press (it is a toggle)");
  assert(y.includes("- delayed_on_off: 50ms"), "button sensors carry a 50ms debounce (mechanical bounce would double-fire the toggle)");
  assert(y.includes("maji_ctl::find_slot_by_route(cs, 0)"), "toggle lambda reads the route's slot");
  assert(y.includes("cs.slots[s].state >= maji_ctl::ST_PREPARING && cs.slots[s].state <= maji_ctl::ST_STOPPING"), "toggle range uses the kernel enum names, not magic numbers");
  assert(y.includes("cs.slots[s].state == maji_ctl::ST_FAULT"), "toggle detects the FAULT slot state by enum name");
  assert(y.includes("id(control).reset_faults();"), "a press on a FAULTed route clears faults (two-press: clear, then start)");
  assert(y.includes('id(control).start_route(0, "", maji_ctl::StopSpec{}, maji_ctl::ORIGIN_MANUAL, "");'), "toggle starts an idle route");
  assert(y.includes('id(control).stop_route(0, "", maji_ctl::ORIGIN_MANUAL, "");'), "toggle stops an active route");
  assert(y.includes("id(system_state) = id(control).system_state();"), "toggle copies engine status into globals");
}

// --- Generator: explicit override flows topology → manifest → YAML -----------

{
  const raw = parseYaml(fs.readFileSync(KC868_CONFIG, "utf-8")) as Record<string, unknown>;
  (raw.controllers as Array<Record<string, unknown>>)[0].local = {
    buttons: [{ input: "IN5", action: "route_start", route: routeKey }],
  };
  const topo = parseTopology(raw);
  const m = topologyToManifestForController(topo, topo.controllers[0].id);
  assert(m.device.local?.buttons?.length === 1, "local.buttons threads topology → manifest");

  const y = generateLocalInputs(m, kc868)!;
  assert(y.includes("id: panel_btn_in5"), "explicit: route button on IN5");
  assert(!y.includes("id: panel_btn_in2"), "explicit: default inputs not emitted");
  assert(y.includes("id: panel_btn_in1") && y.includes("- button.press: btn_stop_all"), "explicit: stop-all backfilled on IN1");
  assert(y.includes("number: 4"), "IN5 resolves to expander port 4");
}

// async main: generateAll is async (manifest-driven local-UI assets).
const main = async () => {
// --- Generator: board without input expanders emits nothing ------------------

{
  const heltecTopology = parseTopology(parseYaml(fs.readFileSync(path.join(ROOT, "defaults", "configs", "pump-controller.yaml"), "utf-8")));
  const heltecManifest = topologyToManifestForController(heltecTopology, heltecTopology.controllers[0].id);
  assert(generateLocalInputs(heltecManifest, heltec) === null, "no emission without input expanders");
  assert(hasLocalInputs(heltecManifest, heltec) === false, "predicate: false without input expanders");
  assert(hasLocalInputs(manifest, kc868) === true, "predicate: true for the kc868 manifest (gates the device-YAML include)");

  const files = await generateAll(heltecManifest, heltec, "test-site", undefined, createTestMetadata(), {});
  assert(!files.some(f => f.relativePath.endsWith("local-inputs.yaml")), "no local-inputs.yaml in the bundle");
  const deviceYaml = files.find(f => f.relativePath.endsWith(".yaml") && !f.relativePath.includes("packages/") && !f.relativePath.includes("common/"))!;
  assert(!deviceYaml.content.includes("local_inputs"), "device YAML skips the package include");
}

// --- Bundle wiring (kc868) ----------------------------------------------------

{
  const files = await generateAll(manifest, kc868, "test-site", undefined, createTestMetadata(), {});
  const pkg = files.find(f => f.relativePath.endsWith("packages/local-inputs.yaml"));
  assert(!!pkg, "bundle carries packages/local-inputs.yaml");
  assert(pkg!.content.includes("internal: true"), "button sensors internalized (no MQTT auto-publish)");
  const deviceYaml = files.find(f => f.relativePath.endsWith(".yaml") && !f.relativePath.includes("packages/") && !f.relativePath.includes("common/"))!;
  assert(deviceYaml.content.includes("local_inputs: !include packages/local-inputs.yaml"), "device YAML includes the package");
}

// --- Site manual: Panel Buttons table ----------------------------------------

(async () => {
  const html = await assembleSiteDoc({
    siteName: "Test Site",
    topo: topology,
    diagrams: { composite: "", controllers: {} },
    boards: { "kc868-a16": kc868 },
    docs: [],
  });
  assert(html.includes("Panel Buttons"), "manual carries a Panel Buttons table");
  assert(html.includes("<td>Button 1</td><td><code>IN1</code></td><td>Stop All</td>"), "manual: Button 1 = Stop All on IN1");
  assert(html.includes("Start / stop"), "manual: route buttons shown as toggles");

  // Explicit out-of-order mapping (route on IN5, stop-all backfilled on IN1):
  // rows must sort by physical input order, not declaration order.
  const raw = parseYaml(fs.readFileSync(KC868_CONFIG, "utf-8")) as Record<string, unknown>;
  (raw.controllers as Array<Record<string, unknown>>)[0].local = {
    buttons: [{ input: "IN5", action: "route_start", route: routeKey }],
  };
  const explicitHtml = await assembleSiteDoc({
    siteName: "Test Site",
    topo: parseTopology(raw),
    diagrams: { composite: "", controllers: {} },
    boards: { "kc868-a16": kc868 },
    docs: [],
  });
  assert(explicitHtml.includes("<td>Button 1</td><td><code>IN1</code></td><td>Stop All</td>"), "manual (explicit): backfilled stop-all sorts to Button 1 (IN1)");
  assert(explicitHtml.includes("<td>Button 2</td><td><code>IN5</code></td><td>Start / stop"), "manual (explicit): route button follows in input order (IN5 = Button 2)");
  done();
})();
};
void main();
