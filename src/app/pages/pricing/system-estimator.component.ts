import { Component, DestroyRef, afterNextRender, computed, effect, inject, output, signal } from '@angular/core';
import {
  estimateSystem, multiSourceNeedsTank,
  type Vertical, type SystemEstimate, type SiteTopology, type EasyModeProfile,
} from '@core';
import { TopologyPreviewComponent } from '../../shared/topology-preview.component';
import { SiteProfileModel } from '../../shared/site-profile.model';
import type { Segment } from './pricing.model';

/** The component counts a sized site maps to, plus the design itself for the quote. */
export interface SizedEstimate {
  segment: Segment;
  pumps: number;
  valves: number;
  flow: number;
  tanks: number;
  /** The composed design (no pins in estimation mode): drives the quote document. */
  topology: SiteTopology | null;
  /** The raw answers behind the design: stored on the lead so conversion can
   *  re-run the composer with a real board. Null when the site is not buildable. */
  profile: EasyModeProfile | null;
  /** Set when the described site exceeds Easy Mode and needs a custom design: a
   *  short, plain reason (no pin jargon) the page uses to switch into the
   *  design-request flow. Null when it fits. */
  handoff: { reason: string; message: string } | null;
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
 * Visitors describe their site in plain terms via the shared SiteProfileModel
 * (the same questionnaire the admin stepper uses); the same Easy Mode composer
 * (`estimateSystem`) derives the bill of materials, a collapsed preview, and
 * whether it fits one controller. The derived counts + design are emitted so the
 * page prices it and the quote embeds it: one site description, no second sizing
 * model. No backend, no auth.
 */
@Component({
  selector: 'app-system-estimator',
  standalone: true,
  imports: [TopologyPreviewComponent],
  template: `
    <div class="rounded-2xl bg-slate-50 ring-1 ring-slate-200 p-5 sm:p-6 space-y-6">
      <div>
        <h3 class="text-lg font-bold tracking-tight text-slate-900">Describe your site</h3>
        <p class="mt-1 text-sm text-slate-600 leading-relaxed">A few plain questions and we work out the hardware, no need to count pumps and valves yourself.</p>
      </div>

      <!-- Site type: pick one of many -> chips -->
      <div>
        <div class="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Site type</div>
        <div class="flex flex-wrap gap-2">
          @for (o of form.VERTICALS; track o.value) {
            <button type="button" (click)="form.vertical.set(o.value)"
              class="inline-flex items-center rounded-full px-3.5 h-9 text-sm font-medium ring-1 transition-colors" [class]="pill(form.vertical() === o.value)">{{ o.label }}</button>
          }
        </div>
        @if (form.verticalExample(); as ex) { <p class="mt-2 text-xs text-slate-500">e.g. {{ ex }}</p> }
      </div>

      <!-- Water source: pick all -> chips -->
      <div>
        <div class="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Water source <span class="font-normal normal-case tracking-normal text-slate-400">· pick all that apply</span></div>
        <div class="flex flex-wrap gap-2">
          @for (o of form.SOURCES; track o.value) {
            <button type="button" (click)="form.toggleSource(o.value)"
              class="inline-flex items-center rounded-full px-3.5 h-9 text-sm font-medium ring-1 transition-colors" [class]="pill(form.sources().has(o.value))">{{ o.label }}</button>
          }
        </div>
        @if (needsTank()) { <p class="mt-2 text-xs text-slate-500">Several sources combine in one shared tank.</p> }
      </div>

      <!-- Compact controls: storage / areas / booster -->
      <div class="space-y-5">
        <div>
          <div class="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Store water on site?</div>
          <div class="inline-flex rounded-xl bg-white ring-1 ring-slate-300 p-1">
            <button type="button" (click)="form.setStorage(0)" class="rounded-lg px-4 py-1.5 text-sm font-medium transition-colors" [class]="seg(form.tanks() === 0)">No</button>
            <button type="button" (click)="form.setStorage(1)" class="rounded-lg px-4 py-1.5 text-sm font-medium transition-colors" [class]="seg(form.tanks() === 1)">One tank</button>
            <button type="button" (click)="form.setSeveral()" class="rounded-lg px-4 py-1.5 text-sm font-medium transition-colors" [class]="seg(form.isSeveral())">Several</button>
          </div>
          @if (form.isSeveral()) {
            <div class="mt-3 rounded-xl bg-white ring-1 ring-slate-200 p-3.5 space-y-3">
              <div class="flex items-center justify-between gap-3">
                <span class="text-xs font-semibold uppercase tracking-wide text-slate-500">How many</span>
                <div class="inline-flex items-center rounded-lg ring-1 ring-slate-300">
                  <button type="button" (click)="form.bumpTanks(-1)" [disabled]="(form.tanks() ?? 2) <= 2" class="px-3 py-1.5 text-slate-600 hover:text-slate-900 disabled:opacity-30">−</button>
                  <span class="w-6 text-center text-sm font-semibold tabular-nums">{{ form.tanks() }}</span>
                  <button type="button" (click)="form.bumpTanks(1)" [disabled]="(form.tanks() ?? 2) >= form.MAX_TANKS" class="px-3 py-1.5 text-slate-600 hover:text-slate-900 disabled:opacity-30">+</button>
                </div>
              </div>
              <div>
                <span class="text-xs font-semibold uppercase tracking-wide text-slate-500">Arrangement</span>
                <div class="mt-2 flex flex-wrap gap-2">
                  @for (o of form.layouts(); track o.label) {
                    <button type="button" (click)="form.selectLayout(o.groups)" class="inline-flex items-center rounded-full px-3 h-8 text-sm font-medium ring-1 transition-colors" [class]="pill(form.isLayout(o.groups))">{{ o.short }}</button>
                  }
                  <button type="button" (click)="form.selectLayout(null)" class="inline-flex items-center rounded-full px-3 h-8 text-sm font-medium ring-1 transition-colors" [class]="pill(form.isCustom())">Something else</button>
                </div>
              </div>
            </div>
          }
        </div>

        <div class="grid gap-5 sm:grid-cols-2">
          <div>
            <div class="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Areas controlled separately</div>
            <div class="inline-flex items-center rounded-lg ring-1 ring-slate-300 bg-white">
              <button type="button" (click)="form.bumpZones(-1)" [disabled]="form.zones() <= 1" class="px-3.5 py-2 text-slate-600 hover:text-slate-900 disabled:opacity-30 text-lg leading-none">−</button>
              <span class="w-8 text-center font-semibold tabular-nums">{{ form.zones() }}</span>
              <button type="button" (click)="form.bumpZones(1)" class="px-3.5 py-2 text-slate-600 hover:text-slate-900 text-lg leading-none">+</button>
            </div>
          </div>
          @if (form.showConveyance()) {
            <div>
              <div class="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Needs a pump to reach the taps?</div>
              <div class="inline-flex rounded-xl bg-white ring-1 ring-slate-300 p-1">
                @for (o of form.CONVEYANCES; track o.value) {
                  <button type="button" (click)="form.conveyance.set(o.value)" class="rounded-lg px-4 py-1.5 text-sm font-medium transition-colors" [class]="seg(form.conveyance() === o.value)">{{ o.short ?? o.label }}</button>
                }
              </div>
            </div>
          }
        </div>
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

            <!-- Collapsed preview of the actual generated design. -->
            @if (s.topology; as t) {
              <details class="group" [open]="isDesktop()">
                <summary class="cursor-pointer text-sm font-medium text-cyan-700 hover:text-cyan-600 select-none">View the system we'd build</summary>
                <app-topology-preview class="mt-2 block" [topology]="t" />
                <p class="mt-1 text-xs text-slate-500">A draft layout. The exact wiring is set when you create the site.</p>
              </details>
            }

            <p class="text-sm text-emerald-600 font-medium">Fits one controller. Your estimate updates as you answer.</p>
          } @else {
            <p class="text-sm text-slate-600 leading-relaxed">This is a custom system. Your design options are in the plan<span class="lg:hidden"> just below</span>.</p>
          }
        </div>
      } @else {
        <p class="text-sm text-slate-500">Pick a site type and at least one water source to size it.</p>
      }
    </div>
  `,
})
export class SystemEstimatorComponent {
  /** Emitted live as the description changes; carries the priced inputs + design. */
  readonly sized = output<SizedEstimate>();

