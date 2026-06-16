import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { LeadsStore } from '../../core/stores/leads.store';
import { ConfirmService } from '../../core/services/confirm.service';
import type { LeadEntry } from '../../core/models/backend-api';
import { SectionHeaderComponent } from '../editor/shared/section-header.component';

/** "Mon D, YYYY" for an ISO timestamp. */
function fmtDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

const STATUSES = ['new', 'contacted', 'closed'] as const;

/**
 * Leads (admin). The sales pipeline for enquiries captured by the public pricing
 * estimator — previously stored but never surfaced. Shows each enquiry with the
 * configuration the visitor priced, and lets an admin move it new → contacted →
 * closed or delete it.
 */
@Component({
  selector: 'app-leads-page',
  standalone: true,
  imports: [SectionHeaderComponent],
  host: { class: 'flex-1 overflow-auto' },
  template: `
    <div class="content-pane space-y-6">
      <app-section-header title="Leads" [subtitle]="subtitle()" />

      @if (loading()) {
        <div class="flex items-center justify-center py-24"><span class="loading loading-spinner loading-lg text-cyan-400"></span></div>
      } @else if (leads().length === 0) {
        <div class="rounded-2xl border border-dashed border-base-300/50 py-16 text-center">
          <p class="text-base font-medium">No leads yet</p>
          <p class="text-sm text-base-content/50 mt-1">Submissions from the /pricing estimator land here.</p>
        </div>
      } @else {
        <div class="space-y-3">
          @for (l of leads(); track l.id) {
            <div class="surface p-5" [class.opacity-60]="status(l) === 'closed'">
              <div class="flex items-start justify-between gap-4 flex-wrap">
                <div class="min-w-0">
                  <div class="flex items-center gap-2">
                    <h3 class="font-semibold text-sm truncate">{{ l.name }}</h3>
                    <span class="badge badge-xs border-0" [class]="badgeClass(status(l))">{{ status(l) }}</span>
                  </div>
                  <p class="text-xs text-base-content/60 mt-1">
                    @if (l.phone) { <a class="hover:text-cyan-300" [href]="'tel:' + l.phone">{{ l.phone }}</a> }
                    @if (l.phone && l.email) { <span class="text-base-content/30"> · </span> }
                    @if (l.email) { <a class="hover:text-cyan-300" [href]="'mailto:' + l.email">{{ l.email }}</a> }
                  </p>
                  <p class="text-[11px] text-base-content/40 mt-0.5">{{ fmt(l.created) }} · via {{ l.source || 'pricing' }}</p>
                </div>
                <div class="flex items-center gap-2 shrink-0">
                  <select class="select select-bordered select-xs" [value]="status(l)" (change)="setStatus(l, $any($event.target).value)">
                    @for (s of statuses; track s) { <option [value]="s">{{ s }}</option> }
                  </select>
                  <button class="btn btn-xs btn-ghost text-error" (click)="remove(l)" title="Delete">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>

              @if (l.estimate; as est) {
                <div class="mt-3 pt-3 border-t border-base-300/30 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-base-content/60">
                  <span class="text-base-content/40">Priced:</span>
                  <span>{{ est.input.pumps }} pump{{ est.input.pumps !== 1 ? 's' : '' }}</span>
                  <span>{{ est.input.valves }} valve{{ est.input.valves !== 1 ? 's' : '' }}</span>
                  <span>{{ est.input.flow }} flow</span>
                  <span>{{ est.input.tanks }} tank{{ est.input.tanks !== 1 ? 's' : '' }}</span>
                  <span class="text-base-content/30">|</span>
                  <span>{{ est.controllers }} controller{{ est.controllers !== 1 ? 's' : '' }}@if (est.tier) { · {{ est.tier }} }</span>
                  @if (est.monthly !== undefined) {
                    <span class="text-base-content/80 font-medium">{{ kes(est.monthly) }}/mo</span>
                  }
                  <span>kit {{ kes(est.oneTime) }}</span>
                </div>
              }
            </div>
          }
        </div>
      }
    </div>
  `,
})
export class LeadsPageComponent implements OnInit {
  private leadsStore = inject(LeadsStore);
  private confirmService = inject(ConfirmService);

  protected readonly statuses = STATUSES;
  protected leads = computed(() => this.leadsStore.list());
  protected loading = signal(true);

  protected subtitle = computed(() => {
    const all = this.leads();
    if (!all.length) return 'Enquiries from the public pricing estimator.';
    const open = all.filter((l) => this.status(l) !== 'closed').length;
    return `${open} open of ${all.length} · enquiries from the public pricing estimator.`;
  });

  async ngOnInit() {
    await this.refresh();
  }

  private async refresh() {
    this.loading.set(true);
    await this.leadsStore.ensureLoaded();
    this.loading.set(false);
  }

  /** Empty status (pre-status rows / fresh submissions) reads as 'new'. */
  protected status(l: LeadEntry): string {
    return l.status || 'new';
  }

  protected fmt(iso: string): string {
    return fmtDate(iso);
  }

  protected kes(n: number): string {
    return 'KES ' + n.toLocaleString('en-KE');
  }

  protected badgeClass(s: string): string {
    if (s === 'contacted') return 'bg-sky-400/15 text-sky-300';
    if (s === 'closed') return 'bg-base-content/10 text-base-content/50';
    return 'bg-cyan-400/15 text-cyan-300'; // new
  }

  protected async setStatus(l: LeadEntry, status: string): Promise<void> {
    await this.leadsStore.setStatus(l.id, status);
  }

  protected async remove(l: LeadEntry): Promise<void> {
    const confirmed = await this.confirmService.confirm({
      title: 'Delete lead',
      message: `Delete the enquiry from "${l.name}"? This cannot be undone.`,
    });
    if (!confirmed) return;
    await this.leadsStore.delete(l.id);
  }
}
