import { Component, computed, inject, input, signal } from '@angular/core';
import type { ControllerControls, SetpointControl } from '@core';
import { BackendService } from '../../../core/services/backend.service';
import { DashboardStore } from '../dashboard.store';

/**
 * RouteSetpointsComponent — live editor for per-route control setpoints (a
 * route's source-min / dest-max tank %). Reads the current effective value from
 * the shadow (the device publishes each setpoint's `number:` state) and writes
 * back with a `config_set` command; the device persists it (restore_value) and
 * re-publishes. Sits beside the alert thresholds: same per-site config surface,
 * but these are device control values, not server-side alert config.
 *
 * Distinct from SiteThresholdsComponent on purpose: alert thresholds drive the
 * email sweep + bell (server-stored, matter while everything is off); these
 * drive the running device (only meaningful while it's online — so editing is
 * gated on presence).
 */
@Component({
  selector: 'app-route-setpoints',
  standalone: true,
  template: `
    @if (groups().length) {
      <details class="mb-4 bg-base-100/60 rounded-2xl ring-1 ring-base-300/30 px-4 py-3">
        <summary class="cursor-pointer list-none flex items-center gap-2 text-xs font-semibold text-base-content/60">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 shrink-0 text-base-content/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
            <path stroke-linecap="round" stroke-linejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" />
          </svg>
          Route setpoints
        </summary>

        <div class="mt-3 pt-3 border-t border-base-300/30 flex flex-col gap-4">
          <p class="text-[11px] text-base-content/50">
            Tune when a route starts and stops by tank level, live, without a rebuild. Source min: the route won't run while its source tank is below this. Dest max: it stops once the destination tank reaches this. The device applies and remembers each change.
          </p>

          @for (g of groups(); track g.controller) {
            <div class="flex flex-col gap-2">
              @if (groups().length > 1) {
                <div class="text-[11px] font-semibold uppercase tracking-wide text-base-content/40">{{ g.name }}</div>
              }
              @if (!online(g.controller)) {
                <p class="text-[11px] text-warning">Controller offline — values shown are the last reported; editing resumes when it reconnects.</p>
              }
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                @for (sp of g.setpoints; track sp.key) {
                  <label class="flex flex-col gap-1">
                    <span class="text-[11px] text-base-content/60 truncate">
                      {{ sp.routeName }} · {{ sp.label }} <span class="text-base-content/30">({{ sp.unit }})</span>
                    </span>
                    <input type="number" [min]="sp.min" [max]="sp.max" step="1"
                      class="input input-sm input-bordered"
                      [value]="display(g.controller, sp)"
                      [disabled]="!canEdit() || !online(g.controller) || saving()"
                      [placeholder]="sp.default"
                      (input)="onInput(g.controller, sp, $event)" />
                  </label>
                }
              </div>
            </div>
          }

          @if (canEdit()) {
            <div class="flex items-center gap-2">
              <button class="btn btn-sm btn-primary w-24" [disabled]="saving() || !hasSendableEdit()" (click)="save()">
                @if (saving()) { <span class="loading loading-spinner loading-xs"></span> } @else { Save }
              </button>
              @if (saved()) { <span class="text-xs text-success">Sent</span> }
              @if (err()) { <span class="text-xs text-error">{{ err() }}</span> }
            </div>
          } @else {
            <p class="text-[11px] text-base-content/40">Read-only — take control to edit.</p>
          }
        </div>
      </details>
    }
  `,
})
export class RouteSetpointsComponent {
  readonly siteId = input.required<string>();
  readonly controllers = input.required<ControllerControls[]>();
  readonly canEdit = input(true);

  private backend = inject(BackendService);
  private store = inject(DashboardStore);

  /** Only controllers that actually expose setpoints. */
  protected groups = computed(() => this.controllers().filter((c) => c.setpoints.length > 0));

  /** In-progress edits, keyed `${controller}/${key}`. */
  private edited = signal<Map<string, number>>(new Map());
  protected saving = signal(false);
  protected saved = signal(false);
  protected err = signal<string | null>(null);

  protected online(controller: string): boolean {
    return this.store.presence(controller).online;
  }

  /** True when at least one dirty edit targets an ONLINE controller — the only
   *  case where Save can actually reach a device (a config_set to an offline
   *  controller isn't retained and is TTL-dropped on reconnect, so it would
   *  silently no-op). Reactive to both edits and presence. */
  protected hasSendableEdit = computed(() => {
    const ed = this.edited();
    if (ed.size === 0) return false;
    for (const g of this.groups()) {
      if (!this.online(g.controller)) continue;
      for (const sp of g.setpoints) if (ed.has(`${g.controller}/${sp.key}`)) return true;
    }
    return false;
  });

  /** Current effective value from the shadow (rounded), or null when unknown. */
  private current(controller: string, sp: SetpointControl): number | null {
    const r = this.store.row(controller, sp.key);
    return r && Number.isFinite(r.reported) ? Math.round(r.reported) : null;
  }

  /** Input value: the in-progress edit if any, else the live shadow value. */
  protected display(controller: string, sp: SetpointControl): number | string {
    const e = this.edited().get(`${controller}/${sp.key}`);
    return e ?? this.current(controller, sp) ?? '';
  }

  protected onInput(controller: string, sp: SetpointControl, ev: Event): void {
    const v = (ev.target as HTMLInputElement).value;
    const ek = `${controller}/${sp.key}`;
    this.edited.update((m) => {
      const n = new Map(m);
      if (v === '') n.delete(ek);
      else n.set(ek, Number(v));
      return n;
    });
  }

  protected async save(): Promise<void> {
    if (this.edited().size === 0) return;
    this.saving.set(true);
    this.saved.set(false);
    this.err.set(null);

    // Send each dirty edit on an ONLINE controller; offline ones stay pending.
    // Track which keys actually went out so a partial failure only retries the
    // ones that didn't send, and the rest clear.
    const sent: string[] = [];
    const sends: Promise<unknown>[] = [];
    for (const g of this.groups()) {
      if (!this.online(g.controller)) continue;
      for (const sp of g.setpoints) {
        const ek = `${g.controller}/${sp.key}`;
        const v = this.edited().get(ek);
        if (v === undefined || Number.isNaN(v)) continue;
        const clamped = Math.max(sp.min, Math.min(sp.max, v));
        sends.push(
          this.backend
            .sendCommand(this.siteId(), g.controller, 'config_set', { key: sp.key, value: clamped })
            .then(() => { sent.push(ek); }),
        );
      }
    }

    try {
      await Promise.allSettled(sends);
      if (sent.length) {
        this.edited.update((m) => {
          const n = new Map(m);
          for (const k of sent) n.delete(k);
          return n;
        });
        this.saved.set(true);
        setTimeout(() => this.saved.set(false), 2500);
      }
      const failed = sends.length - sent.length;
      if (failed > 0) this.err.set(`${failed} change${failed > 1 ? 's' : ''} didn't send — try again`);
    } finally {
      this.saving.set(false);
    }
  }
}
