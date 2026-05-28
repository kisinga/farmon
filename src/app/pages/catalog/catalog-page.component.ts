import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ElectronService } from '../../core/services/electron.service';
import type { ProductLineRow, QuoteDefaultsRow } from '../../core/models/electron-api';
import { COMPONENT_REGISTRY, type ComponentDefinition } from '@far-mon/core';

interface VariantFormRow {
  params: Record<string, string>;
  unitCost: number;
  currency: string;
  partNumber: string;
}

@Component({
  selector: 'app-catalog-page',
  standalone: true,
  imports: [FormsModule],
  host: { class: 'flex-1 overflow-auto bg-base-100' },
  template: `
    <div class="max-w-6xl mx-auto p-6 space-y-6">
      <div class="flex items-center justify-between">
        <h1 class="text-2xl font-bold">Product Catalog</h1>
      </div>

      @if (error()) {
        <div class="alert alert-error">{{ error() }}</div>
      }

      @for (component of componentList(); track component.id) {
        <div class="card bg-base-200">
          <div class="card-body p-4">
            <div class="flex items-center justify-between">
              <div>
                <h2 class="card-title text-base">{{ component.name }}</h2>
                <p class="text-xs text-base-content/50">{{ component.description }}</p>
                @if (component.parameters.length > 0) {
                  <div class="text-xs text-base-content/40 mt-1">
                    Parameters: {{ component.parameters.map(p => p.label).join(', ') }}
                  </div>
                }
              </div>
              <div class="flex gap-2">
                @if (defaultFor(component.id)) {
                  <span class="badge badge-sm badge-primary">
                    Default: {{ defaultFor(component.id)?.manufacturer_id }} — {{ formatParams(defaultFor(component.id)!.params) }}
                  </span>
                }
                <button class="btn btn-xs btn-ghost" (click)="openDefaultModal(component.id)">Set Default</button>
                <button class="btn btn-xs btn-primary" (click)="openAddManufacturer(component.id)">+ Manufacturer</button>
              </div>
            </div>

            <div class="overflow-x-auto mt-3">
              <table class="table table-sm">
                <thead>
                  <tr>
                    <th>Manufacturer</th>
                    <th>Variants</th>
                    <th>Rating</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  @for (line of linesFor(component.id); track line.id) {
                    <tr [class.opacity-50]="line.is_active === 0">
                      <td>
                        <div class="font-medium">{{ line.manufacturer }}</div>
                        <div class="text-xs text-base-content/50">{{ line.name }}</div>
                        @if (line.selection_help) {
                          <div class="text-xs text-base-content/40 italic mt-0.5">{{ line.selection_help }}</div>
                        }
                      </td>
                      <td>
                        <div class="flex flex-wrap gap-1">
                          @for (v of parseVariants(line.variants); track v.key) {
                            <span class="badge badge-ghost badge-xs" [class.badge-error]="v.price === 0">
                              {{ v.label }}: {{ v.price === 0 ? '—' : '$' + v.price }}
                            </span>
                          }
                        </div>
                      </td>
                      <td>
                        @if (line.reliability_score) {
                          <div class="flex gap-0.5">
                            @for (s of [1,2,3,4,5]; track s) {
                              <span class="text-xs" [class.text-warning]="s <= line.reliability_score" [class.text-base-300]="s > line.reliability_score">★</span>
                            }
                          </div>
                        } @else {
                          <span class="text-xs text-base-content/30">—</span>
                        }
                      </td>
                      <td>
                        @if (line.is_active) {
                          <span class="badge badge-success badge-xs">Active</span>
                        } @else {
                          <span class="badge badge-ghost badge-xs">Inactive</span>
                        }
                      </td>
                      <td>
                        <div class="flex gap-1">
                          <button class="btn btn-ghost btn-xs" (click)="editManufacturer(line)">Edit</button>
                          @if (line.is_active) {
                            <button class="btn btn-ghost btn-xs text-error" (click)="deactivate(line.id)">Deactivate</button>
                          }
                        </div>
                      </td>
                    </tr>
                  } @empty {
                    <tr><td colspan="5" class="text-center text-base-content/40 py-4">No manufacturers for this component.</td></tr>
                  }
                </tbody>
              </table>
            </div>
          </div>
        </div>
      }
    </div>

    <!-- Add/Edit Manufacturer Modal -->
    @if (showModal()) {
      <dialog class="modal modal-open" style="position: fixed;">
        <div class="modal-box max-w-2xl">
          <h3 class="font-bold text-lg mb-4">{{ editingLine() ? 'Edit' : 'Add' }} Manufacturer</h3>
          <div class="space-y-3">
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="label"><span class="label-text">Component</span></label>
                <select class="select select-sm select-bordered w-full" [ngModel]="form().component_id" (ngModelChange)="updateForm('component_id', $event)" [disabled]="!!editingLine()">
                  @for (c of componentList(); track c.id) {
                    <option [value]="c.id">{{ c.name }}</option>
                  }
                </select>
              </div>
              <div>
                <label class="label"><span class="label-text">ID</span></label>
                <input class="input input-sm input-bordered w-full" [ngModel]="form().id" (ngModelChange)="updateForm('id', $event)" [disabled]="!!editingLine()" />
              </div>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="label"><span class="label-text">Manufacturer</span></label>
                <input class="input input-sm input-bordered w-full" [ngModel]="form().manufacturer" (ngModelChange)="updateForm('manufacturer', $event)" />
              </div>
              <div>
                <label class="label"><span class="label-text">Product Name</span></label>
                <input class="input input-sm input-bordered w-full" [ngModel]="form().name" (ngModelChange)="updateForm('name', $event)" />
              </div>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="label"><span class="label-text">Part Number</span></label>
                <input class="input input-sm input-bordered w-full" [ngModel]="form().manufacturer_pn" (ngModelChange)="updateForm('manufacturer_pn', $event)" />
              </div>
              <div>
                <label class="label"><span class="label-text">Reliability Score (1-5)</span></label>
                <input type="number" min="1" max="5" class="input input-sm input-bordered w-full" [ngModel]="form().reliability_score" (ngModelChange)="updateForm('reliability_score', $event)" />
              </div>
            </div>
            <div>
              <label class="label"><span class="label-text">Description</span></label>
              <textarea class="textarea textarea-bordered textarea-sm w-full" [ngModel]="form().description" (ngModelChange)="updateForm('description', $event)"></textarea>
            </div>
            <div>
              <label class="label"><span class="label-text">Selection Help</span></label>
              <input class="input input-sm input-bordered w-full" [ngModel]="form().selection_help" (ngModelChange)="updateForm('selection_help', $event)" placeholder="e.g. Best for systems up to 3 bar" />
            </div>
            <div>
              <label class="label"><span class="label-text">Base Specs JSON</span></label>
              <textarea class="textarea textarea-bordered textarea-sm w-full font-mono text-xs" [ngModel]="form().base_specs" (ngModelChange)="updateForm('base_specs', $event)" placeholder='{"voltage":"12V DC","material":"brass"}'></textarea>
            </div>

            <div>
              <label class="label"><span class="label-text">Variants</span></label>
              <p class="text-xs text-base-content/40 mb-2">Set price to 0 to omit a variant from quotes.</p>
              <table class="table table-xs">
                <thead>
                  <tr>
                    @for (param of currentComponentParameters(); track param.name) {
                      <th>{{ param.label }}</th>
                    }
                    <th>Unit Cost (USD)</th>
                    <th>Currency</th>
                    <th>Part Number</th>
                  </tr>
                </thead>
                <tbody>
                  @for (row of variantRows(); track $index) {
                    <tr>
                      @for (param of currentComponentParameters(); track param.name) {
                        <td>
                          @if (param.type === 'select') {
                            <select class="select select-xs select-bordered w-full" [(ngModel)]="row.params[param.name]">
                              @for (opt of param.options; track opt) {
                                <option [value]="opt">{{ opt }}</option>
                              }
                            </select>
                          }
                        </td>
                      }
                      <td><input type="number" step="0.01" class="input input-xs input-bordered w-24" [(ngModel)]="row.unitCost" /></td>
                      <td><input class="input input-xs input-bordered w-20" [(ngModel)]="row.currency" /></td>
                      <td><input class="input input-xs input-bordered w-32" [(ngModel)]="row.partNumber" /></td>
                    </tr>
                  }
                </tbody>
              </table>
              <button class="btn btn-xs btn-ghost mt-2" (click)="addVariantRow()">+ Add Variant</button>
            </div>
          </div>
          <div class="modal-action">
            <button class="btn btn-ghost" (click)="closeModal()">Cancel</button>
            <button class="btn btn-primary" [disabled]="!canSave()" (click)="saveForm()">Save</button>
          </div>
        </div>
        <div class="modal-backdrop" (click)="closeModal()"></div>
      </dialog>
    }

    <!-- Set Default Modal -->
    @if (showDefaultModal()) {
      <dialog class="modal modal-open" style="position: fixed;">
        <div class="modal-box max-w-md">
          <h3 class="font-bold text-lg mb-4">Set Default for {{ defaultModalComponent()?.name }}</h3>
          <div class="space-y-3">
            <div>
              <label class="label"><span class="label-text">Default Manufacturer</span></label>
              <select class="select select-sm select-bordered w-full" [(ngModel)]="defaultForm().manufacturerId">
                @for (line of linesFor(defaultModalComponent()!.id); track line.id) {
                  <option [value]="line.id">{{ line.manufacturer }} — {{ line.name }}</option>
                }
              </select>
            </div>
            <div>
              <label class="label"><span class="label-text">Default Parameters</span></label>
              @for (param of defaultModalComponent()!.parameters; track param.name) {
                <div class="mt-2">
                  <span class="text-xs text-base-content/60">{{ param.label }}</span>
                  @if (param.type === 'select') {
                    <select class="select select-sm select-bordered w-full mt-1" [(ngModel)]="defaultForm().params[param.name]">
                      @for (opt of param.options; track opt) {
                        <option [value]="opt">{{ opt }}</option>
                      }
                    </select>
                  }
                </div>
              }
            </div>
          </div>
          <div class="modal-action">
            <button class="btn btn-ghost" (click)="closeDefaultModal()">Cancel</button>
            <button class="btn btn-primary" (click)="saveDefault()">Save</button>
          </div>
        </div>
        <div class="modal-backdrop" (click)="closeDefaultModal()"></div>
      </dialog>
    }
  `,
})
export class CatalogPageComponent implements OnInit {
  private electron = inject(ElectronService);

