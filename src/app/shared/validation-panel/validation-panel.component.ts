import { Component, input, computed, output } from '@angular/core';
import type { ValidationResult } from '../../core/models/electron-api';

@Component({
  selector: 'app-validation-panel',
  standalone: true,
  template: `
    <div class="flex flex-col gap-1.5 text-xs">
      @if (!result()) {
        <div class="text-base-content/50 italic">No validation run yet</div>
      } @else {
        <!-- GPIO budget -->
        @if (gpioUsage()) {
          <div class="flex items-center gap-2 mb-1">
            <span class="font-medium w-20">GPIO</span>
            <progress
              class="progress w-full"
              [class.progress-success]="gpioUsage()!.percent < 80"
              [class.progress-warning]="gpioUsage()!.percent >= 80 && gpioUsage()!.percent < 100"
              [class.progress-error]="gpioUsage()!.percent >= 100"
              [value]="gpioUsage()!.used"
              [max]="gpioUsage()!.total"
            ></progress>
            <span class="w-16 text-right">{{ gpioUsage()!.used }}/{{ gpioUsage()!.total }}</span>
          </div>
        }

        @for (d of errors(); track d.ruleId + d.target) {
          <div
            class="flex items-start gap-2 rounded-lg border-l-4 border-error bg-error/10 px-2.5 py-1.5 text-error"
            [class.cursor-pointer]="d.target"
            [class.hover:bg-error/20]="d.target"
            (click)="d.target && selectTarget.emit(d.target!)"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0 mt-px" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"/>
            </svg>
            <span class="flex-1 text-base-content/90">{{ d.message }}</span>
            @if (d.target) {
              <span class="text-error/60 mt-px" title="Click to locate">&#x2197;</span>
            }
          </div>
        }
        @for (d of warnings(); track d.ruleId + d.target) {
          <div
            class="flex items-start gap-2 rounded-lg border-l-4 border-warning bg-warning/10 px-2.5 py-1.5 text-warning"
            [class.cursor-pointer]="d.target"
            [class.hover:bg-warning/20]="d.target"
            (click)="d.target && selectTarget.emit(d.target!)"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0 mt-px" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/>
            </svg>
            <span class="flex-1 text-base-content/90">{{ d.message }}</span>
            @if (d.target) {
              <span class="text-warning/60 mt-px" title="Click to locate">&#x2197;</span>
            }
          </div>
        }
        @if (result()!.ok && warnings().length === 0) {
          <div class="flex items-start gap-2 rounded-lg border-l-4 border-success bg-success/10 px-2.5 py-1.5 text-success">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0 mt-px" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/>
            </svg>
            <span class="text-base-content/90">All checks passed</span>
          </div>
        }
      }
    </div>
  `,
})
export class ValidationPanelComponent {
  result = input<ValidationResult | null>(null);
  gpioUsage = input<{ used: number; total: number; percent: number } | null>(null);
  selectTarget = output<string>();

  protected errors = computed(() =>
    this.result()?.diagnostics.filter(d => d.severity === 'error') ?? [],
  );
  protected warnings = computed(() =>
    this.result()?.diagnostics.filter(d => d.severity === 'warning') ?? [],
  );
}
