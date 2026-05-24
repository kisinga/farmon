/**
 * Cross-validation regression guard: every HA entity_id referenced by the
 * generated dashboard / automations / SCADA-meta must correspond to an
 * entity the firmware actually publishes.
 *
 * This test would have caught the original "entity not found" drift bug:
 * a dashboard ref like `sensor.kc868_ctrl_system_state` that doesn't match
 * any firmware-emitted entity now fails here at codegen time, rather than
 * silently appearing as a broken card in HA.
 *
 * Approach:
 *  1. Generate firmware YAML for each fixture (esphome/.../*.yaml).
 *  2. Walk every HA-discoverable platform (sensor, switch, number, button,
 *     binary_sensor, cover, text_sensor, light) and collect each entity's
 *     `name:`. Compute the entity_id HA will derive via deriveHaEntityId().
 *  3. Generate HA YAML for the same fixture (dashboard + automations + meta).
 *  4. Walk every entity_id reference (any string matching `<domain>.<id>`).
 *  5. Assert every reference is present in the firmware-emitted set, modulo
 *     known capability gaps (WiFi on ethernet, Battery on no-battery boards).
 *
 * Usage: npx tsx test/entity-id-coverage.test.ts
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse as parseYaml, parseAllDocuments } from 'yaml';
import {
  parseTopology,
  topologyToManifestForController,
  buildHaMeta,
  deriveHaEntityId,
  type Manifest,
  type SystemTopology,
} from '@far-mon/core';
import { loadBoard } from '../electron/lib/board.js';
import { generateEsphome, generateAll } from '../electron/lib/generate.js';

const DEFAULTS = path.resolve(new URL('.', import.meta.url).pathname, '..', 'defaults');

// Platforms whose `name:` fields produce HA-discoverable entities, mapped to
// the HA domain HA assigns them.
const HA_PLATFORMS: Record<string, string> = {
  sensor:        'sensor',
  switch:        'switch',
  number:        'number',
  button:        'button',
  binary_sensor: 'binary_sensor',
  cover:         'cover',
  text_sensor:   'sensor',  // ESPHome text_sensor surfaces as `sensor.*` in HA
  light:         'light',
};

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

/**
 * Extract every HA-discoverable entity from a firmware YAML document.
 * Returns the set of entity_ids HA will derive at discovery time.
 */
function collectFirmwareEntityIds(
  yamlContent: string,
  device: { friendly_name: string },
): Set<string> {
  const ids = new Set<string>();
  // Some files (automations) contain multiple `---` documents; firmware files
  // are single-doc but support either shape via parseAllDocuments.
  const docs = parseAllDocuments(yamlContent).map(d => d.toJS()).filter(d => d);
  for (const doc of docs) {
    if (!doc || typeof doc !== 'object') continue;
    for (const [section, value] of Object.entries(doc)) {
      const haDomain = HA_PLATFORMS[section];
      if (!haDomain || !Array.isArray(value)) continue;
      for (const entry of value) {
        if (!entry || typeof entry !== 'object') continue;
        const name = (entry as { name?: string }).name;
        const internal = (entry as { internal?: boolean }).internal;
        if (typeof name !== 'string' || internal) continue;
        ids.add(deriveHaEntityId(haDomain, device, name));
      }
    }
  }
  return ids;
}

/**
 * Walk a parsed YAML structure and collect every value that looks like an
 * HA entity_id reference.
 */
function collectEntityIdReferences(node: unknown, into: Set<string>): void {
  if (typeof node === 'string') {
    // Match standalone entity_ids and entity_ids inside templates like
    // `{{ states('sensor.foo_bar') }}`.
    const re = /\b([a-z_]+)\.([a-z0-9_]+)\b/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(node)) !== null) {
      const domain = m[1];
      // Only treat as an entity_id if the domain is one HA actually uses.
      // Avoids matching things like `mdi.icon-name`, `data.foo`, code refs.
      if (HA_DOMAINS.has(domain)) into.add(m[0]);
    }
  } else if (Array.isArray(node)) {
    for (const item of node) collectEntityIdReferences(item, into);
  } else if (node && typeof node === 'object') {
    for (const v of Object.values(node)) collectEntityIdReferences(v, into);
  }
}

const HA_DOMAINS = new Set([
  'sensor', 'switch', 'number', 'button', 'binary_sensor', 'cover',
  'light', 'automation', 'script', 'input_number', 'input_boolean',
]);

