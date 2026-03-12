import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, from, map, combineLatest, catchError, of, switchMap } from 'rxjs';
import { PocketBaseService } from './pocketbase.service';

const API = '/api/farmon';

export interface Device {
  id: string;
  device_eui: string;
  device_name: string;
  device_type?: string;
  last_seen?: string;
  registration?: string;
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

@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);
  private pb = inject(PocketBaseService).pb;

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

  getGatewayStatus(): Observable<GatewayStatusResponse> {
    return this.http.get<GatewayStatusResponse>(`${API}/gateway-status`);
  }

  /** Provision a device (create or update) and get AppKey for LoRaWAN OTAA. */
  provisionDevice(device_eui: string, device_name?: string): Observable<ProvisionResponse> {
    return this.http.post<ProvisionResponse>(`${API}/devices`, { device_eui, device_name });
  }

  /** Delete a device by EUI (and its LoRaWAN session). */
  deleteDevice(eui: string): Observable<{ ok: boolean; message?: string }> {
    return this.http.delete<{ ok: boolean; message?: string }>(`${API}/devices?eui=${encodeURIComponent(eui)}`);
  }

  /** Get credentials for a device (for firmware / secrets.h). Via SDK. */
  getDeviceCredentials(eui: string): Observable<CredentialsResponse> {
    const filter = this.pb.filter('device_eui = {:eui}', { eui });
    return from(
      this.pb.collection<{ device_eui: string; app_key?: string }>('devices').getFirstListItem(filter, { requestKey: `creds-${eui}` })
    ).pipe(map((r) => ({ device_eui: r.device_eui, app_key: r.app_key ?? '' })));
  }

  otaStart(eui: string, firmware?: string): Observable<{ ok: boolean; message?: string }> {
    return this.http.post<{ ok: boolean; message?: string }>(`${API}/ota/start`, { eui, firmware });
  }

  otaCancel(eui: string): Observable<{ ok: boolean; message?: string }> {
    return this.http.post<{ ok: boolean; message?: string }>(`${API}/ota/cancel`, { eui });
  }

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

  getFirmwareHistory(eui: string): Observable<FirmwareHistoryRecord[]> {
    const filter = this.pb.filter('device_eui = {:eui}', { eui });
    return from(
      this.pb
        .collection<FirmwareHistoryRecord>('firmware_history')
        .getList(1, 20, { filter, sort: '-started_at', requestKey: `firmware-${eui}` })
    ).pipe(map((res) => res.items));
  }

  /** Pipeline status (concentratord env). */
  getPipelineDebug(): Observable<PipelineDebug> {
    return this.http.get<PipelineDebug>(`${API}/debug/pipeline`);
  }

  /** Frame buffer stats and concentratord configured flag. */
  getLorawanStats(): Observable<LorawanStats> {
    return this.http.get<LorawanStats>(`${API}/lorawan/stats`);
  }

  /** Raw LoRaWAN frames (newest first). Uses backend API so errors are explicit. */
  getLorawanFrames(limit = 200): Observable<RawLorawanFrame[]> {
    return this.http.get<RawLorawanFrame[]>(`${API}/lorawan/frames`, { params: { limit: String(limit) } });
  }

  /** Raw LoRaWAN frames filtered by device EUI. */
  getDeviceFrames(eui: string, limit = 50): Observable<RawLorawanFrame[]> {
    return this.http.get<RawLorawanFrame[]>(`${API}/lorawan/frames`, { params: { device_eui: eui, limit: String(limit) } });
  }

  // --- Workflows ---

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

  /** Get gateway settings via SDK; merges discovered_gateway_id from gateway-status when no record. */
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
            saved: false,
          } as GatewaySettings;
        }
        return {
          region: (r.region ?? '').trim() || 'EU868',
          event_url: (r.event_url ?? '').trim(),
          command_url: (r.command_url ?? '').trim(),
          gateway_id: (r.gateway_id ?? '').trim(),
          rx1_frequency_hz: typeof r.rx1_frequency_hz === 'number' ? r.rx1_frequency_hz : 0,
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

  /** Save gateway settings via SDK (config only; gateway_id is autodiscovered). Pipeline restart is handled server-side on save. */
  patchGatewaySettings(settings: Partial<GatewaySettings>): Observable<GatewaySettings> {
    return from(this.pb.collection<GatewaySettingsRecord>('gateway_settings').getList(1, 1, { sort: '-@rowid', requestKey: 'gw-settings-patch' })).pipe(
      switchMap((res) => {
        const existing = res.items[0];
        const body: Record<string, unknown> = {
          region: settings.region ?? existing?.region ?? 'EU868',
          event_url: settings.event_url ?? existing?.event_url ?? '',
          command_url: settings.command_url ?? existing?.command_url ?? '',
          rx1_frequency_hz: settings.rx1_frequency_hz ?? existing?.rx1_frequency_hz ?? 0,
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

export interface GatewaySettings {
  region: string;
  event_url: string;
  command_url: string;
  gateway_id: string;
  rx1_frequency_hz: number;
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
  app_key: string;
}

export interface CredentialsResponse {
  device_eui: string;
  app_key: string;
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

export interface FirmwareHistoryRecord {
  id: string;
  device_eui: string;
  started_at?: string;
  finished_at?: string;
  outcome: string;
  firmware_version?: string;
  total_chunks?: number;
  chunks_received?: number;
  error_message?: string;
  error_chunk_index?: number;
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
