/**
 * firmware-constraints.ts
 *
 * Pure functions and constants encoding the firmware's binary format limits.
 * No Angular DI — import these anywhere without injection.
 *
 * Sources:
 *   backend/rule_builder.go   — rule binary layout (24 bytes, max 9 per push)
 *   backend/spec.go           — field/control index encoding
 *   firmware/pkg/settings/settings.go — PinFunction constants
 */

import { DeviceRuleRecord, DeviceVariable, TransportType, ValidationError } from '../services/api.types';

// ─── Hard limits ─────────────────────────────────────────────────────────────

/** Maximum rules per device (222 bytes / 24 bytes each = 9.25, truncated). */
export const MAX_RULES = 9;

/** Maximum field index encodable in rule binary payload (uint8). */
export const MAX_FIELD_INDEX = 255;

/** Maximum sensor slots supported by firmware hardware layer. */
export const MAX_SENSOR_SLOTS = 8;

/** Maximum compute fields per device. */
export const MAX_COMPUTE_FIELDS = 16;

/** Maximum bytecode length per compute expression (bytes). */
export const MAX_BYTECODE_LEN = 64;

/**
 * Extra condition thresholds are encoded as uint8 in the rule binary (0–255).
 * Primary condition thresholds are float32 and have no integer restriction.
 */
export const MAX_EXTRA_CONDITION_THRESHOLD = 255;
export const MIN_EXTRA_CONDITION_THRESHOLD = 0;

/** Rule action duration is encoded as uint8 × 10 seconds (0 = hold indefinitely). */
export const MAX_ACTION_DURATION_X10S = 255;

/** Rule cooldown is encoded as uint16 LE (0–65535 seconds ≈ 18.2 hours). */
export const MAX_COOLDOWN_SECONDS = 65535;

/** Rule ID is uint8 (0–255). */
export const MAX_RULE_ID = 255;

/** Pin index hardware range. */
export const MIN_PIN_INDEX = 0;
export const MAX_PIN_INDEX = 19;

// ─── Pin function codes (firmware pin_map encoding) ──────────────────────────
//
// Must stay in sync with firmware/pkg/settings/settings.go PinFunction constants.
//
export const PIN_FUNCTION = {
  NONE:       0,
  FLOW:       1,   // interrupt-driven pulse (flow sensors)
  RELAY:      2,   // digital output — relay, pump, valve
  BUTTON:     3,   // digital input (GPIO)
  ADC:        4,   // analog read
  I2C_SDA:    5,
  I2C_SCL:    6,
  ONEWIRE:    7,   // 1-Wire bus (DS18B20)
  UART_TX:    8,   // RS-485 / Modbus TX
  UART_RX:    9,   // RS-485 / Modbus RX
  LED:        10,
  COUNTER:    11,  // generic pulse counter
  RS485_DE:   12,  // RS-485 direction-enable
  PWM:        13,  // PWM output
  DAC:        14,  // DAC analog output (STM32 only)
} as const;

export type PinFunctionName =
  | 'relay'   // digital output (Relay, Solenoid, Motorized Valve)
  | 'adc'     // analog input
  | 'button'  // digital input (GPIO sensor)
  | 'counter' // pulse counter
  | 'onewire' // 1-Wire bus
  | 'i2c'     // I2C bus (SDA or SCL)
  | 'uart'    // UART (TX or RX)
  | 'pwm'     // PWM output
  | 'dac'     // DAC output
  | 'unused';

/** Map a numeric pin_map value to a human-readable function name. */
export function pinFunctionName(code: number): PinFunctionName {
  switch (code) {
    case PIN_FUNCTION.RELAY:    return 'relay';
    case PIN_FUNCTION.BUTTON:   return 'button';
    case PIN_FUNCTION.ADC:      return 'adc';
    case PIN_FUNCTION.I2C_SDA:
    case PIN_FUNCTION.I2C_SCL:  return 'i2c';
    case PIN_FUNCTION.ONEWIRE:  return 'onewire';
    case PIN_FUNCTION.UART_TX:
    case PIN_FUNCTION.UART_RX:  return 'uart';
    case PIN_FUNCTION.COUNTER:  return 'counter';
    case PIN_FUNCTION.FLOW:     return 'counter'; // flow uses interrupt but same pool
    case PIN_FUNCTION.PWM:      return 'pwm';
    case PIN_FUNCTION.DAC:      return 'dac';
    default:                    return 'unused';
  }
}

/** Returns true if the pin supports the requested function. */
export function pinSupportsFunction(pinCode: number, fn: PinFunctionName): boolean {
  return pinFunctionName(pinCode) === fn;
}

// ─── Active variable budget per transport ─────────────────────────────────────

/**
 * Returns the maximum number of active (report_mode='active') variables for
 * a given transport. WiFi has no practical limit; LoRaWAN limits depend on DR.
 * Conservative default for LoRaWAN: DR0 allows ~11 fields at SF12/125kHz.
 */
export function getFieldBudget(transport: TransportType, _dr?: number): number {
  if (transport === 'wifi') return 64;
  // LoRaWAN: each active field = 5 bytes (1 idx + 4 float32)
  // DR0 max payload = ~51 bytes → ~10 fields; use 10 as safe default
  return 10;
}

// ─── Field index utilities ────────────────────────────────────────────────────

/**
 * Returns the next available field index not already used by any variable.
 * Always fills the lowest available gap — never exceeds MAX_FIELD_INDEX.
 */
