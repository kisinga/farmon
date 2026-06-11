import { Injectable, inject } from '@angular/core';
import type { UnsubscribeFunc } from 'pocketbase';
import { BackendService } from '../../core/services/backend.service';
import { type NewAutomationRow } from '@core';

/** An automation row as stored in the `automations` collection (create shape + id). */
export interface AutomationRecord extends NewAutomationRow {
  id: string;
}

/**
 * Thin data layer for the operator automations page: CRUD + realtime over the
 * `automations` collection (owner-scoped by PB rules), plus the one-time import of
 * legacy in-topology schedules. Stamping (controller/route_index/route_set_version)
 * is done by the caller via listAutomatableRoutes — this service just persists.
 */
@Injectable({ providedIn: 'root' })
export class AutomationsService {
  private backend = inject(BackendService);
  private get pb() { return this.backend.pb; }

  async list(siteId: string): Promise<AutomationRecord[]> {
    return this.pb.collection('automations').getFullList<AutomationRecord>({
      filter: this.pb.filter('site = {:s}', { s: siteId }),
      sort: 'created',
      requestKey: `automations:${siteId}`,
    });
  }

  async create(row: NewAutomationRow): Promise<AutomationRecord> {
    return this.pb.collection('automations').create<AutomationRecord>(row);
  }

  async update(id: string, patch: Partial<NewAutomationRow>): Promise<AutomationRecord> {
    return this.pb.collection('automations').update<AutomationRecord>(id, patch);
  }

  async remove(id: string): Promise<void> {
    await this.pb.collection('automations').delete(id);
  }

  /** Live updates for a site's automations. The server republishes the retained
   *  set on every change, so the page only needs to refresh its own list. */
  subscribe(siteId: string, cb: () => void): Promise<UnsubscribeFunc> {
    return this.pb.collection('automations').subscribe('*', () => cb(), {
      filter: this.pb.filter('site = {:s}', { s: siteId }),
    });
  }
}
