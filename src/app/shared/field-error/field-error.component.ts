import { Component, input } from '@angular/core';
import { NgModel } from '@angular/forms';

/**
 * Shows the Zod validation message for a control, once it's been touched.
 * Eliminates per-template `@if (ctrl.touched && ctrl.errors?.['zod'])` noise.
 *
 * Usage:
 *   <input [zodField]="..." #ctrl="ngModel" ... />
 *   <app-field-error [control]="ctrl" />
 */
@Component({
  selector: 'app-field-error',
  standalone: true,
  template: `
    @if (control().touched && control().errors?.['zod']; as msg) {
      <div class="text-error text-[10px] leading-tight mt-0.5">{{ msg }}</div>
    }
  `,
})
export class FieldErrorComponent {
  readonly control = input.required<NgModel>();
}
