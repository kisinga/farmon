// ─── Transport metadata ──────────────────────────────────────────────────────

export type TransportType = 'lorawan' | 'wifi';

/** Per-transport display metadata. Add an entry here when adding a new transport. */
export interface TransportMeta {
  label: string;
  badge: string;           // DaisyUI badge class
  credentialLabel: string; // "App Key" vs "Device Token"
}

export const TRANSPORT_META: Record<string, TransportMeta> = {
  lorawan: { label: 'LoRaWAN', badge: 'badge-primary', credentialLabel: 'App Key' },
  wifi:    { label: 'WiFi',    badge: 'badge-secondary', credentialLabel: 'Device Token' },
};

/** Get transport metadata, falling back to lorawan for unknown values. */
export function getTransportMeta(transport?: string): TransportMeta {
  return TRANSPORT_META[transport || 'lorawan'] ?? TRANSPORT_META['lorawan'];
}

// ─── Device category ─────────────────────────────────────────────────────────

/** Top-level device category: FarMon (custom firmware) vs External (third-party). */
export type DeviceCategory = 'farmon' | 'external';

// ─── Hardware model ───────────────────────────────────────────────────────────

/** Physical hardware target identifier — matches firmware/pkg/pincaps ForMCU() keys. */
export type HardwareModelId = 'rp2040' | 'lorae5' | 'heltec_v3';

/** Display info for a hardware model shown in the device provisioning UI. */
export interface HardwareModelInfo {
  id: HardwareModelId;
  label: string;
  subLabel: string;
  transports: TransportType[];
}

export const HARDWARE_MODELS: HardwareModelInfo[] = [
  { id: 'rp2040',    label: 'RP2040',      subLabel: 'Raspberry Pi Pico W',         transports: ['wifi'] },
  { id: 'lorae5',    label: 'STM32WL',     subLabel: 'Seeed LoRa-E5',               transports: ['lorawan'] },
  { id: 'heltec_v3', label: 'ESP32-S3',    subLabel: 'Heltec WiFi LoRa 32 V3 ⚗️',  transports: ['lorawan'] },
];

// ─── Device types ────────────────────────────────────────────────────────────

export interface Device {
  id: string;
  device_eui: string;
  device_name: string;
  device_type?: string;
  device_category?: DeviceCategory;
  hardware_model?: HardwareModelId;
  firmware_version?: string;
  last_seen?: string;
  is_active?: boolean;
  config_hash?: string;
  config_status?: string;    // "pending" | "synced" | "n/a"
  transport?: TransportType;
  device_token?: string;
}

export interface DeviceCommand {
  id: string;
  device_eui: string;
  name: string;
  fport: number;
  payload_type?: string;
  delivery?: string;
  command_key?: string;
}

export interface DeviceVisualization {
  id: string;
  device_eui: string;
  name: string;
  viz_type: string;
  config: Record<string, unknown>;
  sort_order: number;
}

/** Typed config shape for device_visualizations records. */
export interface VariableVizConfig {
  variable_key: string;
  chart_type: 'time_series' | 'gauge' | 'stat';
  label?: string;
  sort_order: number;
}

export interface DeviceControl {
  id: string;
  device_eui: string;
  control_key: string;
  current_state?: string;   // kept for backward compat; prefer telemetry via field_key
  mode?: string;
  manual_until?: string;
  last_change_at?: string;
  last_change_by?: string;
  display_name?: string;
  states_json?: string[];
  control_idx?: number;
  // Unified field model additions
  control_type?: 'binary' | 'multistate' | 'analog';
  field_key?: string;        // linked field key → read live value from telemetry
  pin_index?: number;
  actuator_type?: number;    // 0=Relay 1=MotorizedValve 2=Solenoid 3=PWM 4=Servo 5=DAC 6=I2CPWM
  flags?: number;
  pin2_index?: number;       // motorized valve second pin
  pulse_x100ms?: number;
  min_value?: number;        // analog range
  max_value?: number;
  bus_index?: number;        // I2C PWM
  bus_address?: number;
  bus_channel?: number;
}

