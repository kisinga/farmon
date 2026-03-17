import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, from, map, combineLatest, catchError, of, switchMap } from 'rxjs';
import { PocketBaseService } from './pocketbase.service';

const API = '/api/farmon';

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

// ─── Profile types ──────────────────────────────────────────

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

@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);
  private pb = inject(PocketBaseService).pb;

  // ─── Devices ────────────────────────────────────────────

  getDevices(): Observable<{ items: Device[] }> {
    return from(
      this.pb.collection<Device>('devices').getList(1, 100, { requestKey: 'devices-list' })
    ).pipe(map((res) => ({ items: res.items })));
  }

  getDeviceConfig(eui: string): Observable<Device> {
    const filter = this.pb.filter('device_eui = {:eui}', { eui });
    return from(
      this.pb.collection<Device>('devices').getFirstListItem(filter, { requestKey: `device-${eui}` })
    );
  }

  getDeviceControls(eui: string): Observable<DeviceControl[]> {
    const filter = this.pb.filter('device_eui = {:eui}', { eui });
    return from(
      this.pb.collection<DeviceControl>('device_controls').getList(1, 50, { filter, requestKey: `controls-${eui}` })
    ).pipe(map((res) => res.items));
  }

  getDeviceFields(eui: string): Observable<DeviceField[]> {
    const filter = this.pb.filter('device_eui = {:eui}', { eui });
    return from(
      this.pb.collection<DeviceField>('device_fields').getList(1, 100, { filter, requestKey: `fields-${eui}` })
    ).pipe(map((res) => res.items));
  }

  getHistory(eui: string, field: string, fromDate?: string, toDate?: string, limit = 500): Observable<HistoryResponse> {
    const perPage = Math.min(Math.max(limit, 1), 1000);
    let filter: string;
    if (fromDate && toDate) {
      filter = this.pb.filter('device_eui = {:eui} && ts >= {:from} && ts <= {:to}', { eui, from: fromDate, to: toDate });
    } else if (fromDate) {
      filter = this.pb.filter('device_eui = {:eui} && ts >= {:from}', { eui, from: fromDate });
    } else if (toDate) {
      filter = this.pb.filter('device_eui = {:eui} && ts <= {:to}', { eui, to: toDate });
    } else {
      filter = this.pb.filter('device_eui = {:eui}', { eui });
    }
    return from(
      this.pb.collection<TelemetryRecord>('telemetry').getList(1, perPage, { filter, sort: 'ts', requestKey: `history-${eui}-${field}` })
    ).pipe(
      map((res: { items: TelemetryRecord[] }) => {
        const data = res.items.map((rec: TelemetryRecord) => {
          const ts = rec.ts ?? rec.created ?? '';
          let value = 0;
          if (field === 'rssi') {
            value = typeof rec.rssi === 'number' ? rec.rssi : 0;
          } else if (field === 'snr') {
            value = typeof rec.snr === 'number' ? rec.snr : 0;
          } else {
            const raw = rec.data;
            const obj = typeof raw === 'string' ? (() => { try { return JSON.parse(raw) as Record<string, unknown>; } catch { return {}; } })() : (raw ?? {});
            const v = obj[field];
            if (typeof v === 'number') value = v;
            else if (typeof v === 'object' && v !== null && typeof (v as { value?: number }).value === 'number') value = (v as { value: number }).value;
          }
          return { ts, value };
        });
        return { eui, field, data };
      })
    );
  }

  getLatestTelemetry(eui: string): Observable<{ data: Record<string, unknown>; rssi?: number; snr?: number } | null> {
    const filter = this.pb.filter('device_eui = {:eui}', { eui });
    return from(
      this.pb
        .collection<{ data: string; rssi?: number; snr?: number }>('telemetry')
        .getList(1, 1, { filter, sort: '-ts', requestKey: `latest-${eui}` })
    ).pipe(
      map((res) => {
        const one = res.items?.[0];
        if (!one) return null;
        let data: Record<string, unknown> = {};
        try {
          if (one.data) data = typeof one.data === 'string' ? JSON.parse(one.data) : (one.data as unknown as Record<string, unknown>);
        } catch {
          // ignore
        }
        return { data, rssi: one.rssi, snr: one.snr };
      })
    );
  }

  // ─── Controls & Commands ────────────────────────────────

  setControl(eui: string, control: string, state: string, duration?: number): Observable<{ ok: boolean; error?: string }> {
    return this.http.post<{ ok: boolean; error?: string }>(`${API}/setControl`, { eui, control, state, duration });
  }

  sendCommand(eui: string, command: string, value?: number): Observable<{ ok: boolean; error?: string }> {
    return this.http.post<{ ok: boolean; error?: string }>(`${API}/sendCommand`, { eui, command, value });
  }

  getCommandHistory(eui: string, limit = 50): Observable<CommandRecord[]> {
    const filter = this.pb.filter('device_eui = {:eui}', { eui });
    return from(
      this.pb.collection<CommandRecord>('commands').getList(1, limit, { filter, sort: '-created', requestKey: `commands-${eui}` })
    ).pipe(map((res) => res.items));
  }

  // ─── Provisioning ───────────────────────────────────────

  provisionDevice(device_eui: string, device_name?: string, profile_id?: string, transport?: TransportType, target_id?: string): Observable<ProvisionResponse> {
    return this.http.post<ProvisionResponse>(`${API}/devices`, { device_eui, device_name, profile_id, transport, target_id });
  }

  getDeviceTargets(): Observable<DeviceTarget[]> {
    return this.http.get<DeviceTarget[]>(`${API}/device-targets`);
  }

  deleteDevice(eui: string): Observable<{ ok: boolean; message?: string }> {
    return this.http.delete<{ ok: boolean; message?: string }>(`${API}/devices?eui=${encodeURIComponent(eui)}`);
  }

  getDeviceCredentials(eui: string): Observable<CredentialsResponse> {
    const filter = this.pb.filter('device_eui = {:eui}', { eui });
    return from(
      this.pb.collection<{ device_eui: string; app_key?: string; device_token?: string; transport?: string }>('devices').getFirstListItem(filter, { requestKey: `creds-${eui}` })
    ).pipe(map((r) => ({ device_eui: r.device_eui, app_key: r.app_key ?? '', device_token: r.device_token ?? '', transport: (r.transport as TransportType) || 'lorawan' })));
  }

  // ─── Profiles ───────────────────────────────────────────

  getProfiles(templatesOnly = true, transport?: string): Observable<ProfileSummary[]> {
    const params: Record<string,string> = {};
    if (!templatesOnly) params['all'] = 'true';
    if (transport) params['transport'] = transport;
    return this.http.get<ProfileSummary[]>(`${API}/profiles`, { params });
  }

  getProfile(id: string): Observable<DeviceProfile> {
    return this.http.get<DeviceProfile>(`${API}/profiles/${id}`);
  }

  createProfile(body: { name: string; description?: string; profile_type: string; transport?: string; is_template?: boolean }): Observable<{ id: string; name: string }> {
    return this.http.post<{ id: string; name: string }>(`${API}/profiles`, body);
  }

  updateProfile(id: string, body: Partial<{ name: string; description: string; is_template: boolean }>): Observable<{ id: string }> {
    return this.http.patch<{ id: string }>(`${API}/profiles/${id}`, body);
  }

  deleteProfile(id: string): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${API}/profiles/${id}`);
  }

  testDecode(profileId: string, fport: number, payloadHex: string): Observable<{ format: string; fport: number; result: Record<string, unknown> }> {
    return this.http.post<{ format: string; fport: number; result: Record<string, unknown> }>(`${API}/profiles/${profileId}/test-decode`, { fport, payload_hex: payloadHex });
  }

  /** Push AirConfig to device. */
  pushConfig(eui: string): Observable<{ ok: boolean; config_hash?: string }> {
    return this.http.post<{ ok: boolean; config_hash?: string }>(`${API}/devices/${eui}/push-config`, {});
  }

  /** Update per-device config overrides. */
  updateDeviceOverrides(eui: string, overrides: unknown): Observable<{ ok: boolean }> {
    return this.http.patch<{ ok: boolean }>(`${API}/devices/${eui}/overrides`, { overrides });
  }

  // ─── Profile sub-component CRUD (PocketBase SDK direct) ─

  getProfileFields(profileId: string): Observable<ProfileField[]> {
    const filter = this.pb.filter('profile = {:pid}', { pid: profileId });
    return from(
      this.pb.collection<ProfileField>('profile_fields').getList(1, 100, { filter, sort: 'sort_order', requestKey: `pf-${profileId}` })
    ).pipe(map(r => r.items));
  }

  createProfileField(data: Record<string, unknown>): Observable<ProfileField> {
    return from(this.pb.collection<ProfileField>('profile_fields').create(data));
  }

  updateProfileField(id: string, data: Record<string, unknown>): Observable<ProfileField> {
    return from(this.pb.collection<ProfileField>('profile_fields').update(id, data));
  }

  deleteProfileField(id: string): Observable<boolean> {
    return from(this.pb.collection('profile_fields').delete(id)).pipe(map(() => true));
  }

  getProfileControls(profileId: string): Observable<ProfileControl[]> {
    const filter = this.pb.filter('profile = {:pid}', { pid: profileId });
    return from(
      this.pb.collection<ProfileControl>('profile_controls').getList(1, 100, { filter, sort: 'sort_order', requestKey: `pc-${profileId}` })
    ).pipe(map(r => r.items));
  }

  createProfileControl(data: Record<string, unknown>): Observable<ProfileControl> {
    return from(this.pb.collection<ProfileControl>('profile_controls').create(data));
  }

  updateProfileControl(id: string, data: Record<string, unknown>): Observable<ProfileControl> {
    return from(this.pb.collection<ProfileControl>('profile_controls').update(id, data));
  }

  deleteProfileControl(id: string): Observable<boolean> {
    return from(this.pb.collection('profile_controls').delete(id)).pipe(map(() => true));
  }

  getProfileCommands(profileId: string): Observable<ProfileCommand[]> {
    const filter = this.pb.filter('profile = {:pid}', { pid: profileId });
    return from(
      this.pb.collection<ProfileCommand>('profile_commands').getList(1, 100, { filter, requestKey: `pcmd-${profileId}` })
    ).pipe(map(r => r.items));
  }

  createProfileCommand(data: Record<string, unknown>): Observable<ProfileCommand> {
    return from(this.pb.collection<ProfileCommand>('profile_commands').create(data));
  }

  updateProfileCommand(id: string, data: Record<string, unknown>): Observable<ProfileCommand> {
    return from(this.pb.collection<ProfileCommand>('profile_commands').update(id, data));
  }

  deleteProfileCommand(id: string): Observable<boolean> {
    return from(this.pb.collection('profile_commands').delete(id)).pipe(map(() => true));
  }

  getDecodeRules(profileId: string): Observable<DecodeRule[]> {
    const filter = this.pb.filter('profile = {:pid}', { pid: profileId });
    return from(
      this.pb.collection<DecodeRule>('decode_rules').getList(1, 50, { filter, sort: 'fport', requestKey: `dr-${profileId}` })
    ).pipe(map(r => r.items));
  }

  createDecodeRule(data: Record<string, unknown>): Observable<DecodeRule> {
    return from(this.pb.collection<DecodeRule>('decode_rules').create(data));
  }

  updateDecodeRule(id: string, data: Record<string, unknown>): Observable<DecodeRule> {
    return from(this.pb.collection<DecodeRule>('decode_rules').update(id, data));
  }

  deleteDecodeRule(id: string): Observable<boolean> {
    return from(this.pb.collection('decode_rules').delete(id)).pipe(map(() => true));
  }

  // ─── Device Rules ───────────────────────────────────────

  getDeviceRules(eui: string): Observable<DeviceRuleRecord[]> {
    const filter = this.pb.filter('device_eui = {:eui}', { eui });
    return from(
      this.pb.collection<DeviceRuleRecord>('device_rules').getList(1, 50, { filter, requestKey: `rules-${eui}` })
    ).pipe(map((res) => res.items));
  }

  createDeviceRule(record: Partial<DeviceRuleRecord>): Observable<DeviceRuleRecord> {
    return from(
      this.pb.collection<DeviceRuleRecord>('device_rules').create(record as Record<string, unknown>)
    );
  }

  updateDeviceRule(id: string, record: Partial<DeviceRuleRecord>): Observable<DeviceRuleRecord> {
    return from(
      this.pb.collection<DeviceRuleRecord>('device_rules').update(id, record as Record<string, unknown>)
    );
  }

  // ─── Gateway & Pipeline ─────────────────────────────────

  getGatewayStatus(): Observable<GatewayStatusResponse> {
    return this.http.get<GatewayStatusResponse>(`${API}/gateway-status`);
  }

  getPipelineDebug(): Observable<PipelineDebug> {
    return this.http.get<PipelineDebug>(`${API}/debug/pipeline`);
  }

  getLorawanStats(): Observable<LorawanStats> {
    return this.http.get<LorawanStats>(`${API}/lorawan/stats`);
  }

  getLorawanFrames(limit = 200): Observable<RawLorawanFrame[]> {
    return this.http.get<RawLorawanFrame[]>(`${API}/lorawan/frames`, { params: { limit: String(limit) } });
  }

  getDeviceFrames(eui: string, limit = 50): Observable<RawLorawanFrame[]> {
    return this.http.get<RawLorawanFrame[]>(`${API}/lorawan/frames`, { params: { device_eui: eui, limit: String(limit) } });
  }

  // ─── Workflows ──────────────────────────────────────────

  getWorkflows(deviceEui?: string): Observable<WorkflowRecord[]> {
    const options: Record<string, unknown> = { requestKey: `workflows-${deviceEui || 'all'}` };
    if (deviceEui) {
      options['filter'] = this.pb.filter('triggers ~ {:eui} || actions ~ {:eui}', { eui: deviceEui });
    }
    return from(
      this.pb.collection<WorkflowRecord>('workflows').getList(1, 100, options)
    ).pipe(map((res) => res.items));
  }

  createWorkflow(record: Partial<WorkflowRecord>): Observable<WorkflowRecord> {
    return from(
      this.pb.collection<WorkflowRecord>('workflows').create(record as Record<string, unknown>)
    );
  }

  updateWorkflow(id: string, record: Partial<WorkflowRecord>): Observable<WorkflowRecord> {
    return from(
      this.pb.collection<WorkflowRecord>('workflows').update(id, record as Record<string, unknown>)
    );
  }

  deleteWorkflow(id: string): Observable<boolean> {
    return from(this.pb.collection('workflows').delete(id)).pipe(map(() => true));
  }

  testWorkflow(id: string, mockData: Record<string, unknown>): Observable<{ condition_result: boolean; would_fire: boolean; trigger_index: number; env: Record<string, unknown> }> {
    return this.http.post<{ condition_result: boolean; would_fire: boolean; trigger_index: number; env: Record<string, unknown> }>(`${API}/workflows/${id}/test`, mockData);
  }

  getWorkflowLog(workflowId?: string, limit = 50): Observable<WorkflowLogRecord[]> {
    const options: Record<string, unknown> = { sort: '-ts', requestKey: `wf-log-${workflowId || 'all'}` };
    if (workflowId) {
      options['filter'] = this.pb.filter('workflow_id = {:id}', { id: workflowId });
    }
    return from(
      this.pb.collection<WorkflowLogRecord>('workflow_log').getList(1, limit, options)
    ).pipe(map((res) => res.items));
  }

  // ─── Gateway Settings ───────────────────────────────────

  getGatewaySettings(): Observable<GatewaySettings> {
    const fromDb = from(
      this.pb.collection<GatewaySettingsRecord>('gateway_settings').getList(1, 1, { sort: '-@rowid', requestKey: 'gw-settings' })
    ).pipe(
      map((res) => {
        const r = res.items[0];
        if (!r) {
          return {
            region: 'EU868',
            event_url: '',
            command_url: '',
            gateway_id: '',
            rx1_frequency_hz: 0,
            test_mode: false,
            saved: false,
          } as GatewaySettings;
        }
        return {
          region: (r.region ?? '').trim() || 'EU868',
          event_url: (r.event_url ?? '').trim(),
          command_url: (r.command_url ?? '').trim(),
          gateway_id: (r.gateway_id ?? '').trim(),
          rx1_frequency_hz: typeof r.rx1_frequency_hz === 'number' ? r.rx1_frequency_hz : 0,
          test_mode: !!r.test_mode,
          saved: true,
        } as GatewaySettings;
      })
    );
    return combineLatest([fromDb, this.getGatewayStatus().pipe(catchError(() => of({ gateways: [], discovered_gateway_id: undefined })))]).pipe(
      map(([gw, status]) => {
        if (status.discovered_gateway_id && !gw.gateway_id) {
          gw = { ...gw, gateway_id: status.discovered_gateway_id };
        }
        return gw;
      })
    );
  }

  patchGatewaySettings(settings: Partial<GatewaySettings>): Observable<GatewaySettings> {
    return from(this.pb.collection<GatewaySettingsRecord>('gateway_settings').getList(1, 1, { sort: '-@rowid', requestKey: 'gw-settings-patch' })).pipe(
      switchMap((res) => {
        const existing = res.items[0];
        const body: Record<string, unknown> = {
          region: settings.region ?? existing?.region ?? 'EU868',
          event_url: settings.event_url ?? existing?.event_url ?? '',
          command_url: settings.command_url ?? existing?.command_url ?? '',
          rx1_frequency_hz: settings.rx1_frequency_hz ?? existing?.rx1_frequency_hz ?? 0,
          test_mode: settings.test_mode ?? existing?.test_mode ?? false,
        };
        const op = existing
          ? this.pb.collection<GatewaySettingsRecord>('gateway_settings').update(existing.id, body)
          : this.pb.collection<GatewaySettingsRecord>('gateway_settings').create(body);
        return from(Promise.resolve(op));
      }),
      switchMap(() => this.getGatewaySettings())
    );
  }
}

// ─── Supporting interfaces ────────────────────────────────

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

interface GatewaySettingsRecord {
  id: string;
  region?: string;
  event_url?: string;
  command_url?: string;
  gateway_id?: string;
  rx1_frequency_hz?: number;
  test_mode?: boolean;
}

interface TelemetryRecord {
  ts?: string;
  created?: string;
  data?: string | Record<string, unknown>;
  rssi?: number;
  snr?: number;
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
}

export interface LorawanStats {
  buffer_size: number;
  total_uplinks: number;
  total_downlinks: number;
  concentratord_configured: boolean;
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

export interface WorkflowTrigger {
  type: 'telemetry' | 'state_change';
  filter?: { device_eui?: string; field?: string; control_key?: string };
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
  ts: string;
}
