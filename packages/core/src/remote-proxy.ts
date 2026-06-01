/**
 * Remote proxy helpers — shared YAML generators for remote-bound nodes.
 *
 * Each descriptor's `remoteProxy` composes these helpers with its own
 * ID conventions to produce the proxy block that collect.ts emits.
 */

/**
 * Home Assistant platform sensor import — for sensor / number / binary_sensor domains.
 */
export function homeassistantSensorImport(nodeId: string, entityId: string): string {
  return `\
- platform: homeassistant
  id: ri_${nodeId}
  entity_id: ${entityId}
  internal: true`;
}

/**
 * Home Assistant platform binary_sensor — tracks a remote switch state
 * so the local proxy switch lambda can read the true source-of-truth state.
 */
export function homeassistantBinarySensorProxy(proxyId: string, entityId: string): string {
  return `\
- platform: homeassistant
  id: bs_${proxyId}
  entity_id: ${entityId}
  internal: true`;
}

/**
 * Home Assistant platform text_sensor — tracks a remote cover state
 * so the local proxy cover lambda can read the true source-of-truth state.
 */
export function homeassistantTextSensorProxy(proxyId: string, entityId: string): string {
  return `\
- platform: homeassistant
  id: ts_${proxyId}
  entity_id: ${entityId}
  internal: true`;
}

/**
 * Template switch proxy — for switch-domain remote entities.
 *
 * Reads state from a `homeassistant` binary_sensor so the proxy always
 * reflects the actual remote controller state (source of truth).
 *
 * When `remoteDeviceName` and `ownerDeviceName` are provided, the proxy
 * registers a timed dead-man claim on the owning controller before
 * turning the switch on, and releases the claim after turning off.
 */
export function templateSwitchProxy(
  proxyId: string,
  name: string,
  entityId: string,
  remoteDeviceName?: string,
  ownerDeviceName?: string,
  leaseDurationMs: number = 90000,
): string {
  const claimBlock = remoteDeviceName && ownerDeviceName
    ? `    - homeassistant.service:
        service: esphome.${remoteDeviceName}_node_claim
        data:
          node_id: ${proxyId}
          owner: ${ownerDeviceName}
          duration_ms: "${leaseDurationMs}"`
    : "";
  const releaseBlock = remoteDeviceName && ownerDeviceName
    ? `    - homeassistant.service:
        service: esphome.${remoteDeviceName}_node_release
        data:
          node_id: ${proxyId}
          owner: ${ownerDeviceName}`
    : "";
  return `\
- platform: template
  name: "Remote ${name}"
  id: ${proxyId}
  icon: "mdi:remote"
  lambda: 'return id(bs_${proxyId}).has_state() ? id(bs_${proxyId}).state : false;'
  turn_on_action:
${claimBlock}${claimBlock ? "\n" : ""}    - homeassistant.service:
        service: switch.turn_on
        data:
          entity_id: ${entityId}
  turn_off_action:
${releaseBlock}${releaseBlock ? "\n" : ""}    - homeassistant.service:
        service: switch.turn_off
        data:
          entity_id: ${entityId}`;
}

/**
 * Lease heartbeat interval for template switch proxies.
 *
 * Emits an `interval:` block that re-issues the dead-man claim every
 * `intervalMs` while the proxy switch is on. This prevents the claim from
 * expiring if the turn_on action is not re-triggered.
 */
export function templateSwitchProxyLeaseInterval(
  proxyId: string,
  remoteDeviceName?: string,
  ownerDeviceName?: string,
  intervalMs: number = 10000,
  leaseDurationMs: number = 90000,
): string {
  if (!remoteDeviceName || !ownerDeviceName) return "";
  return `\
- interval: ${intervalMs}ms
  then:
    - if:
        condition:
          lambda: 'return id(${proxyId}).state;'
        then:
          - homeassistant.service:
              service: esphome.${remoteDeviceName}_node_claim
              data:
                node_id: ${proxyId}
                owner: ${ownerDeviceName}
                duration_ms: "${leaseDurationMs}"`;
}

/**
 * Template cover proxy — for cover-domain remote entities.
 *
 * Reads state from a `homeassistant` text_sensor so the proxy always
 * reflects the actual remote controller state (source of truth).
 */
export function templateCoverProxy(proxyId: string, name: string, entityId: string): string {
  return `\
- platform: template
  name: "Remote ${name}"
  id: ${proxyId}
  icon: "mdi:remote"
  lambda: 'return id(ts_${proxyId}).state == "open" ? COVER_OPEN : COVER_CLOSED;'
  open_action:
    - homeassistant.service:
        service: cover.open_cover
        data:
          entity_id: ${entityId}
  close_action:
    - homeassistant.service:
        service: cover.close_cover
        data:
          entity_id: ${entityId}
  stop_action:
    - homeassistant.service:
        service: cover.stop_cover
        data:
          entity_id: ${entityId}`;
}
