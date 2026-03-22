import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiService, Device, DeviceControl, DeviceField } from './api.service';

@Injectable({ providedIn: 'root' })
export class DeviceManagerService {
  private api = inject(ApiService);

  private _devices = signal<Device[]>([]);
  private _loading = signal(false);
  private _error = signal<string | null>(null);
  private _initialized = signal(false);

  // Public readonly signals
  devices = this._devices.asReadonly();
  loading = this._loading.asReadonly();
  error = this._error.asReadonly();
  initialized = this._initialized.asReadonly();

  /** O(1) device lookup by EUI. */
  devicesMap = computed(() => {
    const map = new Map<string, Device>();
    for (const device of this._devices()) {
      map.set(device.device_eui, device);
    }
    return map;
  });

  /** Load all devices. Typically called once during app initialization. */
  loadDevices(): void {
    if (this._initialized()) return;

    this._loading.set(true);
    this._error.set(null);

    this.api.getDevices().subscribe({
      next: (response) => {
        this._devices.set(response.items);
        this._initialized.set(true);
        this._loading.set(false);
      },
      error: (err) => {
        this._error.set(err?.message ?? 'Failed to load devices');
        this._loading.set(false);
      },
    });
  }

  /** Get a single device by EUI (from the in-memory list). */
  getDevice(eui: string): Device | undefined {
    return this.devicesMap().get(eui);
  }

  /**
   * Fetch device fields directly from the API (no caching).
   * Prefer DeviceContextService.fieldConfigs or ConfigContextService.fields for
   * components that already have a device loaded — this is for isolated lookups
   * (e.g. workflow editor selecting fields for a trigger device).
   */
  getDeviceFields(eui: string): Promise<DeviceField[]> {
    return firstValueFrom(this.api.getDeviceFields(eui));
  }

  /**
   * Fetch device controls directly from the API (no caching).
   * Prefer DeviceContextService.controls or ConfigContextService.controls for
   * components that already have a device loaded.
   */
  getDeviceControls(eui: string): Promise<DeviceControl[]> {
    return firstValueFrom(this.api.getDeviceControls(eui));
  }
}
