/**
 * Remote proxy helpers — shared YAML generators for remote-bound nodes.
 *
 * Each descriptor's `remoteProxy` method composes these helpers with its own
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
 * Template switch proxy — for switch-domain remote entities.
 */
export function templateSwitchProxy(proxyId: string, name: string, entityId: string): string {
  return `\
- platform: template
  name: "Remote ${name}"
  id: ${proxyId}
  icon: "mdi:remote"
  turn_on_action:
    - homeassistant.service:
        service: switch.turn_on
        data:
          entity_id: ${entityId}
  turn_off_action:
    - homeassistant.service:
        service: switch.turn_off
        data:
          entity_id: ${entityId}`;
}

/**
 * Template cover proxy — for cover-domain remote entities.
 */
export function templateCoverProxy(proxyId: string, name: string, entityId: string): string {
  return `\
- platform: template
  name: "Remote ${name}"
  id: ${proxyId}
  icon: "mdi:remote"
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
