import { Component, computed, inject, input, signal } from '@angular/core';
import type { ControllerControls, TunableNumber, CommandPhase } from '@core';
import { DashboardStore } from '../dashboard.store';
import { CommandLifecycleStore } from '../command-lifecycle.store';

/** A controller's tuning numbers, grouped for display. */
interface TuningGroup {
  controller: string;
  name: string;
  online: boolean;
  sections: { label: string; items: TunableNumber[] }[];
}

/**
 * TunableNumbersComponent — the "Tuning" editor: every `tier: 'tuning'` device
 * number (controller safety timings, per-route max-runtime + level setpoints),
 * grouped by controller → (controller-wide, then per route). Each field reads its
 * live value from the shadow and writes the desired value into the server-owned
 * `controller_config` (via the command-lifecycle store's single config write path —
 * config_set is gone). The server recomputes + republishes the retained /config
 * message and the device applies it; convergence shows when the shadow re-publishes
 * the applied number (the field falls back to the live value once the edit clears).
 * Bounded-safe values — gated by control, not the operator-mode unlock (calibration
 * lives in its own editor).
 */
@Component({
  selector: 'app-tunable-numbers',
  standalone: true,
  template: `
    @if (groups().length) {
      <div class="flex flex-col gap-4">
        @for (g of groups(); track g.controller) {
          <div class="flex flex-col gap-3">
            @if (groups().length > 1) {
              <div class="flex items-center gap-2">
                <span class="w-1.5 h-1.5 rounded-full shrink-0" [class]="g.online ? 'bg-success' : 'bg-base-content/30'"></span>
                <span class="text-xs font-semibold text-base-content/60">{{ g.name }}</span>
              </div>
            }
            @if (!g.online) {
              <p class="text-[11px] text-warning">Controller offline — values are the last reported; editing resumes when it reconnects.</p>
            }
            @for (sec of g.sections; track sec.label) {
              <div class="flex flex-col gap-1.5">
                @if (sec.label) {
                  <div class="text-[11px] font-semibold uppercase tracking-wide text-base-content/40">{{ sec.label }}</div>
                }
                <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-2.5">
                  @for (t of sec.items; track t.key) {
                    <label class="flex flex-col gap-1">
                      <span class="text-[11px] text-base-content/60 flex items-center gap-1 min-w-0">
                        <span class="truncate">{{ itemLabel(t) }}</span>
                        @if (showUnit(t)) { <span class="text-base-content/30 shrink-0">({{ t.unit }})</span> }
                        @if (t.hint) {
                          <span class="shrink-0 cursor-help text-base-content/30 hover:text-base-content/60" [title]="t.hint">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-3.5 h-3.5 block">
                              <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd"/>
                            </svg>
                          </span>
                        }
                        @if (fieldPhase(g.controller, t); as ph) {
                          @switch (ph.phase) {
                            @case ('pending') { <span class="loading loading-spinner loading-xs text-warning shrink-0"></span> }
                            @case ('confirmed') { <span class="text-success shrink-0">✓</span> }
                            @default { <span class="text-error truncate">{{ ph.reason || 'not applied' }}</span> }
                          }
                        }
                      </span>
                      @if (t.display === 'toggle') {
                        <div class="flex h-8 items-center gap-2">
                          <input type="checkbox" class="toggle toggle-sm toggle-primary"
                            [checked]="isOn(g.controller, t)"
                            [disabled]="!canEdit() || !g.online"
                            (change)="onToggle(g.controller, t, $event)" />
                          <span class="text-xs text-base-content/50">{{ isOn(g.controller, t) ? 'On' : 'Off' }}</span>
                        </div>
                      } @else {
                        <input type="number" [min]="t.min" [max]="t.max" [step]="t.step"
                          class="input input-sm input-bordered"
                          [value]="display(g.controller, t)"
                          [disabled]="!canEdit() || !g.online"
                          [placeholder]="t.default"
                          (input)="onInput(g.controller, t, $event)" />
                      }
                    </label>
                  }
                </div>
              </div>
            }
          </div>
        }
        @if (canEdit()) {
          <div class="flex items-center gap-2">
            <button class="btn btn-sm btn-primary w-24" [disabled]="!hasSendableEdit()" (click)="save()">
              @if (anyPending()) { <span class="loading loading-spinner loading-xs"></span> } @else { Save }
            </button>
            <span class="text-[11px] text-base-content/40">Each field confirms when the device re-publishes its value.</span>
          </div>
        }
      </div>
    }
  `,
})
export class TunableNumbersComponent {
  readonly controllers = input.required<ControllerControls[]>();
  readonly canEdit = input(true);
  /** Restrict to one scope ('controller' → safety timings; 'route' → per-route
   *  timers); null shows both. */
  readonly scope = input<'controller' | 'route' | null>(null);

  private store = inject(DashboardStore);
  private lifecycle = inject(CommandLifecycleStore);

  /** In-progress edits, keyed `${controller}/${key}`. */
  private edited = signal<Map<string, number>>(new Map());
  /** True while a desired-config write is in flight (Save button spinner). */
  private savingCfg = signal(false);

