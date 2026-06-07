/**
 * TestProbe — self-contained hardware test definition.
 *
 * Each probe declares what it tests, when it applies, and contributes
 * C++ code fragments + YAML components. The framework composes them
 * into a complete firmware. Adding a test = adding one probe file.
 */

import type { BoardDef, PinDef } from '@core';

export interface TestProbe {
  /** Unique identifier — used for C++ enum, ESPHome IDs, function names. */
  id: string;
  /** Human-readable label shown in HA and logs. */
  label: string;
  /** Return true if this probe should run on the given board. */
  appliesTo(board: BoardDef): boolean;

  // --- C++ contributions (composed by sequencer.ts) ---

  /** Static const declarations (board-specific constants baked into C++). */
  constants(board: BoardDef): string;
  /** Static variable declarations (per-probe state). */
  state(): string;
  /** Helper functions (relay_set, readback, etc.). */
  helpers(board: BoardDef): string;
  /** Body of tick_xxx() — non-blocking state machine using sub_step/step_timer. */
  tick(board: BoardDef): string;

  // --- YAML contributions (composed by device-yaml.ts) ---

  /** Extra ESPHome YAML blocks (internal switches, sensors, etc.). Keyed by section name. */
  yaml(board: BoardDef): YamlFragments;
}

/** YAML fragments keyed by ESPHome section (sensor, switch, binary_sensor, etc.). */
export type YamlFragments = Record<string, string>;

// ---------------------------------------------------------------------------
// ID conventions — live here, not in shared codegen-ids.ts
// ---------------------------------------------------------------------------

export const resultId = (probe: { id: string }) => `st_result_${probe.id}`;
export const detailId = (probe: { id: string }) => `st_detail_${probe.id}`;
export const relayId = (pin: { gpio: string }) => `st_relay_${pin.gpio.toLowerCase()}`;
export const inputId = (pin: { gpio: string }) => `st_input_${pin.gpio.toLowerCase()}`;
export const adcId = (pin: { gpio: string }) => `st_adc_${pin.gpio.toLowerCase()}`;

// ---------------------------------------------------------------------------
// Board pin helpers — reusable across probes
// ---------------------------------------------------------------------------

/** Pins on I2C expanders with 'relay' in connector name. */
export function relayPins(board: BoardDef): PinDef[] {
  return board.pins.filter(p => p.expander && p.connector.startsWith('relay'));
}

/** Pins on I2C expanders with 'input' in connector name. */
export function inputPins(board: BoardDef): PinDef[] {
  return board.pins.filter(p => p.expander && p.connector.startsWith('input'));
}

/** Native GPIO pins with ADC capability. */
export function adcPins(board: BoardDef): PinDef[] {
  return board.pins.filter(p => p.caps.includes('adc') && !p.expander);
}

/** Native GPIO pins with pulse_counter capability (sensor headers). */
export function sensorHeaderPins(board: BoardDef): PinDef[] {
  return board.pins.filter(p => p.caps.includes('pulse_counter') && !p.expander);
}