  /** The shared questionnaire state (same model the admin stepper uses). */
  protected readonly form = new SiteProfileModel();

  private destroyRef = inject(DestroyRef);

  /** True on desktop widths. The topology preview opens by default here and stays
   *  collapsed on mobile to keep the page short; either way it is user-toggleable.
   *  Starts false so SSR renders collapsed, then resolves in the browser. */
  protected readonly isDesktop = signal(false);

  constructor() {
    // Public defaults for the shared model: start with one tank pre-selected and a
    // booster assumed, so a result appears as soon as a site type + source is picked.
    this.form.tanks.set(1);
    this.form.conveyance.set('pump');

    // Browser-only: track the desktop breakpoint so the preview defaults open
    // on wide screens. afterNextRender keeps `window` off the server path.
    afterNextRender(() => {
      const mq = window.matchMedia('(min-width: 1024px)');
      this.isDesktop.set(mq.matches);
      const onChange = (e: MediaQueryListEvent) => this.isDesktop.set(e.matches);
      mq.addEventListener('change', onChange);
      this.destroyRef.onDestroy(() => mq.removeEventListener('change', onChange));
    });

    // Feed the page's estimate live, no "apply" click. Re-runs whenever any
    // sizing answer changes; reads only this component's signals, so the parent's
    // handler writing its own signals can't loop back here.
    effect(() => {
      const s = this.system();
      const p = this.form.profile();
      if (!s || !p) return; // incomplete profile: keep the last estimate + quote
      if (!s.fits) {
        // Needs our team (custom layout, too big for one controller): drop the
        // quote/design so it can't reuse a stale one, but keep the answers + a
        // plain reason so the page can switch into the design-request flow and
        // the lead still tells us what they described. Price holds as-is.
        this.sized.emit({ segment: verticalToSegment(p.vertical), pumps: 0, valves: 0, flow: 0, tanks: 0, topology: null, profile: p, handoff: this.handoffInfo() });
        return;
      }
      const count = (kind: string) => s.components.find(c => c.kind === kind)?.count ?? 0;
      // Map the composer's real pin usage onto the pricing inputs: flow sensors are
      // pulse-counted and monitored tanks are analog, so the budget gives the exact
      // counts the price keys off.
      this.sized.emit({
        segment: verticalToSegment(p.vertical),
        pumps: count('pump'),
        valves: count('valve'),
        flow: s.budget.pulse,
        tanks: s.budget.analog,
        topology: s.topology,
        profile: p,
        handoff: null,
      });
    });
  }

