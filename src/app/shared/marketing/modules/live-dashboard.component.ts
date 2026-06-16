import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';

/** Live tile state for the animated mock. */
interface DashState {
  tankA: number; // %
  tankB: number; // %
  flow: number; // L/min
  valve: boolean; // open?
  usage: number; // litres this week
  spark: number[]; // 7 daily bars (0..1)
}

const INITIAL: DashState = {
  tankA: 78,
  tankB: 54,
  flow: 12.4,
  valve: true,
  usage: 10_300,
  spark: [0.4, 0.55, 0.5, 0.7, 0.9, 0.75, 0.6],
};

/**
 * An animated stand-in for the product dashboard — the homepage's hero proof.
 * Replaces the static screenshot: tank bars ease toward new levels, the flow
 * pipe marches (shared `.flow-line`), the valve toggles, usage ticks up.
 *
 * Prerender-safe: the loop is started from `afterNextRender`, so SSR emits a
 * sensible static first frame (crawlers still get meaningful markup) and motion
 * only begins in the browser. Honours `prefers-reduced-motion` (no loop; the
 * `.flow-line` dash is disabled globally in styles.css).
 */
@Component({
  selector: 'mkt-live-dashboard',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="rounded-2xl bg-white ring-1 ring-slate-200 shadow-2xl shadow-slate-900/10 overflow-hidden">
      <!-- browser chrome -->
      <div class="flex items-center gap-1.5 px-4 h-9 bg-slate-100 border-b border-slate-200">
        <span class="w-3 h-3 rounded-full bg-red-400/70"></span>
        <span class="w-3 h-3 rounded-full bg-amber-400/70"></span>
        <span class="w-3 h-3 rounded-full bg-green-400/70"></span>
        <span class="ml-3 hidden sm:block rounded-md bg-white ring-1 ring-slate-200 px-3 py-0.5 text-[11px] text-slate-400">majiflow.io / dashboard</span>
        <span class="ml-auto inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-600">
          <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 mkt-ripple"></span> Live
        </span>
      </div>

      <!-- dashboard body -->
      <div class="bg-slate-950 p-4 sm:p-5">
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <!-- Tank A -->
          <div class="rounded-xl bg-white/5 ring-1 ring-white/10 p-4">
            <div class="text-[11px] uppercase tracking-wider text-white/45">Tank A</div>
            <div class="mt-3 flex items-end gap-3">
              <div class="relative w-9 h-20 rounded-md bg-white/5 ring-1 ring-white/10 overflow-hidden">
                <div class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-cyan-500 to-sky-400 transition-[height] duration-1000 ease-out"
                     [style.height.%]="state().tankA"></div>
              </div>
              <div class="text-2xl font-bold tabular-nums text-white leading-none">{{ state().tankA }}<span class="text-sm text-white/40">%</span></div>
            </div>
          </div>

          <!-- Tank B -->
          <div class="rounded-xl bg-white/5 ring-1 ring-white/10 p-4">
            <div class="text-[11px] uppercase tracking-wider text-white/45">Tank B</div>
            <div class="mt-3 flex items-end gap-3">
              <div class="relative w-9 h-20 rounded-md bg-white/5 ring-1 ring-white/10 overflow-hidden">
                <div class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-cyan-500 to-sky-400 transition-[height] duration-1000 ease-out"
                     [style.height.%]="state().tankB"></div>
              </div>
              <div class="text-2xl font-bold tabular-nums text-white leading-none">{{ state().tankB }}<span class="text-sm text-white/40">%</span></div>
            </div>
          </div>

          <!-- Flow -->
          <div class="rounded-xl bg-white/5 ring-1 ring-white/10 p-4">
            <div class="text-[11px] uppercase tracking-wider text-white/45">Flow</div>
            <svg viewBox="0 0 120 20" class="mt-4 w-full text-cyan-400" aria-hidden="true">
              <line x1="2" y1="10" x2="118" y2="10" stroke="currentColor" stroke-width="3" stroke-linecap="round" class="flow-line" />
            </svg>
            <div class="mt-3 text-xl font-bold tabular-nums text-white leading-none">{{ state().flow.toFixed(1) }} <span class="text-[11px] font-normal text-white/40">L/min</span></div>
          </div>

          <!-- Valve -->
          <div class="rounded-xl bg-white/5 ring-1 ring-white/10 p-4">
            <div class="text-[11px] uppercase tracking-wider text-white/45">Borehole valve</div>
            <div class="mt-4 inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-semibold transition-colors"
                 [class]="state().valve ? 'bg-emerald-400/15 text-emerald-300' : 'bg-amber-400/15 text-amber-300'">
              <span class="w-2 h-2 rounded-full" [class]="state().valve ? 'bg-emerald-400' : 'bg-amber-400'"></span>
              {{ state().valve ? 'Open' : 'Closed' }}
            </div>
            <div class="mt-3 text-[11px] text-white/40">Auto · level &lt; 30%</div>
          </div>
        </div>

        <!-- Usage sparkline -->
        <div class="mt-3 sm:mt-4 rounded-xl bg-white/5 ring-1 ring-white/10 p-4">
          <div class="flex items-center justify-between">
            <div class="text-[11px] uppercase tracking-wider text-white/45">Field A · usage this week</div>
            <div class="text-sm font-semibold tabular-nums text-white">{{ usageLabel() }} <span class="text-[11px] font-normal text-white/40">L</span></div>
          </div>
          <div class="mt-3 flex items-end gap-1.5 h-12">
            @for (h of state().spark; track $index) {
              <div class="flex-1 rounded-sm bg-gradient-to-t from-cyan-500/60 to-sky-400/80 transition-[height] duration-700 ease-out"
                   [style.height.%]="h * 100"></div>
            }
          </div>
        </div>
      </div>
    </div>
  `,
})
export class LiveDashboardComponent {
  private readonly destroyRef = inject(DestroyRef);
  protected readonly state = signal<DashState>(INITIAL);

  protected usageLabel(): string {
    return this.state().usage.toLocaleString('en-US');
  }

  constructor() {
    // Browser-only; no-op during SSR/prerender, so the static first frame ships.
    afterNextRender(() => {
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const id = setInterval(() => this.tick(), 2200);
      this.destroyRef.onDestroy(() => clearInterval(id));
    });
  }

  private tick(): void {
    this.state.update((s) => {
      const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
      const drift = (n: number, amt: number) => n + (Math.random() * 2 - 1) * amt;
      const spark = [...s.spark.slice(1), clamp(drift(s.spark[s.spark.length - 1], 0.25), 0.2, 1)];
      return {
        tankA: Math.round(clamp(drift(s.tankA, 6), 36, 96)),
        tankB: Math.round(clamp(drift(s.tankB, 6), 30, 90)),
        flow: clamp(drift(s.flow, 2.5), 4, 22),
        valve: Math.random() < 0.25 ? !s.valve : s.valve,
        usage: s.usage + Math.round(Math.random() * 120),
        spark,
      };
    });
  }
}
