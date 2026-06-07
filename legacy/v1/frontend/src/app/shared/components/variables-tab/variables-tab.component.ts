import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

import { ConfigContextService } from '../../../core/services/config-context.service';
import { ApiService } from '../../../core/services/api.service';
import { DeviceVariable } from '../../../core/services/api.types';
import { getFieldBudget, nextAvailableFieldIndex } from '../../../core/utils/firmware-constraints';
import { humanize } from '../../../core/utils/compute-expression';
import { FieldBudgetIndicatorComponent } from '../field-budget-indicator/field-budget-indicator.component';
import { ConfirmDialogComponent } from '../confirm-dialog/confirm-dialog.component';
import { ComputeVariableEditorComponent } from './compute-variable-editor.component';

/**
 * VariablesTabComponent — config page Variables tab.
 *
 * Shows all variables (input, output, compute) in a unified list.
 * Input/output variables are read-only (report_mode is editable).
 * Compute variables have an inline expression editor.
 * Enforces field-index-stability: checks for rule references before deletion.
 */
@Component({
  selector: 'app-variables-tab',
  standalone: true,
  imports: [
    CommonModule,
    FieldBudgetIndicatorComponent,
    ConfirmDialogComponent,
    ComputeVariableEditorComponent,
  ],
  template: `
    <div class="space-y-6">

      <!-- Header -->
      <div class="flex items-center justify-between flex-wrap gap-3">
        @if (ctx.isLoRaWAN()) {
          <app-field-budget-indicator
            [reportedCount]="ctx.reportedVariableCount()"
            [budget]="fieldBudget()"
          />
        }
        <button class="btn btn-sm btn-primary" (click)="addComputeVariable()">
          + Add Compute Variable
        </button>
      </div>

      <!-- Flash message -->
      @if (ctx.flashMessage()) {
        <div class="alert text-sm py-2 rounded-xl"
          [class.alert-error]="ctx.flashMessage()!.isError"
          [class.alert-success]="!ctx.flashMessage()!.isError">
          {{ ctx.flashMessage()!.text }}
        </div>
      }

      <!-- Variables list -->
      @if (ctx.loading()) {
        <div class="flex justify-center py-8">
          <span class="loading loading-spinner loading-sm"></span>
        </div>
      } @else if (ctx.fields().length === 0) {
        <div class="text-sm text-base-content/60 py-6 text-center">
          No variables yet. Variables are created automatically when you add inputs or outputs.
        </div>
      } @else {

        <!-- Input Variables -->
        @if (ctx.inputVariables().length > 0) {
          <div class="space-y-2">
            <p class="text-xs font-semibold text-base-content/40 uppercase tracking-wide">Input Variables</p>
            @for (v of ctx.inputVariables(); track v.id) {
              <div class="flex items-center justify-between gap-3 rounded-xl border border-base-300 bg-base-100 px-4 py-3">
                <div class="flex items-center gap-3 min-w-0">
                  <span class="badge badge-info badge-sm">input</span>
                  <div class="min-w-0">
                    <p class="font-medium text-sm truncate">{{ v.display_name || v.field_key }}</p>
                    <p class="font-mono text-xs text-base-content/50">{{ v.field_key }}
                      @if (v.field_idx != null) {
                        <span class="ml-1 text-base-content/30">· f{{ v.field_idx }}</span>
                      }
                    </p>
                  </div>
                </div>
                <div class="flex items-center gap-3 flex-shrink-0">
                  @if (v.unit) { <span class="badge badge-ghost badge-sm">{{ v.unit }}</span> }
                  <div class="tooltip tooltip-left" data-tip="Reported: sent every interval · On Change: sent only when the value changes · Disabled: never transmitted">
                    <select class="select select-bordered select-xs"
                      [value]="v.report_mode ?? 'reported'"
                      (change)="onReportModeChange(v.id, $any($event.target).value)"
                      [disabled]="savingFieldId() === v.id">
                      <option value="reported">Reported</option>
                      <option value="on_change">On Change</option>
                      <option value="disabled">Disabled</option>
                    </select>
                  </div>
                </div>
              </div>
            }
          </div>
        }

        <!-- Output Variables -->
        @if (ctx.outputVariables().length > 0) {
          <div class="space-y-2">
            <p class="text-xs font-semibold text-base-content/40 uppercase tracking-wide">Output Variables</p>
            @for (v of ctx.outputVariables(); track v.id) {
              <div class="flex items-center justify-between gap-3 rounded-xl border border-base-300 bg-base-100 px-4 py-3">
                <div class="flex items-center gap-3 min-w-0">
                  <span class="badge badge-success badge-sm">output</span>
                  <div class="min-w-0">
                    <p class="font-medium text-sm truncate">{{ v.display_name || v.field_key }}</p>
                    <p class="font-mono text-xs text-base-content/50">{{ v.field_key }}
                      @if (v.field_idx != null) {
                        <span class="ml-1 text-base-content/30">· f{{ v.field_idx }}</span>
                      }
                    </p>
                  </div>
                </div>
                <div class="flex items-center gap-3 flex-shrink-0">
                  @if (v.unit) { <span class="badge badge-ghost badge-sm">{{ v.unit }}</span> }
                  <div class="tooltip tooltip-left" data-tip="Reported: sent every interval · On Change: sent only when the value changes · Disabled: never transmitted">
                    <select class="select select-bordered select-xs"
                      [value]="v.report_mode ?? 'reported'"
                      (change)="onReportModeChange(v.id, $any($event.target).value)"
                      [disabled]="savingFieldId() === v.id">
                      <option value="reported">Reported</option>
                      <option value="on_change">On Change</option>
                      <option value="disabled">Disabled</option>
                    </select>
                  </div>
                </div>
              </div>
            }
          </div>
        }

        <!-- Compute Variables -->
        <div class="space-y-2">
          <p class="text-xs font-semibold text-base-content/40 uppercase tracking-wide">Compute Variables</p>
          @if (ctx.computeVariables().length === 0) {
            <p class="text-sm text-base-content/50">No compute variables. Click "+ Add Compute Variable" above to define derived values.</p>
          }
          @for (v of ctx.computeVariables(); track v.id) {
            <div class="rounded-xl border border-base-300 bg-base-100 p-3 space-y-2">
              <div class="flex items-center justify-between gap-3">
                <div class="flex items-center gap-2 min-w-0">
                  <span class="badge badge-secondary badge-sm">compute</span>
                  <span class="font-medium text-sm truncate">{{ v.display_name || v.field_key }}</span>
                  <span class="font-mono text-xs text-base-content/40">{{ v.field_key }}</span>
                  @if (v.field_idx != null) {
                    <span class="badge badge-ghost badge-xs">f{{ v.field_idx }}</span>
                  }
                </div>
                <div class="flex items-center gap-2">
                  @if (v.unit) { <span class="badge badge-ghost badge-xs">{{ v.unit }}</span> }
                  <button class="btn btn-xs btn-ghost"
                    (click)="editingId.set(editingId() === v.id ? null : v.id)">
                    {{ editingId() === v.id ? 'Cancel' : 'Edit' }}
                  </button>
                  <button class="btn btn-xs btn-ghost text-error" (click)="confirmDelete(v)">Delete</button>
                </div>
              </div>
              @if (editingId() !== v.id && v.expression) {
                <p class="font-mono text-xs text-base-content/50 truncate">= {{ humanizeExpr(v.expression) }}</p>
              }
              @if (editingId() === v.id) {
                <app-compute-variable-editor
                  [variable]="v"
                  (cancelEdit)="editingId.set(null)"
                  (saved)="editingId.set(null)"
                />
              }
            </div>
          }
        </div>
      }

      <!-- Delete confirmation -->
      <app-confirm-dialog
        [open]="!!deletingVariable()"
        title="Delete variable?"
        [message]="deleteMessage()"
        [detail]="deleteDetail()"
        confirmLabel="Delete"
        [dangerMode]="true"
        (confirmed)="executeDelete()"
        (cancelled)="deletingVariable.set(null)"
      />

    </div>
  `,
})
export class VariablesTabComponent {
  protected ctx = inject(ConfigContextService);
  private api = inject(ApiService);

