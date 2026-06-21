/**
 * Easy Mode composer tests — run the worked examples from
 * docs/development/easy-mode-onboarding-spec.md end to end and assert the
 * generated topology validates and fits one KC868-A16.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  parseBoardDef, composeEasyMode, estimateSystem, topologyToManifestForController, parseTopology,
  createBoardDriver, planWateringAutomations, renderTopologySvg, NODE_REGISTRY, toStoredTopology,
  type EasyModeProfile, type ComposeResult, type RuleDiagnostic, type Vertical, type SourceKind,
} from '@core';

const ROOT = path.resolve(new URL('.', import.meta.url).pathname, '..');
const board = parseBoardDef(JSON.parse(
  fs.readFileSync(path.join(ROOT, 'defaults/boards/kc868-a16/board.json'), 'utf-8'),
));

let passed = 0, failed = 0;
function assert(cond: boolean, name: string, detail?: string) {
  if (cond) { console.log(`  ✓ ${name}`); passed++; }
  else { console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); failed++; }
}

const errors = (r: ComposeResult): RuleDiagnostic[] => r.diagnostics.filter(d => d.severity === 'error');
const kinds = (r: ComposeResult) => {
  const c: Record<string, number> = {};
  for (const n of r.topology?.nodes ?? []) c[n.kind] = (c[n.kind] ?? 0) + 1;
  return c;
};
function report(label: string, r: ComposeResult) {
  const b = r.budget;
  console.log(`    ${label}: ${b.relays}/16 relays, ${b.analog}/4 analog, ${b.pulse}/3 pulse | nodes ${JSON.stringify(kinds(r))}${r.handoff ? ` | handoff=${r.handoff}` : ''}`);
  if (r.notes.length) for (const n of r.notes) console.log(`      note: ${n}`);
}

function fits(r: ComposeResult): boolean {
  return r.budget.relays <= 16 && r.budget.analog <= 4 && r.budget.pulse <= 3;
}

function check(name: string, profile: EasyModeProfile) {
  const r = composeEasyMode(profile, board);
  report(name, r);
  assert(!!r.topology, `${name}: composes a topology`);
  assert(!r.handoff, `${name}: no handoff`, r.handoff);
  assert(errors(r).length === 0, `${name}: validates clean`, JSON.stringify(errors(r)));
  assert(fits(r), `${name}: fits the board`, JSON.stringify(r.budget));
  return r;
}

console.log('Easy Mode composer');

// 9.1 Farm, borehole, one tank, three fields, pump
const r1 = check('9.1 farm borehole 1-tank 3-zone pump',
  { vertical: 'farm', sources: ['borehole'], tanks: 1, zones: 3, conveyance: 'pump', priority: 'dry_run' });
assert(kinds(r1)['tank'] === 1 && (r1.topology!.nodes.find(n => n.kind === 'tank') as Record<string, unknown>)['level_monitored'] === true,
  '9.1: pump-filled tank is level-monitored');
assert(kinds(r1)['valve'] === 3, '9.1: one valve per field', JSON.stringify(kinds(r1)));

// 9.2 Home, mains, one tank, one house, pump
const r2 = check('9.2 home mains 1-tank 1-house pump',
  { vertical: 'residential', sources: ['mains'], tanks: 1, zones: 1, conveyance: 'pump', priority: 'continuity' });
assert((r2.topology!.nodes.find(n => n.kind === 'tank') as Record<string, unknown>)['level_monitored'] !== true,
  '9.2: mains-filled tank stays passive');
assert(kinds(r2)['valve'] === 1, '9.2: mains fill gets an isolation valve', JSON.stringify(kinds(r2)));

// 9.3 Water business, mains, no tank, three kiosks (per-connection metering)
const r3 = check('9.3 water_business mains no-tank 3-kiosk',
  { vertical: 'water_business', sources: ['mains'], tanks: 0, zones: 3 });
assert(kinds(r3)['flow_sensor'] === 3, '9.3: a meter per kiosk', JSON.stringify(kinds(r3)));
const r3over = composeEasyMode({ vertical: 'water_business', sources: ['mains'], tanks: 0, zones: 4 }, board);
assert(r3over.handoff === 'setup_service', '9.3: a fourth meter exceeds the 3 pulse pins, hands off');

// 9.4 Home, mains + borehole backup, one tank, one house
const r4 = check('9.4 home mains+borehole 1-tank 1-house',
  { vertical: 'residential', sources: ['mains', 'borehole'], tanks: 1, zones: 1, conveyance: 'pump' });
assert(kinds(r4)['water_source'] === 2, '9.4: two supplies', JSON.stringify(kinds(r4)));

// Gravity is honoured: no booster forced
const rg = check('gravity farm 1-tank 2-zone',
  { vertical: 'farm', sources: ['borehole'], tanks: 1, zones: 2, conveyance: 'gravity' });
assert((kinds(rg)['pump'] ?? 0) === 1, 'gravity: only the submersible, no booster', JSON.stringify(kinds(rg)));

// Several tanks come from a composition of group sizes. [n] = one side-by-side
// bank (head monitored, siblings are capacity off the head, no transfer valves);
// [1,1,…] = a cascade through transfer valves; [2,1]/[2,2] = a mix.
const monitoredOf = (r: ComposeResult) => r.topology!.nodes.filter(n => n.kind === 'tank' && (n as Record<string, unknown>)['level_monitored'] === true).length;
const transfersOf = (r: ComposeResult) => r.topology!.nodes.filter(n => n.kind === 'valve' && /Transfer/.test(String((n as Record<string, unknown>)['name']))).length;

const oneBank = check('one bank farm borehole 3-tank 2-zone',
  { vertical: 'farm', sources: ['borehole'], tanks: 3, zones: 2, conveyance: 'pump', tankGroups: [3] });
assert(kinds(oneBank)['tank'] === 3, 'one bank: three tank nodes', JSON.stringify(kinds(oneBank)));
assert(monitoredOf(oneBank) === 1, 'one bank: only the head is monitored (siblings share a level)', String(monitoredOf(oneBank)));
assert(transfersOf(oneBank) === 0, 'one bank: no transfer valves between tanks', String(transfersOf(oneBank)));

const cascade = check('cascade farm borehole 3-tank 2-zone',
  { vertical: 'farm', sources: ['borehole'], tanks: 3, zones: 2, conveyance: 'pump', tankGroups: [1, 1, 1] });
assert(kinds(cascade)['tank'] === 3, 'cascade: three tank nodes', JSON.stringify(kinds(cascade)));
assert(monitoredOf(cascade) === 3, 'cascade: every tank monitored for transfer interlocks', String(monitoredOf(cascade)));
assert(transfersOf(cascade) === 2, 'cascade: a transfer valve per tank pair', String(transfersOf(cascade)));
const cascOv = Object.values(cascade.topology!.route_overrides);
assert(cascOv.some(o => o.dest_max_level === 92) && cascOv.some(o => o.source_min_level === 18),
  'cascade: transfers are level-interlocked (fill cap + draw floor)');

// Mixes: a pair feeding one [2,1], and two pairs in a row [2,2].
const pairOne = check('pair+one farm borehole 3-tank 2-zone',
  { vertical: 'farm', sources: ['borehole'], tanks: 3, zones: 2, conveyance: 'pump', tankGroups: [2, 1] });
assert(kinds(pairOne)['tank'] === 3 && transfersOf(pairOne) === 1, 'pair+one: 3 tanks, one transfer', `${JSON.stringify(kinds(pairOne))} t=${transfersOf(pairOne)}`);
const twoPairs = check('two pairs farm borehole 4-tank 2-zone',
  { vertical: 'farm', sources: ['borehole'], tanks: 4, zones: 2, conveyance: 'pump', tankGroups: [2, 2] });
assert(kinds(twoPairs)['tank'] === 4 && transfersOf(twoPairs) === 1, 'two pairs: 4 tanks, one transfer between banks', `${JSON.stringify(kinds(twoPairs))} t=${transfersOf(twoPairs)}`);

// Custom layout (no recognised groups) seeds a valid starting point but hands off.
const custom = composeEasyMode({ vertical: 'farm', sources: ['borehole'], tanks: 3, zones: 2, conveyance: 'pump' }, board);
assert(custom.handoff === 'expert' && !!custom.topology, 'custom: seeds a topology and hands off to the editor', custom.handoff);
assert(custom.topology!.nodes.filter(n => n.kind === 'tank').length === 3, 'custom: still places all three tanks');

// Tank cap: more than MAX_TANKS hands off to a setup service.
const tooMany = composeEasyMode({ vertical: 'farm', sources: ['borehole'], tanks: 5, zones: 1, conveyance: 'pump', tankGroups: [5] }, board);
assert(tooMany.handoff === 'setup_service', 'gate: more than four tanks hands off to setup');

// Scope gates
const hSetup = composeEasyMode({ vertical: 'farm', sources: ['borehole'], tanks: 1, zones: 9 }, board);
assert(hSetup.handoff === 'setup_service', 'gate: nine zones hands off to setup');
const rMultiNoTank = composeEasyMode({ vertical: 'residential', sources: ['mains', 'borehole'], tanks: 0, zones: 1 }, board);
assert(rMultiNoTank.handoff === 'expert' && rMultiNoTank.topology === null, 'multi-source + no storage hands off (no tank forced against the answer)');

// Estimation harness: callable with no board (the public/pricing side)
const est = estimateSystem({ vertical: 'farm', sources: ['borehole'], tanks: 1, zones: 3, conveyance: 'pump' });
assert(est.fits, 'estimate: fits one controller');
assert(est.budget.relays === 8, 'estimate: relay demand computed without a board', JSON.stringify(est.budget));
assert(est.components.some(c => c.kind === 'valve' && c.count === 3), 'estimate: BOM lists 3 valves', JSON.stringify(est.components));
const estBig = estimateSystem({ vertical: 'farm', sources: ['borehole'], tanks: 1, zones: 9, conveyance: 'pump' });
assert(!estBig.fits && estBig.handoff === 'setup_service', 'estimate: oversized does not fit one controller');
const noBoard = composeEasyMode({ vertical: 'residential', sources: ['mains'], tanks: 1, zones: 1, conveyance: 'pump' });
assert(noBoard.topology !== null && errors(noBoard).length === 0, 'compose(no board): builds, skips pin checks');

// Load round-trip: the saved topology must parse exactly like the editor loads it.
for (const [name, r] of [['9.1', r1], ['9.2', r2], ['9.3', r3], ['9.4', r4]] as const) {
  let ok = false, detail = '';
  try {
    const parsed = parseTopology(JSON.parse(JSON.stringify(r.topology)));
    ok = parsed.controllers.length === 1 && parsed.nodes.length > 0;
    detail = `controllers ${parsed.controllers.length}, nodes ${parsed.nodes.length}`;
  } catch (e) { detail = e instanceof Error ? e.message : String(e); }
  assert(ok, `${name}: round-trips through parseTopology (editor load)`, detail);
}

// Pins must be fully assigned in board mode (quick setup -> firmware, no tinkering).
const pinFieldsMissing = (t: { nodes: Array<Record<string, unknown> & { kind: string; id: string }> }): string[] => {
  const out: string[] = [];
  for (const n of t.nodes) {
    if (n.kind === 'pump' && !n['pin']) out.push(`${n.id}.pin`);
    if (n.kind === 'valve' && (!n['open_pin'] || !n['close_pin'])) out.push(`${n.id}.coils`);
    if (n.kind === 'flow_sensor' && !n['pin']) out.push(`${n.id}.pin`);
    if (n.kind === 'tank' && n['level_monitored'] === true && !n['pressure_pin']) out.push(`${n.id}.pressure_pin`);
  }
  return out;
};
for (const [name, r] of [['9.1', r1], ['9.2', r2], ['9.3', r3], ['9.4', r4]] as const) {
  const miss = pinFieldsMissing(r.topology as never);
  assert(miss.length === 0, `${name}: every node pin is auto-assigned`, miss.join(', '));
}

// Assigned pins must be real channels the editor can resolve (board-driver fqids),
// and the controller must carry a board model. This mirrors what the editor needs
// to show the pins selected instead of "-- transport --".
const channelIds = new Set(createBoardDriver(board).enumerate().map(c => c.fqid));
for (const [name, r] of [['9.1', r1], ['9.2', r2], ['9.3', r3], ['9.4', r4]] as const) {
  const bad: string[] = [];
  for (const n of r.topology!.nodes as Array<Record<string, unknown> & { kind: string; id: string }>) {
    for (const k of ['pin', 'open_pin', 'close_pin', 'pressure_pin']) {
      const v = n[k];
      if (typeof v === 'string' && v && !channelIds.has(v)) bad.push(`${n.id}.${k}=${v}`);
    }
  }
  assert(bad.length === 0, `${name}: assigned pins are valid board channels`, bad.join(', '));
  const ctrlBoard = r.topology!.controllers[0]?.board;
  assert(typeof ctrlBoard === 'string' && ctrlBoard.length > 0, `${name}: controller carries a board model`, String(ctrlBoard));
}

// Firmware path: every composed topology must build a manifest (codegen IR)
// for its controller without throwing, with nodes and at least one route.
for (const [name, r] of [['9.1', r1], ['9.2', r2], ['9.3', r3], ['9.4', r4]] as const) {
  const t = r.topology!;
  let ok = false, detail = '';
  try {
    const m = topologyToManifestForController(t, t.controllers[0].id);
    ok = m.nodes.length > 0 && m.routes.length > 0;
    detail = `nodes ${m.nodes.length}, routes ${m.routes.length}`;
  } catch (e) { detail = e instanceof Error ? e.message : String(e); }
  assert(ok, `${name}: builds a firmware manifest`, detail);
}

// Safe per-route defaults: a level-monitored tank gets a fill cap and a draw floor,
// keyed exactly as topology-to-manifest reads them. A passive (mains-filled) tank
// gets none, since the firmware would ignore an override on a level-less endpoint.
const overrideValues = (r: ComposeResult) => Object.values(r.topology?.route_overrides ?? {});
assert(overrideValues(r1).some(o => o.dest_max_level === 92), '9.1: fill into a level tank caps at 92%', JSON.stringify(r1.topology!.route_overrides));
assert(overrideValues(r1).some(o => o.source_min_level === 18), '9.1: draw from a level tank floors at 18%', JSON.stringify(r1.topology!.route_overrides));
assert(Object.keys(r2.topology!.route_overrides).length === 0, '9.2: passive tank emits no level overrides', JSON.stringify(r2.topology!.route_overrides));
assert(overrideValues(r4).some(o => o.dest_max_level === 92) && overrideValues(r4).some(o => o.source_min_level === 18),
  '9.4: pump-filled tank gets both fill cap and draw floor');

// Validation gate invariant: a clean (non-handoff) result NEVER carries an error,
// and any error-carrying topology hands off to Expert Mode rather than emitting.
const VERTICALS_ALL: Vertical[] = ['residential', 'small_business', 'farm', 'hotel', 'greenhouse', 'commercial', 'water_business'];
const SOURCE_SETS: SourceKind[][] = [['mains'], ['borehole'], ['river'], ['trucked'], ['rainwater'], ['mains', 'borehole'], ['river', 'rainwater']];
let sweepBad = '';
for (const v of VERTICALS_ALL) {
  for (const s of SOURCE_SETS) {
    for (const tanks of [0, 1]) {
      for (const zones of [1, 3]) {
        const r = composeEasyMode({ vertical: v, sources: s, tanks, zones, conveyance: 'pump' }, board);
        if (!r.handoff && errors(r).length) sweepBad = `${v}/${s.join('+')}/t${tanks}/z${zones}: emitted with ${errors(r).length} error(s)`;
        if (r.topology && errors(r).length && r.handoff !== 'expert') sweepBad = `${v}/${s.join('+')}: errors but handoff=${r.handoff}`;
      }
    }
  }
}
assert(sweepBad === '', 'gate: no clean result carries an error; errors hand off to expert', sweepBad);

// Default watering automations (pure planner): irrigation verticals get one
// staggered daily window per demand zone; everyone else gets none.
const water1 = planWateringAutomations(r1.topology!, 'site_test', 'farm');
assert(water1.length === 3, 'planner: farm 3-zone yields 3 windows', String(water1.length));
assert(water1.every(a => a.trigger_type === 'time' && a.enabled && a.controller === 'controller1'), 'planner: time-triggered, enabled, controller set');
assert(new Set(water1.map(a => a.time_min)).size === 3 && Math.min(...water1.map(a => a.time_min)) === 360,
  'planner: windows are distinct and start at 06:00', JSON.stringify(water1.map(a => a.time_min)));
assert(water1.every(a => a.override_mask === 0 && a.route_set_version > 0), 'planner: no overrides, route-set version stamped');
assert(planWateringAutomations(r2.topology!, 'site_test', 'residential').length === 0, 'planner: a home gets no auto-watering');
assert(planWateringAutomations(r3.topology!, 'site_test', 'water_business').length === 0, 'planner: a kiosk gets no auto-watering');

// Static topology SVG: one glyph group per node, a viewBox + dark backdrop; empty -> ''.
const svg1 = renderTopologySvg(r1.topology!);
assert(svg1.includes('viewBox') && svg1.includes('<rect'), 'svg: has a viewBox and a background rect');
assert(svg1.includes('Tank') && svg1.includes('Area 1'), 'svg: embeds node glyphs (tank + zone labels)');
const presentKinds = [...new Set(r1.topology!.nodes.map(n => n.kind))];
assert(presentKinds.every(k => svg1.includes(NODE_REGISTRY.get(k)!.label)), 'svg: legend names every node kind present', presentKinds.join(','));
assert((svg1.match(/class="pipe"/g) ?? []).length === r1.topology!.pipes.length, 'svg: one pipe path per pipe', `${(svg1.match(/class="pipe"/g) ?? []).length} vs ${r1.topology!.pipes.length}`);
assert(renderTopologySvg({ nodes: [], pipes: [] }) === '', 'svg: empty topology renders nothing');

// Stored projection: toStoredTopology keeps the persisted fields and drops the
// transient ones (remoteImports, layout). This is what the stepper and lead
// conversion save to disk.
const stored1 = toStoredTopology(r1.topology!);
assert(
  stored1.schema === r1.topology!.schema && stored1.controllers === r1.topology!.controllers &&
  stored1.nodes === r1.topology!.nodes && stored1.pipes === r1.topology!.pipes &&
  stored1.route_overrides === r1.topology!.route_overrides && stored1.timing === r1.topology!.timing,
  'toStoredTopology: carries the six persisted fields',
);
assert(!('remoteImports' in stored1) && !('layout' in stored1), 'toStoredTopology: drops transient fields');

// Lead conversion core guarantee: re-composing a saved profile WITH a board and
// a unique controller id yields a fully pin-wired site under that id, ready to
// flash (the same path the stepper uses, just driven from a stored lead).
const convId = 'riverside-farm-ab12cd34';
const conv = composeEasyMode(
  { vertical: 'farm', sources: ['borehole'], tanks: 1, zones: 3, conveyance: 'pump' },
  board, undefined, convId,
);
assert(conv.topology?.controllers[0]?.id === convId, 'conversion: composes under the given controller id', conv.topology?.controllers[0]?.id);
assert(!conv.handoff && pinFieldsMissing(conv.topology as never).length === 0, 'conversion: re-composed site is fully pin-wired');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
