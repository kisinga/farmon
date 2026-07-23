import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthStore } from '../core/services/auth.store';
import { BackendService } from '../core/services/backend.service';
import { PersonaService, type PersonaSwitch } from '../core/services/persona.service';

interface PersonaOption {
  id: string;
  name: string;
}

/**
 * PersonaSwitcherComponent — the dev-only role simulator in the navbar. Visible
 * only when PersonaService's probe says the caller is allowlisted
 * (MAJI_PERSONA_EMAILS); in production it never renders. One click flips the
 * caller's own account to admin / partner / site-owner customer / outsider
 * customer and reloads the app under the new persona. The Partner persona keeps
 * the caller's current org unless another is picked; the site personas default
 * to the site in the current `/site/:name/...` route, else the first site.
 */
@Component({
  selector: 'app-persona-switcher',
  standalone: true,
  imports: [],
  template: `
    @if (persona.enabled()) {
    <details class="dropdown dropdown-end">
      <summary
        class="btn btn-ghost btn-sm gap-1.5 list-none"
        title="Dev persona switcher"
        aria-label="Dev persona switcher"
        (click)="open()"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
          <path stroke-linecap="round" stroke-linejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
        </svg>
        <span class="text-xs hidden sm:inline">Persona: {{ auth.role() }}</span>
        @if (persona.switching()) {
          <span class="loading loading-spinner loading-xs"></span>
        }
      </summary>

      <div class="dropdown-content z-50 mt-1 w-64 rounded-box bg-base-100 ring-1 ring-base-300/40 shadow-xl p-2">
        <div class="px-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-base-content/40">Dev persona</div>

        @if (orgs().length > 0) {
          <label class="block px-1 pb-1">
            <span class="text-[10px] uppercase tracking-wider text-base-content/40">Org (partner persona)</span>
            <select class="select select-bordered select-xs w-full mt-0.5" (change)="orgId.set($any($event.target).value)">
              @for (o of orgs(); track o.id) {
                <option [value]="o.id" [selected]="o.id === orgId()">{{ o.name }}</option>
              }
            </select>
          </label>
        }
        @if (sites().length > 0) {
          <label class="block px-1 pb-1">
            <span class="text-[10px] uppercase tracking-wider text-base-content/40">Site (owner personas)</span>
            <select class="select select-bordered select-xs w-full mt-0.5" (change)="siteId.set($any($event.target).value)">
              @for (s of sites(); track s.id) {
                <option [value]="s.id" [selected]="s.id === siteId()">{{ s.name }}</option>
              }
            </select>
          </label>
        }

        <ul class="menu menu-sm p-0">
          <li><button [disabled]="persona.switching()" (click)="go({ role: 'admin' })">Admin</button></li>
          <li><button [disabled]="persona.switching()" (click)="asPartner()">Partner</button></li>
          <li><button [disabled]="persona.switching() || !siteId()" (click)="asSiteOwner()">Site owner (customer)</button></li>
          <li><button [disabled]="persona.switching()" (click)="asCustomer()">Customer (no site)</button></li>
        </ul>
      </div>
    </details>
    }
  `,
})
export class PersonaSwitcherComponent {
  protected persona = inject(PersonaService);
  protected auth = inject(AuthStore);
  private backend = inject(BackendService);
  private router = inject(Router);

  protected orgs = signal<PersonaOption[]>([]);
  protected sites = signal<PersonaOption[]>([]);
  protected orgId = signal('');
  protected siteId = signal('');
  private loaded = false;

  /** Lazy-load the org/site pickers on first open (best-effort: the partners
   *  collection is admin-only, so a switched-to-customer caller just keeps
   *  their current org). */
  protected open(): void {
    if (this.loaded) return;
    this.loaded = true;
    void this.load();
  }

  private async load(): Promise<void> {
    const current = (this.backend.pb.authStore.record?.['partner'] ?? '') as string;
    this.orgId.set(current);
    try {
      const orgs = await this.backend.pb.collection('partners').getFullList({ sort: 'name' });
      this.orgs.set(orgs.map((o) => ({ id: o.id, name: (o['name'] || o.id) as string })));
      if (!this.orgId() && orgs.length) this.orgId.set(orgs[0].id);
    } catch {
      /* not listable under the current persona — keep the current org */
    }
    try {
      const sites = await this.backend.siteList();
      this.sites.set(sites.map((s) => ({ id: s.id, name: (s['name'] || s.id) as string })));
      this.siteId.set(this.routeSite() || (sites[0]?.id ?? ''));
    } catch {
      /* no visible sites under the current persona */
    }
  }

  /** The site id when on a `/site/:name/...` page ('' elsewhere). */
  private routeSite(): string {
    return /^\/site\/([^/]+)/.exec(this.router.url)?.[1] ?? '';
  }

  protected asPartner(): void {
    // No org picked (or none listable) → omit `partner`: the server keeps the
    // caller's current org assignment.
    const org = this.orgId();
    this.go({ role: 'partner', ...(org ? { partner: org } : {}) });
  }

  protected asSiteOwner(): void {
    const site = this.siteId();
    if (!site) return;
    this.go({ role: 'customer', site, grantSite: true });
  }

  protected asCustomer(): void {
    // "No site": drop the caller from the selected site's owner list when one
    // is known; otherwise the bare role flip still applies.
    const site = this.siteId();
    this.go({ role: 'customer', ...(site ? { site, grantSite: false } : {}) });
  }

  protected go(input: PersonaSwitch): void {
    // switch() reloads the page on success; only a failure needs reporting.
    this.persona.switch(input).catch((err) => {
      this.persona.switching.set(false);
      console.error('[persona] switch failed:', err);
    });
  }
}
