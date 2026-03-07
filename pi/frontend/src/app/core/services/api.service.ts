import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';

const API = '/api';

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

interface PocketBaseList<T> {
  items: T[];
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);

  getDevices(): Observable<{ items: Device[] }> {
    return this.http.get<PocketBaseList<Device>>(`${API}/collections/devices/records?perPage=100`) as Observable<{ items: Device[] }>;
  }

  getDeviceConfig(eui: string): Observable<Device> {
    const filter = encodeURIComponent(`device_eui = "${eui}"`);
    return this.http
      .get<PocketBaseList<Device>>(`${API}/collections/devices/records?filter=${filter}&perPage=1`)
      .pipe(
        map(res => {
          const one = res?.items?.[0];
          if (one) return one;
          throw new Error('Device not found');
        })
      );
  }

  getDeviceControls(eui: string): Observable<DeviceControl[]> {
    const filter = encodeURIComponent(`device_eui = "${eui}"`);
    return this.http
      .get<PocketBaseList<DeviceControl>>(`${API}/collections/device_controls/records?filter=${filter}&perPage=50`)
      .pipe(map(res => res?.items ?? []));
  }

  getDeviceFields(eui: string): Observable<DeviceField[]> {
    const filter = encodeURIComponent(`device_eui = "${eui}"`);
    return this.http
      .get<PocketBaseList<DeviceField>>(`${API}/collections/device_fields/records?filter=${filter}&perPage=100`)
      .pipe(map(res => res?.items ?? []));
  }

  getHistory(eui: string, field: string, from?: string, to?: string, limit = 500): Observable<HistoryResponse> {
    let url = `${API}/history?eui=${encodeURIComponent(eui)}&field=${encodeURIComponent(field)}&limit=${limit}`;
    if (from) url += `&from=${encodeURIComponent(from)}`;
    if (to) url += `&to=${encodeURIComponent(to)}`;
    return this.http.get<HistoryResponse>(url);
  }

  getLatestTelemetry(eui: string): Observable<{ data: Record<string, unknown>; rssi?: number; snr?: number } | null> {
    const filter = encodeURIComponent(`device_eui = "${eui}"`);
    return this.http
      .get<PocketBaseList<{ data: string; rssi?: number; snr?: number }>>(`${API}/collections/telemetry/records?filter=${filter}&sort=-ts&perPage=1`)
      .pipe(
        map((res) => {
          const one = res?.items?.[0];
          if (!one) return null;
          let data: Record<string, unknown> = {};
          try {
            if (one.data) data = typeof one.data === 'string' ? JSON.parse(one.data) : one.data;
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

  getGatewayStatus(): Observable<{ gateways: unknown[] }> {
    return this.http.get<{ gateways: unknown[] }>(`${API}/gateway-status`);
  }

  /** Provision a device (create or update) and get AppKey for LoRaWAN OTAA. */
  provisionDevice(device_eui: string, device_name?: string): Observable<ProvisionResponse> {
    return this.http.post<ProvisionResponse>(`${API}/devices`, { device_eui, device_name });
  }

  /** Delete a device by EUI (and its LoRaWAN session). */
  deleteDevice(eui: string): Observable<{ ok: boolean; message?: string }> {
    return this.http.delete<{ ok: boolean; message?: string }>(`${API}/devices?eui=${encodeURIComponent(eui)}`);
  }

  /** Get credentials for a device (for firmware / secrets.h). */
  getDeviceCredentials(eui: string): Observable<CredentialsResponse> {
    return this.http.get<CredentialsResponse>(`${API}/devices/credentials?eui=${encodeURIComponent(eui)}`);
  }

  otaStart(eui: string, firmware?: string): Observable<{ ok: boolean; message?: string }> {
    return this.http.post<{ ok: boolean; message?: string }>(`${API}/otaStart`, { eui, firmware });
  }

  otaCancel(eui: string): Observable<{ ok: boolean; message?: string }> {
    return this.http.post<{ ok: boolean; message?: string }>(`${API}/otaCancel`, { eui });
  }

  getEdgeRules(eui: string): Observable<EdgeRuleRecord[]> {
    const filter = encodeURIComponent(`device_eui = "${eui}"`);
    return this.http
      .get<PocketBaseList<EdgeRuleRecord>>(`${API}/collections/edge_rules/records?filter=${filter}&perPage=50`)
      .pipe(map((res) => res?.items ?? []));
  }

  createEdgeRule(record: Partial<EdgeRuleRecord>): Observable<EdgeRuleRecord> {
    return this.http.post<EdgeRuleRecord>(`${API}/collections/edge_rules/records`, record);
  }

  updateEdgeRule(id: string, record: Partial<EdgeRuleRecord>): Observable<EdgeRuleRecord> {
    return this.http.patch<EdgeRuleRecord>(`${API}/collections/edge_rules/records/${id}`, record);
  }

  getFirmwareHistory(eui: string): Observable<FirmwareHistoryRecord[]> {
    const filter = encodeURIComponent(`device_eui = "${eui}"`);
    return this.http
      .get<PocketBaseList<FirmwareHistoryRecord>>(`${API}/collections/firmware_history/records?filter=${filter}&sort=-started_at&perPage=20`)
      .pipe(map((res) => res?.items ?? []));
  }

  /** Pipeline status (concentratord env). */
  getPipelineDebug(): Observable<PipelineDebug> {
    return this.http.get<PipelineDebug>(`${API}/debug/pipeline`);
  }

  /** Recent raw LoRaWAN frames (uplinks + downlinks). */
  getLorawanFrames(limit = 100): Observable<{ frames: RawLorawanFrame[] }> {
    return this.http.get<{ frames: RawLorawanFrame[] }>(`${API}/lorawan/frames?limit=${limit}`);
  }

  /** Frame buffer stats and concentratord configured flag. */
  getLorawanStats(): Observable<LorawanStats> {
    return this.http.get<LorawanStats>(`${API}/lorawan/stats`);
  }

  /** Clear in-memory frame buffer. */
  clearLorawanFrames(): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${API}/lorawan/frames/clear`, {});
  }
}

export interface PipelineDebug {
  concentratord_configured: boolean;
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

export interface EdgeRuleRecord {
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
