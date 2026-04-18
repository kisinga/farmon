/**
 * I/O Provider types — transport abstraction for entity codegen.
 *
 * Entities declare what capability they need (adc, digital_out, pulse_counter).
 * A provider driver resolves how to access it (native GPIO, PCF8574, Modbus,
 * analog MUX, I2C ADC). Entity business logic stays identical.
 */

import type { PinCap } from './board.types';

// ---------------------------------------------------------------------------
// Entity → Transport (what the entity tells the driver)
// ---------------------------------------------------------------------------

export interface ChannelUsage {
  purpose: 'digital_out' | 'digital_in' | 'adc' | 'pulse_counter';
  inverted?: boolean;
  mode?: string;
}

// ---------------------------------------------------------------------------
// Transport → Entity (what the driver tells the entity)
// ---------------------------------------------------------------------------

export interface ResolvedChannel {
  /** ESPHome platform name (e.g., 'adc', 'gpio', 'pulse_counter', 'modbus_controller', 'cd74hc4067') */
  platform: string;
  /**
   * Pre-indented YAML config fragment at 2-space level (under `- platform:`).
   *
   * resolvePinYaml's internal `\n    ` (4-space) joiner composes correctly
   * when placed after `pin:\n    ` — the indentation nests naturally.
   *
   * Examples:
   *   Native ADC:  "pin:\n    number: GPIO36\n  attenuation: 12db"
   *   Expander:    "pin:\n    pcf8574: exp1\n    number: 2\n    mode: ...\n    inverted: true"
   *   Modbus ADC:  "modbus_controller_id: exp1\n  address: 0x0002\n  register_type: input\n  value_type: U_WORD"
   *   Analog MUX:  "number: 3\n  sensor: mux1_adc\n  cd74hc4067_id: mux1"
   */
  config: string;
}

// ---------------------------------------------------------------------------
// Channel enumeration (for UI pin selector)
// ---------------------------------------------------------------------------

export interface IoChannel {
  /** Fully qualified channel ID: "GPIO36", "mux1:CH3", "io_exp1:DO5" */
  fqid: string;
  /** Short label for UI: "GPIO36", "CH3", "DO5" */
  label: string;
  /** Capabilities this channel supports */
  caps: PinCap[];
  /** Provider that owns this channel */
  provider: string;
}

// ---------------------------------------------------------------------------
// Driver interface (context-free — config bound at factory time)
// ---------------------------------------------------------------------------

/**
 * A provider driver instance. Created by a type-safe factory that closes
 * over its config. No generics, no casts, storable in a plain Map.
 *
 * Factories:
 *   createBoardDriver(board: BoardDef) → IoProviderDriver
 *   createMuxDriver(config: MuxConfig, resolvePin: ...) → IoProviderDriver   (future)
 *   createModbusAdcDriver(config: ModbusAdcConfig) → IoProviderDriver        (future)
 */
export interface IoProviderDriver {
  /** List available channels with their capabilities. */
  enumerate(): IoChannel[];

  /** Resolve a channel ID + usage to ESPHome YAML. */
  resolve(channelId: string, usage: ChannelUsage): ResolvedChannel;

  /** Board pins consumed by this provider's infrastructure (auto-reserved). */
  consumedPins?(): string[];
}
