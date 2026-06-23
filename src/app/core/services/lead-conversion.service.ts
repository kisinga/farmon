import { Injectable, inject } from '@angular/core';
import { composeEasyMode, toStoredTopology, type Handoff, type StoredSiteTopology } from '@core';
import type { LeadEntry } from '../models/backend-api';
import { LeadsStore } from '../stores/leads.store';
import { CustomersStore } from '../stores/customers.store';
import { SitesStore } from '../stores/sites.store';
import { BoardService } from './board.service';
import { BackendService } from './backend.service';

/** Outcome of converting a lead into an account + site. */
export interface LeadConversionResult {
  siteId: string;
  customerId: string;
  /** A brand-new account was created (vs. an existing customer matched by email). */
  createdCustomer: boolean;
  /** Set when the re-composed design still needs a human touch in the editor. */
  handoff?: Handoff;
  /** The site was created from a pin-less snapshot (old lead with no saved
   *  answers, or the board could not be loaded), so wiring must be finished in
   *  the editor before it can flash. */
  needsWiring: boolean;
}

/**
 * Turns a captured pricing lead into a customer account and a site, carrying the
 * design across. When the lead saved its Easy Mode answers, the composer is
 * re-run with the real board so the site is pin-wired and ready to flash (the
 * same path the admin quick-setup stepper uses); otherwise the stored pin-less
 * snapshot is transferred for an admin to finish in the editor.
 *
 * Pure orchestration: every step is an existing store/service method, so there
 * is no new persistence logic here, just the sequence.
 */
@Injectable({ providedIn: 'root' })
export class LeadConversionService {
  private customers = inject(CustomersStore);
  private sites = inject(SitesStore);
  private leads = inject(LeadsStore);
  private boards = inject(BoardService);
  private backend = inject(BackendService);

  async convert(lead: LeadEntry, opts: { siteName: string; email: string }): Promise<LeadConversionResult> {
    const siteName = opts.siteName.trim();
    const email = opts.email.trim();
    if (!siteName) throw new Error('A site name is required.');
    if (!email) throw new Error('A customer email is required to create the account.');

    // Read the freshest lead from the store: a prior attempt that failed partway
    // (or a second click in the still-open dialog) may have already created and
    // linked a site, while the caller still holds the stale row. The link is the
    // guard against a duplicate site.
    const current = this.leads.list().find((l) => l.id === lead.id) ?? lead;
    if (current.estimate?.convertedSiteId) {
      throw new Error('This lead has already been converted to a site.');
    }
    const profile = current.estimate?.profile ?? null;
    const snapshot = current.estimate?.topology ?? null;
    if (!profile && !snapshot) {
      throw new Error('This lead has no saved design to convert.');
    }

    // 1. Find-or-create the customer. Silent: invites are a later admin step.
    const existing = await this.customers.findByEmail(email);
    const customer = existing
      ?? (await this.customers.create({ name: current.name || email, email }, { invite: false })).customer;

    // 2. Re-compose with the real board when we have the answers; otherwise fall
    //    back to the stored (pin-less) snapshot.
    const board = await this.boards.loadEasyModeBoard();
    let stored: StoredSiteTopology | null = null;
    let handoff: Handoff | undefined;
    let needsWiring = false;
    if (profile && board) {
      const result = composeEasyMode(profile, board.board, board.model, this.backend.newControllerId(siteName));
      handoff = result.handoff;
      stored = result.topology ? toStoredTopology(result.topology) : null;
      needsWiring = !!handoff; // expert / setup_service: finish in the editor
    } else if (snapshot) {
      stored = toStoredTopology(snapshot);
      needsWiring = true; // pin-less snapshot, or no board to wire against
    } else {
      needsWiring = true; // profile but the board catalog is unavailable: finish in editor
    }

    // 3. Create the site, then link the lead immediately. Site creation is the
    //    only non-idempotent step; recording convertedSiteId right after it means
    //    a retry trips the guard above instead of minting a second site, and any
    //    failure in step 4 leaves a recoverable half-built site, never a dup.
    const slug = this.slugify(siteName);
    const { id: siteId } = await this.sites.create(slug, siteName);
    await this.leads.markConverted(current, siteId);

    // 4. Save the design and add the customer as owner. Force a list refresh so
    //    toggleOwner sees the freshly-created site (and keeps the creating admin
    //    as co-owner rather than replacing the set).
    if (stored) {
      await this.backend.siteSave({ site: { id: siteId, friendlyName: siteName }, topology: stored });
    }
    await this.sites.ensureLoaded(true);
    await this.sites.toggleOwner(siteId, customer.id, true);

    return { siteId, customerId: customer.id, createdCustomer: !existing, handoff, needsWiring };
  }

  private slugify(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }
}
