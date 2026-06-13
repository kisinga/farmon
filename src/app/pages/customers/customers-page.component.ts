import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CustomersStore } from '../../core/stores/customers.store';
import { SitesStore } from '../../core/stores/sites.store';
import { ConfirmService } from '../../core/services/confirm.service';
import type { CustomerEntry } from '../../core/models/backend-api';
import { SectionHeaderComponent } from '../editor/shared/section-header.component';
import { AssignPickerComponent, type AssignItem } from '../../shared/assign-picker/assign-picker.component';

/** Initials (up to 2 chars) for an avatar. */
function initials(s: string): string {
  return s
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

function fmtDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Customers admin page. Full management of customer accounts (users with
 * role=customer): create (with an emailed set-password invite), edit, delete, and
 * resend the invite. Each row shows how many sites the customer owns. Assigning a
 * customer to a site stays on the site card (Overview); this is the account home.
 */
@Component({
  selector: 'app-customers-page',
  standalone: true,
  imports: [SectionHeaderComponent, AssignPickerComponent],
  host: { class: 'flex-1 overflow-auto' },
  template: `
    <div class="content-pane space-y-6">
      <app-section-header
        title="Customers"
        subtitle="Customer accounts that own sites. Create one to email them a set-password invite." />

      <!-- Toolbar -->
      <div class="flex items-center gap-3">
        <input type="text" class="input input-sm input-bordered flex-1 max-w-xs"
               placeholder="Search name or email…"
               [value]="search()"
               (input)="search.set($any($event.target).value)" />
        <span class="flex-1"></span>
        <button class="btn btn-sm border-0 bg-cyan-400 text-slate-950 hover:bg-cyan-300" (click)="openCreate()">
          Add customer
        </button>
      </div>

      <!-- Status banner -->
      @if (status(); as st) {
        <div class="alert text-sm py-2" [class]="st.ok ? 'alert-success' : 'alert-error'">
          <span>{{ st.text }}</span>
          <button class="btn btn-ghost btn-xs" (click)="status.set(null)">Dismiss</button>
        </div>
      }

      @if (loading()) {
        <div class="flex items-center justify-center py-24"><span class="loading loading-spinner loading-lg text-cyan-400"></span></div>
      } @else if (customers().length === 0) {
        <div class="rounded-2xl border border-dashed border-base-300/50 py-16 text-center">
          <p class="text-base font-medium">No customers yet</p>
          <p class="text-sm text-base-content/50 mt-1">Add a customer to email them an invite to set their password.</p>
        </div>
      } @else {
        <div class="surface divide-y divide-base-300/20">
          @for (c of filtered(); track c.id) {
            <div class="flex items-center gap-3 px-5 py-3">
              <span class="flex items-center justify-center w-9 h-9 rounded-full bg-base-300 text-xs font-semibold shrink-0">{{ ini(c.name || c.email) }}</span>
              <div class="flex-1 min-w-0">
                <p class="text-sm font-medium truncate">
                  {{ c.name || '(no name)' }}
                  @if (c.verified) { <span class="badge badge-success badge-xs ml-1 align-middle">verified</span> }
                  @else { <span class="badge badge-ghost badge-xs ml-1 align-middle">invited</span> }
                </p>
                <p class="text-[11px] text-base-content/50 truncate">{{ c.email }}</p>
              </div>
              <div class="hidden sm:flex flex-col items-end text-[11px] text-base-content/50 shrink-0">
                <button class="link link-hover font-medium text-base-content/70" (click)="openSites(c)"
                        title="Manage which sites this customer is assigned to">
                  {{ siteCount(c.id) }} site{{ siteCount(c.id) !== 1 ? 's' : '' }}
                </button>
                @if (c.created) { <span>since {{ date(c.created) }}</span> }
              </div>
              <div class="dropdown dropdown-end shrink-0">
                <button tabindex="0" class="btn btn-xs btn-ghost btn-square" title="More">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M12 5v.01M12 12v.01M12 19v.01" />
                  </svg>
                </button>
                <ul tabindex="0" class="dropdown-content menu bg-base-100 rounded-box shadow-lg border border-base-300/40 z-50 w-44 p-1.5">
                  <li><button (click)="openSites(c)">Manage sites</button></li>
                  <li><button (click)="openEdit(c)">Edit</button></li>
                  <li><button (click)="resend(c)">Resend invite</button></li>
                  <li><button class="text-error" (click)="remove(c)">Delete</button></li>
                </ul>
              </div>
            </div>
          } @empty {
            <p class="px-5 py-8 text-center text-sm text-base-content/40">No match.</p>
          }
        </div>
      }
    </div>

    <!-- Create / edit dialog -->
    @if (showForm()) {
      <dialog class="modal modal-open">
        <div class="modal-box max-w-sm">
          <h3 class="font-bold text-lg mb-4">{{ editing() ? 'Edit customer' : 'New customer' }}</h3>
          <label class="form-control mb-3">
            <span class="label-text mb-1">Name</span>
            <input type="text" class="input input-bordered w-full" placeholder="e.g. Jane Mwangi" #nameI [value]="editing()?.name ?? ''" />
          </label>
          <label class="form-control">
            <span class="label-text mb-1">Email</span>
            <input type="email" class="input input-bordered w-full" placeholder="jane@example.com" #emailI [value]="editing()?.email ?? ''" />
          </label>
          @if (formError()) { <p class="text-error text-xs mt-2">{{ formError() }}</p> }
          <div class="modal-action">
            <button class="btn btn-ghost" (click)="closeForm()" [disabled]="busy()">Cancel</button>
            <button class="btn border-0 bg-cyan-400 text-slate-950 hover:bg-cyan-300"
                    [disabled]="busy()"
                    (click)="submit(nameI.value, emailI.value)">
              @if (busy()) { <span class="loading loading-spinner loading-xs"></span> }
              {{ editing() ? 'Save' : 'Create & invite' }}
            </button>
          </div>
        </div>
        <div class="modal-backdrop" (click)="closeForm()"></div>
      </dialog>
    }

    <!-- Manage which sites this customer is assigned to (the user→sites direction) -->
    @if (managingSites(); as c) {
      <app-assign-picker
        [title]="'Assign sites'"
        [subtitle]="(c.name || c.email) + ' — sites they can access'"
        searchPlaceholder="Search sites by name…"
        emptyText="No sites exist yet."
        [items]="siteItems()"
        [selectedIds]="managedSiteSet()"
        (toggle)="onSiteToggle(c.id, $event)"
        (clear)="clearSites(c.id)"
        (close)="managingSites.set(null)" />
    }
  `,
})
export class CustomersPageComponent implements OnInit {
  private customersStore = inject(CustomersStore);
  private sitesStore = inject(SitesStore);
  private confirmService = inject(ConfirmService);

  protected customers = computed(() => this.customersStore.list());
  protected loading = signal(true);
  protected search = signal('');
  protected showForm = signal(false);
  protected editing = signal<CustomerEntry | null>(null);
  protected busy = signal(false);
  protected formError = signal<string | null>(null);
  protected status = signal<{ ok: boolean; text: string } | null>(null);

  /** userId → number of sites they co-own (for the per-row count). */
  private siteCounts = computed(() => {
    const m = new Map<string, number>();
    for (const s of this.sitesStore.list()) {
      for (const owner of s.owners) m.set(owner, (m.get(owner) ?? 0) + 1);
    }
    return m;
  });

  protected filtered = computed(() => {
    const q = this.search().trim().toLowerCase();
    const list = this.customers();
    return q
      ? list.filter((c) => c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q))
      : list;
  });

  /** The customer whose "assign sites" dialog is open (the user→sites direction). */
  protected managingSites = signal<CustomerEntry | null>(null);
  /** All sites as picker rows, with a small co-owner-count hint as the subline. */
  protected siteItems = computed<AssignItem[]>(() =>
    this.sitesStore.list().map((s) => ({
      id: s.id,
      label: s.friendlyName,
      sub: s.owners.length === 1 ? '1 user assigned' : `${s.owners.length} users assigned`,
    })),
  );
  /** Sites the open customer is currently a co-owner of, as a Set for the picker. */
  protected managedSiteSet = computed(() => {
    const id = this.managingSites()?.id;
    return new Set(id ? this.sitesStore.list().filter((s) => s.owners.includes(id)).map((s) => s.id) : []);
  });

  protected openSites(c: CustomerEntry): void {
    this.managingSites.set(c);
  }

  /** Add/remove this customer from one site's co-owner set. */
  protected onSiteToggle(customerId: string, e: { id: string; selected: boolean }): Promise<void> {
    return this.sitesStore.toggleOwner(e.id, customerId, e.selected);
  }

  /** Remove this customer from every site they're assigned to ("Clear all"). */
  protected async clearSites(customerId: string): Promise<void> {
    const sites = this.sitesStore.list().filter((s) => s.owners.includes(customerId));
    for (const s of sites) {
      await this.sitesStore.toggleOwner(s.id, customerId, false);
    }
  }

  async ngOnInit() {
    try {
      await Promise.all([this.customersStore.ensureLoaded(), this.sitesStore.ensureLoaded()]);
    } finally {
      // Always clear the spinner — a failed fetch lands its cause on the store's
      // `error` signal rather than hanging the page on the loader forever.
      this.loading.set(false);
    }
  }

  protected ini(s: string): string {
    return initials(s);
  }
  protected date(iso: string): string {
    return fmtDate(iso);
  }
  protected siteCount(id: string): number {
    return this.siteCounts().get(id) ?? 0;
  }

  protected openCreate(): void {
    this.editing.set(null);
    this.formError.set(null);
    this.showForm.set(true);
  }

  protected openEdit(c: CustomerEntry): void {
    this.editing.set(c);
    this.formError.set(null);
    this.showForm.set(true);
  }

  protected closeForm(): void {
    if (this.busy()) return;
    this.showForm.set(false);
  }

  protected async submit(name: string, email: string): Promise<void> {
    const n = name.trim();
    const e = email.trim();
    if (!n) return this.formError.set('Name is required.');
    if (!EMAIL_RE.test(e)) return this.formError.set('A valid email is required.');
    this.busy.set(true);
    this.formError.set(null);
    try {
      const editing = this.editing();
      if (editing) {
        await this.customersStore.update(editing.id, { name: n, email: e });
        this.status.set({ ok: true, text: 'Customer updated.' });
      } else {
        const { invited } = await this.customersStore.create({ name: n, email: e });
        this.status.set({
          ok: invited,
          text: invited
            ? `Customer created — invite email sent to ${e}.`
            : 'Customer created, but the invite email failed (check SMTP). Use “Resend invite”.',
        });
      }
      this.showForm.set(false);
    } catch (err) {
      this.formError.set(this.msg(err));
    } finally {
      this.busy.set(false);
    }
  }

  protected async resend(c: CustomerEntry): Promise<void> {
    try {
      await this.customersStore.invite(c.email);
      this.status.set({ ok: true, text: `Invite re-sent to ${c.email}.` });
    } catch (err) {
      this.status.set({ ok: false, text: `Could not send the invite (check SMTP): ${this.msg(err)}` });
    }
  }

  protected async remove(c: CustomerEntry): Promise<void> {
    const owned = this.siteCount(c.id);
    const confirmed = await this.confirmService.confirm({
      title: 'Delete customer',
      message:
        `Delete "${c.name || c.email}"? They lose access immediately.` +
        (owned > 0 ? ` The ${owned} site${owned !== 1 ? 's' : ''} they own will become unassigned.` : ''),
    });
    if (!confirmed) return;
    try {
      await this.customersStore.remove(c.id);
      this.sitesStore.invalidate(); // owners may have been nulled on their sites
      this.status.set({ ok: true, text: 'Customer deleted.' });
    } catch (err) {
      this.status.set({ ok: false, text: this.msg(err) });
    }
  }

  private msg(err: unknown): string {
    return (err as { message?: string })?.message || 'Something went wrong.';
  }
}
