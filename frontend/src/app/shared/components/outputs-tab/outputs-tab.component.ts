import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

import { ConfigContextService } from '../../../core/services/config-context.service';
import { ApiService } from '../../../core/services/api.service';
import { DeviceControl } from '../../../core/services/api.types';
import { SyncStatusBadgeComponent } from '../sync-status-badge/sync-status-badge.component';
import { ConfirmDialogComponent } from '../confirm-dialog/confirm-dialog.component';
import { OutputFormComponent } from './output-form.component';

/**
 * OutputsTabComponent — config page Outputs tab.
 *
 * Lists existing outputs and delegates add/edit to OutputFormComponent (pure form).
 * API calls happen here after form emits a valid payload.
 */
@Component({
  selector: 'app-outputs-tab',
  standalone: true,
  imports: [
    CommonModule,
    SyncStatusBadgeComponent,
    ConfirmDialogComponent,
    OutputFormComponent,
  ],
  template: `
    <div class="space-y-6">

      <!-- Header -->
      <div class="flex items-center justify-between flex-wrap gap-3">
        <div class="flex items-center gap-3">
          <h3 class="font-semibold">Outputs</h3>
          @if (ctx.isAirConfig()) {
            <app-sync-status-badge [state]="ctx.airConfigSyncState()" />
          }
        </div>
        @if (!showForm()) {
          <button class="btn btn-sm btn-primary" (click)="startAdd()">+ Add Output</button>
        }
      </div>

      <!-- Flash message -->
      @if (ctx.flashMessage()) {
        <div class="alert text-sm py-2 rounded-xl"
          [class.alert-error]="ctx.flashMessage()!.isError"
          [class.alert-success]="!ctx.flashMessage()!.isError">
          {{ ctx.flashMessage()!.text }}
        </div>
      }

      <!-- Add / Edit form -->
      @if (showForm()) {
        <div class="border border-base-300 rounded-xl bg-base-200/30">
          <div class="px-4 pt-4 text-sm font-semibold">
            {{ editingControl() ? 'Edit Output' : 'Add Output' }}
          </div>
          <app-output-form
            [existing]="editingControl() ?? undefined"
            [pinMap]="ctx.pinMapArray()"
            [usedPins]="usedPinsForForm()"
            (save)="onSave($event)"
            (cancel)="cancelForm()"
          />
        </div>
      }

      <!-- Output list -->
      <div class="space-y-3">
        @if (ctx.loading()) {
          <div class="flex justify-center py-8">
            <span class="loading loading-spinner loading-sm"></span>
          </div>
        } @else if (ctx.controls().length === 0) {
          <div class="text-sm text-base-content/60 py-6 text-center">
            No outputs configured. Click "+ Add Output" to add an actuator.
          </div>
        } @else {
          @for (ctrl of ctx.controls(); track ctrl.id) {
            <div class="flex items-center justify-between gap-3 rounded-xl border border-base-300 bg-base-100 px-4 py-3">
              <div class="flex items-center gap-3 min-w-0">
                <div class="min-w-0">
                  <p class="font-medium text-sm truncate">{{ ctrl.display_name || ctrl.control_key }}</p>
                  <div class="flex items-center gap-2 mt-0.5">
                    <span class="badge badge-ghost badge-xs">{{ actuatorLabel(ctrl.actuator_type) }}</span>
                    @if (ctrl.pin_index != null) {
                      <span class="badge badge-outline badge-xs">Pin {{ ctrl.pin_index }}</span>
                    }
                    @if (ctrl.pin2_index != null && ctrl.pin2_index !== 255) {
                      <span class="badge badge-outline badge-xs">Pin {{ ctrl.pin2_index }}</span>
                    }
                  </div>
                </div>
              </div>
              <div class="flex items-center gap-2 flex-shrink-0">
                <button class="btn btn-xs btn-ghost" (click)="startEdit(ctrl)">Edit</button>
                <button class="btn btn-xs btn-ghost text-error" (click)="confirmDelete(ctrl)">Delete</button>
              </div>
            </div>
          }
        }
      </div>

      <!-- Push to device (AirConfig only) -->
      @if (ctx.isAirConfig() && ctx.controls().length > 0) {
        <button
          class="btn btn-sm btn-outline btn-primary w-full"
          (click)="pushConfig()"
          [disabled]="pushing()"
        >
          @if (pushing()) { <span class="loading loading-spinner loading-xs"></span> Pushing… }
          @else { Push outputs to device }
        </button>
      }

      <!-- Delete confirmation -->
      <app-confirm-dialog
        [open]="!!deletingControl()"
        title="Delete output?"
        [message]="'Remove ' + (deletingControl()?.display_name || deletingControl()?.control_key || '') + '? This also removes its linked variable.'"
        confirmLabel="Delete"
        [dangerMode]="true"
        (confirmed)="executeDelete()"
        (cancelled)="deletingControl.set(null)"
      />

    </div>
  `,
})
export class OutputsTabComponent {
  protected ctx = inject(ConfigContextService);
  private api = inject(ApiService);