export function nextAvailableFieldIndex(fields: DeviceVariable[]): number {
  const used = new Set(fields.map(f => f.field_idx ?? -1));
  for (let i = 0; i <= MAX_FIELD_INDEX; i++) {
    if (!used.has(i)) return i;
  }
  return -1; // all 256 slots used — caller should show error
}

/** Resolve a field index to its field_key, or undefined if not found. */
export function fieldIndexToKey(fields: DeviceVariable[], idx: number): string | undefined {
  return fields.find(f => f.field_idx === idx)?.field_key;
}

/** Resolve a field_key to its field index, or undefined if not found. */
export function fieldKeyToIndex(fields: DeviceVariable[], key: string): number | undefined {
  return fields.find(f => f.field_key === key)?.field_idx;
}

/** Resolve a field index to its display_name, falling back to field_key then raw index. */
export function fieldIndexToLabel(fields: DeviceVariable[], idx: number): string {
  const f = fields.find(v => v.field_idx === idx);
  if (!f) return `field[${idx}]`;
  return f.display_name || f.field_key;
}

// ─── Rule ID management ───────────────────────────────────────────────────────

/**
 * Returns the next safe rule ID for a new rule.
 * Uses max(existing rule_ids) + 1 rather than rules.length, so deletions
 * don't cause ID collisions.
 */
export function nextRuleId(rules: DeviceRuleRecord[]): number {
  if (rules.length === 0) return 0;
  return Math.min(Math.max(...rules.map(r => r.rule_id)) + 1, MAX_RULE_ID);
}

// ─── Extra condition threshold validation ─────────────────────────────────────

/** Extra condition thresholds must be uint8 integers (0–255). */
export function isValidExtraConditionThreshold(value: number): boolean {
  return Number.isInteger(value) && value >= MIN_EXTRA_CONDITION_THRESHOLD && value <= MAX_EXTRA_CONDITION_THRESHOLD;
}

/** Clamp a value to the valid extra condition threshold range. */
export function clampExtraConditionThreshold(value: number): number {
  return Math.max(MIN_EXTRA_CONDITION_THRESHOLD, Math.min(MAX_EXTRA_CONDITION_THRESHOLD, Math.round(value)));
}

// ─── Rule set validation ─────────────────────────────────────────────────────

/**
 * Validate a full rule set against firmware constraints.
 * Returns an array of ValidationError (empty = valid).
 */
export function validateRuleSet(rules: DeviceRuleRecord[], fields: DeviceVariable[]): ValidationError[] {
  const errors: ValidationError[] = [];
  const fieldIndices = new Set(fields.map(f => f.field_idx ?? -1));

  if (rules.length > MAX_RULES) {
    errors.push({
      severity: 'error',
      message: `Too many rules: ${rules.length} / ${MAX_RULES} maximum. Remove ${rules.length - MAX_RULES} rule(s) before syncing.`,
    });
  }

  const ruleIds = rules.map(r => r.rule_id);
  const uniqueIds = new Set(ruleIds);
  if (uniqueIds.size !== ruleIds.length) {
    errors.push({ severity: 'error', message: 'Duplicate rule IDs detected. Re-save affected rules to reassign IDs.' });
  }

  for (const rule of rules) {
    if (!fieldIndices.has(rule.field_idx)) {
      errors.push({
        severity: 'error',
        field: `rule_${rule.rule_id}`,
        message: `Rule ${rule.rule_id}: primary condition references field index ${rule.field_idx} which no longer exists.`,
      });
    }
    if (rule.field_idx > MAX_FIELD_INDEX) {
      errors.push({
        severity: 'error',
        field: `rule_${rule.rule_id}`,
        message: `Rule ${rule.rule_id}: field index ${rule.field_idx} exceeds maximum (${MAX_FIELD_INDEX}).`,
      });
    }
    for (const ec of rule.extra_conditions ?? []) {
      if (!isValidExtraConditionThreshold(ec.threshold)) {
        errors.push({
          severity: 'error',
          field: `rule_${rule.rule_id}_extra`,
          message: `Rule ${rule.rule_id}: extra condition threshold ${ec.threshold} must be an integer 0–255.`,
        });
      }
    }
  }

  return errors;
}

// ─── Compute expression validation ───────────────────────────────────────────

/**
 * Extracts all field index references (f0, f1, f12, ...) from a compute expression.
 * Returns the set of referenced indices.
 */
export function extractExpressionFieldRefs(expression: string): number[] {
  const matches = expression.match(/\bf(\d+)\b/g) ?? [];
  return [...new Set(matches.map(m => parseInt(m.slice(1), 10)))];
}

/**
 * Returns field indices referenced in the expression that don't exist in the field list.
 * Use to show warnings in the compute variable editor.
 */
export function danglingExpressionRefs(expression: string, fields: DeviceVariable[]): number[] {
  const fieldIndices = new Set(fields.map(f => f.field_idx ?? -1));
  return extractExpressionFieldRefs(expression).filter(idx => !fieldIndices.has(idx));
}

// ─── Field deletion safety ────────────────────────────────────────────────────

/**
 * Returns all rules whose primary condition or extra conditions reference the given field index.
 * Call this before allowing a variable to be deleted.
 */
export function rulesReferencingFieldIndex(rules: DeviceRuleRecord[], fieldIdx: number): DeviceRuleRecord[] {
  return rules.filter(r =>
    r.field_idx === fieldIdx ||
    (r.extra_conditions ?? []).some(ec => ec.field_idx === fieldIdx)
  );
}
