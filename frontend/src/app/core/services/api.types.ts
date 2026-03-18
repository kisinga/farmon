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

/** Per-device-id-format metadata. Driven by DeviceTarget.device_id_format, not transport. */
export interface DeviceIDFormatMeta {
  label: string;        // "Device EUI" vs "MAC Address" vs "Device ID"
  placeholder: string;
  minLength: number;
  maxLength: number;
  hint: string;
}

export const DEVICE_ID_FORMATS: Record<string, DeviceIDFormatMeta> = {
  eui64:  { label: 'Device EUI',  placeholder: 'e.g. 0102030405060708', minLength: 16, maxLength: 16, hint: '16 hex characters (EUI-64)' },
  mac:    { label: 'MAC Address', placeholder: 'e.g. aabbccddeeff',     minLength: 12, maxLength: 12, hint: '12 hex characters (MAC-48)' },
  custom: { label: 'Device ID',   placeholder: 'e.g. 0102030405060708', minLength: 8,  maxLength: 16, hint: '8–16 hex characters' },
};

export function getDeviceIDFormat(format?: string): DeviceIDFormatMeta {
  return DEVICE_ID_FORMATS[format || 'custom'] ?? DEVICE_ID_FORMATS['custom'];
}

// ─── Device types ────────────────────────────────────────────────────────────

export interface Device {
  id: string;
  device_eui: string;
  device_name: string;
  device_type?: string;
  firmware_version?: string;
  last_seen?: string;
  is_active?: boolean;
  profile?: string;          // profile ID (relation)
  config_overrides?: unknown;
  config_hash?: string;
  config_status?: string;    // "pending" | "synced" | "n/a"
  transport?: TransportType;
  device_token?: string;
  target_id?: string;
}

export interface DeviceTarget {
  id: string;
  name: string;
  description: string;
  transport: TransportType | '';
  default_profile: string;
  default_profile_id: string;
  credential_type: 'app_key' | 'device_token' | '';
  device_id_format: 'eui64' | 'mac' | 'custom';
}

export interface DeviceControl {
  id: string;
  device_eui: string;
  control_key: string;
  current_state: string;
  mode?: string;
  manual_until?: string;
  last_change_at?: string;
  last_change_by?: string;
  display_name?: string;
  states_json?: string[];
  control_idx?: number;
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
}

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
  profile_name?: string;
  warning?: string;
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

// ─── Profile types ───────────────────────────────────────────────────────────

export interface ProfileField {
  id: string;
  key: string;
  display_name: string;
  unit?: string;
  data_type?: string;
  category?: string;
  access?: string;
  state_class?: string;
  min_value?: number;
  max_value?: number;
  enum_values?: unknown;
  sort_order: number;
}

export interface ProfileControl {
  id: string;
  key: string;
  display_name: string;
  states: string[];
  sort_order: number;
}

export interface ProfileCommand {
  id: string;
  name: string;
  fport: number;
  payload_type?: string;
  delivery?: string;
  command_key?: string;
}

export interface DecodeRule {
  id: string;
  fport: number;
  format: string;
  config: Record<string, unknown>;
}

export interface ProfileVisualization {
  id: string;
  name: string;
  viz_type: 'time_series' | 'gauge' | 'stat';
  config: Record<string, unknown>;
  sort_order: number;
}

export interface ProfileAirConfig {
  id: string;
  pin_map: number[];
  sensors: unknown[];
  controls: unknown[];
  lorawan: Record<string, unknown>;
  transfer?: Record<string, unknown>;  // Water Manager transfer FSM config
  config_hash?: string;
}

export interface DeviceProfile {
  id: string;
  name: string;
  description?: string;
  profile_type: 'airconfig' | 'codec';
  transport?: '' | 'lorawan' | 'wifi' | 'any';
  is_template: boolean;
  fields: ProfileField[];
  controls: ProfileControl[];
  commands: ProfileCommand[];
  decode_rules: DecodeRule[];
  visualizations: ProfileVisualization[];
  airconfig?: ProfileAirConfig;
}

export interface ProfileSummary {
  id: string;
  name: string;
  description?: string;
  profile_type: string;
  transport?: '' | 'lorawan' | 'wifi' | 'any';
  is_template: boolean;
}

// ─── Gateway types ───────────────────────────────────────────────────────────

export interface GatewaySettings {
  region: string;
  event_url: string;
  command_url: string;
  gateway_id: string;
  rx1_frequency_hz: number;
  test_mode: boolean;
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

// ─── Sensor Catalog (sourced from firmware/pkg/catalog) ─────────────────────

export interface SensorInterfaceInfo {
  id: string;
  label: string;
  sensor_type: number;
  needs_calib: boolean;
  bus_addressed: boolean;
}

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

export interface SensorCatalog {
  interfaces: SensorInterfaceInfo[];
  measurements: MeasurementInfo[];
  presets: SensorPresetInfo[];
  field_counts: Record<string, number>;
}

// ─── Internal helpers ────────────────────────────────────────────────────────

export interface TelemetryRecord {
  ts?: string;
  created?: string;
  data?: string | Record<string, unknown>;
  rssi?: number;
  snr?: number;
}
