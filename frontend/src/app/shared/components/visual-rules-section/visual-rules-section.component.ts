import { Component, ViewChild, signal, computed, inject, input, effect } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { forkJoin, Observable } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import type { DeviceField, DeviceControl, DeviceRuleRecord } from '../../../core/services/api.types';
import { DrawflowEditorComponent } from './drawflow-editor.component';
import {
  VisualNodeData, SensorNodeData, CompareNodeData, LogicGateNodeData,
  ActionNodeData, TimeWindowNodeData, OPERATORS,
} from './visual-rules.types';

@Component({
  selector: 'app-visual-rules-section',
  standalone: true,
  imports: [FormsModule, DrawflowEditorComponent],
  template: `
    <!-- Toolbar -->
    <div class="flex flex-wrap items-center gap-2 mb-3">
      <button class="btn btn-sm btn-primary" (click)="saveRules()" [disabled]="saving() || validationErrors().length > 0">
        {{ saving() ? 'Saving\u2026' : 'Save' }}
      </button>
      <button class="btn btn-sm btn-outline" (click)="pushRules()" [disabled]="pushing()">
        {{ pushing() ? 'Pushing\u2026' : 'Push to device' }}
      </button>
      <button class="btn btn-sm btn-ghost" (click)="reload()">Reload</button>
    </div>

    <!-- Messages -->
    @if (message()) {
      <div class="alert text-sm rounded-xl mb-3" [class.alert-error]="msgIsError()" [class.alert-success]="!msgIsError()">
        <span>{{ message() }}</span>
        <button class="btn btn-xs btn-ghost" (click)="message.set('')">&times;</button>
      </div>
    }
    @if (validationErrors().length > 0) {
      <div class="alert alert-warning text-sm rounded-xl mb-3">
        <ul class="list-disc list-inside">
          @for (err of validationErrors(); track err) { <li>{{ err }}</li> }
        </ul>
      </div>
    }

    <!-- Canvas + properties panel -->
    <div class="flex gap-4">
      <div class="flex-1 min-w-0">
        <app-drawflow-editor
          #editorRef
          [fields]="fieldOptions()"
          [controls]="controlOptions()"
          [initialRules]="rules()"
          (nodeSelected)="selectedNode.set($event)"
          (graphChanged)="onGraphChanged()" />
      </div>

      <!-- Properties panel — reads from signal directly, not an alias -->
      @if (selectedNode()) {
        <div class="w-64 shrink-0">
          <div class="card bg-base-100 border border-base-300 shadow-sm">
            <div class="card-body p-4 gap-3">
              <div class="flex items-center justify-between">
                <h3 class="font-semibold text-sm">Properties</h3>
                <button class="btn btn-xs btn-ghost btn-square text-error" (click)="deleteSelectedNode()">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                </button>
              </div>

              @switch (selType()) {
                @case ('sensor') {
                  <label class="form-control">
                    <span class="label text-xs font-medium py-0 pb-1">Field</span>
                    <select class="select select-bordered select-xs"
                            [ngModel]="selSensor().field_idx"
                            (ngModelChange)="updateSensorField($event)">
                      @for (f of fieldOptions(); track $index) {
                        <option [ngValue]="f.field_idx">{{ f.display_name || f.field_key }}</option>
                      }
                    </select>
                  </label>
                }
                @case ('compare') {
                  <label class="form-control">
                    <span class="label text-xs font-medium py-0 pb-1">Operator</span>
                    <select class="select select-bordered select-xs"
                            [ngModel]="selCompare().operator"
                            (ngModelChange)="updateField('operator', $event)">
                      @for (op of operators; track $index) {
                        <option [value]="op">{{ op }}</option>
                      }
                    </select>
                  </label>
                  <label class="form-control">
                    <span class="label text-xs font-medium py-0 pb-1">Threshold</span>
                    <input type="number" class="input input-bordered input-xs"
                           [ngModel]="selCompare().threshold"
                           (ngModelChange)="updateField('threshold', $event)"
                           [step]="selCompare().is_primary ? 0.1 : 1"
                           [min]="selCompare().is_primary ? null : 0"
                           [max]="selCompare().is_primary ? null : 255" />
                  </label>
                  <label class="label cursor-pointer gap-2 py-0">
                    <span class="text-xs">Primary</span>
                    <input type="checkbox" class="toggle toggle-xs toggle-primary"
                           [ngModel]="selCompare().is_primary"
                           (ngModelChange)="updateField('is_primary', $event)" />
                  </label>
                  <label class="label cursor-pointer gap-2 py-0">
                    <span class="text-xs">Control state</span>
                    <input type="checkbox" class="toggle toggle-xs"
                           [ngModel]="selCompare().is_control"
                           (ngModelChange)="updateField('is_control', $event)" />
                  </label>
                }
                @case ('logic_gate') {
                  <div class="form-control">
                    <span class="label text-xs font-medium py-0 pb-1">Logic</span>
                    <div class="join">
                      <button class="join-item btn btn-xs"
                              [class.btn-primary]="selLogic().logic === 'and'"
                              (click)="updateField('logic', 'and')">AND</button>
                      <button class="join-item btn btn-xs"
                              [class.btn-primary]="selLogic().logic === 'or'"
                              (click)="updateField('logic', 'or')">OR</button>
                    </div>
                  </div>
                }
                @case ('action') {
                  <label class="form-control">
                    <span class="label text-xs font-medium py-0 pb-1">Control</span>
                    <select class="select select-bordered select-xs"
                            [ngModel]="selAction().control_idx"
                            (ngModelChange)="updateActionControl($event)">
                      @for (c of controlOptions(); track $index) {
                        <option [ngValue]="c.control_idx">{{ c.display_name || c.control_key }}</option>
                      }
                    </select>
                  </label>
                  <label class="form-control">
                    <span class="label text-xs font-medium py-0 pb-1">State</span>
                    <input type="number" class="input input-bordered input-xs" min="0" max="255"
                           [ngModel]="selAction().action_state"
                           (ngModelChange)="updateField('action_state', $event)" />
                  </label>
                  <label class="form-control">
                    <span class="label text-xs font-medium py-0 pb-1">Priority</span>
                    <input type="number" class="input input-bordered input-xs" min="0" max="255"
                           [ngModel]="selAction().priority"
                           (ngModelChange)="updateField('priority', $event)" />
                  </label>
                  <label class="form-control">
                    <span class="label text-xs font-medium py-0 pb-1">Cooldown (s)</span>
                    <input type="number" class="input input-bordered input-xs" min="0"
                           [ngModel]="selAction().cooldown_seconds"
                           (ngModelChange)="updateField('cooldown_seconds', $event)" />
                  </label>
                  <label class="form-control">
                    <span class="label text-xs font-medium py-0 pb-1">Duration (x10s)</span>
                    <input type="number" class="input input-bordered input-xs" min="0" max="255"
                           [ngModel]="selAction().action_dur_x10s"
                           (ngModelChange)="updateField('action_dur_x10s', $event)" />
                  </label>
                  <label class="label cursor-pointer gap-2 py-0">
                    <span class="text-xs">Enabled</span>
                    <input type="checkbox" class="toggle toggle-xs toggle-success"
                           [ngModel]="selAction().enabled"
                           (ngModelChange)="updateField('enabled', $event)" />
                  </label>
                }
                @case ('time_window') {
                  <label class="form-control">
                    <span class="label text-xs font-medium py-0 pb-1">Start hour</span>
                    <input type="number" class="input input-bordered input-xs" min="0" max="23"
                           [ngModel]="selTimeWindow().time_start"
                           (ngModelChange)="updateField('time_start', $event)" />
                  </label>
                  <label class="form-control">
                    <span class="label text-xs font-medium py-0 pb-1">End hour</span>
                    <input type="number" class="input input-bordered input-xs" min="0" max="23"
                           [ngModel]="selTimeWindow().time_end"
                           (ngModelChange)="updateField('time_end', $event)" />
                  </label>
                }
              }
            </div>
          </div>
        </div>
      }
    </div>
  `,
})
export class VisualRulesSectionComponent {
  @ViewChild('editorRef') editorRef!: DrawflowEditorComponent;

