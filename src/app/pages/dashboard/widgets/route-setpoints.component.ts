import { Component, computed, inject, input, signal } from '@angular/core';
import type { ControllerControls, SetpointControl, CommandPhase } from '@core';
import { DashboardStore } from '../dashboard.store';
import { CommandLifecycleStore } from '../command-lifecycle.store';

/**
 * RouteSetpointsComponent — live editor for per-route control setpoints (a
 * route's source-min / dest-max tank %). Reads the current effective value from
 * the shadow (the device publishes each setpoint's `number:` state) and writes
 * back with a `config_set` command routed through the command-lifecycle store, so
 * each field shows the same pending → confirmed feedback as every other control
 * (confirmation = the device re-publishes the new value).
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
                    <span class="text-[11px] text-base-content/60 truncate flex items-center gap-1">
                      {{ sp.routeName }} · {{ sp.label }} <span class="text-base-content/30">({{ sp.unit }})</span>
                      @if (fieldPhase(g.controller, sp); as ph) {
                        @switch (ph.phase) {
                          @case ('pending') { <span class="loading loading-spinner loading-xs text-warning shrink-0"></span> }
                          @case ('confirmed') { <span class="text-success shrink-0">✓</span> }
                          @default { <span class="text-error truncate">{{ ph.reason || 'not applied' }}</span> }
                        }
                      }
                    </span>
                    <input type="number" [min]="sp.min" [max]="sp.max" step="1"
                      class="input input-sm input-bordered"
                      [value]="display(g.controller, sp)"
                      [disabled]="!canEdit() || !online(g.controller)"
                      [placeholder]="sp.default"
                      (input)="onInput(g.controller, sp, $event)" />
                  </label>
                }
              </div>
            </div>
          }

          @if (canEdit()) {
            <div class="flex items-center gap-2">
              <button class="btn btn-sm btn-primary w-24" [disabled]="!hasSendableEdit()" (click)="save()">
                @if (anyPending()) { <span class="loading loading-spinner loading-xs"></span> } @else { Save }
              </button>
              <span class="text-[11px] text-base-content/40">Each field confirms when the device re-publishes its value.</span>
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
  readonly controllers = input.required<ControllerControls[]>();
  readonly canEdit = input(true);

  private store = inject(DashboardStore);
  private lifecycle = inject(CommandLifecycleStore);

  /** Only controllers that actually expose setpoints. */
  protected groups = computed(() => this.controllers().filter((c) => c.setpoints.length > 0));

  /** In-progress edits, keyed `${controller}/${key}`. */
  private edited = signal<Map<string, number>>(new Map());

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

  // --- Per-field command phase (the shared lifecycle, keyed per setpoint) -------
  private key(controller: string, sp: SetpointControl): string {
    return `${controller}/cfg/${sp.key}`;
  }
  protected fieldPhase(controller: string, sp: SetpointControl): { phase: CommandPhase; reason: string } | null {
    return this.lifecycle.phaseFor(this.key(controller, sp));
  }
  protected fieldBusy(controller: string, sp: SetpointControl): boolean {
    return this.lifecycle.isBusy(this.key(controller, sp));
  }
  protected anyPending(): boolean {
    for (const g of this.groups()) {
      for (const sp of g.setpoints) if (this.fieldBusy(g.controller, sp)) return true;
    }
    return false;
  }

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

  /** Push each dirty setpoint on an ONLINE controller as its own `config_set`;
   *  the per-field phase then drives the feedback (pending → ✓ when the device
   *  re-publishes the value). Offline edits stay in the buffer until reconnect. */
  protected save(): void {
    if (!this.canEdit() || this.edited().size === 0) return;
    const sent: string[] = [];
    for (const g of this.groups()) {
      if (!this.online(g.controller)) continue;
      for (const sp of g.setpoints) {
        const ek = `${g.controller}/${sp.key}`;
        const v = this.edited().get(ek);
        if (v === undefined || Number.isNaN(v)) continue;
        const clamped = Math.max(sp.min, Math.min(sp.max, v));
        void this.lifecycle.dispatch(this.key(g.controller, sp), g.controller, 'config_set', { setpoint: sp, value: clamped });
        sent.push(ek);
      }
    }
    if (sent.length) {
      this.edited.update((m) => {
        const n = new Map(m);
        for (const k of sent) n.delete(k);
        return n;
      });
    }
  }
}
