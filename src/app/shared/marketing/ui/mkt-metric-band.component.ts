import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** A single proof figure. `value` is the big number (e.g. "1.2M"), `label` its caption. */
export interface MktMetric {
  value: string;
  label: string;
}

/**
 * A dark band of proof figures — the quantitative spine the page otherwise lacks.
 * Self-contained section; drop it in with a `metrics` array. Numbers use the
 * display family + `tabular-nums`. NOTE: values are placeholders until real
 * figures are supplied.
 */
@Component({
  selector: 'mkt-metric-band',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <section class="mkt-section relative overflow-hidden bg-slate-950 text-white">
      <div class="mkt-glow-blob pointer-events-none absolute -bottom-24 left-1/3 w-[26rem] h-[26rem] rounded-full bg-radial from-cyan-500/20 to-transparent to-70%"></div>
      <div class="max-w-5xl mx-auto relative">
        @if (heading()) {
          <h2 class="mkt-h2 text-center mb-10">{{ heading() }}</h2>
        }
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-8 sm:gap-6 text-center">
          @for (m of metrics(); track m.label) {
            <div>
              <div class="text-4xl sm:text-5xl font-bold tabular-nums bg-gradient-to-r from-cyan-300 via-sky-300 to-blue-300 bg-clip-text text-transparent"
                   style="font-family:var(--font-display)">{{ m.value }}</div>
              <div class="mt-2 text-xs font-medium uppercase tracking-wider text-white/55">{{ m.label }}</div>
            </div>
          }
        </div>
      </div>
    </section>
  `,
})
export class MktMetricBandComponent {
  readonly metrics = input.required<MktMetric[]>();
  readonly heading = input<string>();
}
