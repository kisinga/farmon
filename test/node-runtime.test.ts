/**
 * Node runtime projection + the live-symbol contract.
 *  - `bucketReading` turns a telemetry reading into render-ready state/value via
 *    `ROLE_META` (state-on means *active* uniformly; value/unit/fill per role).
 *  - every glyph that declares a `live` facet renders the matching `data-part`
 *    hook, and every glyph renders `data-part="body"` for the state accent — so a
 *    redraw can't silently drop a hook the canvas binds to.
 *
 * Usage: npx tsx test/node-runtime.test.ts
 */
import { bucketReading, channelPriority, formatReading, NODE_REGISTRY, type NodeRuntime } from '@core';
import { makeAsserter } from './helpers';

const { assert, done } = makeAsserter();

// Minimal channel: bucketReading only reads `kind` + `role`.
const ch = (kind: string, role?: string) => ({ sensor: 's', ref: 's', kind, role }) as any;
const read = (reported: number, text = '') => ({ reported, reported_text: text });
const rt = (kind: string, role: string | undefined, reading: any, online = true): NodeRuntime =>
  bucketReading(ch(kind, role), reading, online);

console.log('bucketReading — state means active, value/unit/fill per role:');
// Actuators (binary): on/off, no value.
assert(rt('bool', 'pump', read(1)).state === 'on', 'pump reported 1 → on (active)');
assert(rt('bool', 'pump', read(0)).state === 'off', 'pump reported 0 → off');
assert(rt('cover', 'valve', read(0.3)).state === 'on', 'valve partly open (0.3) → on');
assert(rt('cover', 'valve', read(0)).state === 'off', 'valve closed → off');
const pumpRt = rt('bool', 'pump', read(1));
assert(pumpRt.unit === null && pumpRt.fill === null, 'actuator has no unit/fill');

// Flow (positive): active only when > 0; carries L/min, no fill.
const flowing = rt('state', 'flow', read(12));
assert(flowing.state === 'on' && flowing.value === 12 && flowing.unit === 'L/min' && flowing.fill === null, 'flow 12 → on, 12 L/min, no fill');
assert(rt('state', 'flow', read(0)).state === 'off', 'flow 0 → off (not flowing)');

// Level (value): neutral state, % + normalised fill.
const lvl = rt('state', 'level', read(73));
assert(lvl.state === 'unknown', 'level has no on/off (neutral state)');
assert(lvl.value === 73 && lvl.unit === '%' && Math.abs((lvl.fill ?? 0) - 0.73) < 1e-9, 'level 73 → 73%, fill 0.73');

// Pressure (value): psi, no fill (unbounded).
const pr = rt('state', 'pressure', read(2.4));
assert(pr.value === 2.4 && pr.unit === 'psi' && pr.fill === null, 'pressure 2.4 → 2.4 psi, no fill');

// Presence + missing data.
assert(rt('bool', 'pump', read(1), false).state === 'unavailable', 'offline → unavailable');
assert(bucketReading(ch('state', 'level'), undefined, true).state === 'unknown', 'no reading → unknown');

console.log('\nchannelPriority — salience from ROLE_META:');
assert(channelPriority('pump') === 3 && channelPriority('flow') === 2 && channelPriority('level') === 1 && channelPriority('flow_total') === 0, 'pump>flow>level>flow_total');

console.log('\nformatReading:');
assert(formatReading(12, 'L/min') === '12 L/min', '12 L/min');
assert(formatReading(73, '%') === '73%', '73% (no space)');
assert(formatReading(2.4, 'psi') === '2.4 psi', '2.4 psi (one decimal)');
assert(formatReading(0, 'L/min') === '0 L/min', '0 shows, not hidden');

console.log('\nLive-symbol contract — declared facets have their data-part hook:');
for (const desc of NODE_REGISTRY.values()) {
  const svg = desc.renderSvg(desc.defaultData(1));
  // The live canvas parses glyphs as strict image/svg+xml; an inline SVG comment
  // can carry a `--` that breaks DOMParser (it did, for the tank). Ban them.
  assert(!svg.includes('<!--'), `${desc.kind}: no inline SVG comments (XML-unsafe + bloats the data-URI)`);
  assert(svg.includes('data-part="body"'), `${desc.kind}: renders data-part="body" (state accent)`);
  if (desc.live?.spin) assert(svg.includes('data-part="spin"'), `${desc.kind}: live.spin → data-part="spin"`);
  if (desc.live?.fill) assert(svg.includes('data-part="fill"'), `${desc.kind}: live.fill → data-part="fill"`);
  if (desc.live?.gate) assert(svg.includes('data-part="gate"'), `${desc.kind}: live.gate → data-part="gate"`);
}

done();