  protected groups = computed<TuningGroup[]>(() => {
    const sc = this.scope();
    return this.controllers()
      .map((c) => {
        const tuning = c.tunables.filter((t) => t.tier === 'tuning' && (sc === null || t.scope === sc));
        if (tuning.length === 0) return null;
        const controllerScope = tuning.filter((t) => t.scope === 'controller');
        const sections: TuningGroup['sections'] = [];
        if (controllerScope.length) sections.push({ label: '', items: controllerScope });
        // Per-route, in route order.
        const byRoute = new Map<number, TunableNumber[]>();
        for (const t of tuning) {
          if (t.scope !== 'route' || t.routeIndex == null) continue;
          const arr = byRoute.get(t.routeIndex);
          if (arr) arr.push(t); else byRoute.set(t.routeIndex, [t]);
        }
        [...byRoute.keys()].sort((a, b) => a - b).forEach((ri) => {
          const items = byRoute.get(ri)!;
          sections.push({ label: items[0].routeName ?? `Route ${ri}`, items });
        });
        return { controller: c.controller, name: c.name, online: this.store.presence(c.controller).online, sections };
      })
      .filter((g): g is TuningGroup => g !== null);
  });

  /** Some labels already carry their unit (HA entity names like "Flow Watchdog
   *  (s)"); only append the unit chip when the label doesn't already show it, so
   *  we never render "Flow Watchdog (s) (s)". */
  protected showUnit(t: TunableNumber): boolean {
    return !!t.unit && !t.label.includes(`(${t.unit})`);
  }

  /** Field label trimmed for display. Route-scoped tunables carry the full
   *  "Route: <route> <field>" name, but the section header already shows the
   *  route, so we strip that prefix down to just "<field>" (e.g. "Max Runtime
   *  (min)"). Controller-scoped labels pass through unchanged. */
  protected itemLabel(t: TunableNumber): string {
    if (t.scope !== 'route') return t.label;
    let s = t.label.replace(/^Route:\s*/, '');
    if (t.routeName && s.startsWith(t.routeName)) s = s.slice(t.routeName.length).trimStart();
    return s;
  }

  private key(controller: string, t: TunableNumber): string {
    return `${controller}/cfg/${t.key}`;
  }
  protected fieldPhase(controller: string, t: TunableNumber): { phase: CommandPhase; reason: string } | null {
    return this.lifecycle.phaseFor(this.key(controller, t));
  }
  protected anyPending(): boolean {
    return this.savingCfg();
  }

  /** Live value from the shadow (rounded to the field's step granularity). */
  private current(controller: string, t: TunableNumber): number | null {
    const r = this.store.row(controller, t.key);
    if (!r || !Number.isFinite(r.reported)) return null;
    return t.step < 1 ? Math.round(r.reported * 10) / 10 : Math.round(r.reported);
  }
  protected display(controller: string, t: TunableNumber): number | string {
    return this.edited().get(`${controller}/${t.key}`) ?? this.current(controller, t) ?? '';
  }

  /** Boolean view of a 0/1 toggle tunable — pending edit wins, else the live
   *  value, else the topology-baked default. */
  protected isOn(controller: string, t: TunableNumber): boolean {
    const v = this.edited().get(`${controller}/${t.key}`) ?? this.current(controller, t) ?? t.default;
    return v >= 0.5;
  }

  protected onToggle(controller: string, t: TunableNumber, ev: Event): void {
    const on = (ev.target as HTMLInputElement).checked;
    this.edited.update((m) => {
      const n = new Map(m);
      n.set(`${controller}/${t.key}`, on ? 1 : 0);
      return n;
    });
  }

  protected onInput(controller: string, t: TunableNumber, ev: Event): void {
    const v = (ev.target as HTMLInputElement).value;
    const ek = `${controller}/${t.key}`;
    this.edited.update((m) => {
      const n = new Map(m);
      if (v === '') n.delete(ek);
      else n.set(ek, Number(v));
      return n;
    });
  }

  /** A dirty edit targets an online controller. The desired config persists
   *  server-side regardless, but we gate Save on presence so the operator sees the
   *  device apply it (an offline controller converges on its next reconnect). */
  protected hasSendableEdit = computed(() => {
    const ed = this.edited();
    if (ed.size === 0) return false;
    return this.controllers().some((c) =>
      this.store.presence(c.controller).online && c.tunables.some((t) => ed.has(`${c.controller}/${t.key}`)),
    );
  });

  /** Write every dirty edit as desired config: one upsert per online controller into
   *  `controller_config` (the server recomputes + republishes the retained /config).
   *  The edit clears once written; the shadow re-publishes the applied value so the
   *  field converges on the device's reading. */
  protected async save(): Promise<void> {
    if (!this.canEdit() || this.edited().size === 0) return;
    this.savingCfg.set(true);
    try {
      const writes: Promise<void>[] = [];
      const sent: string[] = [];
      for (const c of this.controllers()) {
        if (!this.store.presence(c.controller).online) continue;
        const patch: Record<string, number> = {};
        for (const t of c.tunables) {
          const ek = `${c.controller}/${t.key}`;
          const v = this.edited().get(ek);
          if (v === undefined || Number.isNaN(v)) continue;
          patch[t.key] = Math.max(t.min, Math.min(t.max, v));
          sent.push(ek);
        }
        if (Object.keys(patch).length) writes.push(this.lifecycle.writeDesiredConfig(c.controller, patch));
      }
      await Promise.all(writes);
      if (sent.length) {
        this.edited.update((m) => { const n = new Map(m); for (const k of sent) n.delete(k); return n; });
      }
    } finally {
      this.savingCfg.set(false);
    }
  }
}