  showForm = signal(false);
  editingControl = signal<DeviceControl | null>(null);
  deletingControl = signal<DeviceControl | null>(null);
  pushing = signal(false);

  /**
   * All used pins (sensor + control), minus the current output's own pins.
   * Passed to OutputFormComponent so the pin selector correctly marks other
   * sensors' pins as occupied while allowing re-selection of the current output's pin.
   */
  usedPinsForForm = computed<Set<number>>(() => {
    const all = this.ctx.allUsedPins();
    const editing = this.editingControl();
    if (!editing) return all;
    // Remove the current output's own pins so they show as available for re-selection
    const without = new Set(all);
    if (editing.pin_index != null) without.delete(editing.pin_index);
    if (editing.pin2_index != null && editing.pin2_index !== 255) without.delete(editing.pin2_index);
    return without;
  });

  readonly ACTUATOR_LABELS: Record<number, string> = {
    0: 'Relay', 1: 'Motorized Valve', 2: 'Solenoid',
    3: 'PWM', 4: 'Servo', 5: 'DAC', 6: 'I2C PWM',
  };

  actuatorLabel(type?: number): string {
    return this.ACTUATOR_LABELS[type ?? 0] ?? 'Unknown';
  }

  startAdd(): void {
    this.editingControl.set(null);
    this.showForm.set(true);
  }

  startEdit(ctrl: DeviceControl): void {
    this.editingControl.set(ctrl);
    this.showForm.set(true);
  }

  cancelForm(): void {
    this.showForm.set(false);
    this.editingControl.set(null);
  }

  onSave(payload: Partial<DeviceControl>): void {
    const eui = this.ctx.eui();
    const editing = this.editingControl();
    const op$ = editing
      ? this.api.updateDeviceControl(editing.id, payload)
      : this.api.createDeviceControl({ ...payload, device_eui: eui });

    this.ctx.setSaving(true);
    op$.subscribe({
      next: () => {
        this.ctx.setSaving(false);
        this.cancelForm();
        this.ctx.reloadControls();
        this.ctx.reloadFields();
        this.ctx.flash(editing ? 'Output updated.' : 'Output added.');
      },
      error: (err) => {
        this.ctx.setSaving(false);
        this.ctx.flash(err?.error?.message ?? err?.message ?? 'Failed to save output', true);
      },
    });
  }

  confirmDelete(ctrl: DeviceControl): void {
    this.deletingControl.set(ctrl);
  }

  executeDelete(): void {
    const ctrl = this.deletingControl();
    if (!ctrl) return;
    this.deletingControl.set(null);
    this.api.deleteDeviceControl(ctrl.id).subscribe({
      next: () => {
        this.ctx.reloadControls();
        this.ctx.reloadFields();
        this.ctx.flash('Output deleted.');
      },
      error: (err) => this.ctx.flash(err?.message ?? 'Failed to delete output', true),
    });
  }

  pushConfig(): void {
    const eui = this.ctx.eui();
    if (!eui) return;
    this.pushing.set(true);
    this.api.pushConfig(eui).subscribe({
      next: () => {
        this.pushing.set(false);
        this.ctx.flash('Config pushed to device.');
        this.ctx.reloadAll();
      },
      error: (err) => {
        this.pushing.set(false);
        this.ctx.flash(err?.error?.message ?? 'Push failed', true);
      },
    });
  }
}
