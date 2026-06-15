import { Component, effect, inject, input, signal } from '@angular/core';
import { BackendService } from '../../../core/services/backend.service';

/**
 * SiteThresholdsComponent — the per-site "Alert thresholds" editor. Writes the
 * tank low/high percentages and the offline timeout straight onto the `sites`
 * record (owner/admin gated by the existing site RBAC). These feed both the
 * in-app alerts center and the server email sweep. Empty high = no full-tank
 * alert; empty/zero values fall back to the readers' defaults (low 20%, 180s).
 */
@Component({
  selector: 'app-site-thresholds',
  standalone: true,
  template: `
    <details class="mb-4 bg-base-100/60 rounded-xl ring-1 ring-base-300/40 px-4 py-3">
      <summary class="cursor-pointer list-none flex items-center gap-2 text-xs font-semibold text-base-content/60">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 shrink-0 text-base-content/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
          <path stroke-linecap="round" stroke-linejoin="round" d="M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 00-4-5.7V5a2 2 0 10-4 0v.3A6 6 0 006 11v3.2a2 2 0 01-.6 1.4L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        Alert thresholds
      </summary>

      <div class="mt-3 pt-3 border-t border-base-300/30 flex flex-col gap-3">
        <p class="text-[11px] text-base-content/50">
          When a tank crosses these, or a controller goes silent past the timeout, you get an alert in the bell (and by email if you opt in on your account page).
        </p>

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label class="flex flex-col gap-1">
            <span class="text-[11px] text-base-content/60">Tank low (%)</span>
            <input type="number" min="0" max="100" class="input input-sm input-bordered"
              [value]="low() ?? ''" [disabled]="!canEdit() || saving()"
              (input)="low.set(num($event))" placeholder="20" />
          </label>
          <label class="flex flex-col gap-1">
            <span class="text-[11px] text-base-content/60">Tank full (%) <span class="text-base-content/30">optional</span></span>
            <input type="number" min="0" max="100" class="input input-sm input-bordered"
              [value]="high() ?? ''" [disabled]="!canEdit() || saving()"
              (input)="high.set(num($event))" placeholder="—" />
          </label>
          <label class="flex flex-col gap-1">
            <span class="text-[11px] text-base-content/60">Offline after (s)</span>
            <input type="number" min="0" class="input input-sm input-bordered"
              [value]="offlineS() ?? ''" [disabled]="!canEdit() || saving()"
              (input)="offlineS.set(num($event))" placeholder="180" />
          </label>
        </div>

        @if (canEdit()) {
          <div class="flex items-center gap-2">
            <button class="btn btn-sm btn-primary w-24" [disabled]="saving()" (click)="save()">
              @if (saving()) { <span class="loading loading-spinner loading-xs"></span> } @else { Save }
            </button>
            @if (saved()) { <span class="text-xs text-success">Saved</span> }
            @if (err()) { <span class="text-xs text-error">{{ err() }}</span> }
          </div>
        } @else {
          <p class="text-[11px] text-base-content/40">Read-only — take control to edit.</p>
        }
      </div>
    </details>
  `,
})
export class SiteThresholdsComponent {
  readonly siteId = input.required<string>();
  readonly canEdit = input(true);

  private backend = inject(BackendService);

  protected low = signal<number | null>(null);
  protected high = signal<number | null>(null);
  protected offlineS = signal<number | null>(null);
  protected saving = signal(false);
  protected saved = signal(false);
  protected err = signal<string | null>(null);

  constructor() {
    // Load the site's current thresholds once its id is available.
    effect(() => {
      const id = this.siteId();
      if (id) void this.load(id);
    });
  }

  private async load(id: string): Promise<void> {
    try {
      const r = await this.backend.pb.collection('sites').getOne(id, { requestKey: `thresholds:${id}` });
      this.low.set(numOrNull(r['tank_low_pct']));
      this.high.set(numOrNull(r['tank_high_pct']));
      this.offlineS.set(numOrNull(r['offline_timeout_s']));
    } catch {
      // leave fields empty; placeholders show the effective defaults
    }
  }

  protected num(e: Event): number | null {
    const v = (e.target as HTMLInputElement).value;
    return v === '' ? null : Number(v);
  }

  protected async save(): Promise<void> {
    this.saving.set(true);
    this.saved.set(false);
    this.err.set(null);
    try {
      await this.backend.pb.collection('sites').update(this.siteId(), {
        tank_low_pct: this.low() ?? 0,
        tank_high_pct: this.high() ?? 0,
        offline_timeout_s: this.offlineS() ?? 0,
      });
      this.saved.set(true);
      setTimeout(() => this.saved.set(false), 2500);
    } catch (e) {
      this.err.set(String(e));
    } finally {
      this.saving.set(false);
    }
  }
}

function numOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}