  protected items = signal<ProductLineRow[]>([]);
  protected defaults = signal<QuoteDefaultsRow[]>([]);
  protected error = signal('');
  protected showModal = signal(false);
  protected showDefaultModal = signal(false);
  protected editingLine = signal<ProductLineRow | null>(null);
  protected defaultModalComponent = signal<ComponentDefinition | null>(null);

  protected form = signal<Partial<ProductLineRow>>({
    id: '', component_id: '', name: '', manufacturer: '', manufacturer_pn: '',
    description: '', selection_help: '', base_specs: '{}', reliability_score: null,
  });

  protected variantRows = signal<VariantFormRow[]>([]);

  protected defaultForm = signal<{ manufacturerId: string; params: Record<string, string> }>({
    manufacturerId: '', params: {},
  });

  protected componentList = computed(() => Object.values(COMPONENT_REGISTRY));

  protected currentComponentParameters = computed(() => {
    const comp = COMPONENT_REGISTRY[this.form().component_id ?? ''];
    return comp?.parameters ?? [];
  });

  protected linesFor(componentId: string) {
    return this.items().filter((i) => i.component_id === componentId);
  }

  protected defaultFor(componentId: string): QuoteDefaultsRow | undefined {
    return this.defaults().find((d) => d.component_id === componentId);
  }

