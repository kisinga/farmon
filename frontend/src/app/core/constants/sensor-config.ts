// Sensor configuration taxonomy — pure TypeScript, no Angular imports.
// Mirrors the SensorType enum in firmware/lorae5/pkg/settings/settings.go.

export type SensorInterface =
  | 'adc_linear'
  | 'adc_4_20ma'
  | 'onewire'
  | 'i2c_bme280'
  | 'i2c_ina219'
  | 'pulse'
  | 'modbus_rtu';

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
  | 'custom';

// Firmware SensorType numeric values (must match settings.go)
export const SENSOR_TYPE = {
  None:          0,
  FlowYFS201:    1,
  BatteryADC:    2,
  DS18B20:       3,
  SoilADC:       4,
  BME280:        5,
  INA219:        6,
  ADCLinear:     7,
  ADC4_20mA:     8,
  PulseGeneric:  9,
  ModbusRTU:    10,
} as const;

export interface SensorInterfaceConfig {
  id: SensorInterface;
  label: string;
  sensorType: number;   // firmware SensorType value
  needsCalib: boolean;  // whether offset/span calibration is used for Param1/Param2
  busAddressed: boolean; // true if PinIndex is a bus index (I2C/UART), not a GPIO
}

export const SENSOR_INTERFACES: SensorInterfaceConfig[] = [
  { id: 'adc_linear',  label: 'Analog (0-VREF Linear)',   sensorType: SENSOR_TYPE.ADCLinear,    needsCalib: true,  busAddressed: false },
  { id: 'adc_4_20ma',  label: 'Analog (4-20mA Loop)',     sensorType: SENSOR_TYPE.ADC4_20mA,    needsCalib: true,  busAddressed: false },
  { id: 'onewire',     label: '1-Wire (DS18B20)',          sensorType: SENSOR_TYPE.DS18B20,      needsCalib: false, busAddressed: false },
  { id: 'i2c_bme280',  label: 'I2C — BME280 (T/H/P)',     sensorType: SENSOR_TYPE.BME280,       needsCalib: false, busAddressed: true  },
  { id: 'i2c_ina219',  label: 'I2C — INA219 (V/I/W)',     sensorType: SENSOR_TYPE.INA219,       needsCalib: false, busAddressed: true  },
  { id: 'pulse',       label: 'Pulse Counter',             sensorType: SENSOR_TYPE.PulseGeneric, needsCalib: false, busAddressed: false },
  { id: 'modbus_rtu',  label: 'Modbus RTU (RS-485)',       sensorType: SENSOR_TYPE.ModbusRTU,    needsCalib: false, busAddressed: true  },
];

export interface MeasurementTypeConfig {
  id: MeasurementType;
  label: string;
  unit: string;
  defaultMin: number;
  defaultMax: number;
}

export const MEASUREMENT_TYPES: MeasurementTypeConfig[] = [
  { id: 'temperature',  label: 'Temperature',    unit: '°C',  defaultMin: -40,  defaultMax: 125  },
  { id: 'humidity',     label: 'Humidity',       unit: '%RH', defaultMin: 0,    defaultMax: 100  },
  { id: 'pressure',     label: 'Pressure',       unit: 'hPa', defaultMin: 900,  defaultMax: 1100 },
  { id: 'flow_rate',    label: 'Flow Rate',      unit: 'L/m', defaultMin: 0,    defaultMax: 60   },
  { id: 'volume',       label: 'Volume',         unit: 'L',   defaultMin: 0,    defaultMax: 1000 },
  { id: 'co2',          label: 'CO₂',            unit: 'ppm', defaultMin: 400,  defaultMax: 5000 },
  { id: 'ph',           label: 'pH',             unit: 'pH',  defaultMin: 0,    defaultMax: 14   },
  { id: 'level',        label: 'Level',          unit: 'cm',  defaultMin: 0,    defaultMax: 500  },
  { id: 'current',      label: 'Current',        unit: 'A',   defaultMin: 0,    defaultMax: 10   },
  { id: 'voltage',      label: 'Voltage',        unit: 'V',   defaultMin: 0,    defaultMax: 60   },
  { id: 'power',        label: 'Power',          unit: 'W',   defaultMin: 0,    defaultMax: 500  },
  { id: 'battery',      label: 'Battery',        unit: '%',   defaultMin: 0,    defaultMax: 100  },
  { id: 'soil_moisture',label: 'Soil Moisture',  unit: '%',   defaultMin: 0,    defaultMax: 100  },
  { id: 'custom',       label: 'Custom',         unit: '',    defaultMin: 0,    defaultMax: 100  },
];

