import { Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DeviceVariable } from '../../../core/services/api.types';

/**
 * VariableBadgeComponent — inline chip showing a variable's identity.
 *
 * Used in the rule builder display, output form, and variable list.
 */
@Component({
  selector: 'app-variable-badge',
  standalone: true,
  imports: [CommonModule],
  template: `
    <span class="inline-flex items-center gap-1">
      <span class="badge badge-sm" [class]="typeBadgeClass()">{{ typeLabel() }}</span>
      <span class="font-mono text-xs">{{ variable().field_key }}</span>
      @if (variable().display_name && variable().display_name !== variable().field_key) {
        <span class="text-xs text-base-content/60">({{ variable().display_name }})</span>
      }
      @if (showIndex() && variable().field_idx != null) {
        <span class="badge badge-ghost badge-xs">f{{ variable().field_idx }}</span>
      }
    </span>
  `,
})
export class VariableBadgeComponent {
  variable  = input.required<DeviceVariable>();
  showIndex = input<boolean>(false);

  typeLabel(): string {
    switch (this.variable().linked_type) {
      case 'input':   return 'input';
      case 'output':  return 'output';
      case 'compute': return 'compute';
      default:        return 'var';
    }
  }

  typeBadgeClass(): string {
    switch (this.variable().linked_type) {
      case 'input':   return 'badge-info';
      case 'output':  return 'badge-success';
      case 'compute': return 'badge-secondary';
      default:        return 'badge-ghost';
    }
  }
}
