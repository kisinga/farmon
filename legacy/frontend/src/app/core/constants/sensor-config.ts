// Sensor configuration helpers — pure TypeScript, no Angular imports.
// Data constants (interfaces, measurements, presets) are now served from
// the Go catalog at GET /api/farmon/sensor-catalog. Only calibration
// helpers and suggested rules remain here.

export type MeasurementType =
  | 'temperature'
  | 'humidity'
  | 'pressure'
  | 'flow_rate'
  | 'volume'
  | 'co2'
  | 'ph'
  | 'level'
  | 'current'
  | 'voltage'
  | 'power'
  | 'battery'
  | 'soil_moisture'
  | 'state'
  | 'custom';

// --- Calibration encoding helpers ---

/** Encode a physical minimum value to Param1 (int16 × 10, stored as uint16 bits). */
export function encodeCalibOffset(physMin: number): number {
  return Math.round(physMin * 10) & 0xFFFF; // int16 → uint16 bit pattern
}

/** Encode physical range (max - min) to Param2 (uint16 × 10). */
export function encodeCalibSpan(physMin: number, physMax: number): number {
  return Math.max(0, Math.round((physMax - physMin) * 10)) & 0xFFFF;
}

/** Decode Param1 back to physical offset (uint16 bits → int16 → float). */
export function decodeCalibOffset(param1: number): number {
  const signed = param1 > 0x7FFF ? param1 - 0x10000 : param1;
  return signed / 10;
}

/** Decode Param2 back to physical span. */
export function decodeCalibSpan(param2: number): number {
  return param2 / 10;
}

/**
 * Single-point trim: compute new offset after comparing a live reading to expected value.
 * Returns the adjusted CalibOffset float.
 */
export function applyTrim(currentOffsetFloat: number, currentReading: number, expectedValue: number): number {
  return currentOffsetFloat + (expectedValue - currentReading);
}

// --- Suggested rules per measurement type ---

export interface RuleSuggestion {
  label: string;
  operator: '>' | '<' | '>=' | '<=' | '==' | '!=';
  threshold: number;
  note: string;
}

export const SUGGESTED_RULES: Partial<Record<MeasurementType, RuleSuggestion[]>> = {
  temperature: [
    { label: 'High temp alert',  operator: '>',  threshold: 50,  note: 'Trigger cooling or alert when above 50°C' },
    { label: 'Frost alert',      operator: '<',  threshold: 2,   note: 'Protect crops from freezing' },
  ],
  soil_moisture: [
    { label: 'Start irrigation', operator: '<',  threshold: 30,  note: 'Irrigate when soil drops below 30%' },
    { label: 'Stop irrigation',  operator: '>',  threshold: 70,  note: 'Stop pump when soil reaches 70%' },
  ],
  flow_rate: [
    { label: 'Flow too low',     operator: '<',  threshold: 1,   note: 'Alert if no flow detected during irrigation' },
    { label: 'Flow too high',    operator: '>',  threshold: 25,  note: 'Possible pipe burst' },
  ],
  battery: [
    { label: 'Low battery',      operator: '<',  threshold: 20,  note: 'Alert before device shuts down' },
  ],
  ph: [
    { label: 'pH too low',       operator: '<',  threshold: 6,   note: 'Acidic — add buffer solution' },
    { label: 'pH too high',      operator: '>',  threshold: 8,   note: 'Alkaline — adjust nutrient solution' },
  ],
  level: [
    { label: 'Tank full',        operator: '>',  threshold: 450, note: 'Close inlet valve' },
    { label: 'Tank low',         operator: '<',  threshold: 50,  note: 'Open refill valve' },
  ],
  current: [
    { label: 'Overcurrent',      operator: '>',  threshold: 5,   note: 'Possible motor overload' },
  ],
};
