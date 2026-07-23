import { Injectable, inject } from '@angular/core';
import { BackendService } from '../../core/services/backend.service';
import type { PartnerBranding } from '../../core/services/branding.service';

/** The caller's own partner org (the /api/farmon/partner/org projection —
 *  the branding shape plus the record id). */
export interface PartnerOrg extends PartnerBranding {
  id?: string;
}

/** A notification_incidents row as the partner home lists it. */
export interface IncidentEntry {
  id: string;
  site: string;
  kind: string;
  status: string;
  subject: string;
  updated: string;
}

/**
 * Partner portal data access: the self-serve org endpoints plus org-wide
 * incident aggregation. The org record itself never goes through the
 * admin-only partners collection — the custom routes resolve it from auth.
 */
@Injectable({ providedIn: 'root' })
export class PartnerService {
  private readonly backend = inject(BackendService);

  getOrg(): Promise<PartnerOrg> {
    return this.backend.pb.send('/api/farmon/partner/org', { method: 'GET' }) as Promise<PartnerOrg>;
  }

  patchOrg(patch: { name?: string; brand_primary?: string; brand_accent?: string }): Promise<PartnerOrg> {
    return this.backend.pb.send('/api/farmon/partner/org', {
      method: 'PATCH',
      body: patch,
    }) as Promise<PartnerOrg>;
  }

  uploadLogo(file: File): Promise<PartnerOrg> {
    const form = new FormData();
    form.append('logo', file);
    return this.backend.pb.send('/api/farmon/partner/org/logo', {
      method: 'POST',
      body: form,
    }) as Promise<PartnerOrg>;
  }

  /** siteId → number of active incidents, across the org's whole fleet. */
  async activeIncidentCounts(): Promise<Map<string, number>> {
    const rows = await this.backend.pb.collection('notification_incidents').getFullList({
      filter: "status = 'active'",
      fields: 'site',
      requestKey: 'partner:incidents:active',
    });
    const counts = new Map<string, number>();
    for (const r of rows) {
      const site = r['site'] as string;
      counts.set(site, (counts.get(site) ?? 0) + 1);
    }
    return counts;
  }

  /** The most recent incidents across the org's sites, newest first. */
  async recentIncidents(limit = 10): Promise<IncidentEntry[]> {
    const res = await this.backend.pb.collection('notification_incidents').getList(1, limit, {
      sort: '-updated',
      requestKey: 'partner:incidents:recent',
    });
    return res.items.map((r) => ({
      id: r.id,
      site: (r['site'] ?? '') as string,
      kind: (r['kind'] ?? '') as string,
      status: (r['status'] ?? '') as string,
      subject: (r['subject'] ?? '') as string,
      updated: (r['updated'] ?? '') as string,
    }));
  }
}
