import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';

import { ConfigContextService } from '../../../core/services/config-context.service';
import { ApiService } from '../../../core/services/api.service';
import { DeviceDecodeRule, DeviceSpec } from '../../../core/services/api.types';
import { ConfirmDialogComponent } from '../confirm-dialog/confirm-dialog.component';
import { DecodeRuleFormComponent } from './decode-rule-form.component';
import { CODEC_TEMPLATES } from '../../../core/utils/codec-templates';

/**
 * DecodeTabComponent — shown only for LoRaWAN codec devices.
 *
 * Provides:
 *  - Template picker: apply a predefined codec spec (fields + decode rules)
 *  - JSON import: paste a DeviceSpec JSON to provision the device
 *  - Decode rule CRUD (add/edit/delete per fPort)
 *  - Test decode panel (paste hex payload, see decoded output)
 */
@Component({
  selector: 'app-decode-tab',
  standalone: true,
  imports: [FormsModule, CommonModule, ConfirmDialogComponent, DecodeRuleFormComponent],
  template: `
    <div class="space-y-6">

      <!-- Template picker -->
      <div class="border border-base-300 rounded-xl bg-base-200/30 p-4 space-y-3">
        <p class="text-sm font-semibold">Apply a codec template</p>
        <p class="text-xs text-base-content/60">
          Select a known device type to provision fields, decode rules, and visualizations in one step.
          This will replace all existing configuration.
        </p>
        <div class="flex flex-wrap gap-3 items-end">
          <div class="form-control flex-1 min-w-48">
            <label class="label text-xs py-0.5">Template</label>
            <select class="select select-bordered select-sm" [(ngModel)]="selectedTemplateId">
              <option value="">— choose a template —</option>
              @for (t of templates; track t.id) {
                <option [value]="t.id">{{ t.name }}</option>
              }
            </select>
          </div>
          <button class="btn btn-sm btn-primary"
            [disabled]="!selectedTemplateId || applyingSpec()"
            (click)="confirmApplyTemplate()">
            @if (applyingSpec()) { <span class="loading loading-spinner loading-xs"></span> }
            Apply template
          </button>
        </div>
      </div>

      <!-- JSON import -->
      <div class="border border-base-300 rounded-xl bg-base-200/30 p-4 space-y-3">
        <button class="flex items-center gap-2 text-sm font-semibold w-full text-left"
          (click)="jsonImportOpen.set(!jsonImportOpen())">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 transition-transform"
            [class.rotate-90]="jsonImportOpen()"
            fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
          </svg>
          Import codec spec (JSON)
        </button>
        @if (jsonImportOpen()) {
          <p class="text-xs text-base-content/60">
            Paste a full <code>DeviceSpec</code> JSON object. This will replace all existing fields, outputs, decode rules, and visualizations.
          </p>
          <textarea class="textarea textarea-bordered textarea-sm font-mono text-xs w-full h-36"
            [(ngModel)]="importJson"
            placeholder='{ "type": "codec", "fields": [...], "decode_rules": [...], ... }'>
          </textarea>
          @if (importJsonError()) {
            <p class="text-xs text-error">{{ importJsonError() }}</p>
          }
          <button class="btn btn-sm btn-outline"
            [disabled]="!importJson.trim() || applyingSpec()"
            (click)="confirmImportJson()">
            @if (applyingSpec()) { <span class="loading loading-spinner loading-xs"></span> }
            Import
          </button>
        }
      </div>

      <!-- Header for manual rules -->
      <div class="flex justify-between items-center">
        <p class="text-sm font-semibold">Decode rules</p>
        @if (!showForm()) {
          <button class="btn btn-sm btn-primary" (click)="startAdd()">+ Add rule</button>
        }
      </div>

      <!-- Add / Edit form -->
      @if (showForm()) {
        <div class="border border-base-300 rounded-xl bg-base-200/30">
          <div class="px-4 pt-4 text-sm font-semibold">
            {{ editingRule() ? 'Edit Decode Rule' : 'Add Decode Rule' }}
          </div>
          <app-decode-rule-form
            [existing]="editingRule() ?? undefined"
            (save)="onSave($event)"
            (cancel)="cancelForm()"
          />
        </div>
      }

      <!-- Rules table -->
      @if (ctx.decodeRules().length === 0) {
        <div class="text-sm text-base-content/60 py-4 text-center">
          No decode rules configured. Apply a template or add rules manually.
        </div>
      } @else {
        <div class="overflow-x-auto">
          <table class="table table-sm">
            <thead>
              <tr>
                <th>fPort</th>
                <th>Format</th>
                <th>Config</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              @for (rule of ctx.decodeRules(); track rule.id) {
                <tr>
                  <td class="font-mono">{{ rule.fport }}</td>
                  <td class="text-xs font-mono">{{ rule.format }}</td>
                  <td class="text-xs font-mono text-base-content/60 max-w-64 truncate">
                    {{ configSummary(rule.config) }}
                  </td>
                  <td class="text-right">
                    <button class="btn btn-xs btn-ghost" (click)="startEdit(rule)">Edit</button>
                    <button class="btn btn-xs btn-ghost text-error" (click)="confirmDelete(rule)">Delete</button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }

      <!-- Test decode panel -->
      <div class="border border-base-300 rounded-xl bg-base-200/30 p-4 space-y-3">
        <p class="text-sm font-semibold">Test Decode</p>
        <p class="text-xs text-base-content/60">Paste a hex payload to simulate decoding against the current rules.</p>
        <div class="flex flex-wrap gap-3 items-end">
          <div class="form-control">
            <label class="label text-xs py-0.5">fPort</label>
            <input type="number" class="input input-bordered input-sm w-20"
              [(ngModel)]="testFport" min="1" max="223" />
          </div>
          <div class="form-control flex-1 min-w-40">
            <label class="label text-xs py-0.5">Payload (hex)</label>
            <input type="text" class="input input-bordered input-sm font-mono"
              [(ngModel)]="testPayload" placeholder="0100 3f80 0000 ..." />
          </div>
          <button class="btn btn-sm btn-outline" (click)="runTest()" [disabled]="testRunning()">
            @if (testRunning()) { <span class="loading loading-spinner loading-xs"></span> }
            Decode
          </button>
        </div>
        @if (testError()) {
          <div class="alert alert-error text-xs py-2">{{ testError() }}</div>
        }
        @if (testResult() !== null) {
          <pre class="bg-base-300 rounded-lg p-3 text-xs font-mono overflow-x-auto">{{ testResult() | json }}</pre>
        }
      </div>

      <!-- Delete rule confirmation -->
      <app-confirm-dialog
        [open]="!!deletingRule()"
        title="Delete decode rule?"
        [message]="'Remove rule for fPort ' + (deletingRule()?.fport ?? '') + '?'"
        confirmLabel="Delete"
        [dangerMode]="true"
        (confirmed)="executeDelete()"
        (cancelled)="deletingRule.set(null)"
      />

      <!-- Apply spec confirmation (template or JSON import) -->
      <app-confirm-dialog
        [open]="!!pendingSpec()"
        title="Replace device configuration?"
        message="This will replace all existing fields, outputs, decode rules, and visualizations. This cannot be undone."
        confirmLabel="Apply"
        [dangerMode]="true"
        (confirmed)="executeApplySpec()"
        (cancelled)="pendingSpec.set(null)"
      />

    </div>
  `,
})
export class DecodeTabComponent {
  protected ctx = inject(ConfigContextService);
  private api = inject(ApiService);

