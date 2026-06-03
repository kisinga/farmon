import { Component, input, output, signal, OnChanges, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { DeviceDecodeRule } from '../../../core/services/api.types';

/**
 * DecodeRuleFormComponent — pure form for adding/editing a decode rule.
 * No API calls — emits the final value via `save` output.
 */
@Component({
  selector: 'app-decode-rule-form',
  standalone: true,
  imports: [FormsModule, CommonModule],
  template: `
    <form (ngSubmit)="onSubmit()" class="space-y-4 p-4">
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div class="form-control">
          <label class="label text-xs py-0.5">fPort</label>
          <input type="number" class="input input-bordered input-sm"
            [(ngModel)]="draft.fport" name="fport" min="1" max="223" />
        </div>
        <div class="form-control sm:col-span-2">
          <label class="label text-xs py-0.5">Format</label>
          <select class="select select-bordered select-sm"
            [(ngModel)]="draft.format" name="format">
            <option value="binary_indexed_float32">binary_indexed_float32</option>
            <option value="binary_indexed">binary_indexed</option>
            <option value="binary_state_change">binary_state_change</option>
            <option value="binary_frames">binary_frames</option>
            <option value="text_kv">text_kv</option>
          </select>
        </div>
      </div>

      <div class="form-control">
        <label class="label text-xs py-0.5">Config <span class="text-base-content/40">(JSON)</span></label>
        <textarea class="textarea textarea-bordered textarea-sm font-mono text-xs h-24"
          [(ngModel)]="configJson" name="config"
          placeholder='{ "key": "value" }'>
        </textarea>
        @if (configError()) {
          <p class="text-xs text-error mt-1">{{ configError() }}</p>
        }
      </div>

      @if (validationError()) {
        <div class="alert alert-error text-xs py-2">{{ validationError() }}</div>
      }

      <div class="flex gap-2">
        <button type="submit" class="btn btn-sm btn-primary">
          {{ isEdit() ? 'Update rule' : 'Add rule' }}
        </button>
        <button type="button" class="btn btn-sm btn-ghost" (click)="cancel.emit()">Cancel</button>
      </div>
    </form>
  `,
})
export class DecodeRuleFormComponent implements OnChanges {
  existing = input<DeviceDecodeRule | undefined>(undefined);

  save = output<Partial<DeviceDecodeRule>>();
  cancel = output<void>();

  draft: Partial<DeviceDecodeRule> = { fport: 1, format: 'binary_indexed_float32' };
  configJson = '{}';
  validationError = signal<string | null>(null);
  configError = signal<string | null>(null);

  isEdit() { return !!this.existing()?.id; }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['existing']) {
      const ex = this.existing();
      if (ex) {
        this.draft = { ...ex };
        this.configJson = JSON.stringify(ex.config ?? {}, null, 2);
      } else {
        this.draft = { fport: 1, format: 'binary_indexed_float32' };
        this.configJson = '{}';
      }
      this.validationError.set(null);
      this.configError.set(null);
    }
  }

  onSubmit(): void {
    this.configError.set(null);
    this.validationError.set(null);

    let config: Record<string, unknown>;
    try {
      config = JSON.parse(this.configJson || '{}');
    } catch {
      this.configError.set('Invalid JSON');
      return;
    }

    if (!this.draft.fport || this.draft.fport < 1 || this.draft.fport > 223) {
      this.validationError.set('fPort must be between 1 and 223.');
      return;
    }

    this.save.emit({ ...this.draft, config });
  }
}