export interface DeviceField {
  id: string;
  device_eui: string;
  field_key: string;
  display_name: string;
  data_type: string;
  unit?: string;
  category: string;
  min_value?: number;
  max_value?: number;
  enum_values?: unknown;
  state_class?: string;
  access?: string;
  field_idx?: number;
  // Unified field model additions
  linked_type?: 'input' | 'output' | 'compute';
  linked_key?: string;       // control_key or sensor-slot key that owns this field
  report_mode?: 'reported' | 'on_change' | 'disabled';
  expression?: string;       // compute fields only
}

/**
 * Alias for DeviceField. Use DeviceVariable in new code to match firmware terminology.
 * Every field is a variable; each variable maps to exactly one entity (input/output/compute).
 */
export type DeviceVariable = DeviceField;

export interface HistoryPoint {
  ts: string;
  value: number;
}

export interface HistoryResponse {
  eui: string;
  field: string;
  data: HistoryPoint[];
}

export interface ProvisionResponse {
  device_eui: string;
  transport: TransportType;
  app_key?: string;
  device_token?: string;
}

export interface CredentialsResponse {
  device_eui: string;
  app_key: string;
  device_token: string;
  transport: TransportType;
}

export interface ExtraCondition {
  field_idx: number;
  operator: string;
  threshold: number;
  is_control: boolean;
  logic: 'and' | 'or';
}

export interface DeviceRuleRecord {
  id: string;
  device_eui: string;
  rule_id: number;
  field_idx: number;
  operator: string;
  threshold: number;
  control_idx: number;
  action_state: number;
  priority?: number;
  cooldown_seconds?: number;
  enabled?: boolean;
  synced_at?: string;
  action_dur_x10s?: number;
  // extra conditions (C2, C3, C4)
  extra_conditions?: ExtraCondition[];
  // time window (server-managed)
  time_start?: number;
  time_end?: number;
  window_active?: boolean;
}

export interface CommandRecord {
  id: string;
  device_eui: string;
  command_key: string;
  payload?: Record<string, unknown>;
  initiated_by: string;
  status: string;
  sent_at?: string;
  acked_at?: string;
  created: string;
}

// ─── Device Spec types (for JSON import/export) ─────────────────────────────

export interface SpecField {
  key: string;
  display_name: string;
  unit?: string;
  data_type?: string;
  category?: string;
  access?: string;
  state_class?: string;
  min_value?: number;
  max_value?: number;
  sort_order: number;
  // Unified field model additions
  linked_type?: string;
  linked_key?: string;
  report_mode?: string;
}

export interface SpecControl {
  key: string;
  display_name: string;
  states: string[];
  sort_order: number;
  // Unified field model additions
  control_type?: string;
  field_key?: string;
  pin_index?: number;
  actuator_type?: number;
  flags?: number;
  pin2_index?: number;
  pulse_x100ms?: number;
  min_value?: number;
  max_value?: number;
  bus_index?: number;
  bus_address?: number;
  bus_channel?: number;
}

export interface SpecCommand {
  name: string;
  fport: number;
  payload_type?: string;
  delivery?: string;
  command_key?: string;
}

export interface SpecDecodeRule {
  fport: number;
  format: string;
  config: Record<string, unknown>;
}

/** A device-level decode rule record (stored in device_decode_rules PocketBase collection). */
export interface DeviceDecodeRule {
  id: string;
  device_eui: string;
  fport: number;
  format: 'text_kv' | 'binary_indexed' | 'binary_indexed_float32' | 'binary_state_change' | 'binary_frames';
  config: Record<string, unknown>;
}

export interface SpecVisualization {
  name: string;
  viz_type: 'time_series' | 'gauge' | 'stat';
  config: Record<string, unknown>;
  sort_order: number;
}

/** A single sensor slot in an AirConfig spec (pushed via fPort 35). */
export interface AirConfigSensor {
  type: number;         // sensor_type from catalog
  pin_index: number;    // GPIO/ADC/I2C pin; 255 = bus-addressed (no physical pin)
  field_index: number;  // field_idx of the linked variable
  flags: number;
  param1?: number;      // calib_offset_raw or pulses_per_unit depending on type
  param2?: number;      // calib_span_raw
}

