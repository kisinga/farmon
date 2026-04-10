/**
 * Shared codegen ID conventions — the single source of truth for all
 * ESPHome component IDs used across entity codegen and generators.
 *
 * Both sides import from here: entity codegen uses these to build YAML
 * templates, generators use them in dispatch functions and control logic.
 * If a convention changes, it changes in one place.
 */

import type { BoardDef } from './board.types';

// ---------------------------------------------------------------------------
// Component IDs — pump
// ---------------------------------------------------------------------------

export const pumpSwitchId = () => 'pump_relay';

// ---------------------------------------------------------------------------
// Component IDs — valve
// ---------------------------------------------------------------------------

export const valveCoverId = (node: { id: string }) => node.id;
export const valveOpenPinId = (node: { id: string }) => `${node.id}_open_pin`;
export const valveClosePinId = (node: { id: string }) => `${node.id}_close_pin`;
export const valveTravelMsId = (node: { id: string }) => `${node.id}_travel_ms`;

// ---------------------------------------------------------------------------
// Component IDs — flow sensor
// ---------------------------------------------------------------------------

export const flowSensorId = (node: { id: string }) => node.id;
export const flowTotalId = (node: { id: string }) => `${node.id}_total`;
export const flowFaultCountId = (node: { id: string }) => `${node.id}_fault_count`;
export const flowFaultSensorId = (node: { id: string }) => `${node.id}_sensor_fault`;

// ---------------------------------------------------------------------------
// Component IDs — tank
// ---------------------------------------------------------------------------

export const tankLevelId = (node: { id: string }) => `${node.id}_level`;
export const tankRawVoltageId = (node: { id: string }) => `${node.id}_raw_voltage`;
export const tankCalEmptyId = (node: { id: string }) => `${node.id}_cal_empty`;
export const tankCalFullId = (node: { id: string }) => `${node.id}_cal_full`;

// ---------------------------------------------------------------------------
// Component IDs — pressure sensor
// ---------------------------------------------------------------------------

export const pressureSensorId = (node: { id: string }) => `${node.id}_pressure`;

// ---------------------------------------------------------------------------
// Component IDs — water source
// ---------------------------------------------------------------------------

export const waterSourcePressureId = (node: { id: string }) => `${node.id}_pressure`;

// ---------------------------------------------------------------------------
// Pin resolution — maps a logical pin name to an ESPHome YAML pin block
// ---------------------------------------------------------------------------

/**
 * Resolve a pin name to an ESPHome YAML pin block.
 *
 * For native GPIO pins (e.g. "GPIO42"), returns a simple `number:` block.
 * For expander pins (e.g. "OUT1"), looks up the expander and port number
 * from the board definition and returns a structured block.
 *
 * The returned string is indented for use inside a `pin:` key at 6-space indent.
 */
export function resolvePinYaml(
  pinName: string,
  board: BoardDef,
  opts?: { inverted?: boolean; mode?: string },
): string {
  if (!pinName) return 'number: ""';

  // Find the pin in the board definition
  const pinDef = board.pins.find(p => p.gpio === pinName);

  // Expander pin — structured block
  if (pinDef?.expander != null && pinDef.number != null) {
    const expander = board.expanders?.find(e => e.id === pinDef.expander);
    if (!expander) {
      throw new Error(`Pin ${pinName} references unknown expander "${pinDef.expander}"`);
    }
    const lines = [
      `${expander.platform}: ${pinDef.expander}`,
      `number: ${pinDef.number}`,
      `mode: { output: true }`,
    ];
    if (opts?.inverted) lines.push(`inverted: true`);
    return lines.join('\n      ');
  }

  // Native GPIO pin — simple block
  const lines = [`number: ${pinName}`];
  if (opts?.mode) lines.push(`mode: ${opts.mode}`);
  if (opts?.inverted) lines.push(`inverted: true`);
  return lines.join('\n      ');
}
