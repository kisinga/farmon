import { Component, input, signal, effect, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, EdgeRuleRecord } from '../../../core/services/api.service';

@Component({
  selector: 'app-edge-rules-section',
  standalone: true,
  template: `
    <div class="space-y-2">
      <h3 class="text-lg font-semibold">Edge rules</h3>
      @if (message()) {
        <p class="text-sm" [class.text-error]="isError()" [class.text-success]="!isError()">{{ message() }}</p>
      }
      <div class="overflow-x-auto">
        <table class="table table-xs">
          <thead>
            <tr>
              <th>Rule</th>
              <th>Field</th>
              <th>Op</th>
              <th>Threshold</th>
              <th>Control</th>
              <th>Action</th>
              <th>Enabled</th>
            </tr>
          </thead>
          <tbody>
            @for (r of rules(); track r.id) {
              <tr>
                <td>{{ r.rule_id }}</td>
                <td>{{ r.field_idx }}</td>
                <td>{{ r.operator }}</td>
                <td>{{ r.threshold }}</td>
                <td>{{ r.control_idx }}</td>
                <td>{{ r.action_state }}</td>
                <td>{{ r.enabled !== false ? 'Yes' : 'No' }}</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      @if (rules().length === 0 && !loading()) {
        <p class="text-sm text-base-content/60">No edge rules. Add one below.</p>
      }
      <div class="rounded-lg border border-base-300 bg-base-100 p-3 space-y-2">
        <h4 class="text-sm font-medium">Add rule</h4>
        <div class="flex flex-wrap gap-2 items-end">
          <div class="form-control">
            <label class="label text-xs">Field idx</label>
            <input type="number" class="input input-bordered input-sm w-20" [(ngModel)]="form.field_idx" min="0" />
          </div>
          <div class="form-control">
            <label class="label text-xs">Operator</label>
            <select class="select select-bordered select-sm w-24" [(ngModel)]="form.operator">
              <option value="<">&lt;</option>
              <option value=">">&gt;</option>
              <option value="<=">&lt;=</option>
              <option value=">=">&gt;=</option>
              <option value="==">==</option>
            </select>
          </div>
          <div class="form-control">
            <label class="label text-xs">Threshold</label>
            <input type="number" class="input input-bordered input-sm w-24" [(ngModel)]="form.threshold" step="any" />
          </div>
          <div class="form-control">
            <label class="label text-xs">Control idx</label>
            <input type="number" class="input input-bordered input-sm w-20" [(ngModel)]="form.control_idx" min="0" />
          </div>
          <div class="form-control">
            <label class="label text-xs">Action state</label>
            <input type="number" class="input input-bordered input-sm w-20" [(ngModel)]="form.action_state" min="0" />
          </div>
          <div class="form-control">
            <label class="label text-xs">Priority</label>
            <input type="number" class="input input-bordered input-sm w-20" [(ngModel)]="form.priority" />
          </div>
          <div class="form-control">
            <label class="label text-xs">Cooldown (s)</label>
            <input type="number" class="input input-bordered input-sm w-24" [(ngModel)]="form.cooldown_seconds" min="0" />
          </div>
          <button type="button" class="btn btn-sm btn-primary" (click)="addRule()" [disabled]="saving()">Add</button>
        </div>
      </div>
    </div>
  `,
  imports: [FormsModule],
})
export class EdgeRulesSectionComponent {
  private api = inject(ApiService);

  eui = input.required<string>();
  rules = signal<EdgeRuleRecord[]>([]);
  loading = signal(false);
  saving = signal(false);
  message = signal<string | null>(null);
  isError = signal(false);

  form = {
    field_idx: 0,
    operator: '<',
    threshold: 0,
    control_idx: 0,
    action_state: 0,
    priority: 128,
    cooldown_seconds: 300,
    enabled: true,
  };

  constructor() {
    effect(() => {
      const eui = this.eui();
      if (!eui) {
        this.rules.set([]);
        return;
      }
      this.loading.set(true);
      this.api.getEdgeRules(eui).subscribe({
        next: (list) => {
          this.rules.set(list);
          this.loading.set(false);
        },
        error: () => {
          this.rules.set([]);
          this.loading.set(false);
        },
      });
    });
  }

  addRule(): void {
    const eui = this.eui();
    if (!eui) return;
    this.saving.set(true);
    this.message.set(null);
    const record = {
      device_eui: eui,
      rule_id: this.rules().length,
      field_idx: this.form.field_idx,
      operator: this.form.operator,
      threshold: this.form.threshold,
      control_idx: this.form.control_idx,
      action_state: this.form.action_state,
      priority: this.form.priority,
      cooldown_seconds: this.form.cooldown_seconds,
      enabled: this.form.enabled,
    };
    this.api.createEdgeRule(record).subscribe({
      next: () => {
        this.isError.set(false);
        this.message.set('Rule added.');
        this.saving.set(false);
        this.api.getEdgeRules(eui).subscribe((list) => this.rules.set(list));
      },
      error: (err) => {
        this.isError.set(true);
        this.message.set(err?.error?.message ?? err?.message ?? 'Failed to add rule');
        this.saving.set(false);
      },
    });
  }
}
