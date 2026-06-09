import { Injectable, computed, inject } from '@angular/core';
import { HOSTING_DEVICE_CAP } from '@core';
import { BackendService } from '../services/backend.service';
import type { AppConfig, AppConfigRecord } from '../models/backend-api';
import { CollectionStore } from './collection-store';

/**
 * ConfigStore — the shared runtime app config (today: the managed hosting device
 * cap). Overview and Devices both need it; the base Cached shares one fetch per
 * session instead of each page re-hitting `/api/farmon/config`. The admin
 * Settings page edits the underlying `app_config` row through here and the
 * runtime cache is patched in lockstep so the cap stays correct without a refetch.
 */
@Injectable({ providedIn: 'root' })
export class ConfigStore extends CollectionStore<AppConfig> {
  private backend = inject(BackendService);
  /** The runtime config (alias of the base `value`). */
  readonly config = this.value;
  readonly cap = computed(() => this.value().hostingDeviceCap);

  constructor() {
    super({ hostingDeviceCap: HOSTING_DEVICE_CAP });
  }
  protected fetch(): Promise<AppConfig> {
    return this.backend.getConfig();
  }

  // --- Admin edit (Settings page) ----------------------------------------
  // The editable `app_config` row carries the record id the runtime endpoint
  // omits, so the edit path reads the collection directly.

  /** Load the editable config record (admin Settings). */
  loadForEdit(): Promise<AppConfigRecord> {
    return this.backend.configForEdit();
  }

  /** Persist an edit, then keep the shared runtime cache in lockstep (no refetch). */
  async save(id: string, patch: { hostingDeviceCap: number }): Promise<void> {
    await this.backend.configSave(id, patch);
    this.mutate((c) => ({ ...c, hostingDeviceCap: patch.hostingDeviceCap }));
  }
}