  eui = input.required<string>();
  fields = input<DeviceField[]>([]);
  controls = input<DeviceControl[]>([]);

  private api = inject(ApiService);

  rules = signal<DeviceRuleRecord[]>([]);
  selectedNode = signal<{ id: number; data: VisualNodeData } | null>(null);
  validationErrors = signal<string[]>([]);
  message = signal('');
  msgIsError = signal(false);
  saving = signal(false);
  pushing = signal(false);

  operators = OPERATORS;

  // Map fields/controls to guaranteed indices, matching the automation tab's fallback pattern
  fieldOptions = computed(() => this.fields().map((f, i) => ({ ...f, field_idx: f.field_idx ?? i })));
  controlOptions = computed(() => this.controls().map((c, i) => ({ ...c, control_idx: c.control_idx ?? i })));

  // Computed accessors that read directly from the signal — always fresh, no stale alias
  selType = computed(() => this.selectedNode()?.data.type ?? '');
  selSensor = computed(() => (this.selectedNode()?.data ?? { type: 'sensor', field_idx: 0, label: '' }) as SensorNodeData);
  selCompare = computed(() => (this.selectedNode()?.data ?? { type: 'compare', operator: '>', threshold: 0, is_primary: true, is_control: false }) as CompareNodeData);
  selLogic = computed(() => (this.selectedNode()?.data ?? { type: 'logic_gate', logic: 'and' }) as LogicGateNodeData);
  selAction = computed(() => (this.selectedNode()?.data ?? { type: 'action', control_idx: 0, action_state: 0, priority: 128, cooldown_seconds: 300, enabled: true, action_dur_x10s: 0, label: '' }) as ActionNodeData);
  selTimeWindow = computed(() => (this.selectedNode()?.data ?? { type: 'time_window', time_start: 6, time_end: 18 }) as TimeWindowNodeData);

