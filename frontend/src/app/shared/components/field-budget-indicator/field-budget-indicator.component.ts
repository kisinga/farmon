import { Component, computed, input } from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * FieldBudgetIndicatorComponent — shows active variable count vs LoRaWAN transport budget.
 *
 * Used in Inputs tab header and Variables tab.
 */
@Component({
  selector: 'app-field-budget-indicator',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="flex items-center gap-2 text-xs">
      <div class="tooltip tooltip-right" [attr.data-tip]="tooltipText()">
        <span class="text-base-content/60 cursor-default border-b border-dashed border-base-content/30">
          Reported variables
        </span>
      </div>
      <span [class]="countClass()">{{ reportedCount() }} / {{ budget() }}</span>
      <progress
        class="progress w-20"
        [class]="progressClass()"
        [value]="reportedCount()"
        [max]="budget()"
      ></progress>
      @if (overBudget()) {
        <span class="badge badge-error badge-xs">Over budget</span>
      }
    </div>
  `,
})
export class FieldBudgetIndicatorComponent {
  reportedCount = input<number>(0);
  budget        = input<number>(10);

  tooltipText = computed(() =>
    `Up to ${this.budget()} variables can be sent per LoRaWAN uplink. ` +
    `Variables set to Disabled are still computed on device but won't be included in telemetry.`
  );

  overBudget = computed(() => this.reportedCount() > this.budget());
  atCapacity = computed(() => this.reportedCount() >= this.budget());

  countClass = computed(() => {
    if (this.overBudget()) return 'font-semibold text-error';
    if (this.atCapacity()) return 'font-semibold text-warning';
    return 'font-semibold';
  });

  progressClass = computed(() => {
    if (this.overBudget()) return 'progress-error';
    if (this.atCapacity()) return 'progress-warning';
    return 'progress-primary';
  });
}
