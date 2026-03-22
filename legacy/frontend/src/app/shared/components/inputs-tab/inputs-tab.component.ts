import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

import { ConfigContextService } from '../../../core/services/config-context.service';
import { ApiService } from '../../../core/services/api.service';
import { DeviceSensorConfigComponent } from '../device-sensor-config/device-sensor-config.component';
import { FieldBudgetIndicatorComponent } from '../field-budget-indicator/field-budget-indicator.component';
import { SyncStatusBadgeComponent } from '../sync-status-badge/sync-status-badge.component';
import { ConfirmDialogComponent } from '../confirm-dialog/confirm-dialog.component';
import { AirConfigSensor, DeviceField } from '../../../core/services/api.types';

/**
 * InputsTabComponent — config page Inputs tab.
 *
 * Shows existing input variables and embeds the DeviceSensorConfigComponent
 * wizard for adding new sensors. Because DeviceSensorConfigComponent navigates
 * away on save, we listen for NavigationEnd back to the config page and reload
 * fields so the list stays current.
 */
@Component({
  selector: 'app-inputs-tab',
  standalone: true,
  imports: [
    CommonModule,
    DeviceSensorConfigComponent,
    FieldBudgetIndicatorComponent,
    SyncStatusBadgeComponent,
    ConfirmDialogComponent,
  ],
  template: `
    <div class="space-y-6">

      <!-- Header -->
      <div class="flex items-center justify-between flex-wrap gap-3">
        <div class="flex items-center gap-4 flex-wrap">
          <app-field-budget-indicator
            [reportedCount]="ctx.reportedVariableCount()"
            [budget]="10"
          />
          @if (ctx.isAirConfig()) {
            <app-sync-status-badge [state]="ctx.airConfigSyncState()" />
          }
        </div>
        <button
          class="btn btn-sm btn-primary"
          (click)="openAddWizard()"
          [disabled]="!ctx.eui()"
        >
          {{ showWizard() && !editingSlot() ? 'Cancel' : '+ Add Input' }}
        </button>
      </div>

      <!-- Add / Edit sensor wizard -->
      @if (showWizard()) {
        <div class="border border-base-300 rounded-xl bg-base-200/30 p-4">
          <div class="flex items-center justify-between mb-4">
            <h3 class="text-sm font-semibold">{{ editingSlot() !== null ? 'Edit Input Sensor' : 'Add Input Sensor' }}</h3>
            <button class="btn btn-xs btn-ghost" (click)="closeWizard()">✕</button>
          </div>
          <app-device-sensor-config
            [eui]="ctx.eui()"
            [fieldConfigs]="ctx.inputVariables()"
            [pinMap]="ctx.pinMapArray()"
            [usedPins]="usedPinsForForm()"
            [existingSlot]="editingSlot()"
            [existingSensor]="editingSensor()"
            [existingField]="editingField()"
            (saved)="onSensorSaved()"
          />
        </div>
      }

      <!-- Input variables list -->
      <div class="space-y-3">
        @if (ctx.loading()) {
          <div class="flex justify-center py-8">
            <span class="loading loading-spinner loading-sm"></span>
          </div>
        } @else if (ctx.inputVariables().length === 0) {
          <div class="text-sm text-base-content/60 py-6 text-center">
            No input sensors configured. Click "+ Add Input" to add your first sensor.
          </div>
        } @else {
          @for (v of ctx.inputVariables(); track v.id) {
            <div class="flex items-center justify-between gap-3 rounded-xl border border-base-300 bg-base-100 px-4 py-3">
              <div class="flex items-center gap-3 min-w-0">
                <span class="badge badge-info badge-sm">input</span>
                <div class="min-w-0">
                  <p class="font-medium text-sm truncate">{{ v.display_name || v.field_key }}</p>
                  <div class="flex items-center gap-2 mt-0.5">
                    <span class="font-mono text-xs text-base-content/50">{{ v.field_key }}
                      @if (v.field_idx != null) {
                        <span class="ml-1 text-base-content/30">· f{{ v.field_idx }}</span>
                      }
                    </span>
                    @if (v.category) {
                      <span class="badge badge-ghost badge-xs">{{ v.category }}</span>
                    }
                    @if (sensorPin(v) != null) {
                      <span class="badge badge-outline badge-xs">Pin {{ sensorPin(v) }}</span>
                    }
                  </div>
                </div>
              </div>
              <div class="flex items-center gap-3 flex-shrink-0">
                @if (v.unit) {
                  <span class="badge badge-ghost badge-sm">{{ v.unit }}</span>
                }
                <div class="tooltip tooltip-left" data-tip="Reported: sent every interval · On Change: sent only when the value changes · Disabled: never transmitted">
                  <select
                    class="select select-bordered select-xs"
                    [value]="v.report_mode ?? 'reported'"
                    (change)="onReportModeChange(v.id, $any($event.target).value)"
                    [disabled]="savingFieldId() === v.id"
                  >
                    <option value="reported">Reported</option>
                    <option value="on_change">On Change</option>
                    <option value="disabled">Disabled</option>
                  </select>
                </div>
                <button class="btn btn-xs btn-ghost" (click)="startEdit(v)">Edit</button>
                <button class="btn btn-xs btn-ghost text-error" (click)="confirmDelete(v)">Delete</button>
              </div>
            </div>
          }
        }
      </div>

    </div>

    <!-- Delete confirmation -->
    <app-confirm-dialog
      [open]="showDeleteConfirm()"
      title="Delete input sensor?"
      [message]="'Remove ' + (deletingField()?.display_name || deletingField()?.field_key || 'this sensor') + ' and clear its slot on the device?'"
      confirmLabel="Delete"
      [dangerMode]="true"
      (confirmed)="executeDelete()"
      (cancelled)="showDeleteConfirm.set(false)"
    />
  `,
})
export class InputsTabComponent {
  protected ctx = inject(ConfigContextService);
  private api = inject(ApiService);

