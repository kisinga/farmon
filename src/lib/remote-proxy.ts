/**
 * Remote proxy helpers — shared YAML generators for remote-bound nodes.
 *
 * In local mode an importing controller can drive an actuator that is physically
 * wired to a DIFFERENT same-site controller. It never touches the owner's relay
 * directly — it speaks over the peer lane (`peerCommandTopic(site, ownerCtrl)`):
 *
 *   - switch actuators (pump / dosing / vfd): `node_claim` = run, `node_release`
 *     = stop. The owner runs the actuator while a claim is alive and stops it
 *     within one tick of the claim expiring (importer link lost) — the
 *     local-mode control-loss fail-safe. A heartbeat interval renews the claim
 *     while the proxy is on, so a single missed renewal is enough to stop it.
 *   - cover actuators (valve): `node_claim` = open, `node_release` = close. The
 *     owner's valve reconciler opens a valve while a claim is alive, so a valve
 *     is just an actuator whose "active" state is "open" — same claim model as a
 *     pump. A heartbeat renews the claim while the proxy is open; lose the link
 *     and the claim expires → the owner closes it (fail-closed).
 *
 * Proxy switches/covers are OPTIMISTIC — true actuator state reaches the
 * dashboard from the OWNER's own telemetry via the server, so the importer needs
 * no cross-controller telemetry subscription (and the broker ACL stays locked to
 * the peer lane only).
 *
 * Each descriptor's `remoteProxy` composes these helpers with its own ID
 * conventions to produce the proxy block that collect.ts emits.
 */

/** Default dead-man lease the owner honours; the wire `duration_ms` is advisory. */
const LEASE_MS = 90000;
/** Re-claim cadence — well under LEASE_MS so one missed beat still stops safely. */
const HEARTBEAT_MS = 10000;

/** A `mqtt.publish_json` action building `root[...]` from key→C++-literal pairs. */
function publishJson(topic: string, fields: Record<string, string>): string {
  const body = Object.entries(fields)
    .map(([k, v]) => `          root["${k}"] = ${v};`)
    .join("\n");
  return `\
    - mqtt.publish_json:
        topic: "${topic}"
        payload: |-
${body}`;
}

/**
 * MQTT sensor read-import — mirrors an owning controller's numeric telemetry as
 * a local (internal) sensor the importer's route logic can read (e.g. a remote
 * tank level or flow). Subscribes to the owner's telemetry topic; the value is
 * the same number the owner publishes (and the server stores). Read-only — the
 * importer never writes here. The component id (`ri_<nodeId>`) is unchanged from
 * the old HA import, so downstream `id(ri_...)` references keep working.
 */
export function mqttSensorImport(nodeId: string, topic: string): string {
  return `\
- platform: mqtt_subscribe
  id: ri_${nodeId}
  topic: "${topic}"
  internal: true`;
}

/**
 * MQTT switch proxy — for switch-domain remote actuators (pump / dosing / vfd).
 *
 * Optimistic template switch: turning it on publishes a `node_claim` to the
 * owner (which runs its local relay); turning it off publishes a `node_release`.
 * `nodeId` is the topology node id — the exact key the owner's claim registry
 * uses (`has_live_claim`). `owner` identifies this importing controller so it
 * can renew/release only its own claim.
 */
export function mqttSwitchProxy(
  proxyId: string,
  name: string,
  nodeId: string,
  peerTopic: string,
  owner: string,
): string {
  const claim = publishJson(peerTopic, {
    action: '"node_claim"',
    node_id: `"${nodeId}"`,
    owner: `"${owner}"`,
    duration_ms: `${LEASE_MS}`,
  });
  const release = publishJson(peerTopic, {
    action: '"node_release"',
    node_id: `"${nodeId}"`,
    owner: `"${owner}"`,
  });
  return `\
- platform: template
  name: "Remote ${name}"
  id: ${proxyId}
  icon: "mdi:remote"
  optimistic: true
  turn_on_action:
${claim}
  turn_off_action:
${release}`;
}

/**
 * Lease heartbeat interval for an MQTT switch proxy.
 *
 * Re-issues the `node_claim` every `HEARTBEAT_MS` while the proxy switch is on,
 * so the owner's lease never lapses while the importer wants the actuator
 * running. Stop renewing (proxy off, importer crash, link loss) and the owner's
 * claim expires → it stops within one tick.
 */
export function mqttSwitchProxyLeaseInterval(
  proxyId: string,
  nodeId: string,
  peerTopic: string,
  owner: string,
): string {
  const claim = publishJson(peerTopic, {
    action: '"node_claim"',
    node_id: `"${nodeId}"`,
    owner: `"${owner}"`,
    duration_ms: `${LEASE_MS}`,
  });
  return `\
- interval: ${HEARTBEAT_MS}ms
  then:
    - if:
        condition:
          lambda: 'return id(${proxyId}).state;'
        then:
${claim.split("\n").map(l => (l === "" ? "" : "      " + l)).join("\n")}`;
}

/**
 * MQTT cover proxy — for cover-domain remote actuators (valve).
 *
 * Optimistic template cover: opening publishes a `node_claim` (the owner's
 * reconciler opens its local valve while the claim is alive); closing or
 * stopping publishes a `node_release` (the owner closes it). `nodeId` is the
 * topology node id (== the owner's cover component id and claim-registry key).
 */
export function mqttCoverProxy(
  proxyId: string,
  name: string,
  nodeId: string,
  peerTopic: string,
  owner: string,
): string {
  const claim = publishJson(peerTopic, {
    action: '"node_claim"',
    node_id: `"${nodeId}"`,
    owner: `"${owner}"`,
    duration_ms: `${LEASE_MS}`,
  });
  const release = publishJson(peerTopic, {
    action: '"node_release"',
    node_id: `"${nodeId}"`,
    owner: `"${owner}"`,
  });
  return `\
- platform: template
  name: "Remote ${name}"
  id: ${proxyId}
  icon: "mdi:remote"
  optimistic: true
  assumed_state: true
  open_action:
${claim}
  close_action:
${release}
  stop_action:
${release}`;
}

/**
 * Lease heartbeat interval for an MQTT cover proxy — re-issues the `node_claim`
 * every `HEARTBEAT_MS` while the proxy valve is open, so the owner keeps it open.
 * Stop renewing (closed, importer crash, link loss) and the owner closes it.
 */
export function mqttCoverProxyLeaseInterval(
  proxyId: string,
  nodeId: string,
  peerTopic: string,
  owner: string,
): string {
  const claim = publishJson(peerTopic, {
    action: '"node_claim"',
    node_id: `"${nodeId}"`,
    owner: `"${owner}"`,
    duration_ms: `${LEASE_MS}`,
  });
  return `\
- interval: ${HEARTBEAT_MS}ms
  then:
    - if:
        condition:
          lambda: 'return id(${proxyId}).position > 0.5f;'
        then:
${claim.split("\n").map(l => (l === "" ? "" : "      " + l)).join("\n")}`;
}
