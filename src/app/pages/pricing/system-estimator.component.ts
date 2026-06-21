import { Component, computed, effect, inject, output, signal } from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import {
  estimateSystem, renderTopologySvg, multiSourceNeedsTank, VERTICALS, SOURCES, CONVEYANCES,
  type Vertical, type SourceKind, type Conveyance, type SystemEstimate, type SiteTopology,
} from '@core';
import type { Segment } from './pricing.model';

/** The component counts a sized site maps to, plus the design itself for the quote. */
export interface SizedEstimate {
  segment: Segment;
  pumps: number;
  valves: number;
  flow: number;
  tanks: number;
  /** The composed design (no pins in estimation mode) — drives the quote document. */
  topology: SiteTopology | null;
}

/** Which pricing segment a site vertical belongs to. */
function verticalToSegment(v: Vertical): Segment {
  if (v === 'farm' || v === 'greenhouse') return 'farm';
  if (v === 'water_business') return 'water_supply';
  return 'property';
}

/**
 * Public, no-account hardware sizer for the pricing page.
 *
 * Visitors describe their site in plain terms; the same Easy Mode composer
 * (`estimateSystem`) that builds a real topology derives the bill of materials,
 * a collapsed preview of the system, and whether it fits one controller. The
 * derived component counts (and the design) are emitted so the page's existing
 * estimate can price it and the quote document can embed it — one site
 * description, no second sizing model. No backend, no auth.
 */
