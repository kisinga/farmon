import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, from, map } from 'rxjs';
import { PocketBaseService } from './pocketbase.service';
import {
  DeviceProfile,
  ProfileSummary,
  ProfileField,
  ProfileControl,
  ProfileCommand,
  DecodeRule,
} from './api.types';

const API = '/api/farmon';

@Injectable({ providedIn: 'root' })
export class ProfileService {
  private http = inject(HttpClient);
  private pb = inject(PocketBaseService).pb;

  getProfiles(templatesOnly = true, transport?: string): Observable<ProfileSummary[]> {
    const params: Record<string,string> = {};
    if (!templatesOnly) params['all'] = 'true';
    if (transport) params['transport'] = transport;
    return this.http.get<ProfileSummary[]>(`${API}/templates`, { params });
  }

  getProfile(id: string): Observable<DeviceProfile> {
    return this.http.get<DeviceProfile>(`${API}/templates/${id}`);
  }

  createProfile(body: { name: string; description?: string; profile_type: string; transport?: string; is_template?: boolean }): Observable<{ id: string; name: string }> {
    return this.http.post<{ id: string; name: string }>(`${API}/templates`, body);
  }

  updateProfile(id: string, body: Partial<{ name: string; description: string; is_template: boolean }>): Observable<{ id: string }> {
    return this.http.patch<{ id: string }>(`${API}/templates/${id}`, body);
  }

  deleteProfile(id: string): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${API}/templates/${id}`);
  }

  testDecode(profileId: string, fport: number, payloadHex: string): Observable<{ format: string; fport: number; result: Record<string, unknown> }> {
    return this.http.post<{ format: string; fport: number; result: Record<string, unknown> }>(`${API}/templates/${profileId}/test-decode`, { fport, payload_hex: payloadHex });
  }

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
}