  fieldBudget = computed(() => getFieldBudget(this.ctx.device()?.transport ?? 'lorawan'));

  editingId = signal<string | null>(null);
  deletingVariable = signal<DeviceVariable | null>(null);
  savingFieldId = signal<string | null>(null);

  deleteMessage(): string {
    const v = this.deletingVariable();
    if (!v) return '';
    const check = this.ctx.canDeleteVariable(v);
    if (!check.allowed) return check.reason ?? 'This variable is referenced by automation rules.';
    return `Delete "${v.display_name || v.field_key}"? This cannot be undone.`;
  }

  deleteDetail(): string {
    const v = this.deletingVariable();
    if (!v) return '';
    const check = this.ctx.canDeleteVariable(v);
    if (!check.allowed && check.blockingRules.length > 0) {
      return `Blocking rules: ${check.blockingRules.map(r => `Rule #${r.rule_id}`).join(', ')}. Remove these rules first.`;
    }
    return '';
  }

  confirmDelete(v: DeviceVariable): void {
    this.deletingVariable.set(v);
  }

  executeDelete(): void {
    const v = this.deletingVariable();
    if (!v) return;
    const check = this.ctx.canDeleteVariable(v);
    this.deletingVariable.set(null);
    if (!check.allowed) {
      this.ctx.flash(check.reason ?? 'Cannot delete: referenced by automation rules.', true);
      return;
    }
    this.api.deleteDeviceField(v.id).subscribe({
      next: () => {
        this.ctx.reloadFields();
        this.ctx.flash('Variable deleted.');
      },
      error: (err) => this.ctx.flash(err?.message ?? 'Failed to delete variable', true),
    });
  }

  addComputeVariable(): void {
    const eui = this.ctx.eui();
    if (!eui) return;
    const fieldIdx = nextAvailableFieldIndex(this.ctx.fields());
    if (fieldIdx < 0) {
      this.ctx.flash('All 256 field indices are in use.', true);
      return;
    }
    const key = `compute_${fieldIdx}`;
    this.api.createDeviceField({
      device_eui: eui,
      field_key: key,
      display_name: `Compute ${fieldIdx}`,
      data_type: 'float',
      category: 'compute',
      linked_type: 'compute',
      field_idx: fieldIdx,
      report_mode: 'reported',
      expression: '',
    }).subscribe({
      next: (created) => {
        this.ctx.reloadFields();
        this.editingId.set(created.id);
      },
      error: (err) => this.ctx.flash(err?.message ?? 'Failed to create variable', true),
    });
  }

  humanizeExpr(expr: string): string {
    return humanize(expr, this.ctx.fields());
  }

  onReportModeChange(fieldId: string, mode: string): void {
    this.savingFieldId.set(fieldId);
    this.api.updateDeviceField(fieldId, { report_mode: mode as 'reported' | 'on_change' | 'disabled' }).subscribe({
      next: () => {
        this.savingFieldId.set(null);
        this.ctx.reloadFields();
      },
      error: (err) => {
        this.savingFieldId.set(null);
        this.ctx.flash(err?.message ?? 'Failed to update report mode', true);
      },
    });
  }
}
