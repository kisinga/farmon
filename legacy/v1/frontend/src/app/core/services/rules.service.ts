import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, from, map } from 'rxjs';
import { PocketBaseService } from './pocketbase.service';
import { DeviceRuleRecord } from './api.types';

const API = '/api/farmon';

@Injectable({ providedIn: 'root' })
export class RulesService {
  private http = inject(HttpClient);
  private pb = inject(PocketBaseService).pb;

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

  deleteDeviceRule(id: string): Observable<boolean> {
    return from(this.pb.collection('device_rules').delete(id)).pipe(map(() => true));
  }

  pushDeviceRules(eui: string): Observable<{ ok: boolean; rules_pushed: number }> {
    return this.http.post<{ ok: boolean; rules_pushed: number }>(`${API}/devices/${eui}/push-rules`, {});
  }
}
