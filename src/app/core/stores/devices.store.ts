import { Injectable, inject } from '@angular/core';
import { BackendService } from '../services/backend.service';
import { SitesStore } from './sites.store';
import type { DeviceEntry } from '../models/backend-api';
import { CollectionStore } from './collection-store';

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
export class DevicesStore extends CollectionStore<DeviceEntry[]> {
  private backend = inject(BackendService);
  private sites = inject(SitesStore);
  readonly list = this.value;

  constructor() {
    super([]);
  }
  protected fetch(): Promise<DeviceEntry[]> {
    return this.backend.deviceList();
  }

  /** Registry status of a single device (null until provisioned). Point read. */
  status(deviceId: string): Promise<DeviceEntry | null> {
    return this.backend.deviceStatus(deviceId);
  }

  async rename(id: string, name: string): Promise<void> {
    await this.backend.deviceRename(id, name);
    this.mutate((list) => list.map((d) => (d.id === id ? { ...d, name } : d)));
  }

  async deregister(id: string): Promise<void> {
    await this.backend.deviceDeregister(id);
    this.mutate((list) =>
      list.map((d) => (d.id === id ? { ...d, active: false, online: false } : d)),
    );
    this.sites.invalidate(); // freed a hosting slot → site device count changed
  }

  async reactivate(id: string): Promise<void> {
    await this.backend.deviceReactivate(id);
    this.mutate((list) => list.map((d) => (d.id === id ? { ...d, active: true } : d)));
    this.sites.invalidate(); // consumed a hosting slot
  }

  /** Clear a flagged MAC conflict (legit board swap) so the next board re-binds. */
  async clearMacBinding(id: string): Promise<void> {
    await this.backend.deviceClearMacBinding(id);
    this.mutate((list) =>
      list.map((d) => (d.id === id ? { ...d, macConflict: false, conflictMac: '' } : d)),
    );
  }

  /** After a generate registers/updates a device: refetch fleet + site counts. */
  invalidateAfterProvision(): void {
    this.invalidate();
    this.sites.invalidate();
  }
}
