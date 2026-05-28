import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ElectronService } from '../../core/services/electron.service';
import type { CatalogItem, FeedbackRow } from '../../core/models/electron-api';

@Component({
  selector: 'app-catalog-page',
  standalone: true,
  imports: [FormsModule],
  host: { class: 'flex-1 overflow-auto bg-base-100' },
  template: `
    <div class="max-w-6xl mx-auto p-6 space-y-6">
      <div class="flex items-center justify-between">
        <h1 class="text-2xl font-bold">Product Catalog</h1>
        <button class="btn btn-primary btn-sm" (click)="showAdd.set(true)">+ Add Item</button>
      </div>

      @if (error()) {
        <div class="alert alert-error">{{ error() }}</div>
      }

      <!-- Category filter -->
      <div class="flex gap-2">
        <button class="btn btn-xs" [class.btn-active]="filter() === ''" (click)="filter.set('')">All</button>
        @for (cat of categories(); track cat) {
          <button class="btn btn-xs" [class.btn-active]="filter() === cat" (click)="filter.set(cat)">{{ cat }}</button>
        }
      </div>

      <!-- Catalog table -->
      <div class="overflow-x-auto">
        <table class="table table-sm">
          <thead>
            <tr>
              <th>Name</th>
              <th>Manufacturer</th>
              <th>Specs</th>
              <th class="text-right">Cost (KSh)</th>
              <th>Rating</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            @for (item of filteredItems(); track item.id) {
              <tr [class.opacity-50]="!item.is_active">
                <td>
                  <div class="font-medium">{{ item.name }}</div>
                  <div class="text-xs text-base-content/50">{{ item.id }}</div>
                  @if (item.selection_help) {
                    <div class="text-xs text-base-content/40 italic mt-0.5">{{ item.selection_help }}</div>
                  }
                </td>
                <td>
                  <div>{{ item.manufacturer }}</div>
                  @if (item.manufacturer_pn) {
                    <div class="text-xs text-base-content/50">{{ item.manufacturer_pn }}</div>
                  }
                </td>
                <td>
                  <div class="flex flex-wrap gap-1">
                    @for (spec of parseSpecs(item.specs); track spec.key) {
                      <span class="badge badge-ghost badge-xs">{{ spec.key }}: {{ spec.value }}</span>
                    }
                  </div>
                </td>
                <td class="text-right font-mono">{{ item.unit_cost_usd?.toFixed(2) ?? '—' }}</td>
                <td>
                  @if (item.reliability_score) {
                    <div class="flex gap-0.5">
                      @for (s of [1,2,3,4,5]; track s) {
                        <span class="text-xs" [class.text-warning]="s <= item.reliability_score" [class.text-base-300]="s > item.reliability_score">★</span>
                      }
                    </div>
                  } @else {
                    <span class="text-xs text-base-content/30">—</span>
                  }
                </td>
                <td>
                  @if (item.is_active) {
                    <span class="badge badge-success badge-xs">Active</span>
                  } @else {
                    <span class="badge badge-ghost badge-xs">Inactive</span>
                  }
                </td>
                <td>
                  <div class="flex gap-1">
                    <button class="btn btn-ghost btn-xs" (click)="editItem(item)">Edit</button>
                    @if (item.is_active) {
                      <button class="btn btn-ghost btn-xs text-error" (click)="deactivate(item.id)">Deactivate</button>
                    }
                  </div>
                </td>
              </tr>
            } @empty {
              <tr><td colspan="7" class="text-center text-base-content/40 py-8">No items found.</td></tr>
            }
          </tbody>
        </table>
      </div>
    </div>

    <!-- Add/Edit modal -->
    @if (showAdd() || editingItem()) {
      <dialog class="modal modal-open" style="position: fixed;">
        <div class="modal-box max-w-lg">
          <h3 class="font-bold text-lg mb-4">{{ editingItem() ? 'Edit Item' : 'Add Catalog Item' }}</h3>
          <div class="space-y-3">
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="label"><span class="label-text">ID</span></label>
                <input class="input input-sm input-bordered w-full" [ngModel]="form().id" (ngModelChange)="updateForm('id', $event)" [disabled]="!!editingItem()" />
              </div>
              <div>
                <label class="label"><span class="label-text">Category</span></label>
                <select class="select select-sm select-bordered w-full" [ngModel]="form().category" (ngModelChange)="updateForm('category', $event)">
                  <option value="base_infra">Base Infrastructure</option>
                  <option value="controller">Controller</option>
                  <option value="valve">Valve</option>
                  <option value="flow_sensor">Flow Sensor</option>
                  <option value="pump">Pump</option>
                  <option value="relay">Relay</option>
                  <option value="power">Power</option>
                  <option value="enclosure">Enclosure</option>
                </select>
              </div>
            </div>
            <div>
              <label class="label"><span class="label-text">Name</span></label>
              <input class="input input-sm input-bordered w-full" [ngModel]="form().name" (ngModelChange)="updateForm('name', $event)" />
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="label"><span class="label-text">Manufacturer</span></label>
                <input class="input input-sm input-bordered w-full" [ngModel]="form().manufacturer" (ngModelChange)="updateForm('manufacturer', $event)" />
              </div>
              <div>
                <label class="label"><span class="label-text">Part Number</span></label>
                <input class="input input-sm input-bordered w-full" [ngModel]="form().manufacturer_pn" (ngModelChange)="updateForm('manufacturer_pn', $event)" />
              </div>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="label"><span class="label-text">Cost (USD)</span></label>
                <input type="number" step="0.01" class="input input-sm input-bordered w-full" [ngModel]="form().unit_cost_usd" (ngModelChange)="updateForm('unit_cost_usd', $event)" />
              </div>
              <div>
                <label class="label"><span class="label-text">Sub-category</span></label>
                <input class="input input-sm input-bordered w-full" [ngModel]="form().sub_category" (ngModelChange)="updateForm('sub_category', $event)" />
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
              <label class="label"><span class="label-text">Specs JSON</span></label>
              <textarea class="textarea textarea-bordered textarea-sm w-full font-mono text-xs" [ngModel]="form().specs" (ngModelChange)="updateForm('specs', $event)" placeholder='{"portSize":"DN20","voltage":"12V DC"}'></textarea>
            </div>
          </div>
          <div class="modal-action">
            <button class="btn btn-ghost" (click)="closeForm()">Cancel</button>
            <button class="btn btn-primary" [disabled]="!canSave()" (click)="saveForm()">Save</button>
          </div>
        </div>
        <div class="modal-backdrop" (click)="closeForm()"></div>
      </dialog>
    }
  `,
})
export class CatalogPageComponent implements OnInit {
  private electron = inject(ElectronService);

