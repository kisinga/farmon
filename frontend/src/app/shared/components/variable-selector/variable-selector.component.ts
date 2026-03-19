import { Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DeviceVariable } from '../../../core/services/api.types';

/**
 * VariableSelectorComponent — dropdown for selecting a device variable.
 *
 * Used in:
 * - DeviceAutomationsSectionComponent: pick the condition variable and target output
 * - OutputFormComponent: pick the feedback variable for an output
 */
@Component({
  selector: 'app-variable-selector',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <select
      class="select select-bordered select-sm w-full"
      [ngModel]="selectedKey()"
      (ngModelChange)="onSelect($event)"
    >
      <option value="">{{ placeholder() }}</option>
      @for (v of filtered(); track v.field_key) {
        <option [value]="v.field_key">
          {{ v.display_name || v.field_key }}
          <ng-container *ngIf="showIndex()"> [f{{ v.field_idx }}]</ng-container>
        </option>
      }
    </select>
  `,
})
export class VariableSelectorComponent {
  variables  = input<DeviceVariable[]>([]);
  selectedKey = input<string>('');
  placeholder = input<string>('Select variable…');
  showIndex  = input<boolean>(false);
  /** Optional filter applied to the variables list before display. */
  filterFn   = input<((v: DeviceVariable) => boolean) | null>(null);

  selected = output<DeviceVariable | null>();

  get filtered(): () => DeviceVariable[] {
    return () => {
      const fn = this.filterFn();
      return fn ? this.variables().filter(fn) : this.variables();
    };
  }

  onSelect(key: string): void {
    const v = this.variables().find(v => v.field_key === key) ?? null;
    this.selected.emit(v);
  }
}
