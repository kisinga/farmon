/**
 * Route capability owner + read-model.
 *
 * Asserts the single capability predicate behaves correctly across the topologies
 * the adversarial review flagged (gravity-to-float, pump-to-open-endpoint, shared
 * meter, float+level precedence, meter-only-no-actuator, no-sensor), and that the
 * read-model is a pure overlay that never reorders or drops routes (the firmware
 * route-id is positional, so order/membership must be invariant to capability).
 *
 * Usage: npx tsx test/route-capabilities.test.ts
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse as parseYaml } from 'yaml';
import {
  parseTopology, buildGraph, deriveRoutes, routeCapabilities,
  manifestRouteCapabilities, topologyToManifestForController, SiteModel,
  type Route, type TopologyNode, type SiteTopology,
} from '@core';

let passed = 0;
let failed = 0;
function assert(condition: boolean, name: string, detail?: string) {
  if (condition) { console.log(`  ✓ ${name}`); passed++; }
  else { console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); failed++; }
}

// ── Fixtures ────────────────────────────────────────────────────────────────

function tank(
  id: string,
  opts: { level?: boolean; float?: boolean; pumpRated?: boolean; capacity?: number } = {},
): TopologyNode {
  return {
    kind: 'tank', id, name: id,
    level_monitored: !!opts.level, float_valve: !!opts.float,
    pressure_pump_rated: !!opts.pumpRated, capacity_l: opts.capacity,
  } as unknown as TopologyNode;
}
function sink(id: string): TopologyNode { return { kind: 'endpoint', id, name: id } as unknown as TopologyNode; }
function src(id: string): TopologyNode { return { kind: 'water_source', id, name: id } as unknown as TopologyNode; }

function lookup(nodes: TopologyNode[]): (id: string) => TopologyNode | undefined {
  const m = new Map(nodes.map((n) => [n.id, n]));
  return (id) => m.get(id);
}

function mkRoute(p: Partial<Route> & { key: string; source: string; destination: string }): Route {
  const flowSensors = p.flowSensors ?? [];
  return {
    key: p.key,
    source: p.source,
    sourceKind: p.sourceKind ?? 'tank',
    destination: p.destination,
    destKind: p.destKind ?? 'endpoint',
    nodeSequence: p.nodeSequence ?? [p.source, p.destination],
    valves: p.valves ?? [],
    flowSensors,
    monitored: p.monitored ?? flowSensors.length > 0,
    crossesPump: p.crossesPump ?? false,
    pumpIndex: p.pumpIndex ?? (p.crossesPump ? 1 : -1),
  };
}

console.log('Route capabilities');
console.log('==================\n');

// S1: gravity valve -> float-valve tank, WITH meter.
{
  const nodes = [tank('src'), tank('T', { float: true })];
  const r = mkRoute({ key: 'src>T#v1', source: 'src', destination: 'T', destKind: 'tank', valves: ['v1'], flowSensors: ['fs'] });
  const c = routeCapabilities(r, lookup(nodes));
  assert(c.runKind === 'valve' && c.runnable, 'S1 gravity+float: runnable as a valve');
  assert(c.metered && c.trackable, 'S1: metered + trackable');
  assert(c.stallDisposition === 'full', 'S1: stall reads as full (float valve)');
  assert(c.canStopOnFull, 'S1: can stop on full (meter + float)');
  assert(c.targets.volume.available, 'S1: volume target offered');
  assert(!c.targets.level.available, 'S1: level target not offered (no level sensor)');
}

// S2: gravity valve -> float-valve tank, WITHOUT a meter (the known limitation).
{
  const nodes = [tank('src'), tank('T', { float: true })];
  const r = mkRoute({ key: 'src>T#v1', source: 'src', destination: 'T', destKind: 'tank', valves: ['v1'] });
  const c = routeCapabilities(r, lookup(nodes));
  assert(!c.metered && !c.trackable, 'S2 float, no meter: not metered, not trackable');
  assert(c.stallDisposition === 'n/a', 'S2: no stall detection without a meter');
  assert(!c.canStopOnFull, 'S2: cannot DETECT full without a meter (float caps it mechanically)');
  assert(!c.targets.volume.available && c.targets.volume.reason === 'needs a flow meter', 'S2: volume blocked: needs a meter');
}

// S3: pump -> open (non-tank) endpoint, metered. The bug-origin shape.
{
  const nodes = [tank('src'), sink('zone')];
  const r = mkRoute({ key: 'src>zone', source: 'src', destination: 'zone', destKind: 'endpoint', crossesPump: true, flowSensors: ['fs'] });
  const c = routeCapabilities(r, lookup(nodes));
  assert(c.runKind === 'pump' && c.runnable, 'S3 pump->open endpoint: runnable as a pump');
  assert(c.stallDisposition === 'flowLost', 'S3: stall reads as flow lost (no float, no level)');
  assert(!c.canStopOnFull, 'S3: cannot stop on full (open endpoint)');
  assert(c.targets.volume.available, 'S3: volume target IS offered on the metered open endpoint (bug fixed)');
}

// S4: pump -> tank that is BOTH float-fitted and level-monitored (pump-rated).
//     Level measurement must win over the float-stall inference.
{
  const nodes = [tank('src'), tank('T', { level: true, float: true, pumpRated: true })];
  const r = mkRoute({ key: 'src>T', source: 'src', destination: 'T', destKind: 'tank', crossesPump: true, flowSensors: ['fs'] });
  const c = routeCapabilities(r, lookup(nodes));
  assert(c.runtimeLevelOk, 'S4: level trusted under pump (pump-rated sensor)');
  assert(c.stallDisposition === 'levelAuthoritative', 'S4 float+level: level wins over float');
  assert(c.canStopOnFull, 'S4: can stop on full (level)');
  assert(c.targets.level.available && c.targets.volume.available, 'S4: both level and volume offered');
}

// S5: meter sharing — routes sharing a meter are mutually exclusive (conflict_mask),
// so a metered route always offers volume regardless of a meter-sharing sibling
// (the two House-2-style routes from different sources each get a volume target).
{
  const nodes = [tank('A'), sink('House2')];
  // A metered route to House 2 from source A; a sibling B>House2 shares the meter,
  // but shared meters are mutually exclusive (conflict_mask), so volume is offered.
  const a = mkRoute({ key: 'A>House2', source: 'A', destination: 'House2', destKind: 'endpoint', crossesPump: true, flowSensors: ['fs'] });
  const c = routeCapabilities(a, lookup(nodes));
  assert(c.targets.volume.available, 'S5 shared meter, same endpoint: volume STILL offered (routes are mutually exclusive)');
}

// S6: meter-only pipe — a flow sensor but no actuator.
{
  const nodes = [tank('src'), sink('outlet')];
  const r = mkRoute({ key: 'src>outlet', source: 'src', destination: 'outlet', destKind: 'endpoint', flowSensors: ['fs'] });
  const c = routeCapabilities(r, lookup(nodes));
  assert(c.runKind === 'none' && !c.runnable, 'S6 meter-only: not runnable (no actuator)');
  assert(c.trackable, 'S6: still trackable (has a meter)');
  assert(!c.targets.duration.available && !c.targets.volume.available, 'S6: no run targets when not runnable');
}

// S7: valve, no sensor, unmonitored tank — time-only.
{
  const nodes = [tank('src'), tank('T')];
  const r = mkRoute({ key: 'src>T#v1', source: 'src', destination: 'T', destKind: 'tank', valves: ['v1'] });
  const c = routeCapabilities(r, lookup(nodes));
  assert(c.runnable && !c.trackable, 'S7 valve, no sensor: runnable but not trackable');
  assert(c.stallDisposition === 'n/a', 'S7: no stall detection');
  assert(c.targets.duration.available && !c.targets.volume.available && !c.targets.level.available, 'S7: duration only');
}

// ── Order invariance: the read-model is a pure overlay over deriveRoutes ───────
{
  const DEFAULTS = path.resolve(new URL('.', import.meta.url).pathname, '..', 'defaults');
  const CONFIG_PATH = path.join(DEFAULTS, 'configs/pump-controller.yaml');
  const topology = parseTopology(parseYaml(fs.readFileSync(CONFIG_PATH, 'utf-8'))) as SiteTopology;

  const baseKeys = deriveRoutes(buildGraph(topology.nodes, topology.pipes)).map((r) => r.key);
  const model = SiteModel.fromTopology(topology);
  const modelKeys = model.routes.map((r) => r.key);

  assert(baseKeys.length > 0, 'order-invariance: defaults topology derives routes', String(baseKeys.length));
  assert(
    modelKeys.length === baseKeys.length && modelKeys.every((k, i) => k === baseKeys[i]),
    'order-invariance: model routes match deriveRoutes order + membership exactly',
    `${modelKeys.join(',')} vs ${baseKeys.join(',')}`,
  );

  // The graph adapter and the manifest adapter must agree on every shared route,
  // so the app/codegen (manifest-based) never diverges from SiteModel (topology-based).
  const controllerId = topology.controllers[0]?.id ?? 'default';
  const manifest = topologyToManifestForController(topology, controllerId);
  const byKey = new Map(model.routes.map((r) => [r.key, r]));
  let compared = 0;
  let disagreed = 0;
  for (const mr of manifest.routes) {
    const gm = byKey.get(mr.key);
    if (!gm) continue;
    compared++;
    const mc = manifestRouteCapabilities(mr);
    const agree =
      mc.runnable === gm.caps.runnable &&
      mc.metered === gm.caps.metered &&
      mc.canStopOnFull === gm.caps.canStopOnFull &&
      mc.stallDisposition === gm.caps.stallDisposition &&
      mc.targets.volume.available === gm.caps.targets.volume.available &&
      mc.targets.level.available === gm.caps.targets.level.available &&
      mc.targets.duration.available === gm.caps.targets.duration.available;
    if (!agree) disagreed++;
  }
  assert(compared > 0, 'adapter agreement: shared routes compared', String(compared));
  assert(disagreed === 0, 'adapter agreement: graph and manifest adapters agree on every shared route', `${disagreed}/${compared} disagreed`);
}

console.log(`\n${'='.repeat(40)}`);
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