export interface SpecAirConfig {
  pin_map: number[];
  sensors: AirConfigSensor[];
  controls: unknown[];
  lorawan: Record<string, unknown>;
  transfer?: Record<string, unknown>;
  config_hash?: string;
}

export interface DeviceSpec {
  type: 'airconfig' | 'codec';
  fields: SpecField[];
  controls: SpecControl[];
  commands: SpecCommand[];
  decode_rules: SpecDecodeRule[];
  visualizations: SpecVisualization[];
  airconfig?: SpecAirConfig;
}

// ─── Gateway types ───────────────────────────────────────────────────────────

export interface GatewaySettings {
  region: string;
  event_url: string;
  command_url: string;
  gateway_id: string;
  rx1_frequency_hz: number;
  test_mode: boolean;
  enabled: boolean;
  saved: boolean;
}

export interface GatewayStatusResponse {
  gateways: unknown[];
  discovered_gateway_id?: string;
}

export interface GatewaySettingsRecord {
  id: string;
  region?: string;
  event_url?: string;
  command_url?: string;
  gateway_id?: string;
  rx1_frequency_hz?: number;
  test_mode?: boolean;
  enabled?: boolean;
}

// ─── WiFi types ─────────────────────────────────────────────────────────────

export interface WifiSettings {
  enabled: boolean;
  test_mode: boolean;
  saved: boolean;
}

export interface WifiSettingsRecord {
  id: string;
  enabled?: boolean;
  test_mode?: boolean;
}

export interface PipelineDebug {
  concentratord_configured: boolean;
  config_status: 'valid' | 'missing_record' | 'empty_event_url' | 'empty_command_url' | 'empty_region';
  gateway_id_set: boolean;
  gateway_id: string;
  event_url?: string;
  command_url?: string;
}

export interface RawLorawanFrame {
  time: string;
  direction: 'up' | 'down';
  dev_eui: string;
  f_port: number;
  kind: string;
  payload_hex: string;
  phy_len: number;
  rssi?: number;
  snr?: number;
  gateway_id?: string;
  error?: string;
  decoded_json?: Record<string, unknown>;
}

export interface LorawanStats {
  buffer_size: number;
  total_uplinks: number;
  total_downlinks: number;
  concentratord_configured: boolean;
}

// ─── Workflow types ──────────────────────────────────────────────────────────

export interface WorkflowTrigger {
  type: 'telemetry' | 'state_change' | 'checkin' | 'schedule';
  filter?: { device_eui?: string; field?: string; control_key?: string };
  cron?: string;              // for 'schedule' type
  debounce_seconds?: number;
}

export interface WorkflowAction {
  type: 'set_control' | 'send_command';
  target_eui: string;
  control?: string;
  state?: string;
  duration?: number;
  command?: string;
  value?: number;
}

export interface WorkflowRecord {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  priority?: number;
  cooldown_seconds?: number;
  triggers: WorkflowTrigger[];
  condition_expr: string;
  actions: WorkflowAction[];
}

export interface WorkflowLogRecord {
  id: string;
  workflow_id: string;
  workflow_name?: string;
  trigger_device?: string;
  trigger_type?: string;
  trigger_index?: number;
  condition_result: boolean;
  actions_completed?: number;
  status: string;
  error_message?: string;
  affected_devices?: string[];
  context_snapshot?: Record<string, unknown>;
  ts: string;
}

// ─── State change event log ──────────────────────────────────────────────────

export interface StateChangeRecord {
  id: string;
  device_eui: string;
  control_key: string;
  old_state: string;
  new_state: string;
  reason: string;   // "RULE" | "MANUAL" | "DOWNLINK" | "BOOT"
  device_ts?: string;
  ts: string;
}

// ─── Firmware Commands ───────────────────────────────────────────────────────

export interface FirmwareCommand {
  command_key: string;
  name: string;
  fport: number;
  payload_type: 'empty' | 'uint32';
  description?: string;
}

export interface BackendInfo {
  supported_firmware_versions: string[];
}

// ─── IO Catalog (sourced from firmware/pkg/catalog) ─────────────────────────

export interface MeasurementInfo {
  id: string;
  label: string;
  unit: string;
  default_min: number;
  default_max: number;
}

