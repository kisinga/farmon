import { Component, input, output, signal, computed, inject, effect } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';

import { ApiService } from '../../../core/services/api.service';
import { ConfigContextService } from '../../../core/services/config-context.service';
import { DeviceVariable } from '../../../core/services/api.types';
import {
  RecipeType, RECIPE_TEMPLATES,
  recipeToExpression, parseAndValidate, humanize, estimateBytecodeSize,
  FUNCTION_CATALOG, parse,
} from '../../../core/utils/compute-expression';
import { VariableSelectorComponent } from '../variable-selector/variable-selector.component';

@Component({
  selector: 'app-compute-variable-editor',
  standalone: true,
  imports: [FormsModule, CommonModule, VariableSelectorComponent],
  template: `
    <div class="space-y-4">

      <!-- Name & Unit -->
      <div class="grid grid-cols-2 gap-3">
        <div class="form-control">
          <label class="label text-xs py-0.5">Display Name</label>
          <input type="text" class="input input-bordered input-sm"
            [(ngModel)]="displayName" placeholder="e.g. Temp Fahrenheit" />
        </div>
        <div class="form-control">
          <label class="label text-xs py-0.5">Unit</label>
          <input type="text" class="input input-bordered input-sm"
            [(ngModel)]="unit" placeholder="e.g. °F, L/min" />
        </div>
      </div>

      <!-- Recipe picker -->
      <div>
        <label class="label text-xs py-0.5">Recipe</label>
        <div class="flex flex-wrap gap-1.5">
          @for (r of recipes; track r.id) {
            <button class="btn btn-xs"
              [class.btn-primary]="selectedRecipe() === r.id"
              [class.btn-ghost]="selectedRecipe() !== r.id"
              (click)="selectedRecipe.set(r.id)">
              {{ r.label }}
            </button>
          }
        </div>
      </div>

      <!-- Recipe-specific forms -->
      @switch (selectedRecipe()) {

        @case ('unit_conversion') {
          <div class="grid grid-cols-3 gap-3">
            <div class="form-control">
              <label class="label text-xs py-0.5">Source</label>
              <app-variable-selector
                [variables]="ctx.fields()"
                [selectedKey]="sourceFieldKey()"
                [showIndex]="true"
                [filterFn]="nonComputeFilter"
                placeholder="Select source…"
                (selected)="onSourceSelected($event)"
              />
            </div>
            <div class="form-control">
              <label class="label text-xs py-0.5">Scale (multiply by)</label>
              <input type="number" class="input input-bordered input-sm" [(ngModel)]="scale" step="any" />
            </div>
            <div class="form-control">
              <label class="label text-xs py-0.5">Offset (then add)</label>
              <input type="number" class="input input-bordered input-sm" [(ngModel)]="offset" step="any" />
            </div>
          </div>
        }

        @case ('smoothing') {
          <div class="grid grid-cols-2 gap-3">
            <div class="form-control">
              <label class="label text-xs py-0.5">Source</label>
              <app-variable-selector
                [variables]="ctx.fields()"
                [selectedKey]="sourceFieldKey()"
                [showIndex]="true"
                [filterFn]="nonComputeFilter"
                placeholder="Select source…"
                (selected)="onSourceSelected($event)"
              />
            </div>
            <div class="form-control">
              <label class="label text-xs py-0.5">Window size (1–16 points)</label>
              <input type="number" class="input input-bordered input-sm"
                [(ngModel)]="windowSize" min="1" max="16" step="1" />
            </div>
          </div>
        }

        @case ('clamping') {
          <div class="grid grid-cols-3 gap-3">
            <div class="form-control">
              <label class="label text-xs py-0.5">Source</label>
              <app-variable-selector
                [variables]="ctx.fields()"
                [selectedKey]="sourceFieldKey()"
                [showIndex]="true"
                [filterFn]="nonComputeFilter"
                placeholder="Select source…"
                (selected)="onSourceSelected($event)"
              />
            </div>
            <div class="form-control">
              <label class="label text-xs py-0.5">Min</label>
              <input type="number" class="input input-bordered input-sm" [(ngModel)]="clampMin" step="any" />
            </div>
            <div class="form-control">
              <label class="label text-xs py-0.5">Max</label>
              <input type="number" class="input input-bordered input-sm" [(ngModel)]="clampMax" step="any" />
            </div>
          </div>
        }

        @case ('running_total') {
          <div class="form-control max-w-xs">
            <label class="label text-xs py-0.5">Source</label>
            <app-variable-selector
              [variables]="ctx.fields()"
              [selectedKey]="sourceFieldKey()"
              [showIndex]="true"
              [filterFn]="nonComputeFilter"
              placeholder="Select source…"
              (selected)="onSourceSelected($event)"
            />
          </div>
        }

        @case ('comparison') {
          <div class="grid grid-cols-3 gap-3">
            <div class="form-control">
              <label class="label text-xs py-0.5">Source</label>
              <app-variable-selector
                [variables]="ctx.fields()"
                [selectedKey]="sourceFieldKey()"
                [showIndex]="true"
                [filterFn]="nonComputeFilter"
                placeholder="Select source…"
                (selected)="onSourceSelected($event)"
              />
            </div>
            <div class="form-control">
              <label class="label text-xs py-0.5">Operator</label>
              <select class="select select-bordered select-sm" [(ngModel)]="cmpOp">
                <option value="gt">Greater than (&gt;)</option>
                <option value="lt">Less than (&lt;)</option>
                <option value="gte">Greater or equal (&ge;)</option>
                <option value="lte">Less or equal (&le;)</option>
              </select>
            </div>
            <div class="form-control">
              <label class="label text-xs py-0.5">Threshold</label>
              <input type="number" class="input input-bordered input-sm" [(ngModel)]="threshold" step="any" />
            </div>
          </div>
        }

        @case ('combine') {
          <div class="grid grid-cols-3 gap-3">
            <div class="form-control">
              <label class="label text-xs py-0.5">Field A</label>
              <app-variable-selector
                [variables]="ctx.fields()"
                [selectedKey]="sourceFieldKey()"
                [showIndex]="true"
                [filterFn]="nonComputeFilter"
                placeholder="Select field A…"
                (selected)="onSourceSelected($event)"
              />
            </div>
            <div class="form-control">
              <label class="label text-xs py-0.5">Operation</label>
              <select class="select select-bordered select-sm" [(ngModel)]="combineOp">
                <option value="+">Add (+)</option>
                <option value="-">Subtract (−)</option>
                <option value="*">Multiply (×)</option>
                <option value="/">Divide (÷)</option>
                <option value="min">Minimum</option>
                <option value="max">Maximum</option>
              </select>
            </div>
            <div class="form-control">
              <label class="label text-xs py-0.5">Field B</label>
              <app-variable-selector
                [variables]="ctx.fields()"
                [selectedKey]="secondFieldKey()"
                [showIndex]="true"
                [filterFn]="nonComputeFilter"
                placeholder="Select field B…"
                (selected)="onSecondSelected($event)"
              />
            </div>
          </div>
        }

        @case ('rate_of_change') {
          <div class="grid grid-cols-2 gap-3">
            <div class="form-control">
              <label class="label text-xs py-0.5">Source</label>
              <app-variable-selector
                [variables]="ctx.fields()"
                [selectedKey]="sourceFieldKey()"
                [showIndex]="true"
                [filterFn]="nonComputeFilter"
                placeholder="Select source…"
                (selected)="onSourceSelected($event)"
              />
            </div>
            <div class="form-control">
              <label class="label text-xs py-0.5">Scale factor <span class="text-base-content/40">(1 = raw delta)</span></label>
              <input type="number" class="input input-bordered input-sm" [(ngModel)]="rateScale" step="any" />
            </div>
          </div>
        }

        @case ('sensor_mapping') {
          <div class="space-y-3">
            <div class="form-control max-w-xs">
              <label class="label text-xs py-0.5">Source</label>
              <app-variable-selector
                [variables]="ctx.fields()"
                [selectedKey]="sourceFieldKey()"
                [showIndex]="true"
                [filterFn]="nonComputeFilter"
                placeholder="Select source…"
                (selected)="onSourceSelected($event)"
              />
            </div>
            <div class="grid grid-cols-4 gap-3">
              <div class="form-control">
                <label class="label text-xs py-0.5">Input Low</label>
                <input type="number" class="input input-bordered input-sm" [(ngModel)]="mapInLow" step="any" />
              </div>
              <div class="form-control">
                <label class="label text-xs py-0.5">Input High</label>
                <input type="number" class="input input-bordered input-sm" [(ngModel)]="mapInHigh" step="any" />
              </div>
              <div class="form-control">
                <label class="label text-xs py-0.5">Output Low</label>
                <input type="number" class="input input-bordered input-sm" [(ngModel)]="mapOutLow" step="any" />
              </div>
              <div class="form-control">
                <label class="label text-xs py-0.5">Output High</label>
                <input type="number" class="input input-bordered input-sm" [(ngModel)]="mapOutHigh" step="any" />
              </div>
            </div>
          </div>
        }

        @case ('conditional') {
          <div class="space-y-3">
            <div class="grid grid-cols-3 gap-3">
              <div class="form-control">
                <label class="label text-xs py-0.5">Condition Field</label>
                <app-variable-selector
                  [variables]="ctx.fields()"
                  [selectedKey]="condFieldKey()"
                  [showIndex]="true"
                  [filterFn]="nonComputeFilter"
                  placeholder="Select field…"
                  (selected)="onCondFieldSelected($event)"
                />
              </div>
              <div class="form-control">
                <label class="label text-xs py-0.5">Operator</label>
                <select class="select select-bordered select-sm" [(ngModel)]="condOp">
                  <option value="gt">Greater than (&gt;)</option>
                  <option value="lt">Less than (&lt;)</option>
                  <option value="gte">Greater or equal (&ge;)</option>
                  <option value="lte">Less or equal (&le;)</option>
                </select>
              </div>
              <div class="form-control">
                <label class="label text-xs py-0.5">Threshold</label>
                <input type="number" class="input input-bordered input-sm" [(ngModel)]="condThreshold" step="any" />
              </div>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div class="form-control">
                <label class="label text-xs py-0.5">If True → use</label>
                <app-variable-selector
                  [variables]="ctx.fields()"
                  [selectedKey]="ifTrueFieldKey()"
                  [showIndex]="true"
                  [filterFn]="nonComputeFilter"
                  placeholder="Select field…"
                  (selected)="onIfTrueSelected($event)"
                />
              </div>
              <div class="form-control">
                <label class="label text-xs py-0.5">If False → use</label>
                <app-variable-selector
                  [variables]="ctx.fields()"
                  [selectedKey]="ifFalseFieldKey()"
                  [showIndex]="true"
                  [filterFn]="nonComputeFilter"
                  placeholder="Select field…"
                  (selected)="onIfFalseSelected($event)"
                />
              </div>
            </div>
          </div>
        }

        @case ('custom') {
          <div class="space-y-2">
            <div class="form-control">
              <label class="label text-xs py-0.5">Expression <span class="text-base-content/40">(use f0, f1, f2…)</span></label>
              <input type="text" class="input input-bordered input-sm font-mono"
                [(ngModel)]="customExpression"
                placeholder="e.g. f0 * 1.8 + 32"
                (keydown.enter)="onSave()" />
            </div>
            <!-- Variable reference -->
            @if (ctx.fields().length > 0) {
              <div class="text-xs text-base-content/50 space-x-3">
                @for (v of ctx.fields(); track v.id) {
                  <span class="font-mono">f{{ v.field_idx }}={{ v.display_name || v.field_key }}</span>
                }
              </div>
            }
            <!-- Function reference -->
            <details class="collapse collapse-arrow bg-base-200 rounded-lg">
              <summary class="collapse-title text-xs font-medium py-2 min-h-0">Available functions</summary>
              <div class="collapse-content text-xs px-3 pb-2">
                <table class="table table-xs">
                  <tbody>
                    @for (fn of functionCatalog; track fn.name) {
                      <tr>
                        <td class="font-mono">{{ fn.signature }}</td>
                        <td>{{ fn.description }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            </details>
          </div>
        }
      }

      <!-- Preview -->
      @if (currentExpression()) {
        <div class="bg-base-200 rounded-lg px-3 py-2 space-y-1">
          <p class="text-xs text-base-content/50">Preview</p>
          <p class="font-mono text-sm">{{ humanizedPreview() }}</p>
          <p class="text-xs text-base-content/40">
            Raw: <span class="font-mono">{{ currentExpression() }}</span>
            @if (bytecodeSize() > 0) {
              <span class="ml-2">· ~{{ bytecodeSize() }}/64 bytes</span>
            }
          </p>
        </div>
      }

      <!-- Validation errors/warnings -->
      @for (err of validationErrors(); track $index) {
        <div class="alert text-xs py-1.5"
          [class.alert-error]="err.severity === 'error'"
          [class.alert-warning]="err.severity === 'warning'">
          <span>{{ err.message }}</span>
        </div>
      }

      <!-- Probe result -->
      @if (probeResult() !== null) {
        <div class="text-xs text-success font-mono">Result: {{ probeResult() }}</div>
      }
      @if (probeError()) {
        <div class="text-xs text-error">{{ probeError() }}</div>
      }

      <!-- Actions -->
      <div class="flex justify-end gap-2">
        <button class="btn btn-xs btn-ghost" (click)="onProbe()" [disabled]="probing() || !currentExpression()">
          @if (probing()) { <span class="loading loading-spinner loading-xs"></span> }
          Test
        </button>
        <button class="btn btn-xs btn-primary" (click)="onSave()" [disabled]="saving() || hasErrors()">
          @if (saving()) { <span class="loading loading-spinner loading-xs"></span> }
          Save
        </button>
        <button class="btn btn-xs btn-ghost text-error" (click)="cancelEdit.emit()">Cancel</button>
      </div>

    </div>
  `,
})
export class ComputeVariableEditorComponent {
  variable = input.required<DeviceVariable>();

