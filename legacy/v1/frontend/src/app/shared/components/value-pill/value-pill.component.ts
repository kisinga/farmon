import { Component, input } from '@angular/core';

@Component({
  selector: 'app-value-pill',
  standalone: true,
  template: `
    <span class="badge" [class.badge-neutral]="variant() === 'neutral'" [class.badge-warning]="variant() === 'warning'" [class.badge-error]="variant() === 'error'" [class.badge-success]="variant() === 'success'">
      {{ label() }}: {{ value() }}
    </span>
  `,
})
export class ValuePillComponent {
  label = input.required<string>();
  value = input<string | number>('');
  variant = input<'neutral' | 'warning' | 'error' | 'success'>('neutral');
}