  readonly templates = CODEC_TEMPLATES;

  // ─── Manual rule CRUD ───────────────────────────────────────────────────────
  showForm = signal(false);
  editingRule = signal<DeviceDecodeRule | null>(null);
  deletingRule = signal<DeviceDecodeRule | null>(null);

  startAdd(): void { this.editingRule.set(null); this.showForm.set(true); }
  startEdit(rule: DeviceDecodeRule): void { this.editingRule.set(rule); this.showForm.set(true); }
  cancelForm(): void { this.showForm.set(false); this.editingRule.set(null); }

  onSave(payload: Partial<DeviceDecodeRule>): void {
    const eui = this.ctx.eui();
    const editing = this.editingRule();
    const op$ = editing
      ? this.api.updateDeviceDecodeRule(editing.id, payload)
      : this.api.createDeviceDecodeRule({ ...payload, device_eui: eui });

    op$.subscribe({
      next: () => {
        this.cancelForm();
        this.ctx.reloadDecodeRules();
        this.ctx.flash(editing ? 'Rule updated.' : 'Rule added.');
      },
      error: (err) => this.ctx.flash(err?.message ?? 'Failed to save rule', true),
    });
  }

  confirmDelete(rule: DeviceDecodeRule): void { this.deletingRule.set(rule); }

