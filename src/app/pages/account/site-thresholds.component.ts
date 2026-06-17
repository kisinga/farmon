import { Component, effect, inject, input, signal } from '@angular/core';
import { BackendService } from '../../core/services/backend.service';

/**
 * SiteThresholdsComponent — the per-site "Alert thresholds" editor. Writes the
 * tank low/high percentages and the offline timeout straight onto the `sites`
 * record (owner/admin gated by the existing site RBAC). These feed both the
 * in-app alerts center and the server email sweep. Empty high = no full-tank
 * alert; empty/zero values fall back to the readers' defaults (low 20%, 180s).
 *
 * Lives on the account/notifications page: each alert type that has a threshold
 * reveals only its own fields ({@link showTank} for tank-level, {@link showOffline}
 * for controller-offline), so the editor mirrors which alerts the user enabled.
 * Save only writes the visible fields, leaving a hidden type's stored value intact.
 */
@Component({
  selector: 'app-site-thresholds',
  standalone: true,
  template: `
      <div class="flex flex-col gap-3">
        <div class="flex flex-wrap gap-3">
          @if (showTank()) {
            <label class="flex flex-col gap-1 flex-1 min-w-28">
              <span class="text-[11px] text-base-content/60">Tank low (%)</span>
              <input type="number" min="0" max="100" class="input input-sm input-bordered"
                [value]="low() ?? ''" [disabled]="!canEdit() || saving()"
                (input)="low.set(num($event))" placeholder="20" />
            </label>
            <label class="flex flex-col gap-1 flex-1 min-w-28">
              <span class="text-[11px] text-base-content/60">Tank full (%) <span class="text-base-content/30">optional</span></span>
              <input type="number" min="0" max="100" class="input input-sm input-bordered"
                [value]="high() ?? ''" [disabled]="!canEdit() || saving()"
                (input)="high.set(num($event))" placeholder="—" />
            </label>
          }
          @if (showOffline()) {
            <label class="flex flex-col gap-1 flex-1 min-w-28">
              <span class="text-[11px] text-base-content/60">Offline after (min)</span>
              <input type="number" min="0" step="0.5" class="input input-sm input-bordered"
                [value]="offlineMin() ?? ''" [disabled]="!canEdit() || saving()"
                (input)="offlineMin.set(num($event))" placeholder="3" />
            </label>
          }
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
  `,
})
export class SiteThresholdsComponent {
  readonly siteId = input.required<string>();
  readonly canEdit = input(true);
  /** Show the tank low/full fields — gated by the user's tank-level alert pref. */
  readonly showTank = input(true);
  /** Show the offline-timeout field — gated by the controller-offline alert pref. */
  readonly showOffline = input(true);

  private backend = inject(BackendService);

  protected low = signal<number | null>(null);
  protected high = signal<number | null>(null);
  /** Stored as `offline_timeout_s` (seconds), but edited in minutes — operators
   *  think in minutes, so the field shows/takes minutes and we convert on the edge. */
  protected offlineMin = signal<number | null>(null);
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
      const sec = numOrNull(r['offline_timeout_s']);
      this.offlineMin.set(sec == null ? null : Math.round((sec / 60) * 10) / 10);
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
    // Only write the fields this editor is showing — a disabled alert type's
    // stored threshold is left untouched, not zeroed.
    const body: Record<string, number> = {};
    if (this.showTank()) {
      body['tank_low_pct'] = this.low() ?? 0;
      body['tank_high_pct'] = this.high() ?? 0;
    }
    if (this.showOffline()) {
      body['offline_timeout_s'] = this.offlineMin() != null ? Math.round(this.offlineMin()! * 60) : 0;
    }
    try {
      await this.backend.pb.collection('sites').update(this.siteId(), body);
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
