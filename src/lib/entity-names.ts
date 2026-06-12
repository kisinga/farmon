/**
 * Entity-name catalogs — the single source of truth for the literal `name:`
 * strings the firmware emits into ESPHome YAML (which also become the MQTT
 * sensor keys). Read by the codegen generators (sensors.ts, control.ts,
 * networking.ts, board-package.ts) and by tunable-numbers.ts.
 *
 * Per-node entities (one set per pump / valve / level sensor / etc.) are
 * declared on each entity descriptor instead — see entity-registry.ts.
 */

export interface SystemEntitySpec {
  /** ESPHome platform / entity type the firmware emits this as (sensor, switch,
   *  button, number, light, binary_sensor). */
  domain: string;
  /** The literal `name:` value emitted into ESPHome YAML. */
  name: string;
}

/**
 * Fixed system entities — always emitted by the firmware regardless of board.
 * Per-route entities are defined separately via `routeEntityNames()`.
 *
 * Capability-gated entities live in their own catalogs:
 *   - `NETWORK_ENTITY_NAMES` for transport-gated (wifi-only) entities
 *   - `BATTERY_ENTITY_NAMES` for battery-peripheral-gated entities
 *
 * Note: `vextControl` and `onboardLed` are peripheral-dependent (gated on
 * `board.peripherals.vext` / `board.peripherals.led` in board-package.ts).
 */
export const SYSTEM_ENTITY_NAMES = {
  // text_sensor (sensors.ts)
  systemState:        { domain: 'sensor', name: 'System State' },
  systemFault:        { domain: 'sensor', name: 'System Fault' },
  lastStopReason:     { domain: 'sensor', name: 'Last Stop Reason' },
  activeRoutes:       { domain: 'sensor', name: 'Active Routes' },
  routeQueue:         { domain: 'sensor', name: 'Route Queue' },

  // sensor / binary_sensor (sensors.ts)
  combinedTankLevel:  { domain: 'sensor',        name: 'Combined Tank Level' },
  waterCritical:      { domain: 'binary_sensor', name: 'Water Critical' },
  queueDepth:         { domain: 'sensor',        name: 'Queue Depth' },
  queueFull:          { domain: 'binary_sensor', name: 'Queue Full' },

  // number (sensors.ts safety blocks). Values are stored in user-facing units
  // (seconds, L/min). Firmware converts to its internal representation
  // (typically ms) at read time. Units are also embedded in the entity name
  // for history/logging clarity.
  flowWatchdog:       { domain: 'number', name: 'Flow Watchdog (s)' },
  flowConfirm:        { domain: 'number', name: 'Flow Confirm (s)' },
  // Unit shown via unit_of_measurement (L/min); kept out of the name because a
  // '/' is reserved in ESPHome entity names (becomes an error in 2026.7).
  flowThreshold:      { domain: 'number', name: 'Flow Threshold' },
  claimLease:         { domain: 'number', name: 'Claim Lease (s)' },

  // switch (control.ts)
  safetyOverride:     { domain: 'switch', name: 'Safety Override' },

  // button (control.ts) — parameterless system-wide control actions.
  // Parameterized counterparts (route_start/route_stop/fault_reset) stay as
  // api services because buttons can't accept arguments.
  stopAll:            { domain: 'button', name: 'Stop All' },
  resetFaults:        { domain: 'button', name: 'Reset Faults' },
  clearQueue:         { domain: 'button', name: 'Clear Queue' },

  // device health (board-package.ts) — uptime + ESP32 temp are unconditional;
  // vextControl/onboardLed are peripheral-dependent but emitted unconditionally
  // today (see header note).
  uptime:             { domain: 'sensor', name: 'Uptime' },
  esp32Temperature:   { domain: 'sensor', name: 'ESP32 Temperature' },
  vextControl:        { domain: 'switch', name: 'Vext Control' },
  onboardLed:         { domain: 'light',  name: 'Onboard LED' },

  // networking (networking.ts) — emitted on every transport. Wifi-only fields
  // live in NETWORK_ENTITY_NAMES instead.
  ipAddress:          { domain: 'sensor', name: 'IP Address' },
  transportSupported: { domain: 'sensor', name: 'Transport (supported)' },
  transportActive:    { domain: 'sensor', name: 'Transport (active)' },
} as const satisfies Record<string, SystemEntitySpec>;

export type SystemEntityKey = keyof typeof SYSTEM_ENTITY_NAMES;

/**
 * Network entities emitted by the firmware only when the active transport is
 * wifi (see `effectiveTransport`).
 */
export const NETWORK_ENTITY_NAMES = {
  wifiSignal:    { domain: 'sensor', name: 'WiFi Signal' },
  connectedSsid: { domain: 'sensor', name: 'Connected SSID' },
  macAddress:    { domain: 'sensor', name: 'MAC Address' },
} as const satisfies Record<string, SystemEntitySpec>;

export type NetworkEntityKey = keyof typeof NETWORK_ENTITY_NAMES;

/**
 * Battery entities emitted by the firmware only when the board declares a
 * battery peripheral.
 */
export const BATTERY_ENTITY_NAMES = {
  batteryVoltage: { domain: 'sensor', name: 'Battery Voltage' },
  batteryPercent: { domain: 'sensor', name: 'Battery Percent' },
} as const satisfies Record<string, SystemEntitySpec>;

export type BatteryEntityKey = keyof typeof BATTERY_ENTITY_NAMES;

/** Names of the per-route entities the firmware emits (one set per route). */
export function routeEntityNames(route: { name: string }): {
  status: SystemEntitySpec;
  start: SystemEntitySpec;
  stop: SystemEntitySpec;
  maxRuntime: SystemEntitySpec;
  sourceMinLevel: SystemEntitySpec;
  destMaxLevel: SystemEntitySpec;
  targetVolume: SystemEntitySpec;
  targetDuration: SystemEntitySpec;
} {
  return {
    status:         { domain: 'sensor', name: `Route: ${route.name}` },
    start:          { domain: 'button', name: `Start: ${route.name}` },
    stop:           { domain: 'button', name: `Stop: ${route.name}` },
    maxRuntime:     { domain: 'number', name: `Route: ${route.name} Max Runtime (min)` },
    sourceMinLevel: { domain: 'number', name: `Route: ${route.name} Source Min (%)` },
    destMaxLevel:   { domain: 'number', name: `Route: ${route.name} Dest Max (%)` },
    targetVolume:   { domain: 'number', name: `Route: ${route.name} Target Volume (L)` },
    targetDuration: { domain: 'number', name: `Route: ${route.name} Target Duration (s)` },
  };
}
