import { Injectable, computed, inject, signal } from '@angular/core';
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

  // Computed map for efficient device lookup by EUI
  devicesMap = computed(() => {
    const map = new Map<string, Device>();
    for (const device of this._devices()) {
      map.set(device.device_eui, device);
    }
    return map;
  });

  // Cache for device fields and controls to avoid repeated API calls
  private fieldCache = new Map<string, DeviceField[]>();
  private controlCache = new Map<string, DeviceControl[]>();

  /**
   * Load all devices from the backend.
   * This is typically called once during app initialization.
   */
  loadDevices(): void {
    if (this._initialized()) {
      return; // Already loaded
    }

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

  /**
   * Get device by EUI
   */
  getDevice(eui: string): Device | undefined {
    return this.devicesMap().get(eui);
  }

  /**
   * Get device fields, with caching
   */
  getDeviceFields(eui: string): Promise<DeviceField[]> {
    return new Promise((resolve, reject) => {
      // Check cache first
      const cached = this.fieldCache.get(eui);
      if (cached) {
        resolve(cached);
        return;
      }

      // Load from API and cache
      this.api.getDeviceFields(eui).subscribe({
        next: (fields) => {
          this.fieldCache.set(eui, fields);
          resolve(fields);
        },
        error: reject,
      });
    });
  }

  /**
   * Get device controls, with caching
   */
  getDeviceControls(eui: string): Promise<DeviceControl[]> {
    return new Promise((resolve, reject) => {
      // Check cache first
      const cached = this.controlCache.get(eui);
      if (cached) {
        resolve(cached);
        return;
      }

      // Load from API and cache
      this.api.getDeviceControls(eui).subscribe({
        next: (controls) => {
          this.controlCache.set(eui, controls);
          resolve(controls);
        },
        error: reject,
      });
    });
  }

  /**
   * Get categorized device fields grouped by category
   */
  async getFieldsByCategory(eui: string): Promise<Map<string, DeviceField[]>> {
    const fields = await this.getDeviceFields(eui);
    const grouped = new Map<string, DeviceField[]>();

    for (const field of fields) {
      const category = field.category || 'other';
      if (!grouped.has(category)) {
        grouped.set(category, []);
      }
      grouped.get(category)!.push(field);
    }

    return grouped;
  }

  /**
   * Clear all caches
   */
  clearCache(): void {
    this.fieldCache.clear();
    this.controlCache.clear();
  }
}