@Component({
  selector: 'app-system-estimator',
  standalone: true,
  template: `
    <div class="rounded-2xl bg-slate-50 ring-1 ring-slate-200 p-5 space-y-5">
      <div>
        <h3 class="font-semibold text-slate-900">Describe your site</h3>
        <p class="mt-1 text-sm text-slate-600 leading-relaxed">A few plain questions and we work out the hardware — no need to count pumps and valves yourself.</p>
      </div>

      <div>
        <div class="text-sm font-medium text-slate-700 mb-1.5">What kind of site is this?</div>
        <div class="flex flex-wrap gap-1.5">
          @for (o of VERTICALS; track o.value) {
            <button type="button" (click)="vertical.set(o.value)"
              class="rounded-full px-3 py-1.5 text-sm ring-1 transition-colors"
              [class]="vertical() === o.value ? 'bg-cyan-500 text-white ring-cyan-500' : 'bg-white text-slate-700 ring-slate-300 hover:ring-cyan-400'">{{ o.label }}</button>
          }
        </div>
        @if (verticalExample(); as ex) { <p class="mt-1 text-xs text-slate-500">e.g. {{ ex }}</p> }
      </div>

      <div>
        <div class="text-sm font-medium text-slate-700 mb-1.5">Where does your water come from? <span class="text-slate-400">(pick all)</span></div>
        <div class="flex flex-wrap gap-1.5">
          @for (o of SOURCES; track o.value) {
            <button type="button" (click)="toggleSource(o.value)"
              class="rounded-full px-3 py-1.5 text-sm ring-1 transition-colors"
              [class]="sources().has(o.value) ? 'bg-cyan-500 text-white ring-cyan-500' : 'bg-white text-slate-700 ring-slate-300 hover:ring-cyan-400'">{{ o.label }}</button>
          }
        </div>
        @if (needsTank()) { <p class="mt-1 text-xs text-slate-500">Several sources combine in one shared tank.</p> }
      </div>

      <div class="flex flex-wrap gap-x-8 gap-y-4">
        <div>
          <div class="text-sm font-medium text-slate-700 mb-1.5">Store water on site?</div>
          <div class="flex flex-wrap gap-1.5">
            <button type="button" (click)="tanks.set(0)" class="rounded-full px-3 py-1.5 text-sm ring-1 transition-colors" [class]="tanks() === 0 ? 'bg-cyan-500 text-white ring-cyan-500' : 'bg-white text-slate-700 ring-slate-300 hover:ring-cyan-400'">No</button>
            <button type="button" (click)="tanks.set(1)" class="rounded-full px-3 py-1.5 text-sm ring-1 transition-colors" [class]="tanks() === 1 ? 'bg-cyan-500 text-white ring-cyan-500' : 'bg-white text-slate-700 ring-slate-300 hover:ring-cyan-400'">One tank</button>
            <button type="button" (click)="tanks.set(2)" class="rounded-full px-3 py-1.5 text-sm ring-1 transition-colors" [class]="tanks() === 2 ? 'bg-cyan-500 text-white ring-cyan-500' : 'bg-white text-slate-700 ring-slate-300 hover:ring-cyan-400'">Several</button>
          </div>
        </div>
        <div>
          <div class="text-sm font-medium text-slate-700 mb-1.5">Areas controlled separately</div>
          <div class="flex items-center gap-2">
            <button type="button" (click)="bumpZones(-1)" [disabled]="zones() <= 1" class="w-9 h-9 rounded-full ring-1 ring-slate-300 text-slate-700 text-lg font-bold hover:bg-white disabled:opacity-40">−</button>
            <span class="w-8 text-center font-semibold tabular-nums">{{ zones() }}</span>
            <button type="button" (click)="bumpZones(1)" class="w-9 h-9 rounded-full ring-1 ring-slate-300 text-slate-700 text-lg font-bold hover:bg-white">+</button>
          </div>
        </div>
        @if (tanks() === 1) {
          <div>
            <div class="text-sm font-medium text-slate-700 mb-1.5">Needs a pump to reach the taps?</div>
            <div class="flex gap-1.5">
              @for (o of CONVEYANCES; track o.value) {
                <button type="button" (click)="conveyance.set(o.value)" class="rounded-full px-3 py-1.5 text-sm ring-1 transition-colors" [class]="conveyance() === o.value ? 'bg-cyan-500 text-white ring-cyan-500' : 'bg-white text-slate-700 ring-slate-300 hover:ring-cyan-400'">{{ o.short ?? o.label }}</button>
              }
            </div>
          </div>
        }
      </div>

      @if (system(); as s) {
        <div class="rounded-xl bg-white ring-1 ring-slate-200 p-4 space-y-3">
          @if (s.fits) {
            <div class="flex flex-wrap gap-2">
              @for (c of billOfMaterials(); track c.label) {
                <span class="rounded-full bg-slate-100 text-slate-700 text-xs px-2.5 py-1">{{ c.count }} {{ c.label }}</span>
              }
            </div>
            <div class="flex items-center gap-3 text-xs text-slate-500">
              <span class="font-mono">{{ s.budget.relays }}/{{ s.limits.relays }} relays</span>
              <span class="font-mono">{{ s.budget.analog }}/{{ s.limits.analog }} analog</span>
              <span class="font-mono">{{ s.budget.pulse }}/{{ s.limits.pulse }} pulse</span>
            </div>

            <!-- Collapsed preview of the actual generated design (dark, to match the plan card). -->
            @if (topologySvg(); as svg) {
              <details class="group">
                <summary class="cursor-pointer text-sm font-medium text-cyan-700 hover:text-cyan-600 select-none">View the system we'd build</summary>
                <div class="mt-2 rounded-lg overflow-hidden bg-slate-950 p-2 ring-1 ring-slate-800" [innerHTML]="svg"></div>
                <p class="mt-1 text-xs text-slate-500">A draft layout. The exact wiring is set when you create the site.</p>
              </details>
            }

            <p class="text-sm text-emerald-600 font-medium">Fits one controller — your estimate updates as you answer.</p>
          } @else {
            <p class="text-sm text-amber-600">{{ notFitNote() }}</p>
          }
        </div>
      } @else {
        <p class="text-sm text-slate-500">Pick a site type and at least one water source to size it.</p>
      }
    </div>
  `,
})
export class SystemEstimatorComponent {
  private sanitizer = inject(DomSanitizer);