  protected parseVariants(variantsJson: string): Array<{ key: string; label: string; price: number }> {
    try {
      const arr = JSON.parse(variantsJson) as Array<{ params: Record<string, string>; unitCost: number }>;
      return arr.map((v) => ({
        key: JSON.stringify(v.params),
        label: Object.entries(v.params).map(([, val]) => val).join(' / '),
        price: v.unitCost,
      }));
    } catch {
      return [];
    }
  }

  protected formatParams(paramsJson: string): string {
    try {
      const obj = JSON.parse(paramsJson) as Record<string, string>;
      return Object.entries(obj).map(([, v]) => v).join(', ');
    } catch {
      return '';
    }
  }

  async ngOnInit() {
    await this.load();
  }

  protected async load() {
    try {
      const [items, defaults] = await Promise.all([
        this.electron.catalogList(),
        this.electron.quoteDefaultsGet(),
      ]);
      this.items.set(items);
      this.defaults.set(defaults);
    } catch (e) {
      this.error.set(String(e));
    }
  }

  protected openAddManufacturer(componentId: string) {
    const comp = COMPONENT_REGISTRY[componentId];
    if (!comp) return;
    this.editingLine.set(null);
    this.form.set({
      id: '', component_id: componentId, name: '', manufacturer: '', manufacturer_pn: '',
      description: '', selection_help: '', base_specs: '{}', reliability_score: null,
    });
    this.variantRows.set(this.generateDefaultVariantRows(comp));
    this.showModal.set(true);
  }