  showWizard = signal(false);
  savingFieldId = signal<string | null>(null);

  // ─── Edit state ─────────────────────────────────────────────────────────────

  editingSlot = signal<number | null>(null);
  editingSensor = signal<AirConfigSensor | null>(null);
  editingField = signal<DeviceField | null>(null);

  /** Pins used by all sensors/controls, minus the currently-editing sensor's pin. */
  usedPinsForForm = computed<Set<number>>(() => {
    const all = this.ctx.allUsedPins();
    const s = this.editingSensor();
    if (!s || s.pin_index === 255) return all;
    const without = new Set(all);
    without.delete(s.pin_index);
    return without;
  });

  /** Look up the GPIO pin index for a sensor input variable. */
  sensorPin(v: DeviceField): number | null {
    if (v.field_idx == null) return null;
    return this.ctx.sensorPinByFieldIdx().get(v.field_idx) ?? null;
  }

  // ─── Delete state ────────────────────────────────────────────────────────────

  showDeleteConfirm = signal(false);
  deletingField = signal<DeviceField | null>(null);
  private deletingSlot = signal<number | null>(null);

  // ─── Wizard helpers ──────────────────────────────────────────────────────────

  openAddWizard(): void {
    if (this.showWizard() && this.editingSlot() === null) {
      this.closeWizard();
      return;
    }
    this.editingSlot.set(null);
    this.editingSensor.set(null);
    this.editingField.set(null);
    this.showWizard.set(true);
  }

  closeWizard(): void {
    this.showWizard.set(false);
    this.editingSlot.set(null);
    this.editingSensor.set(null);
    this.editingField.set(null);
  }

  startEdit(v: DeviceField): void {
    const sensors = this.ctx.deviceSpec()?.airconfig?.sensors ?? [];
    const slot = sensors.findIndex(s => s.field_index === v.field_idx);
    if (slot === -1) return;
    this.editingSlot.set(slot);
    this.editingSensor.set(sensors[slot]);
    this.editingField.set(v);
    this.showWizard.set(true);
  }

  onSensorSaved(): void {
    const slot = this.editingSlot();
    const sensor = this.editingSensor();
    if (slot !== null && sensor) {
      this.ctx.updateSensorInSpec(slot, sensor);
    }
    this.closeWizard();
    this.ctx.reloadFields();
    this.ctx.reloadDeviceSpec();
  }

  // ─── Delete helpers ──────────────────────────────────────────────────────────

  confirmDelete(v: DeviceField): void {
    const sensors = this.ctx.deviceSpec()?.airconfig?.sensors ?? [];
    const slot = sensors.findIndex(s => s.field_index === v.field_idx);
    if (slot === -1) return;
    this.deletingField.set(v);
    this.deletingSlot.set(slot);
    this.showDeleteConfirm.set(true);
  }

  executeDelete(): void {
    const slot = this.deletingSlot();
    const field = this.deletingField();
    if (slot === null || !field) return;
    this.showDeleteConfirm.set(false);

    this.api.pushSensorSlot(this.ctx.eui(), {
      slot,
      type: 0,
      pin_index: 255,
      field_index: 0,
      flags: 0,
    }).subscribe({
      next: () => {
        this.ctx.clearSensorInSpec(slot);
        this.api.deleteDeviceField(field.id).subscribe({
          next: () => {
            this.ctx.reloadFields();
            this.ctx.reloadDeviceSpec();
          },
          error: () => {
            this.ctx.reloadFields();
            this.ctx.reloadDeviceSpec();
          },
        });
      },
      error: (err: { message?: string }) => {
        this.ctx.flash(err?.message ?? 'Failed to delete sensor', true);
      },
    });

    this.deletingField.set(null);
    this.deletingSlot.set(null);
  }

  // ─── Report mode ─────────────────────────────────────────────────────────────

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
