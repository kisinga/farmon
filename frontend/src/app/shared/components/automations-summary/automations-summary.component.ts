import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';

import { DeviceRuleRecord, DeviceField, DeviceControl } from '../../../core/services/api.types';
import { fieldIndexToLabel } from '../../../core/utils/firmware-constraints';

/**
 * AutomationsSummaryComponent — read-only rule summary for the monitoring page.
 *
 * Shows a table of all rules with natural-language descriptions.
 * Links to the config page automations tab for editing.
 * Does NOT use DeviceAutomationsSectionComponent — simpler display-only component.
 */
@Component({
  selector: 'app-automations-summary',
  standalone: true,
  imports: [RouterLink, CommonModule],
  template: `
    <div class="space-y-4">
      <div class="flex items-center justify-between gap-3">
        <h2 class="section-title">Automations</h2>
        <a [routerLink]="['/device', eui(), 'config']" [queryParams]="{ tab: 'automations' }"
          class="btn btn-xs btn-outline btn-primary">
          Edit automations →
        </a>
      </div>

      @if (rules().length === 0) {
        <p class="text-sm text-base-content/60">
          No on-device automation rules. They provide instant, offline-capable control.
          <a [routerLink]="['/device', eui(), 'config']" [queryParams]="{ tab: 'automations' }"
            class="link link-primary ml-1">Configure automations →</a>
        </p>
      } @else {
        <div class="overflow-x-auto">
          <table class="table table-sm">
            <thead>
              <tr>
                <th>#</th>
                <th>Condition</th>
                <th>Action</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              @for (r of rules(); track r.id) {
                <tr [class.opacity-50]="r.enabled === false">
                  <td class="font-mono text-xs text-base-content/50">{{ r.rule_id }}</td>
                  <td class="text-sm">
                    <span class="font-medium">{{ fieldLabel(r.field_idx) }}</span>
                    <span class="font-mono text-primary mx-1">{{ r.operator }}</span>
                    <span>{{ r.threshold }}</span>
                  </td>
                  <td class="text-sm">
                    set <span class="font-medium">{{ controlLabel(r.control_idx) }}</span>
                    → <span class="font-medium">{{ stateLabel(r.control_idx, r.action_state) }}</span>
                  </td>
                  <td>
                    @if (r.synced_at) {
                      <span class="badge badge-xs badge-success">synced</span>
                    } @else {
                      <span class="badge badge-xs badge-warning">not synced</span>
                    }
                    @if (r.enabled === false) {
                      <span class="badge badge-xs badge-ghost ml-1">disabled</span>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </div>
  `,
})
export class AutomationsSummaryComponent {
  eui = input.required<string>();
  rules = input<DeviceRuleRecord[]>([]);
  fields = input<DeviceField[]>([]);
  controls = input<DeviceControl[]>([]);

  fieldLabel(idx: number): string {
    return fieldIndexToLabel(this.fields(), idx);
  }

  controlLabel(idx: number): string {
    const c = this.controls().find((x, i) => (x.control_idx ?? i) === idx);
    return c ? (c.display_name || c.control_key) : `control #${idx}`;
  }

  stateLabel(controlIdx: number, stateIdx: number): string {
    const c = this.controls().find((x, i) => (x.control_idx ?? i) === controlIdx);
    if (c?.states_json && c.states_json[stateIdx] !== undefined) return c.states_json[stateIdx];
    return String(stateIdx);
  }
}