  /** Emitted live as the description changes; carries the priced inputs + design. */
  readonly sized = output<SizedEstimate>();

  constructor() {
    // Feed the page's estimate live — no "apply" click. Re-runs whenever any
    // sizing answer changes; reads only this component's signals, so the parent's
    // handler writing its own signals can't loop back here.
    effect(() => {
      const s = this.system();
      const v = this.vertical();
      if (!s || !v) return; // incomplete profile: keep the last estimate + quote
      if (!s.fits) {
        // Un-buildable here (several tanks, multi-source + no storage): drop the
        // quote so it can't reuse a stale design; the parent keeps the price as-is.
        this.sized.emit({ segment: verticalToSegment(v), pumps: 0, valves: 0, flow: 0, tanks: 0, topology: null });
        return;
      }
      const count = (kind: string) => s.components.find(c => c.kind === kind)?.count ?? 0;
      // Map the composer's real pin usage onto the pricing inputs: flow sensors are
      // pulse-counted and monitored tanks are analog, so the budget gives the exact
      // counts the price keys off.
      this.sized.emit({
        segment: verticalToSegment(v),
        pumps: count('pump'),
        valves: count('valve'),
        flow: s.budget.pulse,
        tanks: s.budget.analog,
        topology: s.topology,
      });
    });
  }

  protected readonly VERTICALS = VERTICALS;
  protected readonly SOURCES = SOURCES;
  protected readonly CONVEYANCES = CONVEYANCES;

  protected readonly vertical = signal<Vertical | null>(null);
  protected readonly sources = signal<Set<SourceKind>>(new Set());
  /** 0 = none, 1 = one, 2 = several (the composer treats several as one reservoir). */
  protected readonly tanks = signal<0 | 1 | 2>(1);
  protected readonly zones = signal(1);
  protected readonly conveyance = signal<Conveyance>('pump');

  /** Two or more sources must merge at a shared tank, so "no storage" is invalid. */
  protected readonly needsTank = computed(() => multiSourceNeedsTank([...this.sources()]));

  /** The hardware sizing, recomputed from the composer as answers change. */
  protected readonly system = computed<SystemEstimate | null>(() => {
    const v = this.vertical();
    if (!v || this.sources().size === 0) return null;
    try {
      return estimateSystem({
        vertical: v,
        sources: [...this.sources()],
        tanks: this.tanks(),
        zones: this.zones(),
        conveyance: this.conveyance(),
      });
    } catch {
      return null;
    }
  });

  /** One-line example for the selected site type (from the catalog). */
  protected readonly verticalExample = computed(() => VERTICALS.find(o => o.value === this.vertical())?.example ?? null);

  /** BOM, minus the structural-only kinds. A tank with no level monitoring (zero
   *  analog) is labelled so the badge agrees with the priced "tanks to monitor". */
  protected readonly billOfMaterials = computed(() => {
    const s = this.system();
    if (!s) return [];
    const monitored = s.budget.analog;
    return s.components
      .filter(c => c.kind !== 'water_source' && c.kind !== 'endpoint')
      .map(c => (c.kind === 'tank' && monitored === 0 ? { ...c, label: 'Storage tank (no monitor)' } : c));
  });

  /** The composed design as an inline SVG, sanitized for [innerHTML]. */
  protected readonly topologySvg = computed<SafeHtml | null>(() => {
    const t = this.system()?.topology;
    if (!t) return null;
    return this.sanitizer.bypassSecurityTrustHtml(renderTopologySvg(t));
  });

  /** The handoff reason for a design that overflows one controller. */
  protected readonly notFitNote = computed(() =>
    this.system()?.notes.at(-1) ?? 'This needs more than one controller.',
  );

  protected toggleSource(s: SourceKind): void {
    const next = new Set(this.sources());
    next.has(s) ? next.delete(s) : next.add(s);
    this.sources.set(next);
  }

  protected bumpZones(d: number): void {
    this.zones.set(Math.max(1, this.zones() + d));
  }
}