  executeDelete(): void {
    const rule = this.deletingRule();
    if (!rule) return;
    this.deletingRule.set(null);
    this.api.deleteDeviceDecodeRule(rule.id).subscribe({
      next: () => { this.ctx.reloadDecodeRules(); this.ctx.flash('Rule deleted.'); },
      error: (err) => this.ctx.flash(err?.message ?? 'Failed to delete rule', true),
    });
  }

  configSummary(config: Record<string, unknown>): string {
    try { return JSON.stringify(config); } catch { return '…'; }
  }

  // ─── Template apply ─────────────────────────────────────────────────────────
  selectedTemplateId = '';

  confirmApplyTemplate(): void {
    const tpl = this.templates.find(t => t.id === this.selectedTemplateId);
    if (!tpl) return;
    this.pendingSpec.set(tpl.spec);
  }

  // ─── JSON import ────────────────────────────────────────────────────────────
  jsonImportOpen = signal(false);
  importJson = '';
  importJsonError = signal<string | null>(null);

  confirmImportJson(): void {
    this.importJsonError.set(null);
    let spec: DeviceSpec;
    try {
      spec = JSON.parse(this.importJson);
    } catch {
      this.importJsonError.set('Invalid JSON');
      return;
    }
    this.pendingSpec.set(spec);
  }

  // ─── Shared apply-spec flow ─────────────────────────────────────────────────
  pendingSpec = signal<DeviceSpec | null>(null);
  applyingSpec = signal(false);

  executeApplySpec(): void {
    const spec = this.pendingSpec();
    const eui = this.ctx.eui();
    if (!spec || !eui) return;
    this.pendingSpec.set(null);
    this.applyingSpec.set(true);
    this.api.applyDeviceSpec(eui, spec).subscribe({
      next: () => {
        this.applyingSpec.set(false);
        this.importJson = '';
        this.selectedTemplateId = '';
        this.jsonImportOpen.set(false);
        this.ctx.reloadAll();
        this.ctx.flash('Configuration applied.');
      },
      error: (err) => {
        this.applyingSpec.set(false);
        this.ctx.flash(err?.error?.message ?? err?.message ?? 'Failed to apply spec', true);
      },
    });
  }

  // ─── Test decode ─────────────────────────────────────────────────────────────
  testFport = 1;
  testPayload = '';
  testRunning = signal(false);
  testResult = signal<Record<string, unknown> | null>(null);
  testError = signal<string | null>(null);

  runTest(): void {
    const eui = this.ctx.eui();
    if (!eui) return;
    this.testRunning.set(true);
    this.testResult.set(null);
    this.testError.set(null);

    this.api.getDeviceSpec(eui).subscribe({
      next: (spec) => {
        this.api.testDecode(spec, this.testFport, this.testPayload).subscribe({
          next: (res) => {
            this.testRunning.set(false);
            this.testResult.set(res as Record<string, unknown>);
          },
          error: (err) => {
            this.testRunning.set(false);
            this.testError.set(err?.error?.message ?? err?.message ?? 'Decode failed');
          },
        });
      },
      error: (err) => {
        this.testRunning.set(false);
        this.testError.set(err?.message ?? 'Failed to load device spec');
      },
    });
  }
}
