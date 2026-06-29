import { Component, input } from '@angular/core';
import type { PlanFeature } from '../feature-catalog';

/**
 * A two-column capability checklist: a cyan check for live features, a muted "Soon"
 * badge for announced-but-unbuilt ones. Shared by the pricing and features pages so the
 * "what's included" list renders identically and from one data source. Layout (width,
 * surrounding panel) is left to the caller.
 */
@Component({
  selector: 'mkt-feature-list',
  standalone: true,
  template: `
    <ul class="grid gap-x-6 gap-y-2.5 sm:grid-cols-2 text-sm">
      @for (f of items(); track f.label) {
        <li class="flex gap-2.5" [class.opacity-60]="f.status === 'soon'">
          @if (f.status === 'live') {
            <svg class="shrink-0 mt-0.5 text-cyan-500" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            <span class="text-slate-700">{{ f.label }}</span>
          } @else {
            <span class="shrink-0 mt-0.5 inline-flex items-center rounded-full bg-slate-100 px-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Soon</span>
            <span class="text-slate-500">{{ f.label }}</span>
          }
        </li>
      }
    </ul>
  `,
})
export class MktFeatureListComponent {
  readonly items = input.required<PlanFeature[]>();
}
