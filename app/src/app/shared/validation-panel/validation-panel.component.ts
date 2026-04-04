import { Component, input, computed } from '@angular/core';
import type { ValidationResult } from '../../core/models/electron-api';

@Component({
  selector: 'app-validation-panel',
  standalone: true,
  template: `
    <div class="space-y-1 text-sm">
      @if (!result()) {
        <div class="text-base-content/30 italic">No validation run yet</div>
      } @else {
        <!-- GPIO budget -->
        @if (gpioUsage()) {
          <div class="flex items-center gap-2 mb-2">
            <span class="text-xs font-medium w-20">GPIO</span>
            <progress
              class="progress w-full"
              [class.progress-success]="gpioUsage()!.percent < 80"
              [class.progress-warning]="gpioUsage()!.percent >= 80 && gpioUsage()!.percent < 100"
              [class.progress-error]="gpioUsage()!.percent >= 100"
              [value]="gpioUsage()!.used"
              [max]="gpioUsage()!.total"
            ></progress>
            <span class="text-xs w-16 text-right">{{ gpioUsage()!.used }}/{{ gpioUsage()!.total }}</span>
          </div>
        }

        @for (error of result()!.errors; track error) {
          <div class="flex items-start gap-2 text-error">
            <span class="shrink-0">&#10007;</span>
            <span>{{ error }}</span>
          </div>
        }
        @for (warning of result()!.warnings; track warning) {
          <div class="flex items-start gap-2 text-warning">
            <span class="shrink-0">&#9888;</span>
            <span>{{ warning }}</span>
          </div>
        }
        @if (result()!.ok && result()!.warnings.length === 0) {
          <div class="flex items-center gap-2 text-success">
            <span>&#10003;</span>
            <span>All checks passed</span>
          </div>
        }
      }
    </div>
  `,
})
export class ValidationPanelComponent {
  result = input<ValidationResult | null>(null);
  gpioUsage = input<{ used: number; total: number; percent: number } | null>(null);
}