export interface SensorPresetInfo {
  id: string;
  label: string;
  description?: string;
  interface: string;
  measurement: string;
  field_count: number;
  calib_min: number;
  calib_max: number;
  pulses_per_unit?: number;
  i2c_addr?: number;
  modbus_dev_addr?: number;
  modbus_func_code?: number;
}

// ─── Unified Driver Catalog ─────────────────────────────────────────────────

export type IOType = 'i2c' | 'spi' | 'gpio' | 'adc' | 'onewire' | 'uart' | 'pulse' | 'pwm' | 'dac' | 'internal';
export type DriverStatus = 'ready' | 'deferred';
export type DriverDirection = 'input' | 'output' | 'both';

export interface DriverFieldDef {
  measurement_id: string;
  label: string;
  unit: string;
  default_min: number;
  default_max: number;
}

export interface DriverDef {
  id: string;
  label: string;
  description: string;
  direction: DriverDirection;
  io_type: IOType;
  tinygo_package?: string;
  custom_driver: boolean;
  sensor_type?: number;
  actuator_type?: number;
  field_count: number;
  fields: DriverFieldDef[];
  default_i2c_addr?: number;
  needs_calib: boolean;
  pin_count: number;
  pin_functions?: number[];
  pin_labels?: string[];
  bus_pin_functions?: number[];
  bus_addressed: boolean;
  has_pulse?: boolean;
  analog?: boolean;
  hint?: string;
  sub_types?: string[];
  supported_targets: string[];
  status: DriverStatus;
}

/** IO catalog — single source of truth for both input and output drivers. */
export interface IOCatalog {
  drivers: DriverDef[];
  measurements: MeasurementInfo[];
  field_counts: Record<string, number>;
  presets?: SensorPresetInfo[];
}

/** Returns true if a driver can act as an input (sensor). */
export function isInputDriver(d: DriverDef): boolean { return d.direction === 'input' || d.direction === 'both'; }
/** Returns true if a driver can act as an output (actuator). */
export function isOutputDriver(d: DriverDef): boolean { return d.direction === 'output' || d.direction === 'both'; }

// ─── AirConfig Validation ────────────────────────────────────────────────────

export interface AirConfigValidationError {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface AirConfigValidationResult {
  errors: AirConfigValidationError[];
  warnings: AirConfigValidationError[];
}

// ─── Board info (pin definitions from backend boardinfo package) ─────────────

export type PinEdge = 'top' | 'bottom' | 'left' | 'right';

export interface BoardPinDef {
  firmware_idx: number;
  gpio_label: string;
  connector_id: string;
  edge: PinEdge;
}

export interface InternalOutput {
  actuator_type: number;
  label: string;
  gpio_num: number;
}

export interface BoardDefinition {
  model: string;
  label: string;
  svg_url: string;
  rotate_deg?: number;
  pins: BoardPinDef[];
  internal_outputs?: InternalOutput[];
}

// ─── Pin capabilities ────────────────────────────────────────────────────────

export interface PinInfo {
  pin: number;
  functions: number[];
  label: string;
}

export interface PinCapabilitiesResponse {
  mcu: string;
  pins: PinInfo[];
}

// ─── Actuator type helpers (derived from DriverDef properties) ───────────────

/** Returns true for analog output drivers. */
export function isAnalogActuator(type: number): boolean { return [3, 4, 5, 6].includes(type); }
/** Returns true for bus-addressed actuators (I2C PWM). */
export function isBusActuator(type: number): boolean { return type === 6; }
/** Returns true for internal actuators (onboard LED, NeoPixel). */
export function isInternalActuator(type: number): boolean { return type === 7 || type === 8; }

// ─── Shared validation ───────────────────────────────────────────────────────

/** General-purpose validation error, used across forms and firmware constraint checks. */
export interface ValidationError {
  field?: string;
  message: string;
  severity: 'error' | 'warning';
}

// ─── Internal helpers ────────────────────────────────────────────────────────

export interface TelemetryRecord {
  ts?: string;
  created?: string;
  data?: string | Record<string, unknown>;
  rssi?: number;
  snr?: number;
}
