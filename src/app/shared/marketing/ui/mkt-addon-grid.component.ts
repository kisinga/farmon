import { Component, input } from '@angular/core';
import type { AddonService } from '../feature-catalog';

/**
 * A responsive grid of add-on service cards (name, blurb, availability). Shared by the
 * pricing and features pages so add-ons read the same wherever they appear. The heading
 * and surrounding section are left to the caller.
 */
@Component({
  selector: 'mkt-addon-grid',
  standalone: true,
  template: `
    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      @for (a of items(); track a.key) {
        <div class="rounded-2xl bg-slate-50 ring-1 ring-slate-200 p-5">
          <h4 class="font-semibold text-slate-900">{{ a.name }}</h4>
          <p class="mt-1 text-sm text-slate-600 leading-relaxed">{{ a.blurb }}</p>
          <p class="mt-2 text-xs font-semibold text-cyan-700">{{ a.availability }}</p>
        </div>
      }
    </div>
  `,
})
export class MktAddonGridComponent {
  readonly items = input.required<AddonService[]>();
}
