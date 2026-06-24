import { Component, computed, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { z } from 'zod';
import { ZodFieldDirective } from '../../core/utils/field-validation';
import { CharFilterDirective } from '../../core/utils/char-filter.directive';
import { FieldErrorComponent } from '../field-error/field-error.component';
import type { InputPolicy } from '@core';

/**
 * Single-purpose wrapper that composes [zodField] + [charFilter] + <app-field-error>
 * + the boilerplate around `<input>` for any text/number/time field bound to a
 * Zod schema. Optionality is derived from the schema field via `isOptional()`,
 * so empty input emits `undefined` for optional fields and the coerced value
 * otherwise.
 *
 * Layout: host is `display: contents` so the wrapper element disappears from
 * layout. An internal `<div class="flex flex-col">` ensures input + error +
 * hint always stack vertically regardless of the parent's flex direction.
 */
@Component({
  selector: 'app-zod-input',
  standalone: true,
  imports: [FormsModule, ZodFieldDirective, CharFilterDirective, FieldErrorComponent],
  template: `
    <div class="flex flex-col">
      <!-- Number inputs carry a STATIC type so Angular binds NumberValueAccessor
           (control value is a number); a dynamic [type] would fall back to the
           string accessor and validate as "received string". -->
      @if (type() === 'number') {
        <input type="number"
          [class]="classes()"
          [ngModelOptions]="{ standalone: true }"
          [zodField]="{ schema: schema(), key: fieldKey() }"
          [charFilter]="policy()"
          #ctrl="ngModel"
          [ngModel]="value()"
          [placeholder]="placeholder() ?? ''"
          [readonly]="readonly()"
          [attr.min]="min()"
          [attr.max]="max()"
          [attr.step]="step()"
          (ngModelChange)="onChange($event)" />
        <app-field-error [control]="ctrl" />
      } @else {
        <input [type]="type()"
          [class]="classes()"
          [ngModelOptions]="{ standalone: true }"
          [zodField]="{ schema: schema(), key: fieldKey() }"
          [charFilter]="policy()"
          #ctrlText="ngModel"
          [ngModel]="value()"
          [placeholder]="placeholder() ?? ''"
          [readonly]="readonly()"
          [attr.min]="min()"
          [attr.max]="max()"
          [attr.step]="step()"
          (ngModelChange)="onChange($event)" />
        <app-field-error [control]="ctrlText" />
      }
      @if (policy()?.hint && showHint()) {
        <span class="text-[10px] text-base-content/40">{{ policy()!.hint }}</span>
      }
    </div>
  `,
  styles: [':host { display: contents; }'],
})
export class ZodInputComponent {
  schema = input.required<z.ZodTypeAny>();
  fieldKey = input.required<string>();
  type = input<'text' | 'number' | 'time'>('text');
  size = input<'xs' | 'sm'>('xs');
  inputClass = input<string>('');
  policy = input<InputPolicy>();
  placeholder = input<string>();
  readonly = input<boolean>(false);
  showHint = input<boolean>(true);
  min = input<number>();
  max = input<number>();
  step = input<number>();
  value = input<unknown>();
  valueChange = output<unknown>();

  private fieldSchema = computed(() => {
    const shape = (this.schema() as z.ZodObject<z.ZodRawShape>).shape;
    return shape?.[this.fieldKey()];
  });

  protected classes = computed(() =>
    `input input-bordered input-${this.size()} ${this.inputClass()}`.trim()
  );

  protected onChange(raw: unknown): void {
    const optional = this.fieldSchema()?.isOptional() ?? false;
    if (this.type() === 'number') {
      const coerced = raw === '' || raw === null || raw === undefined
        ? undefined
        : +(raw as string | number);
      // Required + empty: emit NaN so Zod surfaces "Expected number" instead of
      // silently writing 0. Mirrors the validator's empty-value handling.
      this.valueChange.emit(optional ? coerced : (coerced ?? Number.NaN));
    } else {
      const s = (raw as string | undefined) ?? '';
      this.valueChange.emit(optional ? (s || undefined) : s);
    }
  }
}