  cancelEdit = output<void>();
  saved = output<DeviceVariable>();

  private api = inject(ApiService);
  protected ctx = inject(ConfigContextService);

  // Metadata fields
  displayName = '';
  unit = '';

  // Recipe selection
  recipes = RECIPE_TEMPLATES;
  selectedRecipe = signal<RecipeType>('custom');
  functionCatalog = FUNCTION_CATALOG;

  // Recipe params — unit_conversion
  sourceFieldIdx = signal<number | null>(null);
  sourceFieldKey = signal<string>('');
  scale = 1;
  offset = 0;

  // Recipe params — smoothing
  windowSize = 8;

  // Recipe params — clamping
  clampMin = 0;
  clampMax = 100;

  // Recipe params — comparison
  cmpOp: 'gt' | 'lt' | 'gte' | 'lte' = 'gt';
  threshold = 0;

  // Recipe params — combine
  secondFieldIdx = signal<number | null>(null);
  secondFieldKey = signal<string>('');
  combineOp: '+' | '-' | '*' | '/' | 'min' | 'max' = '+';

  // Recipe params — rate_of_change
  rateScale = 1;

  // Recipe params — sensor_mapping
  mapInLow = 0;
  mapInHigh = 1023;
  mapOutLow = 0;
  mapOutHigh = 100;