  protected items = signal<CatalogItem[]>([]);
  protected filter = signal('');
  protected error = signal('');
  protected showAdd = signal(false);
  protected editingItem = signal<CatalogItem | null>(null);

  protected form = signal<Partial<CatalogItem>>({
    id: '', category: 'valve', name: '', manufacturer: '', manufacturer_pn: '',
    unit_cost_usd: 0, sub_category: '', description: '', selection_help: '', specs: '{}',
  });

  protected categories = computed(() => {
    const cats = new Set(this.items().map((i) => i.category));
    return Array.from(cats).sort();
  });

  protected filteredItems = computed(() => {
    const f = this.filter();
    if (!f) return this.items();
    return this.items().filter((i) => i.category === f);
  });

  protected canSave = computed(() => {
    const f = this.form();
    return !!(f.id && f.name && f.manufacturer && f.category);
  });

  async ngOnInit() {
    await this.load();
  }

  protected async load() {
    try {
      this.items.set(await this.electron.catalogList());
    } catch (e) {
      this.error.set(String(e));
    }
  }

  protected parseSpecs(specsJson: string): Array<{ key: string; value: string }> {
    try {
      const obj = JSON.parse(specsJson) as Record<string, string>;
      return Object.entries(obj).map(([key, value]) => ({ key, value: String(value) }));
    } catch {
      return [];
    }
  }

  protected editItem(item: CatalogItem) {
    this.editingItem.set(item);
    this.form.set({ ...item });
    this.showAdd.set(false);
  }

  protected closeForm() {
    this.showAdd.set(false);
    this.editingItem.set(null);
    this.form.set({
      id: '', category: 'valve', name: '', manufacturer: '', manufacturer_pn: '',
      unit_cost_usd: 0, sub_category: '', description: '', selection_help: '', specs: '{}',
    });
  }

  protected updateForm<K extends keyof CatalogItem>(key: K, value: CatalogItem[K]) {
    this.form.update((f) => ({ ...f, [key]: value }));
  }

  protected async saveForm() {
    const f = this.form();
    const item: CatalogItem = {
      id: f.id ?? '',
      category: f.category ?? 'valve',
      sub_category: f.sub_category ?? null,
      name: f.name ?? '',
      manufacturer: f.manufacturer ?? '',
      manufacturer_pn: f.manufacturer_pn ?? null,
      specs: f.specs ?? '{}',
      unit_cost_usd: f.unit_cost_usd ?? 0,
      currency: f.currency ?? 'USD',
      description: f.description ?? null,
      selection_help: f.selection_help ?? null,
      reliability_score: f.reliability_score ?? null,
      is_active: 1,
      is_user_defined: 1,
    };
    await this.electron.catalogUpsert(item);
    this.closeForm();
    await this.load();
  }

  protected async deactivate(id: string) {
    await this.electron.catalogDeactivate(id);
    await this.load();
  }
}