  /** Two or more sources must merge at a shared tank, so "no storage" is invalid. */
  protected readonly needsTank = computed(() => multiSourceNeedsTank([...this.form.sources()]));

  /** Chip state (multi-select / pick-one-of-many): the brand cyan when selected. */
  protected pill(active: boolean): string {
    return active
      ? 'bg-cyan-500 text-white ring-cyan-500'
      : 'bg-white text-slate-700 ring-slate-300 hover:ring-cyan-400 hover:text-slate-900';
  }

  /** Segment state inside a segmented control (pick exactly one small option). */
  protected seg(active: boolean): string {
    return active
      ? 'bg-cyan-500 text-white shadow-sm'
      : 'text-slate-600 hover:text-slate-900';
  }

  /** The hardware sizing, recomputed from the composer as answers change. */
  protected readonly system = computed<SystemEstimate | null>(() => {
    const p = this.form.profile();
    if (!p) return null;
    try {
      return estimateSystem(p);
    } catch {
      return null;
    }
  });

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

  /** Plain-language reason a described site exceeds Easy Mode, for the page's
   *  design-request hand-off. No pin counts: this is customer-facing and meant to
   *  read as "you have a real system", not "you broke the form". Null when it fits. */
  protected readonly handoffInfo = computed<{ reason: string; message: string } | null>(() => {
    const s = this.system();
    if (!s || s.fits) return null;
    if (this.form.isCustom()) return { reason: 'custom_tanks', message: 'A custom tank layout is best drawn up with our team.' };
    if ((this.form.profile()?.zones ?? 0) > 7) return { reason: 'many_areas', message: 'More separately-controlled areas than one controller runs, which is common on larger sites.' };
    return { reason: 'big_system', message: "A bigger, multi-controller system, the kind our team designs with you." };
  });
}
