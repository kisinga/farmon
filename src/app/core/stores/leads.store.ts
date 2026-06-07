import { Injectable, inject } from '@angular/core';
import { BackendService } from '../services/backend.service';
import type { LeadEntry } from '../models/backend-api';
import { Cached } from './collection-store';

/**
 * LeadsStore — captured pricing enquiries (admin pipeline). Cached list with
 * status/delete mutations patched in place so the table updates without a
 * refetch. (The public pricing form's create is unauthenticated and carries no
 * cached state, so it stays a direct backend call.)
 */
@Injectable({ providedIn: 'root' })
export class LeadsStore {
  private backend = inject(BackendService);

  private _list = new Cached<LeadEntry[]>(() => this.backend.leadList(), []);
  readonly list = this._list.value;
  readonly loading = this._list.loading;
  readonly error = this._list.error;

  ensureLoaded(force = false): Promise<LeadEntry[]> {
    return this._list.ensureLoaded(force);
  }
  reload(): Promise<LeadEntry[]> {
    return this._list.reload();
  }

  async setStatus(id: string, status: string): Promise<void> {
    await this.backend.leadSetStatus(id, status);
    this._list.update((list) => list.map((l) => (l.id === id ? { ...l, status } : l)));
  }

  async delete(id: string): Promise<void> {
    await this.backend.leadDelete(id);
    this._list.update((list) => list.filter((l) => l.id !== id));
  }
}
