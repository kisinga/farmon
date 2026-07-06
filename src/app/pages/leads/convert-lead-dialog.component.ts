import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { LeadEntry } from '../../core/models/backend-api';
import { LeadConversionService, type LeadConversionResult } from '../../core/services/lead-conversion.service';

/**
 * Convert-lead dialog. Confirms the site name and the customer email, then runs
 * LeadConversionService to create the account + site and carry the design over.
 * A plain modal (ConfirmService is yes/no only, and this needs editable fields).
 * Shows its own success state with a link into the new site.
 */
@Component({
  selector: 'app-convert-lead-dialog',
  standalone: true,
  imports: [RouterLink],
  host: { class: 'contents' },
  template: `
    <dialog class="modal modal-open">
      <div class="modal-box max-w-md">
        @if (result(); as r) {
          <div class="text-center py-2">
            <div class="w-12 h-12 mx-auto rounded-full bg-emerald-400/15 text-emerald-300 flex items-center justify-center mb-3">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
            <h3 class="font-bold text-lg">Lead converted</h3>
            <p class="mt-1 text-sm text-base-content/70">
              {{ r.createdCustomer ? 'Account created for ' : 'Linked to existing account ' }}<span class="font-medium">{{ email() }}</span>{{ r.createdCustomer ? ' (no email sent yet).' : '.' }}
            </p>
            @if (r.needsWiring) {
              <p class="mt-3 text-sm rounded-lg bg-amber-400/10 ring-1 ring-amber-300/30 text-amber-200 p-3">
                Site created. Open the editor to finish the wiring before it can flash.
              </p>
            } @else {
              <p class="mt-3 text-sm text-emerald-300">Site created and wired, ready to flash.</p>
            }
          </div>
          <div class="modal-action">
            <button class="btn btn-ghost" (click)="close.emit()">Done</button>
            <a class="btn border-0 bg-cyan-400 text-slate-950 hover:bg-cyan-300" [routerLink]="['/site', r.siteId]" (click)="close.emit()">Open site</a>
          </div>
        } @else {
          <h3 class="font-bold text-lg mb-1">Convert lead</h3>
          <p class="text-sm text-base-content/60 mb-4">Create a customer account and a site from {{ lead().name || 'this enquiry' }}, carrying the design across.</p>

          <div class="space-y-4">
            <div>
              <label class="label-text font-medium">Site name</label>
              <input type="text" class="input input-bordered w-full mt-1" placeholder="e.g. Riverside Farm"
                [value]="siteName()" (input)="siteName.set($any($event.target).value)" />
            </div>
            <div>
              <label class="label-text font-medium">Customer email</label>
              <input type="email" class="input input-bordered w-full mt-1" placeholder="name@example.com"
                [value]="email()" (input)="email.set($any($event.target).value)" />
              <p class="text-xs text-base-content/50 mt-1">The account is created for this email. No invite is sent now: send it later from Customers.</p>
            </div>
            <div>
              <label class="label-text font-medium">Customer phone</label>
              <input type="tel" class="input input-bordered w-full mt-1" placeholder="+254712345678"
                [value]="phone()" (input)="phone.set($any($event.target).value)" />
            </div>
            <p class="text-xs text-base-content/60 rounded-lg bg-base-200/60 px-3 py-2">{{ designNote() }}</p>
          </div>

          @if (error()) {
            <div class="alert alert-warning text-sm mt-4">{{ error() }}</div>
          }
          <div class="modal-action">
            <button class="btn btn-ghost" (click)="close.emit()">Cancel</button>
            <button class="btn border-0 bg-cyan-400 text-slate-950 hover:bg-cyan-300" [disabled]="!canConvert() || working()" (click)="run()">
              @if (working()) { <span class="loading loading-spinner loading-xs"></span> }
              Convert
            </button>
          </div>
        }
      </div>
      <div class="modal-backdrop" (click)="close.emit()"></div>
    </dialog>
  `,
})
export class ConvertLeadDialogComponent implements OnInit {
  readonly lead = input.required<LeadEntry>();
  readonly close = output<void>();

  private conversion = inject(LeadConversionService);

  protected readonly siteName = signal('');
  protected readonly email = signal('');
  protected readonly phone = signal('');
  protected readonly working = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly result = signal<LeadConversionResult | null>(null);

  /** What happens to the design, by what the lead carries. Convert is only
   *  offered for leads with a design, so one of these two always applies. */
  protected readonly designNote = computed(() =>
    this.lead().estimate?.profile
      ? 'We rebuild the wiring from their answers, so the site is ready to flash.'
      : 'Their preview design transfers; finish the wiring in the editor.',
  );

  protected readonly canConvert = computed(() => this.siteName().trim() !== '' && this.email().trim() !== '');

  ngOnInit(): void {
    const l = this.lead();
    this.siteName.set(l.name?.trim() || '');
    this.email.set(l.email?.trim() || '');
    this.phone.set(l.phone?.trim() || '');
  }

  protected async run(): Promise<void> {
    if (!this.canConvert() || this.working()) return;
    this.working.set(true);
    this.error.set(null);
    try {
      const r = await this.conversion.convert(this.lead(), { siteName: this.siteName(), email: this.email(), phone: this.phone() });
      this.result.set(r);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Could not convert this lead. Please try again.');
    } finally {
      this.working.set(false);
    }
  }
}