  // Recipe params — conditional
  condFieldIdx = signal<number | null>(null);
  condFieldKey = signal<string>('');
  condOp: 'gt' | 'lt' | 'gte' | 'lte' = 'gt';
  condThreshold = 0;
  ifTrueFieldIdx = signal<number | null>(null);
  ifTrueFieldKey = signal<string>('');
  ifFalseFieldIdx = signal<number | null>(null);
  ifFalseFieldKey = signal<string>('');

  // Recipe params — custom
  customExpression = '';

  // Probe / save state
  probing = signal(false);
  saving = signal(false);
  probeResult = signal<number | null>(null);
  probeError = signal<string | null>(null);

  // Filter to exclude compute variables from source selectors
  nonComputeFilter = (v: DeviceVariable) => v.linked_type !== 'compute';

  // Computed expression from recipe params
  currentExpression = computed(() => {
    // Touch signals to create reactive dependency
    const recipe = this.selectedRecipe();
    const srcIdx = this.sourceFieldIdx();
    const secIdx = this.secondFieldIdx();

    // Touch conditional signals for reactivity
    const condIdx = this.condFieldIdx();
    const ifTrueIdx = this.ifTrueFieldIdx();
    const ifFalseIdx = this.ifFalseFieldIdx();

    switch (recipe) {
      case 'unit_conversion':
        if (srcIdx == null) return '';
        return recipeToExpression({ recipe: 'unit_conversion', params: { fieldIdx: srcIdx, scale: this.scale, offset: this.offset } });
      case 'smoothing':
        if (srcIdx == null) return '';
        return recipeToExpression({ recipe: 'smoothing', params: { fieldIdx: srcIdx, windowSize: this.windowSize } });
      case 'clamping':
        if (srcIdx == null) return '';
        return recipeToExpression({ recipe: 'clamping', params: { fieldIdx: srcIdx, min: this.clampMin, max: this.clampMax } });
      case 'running_total':
        if (srcIdx == null) return '';
        return recipeToExpression({ recipe: 'running_total', params: { fieldIdx: srcIdx } });
      case 'comparison':
        if (srcIdx == null) return '';
        return recipeToExpression({ recipe: 'comparison', params: { fieldIdx: srcIdx, op: this.cmpOp, threshold: this.threshold } });
      case 'combine':
        if (srcIdx == null || secIdx == null) return '';
        return recipeToExpression({ recipe: 'combine', params: { fieldIdxA: srcIdx, fieldIdxB: secIdx, op: this.combineOp } });
      case 'rate_of_change':
        if (srcIdx == null) return '';
        return recipeToExpression({ recipe: 'rate_of_change', params: { fieldIdx: srcIdx, scale: this.rateScale } });
      case 'sensor_mapping':
        if (srcIdx == null) return '';
        return recipeToExpression({ recipe: 'sensor_mapping', params: { fieldIdx: srcIdx, inLow: this.mapInLow, inHigh: this.mapInHigh, outLow: this.mapOutLow, outHigh: this.mapOutHigh } });
      case 'conditional':
        if (condIdx == null || ifTrueIdx == null || ifFalseIdx == null) return '';
        return recipeToExpression({ recipe: 'conditional', params: { condFieldIdx: condIdx, op: this.condOp, threshold: this.condThreshold, ifTrueFieldIdx: ifTrueIdx, ifFalseFieldIdx: ifFalseIdx } });
      case 'custom':
        return this.customExpression;
    }
  });

