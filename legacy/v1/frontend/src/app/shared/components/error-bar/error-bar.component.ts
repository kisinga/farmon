import { Component, input, computed } from '@angular/core';
import { ERROR_CATEGORIES, ERROR_FIELD_LABELS } from '../../../core/constants/error-fields';
import { ValuePillComponent } from '../value-pill/value-pill.component';

@Component({
  selector: 'app-error-bar',
  standalone: true,
  imports: [ValuePillComponent],
  template: `
    <div class="rounded-xl border border-base-300 bg-base-100 p-4">
      <h2 class="section-title">Diagnostics</h2>
      @if (totalCount() === 0) {
        <p class="text-sm text-base-content/60">No errors reported.</p>
      } @else {
        <div class="space-y-3">
          @for (group of categoryGroups(); track group.category) {
            <div>
              <p class="text-xs font-medium text-base-content/70 uppercase tracking-wide">{{ group.category }}</p>
              <div class="flex flex-wrap gap-2 mt-1.5">
                @for (entry of group.entries; track entry.key) {
                  <app-value-pill [label]="entry.label" [value]="entry.value" variant="warning" />
                }
              </div>
            </div>
          }
        </div>
      }
    </div>
  `,
})
export class ErrorBarComponent {
  errorObject = input<Record<string, number>>({});

  totalCount = computed(() => {
    const obj = this.errorObject();
    const ec = obj['ec'];
    if (typeof ec === 'number') return ec;
    return Object.values(obj).reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0);
  });

  categoryGroups = computed(() => {
    const obj = this.errorObject();
    const out: Array<{ category: string; entries: Array<{ key: string; label: string; value: number }> }> = [];
    for (const [cat, keys] of Object.entries(ERROR_CATEGORIES)) {
      const entries = keys
        .map((k) => ({ key: k, value: (obj[k] as number) ?? 0, label: ERROR_FIELD_LABELS[k] ?? k }))
        .filter((e) => e.value > 0);
      if (entries.length > 0) out.push({ category: cat, entries });
    }
    return out;
  });
}
