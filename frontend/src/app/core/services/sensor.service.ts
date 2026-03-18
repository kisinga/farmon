import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, from } from 'rxjs';
import { PocketBaseService } from './pocketbase.service';
import { DeviceField, AirConfigValidationResult } from './api.types';

const API = '/api/farmon';

@Injectable({ providedIn: 'root' })
export class SensorService {
  private http = inject(HttpClient);
  private pb = inject(PocketBaseService).pb;

  /**
   * Push a single sensor slot configuration as an AirConfig downlink (fPort 35).
   * calib_offset/calib_span are physical-unit floats encoded to int16×10 / uint16×10 by the backend.
   * For non-ADC types (I2C, pulse, Modbus) use param1_raw/param2_raw instead.
   */
  pushSensorSlot(eui: string, body: {
    slot: number;
    type: number;
    pin_index: number;
    field_index: number;
    flags: number;
    calib_offset?: number;
    calib_span?: number;
    param1_raw?: number;
    param2_raw?: number;
  }): Observable<{ ok: boolean; param1: number; param2: number }> {
    return this.http.post<{ ok: boolean; param1: number; param2: number }>(`${API}/devices/${eui}/push-sensor-slot`, body);
  }

  /** Create a device field record (telemetry metadata) for a newly configured sensor. */
  createDeviceField(data: Partial<DeviceField>): Observable<DeviceField> {
    return from(
      this.pb.collection<DeviceField>('device_fields').create(data as Record<string, unknown>)
    );
  }

  /** Update a device field record. */
  updateDeviceField(id: string, data: Partial<DeviceField>): Observable<DeviceField> {
    return from(
      this.pb.collection<DeviceField>('device_fields').update(id, data as Record<string, unknown>)
    );
  }

  /** Validate an airconfig for pin conflicts, field overlaps, etc. */
  validateAirConfig(airconfig: {
    pin_map?: number[];
    sensors?: unknown[];
    controls?: unknown[];
    lorawan?: unknown;
    transfer?: unknown;
  }): Observable<AirConfigValidationResult> {
    return this.http.post<AirConfigValidationResult>(`${API}/validate-airconfig`, airconfig);
  }
}