  humanizedPreview = computed(() => {
    const expr = this.currentExpression();
    return expr ? humanize(expr, this.ctx.fields()) : '';
  });

  validationErrors = computed(() => {
    const expr = this.currentExpression();
    if (!expr) return [];
    return parseAndValidate(expr, this.ctx.fields()).errors;
  });

  bytecodeSize = computed(() => {
    const expr = this.currentExpression();
    if (!expr) return 0;
    try {
      const ast = parse(expr);
      return estimateBytecodeSize(ast);
    } catch { return 0; }
  });

  hasErrors = computed(() =>
    this.validationErrors().some(e => e.severity === 'error')
  );

  ngOnInit(): void {
    const v = this.variable();
    this.displayName = v.display_name ?? '';
    this.unit = v.unit ?? '';

    // If there's an existing expression, default to custom mode
    if (v.expression) {
      this.customExpression = v.expression;
      this.selectedRecipe.set('custom');
    } else {
      this.selectedRecipe.set('unit_conversion');
    }
  }

  onSourceSelected(v: DeviceVariable | null): void {
    this.sourceFieldIdx.set(v?.field_idx ?? null);
    this.sourceFieldKey.set(v?.field_key ?? '');
  }

  onSecondSelected(v: DeviceVariable | null): void {
    this.secondFieldIdx.set(v?.field_idx ?? null);
    this.secondFieldKey.set(v?.field_key ?? '');
  }

