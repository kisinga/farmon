import { Component, input, output, signal, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';

import { ApiService } from '../../../core/services/api.service';
import { ConfigContextService } from '../../../core/services/config-context.service';
import { DeviceVariable } from '../../../core/services/api.types';
import { danglingExpressionRefs } from '../../../core/utils/firmware-constraints';

/**
 * ComputeVariableEditorComponent — inline editor for a single compute variable.
 *
 * Owns its own expression draft signal so there's no shared mutable object at
 * the parent level (replaces the old `expressionDrafts: Record<string, string>` anti-pattern).
 */
@Component({
  selector: 'app-compute-variable-editor',
  standalone: true,
  imports: [FormsModule, CommonModule],
  template: `
    <div class="space-y-2">
      <div class="flex flex-wrap gap-2 items-end">
        <div class="form-control flex-1 min-w-48">
          <label class="label text-xs py-0.5">Expression <span class="text-base-content/40">(use f0, f1, f2…)</span></label>
          <input
            type="text"
            class="input input-bordered input-sm font-mono"
            [(ngModel)]="expressionDraft"
            placeholder="e.g. f0 * 1.8 + 32"
            (keydown.enter)="onSave()"
          />
        </div>
        <button class="btn btn-xs btn-ghost" (click)="onProbe()" [disabled]="probing()">
          @if (probing()) { <span class="loading loading-spinner loading-xs"></span> }
          Test
        </button>
        <button class="btn btn-xs btn-primary" (click)="onSave()" [disabled]="saving()">
          @if (saving()) { <span class="loading loading-spinner loading-xs"></span> }
          Save
        </button>
        <button class="btn btn-xs btn-ghost text-error" (click)="cancelEdit.emit()">Cancel</button>
      </div>

      <!-- Dangling reference warnings -->
      @if (danglingRefs().length > 0) {
        <div class="alert alert-warning text-xs py-1.5">
          <span>Referenced field indices not found: {{ danglingRefs().join(', ') }}. Check variable indices in the Variables tab.</span>
        </div>
      }

      <!-- Probe result -->
      @if (probeResult() !== null) {
        <div class="text-xs text-success font-mono">Result: {{ probeResult() }}</div>
      }
      @if (probeError()) {
        <div class="text-xs text-error">{{ probeError() }}</div>
      }
    </div>
  `,
})
export class ComputeVariableEditorComponent {
  variable = input.required<DeviceVariable>();

  cancelEdit = output<void>();
  saved = output<DeviceVariable>();

  private api = inject(ApiService);
  private ctx = inject(ConfigContextService);

  expressionDraft = '';
  probing = signal(false);
  saving = signal(false);
  probeResult = signal<number | null>(null);
  probeError = signal<string | null>(null);

  danglingRefs = computed(() =>
    danglingExpressionRefs(this.expressionDraft, this.ctx.fields())
  );

  ngOnInit(): void {
    this.expressionDraft = this.variable().expression ?? '';
  }

  onProbe(): void {
    const eui = this.ctx.eui();
    if (!eui) return;
    this.probing.set(true);
    this.probeResult.set(null);
    this.probeError.set(null);
    this.api.probeField(eui, this.variable().field_key).subscribe({
      next: (res: unknown) => {
        this.probing.set(false);
        this.probeResult.set((res as { value?: number })?.value ?? null);
      },
      error: (err) => {
        this.probing.set(false);
        this.probeError.set(err?.error?.message ?? err?.message ?? 'Probe failed');
      },
    });
  }

  onSave(): void {
    const v = this.variable();
    this.saving.set(true);
    this.probeError.set(null);
    this.api.updateDeviceField(v.id, { expression: this.expressionDraft }).subscribe({
      next: (updated) => {
        this.saving.set(false);
        this.saved.emit(updated);
        this.ctx.reloadFields();
      },
      error: (err) => {
        this.saving.set(false);
        this.probeError.set(err?.error?.message ?? err?.message ?? 'Failed to save expression');
      },
    });
  }
}
