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

  setControl(eui: string, control: string, state: string, duration?: number): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${API}/setControl`, { eui, control, state, duration });
  }

  getGatewayStatus(): Observable<{ gateways: unknown[] }> {
    return this.http.get<{ gateways: unknown[] }>(`${API}/gateway-status`);
  }
}