  onCondFieldSelected(v: DeviceVariable | null): void {
    this.condFieldIdx.set(v?.field_idx ?? null);
    this.condFieldKey.set(v?.field_key ?? '');
  }

  onIfTrueSelected(v: DeviceVariable | null): void {
    this.ifTrueFieldIdx.set(v?.field_idx ?? null);
    this.ifTrueFieldKey.set(v?.field_key ?? '');
  }

  onIfFalseSelected(v: DeviceVariable | null): void {
    this.ifFalseFieldIdx.set(v?.field_idx ?? null);
    this.ifFalseFieldKey.set(v?.field_key ?? '');
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
    const expr = this.currentExpression();
    const eui = this.ctx.eui();
    this.saving.set(true);
    this.probeError.set(null);

    const doSave = () => {
      this.api.updateDeviceField(v.id, {
        display_name: this.displayName,
        unit: this.unit,
        expression: expr,
      }).subscribe({
        next: (updated) => {
          this.saving.set(false);
          this.saved.emit(updated);
          this.ctx.reloadFields();
        },
        error: (err) => {
          this.saving.set(false);
          this.probeError.set(err?.error?.message ?? err?.message ?? 'Failed to save');
        },
      });
    };

    // Validate with backend compiler first (if expression is non-empty and EUI available)
    if (expr && eui) {
      this.api.compileExpression(eui, expr).subscribe({
        next: (res) => {
          if (res.errors?.length > 0) {
            this.saving.set(false);
            this.probeError.set('Compile error: ' + res.errors.join('; '));
          } else {
            doSave();
          }
        },
        error: () => doSave(), // If compile endpoint unavailable, save anyway
      });
    } else {
      doSave();
    }
  }
}
