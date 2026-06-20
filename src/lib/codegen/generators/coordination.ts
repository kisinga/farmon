import type { Manifest } from '@core';
import { localNodesWithFlag, importedNodesWithFlag, collectTelemetryChannels } from '@core';
import type { GenerationMetadata } from '../backends/types';

/**
 * Cross-controller coordination over UDP.
 *
 * Controller↔controller traffic — actuator claims AND remote sensor reads — rides
 * ESPHome's `udp:` component (LAN broadcast, on_receive), authenticated with
 * HMAC-SHA256 over the per-site `udp_key` (authenticity, not secrecy). The C++ lives
 * in two vendored external_components, wired together only by the generated lambdas
 * here (neither references the other):
 *
 *   - `maji_coord`  — transport/codec: encodes/decodes claim/reading/held frames and
 *     publishes imported readings (`ri_<node>`) and claim-confirmations (`cc_<node>`).
 *   - `maji_claims` — the shared claim registry (the dead-man lease): claims feed it,
 *     local pump/valve control reads it. Replaces the old routes.h deadman block.
 *
 * The on_receive lambda is the one place that sees both components plus the routes.h
 * free functions: it `decode`s a datagram and routes it — a claim/release to the
 * registry, a reading/held to the mirror sensors.
 *
 * DELIVERY. UDP is fire-and-forget: no ack, no retransmit. Reliability is convergent —
 * the importer re-claims every heartbeat and the lease bounds any loss. Claims are
 * BINARY (run/stop); a VFD speed setpoint is an owner-local entity, never carried.
 *
 * CONFIRMATION. The owner broadcasts a `held` receipt per owned actuator (its sorted
 * claimant set). An importer confirms its claim landed by finding itself in that set,
 * surfaced as a `cc_<node>` diagnostic binary sensor (local-first). Best-effort
 * visibility, not a hard guarantee — the re-claim heartbeat is the real retry.
 */

/** ESPHome `udp:` listen/broadcast port (component default; pinned for clarity). */
const UDP_PORT = 18511;
/** Re-broadcast / re-claim cadence; well under the 90s dead-man lease. */
const HEARTBEAT_MS = 10000;
/** A `cc_<node>` claim-confirm light goes stale after this many ms of owner silence —
 *  the importer's confirmation-liveness timeout. 4 missed `held` heartbeats absorbs a
 *  couple of dropped UDP broadcasts on a lossy LAN without flickering, while staying well
 *  under the 90s dead-man lease so the light reflects reality before the claim expires. */
const CONFIRM_TIMEOUT_MS = 4 * HEARTBEAT_MS;
/** Roles an importer mirrors as a local `ri_<node>` sensor (the read-import). */
const READING_ROLES = ['level', 'flow'] as const;

/** Local actuator node ids — a claim is honoured only for these (owner side). */
function ownedActuatorIds(m: Manifest): string[] {
  const ids = new Set<string>();
  for (const flag of ['isPump', 'isValve', 'isDosingPump'] as const) {
    for (const n of localNodesWithFlag(m, flag)) ids.add(n.id);
  }
  return [...ids];
}

/** Local valve node ids, in manifest order — the registry's index→id valve table
 *  (must match routes.ts valve bit order). */
function localValveIds(m: Manifest): string[] {
  return localNodesWithFlag(m, 'isValve').map((n) => n.id);
}

/** Imported actuator nodes this controller proxies — it claims these remotely and
 *  confirms each claim landed via the owner's `held` broadcast (cc_<id> sensor). */
function importedActuatorNodes(m: Manifest): { id: string; name: string }[] {
  const seen = new Map<string, string>();
  for (const flag of ['isPump', 'isValve', 'isDosingPump'] as const) {
    for (const n of importedNodesWithFlag(m, flag)) seen.set(n.id, String(n.name ?? n.id));
  }
  return [...seen].map(([id, name]) => ({ id, name }));
}

/** Imported sensor node ids this controller mirrors as `ri_<id>` (importer side). */
function importedReadingIds(m: Manifest): string[] {
  return m.imports
    .filter((n) => n.kind === 'tank' || n.kind === 'flow_sensor')
    .map((n) => n.id);
}

/** Local readable channels (level/flow) this controller broadcasts for importers. */
function ownedReadingChannels(m: Manifest) {
  return collectTelemetryChannels(m).filter(
    (c) => c.node && c.role && (READING_ROLES as readonly string[]).includes(c.role),
  );
}