  constructor() {
    effect(() => {
      const eui = this.eui();
      if (eui) this.loadRules(eui);
    });
  }

  reload(): void { this.loadRules(this.eui()); }

  // ── Save & Push ──

  saveRules(): void {
    const eui = this.eui();
    if (!this.editorRef || !eui) return;
    const { rules: newRules, errors } = this.editorRef.exportRules(eui);
    if (errors.length) { this.validationErrors.set(errors); return; }

    this.saving.set(true);
    const existing = this.rules();
    const toDelete = existing.filter(er => !newRules.some(nr => nr.rule_id === er.rule_id));
    const ops: Observable<unknown>[] = [];

    for (const del of toDelete) ops.push(this.api.deleteDeviceRule(del.id));
    for (const nr of newRules) {
      const ex = existing.find(er => er.rule_id === nr.rule_id);
      ops.push(ex ? this.api.updateDeviceRule(ex.id, nr) : this.api.createDeviceRule(nr));
    }

    if (!ops.length) {
      this.saving.set(false);
      this.showMsg('No changes to save', false);
      return;
    }

    forkJoin(ops).subscribe({
      next: () => {
        this.saving.set(false);
        this.showMsg(`Saved ${newRules.length} rule(s)`, false);
        this.loadRules(eui);
      },
      error: (e) => { this.saving.set(false); this.showMsg(`Save failed: ${e.message}`, true); },
    });
  }

  pushRules(): void {
    const eui = this.eui();
    if (!eui) return;
    this.pushing.set(true);
    this.api.pushDeviceRules(eui).subscribe({
      next: (res) => { this.pushing.set(false); this.showMsg(`Pushed ${res.rules_pushed} rule(s)`, false); },
      error: (e) => { this.pushing.set(false); this.showMsg(`Push failed: ${e.message}`, true); },
    });
  }

  onGraphChanged(): void {
    const eui = this.eui();
    if (this.editorRef && eui) {
      this.validationErrors.set(this.editorRef.exportRules(eui).errors);
    }
  }

  deleteSelectedNode(): void {
    const sel = this.selectedNode();
    if (!sel || !this.editorRef) return;
    this.editorRef.removeNodeById(sel.id);
    this.selectedNode.set(null);
  }

  // ── Property updates ──

  updateSensorField(fieldIdx: number): void {
    const sel = this.selectedNode();
    if (!sel) return;
    const f = this.fieldOptions().find(f => f.field_idx === fieldIdx);
    this.applyUpdate(sel.id, {
      ...sel.data, field_idx: fieldIdx,
      label: f ? (f.display_name || f.field_key) : `Field ${fieldIdx}`,
    } as SensorNodeData);
  }

  updateActionControl(controlIdx: number): void {
    const sel = this.selectedNode();
    if (!sel) return;
    const c = this.controlOptions().find(c => c.control_idx === controlIdx);
    this.applyUpdate(sel.id, {
      ...sel.data, control_idx: controlIdx,
      label: c ? (c.display_name || c.control_key) : `Control ${controlIdx}`,
    } as ActionNodeData);
  }

  updateField(field: string, value: unknown): void {
    const sel = this.selectedNode();
    if (!sel) return;
    this.applyUpdate(sel.id, { ...sel.data, [field]: value } as VisualNodeData);
  }

  // ── Private ──

  private applyUpdate(id: number, data: VisualNodeData): void {
    this.editorRef.updateNodeData(id, data);
    this.selectedNode.set({ id, data });
  }

  private loadRules(eui: string): void {
    this.selectedNode.set(null);
    this.validationErrors.set([]);
    this.message.set('');
    this.api.getDeviceRules(eui).subscribe({
      next: (rules) => this.rules.set(rules),
      error: (e) => this.showMsg(`Failed to load rules: ${e.message}`, true),
    });
  }

  private showMsg(msg: string, isError: boolean): void {
    this.message.set(msg);
    this.msgIsError.set(isError);
  }
}
