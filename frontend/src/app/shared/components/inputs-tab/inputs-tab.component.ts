import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

import { ConfigContextService } from '../../../core/services/config-context.service';
import { ApiService } from '../../../core/services/api.service';
import { DeviceSensorConfigComponent } from '../device-sensor-config/device-sensor-config.component';
import { FieldBudgetIndicatorComponent } from '../field-budget-indicator/field-budget-indicator.component';
import { SyncStatusBadgeComponent } from '../sync-status-badge/sync-status-badge.component';

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
          (click)="showWizard.set(!showWizard())"
          [disabled]="!ctx.eui()"
        >
          {{ showWizard() ? 'Cancel' : '+ Add Input' }}
        </button>
      </div>

      <!-- Add sensor wizard -->
      @if (showWizard()) {
        <div class="border border-base-300 rounded-xl bg-base-200/30 p-4">
          <h3 class="text-sm font-semibold mb-4">Add Input Sensor</h3>
          <app-device-sensor-config
            [eui]="ctx.eui()"
            [fieldConfigs]="ctx.inputVariables()"
            [pinMap]="ctx.pinMapArray()"
            [usedPins]="ctx.allUsedPins()"
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
                  <p class="font-mono text-xs text-base-content/50">{{ v.field_key }}
                    @if (v.field_idx != null) {
                      <span class="ml-1 text-base-content/30">· f{{ v.field_idx }}</span>
                    }
                  </p>
                </div>
              </div>
              <div class="flex items-center gap-3 flex-shrink-0">
                @if (v.unit) {
                  <span class="badge badge-ghost badge-sm">{{ v.unit }}</span>
                }
                <select
                  class="select select-bordered select-xs"
                  [value]="v.report_mode ?? 'reported'"
                  (change)="onReportModeChange(v.id, $any($event.target).value)"
                  [disabled]="savingFieldId() === v.id"
                >
                  <option value="reported">Reported</option>
                  <option value="disabled">Disabled</option>
                </select>
              </div>
            </div>
          }
        }
      </div>

    </div>
  `,
})
export class InputsTabComponent {
  protected ctx = inject(ConfigContextService);
  private api = inject(ApiService);

  showWizard = signal(false);
  savingFieldId = signal<string | null>(null);

  onSensorSaved(): void {
    this.showWizard.set(false);
    this.ctx.reloadFields();
    this.ctx.reloadDeviceSpec();
  }

  onReportModeChange(fieldId: string, mode: string): void {
    this.savingFieldId.set(fieldId);
    this.api.updateDeviceField(fieldId, { report_mode: mode as 'reported' | 'disabled' }).subscribe({
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
