import { Injectable, inject } from '@angular/core';
import { BackendService } from '../services/backend.service';
import { SitesStore } from './sites.store';
import type { DeviceEntry } from '../models/backend-api';
import { Cached } from './collection-store';

/**
 * DevicesStore — the provisioned-device fleet (`controllers` rows). The Devices
 * page reads the cached list; mutations patch it in place so the view updates
 * without a refetch. Deregistering frees a hosting slot, so it also invalidates
 * SitesStore (the site's device count changed); the deploy page does the same
 * after a generate registers a new device.
 *
 * Per-device status is a point read (firmware/deploy) and is not cached.
 */
@Injectable({ providedIn: 'root' })
export class DevicesStore {
  private backend = inject(BackendService);
  private sites = inject(SitesStore);

  private _list = new Cached<DeviceEntry[]>(() => this.backend.deviceList(), []);
  readonly list = this._list.value;
  readonly loading = this._list.loading;
  readonly error = this._list.error;

  ensureLoaded(force = false): Promise<DeviceEntry[]> {
    return this._list.ensureLoaded(force);
  }
  reload(): Promise<DeviceEntry[]> {
    return this._list.reload();
  }
  invalidate(): void {
    this._list.invalidate();
  }

  /** Registry status of a single device (null until provisioned). Point read. */
  status(deviceId: string): Promise<DeviceEntry | null> {
    return this.backend.deviceStatus(deviceId);
  }

  async rename(id: string, name: string): Promise<void> {
    await this.backend.deviceRename(id, name);
    this._list.update((list) => list.map((d) => (d.id === id ? { ...d, name } : d)));
  }

  async deregister(id: string): Promise<void> {
    await this.backend.deviceDeregister(id);
    this._list.update((list) => list.filter((d) => d.id !== id));
    this.sites.invalidate(); // freed a hosting slot → site device count changed
  }

  /** After a generate registers/updates a device: refetch fleet + site counts. */
  invalidateAfterProvision(): void {
    this._list.invalidate();
    this.sites.invalidate();
  }
}
