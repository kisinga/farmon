import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, from, map } from 'rxjs';
import { PocketBaseService } from './pocketbase.service';
import {
  BackendInfo,
  Device,
  DeviceControl,
  DeviceDecodeRule,
  DeviceField,
  DeviceSpec,
  DeviceVisualization,
  FirmwareCommand,
  PinCapabilitiesResponse,
  SensorCatalog,
  HistoryResponse,
  TelemetryRecord,
  CommandRecord,
  ProvisionResponse,
  CredentialsResponse,
  TransportType,
  WorkflowLogRecord,
} from './api.types';

const API = '/api/farmon';

@Injectable({ providedIn: 'root' })
export class DeviceService {
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

  setControl(eui: string, control: string, state: string, duration?: number, value?: number): Observable<{ ok: boolean; error?: string }> {
    return this.http.post<{ ok: boolean; error?: string }>(`${API}/setControl`, { eui, control, state, duration, value });
  }

  getPinCapabilities(eui: string): Observable<PinCapabilitiesResponse> {
    return this.http.get<PinCapabilitiesResponse>(`${API}/pin-capabilities?eui=${eui}`);
  }

  probeField(eui: string, fieldKey: string): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${API}/devices/${eui}/probe-field`, { field_key: fieldKey });
  }

  compileExpression(eui: string, expression: string): Observable<{ bytecode_hex: string; bytecode_size: number; errors: string[] }> {
    return this.http.post<{ bytecode_hex: string; bytecode_size: number; errors: string[] }>(`${API}/devices/${eui}/compile-expression`, { expression });
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

  getDeviceWorkflowEvents(eui: string, limit = 50): Observable<WorkflowLogRecord[]> {
    return this.http.get<WorkflowLogRecord[]>(`${API}/device-workflow-events`, {
      params: { eui, limit: limit.toString() },
    });
  }

  getStateChanges(eui: string, limit = 100): Observable<import('./api.types').StateChangeRecord[]> {
    const filter = this.pb.filter('device_eui = {:eui}', { eui });
    return from(
      this.pb.collection<import('./api.types').StateChangeRecord>('state_changes').getList(1, limit, { filter, sort: '-ts', requestKey: `state-changes-${eui}` })
    ).pipe(map((res) => res.items));
  }

  provisionDevice(device_eui: string, device_name?: string, transport?: TransportType, spec?: DeviceSpec, hardware_model?: string): Observable<ProvisionResponse> {
    return this.http.post<ProvisionResponse>(`${API}/devices`, { device_eui, device_name, transport, spec, hardware_model });
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

  getDeviceSpec(eui: string): Observable<DeviceSpec> {
    return this.http.get<DeviceSpec>(`${API}/devices/${eui}/spec`);
  }

  applyDeviceSpec(eui: string, spec: DeviceSpec): Observable<{ ok: boolean; device_type: string; config_status: string }> {
    return this.http.post<{ ok: boolean; device_type: string; config_status: string }>(`${API}/devices/${eui}/apply-spec`, { spec });
  }

  testDecode(spec: DeviceSpec, fport: number, payloadHex: string): Observable<{ format: string; fport: number; result: Record<string, unknown> }> {
    return this.http.post<{ format: string; fport: number; result: Record<string, unknown> }>(`${API}/test-decode`, { spec, fport, payload_hex: payloadHex });
  }

  pushConfig(eui: string): Observable<{ ok: boolean; config_hash?: string }> {
    return this.http.post<{ ok: boolean; config_hash?: string }>(`${API}/devices/${eui}/push-config`, {});
  }

  getFirmwareCommands(): Observable<FirmwareCommand[]> {
    return this.http.get<FirmwareCommand[]>(`${API}/firmware-commands`);
  }

  getSensorCatalog(): Observable<SensorCatalog> {
    return this.http.get<SensorCatalog>(`${API}/sensor-catalog`);
  }

  getBackendInfo(): Observable<BackendInfo> {
    return this.http.get<BackendInfo>(`${API}/backend-info`);
  }

  patchBackendInfo(body: BackendInfo): Observable<BackendInfo> {
    return this.http.patch<BackendInfo>(`${API}/backend-info`, body);
  }

  // ─── Controls CRUD ────────────────────────────────────────────────────────

  createDeviceControl(data: Partial<DeviceControl>): Observable<DeviceControl> {
    return from(this.pb.collection<DeviceControl>('device_controls').create(data));
  }

  updateDeviceControl(id: string, data: Partial<DeviceControl>): Observable<DeviceControl> {
    return from(this.pb.collection<DeviceControl>('device_controls').update(id, data));
  }

  deleteDeviceControl(id: string): Observable<boolean> {
    return from(this.pb.collection('device_controls').delete(id));
  }

  // ─── Fields CRUD ──────────────────────────────────────────────────────────

  deleteDeviceField(id: string): Observable<boolean> {
    return from(this.pb.collection('device_fields').delete(id));
  }

  // ─── Decode Rules ─────────────────────────────────────────────────────────

  getDeviceDecodeRules(eui: string): Observable<DeviceDecodeRule[]> {
    const filter = this.pb.filter('device_eui = {:eui}', { eui });
    return from(
      this.pb.collection<DeviceDecodeRule>('device_decode_rules').getList(1, 50, {
        filter,
        sort: 'fport',
        requestKey: `decode-rules-${eui}`,
      })
    ).pipe(map(res => res.items));
  }

  createDeviceDecodeRule(data: Partial<DeviceDecodeRule>): Observable<DeviceDecodeRule> {
    return from(this.pb.collection<DeviceDecodeRule>('device_decode_rules').create(data));
  }

  updateDeviceDecodeRule(id: string, data: Partial<DeviceDecodeRule>): Observable<DeviceDecodeRule> {
    return from(this.pb.collection<DeviceDecodeRule>('device_decode_rules').update(id, data));
  }

  deleteDeviceDecodeRule(id: string): Observable<boolean> {
    return from(this.pb.collection('device_decode_rules').delete(id));
  }

  // ─── Visualizations ───────────────────────────────────────────────────────

  getDeviceVisualizations(eui: string): Observable<DeviceVisualization[]> {
    const filter = this.pb.filter('device_eui = {:eui}', { eui });
    return from(
      this.pb.collection<DeviceVisualization>('device_visualizations').getList(1, 100, {
        filter,
        sort: 'sort_order',
        requestKey: `viz-${eui}`,
      })
    ).pipe(map(res => res.items));
  }
}
