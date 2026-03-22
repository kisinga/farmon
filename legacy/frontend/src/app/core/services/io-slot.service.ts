import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, from } from 'rxjs';
import { PocketBaseService } from './pocketbase.service';
import { DeviceField, AirConfigValidationResult } from './api.types';

const API = '/api/farmon';

export interface SensorSlotPayload {
  slot: number;
  type: number;
  pin_index: number;
  field_index: number;
  flags: number;
  calib_offset?: number;
  calib_span?: number;
  param1_raw?: number;
  param2_raw?: number;
}

export interface ControlSlotPayload {
  slot: number;
  pin_index: number;
  state_count: number;
  flags: number;
  actuator_type: number;
  pin2_index?: number;
  pulse_x100ms?: number;
}

/**
 * IOSlotService — pushes individual sensor or control slots to firmware via fPort 35.
 *
 * Sensor: subcommand 0x04 (10 bytes) — type, pin, field_idx, flags, calib params
 * Control: subcommand 0x05 (8 bytes) — pin, state_count, flags, actuator_type, pin2, pulse
 */
@Injectable({ providedIn: 'root' })
export class IOSlotService {
  private http = inject(HttpClient);
  private pb = inject(PocketBaseService).pb;

  /**
   * Push a single IO slot (sensor or control) as an AirConfig downlink (fPort 35).
   * For sensors: calib_offset/calib_span are physical-unit floats encoded to int16x10 by the backend.
   * For non-ADC types (I2C, pulse, Modbus) use param1_raw/param2_raw instead.
   */
  pushIOSlot(eui: string, body: ({ kind: 'sensor' } & SensorSlotPayload) | ({ kind: 'control' } & ControlSlotPayload)): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${API}/devices/${eui}/push-io-slot`, body);
  }

  /** Convenience: push a sensor slot. */
  pushSensorSlot(eui: string, body: SensorSlotPayload): Observable<{ ok: boolean }> {
    return this.pushIOSlot(eui, { kind: 'sensor', ...body });
  }

  /** Convenience: push a control slot. */
  pushControlSlot(eui: string, body: ControlSlotPayload): Observable<{ ok: boolean }> {
    return this.pushIOSlot(eui, { kind: 'control', ...body });
  }

  /** Create a device field record (telemetry metadata). */
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
