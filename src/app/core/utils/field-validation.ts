import { Directive, Input, forwardRef, OnChanges } from '@angular/core';
import { NG_VALIDATORS, Validator, AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';
import { z } from 'zod';

declare const ngDevMode: boolean | undefined;

export interface ZodFieldSpec {
  schema: z.ZodTypeAny;
  key: string;
}

const warnedFields = new Set<string>();

/**
 * Pure Zod→Angular validator adapter. Extracts the field's Zod schema from
 * the parent object's `.shape` and runs safeParse on the control value.
 * Reusable in template-driven (via ZodFieldDirective) or reactive forms.
 *
 * Misuse (non-object schema or typo'd key) silently returns "valid" in
 * production but warns once per unique (schema, key) in dev mode so typos
 * surface during development instead of masquerading as successful validation.
 */
export function zodFieldValidator(schema: z.ZodTypeAny, key: string): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const shape = (schema as z.ZodObject<z.ZodRawShape>).shape;
    const fieldSchema = shape?.[key];
    if (!fieldSchema) {
      if (typeof ngDevMode !== 'undefined' && ngDevMode) {
        const typeName = (schema as { _def?: { typeName?: string } })._def?.typeName ?? 'schema';
        const id = `${typeName}.${key}`;
        if (!warnedFields.has(id)) {
          warnedFields.add(id);
          console.warn(`[zodFieldValidator] No field "${key}" in ${typeName} — validator returns null (always valid). Check key/schema.`);
        }
      }
      return null;
    }
    const result = fieldSchema.safeParse(control.value);
    return result.success ? null : { zod: result.error.errors[0]?.message ?? 'Invalid value' };
  };
}

/**
 * Attaches a Zod-derived validator to any control with ngModel/formControl.
 *
 * Usage:
 *   <input [ngModel]="..." [zodField]="{ schema: TimingSchema, key: 'flow_watchdog' }" #ctrl="ngModel">
 *   <app-field-error [control]="ctrl" />
 *
 * Angular applies `ng-touched` / `ng-invalid` classes automatically — global
 * CSS maps those to DaisyUI's input-error / select-error for visual state.
 */
@Directive({
  selector: '[zodField]',
  standalone: true,
  providers: [{
    provide: NG_VALIDATORS,
    useExisting: forwardRef(() => ZodFieldDirective),
    multi: true,
  }],
})
export class ZodFieldDirective implements Validator, OnChanges {
  @Input('zodField') spec: ZodFieldSpec | null = null;
  private onChange?: () => void;

  validate(control: AbstractControl): ValidationErrors | null {
    if (!this.spec) return null;
    return zodFieldValidator(this.spec.schema, this.spec.key)(control);
  }

  registerOnValidatorChange(fn: () => void): void {
    this.onChange = fn;
  }

  ngOnChanges(): void {
    this.onChange?.();
  }
}
