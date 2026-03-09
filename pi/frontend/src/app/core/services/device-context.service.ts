import { Injectable, inject, signal, computed } from '@angular/core';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { Subscription } from 'rxjs';
import { ApiService, Device, DeviceControl, DeviceField } from './api.service';
import { TelemetrySubscriptionService } from './telemetry-subscription.service';

@Injectable({ providedIn: 'root' })
export class DeviceContextService {
  private api = inject(ApiService);
  private telemetrySubscription = inject(TelemetrySubscriptionService);

  private _device = signal<Device | null>(null);
  private _controls = signal<DeviceControl[]>([]);
  private _fieldConfigs = signal<DeviceField[]>([]);
  private _latestTelemetry = signal<Record<string, unknown> | null>(null);
  private _loading = signal(false);
  private _error = signal<string | null>(null);
  private _eui = signal<string>('');

  private telemetrySub: Subscription | null = null;

  device = this._device.asReadonly();
  controls = this._controls.asReadonly();
  fieldConfigs = this._fieldConfigs.asReadonly();
  latestTelemetry = this._latestTelemetry.asReadonly();
  loading = this._loading.asReadonly();
  error = this._error.asReadonly();
  eui = this._eui.asReadonly();

  controlsMap = computed(() => {
    const list = this._controls();
    const map = new Map<string, DeviceControl>();
    for (const c of list) {
      map.set(c.control_key, c);
    }
    return map;
  });

  load(eui: string): void {
    if (!eui) {
      this.clear();
      return;
    }
    this.unsubscribeTelemetry();
    this._eui.set(eui);
    this._loading.set(true);
    this._error.set(null);

    forkJoin({
      device: this.api.getDeviceConfig(eui),
      controls: this.api.getDeviceControls(eui),
      fields: this.api.getDeviceFields(eui),
      latest: this.api.getLatestTelemetry(eui).pipe(catchError(() => of(null))),
    }).subscribe({
      next: ({ device, controls, fields, latest }) => {
        this._device.set(device);
        this._controls.set(controls);
        this._fieldConfigs.set(fields);
        this._latestTelemetry.set(latest?.data ?? null);
        this._loading.set(false);
        this.telemetrySub = this.telemetrySubscription.stream(eui).subscribe((payload) => {
          this._latestTelemetry.set(payload.data ?? null);
        });
      },
      error: (err) => {
        this._error.set(err?.message ?? 'Failed to load device');
        this._loading.set(false);
      },
    });
  }

  private unsubscribeTelemetry(): void {
    this.telemetrySub?.unsubscribe();
    this.telemetrySub = null;
  }

  clear(): void {
    this.unsubscribeTelemetry();
    this._eui.set('');
    this._device.set(null);
    this._controls.set([]);
    this._fieldConfigs.set([]);
    this._latestTelemetry.set(null);
    this._loading.set(false);
    this._error.set(null);
  }
}