interface FixtureCheck {
  configFile: string;
  boardDir: string;
}

function check(fixture: FixtureCheck) {
  const config = fs.readFileSync(path.join(DEFAULTS, fixture.configFile), 'utf-8');
  const topology = parseTopology(parseYaml(config));
  const manifest = topologyToManifestForController(topology, topology.controllers[0]?.id ?? 'default');
  const board = loadBoard(path.join(DEFAULTS, fixture.boardDir));

  // --- Firmware: entity set HA will see ---
  const firmwareIds = new Set<string>();

  // ESPHome firmware files (board package, control, hardware, sensors).
  for (const f of generateEsphome(manifest, board, 'test-site', undefined, [])) {
    if (!f.relativePath.endsWith('.yaml')) continue;
    if (f.relativePath.endsWith('secrets.yaml')) continue;
    const found = collectFirmwareEntityIds(f.content, manifest.device);
    for (const id of found) firmwareIds.add(id);
  }

  // --- Generator references ---
  const referencedIds = new Set<string>();

  for (const f of generateAll(manifest, board, 'test-site')) {
    if (!f.relativePath.includes('/homeassistant/')) continue;
    const docs = parseAllDocuments(f.content).map(d => d.toJS());
    for (const doc of docs) collectEntityIdReferences(doc, referencedIds);
  }

  // SCADA meta sidecar (built separately, lives under `/local/` in HA).
  // buildHaMeta expects SystemTopology shape which has a top-level `device`;
  // SiteTopology (schema 15) stores device data in controllers[]. Synthesize
  // the expected shape from the manifest we built for the first controller.
  const metaTopology: SystemTopology = {
    schema: 16,
    device: manifest.device,
    nodes: topology.nodes,
    pipes: topology.pipes,
    route_overrides: topology.route_overrides,
    timing: topology.timing,
    automations: topology.automations,
  };
  const meta = buildHaMeta(metaTopology, { viewBox: [0, 0, 1200, 600] });
  collectEntityIdReferences(meta, referencedIds);

  // --- Filter ---
  // - `automation.*` ids are HA-side (automations.ts emits these as new HA
  //   entities, not refs to firmware). Skip.
  // - `script.*`, `input_number.*` are HA-side. Skip.
  // - `button.press`, `cover.open_cover` etc. are SERVICES (domain.action),
  //   not entity_ids. Skip strings that look like services rather than ids.
  const HA_NATIVE_DOMAINS = new Set(['automation', 'script', 'input_number', 'input_boolean']);
  const SERVICE_NAMES = new Set(['press', 'toggle', 'open_cover', 'close_cover', 'stop_cover', 'turn_on', 'turn_off', 'create']);
  const filteredRefs = new Set<string>();
  for (const ref of referencedIds) {
    const [domain, id] = ref.split('.');
    if (HA_NATIVE_DOMAINS.has(domain)) continue;
    if (SERVICE_NAMES.has(id)) continue;
    filteredRefs.add(ref);
  }

  // --- Assert: every reference exists in firmware. No exemptions.
  const missing: string[] = [];
  for (const ref of filteredRefs) {
    if (firmwareIds.has(ref)) continue;
    missing.push(ref);
  }

  console.log(`\n${fixture.configFile}:`);
  console.log(`  device.friendly_name = "${manifest.device.friendly_name}"`);
  console.log(`  firmware emits ${firmwareIds.size} entities, dashboards reference ${filteredRefs.size}`);

  assert(
    missing.length === 0,
    `every dashboard/automation reference has a matching firmware entity`,
    missing.length > 0 ? `missing: ${missing.join(', ')}` : undefined,
  );
}

console.log('Entity ID coverage — dashboard refs vs firmware emits');
console.log('=====================================================');

// Strict gate: every dashboard / automation / SCADA-meta reference MUST
// resolve to a firmware-emitted entity for every fixture. No exemptions.
// Drift fails the build at codegen time, before HA ever sees a broken card.

check({ configFile: 'configs/pump-controller.yaml',     boardDir: 'boards/heltec-v3' });
check({ configFile: 'configs/vfd-pump-controller.yaml', boardDir: 'boards/heltec-v3' });
check({ configFile: 'configs/treatment-loop.yaml',      boardDir: 'boards/heltec-v3' });
// KC868-A16 has ethernet (no WiFi) and no battery — capability gating handled by the generators.
check({ configFile: 'configs/kc868-a16-controller.yaml', boardDir: 'boards/kc868-a16' });

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