export interface SensorPreset {
  id: string;
  label: string;
  description?: string;
  interface: SensorInterface;
  measurement: MeasurementType;
  calibMin: number;
  calibMax: number;
  pulsesPerUnit?: number; // for pulse-type sensors (stored in Param1)
  i2cAddr?: number;       // for I2C sensors (stored in Param1 lo byte)
  modbusDevAddr?: number; // for Modbus sensors
  modbusFuncCode?: number;
}

export const SENSOR_PRESETS: SensorPreset[] = [
  {
    id: 'tl136',
    label: 'TL-136 Temperature (4-20mA)',
    description: 'Common 4-20mA temperature transmitter, -40–125°C',
    interface: 'adc_4_20ma',
    measurement: 'temperature',
    calibMin: -40,
    calibMax: 125,
  },
  {
    id: 'yfs201',
    label: 'YF-S201 Water Flow (Pulse)',
    description: 'Pulse flow meter, 1–30 L/min, 450 pulses/L',
    interface: 'pulse',
    measurement: 'flow_rate',
    calibMin: 0,
    calibMax: 30,
    pulsesPerUnit: 450,
  },
  {
    id: 'ds18b20',
    label: 'DS18B20 Temperature (1-Wire)',
    description: 'Waterproof digital temperature sensor, -55–125°C',
    interface: 'onewire',
    measurement: 'temperature',
    calibMin: -55,
    calibMax: 125,
  },
  {
    id: 'bme280',
    label: 'BME280 Temp/Hum/Pressure (I2C)',
    description: 'Bosch environmental sensor; 3 fields (T/H/P)',
    interface: 'i2c_bme280',
    measurement: 'temperature',
    calibMin: -40,
    calibMax: 85,
    i2cAddr: 0x76,
  },
  {
    id: 'ina219',
    label: 'INA219 Current/Voltage (I2C)',
    description: 'TI current sensor; 3 fields (V/I/W)',
    interface: 'i2c_ina219',
    measurement: 'current',
    calibMin: 0,
    calibMax: 3.2,
    i2cAddr: 0x40,
  },
  {
    id: 'soil_cap',
    label: 'Capacitive Soil Moisture (ADC)',
    description: 'Generic capacitive soil sensor; calibrate dry/wet raw counts in device settings',
    interface: 'adc_linear',
    measurement: 'soil_moisture',
    calibMin: 0,
    calibMax: 100,
  },
  {
    id: 'ph_4_20',
    label: 'pH Sensor (4-20mA)',
    description: 'Analog pH transmitter, 0–14 pH',
    interface: 'adc_4_20ma',
    measurement: 'ph',
    calibMin: 0,
    calibMax: 14,
  },
  {
    id: 'level_4_20',
    label: 'Water Level (4-20mA)',
    description: 'Hydrostatic level transmitter, 0–5m',
    interface: 'adc_4_20ma',
    measurement: 'level',
    calibMin: 0,
    calibMax: 500,
  },
];

// How many telemetry fields each sensor type produces (matching FieldCount() in registry.go)
export const SENSOR_FIELD_COUNT: Record<number, number> = {
  [SENSOR_TYPE.BME280]:       3, // temp, humidity, pressure
  [SENSOR_TYPE.INA219]:       3, // voltage, current, power
  [SENSOR_TYPE.FlowYFS201]:   2, // pulse delta, total volume
  [SENSOR_TYPE.PulseGeneric]: 2, // pulse delta, total count
  // all others: 1
};

export function sensorFieldCount(sensorType: number): number {
  return SENSOR_FIELD_COUNT[sensorType] ?? 1;
}

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
