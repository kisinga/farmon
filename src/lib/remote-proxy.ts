/**
 * Remote proxy helpers — YAML generators for imported (cross-controller) nodes.
 *
 * An importing controller drives an actuator wired to a DIFFERENT same-site
 * controller, and reads that controller's sensors, over the LAN UDP coordination
 * lane. The C++ that builds/signs/sends and parses these messages lives in the
 * vendored maji_coord external component; these helpers emit the ESPHome entities
 * that call into it (`id(coord).encode_*`) via the shared `udp:` component `coord_udp`:
 *
 *   - switch actuators (pump / dosing / vfd): turning the proxy on sends a
 *     `claim` (the owner runs its relay while a claim is alive); off sends a
 *     `release`. A 10s interval re-sends the claim while on, so the owner's lease
 *     never lapses; stop renewing (off / crash / link loss) → the owner's claim
 *     expires → it stops within one tick (the control-loss fail-safe).
 *   - cover actuators (valve): open sends a `claim` (owner opens its valve),
 *     close/stop send a `release`. Same lease/heartbeat model.
 *   - sensor read-import (tank level / flow): a local `ri_<id>` mirror sensor the
 *     owner populates by broadcasting its reading; the dispatcher in
 *     coordination.h sets it. Read-only.
 *
 * Proxy switches/covers stay OPTIMISTIC — true actuator state reaches the
 * dashboard from the OWNER's own MQTT telemetry via the server, so the importer
 * needs no cross-controller telemetry.
 *
 * Build/sign details (counter, HMAC over udp_key, `from = this controller`) all
 * live in `id(coord).encode_claim` / `encode_release` (maji_coord), so these
 * emitters only ever name the node id.
 */

/**
 * A `udp.write` action that builds+signs the message in C++ and broadcasts it via
 * coord_udp. Sends MUST go through this action, not `send_packet()` directly: the
 * action's codegen calls `set_should_broadcast()`, which is what makes the udp
 * component create its broadcast socket. `indent` is the YAML column of the `-`.
 */
const writeMsg = (builder: string, nodeId: string, indent: string): string =>
  `${indent}- udp.write:
${indent}    id: coord_udp
${indent}    data: !lambda |-
${indent}      return ${builder}("${nodeId}");`;
const claimAction = (nodeId: string, indent: string) => writeMsg('id(coord).encode_claim', nodeId, indent);
const releaseAction = (nodeId: string, indent: string) => writeMsg('id(coord).encode_release', nodeId, indent);

/**
 * UDP switch proxy — switch-domain remote actuators (pump / dosing / vfd).
 * On → `claim`, off → `release`. `nodeId` is the topology node id, the exact key
 * the owner's claim registry (`has_live_claim`) uses.
 */
export function udpSwitchProxy(proxyId: string, name: string, nodeId: string): string {
  return `\
- platform: template
  name: "Remote ${name}"
  id: ${proxyId}
  icon: "mdi:remote"
  optimistic: true
  turn_on_action:
${claimAction(nodeId, '    ')}
  turn_off_action:
${releaseAction(nodeId, '    ')}`;
}

/**
 * Lease heartbeat for a UDP switch proxy — re-sends the `claim` every 10s while
 * the proxy switch is on, so the owner's lease never lapses. Stop renewing and
 * the owner's claim expires → it stops within one tick.
 */
export function udpSwitchProxyLeaseInterval(proxyId: string, nodeId: string): string {
  return `\
- interval: 10s
  then:
    - if:
        condition:
          lambda: 'return id(${proxyId}).state;'
        then:
${claimAction(nodeId, '          ')}`;
}

/**
 * UDP cover proxy — cover-domain remote actuators (valve). Open → `claim` (owner
 * opens its valve while the claim is alive), close/stop → `release`. `nodeId` is
 * the topology node id (== the owner's cover id and claim-registry key).
 */
export function udpCoverProxy(proxyId: string, name: string, nodeId: string): string {
  return `\
- platform: template
  name: "Remote ${name}"
  id: ${proxyId}
  icon: "mdi:remote"
  optimistic: true
  assumed_state: true
  open_action:
${claimAction(nodeId, '    ')}
  close_action:
${releaseAction(nodeId, '    ')}
  stop_action:
${releaseAction(nodeId, '    ')}`;
}

/**
 * Lease heartbeat for a UDP cover proxy — re-sends the `claim` every 10s while the
 * proxy valve is open. Stop renewing (closed / crash / link loss) → owner closes it.
 */
export function udpCoverProxyLeaseInterval(proxyId: string, nodeId: string): string {
  return `\
- interval: 10s
  then:
    - if:
        condition:
          lambda: 'return id(${proxyId}).position > 0.5f;'
        then:
${claimAction(nodeId, '          ')}`;
}

/**
 * UDP sensor read-import — a local (internal) mirror of an owning controller's
 * numeric telemetry (remote tank level / flow) the importer's route logic reads.
 * It carries no source of its own: the owner broadcasts the reading and the
 * coordination.h dispatcher does `id(ri_<nodeId>).publish_state(value)`. The
 * `ri_<nodeId>` id is unchanged from the old import so downstream `id(ri_...)`
 * references keep working.
 */
export function udpSensorImport(nodeId: string): string {
  return `\
- platform: template
  id: ri_${nodeId}
  internal: true`;
}
