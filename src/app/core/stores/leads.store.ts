import { Injectable, inject } from '@angular/core';
import { BackendService } from '../services/backend.service';
import type { LeadEntry } from '../models/backend-api';
import { CollectionStore } from './collection-store';

/**
 * LeadsStore — captured pricing enquiries (admin pipeline). Cached list with
 * status/delete mutations patched in place so the table updates without a
 * refetch. (The public pricing form's create is unauthenticated and carries no
 * cached state, so it stays a direct backend call.)
 */
@Injectable({ providedIn: 'root' })
export class LeadsStore extends CollectionStore<LeadEntry[]> {
  private backend = inject(BackendService);
  readonly list = this.value;

  constructor() {
    super([]);
  }
  protected fetch(): Promise<LeadEntry[]> {
    return this.backend.leadList();
  }

  async setStatus(id: string, status: string): Promise<void> {
    await this.backend.leadSetStatus(id, status);
    this.mutate((list) => list.map((l) => (l.id === id ? { ...l, status } : l)));
  }

  /** Close a lead and link it to the site it became. Patches the cached row so
   *  the table shows "Converted" without a refetch. */
  async markConverted(lead: LeadEntry, siteId: string): Promise<void> {
    await this.backend.leadMarkConverted(lead.id, siteId, lead.estimate);
    this.mutate((list) => list.map((l) => (l.id === lead.id
      ? { ...l, status: 'closed', estimate: l.estimate ? { ...l.estimate, convertedSiteId: siteId } : l.estimate }
      : l)));
  }

  async delete(id: string): Promise<void> {
    await this.backend.leadDelete(id);
    this.mutate((list) => list.filter((l) => l.id !== id));
  }
}
