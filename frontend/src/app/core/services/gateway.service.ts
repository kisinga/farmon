import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, from, map, combineLatest, catchError, of, switchMap } from 'rxjs';
import { PocketBaseService } from './pocketbase.service';
import {
  GatewaySettings,
  GatewaySettingsRecord,
  GatewayStatusResponse,
  PipelineDebug,
  RawLorawanFrame,
  LorawanStats,
  WifiSettings,
  WifiSettingsRecord,
} from './api.types';

const API = '/api/farmon';

@Injectable({ providedIn: 'root' })
export class GatewayApiService {
  private http = inject(HttpClient);
  private pb = inject(PocketBaseService).pb;

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
            enabled: true,
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
          enabled: r.enabled !== false,
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
          enabled: settings.enabled ?? existing?.enabled ?? true,
        };
        const op = existing
          ? this.pb.collection<GatewaySettingsRecord>('gateway_settings').update(existing.id, body)
          : this.pb.collection<GatewaySettingsRecord>('gateway_settings').create(body);
        return from(Promise.resolve(op));
      }),
      switchMap(() => this.getGatewaySettings())
    );
  }

  // ─── WiFi Settings ──────────────────────────────────────

  getWifiSettings(): Observable<WifiSettings> {
    return from(
      this.pb.collection<WifiSettingsRecord>('wifi_settings').getList(1, 1, { sort: '-@rowid', requestKey: 'wifi-settings' })
    ).pipe(
      map((res) => {
        const r = res.items[0];
        if (!r) {
          return { enabled: true, test_mode: false, saved: false } as WifiSettings;
        }
        return {
          enabled: r.enabled !== false,
          test_mode: !!r.test_mode,
          saved: true,
        } as WifiSettings;
      })
    );
  }

  patchWifiSettings(settings: Partial<WifiSettings>): Observable<WifiSettings> {
    return from(
      this.pb.collection<WifiSettingsRecord>('wifi_settings').getList(1, 1, { sort: '-@rowid', requestKey: 'wifi-settings-patch' })
    ).pipe(
      switchMap((res) => {
        const existing = res.items[0];
        const body: Record<string, unknown> = {
          enabled: settings.enabled ?? existing?.enabled ?? true,
          test_mode: settings.test_mode ?? existing?.test_mode ?? false,
        };
        const op = existing
          ? this.pb.collection<WifiSettingsRecord>('wifi_settings').update(existing.id, body)
          : this.pb.collection<WifiSettingsRecord>('wifi_settings').create(body);
        return from(op).pipe(
          map((r) => ({
            enabled: r.enabled !== false,
            test_mode: !!r.test_mode,
            saved: true,
          } as WifiSettings))
        );
      }),
    );
  }
}