/**
 * YAML package: the two coordination components (`maji_claims` + `maji_coord`), the
 * stock `udp:` block (on_receive → dispatch), the owner's broadcast interval (readings
 * + claim receipts), and the importer's `cc_<node>` claim-confirm sensors. Always
 * emitted; harmless on an island controller (it just listens and broadcasts to nobody).
 */
export function generateCoordination(m: Manifest, metadata: GenerationMetadata): string {
  const self = metadata.controllerId;
  const owned = ownedActuatorIds(m);
  const valves = localValveIds(m);
  const readings = ownedReadingChannels(m);
  const importedActuators = importedActuatorNodes(m);
  const importedReadings = importedReadingIds(m);

  // maji_claims config — the local valve table (index→id) and the live lease tunable.
  const valvesYaml = valves.length > 0
    ? `\n  valves:\n${valves.map((id) => `    - "${id}"`).join('\n')}`
    : '';

  // maji_coord config — what messages are "for me" (owned actuators) and the mirror
  // sensors imported readings / claim-confirms publish to.
  const ownedYaml = owned.length > 0
    ? `\n  owned_actuators:\n${owned.map((id) => `    - "${id}"`).join('\n')}`
    : '';
  const importedReadingsYaml = importedReadings.length > 0
    ? `\n  imported_readings:\n${importedReadings.map((id) => `    - { node: "${id}", sensor: ri_${id} }`).join('\n')}`
    : '';
  const importedActuatorsYaml = importedActuators.length > 0
    ? `\n  imported_actuators:\n${importedActuators.map(({ id }) => `    - { node: "${id}", sensor: cc_${id} }`).join('\n')}`
    : '';

  // Owner broadcast (10s): each readable channel + a claim-receipt (`held`) per owned
  // actuator. Readings are guarded so a not-yet-read (NaN) sensor is skipped; held is
  // unguarded (an empty claimant set confirms a release too).
  const readingItems = readings.map((c) => `      - if:
          condition:
            lambda: 'return !std::isnan(id(${c.ref}).state);'
          then:
            - udp.write:
                id: coord_udp
                data: !lambda |-
                  return id(coord).encode_reading("${c.node}", "${c.role}", id(${c.ref}).state);`);
  const heldItems = owned.map((id) => `      - udp.write:
          id: coord_udp
          data: !lambda |-
            return id(coord).encode_held("${id}", id(claims).claimants_csv("${id}"));`);
  const items = [...readingItems, ...heldItems];
  const broadcast = items.length > 0
    ? `
interval:
  - interval: ${HEARTBEAT_MS}ms
    then:
${items.join('\n')}
`
    : '';

  // Importer: a diagnostic binary sensor per proxied actuator — true while the owner
  // reports this controller in the claimant set (i.e. our claim was received). Set by
  // maji_coord.publish_held via the dispatch lambda; local-first, visible with no server.
  const confirmSensors = importedActuators.length > 0
    ? `
binary_sensor:
${importedActuators.map(({ id, name }) => `  - platform: template
    id: cc_${id}
    name: "${name} claim confirmed"
    entity_category: diagnostic`).join('\n')}
`
    : '';

  return `# =============================================================================
# MajiFlow — Cross-Controller Coordination (UDP)
# =============================================================================
# AUTO-GENERATED. MQTT is the device<->server pipe; this is the ONLY
# controller<->controller lane (claims + remote sensor reads), HMAC-authenticated
# over the per-site udp_key. The C++ lives in the vendored external_components
# maji_coord (transport/codec) and maji_claims (shared claim registry).
# =============================================================================

maji_claims:
  id: claims
  lease_number_id: claim_lease_s${valvesYaml}

maji_coord:
  id: coord
  self_id: "${self}"
  udp_key: "\${udp_key}"
  confirm_timeout_ms: ${CONFIRM_TIMEOUT_MS}${ownedYaml}${importedReadingsYaml}${importedActuatorsYaml}

udp:
  id: coord_udp
  port: ${UDP_PORT}
  on_receive:
    - lambda: |-
        maji_wire::Frame f;
        if (!id(coord).decode(data, f)) return;
        if (f.type == "claim") id(claims).extend(f.node, f.from);
        else if (f.type == "release") id(claims).drop(f.node, f.from);
        else if (f.type == "reading") id(coord).publish_reading(f.node, f.value);
        else if (f.type == "held") id(coord).publish_held(f.node, f.who);
${broadcast}${confirmSensors}`;
}