  protected editManufacturer(line: ProductLineRow) {
    this.editingLine.set(line);
    this.form.set({ ...line });
    const comp = COMPONENT_REGISTRY[line.component_id];
    const variants: VariantFormRow[] = this.parseVariants(line.variants).map((v, i) => {
      const parsed = JSON.parse(line.variants) as Array<{ params: Record<string, string>; unitCost: number; currency: string; partNumber?: string }>;
      const raw = parsed[i] ?? { params: {}, unitCost: 0, currency: 'USD', partNumber: '' };
      return { params: raw.params, unitCost: raw.unitCost, currency: raw.currency, partNumber: raw.partNumber ?? '' };
    });
    this.variantRows.set(variants.length > 0 ? variants : this.generateDefaultVariantRows(comp));
    this.showModal.set(true);
  }

  protected generateDefaultVariantRows(comp: ComponentDefinition): VariantFormRow[] {
    if (comp.parameters.length === 0) {
      return [{ params: {}, unitCost: 0, currency: 'USD', partNumber: '' }];
    }
    const param = comp.parameters[0]!;
    if (param.type !== 'select') {
      return [{ params: { [param.name]: '' }, unitCost: 0, currency: 'USD', partNumber: '' }];
    }
    return param.options.map((opt) => ({
      params: { [param.name]: opt },
      unitCost: 0,
      currency: 'USD',
      partNumber: '',
    }));
  }

  protected addVariantRow() {
    const comp = COMPONENT_REGISTRY[this.form().component_id ?? ''];
    if (!comp) return;
    const params: Record<string, string> = {};
    for (const p of comp.parameters) {
      params[p.name] = p.type === 'select' ? p.options[0] ?? '' : '';
    }
    this.variantRows.update((rows) => [...rows, { params, unitCost: 0, currency: 'USD', partNumber: '' }]);
  }

  protected closeModal() {
    this.showModal.set(false);
    this.editingLine.set(null);
  }

  protected updateForm<K extends keyof ProductLineRow>(key: K, value: ProductLineRow[K]) {
    this.form.update((f) => ({ ...f, [key]: value }));
    if (key === 'component_id') {
      const comp = COMPONENT_REGISTRY[value as string];
      if (comp) {
        this.variantRows.set(this.generateDefaultVariantRows(comp));
      }
    }
  }

  protected canSave = computed(() => {
    const f = this.form();
    return !!(f.id && f.name && f.manufacturer && f.component_id);
  });

  protected async saveForm() {
    const f = this.form();
    const item: ProductLineRow = {
      id: f.id ?? '',
      component_id: f.component_id ?? '',
      manufacturer: f.manufacturer ?? '',
      name: f.name ?? '',
      manufacturer_pn: f.manufacturer_pn ?? null,
      description: f.description ?? null,
      selection_help: f.selection_help ?? null,
      reliability_score: f.reliability_score ?? null,
      base_specs: f.base_specs ?? '{}',
      variants: JSON.stringify(this.variantRows().map((r) => ({
        params: r.params,
        unitCost: r.unitCost,
        currency: r.currency,
        partNumber: r.partNumber || undefined,
        isActive: true,
      }))),
      is_active: 1,
      is_user_defined: 1,
    };
    await this.electron.catalogUpsert(item);
    this.closeModal();
    await this.load();
  }

  protected async deactivate(id: string) {
    await this.electron.catalogDeactivate(id);
    await this.load();
  }

  protected openDefaultModal(componentId: string) {
    const comp = COMPONENT_REGISTRY[componentId];
    if (!comp) return;
    this.defaultModalComponent.set(comp);
    const existing = this.defaults().find((d) => d.component_id === componentId);
    const lines = this.linesFor(componentId);
    this.defaultForm.set({
      manufacturerId: existing?.manufacturer_id ?? lines[0]?.id ?? '',
      params: existing ? JSON.parse(existing.params) : { ...comp.defaultParams },
    });
    this.showDefaultModal.set(true);
  }

  protected closeDefaultModal() {
    this.showDefaultModal.set(false);
    this.defaultModalComponent.set(null);
  }

  protected async saveDefault() {
    const comp = this.defaultModalComponent();
    if (!comp) return;
    await this.electron.quoteDefaultsSet(comp.id, this.defaultForm().manufacturerId, JSON.stringify(this.defaultForm().params));
    this.closeDefaultModal();
    await this.load();
  }
}
