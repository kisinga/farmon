import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, from, map } from 'rxjs';
import { PocketBaseService } from './pocketbase.service';
import {
  Device,
  DeviceControl,
  DeviceField,
  DeviceTarget,
  HistoryResponse,
  TelemetryRecord,
  CommandRecord,
  ProvisionResponse,
  CredentialsResponse,
  TransportType,
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

  updateDeviceOverrides(eui: string, overrides: unknown): Observable<{ ok: boolean }> {
    return this.http.patch<{ ok: boolean }>(`${API}/devices/${eui}/overrides`, { overrides });
  }

  pushConfig(eui: string): Observable<{ ok: boolean; config_hash?: string }> {
    return this.http.post<{ ok: boolean; config_hash?: string }>(`${API}/devices/${eui}/push-config`, {});
  }
}
